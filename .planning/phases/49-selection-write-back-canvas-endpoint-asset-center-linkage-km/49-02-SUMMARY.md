---
phase: 49-selection-write-back-canvas-endpoint-asset-center-linkage-km
plan: "02"
subsystem: api
tags: [express, fetch, node-http, review-platform, kmc-bridge, select-winner, tdd]

requires:
  - phase: 49 plan 01
    provides: select-winner endpoint updated-success path + SelectWinnerResult (variantIndex/winnerPhaseName) + the "// [49-02] review bridge hook mounts here" seam + verify:phase-49-bridge npm entry
provides:
  - resolveOpenReviewForSelection(params, deps) — fire-and-forget kap→review-platform resolve bridge (query open APPROVING kmc reviews → double client-side filter → exactly-one approve with result.selected + choose:v{N} comment marker); never throws, deps fully injected
  - select-winner endpoint updated path now bridges (void + .catch); idempotent path does not
  - npm run verify:phase-49-bridge behavioral gate (46 assertions) on a local node:http mock — replaces the 49-01 scaffold
affects: [49-04 kmc integration, Phase 50 GUARD (protocol-gap reference)]

tech-stack:
  added: []  # zero new dependencies — global fetch / node:http / AbortSignal.timeout all built-in
  patterns:
    - "fully-injected lib module (baseUrl/fetchImpl/logger/timeoutMs params, no utils-barrel import) — ingestAssets.ts pattern, so verify scripts drive it without booting the app db"
    - "mock-server behavior gate: node:http on 127.0.0.1:0 with per-case knobs (items/approveStatus/hangGet), request log asserted for method+path+query+body"

key-files:
  created:
    - src/lib/reviewBridge.ts
  modified:
    - src/routes/canvas/v2/select-winner.ts
    - scripts/verify-phase-49-bridge.ts

key-decisions:
  - "Seam comment substring '[49-02] review bridge hook mounts here' is KEPT above the live call — plan Task 2 says replace the seam with the call, but the 49-01 gate asserts that exact substring; keeping it satisfies both (placeholder became the real mount, 49-01 gate re-run 65/65)"
  - "Client-side candidate filter is a DOUBLE startsWith (type AND content_ref phase-segment after the last '/') because the platform GET has no content_ref filter param (verified reviews.py:239-300); ambiguity (≥2 hits) refuses to resolve rather than risk resolving someone else's gate (T-49-07)"
  - "comment embeds choose:v{N} because kmc's _chosen_from_suggested only parses the 'choose:<id>' prefix (runner_hooks.py:612-615); result.selected is the only machine-readable channel the platform persists (metadata_json.review_result)"
  - "Bridge fires AFTER the D-07 swap, BEFORE broadcast — same seam 49-01 reserved; response is never awaited (void + .catch backstop, T-49-06)"

patterns-established:
  - "Pattern: never-throw fire-and-forget outbound bridge — whole body in try/catch, 409 = resolved-elsewhere warn-skip, AbortSignal.timeout on every fetch"
  - "Pattern: self-referential grep traps — doc comments must not contain the literal strings the acceptance greps require to be zero"

requirements-completed: [SELECT-04]

duration: 6min
completed: 2026-08-19
---

# Phase 49 Plan 02: Review-Platform Bridge Summary

**Fire-and-forget kap→review-platform resolve bridge (SELECT-04): after a canvas winner selection, query open APPROVING kmc reviews by phase token, double-filter client-side, approve the exactly-one hit with result.selected=[N] + choose:v{N} marker — all branches asserted against a local node:http mock (46 assertions), D-11 protocol gap documented in code.**

## Performance

- **Duration:** 6 min (03:19–03:26 UTC)
- **Started:** 2026-08-19T03:19:30Z
- **Completed:** 2026-08-19T03:26:23Z
- **Tasks:** 2/2
- **Files modified:** 3 (1 created, 2 modified)

## Commits

| Task | Commit | Type |
| ---- | ------ | ---- |
| Task 1 RED | 3ea6a5da | test(49-02): add failing bridge behavior gate (mock review-platform) |
| Task 1 GREEN | d26dc41a | feat(49-02): implement resolveOpenReviewForSelection bridge |
| Task 2 | a0278a09 | feat(49-02): mount review bridge in select-winner updated path |

