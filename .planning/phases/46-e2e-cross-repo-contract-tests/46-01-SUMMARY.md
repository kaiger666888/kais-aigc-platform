---
phase: 46-e2e-cross-repo-contract-tests
plan: 01
wave: 1
requirements: [VERIFY-01, VERIFY-02, VERIFY-04]
status: complete
commits:
  - "ed4f3142 feat(46-01): add cross-repo manifest + import-roundtrip verify scripts"
  - "bdf3e9c4 feat(46-01): add schema-drift verifier + wire verify:phase-46-contracts"
key-files:
  created:
    - scripts/verify-manifest-contract.ts
    - scripts/verify-import-roundtrip.ts
    - scripts/verify-schema-drift.ts
  modified:
    - scripts/fixtures/sample-manifest.json
    - package.json
---

# 46-01 — Safe-tier Contract Verify Scripts

## What was built

Three standalone tsx scripts that anchor the Phase 46 regression gate.
All docker-free, all CI-runnable, all under 5 seconds.

### VERIFY-01 (`verify-manifest-contract.ts`)

Spawns `python3 -m pytest` cross-repo against Phase 42's 132-test
source-side manifest contract suite:

- `test_manifest_schema.py` (77 tests)
- `test_manifest_phase_required.py` (11 tests)
- `test_manifest_golden.py` (44 tests)

Exits 0 in 0.43s when green. Gated by `KAIS_HERMES_SKILLS_PATH` env
var (default `/data/workspace/kais-hermes-skills`). Three pre-flight
checks: sibling repo exists, all 3 test files exist, `python3` on PATH.

### VERIFY-02 (`verify-import-roundtrip.ts`)

Loads the in-repo fallback fixture + 14 cross-repo Phase 42 fixtures.
For each node with params:
1. Imports the production `flattenParamsToNodeData` helper from
   `src/routes/canvas/v2/import-from-dir` (Phase 44 export)
2. Replays it against a fresh accumulator seeded with top-level fields
3. Asserts every scalar `params.*` key survives into the flattened output
4. For content-bearing types (asset/script/storyboard/video), asserts
   `description.length ≥ 20` (Phase 42 MIN_DESCRIPTION_LEN)

**Caught a real fixture gap this session:** the Phase 45 fallback
fixture had 3 nodes without contract-compliant descriptions. Fixed in
the same commit — the verify script caught the regression before
Phase 47 backfill could depend on broken data.

### VERIFY-04 (`verify-schema-drift.ts`)

Regex-parses both schema literals from source files:
- Python: `MANIFEST_PARAM_SCHEMA` dict literal in `_manifest.py:64-74`
- TS: `EXPECTED_PARAM_FIELDS_BY_TYPE` object literal in `canvasAssetSchema.ts`

For each of the 9 node types, asserts the field sets match. Any drift
(Phase 42 changes Python without updating TS, or vice versa) fails
loudly. Per CONTEXT.md D3, regex was chosen over AST for simplicity —
sufficient for the stable dict shape.

### Master chain (`verify:phase-46-contracts`)

`npm run verify:phase-46-contracts` runs all 3 in sequence:
- VERIFY-01: 1 assertion (132-test suite green)
- VERIFY-02: 51 assertions (24 content-bearing × 2 + 25 round-trip + 2 summary)
- VERIFY-04: 10 assertions (9 type-pair drift checks + summary)

Total: 62 assertions; runtime ~1.5s. CI-safe — no docker, no GPU,
no network beyond sibling-repo filesystem.

## Notable deviations from PLAN

- **Fixture fix mid-execution:** PLAN didn't anticipate that the
  Phase 45 fixture would fail the description ≥20 assertion. The
  verify script caught it; the executor fixed the fixture in the same
  commit (3 description lines added). This is exactly the regression
  detection the gate is designed for.

- **VERIFY-04 empty-set handling:** the regex initially missed Python's
  `set()` form. Reworked to handle both `{}` and `set()` patterns.
  Documented inline.

## Verification

```
Phase 46 master chain: 62 assertions pass across 3 scripts in ~1.5s
  VERIFY-01: 1 passed
  VERIFY-02: 51 passed (after fixture fix)
  VERIFY-04: 10 passed
Phase 44 regression: 41 passed
Phase 45 regression: 13 passed
tsc: 3 baseline pre-existing errors, 0 new
```

## Forward enables

- **Phase 47** backfill can run `npm run verify:phase-46-contracts`
  before `--apply` to confirm the contract is intact.
- **CI integration** (future DevOps task): master chain is the safe
  entry point for GitHub Actions / similar.
- **Cross-repo drift detection** now automated — Phase 42 + 44
  schemas can't silently diverge.
