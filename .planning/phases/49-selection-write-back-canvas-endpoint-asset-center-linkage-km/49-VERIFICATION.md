---
phase: 49-selection-write-back-canvas-endpoint-asset-center-linkage-km
verified: 2026-08-19T10:06:51Z
status: human_needed
score: 4/4 must-haves verified
overrides_applied: 1
overrides:
  - must_have: "SC-4: A kap-side selection change emits a review resolve carrying chosen_variant_id to the review-platform API; kmc's 30s poll picks it up — the next p11b render selects frames per the new winner"
    reason: "kap half-loop delivered and contract-correct; the kmc consumption half is structurally unreachable under D-11 (both external repos frozen this phase). Independently re-verified by the verifier: (a) chosen_variant_id/suggested_action have 0 occurrences in kais-review-platform/app/, (b) platform state vocabulary is PENDING/POLICY_EVAL/APPROVING/COMPLETE (schemas.py:34-37) while kmc's poll predicate is state in {resolved,closed} (runner_hooks.py:539) — never matches. Bridge writes the real contract (approve + result.selected + choose:v{N} comment marker); it lights up without modification once kmc/platform align. Cross-repo debt documented in reviewBridge.ts:35-57 header and 49-02-SUMMARY."
    accepted_by: "orchestrator (pre-registered deviation, assessed not penalized per verification directive)"
    accepted_at: "2026-08-19T10:06:51Z"
human_verification:
  - test: "SC-2 browser smoke: on the canvas, click a non-winner variant badge → success toast; F5 refresh → winner persists; then with DevTools offline, select another variant → UI rolls back to previous winner + error toast"
    expected: "Winner survives refresh (no longer frontend-memory-only); offline selection visibly rolls back — no 'UI shows new winner but DB never wrote it' divergence"
    why_human: "Visual toast appearance, browser refresh persistence, and offline network simulation cannot be observed via grep/unit gates; vitest mocks the API layer by design"
  - test: "SC-3 bidirectional refresh check: select an asset in the asset center (handleSelect) → refresh canvas → same winner shown; then select a different winner on the canvas → refresh asset center → same isPrimaryView primary shown (requires a grouped asset with an a-oasset- canvas node in a variant group)"
    expected: "Both sides converge to the same winner on refresh in either direction"
    why_human: "End-to-end cross-page consistency in a real browser; automated gates assert each half-loop at DB/lib level (50/50, 79/79) but not the full UI round trip"
---

# Phase 49: Selection Write-back (Canvas Endpoint + Asset-Center Linkage + kmc Bridge) Verification Report

**Phase Goal:** 用户在画布或资产中心换选 winner 后，选定状态事务化持久化到后端（不再前端本地乐观），并经 review resolve (`chosen_variant_id`) 回写 kmc、被其 30s 轮询消费，影响下一次 p11b 渲染选帧——"kap 换选 ↔ kmc 消费"闭环打通。
**Verified:** 2026-08-19T10:06:51Z
**Status:** human_needed (all truths verified at code/gate level; 2 browser-level items require human)
**Re-verification:** No — initial verification (no previous VERIFICATION.md)

## Goal Achievement

### Observable Truths

Roadmap Success Criteria (ROADMAP.md Phase 49) merged with PLAN frontmatter must-haves (plans add detail, no scope reduction — all 4 SCs covered).

