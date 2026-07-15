# Phase 44: Receiving-side Schema Strictness + Import Validation - Context

**Gathered:** 2026-07-16
**Status:** Ready for planning
**Mode:** Auto-generated (infrastructure phase — discuss skipped per smart-discuss spec, mirrors Phase 42/43 pattern)
**Repo:** `kais-aigc-platform`
**Depends on:** Phase 42 (mirrors field set declared there)

<domain>
## Phase Boundary

The third v2.0 phase. The receiving side (`kais-aigc-platform`) declares a complete schema that **mirrors the v2.0 manifest contract** hardened in Phase 42 (`_manifest.py` `MANIFEST_PARAM_SCHEMA` + `PHASE_REQUIRED_FIELDS`). `import-from-dir.ts` then validates incoming manifests and **warns + flags incomplete nodes** instead of silently dropping fields.

This phase is the receiving-side counterpart to Phase 42's source-side hardening. Together they form the symmetric contract that Phase 46's E2E round-trip test will enforce.

**Boundary lines:**
- IN: `canvasAssetSchema.ts` v2.0 field-set declaration, `import-from-dir.ts` `__incomplete` stamping + warn logging, `PATCH /nodes/batch` schema-tightening, `scripts/verify-schema-roundtrip.ts`
- OUT: Text asset mapping UI (Phase 45), cross-repo E2E contract tests (Phase 46), historical backfill (Phase 47), canvas_sync.py source-side work (Phases 42/43)

</domain>

<decisions>
## Implementation Decisions

### Source of Truth — Phase 42 manifest contract (MUST mirror)

Phase 42 established the canonical v2.0 field set in `_manifest.py`:

| Node type | Required baseline | Phase-specific adds |
|-----------|-------------------|---------------------|
| video | `shot_id, engine, duration_sec, resolution` | — |
| audio | `shot_id, engine, duration_sec` | — |
| storyboard | `shot_id, shot_type, duration_sec` | — |
| asset | `label` | p04: `archetype, role` |
| script | `label` | p01:topic-kernel: `genre, tone, total_duration_sec`; p03:script: `mcmahon_arc` |
| reference/zone/phase/suggestion | (none — structural) | — |

Optional fields (from `schema/pipeline-field-map.yaml`) include: `archetype, role, era, scene_id, shot_id, engine, duration_sec, resolution, murch_grade, codec, thumbnailUrl, text, clip_type, scene_ref, views, style_vector, turnaround_path, prompt, description, assetType, score, content` and others.

Phase 44's `canvasAssetSchema.ts` MUST declare all of these as optional zod fields (forward-compat) so manifests carrying extra structured params pass validation without silent loss.

### Claude's Discretion — Pragmatic Scope

Per the user's "一劳永逸" intent for v2.0:

