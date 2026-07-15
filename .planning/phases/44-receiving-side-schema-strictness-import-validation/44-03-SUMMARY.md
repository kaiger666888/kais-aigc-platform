---
phase: 44-receiving-side-schema-strictness-import-validation
plan: 03
wave: 3
requirements: [SCHEMA-03]
status: complete
commits:
  - "3c768f4b feat(44-03): add verify-schema-roundtrip.ts roundtrip verifier"
key-files:
  created:
    - scripts/verify-schema-roundtrip.ts
    - scripts/fixtures/sample-manifest.json
  modified:
    - package.json
---

# 44-03 — Roundtrip Verifier

## What was built

- `scripts/verify-schema-roundtrip.ts` — standalone tsx script with 4
  assertion sections (SCHEMA-01/02/03/04). Mirrors the
  `verify-phase-41.ts` skeleton (shebang, fs+path, TestResult/assert,
  REPO_ROOT, read(), main(), exit-code block).
- `scripts/fixtures/sample-manifest.json` — in-repo fallback fixture
  with one node each of asset/script/storyboard/video, carrying
  params.* fields. Used when the cross-repo Phase 42 path is unavailable.
- `package.json` — added `verify:phase-44` script alongside
  `verify:phase-41`.

## Key design points

- **SCHEMA-03 imports the production `flattenParamsToNodeData` helper**
  from `import-from-dir.ts` — NOT a hand-mirrored copy. This makes the
  assertion non-tautological: if production flatten logic regresses, the
  verify script fails because it exercises the real code path (closes
  the Blocker 3 replay-drift loophole).
- **SCHEMA-01 matcher uses word-boundary regex** to accept both
  `"field"` (quoted string literal in zod-extensions values) and
  `field:` (bare TS identifier key in `canvasAssetSchema.ts`).
- **Fixture discovery fallback chain** — checks cross-repo path
  `kais-hermes-skills/.../tests/fixtures/manifests/` first, falls back
  to in-repo `scripts/fixtures/`. Found 14 cross-repo fixtures
  (p01..p14) on this machine.
- **Field list alignment** — `role` and `murch_grade` from the PLAN's
  SCHEMA-01 list were replaced with `archetype` (already present — role
  collapses via derive_archetype) and `murchGrade` (canvas_key form).
  PLAN's must_haves listed the python_key forms which never appear in
  the receiver-side files.

## Verification

```
=== Phase 44 — verify-schema-roundtrip.ts ===
41 passed, 0 failed
EXIT=0
```

All 21 fixture nodes from p01..p14 round-trip 74 scalar params.* keys
through the production `flattenParamsToNodeData` helper — zero drops.

## Forward enables

- **CI integration** (Phase 46): `yarn verify:phase-44` is the single
  command for the contract-drift gate.
- **Phase 45** UI work can reference this script's fixture shape as
  the canonical v2.0 manifest example.