| # | Truth | Status | Evidence |
| - | ----- | ------ | -------- |
| 1 | SC-1: select-winner endpoint persists `canvas_variant_groups.winner_node_id` + group `is_winner` in ONE transaction; fresh load-v2 still returns the winner | ✓ VERIFIED | `selectWinnerInGroup` (canvasRelationalStore.ts:446) — not_found/multi_mode/not_in_group/locked/idempotent short-circuits, updated path wraps both UPDATEs in `trxDb.transaction` (:533-555), parameterized knex builder only, dangling member tolerated, idempotent branch provably returns before any UPDATE. Route mounted `app.use("/api/canvas/v2/variant-groups", route167)` (router.ts:174,202). Read path: listVariantGroups maps `winner_node_id→winnerNodeId` (canvasRelationalStore.ts:359), adapter treats group-level winnerNodeId as authoritative (adapter.ts:280-286) → load-v2 round trip closes. `npm run verify:phase-49` re-run by verifier: **79/79 PASS** including live express dispatch in child process, idempotent no-write (updated_at unchanged), transaction-rollback monkeypatch, WR-03 demotion scoping, WR-09 locked 409 |
| 2 | SC-2: frontend `canvasStore.selectWinner` calls the backend endpoint; on failure UI rolls back to prevSnapshot | ✓ VERIFIED | `selectVariantWinner` (canvasApi.ts:448-460) → `apiCall POST /canvas/v2/variant-groups/{encodeURIComponent(groupId)}/select-winner`. canvasStore.ts:525-608: graph path captures `prevGraph` before setGraph, awaits API, catch → `setGraph(prevGraph)` + error toast; legacy path `rollbackWinnerSelection(outcome)` + variantGroups snapshot restore (WR-05/WR-06); validation throws before any await (no partial apply, no API call); missing projectId/episodesId early-exit. Call sites (CanvasContextMenu.tsx:226, VariantPicker.tsx:46) are fire-and-forget — async transition safe. vitest re-run by verifier: selectWinner suite **9/9**, full package regression **172/172**; tsc clean at root and package |
| 3 | SC-3: asset-center selection updates the canvas variant group winner, and vice versa — same winner on refresh | ✓ VERIFIED | registry→canvas: PATCH hook (assets-registry/index.ts:225-229) fires only on `isPrimaryView===true`, `void …catch` after the o_assets update, response shape unchanged; `applyRegistrySelectionToCanvas` (canvasAssetLinkage.ts:126) reuses `selectWinnerInGroup` across ALL episodes' groups (WR-04, deterministic episodes_id asc, json_extract placeholder fallback); silent info-skip is the norm. canvas→o_assets: D-07 `syncAssetPrimaryForWinner` (canvasRelationalStore.ts:571) scoped swap + `demoteAssets` (:647) WR-03 demotion-only pass, warn-isolated, direct-knex (no HTTP self-call → no loop, T-49-13 asserted in both gates). `npm run verify:phase-49-linkage` re-run: **50/50 PASS**; loop-prevention and route-shape assertions included |
| 4 | SC-4: kap selection emits review resolve with chosen variant; kmc 30s poll picks it up | ✓ PASSED (override) | kap half-loop VERIFIED: `resolveOpenReviewForSelection` (reviewBridge.ts:114-258) — fail-closed triple candidate filter (episode identity CR-01 + exact phase-token WR-01 + bounded next_cursor pagination WR-02), 0-hit info-skip / ≥2 ambiguity skip / exactly-one approve with `result.selected=[N]` + `choose:v{N}` comment marker, 409=resolved-elsewhere skip, AbortSignal.timeout on every fetch, whole body try/catch (never rejects), zero @/utils imports. Mounted fire-and-forget (`void ….catch`) in the updated path only (select-winner.ts:151-158); idempotent path returns before the mount. `npm run verify:phase-49-bridge` re-run: **63/63 PASS**. kmc consumption half is unreachable under D-11 — see override: verifier independently confirmed 0 occurrences of `chosen_variant_id`/`suggested_action` in kais-review-platform/app/, platform terminal state COMPLETE vs kmc predicate `state in {"resolved","closed"}` (runner_hooks.py:539). D-11 held: `git status --porcelain` clean on kais-review-platform app/ and kais-hermes-skills plugins/ |

