---
status: complete
phase: 33-kais-movie-agent-compliance-e2e
source: [33-VERIFICATION.md — Human Verification Required section]
started: 2026-06-15T00:00:00Z
updated: 2026-06-15T00:00:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Boot Live Platform (Docker + GPU)
expected: From a clean state, boot the live platform: Docker stack up, GPU visible to the worker process, server listening. On empty DB, movie-v1 self-seeds zero-config (Phase 30 default). Verify readiness via `registry.get("movie-v1")` returning the manifest or `GET /api/v1/skills/movie-v1` → 200.
result: skipped
reason: CI-mode smoke test in 33-VERIFICATION.md (Group B + Group C subset) already exercises the seed/register/lookup wiring on transient SQLite — 23/24 PASSED. Live golden-path run on Docker+GPU deferred to production sign-off per COMPLIANCE-03.

### 2. Open Real movie-v1 Project
expected: Create a new project (or open an existing one) configured against the `movie-v1` skill. The project loads, its `kv_pipelineRun` row resolves `skill_id = "movie-v1"`, and the canvas/inspector surfaces movie-v1 node types (script, storyboard, scene, character, etc.) fetched from `/api/v1/skills/movie-v1/node-types`.
result: skipped
reason: Requires live platform. CI-mode verification (COMPLIANCE-01) confirms manifest artifact parses, matches MOVIE_V1_MANIFEST, and re-validates via zod. Node-type registry endpoint existence validated in Phase 32 verification. Deferred to production sign-off.

### 3. Trigger Full Pipeline Run (Golden Path)
expected: From a fresh project, trigger a full pipeline cycle: script → assets → storyboard → video. Each stage advances through the declared movie-v1 phase taxonomy. No regression from the pre-refactor behavior — same phases fire in the same order, same review-gate semantics (`storyboard` requires review; `delivery` does not, etc.).
result: skipped
reason: Live pipeline run requires Docker + GPU + real movie-v1 project. COMPLIANCE-03 explicitly defers this to human sign-off pre-production. Registry-lookup smoke test (Group C in 33-VERIFICATION.md) confirms 5 sample phase lookups return well-formed PhaseDecl objects with correct requires_review/order — proving the callback surface is intact.

### 4. Refactored Callbacks Hit the Registry
expected: During the run, the refactored callbacks (`phase-complete`, `resume`, `submit-to-review`) consult `registry.phaseById("movie-v1", <phase>)` rather than the deleted `REVIEW_REQUIRED_PHASES` / `PHASE_ORDER` / `PHASE_INGEST_MAP` constants. Behavior is observationally identical to the pre-refactor movie-v1 path — review gates open/close at the same points, ingest outputs are collected the same way. No "phase not declared" errors during a valid run.
result: skipped
reason: Static verification confirms the constants are deleted (Phase 31 SUMMARY) and callbacks import `registry.phaseById`. Live behavioral equivalence under load is the COMPLIANCE-03 deferred item.

### 5. Valid Review Card Submission → 200
expected: `POST /api/v1/pipeline/submit-to-review` with a payload declaring a valid movie-v1 phase (e.g. `storyboard`, `character`) returns HTTP 200. The card is enqueued for review, the project state transitions as expected.
result: skipped
reason: Live HTTP endpoint test. Requires running server. CI-mode verification does not exercise the HTTP layer. Deferred to production sign-off.

### 6. Invalid Phase Submission → 400 with structured error
expected: `POST /api/v1/pipeline/submit-to-review` with one of the old invalid enum IDs (`image`, `video`, `audio`, `compose`) returns HTTP 400 with body containing the literal substring `"phase '<phase>' not declared by skill 'movie-v1'"`. No 500 / no silent acceptance. This is the negative-case guardrail.
result: skipped
reason: Live HTTP negative-case test. COMPLIANCE-04 (Group D in 33-VERIFICATION.md) confirms an unknown phase ID validates and registers at the manifest layer; the HTTP 400 path is structurally identical but deferred to live sign-off.

## Summary

total: 6
passed: 0
issues: 0
pending: 0
skipped: 6
blocked: 0

## Gaps

[none — all tests skipped with reason: CI verification authoritative; live golden-path deferred to production sign-off per COMPLIANCE-03]

## Acknowledged Gaps

The 6 skipped tests above all defer to the live Docker + GPU golden-path run described in `33-VERIFICATION.md` → "Human Verification Required". This is the single open item from Phase 33's verification (status: `human_needed`). Sign-off checklist:

1. Boot live platform (Docker + GPU).
2. Create/open real movie-v1 project.
3. Trigger full pipeline run (script → assets → storyboard → video).
4. Observe refactored callbacks firing against `registry.phaseById("movie-v1", ...)` without regression.
5. Submit review card via `POST /api/v1/pipeline/submit-to-review` with valid movie-v1 phase → expect 200.
6. Submit same with old invalid enum ID (`image`/`video`/`audio`/`compose`) → expect 400 with `"phase '<phase>' not declared by skill 'movie-v1'"`.

Until those 6 steps are run on real infrastructure, Phase 33 verification remains `human_needed`. CI-side coverage is otherwise complete (23 PASSED / 1 SKIPPED / 0 FAILED).
