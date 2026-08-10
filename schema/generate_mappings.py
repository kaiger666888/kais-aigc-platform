#!/usr/bin/env python3
"""generate_mappings.py — regenerate the 3 consumer files from pipeline-field-map.yaml.

The single source of truth is ``schema/pipeline-field-map.yaml``. This script
derives three byte-identical, reproducible consumer artifacts:

  - ``schema/generated/canvas_sync_mappings.py``
      Python; consumed by kais-hermes-skills ``plugins/kais_aigc/canvas_sync.py``
      via ``_MAPPINGS`` (cross-repo, loaded by absolute path). Exports
      ``VERSION`` / ``ENUM_MAPS`` / ``ENUM_DEFAULTS`` / ``PHASE_META`` /
      ``PHASE_FIELDS``.
  - ``schema/generated/frontend-zod-extensions.ts``
      TS; consumed by ``src/lib/canvasAssetSchema.ts`` ``withYamlOptional()``.
      Exports ``YAML_OPTIONAL_FIELDS`` (+ static ``ZodFieldType`` /
      ``YamlOptionalField`` types).
  - ``schema/generated/frontend-enum-normalizers.ts``
      TS; consumed by ``src/routes/canvas/v2/import-from-dir.ts``. Exports
      ``SCHEMA_ALIASES`` + ``ENUM_NORMALIZERS``.

Run: ``python schema/generate_mappings.py`` (no arguments). Idempotent: re-running
over an unchanged YAML reproduces the three outputs byte-for-byte.

The Python consumer file is emitted with a recursive literal emitter (NOT
``json.dumps``) so that ``bool`` renders as ``True``/``False`` (Python) rather
than ``true``/``false`` (JSON), with double-quoted strings and 4-space
indentation. The two TS files use ``JSON.stringify(obj, null, 2)``.
"""
from __future__ import annotations

import json
import os
from typing import Any

import yaml

HERE = os.path.dirname(os.path.abspath(__file__))
YAML_PATH = os.path.join(HERE, "pipeline-field-map.yaml")
GEN_DIR = os.path.join(HERE, "generated")

# Field attributes carried through to PHASE_FIELDS (in this canonical order,
# which matches the declaration order used in the YAML). Unknown attributes
# are dropped so the generated table stays stable.
KNOWN_FIELD_ATTRS = ("python_key", "canvas_key", "zod_type", "enum", "transform", "required")

PY_HEADER = (
    '"""AUTO-GENERATED from pipeline-field-map.yaml — DO NOT EDIT.\n\n'
    "Run `python schema/generate_mappings.py` to regenerate.\n"
    '"""'
)
TS_HEADER = (
    "// AUTO-GENERATED from pipeline-field-map.yaml — DO NOT EDIT.\n"
    "// Run `python schema/generate_mappings.py` to regenerate.\n\n"
)


# ─── Python literal emitter (recursive) ──────────────────────────────────────


def _dq(s: str) -> str:
    """Double-quote a string JSON-style without ASCII-escaping CJK."""
    return json.dumps(s, ensure_ascii=False)


def _py_literal(value: Any, level: int, step: int = 4) -> str:
    """Render a Python dict literal.

    ``level`` is the indent level of the *closing* brace. The opening brace is
    always emitted inline — the caller places it after ``=`` (top-level
    assignment) or ``: `` (nested value). Empty dicts render as ``{}``.

    ``bool`` → ``True``/``False`` (Python), ``str`` → double-quoted,
    ``dict`` → multi-line with ``step``-space indentation and no trailing
    commas. Key order follows insertion order (callers build dicts in YAML
    document order).
    """
    pad = " " * (step * level)
    # bool BEFORE int (bool is a subclass of int) — though no ints appear here.
    if isinstance(value, bool):
        return "True" if value else "False"
    if isinstance(value, str):
        return _dq(value)
    if isinstance(value, dict):
        if not value:
            return "{}"
        inner = " " * (step * (level + 1))
        parts: list[str] = []
        items = list(value.items())
        last = len(items) - 1
        for i, (k, v) in enumerate(items):
            comma = "," if i < last else ""
            parts.append(f"{inner}{_dq(k)}: {_py_literal(v, level + 1, step)}{comma}")
        return "{\n" + "\n".join(parts) + "\n" + pad + "}"
    raise TypeError(f"unsupported type for Python literal: {type(value)!r}")


# ─── YAML load + derive ──────────────────────────────────────────────────────


def _load_yaml() -> dict:
    with open(YAML_PATH, encoding="utf-8") as f:
        return yaml.safe_load(f)


