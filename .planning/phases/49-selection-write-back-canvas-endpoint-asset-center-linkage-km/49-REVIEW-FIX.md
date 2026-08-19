---
phase: 49-selection-write-back-canvas-endpoint-asset-center-linkage-km
fixed_at: 2026-08-19T16:30:00Z
review_path: .planning/phases/49-selection-write-back-canvas-endpoint-asset-center-linkage-km/49-REVIEW.md
iteration: 1
findings_in_scope: 10
fixed: 10
skipped: 0
status: all_fixed
---

# Phase 49: Code Review Fix Report

**Fixed at:** 2026-08-19T16:30:00Z
**Source review:** .planning/phases/49-selection-write-back-canvas-endpoint-asset-center-linkage-km/49-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope (per orchestrator directive: CR-01 + WR-01..WR-09): 10
- Fixed: 10 (7 atomic commits, `0a175f46..4c0581d0`, all fast-forwarded onto `master`)
- Skipped: 0
- Out-of-scope by directive: WR-10 (pre-existing registry maxId+1 race) and IN-01..IN-05 — see note below

**Verification (all re-run green after the last fix):**
- `npm run verify:phase-49` — **79/79** (was 65)
- `npm run verify:phase-49-bridge` — **63/63** (was 46)
- `npm run verify:phase-49-linkage` — **50/50** (was 42)
- `npx vitest run src/store/__tests__/selectWinner.test.ts` (packages/infinite-canvas) — **9/9** (was 7)
- NEW `npx vitest run src/services/__tests__/canvasApi.test.ts` — **6/6**
- NEW `npx vitest run src/hooks/__tests__/useCanvasSocket.test.ts` — **4/4**
- `npx tsc --noEmit` clean at repo root AND in packages/infinite-canvas

## Fixed Issues

### CR-01 + WR-01 + WR-02: review-bridge candidate scoping

**Files modified:** `src/lib/reviewBridge.ts`, `scripts/verify-phase-49-bridge.ts`
**Commit:** `0a175f46`
**Applied fix:**
- CR-01: candidate filter now requires the `content_ref` episode segment to EQUAL `ep${episodesId}` or the bare `${episodesId}` (both forms until the kmc format is frozen); a phase-matching gate of another episode is a mismatch — fail closed. Verified by probe case (g): `ep-OTHER/p11a0` for episodesId 7 → no POST.
- WR-01: exact phase-token boundary — the leading `p\d+` run of BOTH the gate `type` and the `content_ref` phase segment must EQUAL the derived token (`leadingPhaseToken()`); no `startsWith` remains in the source (gate asserts zero occurrences). Case (h): token `p1` vs gate `p11a0` → no POST.
- WR-02: bounded `next_cursor`/`has_more` pagination (`MAX_LIST_PAGES = 10`); exhausting the bound (or `has_more` without a cursor) → warn + skip instead of approving from a partial list. Cases (i)/(i2): page-2 gate approved via cursor follow; 12-page list bounded at 10 GETs, no POST.
- Gate fixtures updated to the new scoping semantics (positive cases now carry `ep7/…` for `episodesId: 7`); 17 new/replaced assertions.

### WR-03: unmapped/unreachable winner left the old winner's `isPrimaryView = 1`

