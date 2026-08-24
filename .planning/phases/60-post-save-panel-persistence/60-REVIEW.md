---
phase: 60-post-save-panel-persistence
reviewed: 2026-08-24T12:05:00Z
depth: standard
files_reviewed: 14
files_reviewed_list:
  - packages/infinite-canvas/src/components/FlowCanvas.tsx
  - packages/infinite-canvas/src/hooks/useCanvasSocket.ts
  - packages/infinite-canvas/src/main.tsx
  - packages/infinite-canvas/src/services/canvasApi.ts
  - packages/infinite-canvas/src/services/clientTabId.ts
  - packages/infinite-canvas/src/store/__tests__/reloadAnchor.test.ts
  - packages/infinite-canvas/src/store/canvasStore.ts
  - packages/infinite-canvas/test/e2e/mock-backend/server.mjs
  - packages/infinite-canvas/test/e2e/probe-60-real.mjs
  - packages/infinite-canvas/test/e2e/tests/phase59-stale-cascade.mjs
  - packages/infinite-canvas/test/e2e/tests/phase60-panel-persist.mjs
  - scripts/diagnose-60-roundtrip.ts
  - scripts/verify-phase-60.ts
  - src/routes/canvas/v2/save-v2.ts
findings:
  critical: 2
  warning: 2
  info: 5
  total: 9
status: issues_found
---

# Phase 60: Code Review Report

**Reviewed:** 2026-08-24T12:05:00Z
**Depth:** standard
**Files Reviewed:** 14
**Status:** issues_found

## Summary

Reviewed the Phase 60 savedBy self-echo chain end to end (clientTabId → saveCanvasGraph single-point attach → save-v2 zod+conditional echo → FlowCanvas selfEcho skip with FLAG-1 baseline-reset ordering), the Branch-A lock-only anchor semantics (warn-on-miss + reloadAnchor vitest), the e2e/probe/verify tooling, and the mock backend. Diff-scoped against `5550a770^`.

The core phase-60 production change is **sound**: baseline reset precedes the selfEcho early return (FLAG-1 correct, verified against the S2 static lock), the conditional echo preserves the legacy broadcast shape key-for-key, the scope guard prevents cross-project/cross-episode self-echo suppression, and the anchor warn fires only on non-null→null transitions. Documented deviations (D-07 second bridge line, D-03 warn string, test-comment rewordings) were not re-flagged, and the pre-classified savedBy forgeability (Informational, staleness-only) was not re-litigated — no new vector beyond it was found in the echo path itself.

However, two Critical findings exist in the reviewed file set: (1) the zero-footprint restore in both :10588 probes unconditionally overwrites any concurrent external save — a silent data-loss vector on the live server that the post-restore deep-compare cannot detect; (2) a pre-existing envelope-unwrapping bug in `requestNodeScore` (canvasApi.ts, outside the phase diff but in the reviewed file) that surfaces "总分 undefined". The diagnostic probe also has a vacuous-PASS path when its own save fails.

## Critical Issues

### CR-01: Zero-footprint restore blindly overwrites concurrent external writes on the live :10588 server

**File:** `scripts/diagnose-60-roundtrip.ts:331-345`, `packages/infinite-canvas/test/e2e/probe-60-real.mjs:285-303`
**Issue:** Both probes capture `originalGraph` at start, write probe content (diagnose writes the serialized wire; probe-60-real additionally performs a real browser save in segment 2 and two protocol-segment saves), then in `finally` unconditionally POST `saveV2(..., originalGraph)` and poll until load-v2 deep-equals the original. If the kmc pipeline or any live canvas client saves the same scope during the probe window (~15–45s), that concurrent write is **silently reverted** by the restore. The post-restore verification cannot detect this: it compares load-v2 against `originalGraph`, so a clobbered concurrent write still yields "净足迹=0 PASS". Secondary live interference: every probe save broadcasts `graph:saved` without identity, so any canvas client viewing scope 2/1 or 2001/1 receives "Pipeline 同步了新数据" toast + full reload mid-session. The plan documents probe saves and restore semantics (T-60-08/T-60-10), but the concurrent-writer clobber is a distinct data-loss vector not covered by that acceptance, and `verify:phase-60` runs this probe automatically on every gate run.
**Fix:** Guard the restore instead of blind-writing: before restoring, fetch load-v2 and check that current server state still equals the probe's **last-written** graph (excluding meta bookkeeping). If it drifted, abort the restore, print the drift (`firstDiff`), and exit non-zero with a "concurrent writer detected — manual reconciliation required" message. Same guard for probe-60-real's finally block.