def _derive(data: dict) -> dict:
    version: str = data["version"]
    enums: dict = data.get("enums", {}) or {}
    phases: dict = data.get("phases", {}) or {}

    # ── ENUM_MAPS (default stripped) + ENUM_DEFAULTS (default only) ──
    enum_maps: dict[str, dict[str, str]] = {}
    enum_defaults: dict[str, str] = {}
    for name, entries in enums.items():
        enum_maps[name] = {k: v for k, v in entries.items() if k != "default"}
        enum_defaults[name] = entries.get("default")

    # ── PHASE_META + PHASE_FIELDS (iterate phases in YAML document order) ──
    phase_meta: dict[str, dict[str, str]] = {}
    phase_fields: dict[str, dict[str, dict[str, Any]]] = {}
    for phase, pdata in phases.items():
        phase_meta[phase] = {
            "canvas_type": pdata["canvas_type"],
            "asset_type": pdata["asset_type"],
        }
        fields_in = pdata.get("fields", {}) or {}
        fields_out: dict[str, dict[str, Any]] = {}
        for field_key, fattrs in fields_in.items():
            fields_out[field_key] = {k: fattrs[k] for k in KNOWN_FIELD_ATTRS if k in fattrs}
        phase_fields[phase] = fields_out

    # ── discover canvas_types in first-appearance order ──
    canvas_types: list[str] = []
    for phase, pdata in phases.items():
        ct = pdata["canvas_type"]
        if ct not in canvas_types:
            canvas_types.append(ct)

    # ── YAML_OPTIONAL_FIELDS: required:false only, dedup by canvas_key ──
    yaml_optional: dict[str, list] = {}
    for ct in canvas_types:
        seen: set[str] = set()
        entries: list[dict[str, str]] = []
        for phase, pdata in phases.items():
            if pdata["canvas_type"] != ct:
                continue
            for fattrs in (pdata.get("fields", {}) or {}).values():
                if fattrs.get("required") is True:
                    continue
                ck = fattrs["canvas_key"]
                if ck in seen:
                    continue
                seen.add(ck)
                entries.append({"key": ck, "zodType": fattrs["zod_type"]})
        yaml_optional[ct] = entries

    # ── SCHEMA_ALIASES: python_key→canvas_key, skip same-name + dotted paths ──
    schema_aliases: dict[str, dict[str, str]] = {}
    for ct in canvas_types:
        seen_pk: set[str] = set()
        aliases: dict[str, str] = {}
        for phase, pdata in phases.items():
            if pdata["canvas_type"] != ct:
                continue
            for fattrs in (pdata.get("fields", {}) or {}).values():
                pk = fattrs["python_key"]
                ck = fattrs["canvas_key"]
                if pk == ck or "." in pk or pk in seen_pk:
                    continue
                seen_pk.add(pk)
                aliases[pk] = ck
        schema_aliases[ct] = aliases

    # ── ENUM_NORMALIZERS: by canvas_key, enum map w/o default, dedup canvas_key ──
    enum_normalizers: dict[str, dict[str, str]] = {}
    seen_ck: set[str] = set()
    for phase, pdata in phases.items():
        for fattrs in (pdata.get("fields", {}) or {}).values():
            enum_name = fattrs.get("enum")
            if not enum_name:
                continue
            ck = fattrs["canvas_key"]
            if ck in seen_ck:
                continue
            seen_ck.add(ck)
            if enum_name not in enum_maps:
                raise KeyError(f"field refs enum {enum_name!r} but YAML enums block has no such entry")
            enum_normalizers[ck] = enum_maps[enum_name]

    return {
        "version": version,
        "enum_maps": enum_maps,
        "enum_defaults": enum_defaults,
        "phase_meta": phase_meta,
        "phase_fields": phase_fields,
        "yaml_optional": yaml_optional,
        "schema_aliases": schema_aliases,
        "enum_normalizers": enum_normalizers,
    }


# ─── Emitters ────────────────────────────────────────────────────────────────


def _emit_python(d: dict) -> str:
    blocks = [
        PY_HEADER,
        "from typing import Any",
        "",
        f"VERSION = {_dq(d['version'])}",
        "",
        f"ENUM_MAPS: dict[str, dict[str, str]] = {_py_literal(d['enum_maps'], 0)}",
        "",
        f"ENUM_DEFAULTS: dict[str, str] = {_py_literal(d['enum_defaults'], 0)}",
        "",
        f"PHASE_META: dict[str, dict[str, str]] = {_py_literal(d['phase_meta'], 0)}",
        "",
        f"PHASE_FIELDS: dict[str, dict[str, dict[str, Any]]] = {_py_literal(d['phase_fields'], 0)}",
        "",
    ]
    return "\n".join(blocks)


def _emit_zod_extensions(d: dict) -> str:
    preamble = (
        'export type ZodFieldType = "string" | "number";\n\n'
        "export interface YamlOptionalField {\n"
        "  key: string;\n"
        "  zodType: ZodFieldType;\n"
        "}\n\n"
    )
    body = (
        "export const YAML_OPTIONAL_FIELDS: Record<string, YamlOptionalField[]> = "
        + json.dumps(d["yaml_optional"], indent=2, ensure_ascii=False)
        + ";\n"
    )
    return TS_HEADER + preamble + body


def _emit_enum_normalizers(d: dict) -> str:
    part1 = (
        "export const SCHEMA_ALIASES: Record<string, Record<string, string>> = "
        + json.dumps(d["schema_aliases"], indent=2, ensure_ascii=False)
        + ";\n\n"
    )
    part2 = (
        "export const ENUM_NORMALIZERS: Record<string, Record<string, string>> = "
        + json.dumps(d["enum_normalizers"], indent=2, ensure_ascii=False)
        + ";\n"
    )
    return TS_HEADER + part1 + part2


# ─── Main ────────────────────────────────────────────────────────────────────


def main() -> None:
    data = _load_yaml()
    d = _derive(data)
    os.makedirs(GEN_DIR, exist_ok=True)

    outputs = {
        "canvas_sync_mappings.py": _emit_python(d),
        "frontend-zod-extensions.ts": _emit_zod_extensions(d),
        "frontend-enum-normalizers.ts": _emit_enum_normalizers(d),
    }
    for fname, content in outputs.items():
        path = os.path.join(GEN_DIR, fname)
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)
        print(f"  [wrote] {path}  ({len(content)} bytes)")

    print(f"\n[ok] regenerated {len(outputs)} files from pipeline-field-map.yaml")
    print("     verify with: git diff -- schema/generated/")


if __name__ == "__main__":
    main()