**Files modified:** `src/lib/canvasRelationalStore.ts`, `src/routes/canvas/v2/select-winner.ts`, `scripts/verify-phase-49.ts`
**Commit:** `f1bfdf98`
**Applied fix:** new exported `demoteAssets(db, projectId, assetIds)` (demotion-only half of D-07, projectId-scoped, returns changed ids). The route now: (a) when the winner is mapped but `syncAssetPrimaryForWinner` no-ops while members are mapped (asset moved projects), runs a demotion-only pass over the members (winner id excluded) and warns loudly; (b) when the winner maps to no `o_assets` row but members do, demotes the mapped members (promote nothing) and warns. Consistent with D-07 "canvas 是真值源, 失败不回滚 canvas 只 warn" — the divergence is now repaired AND loud instead of silent. Regression: store-level `demoteAssets` asserts + endpoint-child case (asset 9001 stale primary demoted, sibling group's primary untouched).

### WR-04: registry→canvas linkage picked an arbitrary episode

**Files modified:** `src/lib/canvasAssetLinkage.ts`, `scripts/verify-phase-49-linkage.ts`
**Commit:** `ce70a761`
**Applied fix:** `findCanvasNodesForAsset` (plural) returns ALL nodes mapping to the asset, deterministic `episodes_id` asc (both the deterministic-id path and the `json_extract` fallback; no un-ordered `.first()` anywhere). `applyRegistrySelectionToCanvas` applies `selectWinnerInGroup` per (episode, group) ref so sibling episodes no longer keep a stale winner, and warns when an asset maps to >1 episode. Singular `findCanvasNodeForAsset` kept as a deterministic lowest-episode wrapper (backward-compatible). Regression: asset 12 mapped in episodes 1+2 → both groups' winner moves, both episodes' `is_winner` flags flip.

### WR-09: server-side `curation:'locked'` guard

**Files modified:** `src/lib/canvasRelationalStore.ts`, `src/routes/canvas/v2/select-winner.ts`, `scripts/verify-phase-49.ts`, `scripts/verify-phase-49-linkage.ts`
**Commit:** `7f140d86`
**Applied fix:** `selectWinnerInGroup` parses each member's `data` blob and returns a new `locked` status when any member's `curation === 'locked'` — mirroring the client's `selectVariant` §11 guard, placed BEFORE the idempotent branch (the client throws on ANY select of a locked group). Route maps `locked` → 409 (`组含 curation:'locked' 成员，不可选定`); the linkage's generic non-updated info-skip handles it (explicitly documented + regression-covered). This closes both bypass surfaces: direct API calls and the registry PATCH → linkage path.

### WR-05 + WR-06: legacy path wrong group + rollback missing `variantGroups`

**Files modified:** `packages/infinite-canvas/src/store/canvasStore.ts`, `packages/infinite-canvas/src/store/__tests__/selectWinner.test.ts`
**Commit:** `536953eb`
**Applied fix:** step 3 now locates the updated group via `.find((g) => g.groupId === variantGroupId)` instead of `[0]` (which was always `groups[0]`); the failure handler snapshots `variantGroups` before the optimistic upsert and restores it alongside nodes/edges (`set({ nodes: rb.nodes, variantGroups: prevGroups })`). Two new tests with the target group deliberately NOT first: success updates `vg-old.winnerNodeId`; failure restores it to the old winner while `vg-other` stays untouched. SelectWinner suite 7 → 9.

### WR-07: `apiCall` disarmed its timeout after attempt 0; 4xx retried

**Files modified:** `packages/infinite-canvas/src/services/canvasApi.ts`, `packages/infinite-canvas/src/services/__tests__/canvasApi.test.ts` (new)
**Commit:** `cecd0f19`
**Applied fix:** each attempt arms a FRESH timeout `AbortController` combined per-attempt with the cancel-token signal (`clearTimeout`/listener detach in a `finally` on the attempt, never across attempts) — a hung retry now times out and the total stays bounded ((MAX_RETRIES+1) × timeout + backoffs). HTTP-status classification: 4xx → `ApiError{type:'business'}` thrown immediately (never retried — deterministic 400/404/409), 5xx → retriable `network`. New test file (6 tests): 409/400 single-fetch immediate failures, 503 retried exactly 3×, hang→timeout with no retry, and retry-attempt-1 hang still bounded (the exact old-bug scenario), plus a success-path sanity check.

### WR-08: `variant:selected` broadcast was a dead letter

**Files modified:** `packages/infinite-canvas/src/hooks/useCanvasSocket.ts`, `packages/infinite-canvas/src/components/FlowCanvas.tsx`, `packages/infinite-canvas/src/hooks/__tests__/useCanvasSocket.test.ts` (new)
**Commit:** `4c0581d0`
**Applied fix:** `useCanvasSocket` exports `VariantSelectedPayload`, a new optional `onVariantSelected` callback (ref-held like every other handler), and registers the `socket.on('variant:selected')` handler. FlowCanvas wires it minimally: scope guard (current project/episode, same as `onGraphSaved`), echo guard (skip when `group.winnerNodeId === payload.winnerNodeId` — the selecting client already applied it optimistically), then `applyGraphTransform(selectVariant(...))` + info toast; a locked/multi mismatch only warns and defers to the next full sync. New jsdom test file (4 tests): handler registered on mount, payload forwarded verbatim, optional-callback safety, disconnect-on-unmount.

## Skipped Issues

### WR-10 (documented, outside the directed fix scope)

**File:** `src/routes/v1/assets-registry/index.ts:51-55`
**Reason:** pre-existing (not introduced by this phase) and the orchestrator directive said to skip unless trivially safe. The suggested fix (drop the manual `maxId + 1` in favor of SQLite auto-assign) changes id-assignment/response semantics on a shared route that other flows insert explicit ids into — not trivially safe to change blind at the tail of a fix wave. Recommend handling in its own change with the create-path tests in place.

Info items IN-01..IN-05: skipped per directive (Info tier out of scope).

---

_Fixed: 2026-08-19T16:30:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