### CR-02: `requestNodeScore` returns the response envelope, not the score object — AI score UI shows "总分 undefined"

**File:** `packages/infinite-canvas/src/services/canvasApi.ts:596-603` (call site: `packages/infinite-canvas/src/components/CanvasContextMenu.tsx:174-178`)
**Issue:** `requestNodeScore` does `return await apiCall<any>('/canvas/review/score', ...)`. `apiCall` returns the full parsed JSON envelope (`{ code, data, message }`) — see L114-124 — while the declared return type is `{ overall: number; quality: number; ... }` and the server (`src/routes/canvas/review/score.ts:119-123`) wraps the score as `{ code: 200, data: { score }, msg }`. The caller then reads `score.overall` (→ `undefined`), toasts `AI 评分完成: 总分 undefined`, and writes the whole envelope object into `n.data.aiScore`, polluting downstream aiScore consumers that expect a normalized score shape. Pre-existing (outside the phase-60 diff — the diff only added the `savedBy` attach to this file), but it is incorrect user-visible behavior in a reviewed file.
**Fix:**
```ts
export async function requestNodeScore(...): Promise<{ overall: number; ... }> {
  const json = await apiCall<{ data: { score: { overall: number; quality: number; ... } } }>('/canvas/review/score', {...}, { cancelToken, timeout: 60000 })
  return json.data.score
}
```
(The `any` generic is what let this compile; removing it surfaces the shape mismatch at the boundary.)

## Warnings

### WR-01: diagnose-60-roundtrip layer-1 diff runs even after its own save-v2 failed — vacuous PASS lines and misattribution

**File:** `scripts/diagnose-60-roundtrip.ts:257-292`
**Issue:** When `saveV2(wire)` fails (L258-261), the script records FAIL and sets `adaptedC = adaptedA` with the stated intent "保持引用以跳过层 diff 空跑" — but then unconditionally proceeds to `loadV2` (L263), and on success the else branch (L268-292) **overwrites** `adaptedC` with `adaptV2Graph(loadC)` and runs the layer-1 V2 diff, the wire→loadC attribution, and the V2 anchor spot-check anyway. Since the wire was never persisted, loadC is the untouched server state: layer-1 and its anchor check PASS vacuously (misleading "服务端重组稳定性 PASS" in the report), or FAIL spuriously if a concurrent writer changed state (misattributed to "服务端漂移"). The gate to layer-2/3 (L295) correctly checks `serverLayerAvailable`, making the inconsistency visible. In default non-strict mode the probe exits 0 with these misleading PASS lines.
**Fix:** Gate the load/layer-1 block on save success:
```ts
const sv = await saveV2(scopePid, scopeEid, wire)
if (sv.status !== 200 || sv.json?.code !== 200) {
  note("roundtrip save-v2", false, ...)
  serverLayerAvailable = false
  adaptedC = adaptedA
} else {
  const lc = await loadV2(scopePid, scopeEid)
  ...
}
```

### WR-02: Mock health endpoint attributes ALL save-v2 calls to scope 1/1 — cross-scope eventCount contamination diverges from real backend semantics

**File:** `packages/infinite-canvas/test/e2e/mock-backend/server.mjs:199-219`
**Issue:** `totalEvents = state.calls.filter((c) => c.path === '/api/canvas/v2/save-v2').length` counts every save regardless of project, then reports it as scope `{projectId: 1, episodesId: 1}`'s `eventCount` (the only scope emitted). The real backend emits per-scope counts — and in fact currently emits no `eventCount` at all (FLAG-2 quirk, locked). Two consequences: (a) in the mock, a save for any other project bumps scope 1/1's eventCount; if a page's health-poll baseline was learned before that bump, FlowCanvas fires a false "检测到 pipeline 远端更新" toast + reload (the exact class of false reload phase 60 exists to eliminate). Mitigated today by `playwright.config.mjs` (`workers: 1`, `fullyParallel: false`) and by the 30s poll interval exceeding typical test duration, but it is a latent e2e flake and a mock/production semantic divergence in the channel the FLAG-1 fix was validated against; (b) the mock makes the health-poll channel live in e2e while it is dead in production, so e2e coverage of "no false reload" exercises a path production never takes.
**Fix:** Track event counts per scope in the mock: `state.scopeEvents = new Map()` keyed by `${projectId}:${episodesId}`, incremented in the save-v2 handler, and emit one scope entry per key with its own count (and omit `eventCount` for scopes with zero events to mirror the real shape more closely).

