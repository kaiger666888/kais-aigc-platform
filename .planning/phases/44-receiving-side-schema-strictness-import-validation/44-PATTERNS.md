# Phase 44: Receiving-side Schema Strictness + Import Validation - Pattern Map

**Mapped:** 2026-07-16
**Files analyzed:** 6 (3 modify, 1 create, 1 regenerate, 1 no-code-change verification)
**Analogs found:** 6 / 6 (every file has a real analog in the codebase or sibling repo)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `schema/pipeline-field-map.yaml` | schema-declaration (source of truth) | YAML → 3 generated consumers | itself (gap closure — add missing v2.0 keys under existing phase sections) | exact (modify in place) |
| `schema/generated/frontend-zod-extensions.ts` | generated artifact | generator output (regenerate, do not hand-edit) | `schema/generated/frontend-enum-normalizers.ts` (same generator, same header banner) | exact |
| `src/lib/canvasAssetSchema.ts` | validation-logic (zod schema + export map) | schema consumed by routes + (newly) import path | itself lines 37-49 (`withYamlOptional`) + `_manifest.py:64-74` (Python map to mirror) | exact |
| `src/routes/canvas/v2/import-from-dir.ts` | route-handler logic (tree builder) | manifest JSON → params flatten → artData mutation | itself lines 437-443 (params flatten) + lines 661-666 (enum normalize — same post-mutation hook point) | exact |
| `src/routes/canvas/v2/nodes.ts` | route-handler (batch validation) | request → validateNodeData → 400 | itself lines 121-132 (NO code change, just inherits tightened schema) | exact (no edit) |
| `scripts/verify-schema-roundtrip.ts` | standalone test script | read fixtures → replay logic → assert → exit code | `scripts/verify-phase-41.ts` (full standalone tsx pattern) | exact |

## Pattern Assignments

### `schema/pipeline-field-map.yaml` (schema declaration, source of truth)

**Analog:** itself — file already exists with the exact shape; gap closure adds entries under existing phase sections.

**Header banner** (lines 1-3 — DO NOT MODIFY):
```
# pipeline-field-map.yaml — Single Source of Truth
# All three consumers (canvas_sync.py, import-from-dir.ts, canvasAssetSchema.ts)
# MUST be generated from this file. Manual edits to generated files are forbidden.
```

**Gap-closure entries to add (per RESEARCH.md gap table):**
- `era` — under p04/p07 asset fields (currently only in the hard-coded `extra` allowlist at `import-from-dir.ts:413`, NOT in YAML)
- `genre`, `tone`, `total_duration_sec` — under p01 script fields (Python `PHASE_REQUIRED_FIELDS["script","p01:topic-kernel"]` per `_manifest.py:130`)
- verify `role` has its own canvas_key (Python maps `role` → `archetype` via `derive_archetype`; if UI expects both, declare `role` separately)

**Reusable rule:** Anything added here is auto-injected as an optional zod field by `withYamlOptional()` — DO NOT also hand-code it in `canvasAssetSchema.ts` base objects (silent no-op per RESEARCH Pitfall 1, `withYamlOptional` line 45 `if (existing.includes(f.key)) continue`).

**Regeneration command (mandatory after edit):**
```
python schema/generate_mappings.py
```
Emits THREE consumer files; all three must be committed together (RESEARCH Pitfall 5).

---

### `schema/generated/frontend-zod-extensions.ts` (generated — regenerate only)

**Analog:** `schema/generated/frontend-enum-normalizers.ts` (same generator `schema/generate_mappings.py`, same header banner pattern).

