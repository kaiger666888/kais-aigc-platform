# Phase 46: E2E + Cross-repo Contract Tests - Context

**Gathered:** 2026-07-16
**Status:** Ready for planning
**Source:** Inline planning session (skipped discuss-phase + research subagents per user preference)

<domain>
## Phase Boundary

Phase 46 is the regression gate before Phase 47 mutates historical data.
Four verify scripts that, together, prevent the canvas-sync triad from
ever returning:

- **VERIFY-01**: `kais-hermes-skills` manifest contract tests run from
  the `kais-aigc-platform` repo's verify tooling (cross-repo invocation)
- **VERIFY-02**: `scripts/verify-import-roundtrip.ts` — receiver-side
  import unit test (sample manifest → flattenParamsToNodeData →
  non-empty description + complete params round-trip)
- **VERIFY-03**: `scripts/verify-phase-46-e2e.ts` — fixture-driven E2E
  (drop a known p04 manifest → trigger canvas_sync → query
  /api/v2/canvas/nodes → assert description ≥ 20 + at least one of
  {archetype, role, era})
- **VERIFY-04**: `scripts/verify-schema-drift.ts` — diffs
  `MANIFEST_PARAM_SCHEMA` (Python) vs `EXPECTED_PARAM_FIELDS_BY_TYPE`
  (TypeScript); fails on drift

In scope:
- 4 standalone tsx scripts following the `verify-phase-NN.ts` precedent
- A master `verify:phase-46` npm script that runs the safe subset
  (VERIFY-01/02/04 — all fixture/static-driven)
- The E2E script (VERIFY-03) is env-gated (`PHASE46_RUN_E2E=1`) because
  it requires docker-compose v9 + the canvas API; documented as
  manual-only in VALIDATION.md

Out of scope:
- Adding new tests to `kais-hermes-skills` (Phase 42 already shipped
  the source-side contract tests; Phase 46 invokes them, doesn't
  extend them)
- Source-side `canvas_sync.py` cleanup (Phase 43 — shipped)
- Receiver-side schema strictness (Phase 44 — shipped)
- UI completeness (Phase 45 — shipped)
- Historical backfill (Phase 47 — gated on Phase 46 passing)

</domain>

<decisions>
## Implementation Decisions

### D1: VERIFY-01 = cross-repo pytest invocation, not test duplication

The source-side `test_manifest_schema.py` already exists (132 tests
per Phase 42 VERIFICATION). VERIFY-01's script
(`verify-manifest-contract.ts`) just spawns `python3 -m pytest` against
the sibling repo's test files and asserts exit 0. We do NOT duplicate
the test logic in TS — single source of truth.

### D2: VERIFY-02 reuses Phase 44's flattenParamsToNodeData

The Phase 44 SCHEMA-03 section of `verify-schema-roundtrip.ts` already
imports `flattenParamsToNodeData` and replays fixture manifests through
it. VERIFY-02's `verify-import-roundtrip.ts` extends this with stronger
description-non-empty assertions + a "every param survives" check
that's already proven. Rather than duplicate, VERIFY-02 layers
description-length + canary-field assertions on top of the same import.

Concrete: VERIFY-02 reads `scripts/fixtures/sample-manifest.json` (the
Phase 44 fallback fixture, which we extended in Phase 45 to cover
asset/script/storyboard/video node types) and asserts each node's
flattened output has non-empty description AND every scalar param
appears in the output.

### D3: VERIFY-04 parses Python via regex, not AST

Reading `MANIFEST_PARAM_SCHEMA` from Python source seems to call for
AST parsing. But the dict has a known, stable shape (literal set
initializers keyed by node type). A targeted regex that captures
`"type": {field, field, ...}` patterns is simpler, more readable, and
sufficiently robust. If Phase 42 ever changes the dict shape, this
test fails loudly — which is exactly the contract drift signal we want.

### D4: VERIFY-03 is fixture-driven, not full-pipeline-driven

The success criterion says "runs `p04_character_design` end-to-end."
A literal reading would require running the entire creative pipeline
(ComfyUI + LLM + every model). That's not realistic for an automated
test — it would take 10+ minutes, require GPU, and depend on network.

Instead, VERIFY-03 simulates the *output* of a p04 run by dropping a
known-good fixture manifest into a test project's OSS directory, then
triggers canvas_sync, then queries the canvas API. This tests the
**receiver-side E2E** path (manifest → canvas nodes → API response),
which is where regressions actually occur. The actual creative
pipeline is exercised by manual smoke tests + Phase 42's golden
fixtures.

### D5: VERIFY-03 env-gated; manual smoke test

`PHASE46_RUN_E2E=1` must be set for VERIFY-03 to attempt docker. The
master `verify:phase-46` npm script does NOT set this — it runs only
the safe subset (VERIFY-01/02/04). The E2E script is documented as
manual-only in VALIDATION.md.

### D6: Sibling repo path via env var

All scripts that read `/data/workspace/kais-hermes-skills/` accept a
`KAIS_HERMES_SKILLS_PATH` env var override (default:
`/data/workspace/kais-hermes-skills`). This makes the tests portable
across dev environments + CI sandboxes without code changes.

### Claude's Discretion

- Exact assertion granularity in each script — pick the smallest set
  that catches real regressions without false positives.