## Accomplishments

- **Bridge library** (`src/lib/reviewBridge.ts`): phase token derived from `winnerPhaseName` (first `_` segment, lowercased; null/empty → info skip, zero HTTP); `GET {base}/api/v1/reviews?source=kais-movie-agent&status=APPROVING&limit=100`; client-side double filter (platform has no content_ref filter param); 0 hits → info skip (常态); ≥2 hits → warn ambiguity skip; exactly 1 → `POST /api/v1/reviews/{id}/approve` with `{ comment: "choose:v{N} (canvas group {g} winner {node}, project {p}/{e})", result: { selected: [N] } }`; 409 → warn resolved-elsewhere; non-2xx/timeout/fetch errors → warn swallowed. Whole export body wrapped in try/catch — the function can NEVER reject. Both fetches carry `AbortSignal.timeout(timeoutMs)` (default 5000). All deps injected (baseUrl defaults to REVIEW_PLATFORM_URL env — operator-controlled, fixed outbound path, T-49-05).
- **Endpoint mount** (`src/routes/canvas/v2/select-winner.ts`): the 49-01 seam now carries the live call — `void resolveOpenReviewForSelection({ projectId, episodesId, groupId, winnerNodeId, variantIndex: result.variantIndex, winnerPhaseName: result.winnerPhaseName }).catch(() => {})` — placed after the D-07 swap, before broadcast. The idempotent branch (`applied: false`) returns before the mount and never bridges.
- **Behavioral gate** (`scripts/verify-phase-49-bridge.ts`, replaces the 49-01 scaffold): local `node:http` mock on 127.0.0.1 random port (never the real service — zero `:8090` literals), per-case knobs items/approveStatus/hangGet + captured logger. Cases: (0) null phase skip; (a) zero-hit GET query contract (path + source + status params + baseUrl trailing-slash normalization) with no POST; (b) single hit → POST `/api/v1/reviews/7/approve`, `result.selected=[2]`, comment embeds `choose:v2` + group/winner context; (c) type filter rejection; (c2) content_ref phase-segment filter rejection (double filter proven); (d) ambiguity guard; (e) 409 warn-skip; (e2) 500 warn-skip; (f) hanging mock → AbortSignal timeout honored (252ms with 250ms budget), no throw. Plus 6 bridge-lib and 5 route source-shape assertions (void prefix, `.catch` backstop, idempotent-before-mount ordering, after-D-07 seam, no utils-barrel import, both startsWith filters visible, header vocabulary-gap documentation).

## Documented Protocol Gap (D-11 freeze — for Phase 50 GUARD)

Recorded in the `reviewBridge.ts` module header as the plan mandates (verified against both frozen repos this session):

1. `chosen_variant_id` / `suggested_action` do not exist anywhere in kais-review-platform — approving with `result.selected` produces neither field.
2. The worker callback body (`{review_id, old_state, new_state, timestamp, source_system, disposition, result}`) lacks the `gate_id`/`decision` keys kmc's `resume_from_callback` needs — callback path is a dead end for kmc.
3. kmc's 30s poller (runner_hooks.py Path 2) extracts `{review_id, state, disposition, version}` and resolves on `state ∈ {"resolved","closed"}` — but the platform vocabulary is PENDING/POLICY_EVAL/APPROVING/COMPLETE. It ends at COMPLETE, so the poller NEVER matches: kmc cannot currently read ANY platform-side resolve, not just the chosen variant.
4. `choose:<id>` (via `_chosen_from_suggested`) is the only marker kmc can parse today; the bridge embeds `choose:v{N}` in the approve comment as that forward-compatible channel.

⇒ Consumer-side protocol gap, not a kap bridge gap. The kap half-loop is complete and contract-correct; when kmc/platform align (out of scope, Phase 50+), the bridge lights up without modification.

## Verification Evidence

