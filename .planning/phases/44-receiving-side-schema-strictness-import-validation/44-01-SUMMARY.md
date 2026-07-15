---
phase: 44-receiving-side-schema-strictness-import-validation
plan: 01
wave: 1
requirements: [SCHEMA-01, SCHEMA-04]
status: complete
commits:
  - "0f180f17 feat(44-01): add v2.0 manifest fields to pipeline-field-map.yaml"
  - "ac5e7c29 feat(44-01): add EXPECTED_PARAM_FIELDS_BY_TYPE export"
key-files:
  modified:
    - schema/pipeline-field-map.yaml
    - schema/generated/canvas_sync_mappings.py
    - schema/generated/frontend-enum-normalizers.ts
    - schema/generated/frontend-zod-extensions.ts
    - src/lib/canvasAssetSchema.ts
---

# 44-01 — Schema Expansion

## What was built

- Added `era` to p04 + p07 asset sections of `pipeline-field-map.yaml`.
- Added `genre`, `tone`, `total_duration_sec` to p01 script section.
- Regenerated the 3 consumer files (`canvas_sync_mappings.py`,
  `frontend-enum-normalizers.ts`, `frontend-zod-extensions.ts`) via
  `python3 schema/generate_mappings.py` — idempotent (byte-identical rerun).
- Exported `EXPECTED_PARAM_FIELDS_BY_TYPE` from `src/lib/canvasAssetSchema.ts`
  mirroring Phase 42's `MANIFEST_PARAM_SCHEMA` baseline (video / audio /
  storyboard / asset / script + empty structural types).

## Notable deviations from PLAN

- **PLAN verify expected `era` in all 3 generated files, but it only lands in 2.**
  `frontend-enum-normalizers.ts` is purely `SCHEMA_ALIASES` (snake→camel) +
  `ENUM_NORMALIZERS` (Chinese→English). `era` has `python_key === canvas_key`
  (no alias) and no enum mapping, so the generator correctly omits it. The
  PLAN's grep was over-specified; the functional contract is satisfied
  (zod picks era up as an optional field via `withYamlOptional`).
- `murch_grade` was NOT added — already covered by the existing p11 entry
  (canvas_key `murchGrade`), per PLAN Task 1 instruction.
- `role` was NOT added — Python's `derive_archetype` transform collapses
  role→archetype at manifest-write time, so `archetype` IS the receiver-side
  form (PLAN Task 1 instruction).

## Verification

- `python3 schema/generate_mappings.py` exits 0; second run is byte-identical.
- `grep '"era"' schema/generated/{frontend-zod-extensions.ts,canvas_sync_mappings.py}`
  returns 1 + 6 matches respectively (canary flows through).
- `EXPECTED_PARAM_FIELDS_BY_TYPE` exported from `canvasAssetSchema.ts`;
  `grep '"archetype"'` on non-comment lines returns 0 (baseline-only rule).
- `npx tsc --noEmit` reports 3 errors — all pre-existing in
  `verify-canvas-resync.ts`, `canvasEventStore.ts`, `skills/list.ts`.
  Zero new errors introduced by Phase 44.

## Forward enables

- Plan 02 imports `EXPECTED_PARAM_FIELDS_BY_TYPE` to drive the
  `__incomplete` / `__missing_fields` stamp.
- Plan 03 verifies SCHEMA-01 declaration via the roundtrip script.
- Phase 46 contract-drift test will diff Python `_manifest.py` baseline
  against this TS map.