## Info

### IN-01: Server-side `processGraphThumbnails` rewrites the graph before persisting — self-echo skip premise diverges on thumbnailUrl

**File:** `src/routes/canvas/v2/save-v2.ts:63-68` (+ `packages/infinite-canvas/src/components/FlowCanvas.tsx:344-353`)
**Issue:** The selfEcho skip rests on "本地 store 已是 canonical 真相 + 200 确认", but save-v2 mutates `validGraph` via `processGraphThumbnails` (rewriting thumbnailUrl to compressed variants) before `saveFullGraph`. On self-echo skip the client never learns the rewritten URLs until the next external-save reload. Benign (original URLs remain valid; self-heals on next reload) — note it in the D-01 rationale comment or have the save response echo back the transformed graph fields.
**Fix:** Optional: document the accepted divergence in clientTabId.ts/FlowCanvas comment, or return the transformed graph in the save response and merge thumbnail URLs locally.

### IN-02: Health-poll baseline is not reset on project/episode switch (latent)

**File:** `packages/infinite-canvas/src/components/FlowCanvas.tsx:811-835`
**Issue:** On scope change the effect cleanup clears the interval but leaves `lastEventCountRef.current` holding the previous scope's count. First poll of the new scope compares against the stale baseline: a larger new-scope count triggers a false "远端更新" toast + reload immediately after switching; a smaller count silently delays detection of real external updates until the count exceeds the stale baseline. Latent only — dead in production today because the real health route emits no `eventCount` (FLAG-2 locked quirk) — but live against the mock and would activate for real if health.ts ever gains eventCount.
**Fix:** In the effect body (or cleanup), set `lastEventCountRef.current = null` when `projectId`/`episodesId` change, mirroring the invalid-scope branch at L813.

### IN-03: setGraph warn fires twice when selectedNode and detailNode anchor the same missing id

**File:** `packages/infinite-canvas/src/store/canvasStore.ts:436-440`
**Issue:** The warn loop iterates both anchors independently; on the common dblclick path (both anchors = same node, node deleted by other client) two identical `[panel-persist]` warns are emitted. The e2e anchor-miss case tolerates this (`>= 1`), and vitest case d locks only the single-anchor count, so nothing is broken — just console noise that the "恰一次" documentation doesn't quite describe.
**Fix:** Deduplicate by id: `for (const id of new Set([selectedNode?.id, detailNode?.id].filter(Boolean))) ...`

### IN-04: Dead destructuring in selectWinner after D-12 legacy-path removal

**File:** `packages/infinite-canvas/src/store/canvasStore.ts:981`
**Issue:** `const { projectId, episodesId, graph, nodes, edges, variantGroups, setNodes, setEdges, upsertVariantGroup, showToast } = get()` — `nodes, edges, variantGroups, setNodes, setEdges, upsertVariantGroup` are unused since the legacy RF path was reduced to a `console.warn` + return (L1026).
**Fix:** Reduce the destructuring to the used keys: `{ projectId, episodesId, graph, showToast }`.

### IN-05: node:state / execution:progress socket handlers dereference payload without shape guard

**File:** `packages/infinite-canvas/src/hooks/useCanvasSocket.ts:172-180, 198-200`
**Issue:** `payload.nodeId` / `payload.state` are read directly; a malformed or empty broadcast (the mock's `/__mock/emit` control plane accepts arbitrary event/data from any test) throws a TypeError inside the socket handler. Adjacent handlers (`node:created` L191-194, `node:updated` L256-264) added in later phases guard shape first — these two pre-existing handlers were not brought up to the same standard.
**Fix:** Apply the same guard pattern: `if (payload == null || typeof payload.nodeId !== 'string') return`.

---

_Reviewed: 2026-08-24T12:05:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
