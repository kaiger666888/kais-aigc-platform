---
phase: 49
plan: "04"
subsystem: frontend
tags: [infinite-canvas, zustand, vitest, canvas, variant-groups, select-winner, wiring]

requires:
  - phase: 49 plan 01
  provides: POST /api/canvas/v2/variant-groups/:groupId/select-winner endpoint (route167)
provides:
  - canvasApi.selectVariantWinner(projectId, episodesId, groupId, winnerNodeId) — apiCall-based client with encodeURIComponent(groupId) (T-49-14)
  - canvasStore.selectWinner dual-path instant persistence — optimistic update → await endpoint → rollback on failure (graph path: prevGraph restore; legacy path: rollbackWinnerSelection)
  - vitest behavior gate (7 cases) covering success×2 / rollback×2 / validation-no-API / context-guard×2
affects: [canvas UI consumers of selectWinner (CanvasContextMenu, VariantPicker — no changes needed), Phase 50 backfill]

tech-stack:
  added: []  # zero new dependencies (D-05 / T-49-SC)
  patterns:
    - "split-try optimistic rollback: pure-function validation in its own try (throw provably pre-await → no API call, no partial apply), then setGraph, then API try/catch that restores the captured prev reference"
    - "store-test harness: vi.mock the whole canvasApi module + zustand setState injection with showToast spy (no real timers) + global fetch stubbed to throw (zero-network proof)"

key-files:
  created:
    - packages/infinite-canvas/src/store/__tests__/selectWinner.test.ts
  modified:
    - packages/infinite-canvas/src/services/canvasApi.ts
    - packages/infinite-canvas/src/store/canvasStore.ts

key-decisions:
  - "Split-try instead of single try with flag: selectVariant's synchronous validation throw is syntactically isolated before any await, making the 'no API call on validation failure' invariant provable from control flow (acceptance criterion)"
  - "selectVariantWinner goes through apiCall (POST semantics identical to saveCanvasGraph family, 15s timeout / 2 retries per T-49-15 accept) rather than the bare-fetch updateAsset pattern"
  - "Missing projectId/episodesId now early-exits with a warning toast (plan-specified) — approveNode/rejectNode return silently in the same situation; selectWinner must not fake success since D-04 makes persistence the contract"
  - "showToast replaced with a vi.fn() spy in tests instead of asserting on real toast state — avoids real 3s setTimeout in vitest node env and asserts toast types for free"

patterns-established:
  - "Pattern: prev-reference capture + split-try for optimistic-rollback actions on the canonical graph (extends the approveNode/rejectNode family with a validation-phase that must never reach the network)"

requirements-completed: [SELECT-02]

duration: 25min
completed: 2026-08-19
---

# Phase 49 Plan 04: SELECT-02 前端接线 Summary

**canvasStore.selectWinner dual-path (V3 graph + legacy RF) wired to POST select-winner with instant persistence and provable rollback — zero visual changes (D-05), guarded by 7 vitest behavior cases.**

## Performance

- **Duration:** ~25 min (03:18–03:28 UTC)
- **Started:** 2026-08-19T03:18:00Z (worktree fresh at dd66f50b, committed 03:17:45Z)
- **Completed:** 2026-08-19T03:28:00Z
- **Tasks:** 2/2
- **Files modified:** 3 (1 created, 2 modified)

## Commits

| Task | Commit | Type |
| ---- | ------ | ---- |
| Task 1 | 29ca4eeb | feat(49-04): wire selectWinner to select-winner endpoint with rollback |
| Task 2 | 5c86d786 | test(49-04): add selectWinner dual-path behavior tests (7 cases) |

## Accomplishments

- **API client** (`canvasApi.ts`): `selectVariantWinner(projectId, episodesId, groupId, winnerNodeId)` → `apiCall('/canvas/v2/variant-groups/' + encodeURIComponent(groupId) + '/select-winner', {...})`, JSDoc citing the 49-01 contract (D-01 transactional write / D-03 idempotent 200 no-op / 404-409-400 semantics / non-2xx throws ApiError).
- **Graph path (canonical V3)**: `prevGraph` captured before `setGraph`; `selectVariant` validation (selectMode!=='single' / dangling winner / curation:'locked' member) runs in its own try **before any await** — on throw: error toast, no partial apply, no API call. On pass: `setGraph(next)` then `await selectVariantWinner(...)`; API failure → `setGraph(prevGraph, warnings)` + `选定失败已回滚` error toast. The stale "此处不调后端" comment (:536-537) replaced with the Phase 49 persistence note.
- **Legacy RF path**: `applyWinnerSelection` outcome + optimistic set unchanged; appended `await selectVariantWinner(projectId, episodesId, variantGroupId, nodeId)`; catch → `rollbackWinnerSelection(outcome)` restores nodes+edges + error toast — the `void outcome / void rollbackWinnerSelection` placeholders (:574-576) are now real control flow.
- **Context guard**: missing projectId/episodesId → `缺少项目上下文` warning + early return (no fake success).
- **Interface**: `selectWinner: (nodeId: string) => Promise<void>`; both existing call sites are fire-and-forget void calls, transparently compatible.
- **Behavior gate** (`selectWinner.test.ts`, 7 cases): graph success (exact API args asserted) / graph API-failure rollback to node-a / multi-mode validation → 0 API calls / legacy success (isWinner set + API args) / legacy failure → prevSnapshot nodes+edges restored (incl. isInactive edge states) / missing projectId / missing episodesId. Whole `canvasApi` module mocked, global `fetch` stubbed to **throw** (zero-network proof), real `selectVariant` validation exercised.

