---
phase: 60-post-save-panel-persistence
reviewed: 2026-08-24T13:40:00Z
depth: quick
review_iteration: 1
previous_findings_verified: CR-01, CR-02, WR-01, WR-02
fix_commits: d2cbfbd2, e15908fc, 14a75dd7, 838ff50b, 894f6122
files_reviewed: 5
files_reviewed_list:
  - scripts/diagnose-60-roundtrip.ts
  - packages/infinite-canvas/test/e2e/probe-60-real.mjs
  - packages/infinite-canvas/src/services/canvasApi.ts
  - packages/infinite-canvas/src/components/CanvasContextMenu.tsx
  - packages/infinite-canvas/test/e2e/mock-backend/server.mjs
findings:
  critical: 0
  warning: 0
  info: 0
  total: 0
status: clean
---

# Phase 60: Code Review Report (Re-Review, iteration 1)

**Reviewed:** 2026-08-24T13:40:00Z
**Depth:** quick (fix verification pass)
**Files Reviewed:** 5
**Status:** clean

## Summary

Re-review of the four in-scope findings (CR-01, CR-02, WR-01, WR-02) against fix commits `d2cbfbd2`, `e15908fc` (+`14a75dd7`), `838ff50b`, `894f6122`. All four fixes are correctly implemented and verified fixed. No new Critical or Warning issues introduced by the fixes. Per re-review scope, Info findings (IN-01..IN-05), the FLAG-2 divergence, and documented deviations were not re-examined or re-flagged.

Context files read for verification (not in review scope): `scripts/verify-phase-60.ts` (S8–S11 locks), `packages/infinite-canvas/src/components/FlowCanvas.tsx` (health-poll consumer), `src/routes/canvas/review/score.ts` + `src/lib/ai-scorer.ts` (score envelope/shape), `src/routes/canvas/v2/save-v2.ts` (HTTP status semantics), `src/routes/canvas/v2/health.ts` (untouched confirmation).

## Verification of Previous Findings

### CR-01: Restore guard — VERIFIED FIXED (both probes)

**diagnose-60-roundtrip.ts** (`scripts/diagnose-60-roundtrip.ts:237-243, 279, 287, 347-385`):
- Basis correct: `lastKnownServer` initialized to `loadA` (L243), refreshed to `loadC` only after the probe's own successful save **and** successful load-v2 re-observation (L279 `probeWrote = true` on save success only; L287 `lastKnownServer = loadC`). If own save landed but the loadC fetch failed, the basis conservatively stays at `loadA` (L281-284 note documents this) — the subsequent finally comparison then detects the unverified own write as drift and aborts. Sound conservative semantics.
- Drift → abort: finally (L349-359) pre-fetches load-v2; mismatch against `lastKnownServer` → note FAIL with `firstDiff`, restore abandoned, concurrent write preserved. Exit contract enforces failure unconditionally: `footprintRestored` stays false → `return 1` at L388 in both strict and non-strict modes.
- Pre-check load failure → FAIL, no blind write (L351-353).
- Probe-wrote-nothing → no restore write: `probeWrote=false` + no drift → PASS "无需恢复,净足迹=0" with zero writes (L360-364); covers save-failure, folding-guard, and pre-save-crash paths. Scope selection precedes the try block, so finally never runs with unset scope vars.

**probe-60-real.mjs** (`packages/infinite-canvas/test/e2e/probe-60-real.mjs:119-128, 146, 174, 183, 268-270, 297-339`):
- Basis includes segment-2 browser save: `observeServer()` runs immediately after each successful protocol save (gated on HTTP 200 **and** envelope code 200, L174/L183) and immediately after the browser save `waitForResponse` resolves — before the five PANEL-01 assertions (L268-270) — so a thrown assertion cannot lose the observation basis. The `resp.status() === 200` gate is a sound "已落库" proxy: the real save-v2 route returns HTTP 400/500 on all failure paths and HTTP 200 only on success (`src/routes/canvas/v2/save-v2.ts:41,57,84,90`).
- Drift → note FAIL + abort + `process.exitCode = 1`; concurrent write preserved (L312-316). Pre-check failure → FAIL, no blind write (L310-311). `probeWrote=false` + no drift → PASS with no restore write (L317-318). Browser and socket are closed before the guard evaluation (L299-300), so the page cannot write mid-restore.

**Residual (accepted, not a finding):** a check-then-restore without server-side CAS retains a ~ms TOCTOU window (concurrent write landing between the pre-restore comparison and the restore POST is still clobbered). This is inherent to the guard as prescribed in the original review; the fix narrows the exposure window from the full ~15–45s probe duration to milliseconds.