- Whether to log per-assertion PASS/FAIL or just summary — match the
  `verify-phase-44.ts` precedent (per-assertion PASS/FAIL for
  debuggability).
- Whether the E2E script brings down docker on success — leave it
  running on success (faster iteration); bring it down on failure
  (frees GPU memory for debugging).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 42 source-side contract (VERIFY-01 target)
- `/data/workspace/kais-hermes-skills/skills/kais-movie-pipeline/pipeline/phases/_manifest.py:64-138` — MANIFEST_PARAM_SCHEMA + PHASE_REQUIRED_FIELDS + MIN_DESCRIPTION_LEN
- `/data/workspace/kais-hermes-skills/skills/kais-movie-pipeline/tests/test_manifest_schema.py` — 77 test functions
- `/data/workspace/kais-hermes-skills/skills/kais-movie-pipeline/tests/test_manifest_phase_required.py` — 11 test functions
- `/data/workspace/kais-hermes-skills/skills/kais-movie-pipeline/tests/test_manifest_golden.py` — 44 golden-fixture cases
- `/data/workspace/kais-hermes-skills/.pre-commit-config.yaml` — pre-commit hooks

### Phase 44 receiver-side contract (VERIFY-02 + VERIFY-04 anchor)
- `src/lib/canvasAssetSchema.ts` — `EXPECTED_PARAM_FIELDS_BY_TYPE` export
- `src/routes/canvas/v2/import-from-dir.ts` — `flattenParamsToNodeData` helper + `__incomplete` stamping
- `scripts/verify-schema-roundtrip.ts` — Phase 44 Wave 3 verifier (the pattern to mirror)

### Phase 45 text UI (VERIFY-03 panel assertion target)
- `packages/infinite-canvas/src/components/NodeDetailPanel.tsx` — AssetDetail gold-standard pattern; description fallback chain
- `scripts/fixtures/sample-manifest.json` — fallback fixture (Phase 44); extended in Phase 45

### Docker / API surface (VERIFY-03)
- `docker-compose.v9.yml` — primary compose file (comfyui-primary/aux, gold-team, hermes-agent, redis, audit-db)
- `src/routes/canvas/v2/nodes.ts` — POST endpoint at line 48 (consumer of the canvas_sync output)

</canonical_refs>

<scope_fence>
## Scope Fence

In scope:
- `scripts/verify-manifest-contract.ts` (NEW) — VERIFY-01
- `scripts/verify-import-roundtrip.ts` (NEW) — VERIFY-02
- `scripts/verify-phase-46-e2e.ts` (NEW) — VERIFY-03 (env-gated)
- `scripts/verify-schema-drift.ts` (NEW) — VERIFY-04
- `package.json` — register all 4 + master `verify:phase-46`
- `.planning/phases/46-e2e-cross-repo-contract-tests/46-VALIDATION.md` — manual E2E instructions

Out of scope (Phase fences):
- Source-side manifest changes (Phase 42)
- canvas_sync.py cleanup (Phase 43)
- Receiver-side schema strictness (Phase 44)
- UI panel completeness (Phase 45)
- Historical backfill (Phase 47 — gated on Phase 46 passing)

Anti-patterns to avoid:
- DO NOT duplicate the source-side test logic in TS — invoke pytest cross-repo (D1)
- DO NOT run the full creative pipeline in VERIFY-03 — fixture-driven only (D4)
- DO NOT parse Python with a real AST library — targeted regex is sufficient (D3)
- DO NOT auto-start docker in `verify:phase-46` — env-gated to avoid GPU surprises (D5)
- DO NOT hard-code `/data/workspace/kais-hermes-skills` — env var override (D6)

</scope_fence>

<specifics>
## Specific Ideas

- The existing `verify-schema-roundtrip.ts` (Phase 44 Wave 3) already
  reads the cross-repo fixtures at
  `/data/workspace/kais-hermes-skills/skills/kais-movie-pipeline/tests/fixtures/manifests/`.
  VERIFY-02 should reuse this fixture resolution logic.
- `EXPECTED_PARAM_FIELDS_BY_TYPE` (Phase 44 export) IS the
  receiver-side mirror of `MANIFEST_PARAM_SCHEMA` (Phase 42 export).
  VERIFY-04 just diffs them.
- The Phase 45 fallback fixture (`scripts/fixtures/sample-manifest.json`)
  has nodes for asset/script/storyboard/video types — perfect input for
  VERIFY-02.

</specifics>

<deferred>
## Deferred Ideas

- CI integration (GitHub Actions / similar) — out of scope; the verify
  scripts are designed to be CI-ready but wiring them into a CI system
  is a separate DevOps task
- Performance benchmarks (assert canvas API responds in <N ms) —
  Phase 46 verifies correctness, not perf
- Contract drift in the OTHER direction (TS → Python) — Phase 42 is
  the source of truth; if Python changes, TS drifts; if TS changes
  without updating Python, that's a Phase 44 task
- Multi-phase E2E (p04 → p07 → p09 → p11) — out of scope; VERIFY-03
  covers a single representative phase (p04) to keep test time bounded
- Backfill-specific E2E (run `--apply` against a copy of prod data) —
  Phase 47 territory

</deferred>

---

*Phase: 46-e2e-cross-repo-contract-tests*
*Context gathered: 2026-07-16 via inline planning session*