## Verification Evidence

- `packages/infinite-canvas`: `npx tsc --noEmit` → exit 0
- `packages/infinite-canvas`: `npx vitest run src/store/__tests__/selectWinner.test.ts` → exit 0, **7/7 pass**
- Repo root: `npx tsc --noEmit` → exit 0
- `npm run verify:phase-49` → exit 0, **65/65 assertions PASS** (backend no regression from wave-2 worktree)
- **Forced-failure sanity performed**: flipped graph-rollback expectation to `'FORCED-FAILURE-SANITY'` → run exited 1 with `AssertionError: expected 'node-a' to be 'FORCED-FAILURE-SANITY'` → restored → re-verified 7/7 green
- **D-05 zero-visual check**: `git diff --name-only dd66f50b..HEAD | grep -E "\.css$|\.scss$|\.tsx$"` → no matches (store/api/test .ts only)
- `grep -c "selectVariantWinner"` → canvasApi.ts: 1, canvasStore.ts: 3

## Call-Site Compatibility (acceptance inventory)

`grep -rn "selectWinner("` in components — exactly two, both unchanged and void-called:
- `packages/infinite-canvas/src/components/CanvasContextMenu.tsx:226` — `selectWinner(nodeId)`
- `packages/infinite-canvas/src/components/variants/VariantPicker.tsx:46` — `selectWinner(candidateId)`

async-ification is transparent for both (result not consumed).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocker] Fresh worktree had no node_modules — tsc/vitest could not resolve react/@xyflow/react**
- **Found during:** Task 1 verification (first `npx tsc` emitted ~570KB of TS2307 "Cannot find module 'react'" errors)
- **Issue:** the w49-04 worktree is a fresh checkout; neither root nor `packages/infinite-canvas` node_modules existed. All dependency manifests (`package.json`, `yarn.lock`, `package-lock.json`) are byte-identical between the main checkout and dd66f50b (verified `git diff --stat HEAD dd66f50b -- <manifests>` → empty).
- **Fix:** symlinked `node_modules` (root) and `packages/infinite-canvas/node_modules` from the main checkout at the same commit — zero network, zero package substitution (not the excluded package-install case; all packages already pinned and installed at the identical commit). Symlinks are gitignored, working tree stays clean.
- **Files modified:** none (untracked symlinks only)
- **Commit:** n/a (environment setup)

**2. [Rule 1 - Bug] Test-file union-type narrowing + unexported interface**
- **Found during:** Task 2 `tsc --noEmit`
- **Issue:** (a) `graph.nodes.find(...)?.curation` fails — `FlowNodeV3` is a union and only `AssetNodeV3` has `curation`; (b) `CanvasState` is declared but not exported from canvasStore.
- **Fix:** (a) `curationOf(graph, id)` helper narrowing on `n.kind === 'asset'`; (b) cast showToast spy via exported `ToastItem['type']` instead.
- **Files modified:** packages/infinite-canvas/src/store/__tests__/selectWinner.test.ts
- **Commit:** 5c86d786 (part of the green test state)

### Plan-shape notes (no action needed)

- Task 2 carries `tdd="true"` but the plan orders implementation (Task 1) before tests (Task 2); a literal RED phase (failing test against unimplemented store) was impossible without reverting Task 1. The RED gate is satisfied by the plan's own mandated forced-failure sanity (expectation flipped → exit 1 → restored), documented above. No separate RED/GREEN commits — one `test(49-04)` commit per the plan's task decomposition.
- Checker exec-note honored: the "selection rejected" fixture uses `selectMode:'multi'` (member `curation:'locked'` is a separate guard in selectVariant); fixture enums shaped from `packages/flowgraph-v3/ts/src/variants.ts` as validated.

## Authentication Gates

None.

## Known Stubs

None — every code path added is live: the API call, both rollback branches, and the context guard are all exercised by the behavior gate. The optional human smoke check from the plan's `<human_check>` (dev-server click + F5 persistence + offline rollback) is a non-blocking manual verification, not a stub.

## Threat Flags

None — implementation covers the plan's threat model: T-49-14 (encodeURIComponent on groupId in path), T-49-16 (dual-path rollback asserted by tests), T-49-15/T-49-SC accepted as-is (apiCall family defaults, zero new dependencies). No security-relevant surface beyond the plan.

## Self-Check: PASSED

Created/modified files verified on disk (`selectWinner.test.ts`, `canvasApi.ts`, `canvasStore.ts`); both task commits (29ca4eeb, 5c86d786) present on gsd/w-49-04. STATE.md / ROADMAP.md / REQUIREMENTS.md untouched per parallel-execution contract (orchestrator merges centrally).