### CR-02: requestNodeScore envelope unwrap — VERIFIED FIXED

`packages/infinite-canvas/src/services/canvasApi.ts:597-629`: `apiCall<any>` removed; typed envelope `{ code: number; data?: { score?: NodeScoreResult }; msg?: string }`; returns `json.data?.score` (L622, L628). `NodeScoreResult` (L597-605) is field-identical to the server's `AIScoreResult` (`src/lib/ai-scorer.ts:9-17`).

- 404 path: apiCall passes through code-404 envelopes without throwing (L116-118); `requestNodeScore` converts `score == null` to `ApiError(json.msg || '评分失败', 'business', json.code)` (L623-627). The real route's 404s carry `msg` ("资产不存在"/"分镜不存在" — `src/routes/canvas/review/score.ts:24,32`), so the surfaced message is specific. HTTP-level 4xx already throws `business` in apiCall (L108-110). Both 404 forms land in the caller's catch → toast「评分失败」.
- Caller coherence: repo-wide grep confirms exactly one in-app caller — `CanvasContextMenu.tsx:174-178`, unchanged, now reads a valid `score.overall` and writes the normalized score object into `aiScore`. `src/runtime/canvas-client.mjs:636` is an independent runtime client (own `_request`), unaffected. Downstream aiScore consumers read the flat shape (`StoryboardTimeline.tsx:2697` `aiScore?.overall`; `VariantWall.tsx:107`) — coherent with `NodeScoreResult`.

### WR-01: Layer-1 gated on save success — VERIFIED FIXED

`scripts/diagnose-60-roundtrip.ts:267-311`: the load-v2(C)/layer-1 diff/wire→loadC attributor/layer-1 anchor block is nested inside the save-v2 success branch. Save failure → note FAIL with the explicit「层1/层1锚点显式 SKIP」reason (L275), `serverLayerAvailable=false`, `adaptedC=adaptedA` — no vacuous PASS against untouched server state, no spurious「服务端漂移」misattribution. The loadC-failure branch (L281-284) likewise SKIPs layer 1 with a stated reason. Layer 2/3 remain gated on `serverLayerAvailable || folding-detected` (L314), so the save-failure path skips them entirely while the folding-guard path still produces in-memory layer-2 evidence. Exit contract preserved: footprint gate unconditional; strict → exit 1 on failures; non-strict prints FAIL lines honestly (documented in fix report, matches prior contract).

### WR-02: Mock health per-scope eventCount — VERIFIED FIXED

`packages/infinite-canvas/test/e2e/mock-backend/server.mjs:137-157, 191-212, 220-241`:
- `state.scopeEvents = new Map()` keyed `${projectId}:${episodesId}` → `{ eventCount, lastEventId, lastEventAt }`; incremented in the save-v2 handler only when pid/eid are non-null (L196-204); cleared by `reset()` (L156); health emits one entry per key with its own count, zero-event scopes omitted (closer to real shape), `totalEvents` = per-scope sum (L224-241). Cross-scope contamination of scope 1/1 eliminated.
- Consumer coherence: `FlowCanvas.tsx:820-823` handles a scope absent from `scopes` (`if (!scope) return`), baseline learned on first appearance; the FLAG-1 self-save baseline reset (FlowCanvas.tsx:339-343) keeps same-scope self-saves from false-triggering the health-poll reload. No e2e test references `eventCount`/`totalEvents` directly (grep across `test/e2e/`), so nothing depended on the old unconditional 1/1 entry.
- Real health.ts untouched: `git log -- src/routes/canvas/v2/health.ts` shows last change `38a0f8d5` (pre-phase-60); no fix commit touched it. FLAG-2 divergence remains documented in code comments and the S3 lock.

## New Issues Introduced by Fixes

None found. Verification locks S8–S11 added to `scripts/verify-phase-60.ts` use anchor strings that match the shipped implementations (S9's anchor corrected to the optional-chain form `json.data?.score` in `14a75dd7`). The mock/real divergence handling, probe exit contracts, and error message fields were traced end to end with no new defects. Pre-existing quirks observed during verification (e.g., apiCall reading `json.message` where the score route sends `msg` on code-500 envelopes — generic fallback message only) predate these fixes and are out of re-review scope.

All four in-scope findings are verified fixed; no new issues found.

---

_Reviewed: 2026-08-24T13:40:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: quick (re-review iteration 1)_