1. **`canvasAssetSchema.ts` extension strategy** — leverage existing `withYamlOptional()` augmentation. If `pipeline-field-map.yaml` already lists the field, `withYamlOptional` auto-injects it as optional. The work is mostly **gap analysis** (verify all v2.0 fields are declared) + **explicit optional declaration for undocumented fields** (e.g. `murch_grade`, `era`, `archetype`, `role` may need to be promoted into base per-type schemas so they're visible in IDE tooltips, not just YAML-driven).
2. **`import-from-dir.ts` warning behavior** — use existing logger pattern (`logger.warn` is already imported). Compute expected-field set from manifest params vs schema; missing fields emit `[v2/import] node X missing fields: [...]` and stamp `node.data.__incomplete = true` AND `node.data.__missing_fields = [...]` so UI can flag (deferred to Phase 45).
3. **`PATCH /nodes/batch` tightening** — the 2026-07-12 baseline already enforces per-type schemas via `validateNodeData` and returns 400 with full error list. Phase 44's work is **field-set alignment with Phase 42**: ensure the per-type schemas in `canvasAssetSchema.ts` include every Phase-42-required field. No new validation framework — just expand the existing one to mirror the source-side contract.
4. **`scripts/verify-schema-roundtrip.ts` design** — a standalone Node script (not a vitest test, to allow CLI invocation in CI). Loads a sample manifest JSON (one per type, ideally fixtures from Phase 42 if accessible cross-repo), runs the import path's field-mapping logic, then asserts every `params.*` key appears in the resulting `node.data`. Exit 0 = pass, exit 1 = fail with diff.

### Hard Rules (must hold)

- **No silent field drop** — every `params.*` key in an incoming manifest MUST end up in `node.data` (either as a recognized field or as `data.__extra.<key>` overflow).
- **Forward-compatible** — unknown future fields don't break the import; they round-trip into `__extra` and the schema's optional declarations grow over time.
- **No `except: pass` swallowing** — Phase 42 banned this on the source side; the receiving side must follow.
- **Backward-compatible with 689 historical nodes** — existing rows that lack the new optional fields must still load (optionals, not requireds).

</decisions>

<code_context>
## Existing Code Insights

### Reusable assets — receiving side (`kais-aigc-platform`)

- `src/lib/canvasAssetSchema.ts:51` — `assetDataSchemas` record already enforces per-type requireds via zod; `withYamlOptional()` auto-augments from `pipeline-field-map.yaml`.
- `src/lib/canvasAssetSchema.ts:133` — `validateNodeData()` returns error string or null; called from `PATCH /nodes/batch` (line 122-132).
- `src/lib/canvasAssetSchema.ts:164` — `validateGraphNodes()` for full-graph validation.
- `src/routes/canvas/v2/nodes.ts:99-162` — `PATCH /nodes/batch` already validates whole-batch + returns 400 with full error list. Baseline = 2026-07-12 quick-task work.
- `src/routes/canvas/v2/import-from-dir.ts` — 53KB / ~1500 lines; the import path that needs `__incomplete` stamping.
- `schema/pipeline-field-map.yaml` — single source of truth for optional fields across all three consumers.
- `schema/generated/frontend-zod-extensions.ts` — generated zod augmentations consumed by `canvasAssetSchema.ts:withYamlOptional`. Regenerate via `python schema/generate_mappings.py`.

### Reusable assets — source side (`kais-hermes-skills`, Phase 42 output)

- `kais-hermes-skills/skills/kais-movie-pipeline/pipeline/phases/_manifest.py:64` — `MANIFEST_PARAM_SCHEMA` (the contract to mirror).
- `kais-hermes-skills/skills/kais-movie-pipeline/pipeline/phases/_manifest.py:126` — `PHASE_REQUIRED_FIELDS` (phase-specific adds to mirror).
- `kais-hermes-skills/skills/kais-movie-pipeline/tests/fixtures/manifests/p01..p14.json` — Phase 42's golden fixtures; `verify-schema-roundtrip.ts` should ideally consume one of these as the sample manifest (cross-repo path).

### Established Patterns

- `validateNodeData()` per-node-then-aggregate-errors pattern is the precedent — `import-from-dir.ts` should mirror it for completeness checks.
- `withYamlOptional()` is the canonical way to declare optional fields — prefer extending `pipeline-field-map.yaml` over hand-coding `.optional()` in zod schemas.
- Logger pattern: `logger.warn("[v2/<route>] <context>", { fields... })` — already used throughout `src/routes/canvas/v2/`.

### Integration Points

- Frontend: `NodeDetailPanel` will consume `data.__incomplete` + `data.__missing_fields` in Phase 45 — receiver-side just needs to stamp them now.
- E2E: `scripts/verify-schema-roundtrip.ts` will be wired into Phase 46's CI gate.
- DB: existing rows must continue to validate — optionals only, no new requireds for historical data.

### Pre-existing uncommitted state (per git status)

- `M src/lib/canvasRelationalStore.ts` — pre-existing work, independent of Phase 44.
- `M packages/infinite-canvas/src/components/FlowCanvas.tsx` — pre-existing work, independent of Phase 44.
- New `?? src/routes/canvas/v2/thumbnail/`, `?? src/lib/thumbnail.ts`, etc. — Phase 43 leftover, not Phase 44 scope.

Phase 44 stacks on top of the committed Phase 42/43 baseline (`cb9baaeb` / `267c5b7b` are the recent commits per git log).

</code_context>

<specifics>
## Specific Ideas

No specific requirements beyond ROADMAP success criteria 1-4. Implementation choices deferred to planner + research:

1. **Where to compute "expected fields" for `import-from-dir.ts` warnings** — options: (a) re-derive from `assetDataSchemas` shape via zod introspection; (b) declare an explicit `EXPECTED_FIELDS_BY_TYPE` map in `canvasAssetSchema.ts` as the single source of truth; (c) import `pipeline-field-map.yaml` directly. Research should pick the cleanest one.
2. **`__incomplete` vs `__missing_fields` vs `__extra` stamping** — what's the minimum viable set the import path needs to populate now so Phase 45's UI can render correctly?
3. **`verify-schema-roundtrip.ts` sample manifest source** — hand-roll a fixture in-repo, or reach cross-repo to `kais-hermes-skills/.../tests/fixtures/manifests/`? Cross-repo is more truthful but couples the test path. Hand-rolled is simpler but risks drift.

</specifics>

<deferred>
## Deferred Ideas

- **Frontend rendering of `__incomplete` flag** — Phase 45 (Text Asset Mapping + UI Completeness).
- **Cross-repo E2E contract test in CI** — Phase 46.
- **Backfilling 689 historical rows** — Phase 47.
- **`pipeline-field-map.yaml` → `_manifest.py` reverse-sync** — currently a one-way contract (Python declares, TS mirrors). A bidirectional generator could close the loop but is out of scope; manual sync is fine for v2.0.

</deferred>

<scope_fence>
## Out of Scope

- **Python source-side manifest changes** — Phase 42 (done) and Phase 43 (done) territory.
- **`canvas_sync.py` cleanup** — Phase 43 (done).
- **UI / NodeDetailPanel rendering of incompleteness** — Phase 45.
- **CI workflow YAML for running `verify-schema-roundtrip.ts`** — Phase 46.
- **Migration / backfill of historical data** — Phase 47.
- **New node types** — only mirror what Phase 42 declared (`video/audio/storyboard/asset/script/reference/zone/phase/suggestion`).

</scope_fence>