**Score:** 4/4 truths verified (1 via pre-registered override — SC-4 kap half-loop; consumer side is a documented cross-repo protocol gap, not a kap implementation gap)

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `src/lib/canvasRelationalStore.ts` | selectWinnerInGroup + syncAssetPrimaryForWinner (+ WR-03 demoteAssets) | ✓ VERIFIED | :446/:571/:647, db-injected, parameterized builders, substantive (Level 2+3+4) |
| `src/routes/canvas/v2/select-winner.ts` | POST endpoint, zod, 404/409×3/400/200 semantics, D-07, bridge hook, broadcast | ✓ VERIFIED | 178 lines, full semantics in source; live-dispatch asserted in gate |
| `src/router.ts` | endpoint mounting | ✓ VERIFIED | route167 import :174 + app.use :202 (gate also source-asserts) |
| `src/lib/reviewBridge.ts` | resolveOpenReviewForSelection, deps injected, never-throws, protocol-gap doc | ✓ VERIFIED | 258 lines; header documents COMPLETE-vs-resolved/closed gap |
| `src/lib/canvasAssetLinkage.ts` | findCanvasNode(s)ForAsset + applyRegistrySelectionToCanvas | ✓ VERIFIED | 168 lines; WR-04 all-episodes plural lookup + deterministic singular wrapper |
| `src/routes/v1/assets-registry/index.ts` | PATCH isPrimaryView===true hook | ✓ VERIFIED | :225-229, void+catch, after update, response unchanged (gate asserts) |
| `packages/infinite-canvas/src/services/canvasApi.ts` | selectVariantWinner client | ✓ VERIFIED | :448-460 via apiCall; WR-07 per-attempt timeout + 4xx no-retry fix |
| `packages/infinite-canvas/src/store/canvasStore.ts` | selectWinner optimistic + await + rollback both paths | ✓ VERIFIED | :525-608 |
| `scripts/verify-phase-49.ts` / `-bridge.ts` / `-linkage.ts` | behavioral gates | ✓ VERIFIED | 79/63/50 assertions, real modules via dynamic import, :memory: only (db2.sqlite grep = 0 across all three) |
| `src/store/__tests__/selectWinner.test.ts` (+ canvasApi, useCanvasSocket suites) | vitest behavior gates | ✓ VERIFIED | 9+6+4 tests, substantive state assertions (rollback inspects restored state, not just call counts) |
| `src/hooks/useCanvasSocket.ts` + `FlowCanvas.tsx` | WR-08 variant:selected consumption | ✓ VERIFIED | handler registered, echo guard, scope guard; 4/4 jsdom tests |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | -- | --- | ------ | ------- |
| src/router.ts | select-winner.ts | route167 app.use | ✓ WIRED | router.ts:174+202 |
| select-winner.ts | canvasRelationalStore.ts | selectWinnerInGroup + syncAssetPrimaryForWinner + demoteAssets | ✓ WIRED | route :54-131 |
| select-winner.ts | reviewBridge.ts | void resolveOpenReviewForSelection(...).catch | ✓ WIRED | route :151-158, updated path only |
| assets-registry/index.ts | canvasAssetLinkage.ts | void applyRegistrySelectionToCanvas(u.db, id).catch | ✓ WIRED | :225-229, isPrimaryView===true only |
| canvasAssetLinkage.ts | canvasRelationalStore.ts | selectWinnerInGroup reuse | ✓ WIRED | import + call :141-146 |
| canvasStore.ts | canvasApi.ts | await selectVariantWinner(…) both paths | ✓ WIRED | store :554, :598 |
| canvasApi.ts | POST /api/canvas/v2/variant-groups/:id/select-winner | apiCall fetch | ✓ WIRED | path string matches mounted route exactly |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| -------- | ------------- | ------ | ------------------ | ------ |
| select-winner endpoint | SelectWinnerResult | real DB writes via selectWinnerInGroup (gate :memory: + live child dispatch) | Yes | ✓ FLOWING |
| canvasStore.selectWinner | graph/nodes/edges | selectVariantWinner → mounted endpoint (unit tests mock API by design; endpoint proven live by gate) | Yes | ✓ FLOWING |
| canvasAssetLinkage | CanvasNodeRef[] | real knex lookups (a-oasset- id + json_extract) | Yes | ✓ FLOWING |
| reviewBridge | review items | real fetch, deps injected (gate drives local node:http mock; no static fallback) | Yes (contract) | ✓ FLOWING |

### Behavioral Spot-Checks (all re-run by verifier, not trusted from SUMMARY)

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| SELECT-01 store+endpoint gate | `npm run verify:phase-49` | 79/79 PASS, exit 0 | ✓ PASS |
| SELECT-04 bridge gate (mock platform) | `npm run verify:phase-49-bridge` | 63/63 PASS, exit 0 | ✓ PASS |
| SELECT-03 linkage gate | `npm run verify:phase-49-linkage` | 50/50 PASS, exit 0 | ✓ PASS |
| SELECT-02 frontend suites | `npx vitest run` (3 phase suites) | 19/19 PASS, exit 0 | ✓ PASS |
| Full package regression | `npx vitest run` (infinite-canvas) | 172/172 PASS, 12 files | ✓ PASS |
| Type safety | `npx tsc --noEmit` root + package | both exit 0 | ✓ PASS |
| D-11 external repos frozen | `git status --porcelain` on kais-review-platform app/, kais-hermes-skills plugins/ | 0 dirty files each | ✓ PASS |
| Deviation premise | grep chosen_variant_id/suggested_action in review-platform app/ | 0 hits; platform states PENDING…COMPLETE; kmc predicate resolved/closed | ✓ CONFIRMED |