- `npm run verify:phase-49-bridge` → exit 0, **46/46 assertions PASS** (plan required ≥6)
- `npm run verify:phase-49` (49-01 gate) re-run → exit 0, **65/65 PASS** (no regression)
- `npx tsc --noEmit` → exit 0
- `grep -c "@/utils" src/lib/reviewBridge.ts` → **0**; `grep -c ":8090" scripts/verify-phase-49-bridge.ts` → **0**; `grep -c "SKIP: scaffold"` in the gate output → **0** (scaffold fully replaced)
- **Forced-failure sanity performed**: flipped the `(b) body.result.selected = [2]` expectation to `[3]` → run exited 1 with exactly `FAIL: (b) body.result.selected = [2] (1-based variantIndex) — [2]` → restored → 46/46 green again.
- **D-11**: `git status --porcelain -- app/` (kais-review-platform) and `-- plugins/` (kais-hermes-skills) both empty — every contract source file this plan relies on is untouched, and this session performed read-only operations (sed/grep) on both repos only. (Both repos carry pre-existing unrelated dirt in other paths — `.env.production`/`Dockerfile`/docker-compose in review-platform, pipeline runtime logs/state in hermes-skills — none of it from this plan; out of scope per the scope boundary.)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Self-referential grep traps in doc comments**
- **Found during:** Task 1 GREEN run and Task 2 acceptance greps
- **Issue:** the bridge header originally said "no @/utils import" (literal `@/utils` in the file → the zero-grep acceptance criterion failed) and the gate header originally said `this file must contain no ":8090" literal` (making the `:8090` grep count 1).
- **Fix:** reworded both comments ("the utils barrel", "no literal pointing at the real review-platform address/port"). The assertions themselves were correct — the prose was violating its own contract.
- **Files modified:** src/lib/reviewBridge.ts, scripts/verify-phase-49-bridge.ts
- **Commits:** d26dc41a, a0278a09

**2. [Rule 1 - Bug] Idempotent-order assertion anchored on the import line**
- **Found during:** Task 2 first gate run (45/46)
- **Issue:** `routeSrc.indexOf("resolveOpenReviewForSelection")` matched the import at the top of select-winner.ts, not the call site — so "idempotent branch returns before the bridge" compared the wrong positions and failed.
- **Fix:** anchor both order assertions on the call-site string `"void resolveOpenReviewForSelection"` (and `"await syncAssetPrimaryForWinner"` for the D-07 seam).
- **Files modified:** scripts/verify-phase-49-bridge.ts
- **Commit:** a0278a09

### Plan-shape notes (no action needed)

- The seam comment substring `[49-02] review bridge hook mounts here` is retained verbatim above the live call: plan Task 2 says "replace the seam marker with the actual call", but the 49-01 gate asserts that substring — keeping it satisfies both requirements with zero 49-01-gate churn.
- Task 1's TDD RED authored the gate script that Task 2's file list formally owns (same handoff shape as 49-01's RED); the route source-shape section was added in Task 2's commit.
- The forced-failure restore used `git checkout --` on the script, which initially also reverted the (then-uncommitted) Task-2 route-assertion section back to the RED commit state; both script edits were re-applied and the final state re-verified at 46/46 before committing.

## Authentication Gates

None. Platform-side auth was removed upstream (verified: core/auth.py get_current_client returns "api") — the bridge sends no credentials, and logs carry only ids/counts/reasons (T-49-08).

## Known Stubs

None. `scripts/verify-phase-49-linkage.ts` (the other 49-01 scaffold) remains a SKIP placeholder by design — it belongs to plan 49-03 and was not touched. No data-flow stubs: every bridge branch is exercised against the mock by the gate.

## Threat Flags

None — implementation covers the plan's threat model: T-49-05 (baseUrl from env only, fixed outbound paths, timeouts on both fetches), T-49-06 (void + .catch, never awaited), T-49-07 (double-field filter + ambiguity refusal + 409-as-resolved), T-49-08 (no credentials, minimal logging), T-49-09/SC accepted as planned. No security-relevant surface beyond the plan.

## Self-Check: PASSED

All 3 key files exist on disk (`src/lib/reviewBridge.ts`, `src/routes/canvas/v2/select-winner.ts`, `scripts/verify-phase-49-bridge.ts`); all 3 task commits (3ea6a5da, d26dc41a, a0278a09) found in git log on gsd/w-49-02.