**File header** (lines 1-2 — proof it's auto-generated):
```typescript
// AUTO-GENERATED from pipeline-field-map.yaml — DO NOT EDIT.
// Run `python schema/generate_mappings.py` to regenerate.
```

**Shape consumed by `canvasAssetSchema.ts:19,41`** (lines 4-11):
```typescript
export type ZodFieldType = "string" | "number";
export interface YamlOptionalField { key: string; zodType: ZodFieldType; }
export const YAML_OPTIONAL_FIELDS: Record<string, YamlOptionalField[]> = {
  "script": [ { "key": "hookType", "zodType": "string" }, ... ],
  ...
};
```

**Action:** No hand edits. Run the generator, commit the diff. Verify `era`, `genre`, `tone`, `total_duration_sec` appear in the regenerated output.

---

### `src/lib/canvasAssetSchema.ts` (validation logic — zod + new export map)

**Analog:** itself (existing patterns) + `_manifest.py:64-74` (Python contract to mirror).

#### Pattern A — Existing `withYamlOptional()` augmentation (lines 37-49)

This is the canonical way optional fields are declared. Phase 44 extends the YAML; this function does the rest:

```typescript
function withYamlOptional<T extends z.ZodObject<any>>(
  baseType: string,
  base: T,
): z.ZodObject<any> {
  const extras = YAML_OPTIONAL_FIELDS[baseType] || [];
  const existing = Object.keys(base.shape);
  const toAdd: Record<string, z.ZodTypeAny> = {};
  for (const f of extras) {
    if (existing.includes(f.key)) continue;  // ← Pitfall 1: silent skip if also hand-coded
    toAdd[f.key] = f.zodType === "number" ? z.number().optional() : z.string().optional();
  }
  return Object.keys(toAdd).length ? base.extend(toAdd) : base;
}
```

#### Pattern B — NEW `EXPECTED_PARAM_FIELDS_BY_TYPE` map (mirror of `_manifest.py:64-74`)

Insert as a new export. This is the explicit map RESEARCH.md recommends over zod introspection (avoids fragility, preserves required-vs-expected intent). **Baseline-only** per RESEARCH Pitfall 3 — phase-specific adds stay source-side.

**Source to mirror** (`_manifest.py:64-74`, the Python contract):
```python
MANIFEST_PARAM_SCHEMA: dict[str, set[str]] = {
    "video": {"shot_id", "engine", "duration_sec", "resolution"},
    "audio": {"shot_id", "engine", "duration_sec"},
    "storyboard": {"shot_id", "shot_type", "duration_sec"},
    "asset": {"label"},
    "script": {"label"},
    "reference": set(), "zone": set(), "phase": set(), "suggestion": set(),
}
```

**TS mirror to add:**
```typescript
export const EXPECTED_PARAM_FIELDS_BY_TYPE: Record<string, string[]> = {
  video:      ["shot_id", "engine", "duration_sec", "resolution"],
  audio:      ["shot_id", "engine", "duration_sec"],
  storyboard: ["shot_id", "shot_type", "duration_sec"],
  asset:      ["label"],
  script:     ["label"],
  reference: [], zone: [], phase: [], suggestion: [],
};
```

**Existing exports to preserve unchanged:**
- `assetDataSchemas` (lines 51-119) — only grows via YAML regeneration, NOT direct edits
- `validateNodeData()` (lines 133-158) — consumed by `nodes.ts:67,123`; NO signature change
- `validateGraphNodes()` (lines 164-177) — unchanged

**Import unchanged:** `import { YAML_OPTIONAL_FIELDS } from "../../schema/generated/frontend-zod-extensions";` (line 19) — the regenerated file flows in automatically.

---

### `src/routes/canvas/v2/import-from-dir.ts` (route handler — `__incomplete` stamping)

**Analog:** itself lines 661-666 (the existing post-`artData`-build hook point — enum normalization block — establishes exactly where Phase 44's stamping plugs in).

#### Pattern A — Existing params-flatten (lines 437-443, DO NOT MODIFY — this is what `verify-schema-roundtrip.ts` replays)

```typescript
if (item.params && typeof item.params === "object" && !Array.isArray(item.params)) {
  for (const [pk, pv] of Object.entries(item.params as Record<string, unknown>)) {
    if (pv == null) continue;
    if (typeof pv === "string" || typeof pv === "number" || typeof pv === "boolean") {
      if (!(pk in extra)) extra[pk] = pv;
    }
  }
}
```

#### Pattern B — Existing post-mutation hook point (lines 661-666 — INSERT NEW BLOCK AFTER THIS)

The enum-normalization block at lines 661-666 is the established pattern for "iterate over `artData` at end of per-artifact build." Phase 44's completeness check plugs in immediately after it (before the storyboard E-Konte derivation at line 668):

```typescript
// Existing (lines 661-666) — the precedent for post-build artData mutation:
for (const [field, mapping] of Object.entries(ENUM_NORMALIZERS)) {
  const val = artData[field];
  if (typeof val === "string" && mapping[val] && val !== mapping[val]) {
    artData[field] = mapping[val];
  }
}
```

**New block to insert after line 666 (per RESEARCH.md):**
```typescript
// ── Phase 44: completeness check against expected params ──────────
const expected = EXPECTED_PARAM_FIELDS_BY_TYPE[def.canvasType] || [];
if (expected.length > 0) {
  const missing = expected.filter((f) => artData[f] == null || artData[f] === "");
  if (missing.length > 0) {
    artData.__incomplete = true;
    artData.__missing_fields = missing;
    console.warn(
      `[v2/import] node ${nodeId} (${def.canvasType}) missing fields:`,
      missing.join(", "),
    );
  }
}
```

**Import to add** (top of file, alongside existing line 16):
```typescript
import { EXPECTED_PARAM_FIELDS_BY_TYPE } from "@/lib/canvasAssetSchema";
```
(or relative path mirroring line 16's `../../../../schema/...` style — verify which alias `@` resolves to in this file; `nodes.ts:3,15` uses `@/lib/...` so prefer that).

#### Pattern C — Existing logger convention (lines 1247, 1250, 1392)

```typescript
console.warn("[import-from-dir] Failed to create oss symlink (non-fatal):", (symlinkErr as Error).message);
console.error("[v2/canvas/import-from-dir] 导入失败:", err);
```
**Convention:** `console.warn("[v2/import] <context>:", detail)` — NO dedicated logger instance (per RESEARCH "Logger pattern"). The new warn uses prefix `[v2/import]` to match the sibling convention.

**Anti-patterns to avoid in this file:**
- Do NOT wrap the completeness check in `try { ... } catch { /* skip */ }` (RESEARCH anti-pattern: Phase 42 banned `except: pass`; the `nodes.ts:138-140` skip is thumbnail-only, not schema validation)
- Do NOT compute `missing` against `PHASE_REQUIRED_FIELDS` — baseline only (RESEARCH Pitfall 3: over-constrains 689 historical rows)
- Do NOT overwrite `artData.description` from `params.description` (RESEARCH Pitfall 2: top-level precedence already wins via the `!(pk in extra)` guard at line 441 — leave as-is)

---

### `src/routes/canvas/v2/nodes.ts` (route handler — NO CODE CHANGE)

**Analog:** itself lines 121-132 — the existing whole-batch validate-then-reject pattern. Phase 44 does NOT touch this file; tightening is emergent from the schema expansion in `canvasAssetSchema.ts`.

**Pattern for reference (unchanged, lines 121-132):**
```typescript
const validationErrors: Array<{ nodeId: string; errors: string }> = [];
for (const nodeInput of nodeInputs) {
  const err = validateNodeData(nodeInput.type, nodeInput.data || {});
  if (err) validationErrors.push({ nodeId: nodeInput.id, errors: err });
}
if (validationErrors.length > 0) {
  const details = validationErrors.map((e) => `node "${e.nodeId}": ${e.errors}`);
  return res.status(400).send(error(
    "批量节点结构化参数校验失败 — 整批已拒绝",
    details,
  ));
}
```

**Why no edit:** `validateNodeData` reads `assetDataSchemas` (which now has more optional fields via YAML regen). Required fields didn't change, so historical 689 rows still pass; new fields just become visible to IDE tooltips and forward-compat round-trip.

**Verify (`verify-schema-roundtrip.ts` SCHEMA-04):** statically assert `nodes.ts` still contains `validateNodeData(nodeInput.type` and the `整批已拒绝` 400 return — proves the batch-validation contract is wired.

---

### `scripts/verify-schema-roundtrip.ts` (standalone test script — NEW)

**Analog:** `scripts/verify-phase-41.ts:1-40` — the canonical standalone-tsx verify pattern (project precedent per STATE.md Pitfalls B3/B4: "No project test framework").

#### Pattern A — Standalone tsx skeleton (`verify-phase-41.ts:1-36`)

```typescript
#!/usr/bin/env tsx
/**
 * verify-phase-41.ts — Phase 41 verification.
 * ...purpose docstring...
 * Run: npx tsx scripts/verify-phase-41.ts
 */

import fs from "node:fs";
import path from "node:path";

interface TestResult { name: string; pass: boolean; detail?: string; }
const results: TestResult[] = [];
function assert(cond: boolean, name: string, detail?: string): void {
  results.push({ name, pass: cond, detail });
  console.log(`  ${cond ? "PASS" : "FAIL"}: ${name}${detail ? " — " + detail : ""}`);
}

const REPO_ROOT = path.resolve(__dirname, "..");
function read(rel: string): string {
  const p = path.join(REPO_ROOT, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
}
```

#### Pattern B — Sectioned assertions + exit code (`verify-phase-41.ts:38-46`)

```typescript
async function main(): Promise<void> {
  console.log("=== Phase 41 — verify-phase-41.ts ===\n");

  // ─── SYNC-01: kv_canvasEvent table ────────────────────────────
  console.log("=== SYNC-01: kv_canvasEvent table declared ===");
  const initDB = read("src/lib/initDB.ts");
  assert(initDB.includes('name: "kv_canvasEvent"'), "kv_canvasEvent table declared");
  // ...
}
```

**Apply to Phase 44's 4 assertion sections (SCHEMA-01..04):**
- **SCHEMA-01:** `read("src/lib/canvasAssetSchema.ts")` + `read("schema/generated/frontend-zod-extensions.ts")`, assert each v2.0 field (`era`, `genre`, `tone`, `total_duration_sec`, `archetype`, `role`, `murch_grade`, `shot_type`) appears in one of the two files
- **SCHEMA-02:** `read("src/routes/canvas/v2/import-from-dir.ts")`, assert it contains `__incomplete`, `__missing_fields`, `EXPECTED_PARAM_FIELDS_BY_TYPE`, and `[v2/import]` warn prefix
- **SCHEMA-03:** load fixture JSON (cross-repo `kais-hermes-skills/.../tests/fixtures/manifests/p*.json`, fallback in-repo `scripts/fixtures/`), replay the params-flatten logic, assert every scalar `params.*` key appears in the flattened output (consulting `SCHEMA_ALIASES` for renames like `role` → `archetype`)
- **SCHEMA-04:** `read("src/routes/canvas/v2/nodes.ts")`, assert `validateNodeData(nodeInput.type` and `整批已拒绝` are present (proves batch-validation contract intact)

#### Pattern C — Cross-repo fixture loading (RESEARCH.md `verify-schema-roundtrip.ts` skeleton)

```typescript
const SIBLING_FIXTURES = path.resolve(
  __dirname,
  "../../kais-hermes-skills/skills/kais-movie-pipeline/tests/fixtures/manifests",
);
const INREPO_FIXTURES = path.resolve(__dirname, "fixtures");
const fixtureDir = fs.existsSync(SIBLING_FIXTURES) ? SIBLING_FIXTURES : INREPO_FIXTURES;
```

**Verified fixture shape** (`p04.json` — confirmed sibling fixtures exist):
```json
{
  "phase_id": "p04_character_design",
  "phase": "p04",
  "nodes": [
    {
      "id": "p04/char-mikan",
      "type": "asset",
      "label": "角色 小橘",
      "params": {
        "label": "角色 小橘",
        "archetype": "protagonist",
        "role": "main character",
        "description": "主角 · protagonist · 红发少年 · 热血型"
      },
      "phase": "p04"
    }
  ],
  "edges": []
}
```
Available sibling fixtures: `p01.json, p02.json, ..., p10.json` (confirmed via `ls`).

**Exit code contract** (`verify-phase-41.ts` pattern, RESEARCH skeleton lines 404-407):
```typescript
const passed = results.filter((r) => r.pass).length;
const failed = results.filter((r) => !r.pass).length;
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
```

**Shebang + invocation:**
- Line 1: `#!/usr/bin/env tsx`
- Run command: `npx tsx scripts/verify-schema-roundtrip.ts`
- Wire into `package.json` scripts alongside the existing `verify-phase-*` entries (per STATE.md Pitfalls B3/B4 — planner should check `package.json` to mirror the registration pattern)

**Anti-patterns to avoid:**
- Do NOT use vitest/jest (RESEARCH "Don't Hand-Roll" — no test framework exists)
- Do NOT hard-code `EXPECTED_PARAM_FIELDS_BY_TYPE` in the test — import it from `canvasAssetSchema.ts` so drift fails the test (RESEARCH Pitfall: "Hard-coding from memory")
- Do NOT assert `params.description` survives under key `description` without consulting `SCHEMA_ALIASES` (RESEARCH Pitfall 2: top-level description may shadow it)

## Shared Patterns

### Logger Convention (`console.warn` with `[v2/<route>]` prefix)
**Source:** `src/routes/canvas/v2/nodes.ts:84,93,158`; `src/routes/canvas/v2/import-from-dir.ts:1247,1250,1392`
**Apply to:** All new `console.warn` / `console.error` calls in Phase 44
```typescript
console.warn("[v2/canvas/nodes] 缩略图生成失败，继续:", thumbErr);
console.error("[v2/canvas/nodes/batch] 批量操作失败:", err);
console.warn("[import-from-dir] Failed to create oss symlink (non-fatal):", ...);
```
**Format:** `console.<level>("[v2/<route>] <context>:", <detail>)` — no dedicated logger instance; `src/logger.ts` is a console-hijacker that redirects streams to a file.

### Generator-Driven Single Source of Truth
**Source:** `schema/pipeline-field-map.yaml` header (lines 1-3) + `schema/generate_mappings.py`
**Apply to:** ANY new optional field in Phase 44
**Rule:** Add to YAML → run `python schema/generate_mappings.py` → commit YAML + all 3 generated files (`canvas_sync_mappings.py`, `frontend-enum-normalizers.ts`, `frontend-zod-extensions.ts`) in ONE commit. Never hand-edit generated files (RESEARCH Pitfall 5).

### Per-Type Schema + Validation Export Trio
**Source:** `src/lib/canvasAssetSchema.ts:51,133,164`
**Apply to:** Phase 44's new `EXPECTED_PARAM_FIELDS_BY_TYPE` export (joins the existing trio)
```typescript
export const assetDataSchemas: Record<string, z.ZodSchema> = { ... };  // line 51
export function validateNodeData(nodeType, data): string | null { ... }  // line 133
export function validateGraphNodes(nodes): Array<{...}> { ... }  // line 164
// NEW in Phase 44:
export const EXPECTED_PARAM_FIELDS_BY_TYPE: Record<string, string[]> = { ... };
```

### Batch Validate-Then-Reject (400 with full error list)
**Source:** `src/routes/canvas/v2/nodes.ts:121-132`
**Apply to:** No new code — Phase 44 inherits via schema expansion
```typescript
const validationErrors: Array<{ nodeId: string; errors: string }> = [];
for (const nodeInput of nodeInputs) {
  const err = validateNodeData(nodeInput.type, nodeInput.data || {});
  if (err) validationErrors.push({ nodeId: nodeInput.id, errors: err });
}
if (validationErrors.length > 0) {
  const details = validationErrors.map((e) => `node "${e.nodeId}": ${e.errors}`);
  return res.status(400).send(error("批量节点结构化参数校验失败 — 整批已拒绝", details));
}
```

## No Analog Found

None. Every file in Phase 44 has an exact analog — the work is gap closure and wiring, not greenfield architecture (per RESEARCH.md "Key insight").

## Metadata

**Analog search scope:**
- `/data/workspace/kais-aigc-platform/src/lib/canvasAssetSchema.ts` (full read)
- `/data/workspace/kais-aigc-platform/src/routes/canvas/v2/nodes.ts:1-210`
- `/data/workspace/kais-aigc-platform/src/routes/canvas/v2/import-from-dir.ts` (key sections: 1-60 imports, 400-450 params flatten, 530-680 tree builder + post-mutation hook)
- `/data/workspace/kais-aigc-platform/scripts/verify-phase-41.ts:1-80`
- `/data/workspace/kais-aigc-platform/scripts/` (listed: `verify-phase-{21,23,28-34,39,41}.ts` + `verify-canvas-resync.ts` — confirms standalone-tsx precedent)
- `/data/workspace/kais-aigc-platform/schema/pipeline-field-map.yaml:1-80`
- `/data/workspace/kais-aigc-platform/schema/generated/frontend-zod-extensions.ts:1-50`
- `/data/workspace/kais-hermes-skills/skills/kais-movie-pipeline/pipeline/phases/_manifest.py:1-160` (contract to mirror)
- `/data/workspace/kais-hermes-skills/skills/kais-movie-pipeline/tests/fixtures/manifests/p04.json` (sample fixture shape; `p01-p10.json` confirmed available)

**Files scanned:** 9 primary + 2 sibling-repo
**Pattern extraction date:** 2026-07-16