### Probe Execution

| Probe | Command | Result | Status |
| ----- | ------- | ------ | ------ |
| scripts/verify-phase-49.ts | `npm run verify:phase-49` | 79/79, exit 0 | PASS |
| scripts/verify-phase-49-bridge.ts | `npm run verify:phase-49-bridge` | 63/63, exit 0 | PASS |
| scripts/verify-phase-49-linkage.ts | `npm run verify:phase-49-linkage` | 50/50, exit 0 | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ----------- | ----------- | ------ | -------- |
| SELECT-01 | 49-01 | select-winner 后端端点，事务化写入 | ✓ SATISFIED | Truth 1 |
| SELECT-02 | 49-04 | 前端 selectWinner 改调后端 + 失败回滚 | ✓ SATISFIED | Truth 2 |
| SELECT-03 | 49-03 | 资产中心 ↔ 画布两套选定词汇联动 | ✓ SATISFIED | Truth 3 |
| SELECT-04 | 49-02 | kmc review resolve 桥接 (chosen_variant_id 可被 kmc 轮询读) | ✓ SATISFIED (override — kap 半环) | Truth 4 |

Orphaned requirements: none — REQUIREMENTS.md:261 maps exactly SELECT-01..04 to Phase 49; all four claimed by plans.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| packages/infinite-canvas/src/services/canvasApi.ts | 1012-1029 | TODO markers (composition/loadout 前瞻接缝) | ℹ️ Info | Pre-existing (git blame e0ac43136, 2026-07-31 — predates Phase 49); explicitly listed in 49-CONTEXT deferred ("未排期"). Not this phase's debt |
| src/routes/v1/assets-registry/index.ts | 51-55 | WR-10: manual maxId+1 id assignment race | ⚠️ Warning | Pre-existing, outside the directed fix scope per REVIEW-FIX; documented with remediation recommendation. No code debt marker left in code |
| .planning/REQUIREMENTS.md | 23-26, 228-231 | SELECT-02/03/04 checkboxes + traceability still "[ ]"/Pending although implemented | ℹ️ Info | Documentation tracking lag — update after verification closes (orchestrator) |
| .planning/STATE.md | 6 | "stopped_at: Phase 49 plan 1 of 4 complete" — stale after wave 2 | ℹ️ Info | Same tracking lag; ROADMAP.md itself correctly shows all 4 plans [x] |

No TBD/FIXME/XXX markers in any phase-modified file. No stub patterns: no empty handlers, no static data fallbacks, no console.log-only implementations.

### Human Verification Required

### 1. SC-2 Browser Smoke (from PLAN 49-04 human_check)

**Test:** On the canvas, click a non-winner variant badge → success toast; F5 refresh → winner persists. Then with DevTools network offline, select another variant.
**Expected:** Winner survives refresh; offline selection visibly rolls back with an error toast — no "UI shows new winner but DB never wrote it" divergence.
**Why human:** Visual toast behavior, browser refresh persistence, and offline simulation are not observable via unit gates (vitest mocks the API layer by design).

### 2. SC-3 Bidirectional Refresh Consistency

**Test:** Select a grouped asset in the asset center (handleSelect) → refresh the canvas → same winner shown. Then select a different winner on the canvas → refresh the asset center → same primary shown. (Requires an asset with an `a-oasset-` canvas node placed in a variant group.)
**Expected:** Both sides converge to the same winner in either direction.
**Why human:** Cross-page end-to-end consistency in a real browser; automated gates assert each half-loop at DB/lib level but not the full UI round trip.

### Gaps Summary

No failed truths. Two browser-level checks remain for human confirmation (visual/UX only — the underlying wiring is fully gate-verified). One accepted deviation (SC-4 consumer half) is recorded as an override with independently verified evidence: the kap bridge is contract-correct and fires on every updated selection, but kmc cannot read ANY platform resolve today because its poll predicate (`resolved`/`closed`) never matches the platform's terminal state (`COMPLETE`) and `chosen_variant_id`/`suggested_action` do not exist in the frozen kais-review-platform codebase. This is a cross-repo protocol debt (documented in reviewBridge.ts:35-57 and 49-02-SUMMARY), not an incomplete kap implementation. Pre-existing items (canvasApi TODO seams, WR-10 registry id race) are documented and predate this phase.

---

_Verified: 2026-08-19T10:06:51Z_
_Verifier: Claude (gsd-verifier)_
