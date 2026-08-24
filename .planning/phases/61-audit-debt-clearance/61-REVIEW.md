---
phase: 61-audit-debt-clearance
reviewed: 2026-08-24T06:24:15Z
depth: standard
files_reviewed: 13
files_reviewed_list:
  - packages/flowgraph-v3/ts/src/migrate.ts
  - packages/flowgraph-v3/ts/src/v2types.ts
  - packages/flowgraph-v3/ts/tests/migrate.test.ts
  - packages/infinite-canvas/src/components/FlowCanvas.tsx
  - packages/infinite-canvas/src/components/assetManager/AssetLibrary.tsx
  - packages/infinite-canvas/src/components/assetManager/assetManager.css
  - packages/infinite-canvas/src/main.tsx
  - packages/infinite-canvas/src/services/canvasApi.ts
  - packages/infinite-canvas/src/v3/__tests__/serialize.test.ts
  - packages/infinite-canvas/test/e2e/mock-backend/server.mjs
  - packages/infinite-canvas/test/e2e/tests/phase61-debt.mjs
  - scripts/verify-phase-61.ts
  - src/lib/__tests__/reviewBridge.test.ts
  - src/lib/reviewBridge.ts
findings:
  critical: 0
  warning: 3
  info: 6
  total: 9
status: issues_found
---

# Phase 61: Code Review Report

**Reviewed:** 2026-08-24T06:24:15Z
**Depth:** standard
**Files Reviewed:** 13
**Status:** issues_found

## Summary

Reviewed the four phase-61 debt clearances at standard depth, tracing the drag-in chain across module boundaries (AssetLibrary dragstart → ViewModeButton dragover → FlowCanvas onDrop → `placeNewAsset` → `placeAssetNode` → real server route `src/routes/canvas/v2/nodes.ts` → socket `node:created` → `addNodeFromSocket`), the reviewBridge trailing-slash fix + its node:test lock, the buildMeta 5-field read-back + round-trip test, and the verify-phase-61 aggregate gate.

**What holds up well:**

- The drag payload is genuinely low-risk as claimed: `payload.id` is type-checked as a finite number before `asset-${payload.id}` id construction (no string injection into node ids), the payload is parsed defensively in try/catch, and the POST goes through the real zod-gated route (`nodeInputSchema` + `validateNodeData`, which rejects non-string `filePath`/`label`/`assetType` for type `'asset'` via `z.string().min(1).nullish()`). A forged cross-origin MIME drop is server-gated to a 400 — equivalent to a user click, no privilege escalation.
- DEBT-03 (buildMeta 5-field read-back) is correct: the emotion dual-type typeof guards are sound, `flattenMeta` spreads `{...rest}` generically on the write side (no gap), and the round-trip test correctly passes `rawDataByNodeId = null` (strictest mode) plus a JSON clone to cut reference aliasing. The `checkMetaCounts` lock counts (`d.emotion != null` == 2, others == 1 each) were verified against the actual source.
- DEBT-02 (trailing slash) is correctly fixed and the test asserts the URL literal (not "request succeeded"), which would indeed go red if the slash were dropped again. The verify gate's forced-failure mutants (F1/F2/F3) all provably falsify their locks.
- Client trailing-slash POST `/api/canvas/v2/nodes/` against the real Express mount `/api/canvas/v2/nodes` + `router.post("/")` resolves correctly (Express non-strict routing, `const app = express()` with default options).
- The mock's 409-envelope-vs-real-HTTP-409 divergence converges at the client: both paths yield `ApiError(..., 'business', 409)`, so `placeAssetNode`'s `err.code === 409` check works identically in mock e2e and production.

**Key concerns:** the drag-in success path has no degraded-network fallback (socket down → node persisted but invisible, retry → misleading 409); the placed node omits `data.assetId`, breaking the existing registry-linkage convention and limiting dedup to same-convention id collisions; and one e2e assertion races with an in-flight request. Documented deviations (ApiError `.code` vs `.status`, mock logCall placement, css dead-style cleanup, onDrop MIME pre-guard, S2 `setNodes(` call-syntax anchor, emotion dual-type widening) were verified and are **not** re-flagged.

No Critical findings — no security vulnerability, data loss, or crash could be proven in the changed code.

## Warnings

### WR-01: Drag-in success path has no fallback when the socket is disconnected — persisted node stays invisible, retry yields misleading 409

**File:** `packages/infinite-canvas/src/components/FlowCanvas.tsx:475-486` (cross-ref `packages/infinite-canvas/src/hooks/useCanvasSocket.ts:124-125,274-284`, `src/socket/index.ts:31-53`)
**Issue:** The success path is documented as "成功路径零本地写" and relies entirely on the server's `node:created` socket broadcast reaching `onNewAsset → addNodeFromSocket`. But the reconnect replay channel that could compensate for a missed broadcast is gated off: `eventReplayEnabled = import.meta.env.VITE_CANVAS_EVENT_REPLAY === '1' && !!onCanvasEvent` and FlowCanvas never passes `onCanvasEvent`, so the server-side `subscribe`/`since` replay (src/socket/index.ts) is dead for this page. The health-poll fallback also can't help — the real `/api/canvas/v2/health` does not emit `eventCount` (FLAG-2, documented in the mock). Net effect: if the socket is down or drops at the moment of the drop, the POST returns 200 and the node is durably stored server-side, but the canvas shows nothing; the user re-drags and gets "该资产已在画布上" for a node they cannot see, until an unrelated reload occurs. UI truth diverges from server truth with no self-heal.
**Fix:** After a successful `placeAssetNode`, add a bounded idempotent fallback — poll the canonical graph briefly and locally apply `addNodeFromSocket` if the broadcast never arrived (it is idempotent: same-id replay is a warn+false no-op, so double-application is impossible):

```ts
if (result.ok) {
  // degrade fallback: socket 断线时 node:created 广播不可达(eventReplay 未启用)
  // — 2s 后 canonical 图仍无该节点则本地幂等补写(同 id 重播 addNodeFromSocket 内部去重)
  window.setTimeout(() => {
    const st = useCanvasStore.getState()
    if (st.graph && !st.graph.nodes.some((n) => n.id === node.id)) {
      st.addNodeFromSocket(node as Record<string, unknown>, position)
    }
  }, 2000)
  return
}
```

This also seeds `rawDataByNodeId` via `addNodeFromSocket`, which the broadcast path already does.

### WR-02: Placed node omits `data.assetId` — breaks the existing canvas↔registry linkage and limits 409 dedup to `asset-${id}`-convention collisions

**File:** `packages/infinite-canvas/src/components/FlowCanvas.tsx:460-474`
**Issue:** The node's data bag is `{ label, assetType, filePath }` only. Three established conventions expect `data.assetId`:
1. The mock fixture's own asset node shape (`server.mjs:62` — `data: { ..., assetId: 1 }`), mirroring pipeline-written nodes.
2. `StoryboardTimeline.assetIdOf` (`StoryboardTimeline.tsx:275-287`) reads `raw.assetId ?? raw.asset_id` as the canonical link from canvas node to the assets registry (drives `isPrimaryView`/`state` sync) — for drag-in nodes this linkage is dead.
3. `canvasApi.ts:225-227` documents "当画布节点的 data.filePath 缺失时，可通过 assetId 异步补全" — same linkage.

Additionally, duplicate detection is id-keyed only: the 409 path fires solely when a node with id `asset-${id}` already exists. Pipeline-placed copies of the *same* registry asset use different id schemes (e.g. `a-scene_refs-S01`), so dragging an asset that is already on the canvas under a pipeline id silently creates a duplicate node (no 409, two nodes for one registry asset).
**Fix:** Carry the linkage in the data bag (one line, server-safe — `data` is `z.record(z.string(), z.any())` and `canvasAssetSchema` strips unknown keys only for validation):

```ts
data: {
  label: payload.name || payload.uuid,
  assetType: payload.assetType,
  filePath: payload.filePath ?? null,
  assetId: payload.id,        // registry PK — StoryboardTimeline.assetIdOf / filePath 补全链路
  assetUuid: payload.uuid,    // stable uuid for cross-id-scheme dedup checks
},
```

Optionally add a client-side pre-check (`graph.nodes.some(n => raw?.assetId === payload.id)`) to give the same "已在画布" toast for pipeline-placed duplicates.

### WR-03: e2e `drag-in-duplicate-409` asserts exactly-2 POST log entries without a completion gate for the second POST — race with in-flight request

**File:** `packages/infinite-canvas/test/e2e/tests/phase61-debt.mjs:135-142`
**Issue:** After `dropOnPane` dispatches the second synthetic drop, the test immediately reads `/__mock/calls` via `getCalls(page)` and asserts `nodeCalls.length === 2`. The second POST is only *initiated* (fetch called synchronously in the drop handler) when `page.evaluate` resolves; `getCalls` travels over Playwright's `page.request` connection (`helpers.mjs:68-71`), a different HTTP connection from the browser's fetch — there is no happens-before guarantee that the mock server has logged POST #2 before serving `/__mock/calls`. Under CPU load / CI jitter the count can read 1 and the assertion flakes. Test 1 avoids this by polling for graph-node presence (which transitively gates the POST completion) before reading calls; test 2's only gate covers the *first* drop.
**Fix:** Poll for the second log entry before asserting exact counts:

```js
await dropOnPane(page, 700, 400)
await expect
  .poll(async () => (await getCalls(page))
    .filter((c) => c.method === 'POST' && c.path === '/api/canvas/v2/nodes/').length,
    { timeout: 10_000 })
  .toBe(2)
const nodeCalls = (await getCalls(page))
  .filter((c) => c.method === 'POST' && c.path === '/api/canvas/v2/nodes/')
```

## Info

### IN-01: Drop handler validates id/uuid/name but not assetType/filePath — defensive-parse claim incomplete

**File:** `packages/infinite-canvas/src/components/FlowCanvas.tsx:430-444`
**Issue:** The T-61-01/T-61-03 comment claims "dataTransfer 载荷 defensively 解析(字段类型强校验)", but only `id` (finite number), `uuid`, and `name` (strings) are checked. A forged payload with `assetType: 123` or `filePath: {}` passes the client gate and surfaces as `放置失败: HTTP 400` (server's `validateNodeData` rejects non-string values) instead of the intended `拖入载荷无效` client-side rejection. No security impact (server-gated), but the client validation is inconsistent with its own contract and the two toast messages describe the same forged-payload case differently.
**Fix:** Extend the guard: `typeof payload.assetType !== 'string'` → reject; and coerce/validate `filePath` — `(typeof payload.filePath === 'string' || payload.filePath == null)` → reject otherwise.

### IN-02: Mock /nodes route diverges from the real route on HTTP status semantics and skips validateNodeData

**File:** `packages/infinite-canvas/test/e2e/mock-backend/server.mjs:229-246` (vs `src/routes/canvas/v2/nodes.ts:48-97`)
**Issue:** The mock returns 400/409 as HTTP 200 + `{code:400|409}` envelopes; the real route returns actual HTTP 400/409 statuses. Client behavior converges (both yield `ApiError` with `.code` set), so nothing is broken today, but any future regression that branches on HTTP status (or changes retry semantics for 5xx, which the mock has no path for) would pass mock e2e while failing in production. The header documents the minimal-contract decision ("mock 只锁 e2e 消费的最小契约"), so this is recorded as a fidelity note, not a defect: skipping `validateNodeData` in the mock means a client regression sending data that the real server would 400 is invisible to this e2e file.
**Fix:** If mock fidelity is ever tightened, emit `res.status(409).json({code:409,...})` / `res.status(400)...` to match the real route, and optionally mirror `validateNodeData` for the `'asset'` type only.

### IN-03: Placed node uses `branchId: 'main'` while the canonical V3 graph uses `'br_main'`

**File:** `packages/infinite-canvas/src/components/FlowCanvas.tsx:463`
**Issue:** The adapter normalizes all loaded nodes to `branchId` `'br_main'` (`adapter.ts:193`), and `graph.branches` entries carry id `br_main`. The drag-in node hard-codes `'main'` (a legacy-RF convention). Rendering is unaffected (stage-keyed layout), but `BranchPanel.tsx:79` counts nodes via `n.data?.branchId === b.id` — drag-in nodes will never be counted under any branch, and any future branch-scoped filtering keyed on `br_main` would silently exclude them. Legacy styling code (`styles.ts:69`, `branchColors.ts:45`) treats `'main'` specially, so both conventions coexist — the new write path picked the one that doesn't match the V3 canonical graph it lands in.
**Fix:** Use the adapter's canonical default: `branchId: 'br_main'` (or derive from the loaded graph: `useCanvasStore.getState().graph?.branches[0]?.id ?? 'br_main'`).

### IN-04: reviewBridge approve URL interpolates optional, unencoded `target.id`

**File:** `src/lib/reviewBridge.ts:244-246` (with `ReviewListItem.id?: number | string` at `:81-85`)
**Issue:** `` `${baseUrl}/api/v1/reviews/${target.id}/approve` `` — `id` is optional in the interface and never encoded. A list item missing `id` produces `/api/v1/reviews/undefined/approve` (platform 404 → warn+skip; benign but noisy), and a string id containing `/`, `?`, or `%` would be interpolated raw into the path. Data source is the internal review platform's own list response, so this is hardening, not an exploitable injection.
**Fix:** `if (target.id == null) { logger.warn(...); return; }` before the approve call, and `` `${baseUrl}/api/v1/reviews/${encodeURIComponent(String(target.id))}/approve` ``.

### IN-05: buildMeta 5-field read-back — only `emotion` has typeof guards; the other four pass through unguarded

**File:** `packages/flowgraph-v3/ts/src/migrate.ts:273,283,314-315` (guarded contrast at `:257,:291`)
**Issue:** The DEBT-03 comment for emotion states "typeof 守卫即静态网（勿 cast），错配值不进 meta（宽容降级，同 stale 风格）", but `promptMeta`, `murchGrade`, `archetype`, `viewAngle` are spread through with only `!= null` checks. A malformed V2 value (e.g. `murchGrade: 7` or `promptMeta: "oops"`) flows into `meta` and only surfaces if downstream zod (`validateFlowGraphV3` / save-v2) runs — in a load path without that validation the invalid meta persists silently. This matches the file's pre-existing passthrough style for `cameraMovement`/`hookType`/etc., so it is a consistency note on the new code, not a regression.
**Fix:** If the "宽容降级" contract is meant to hold for the new fields, add the same one-line guards (`typeof d.murchGrade === 'string'`, `promptMeta` as a plain-object check), or state explicitly in the DEBT-03 comment that these four rely on the zod strict union as the regression net (the migrate.test.ts header already implies this).

### IN-06: verify gate S3 anchors are non-colocated substrings — lock can pass with the literal outside the function

**File:** `scripts/verify-phase-61.ts:211-214`
**Issue:** `canvasApiSrc.includes("placeAssetNode") && canvasApiSrc.includes("'/canvas/v2/nodes/'")` checks two substrings anywhere in the 1300-line file. If `placeAssetNode` were refactored to post a different path while the literal survived in a comment (or vice versa), S3 stays green. The F-segment forced-failure self-check covers S1/S2/S4 but has no mutant proving S3 can fail. All other S3 anchors (`anchor: 'source'` count === 1, retired-token recursive scan) are exact-count or negative and fine.
**Fix:** Anchor both tokens to the function body the way S2 slices the `onNewAsset` block — e.g. slice `canvasApi.ts` from `async function placeAssetNode` to the next `export` and assert the sliced block contains `'/canvas/v2/nodes/'`.

---

_Reviewed: 2026-08-24T06:24:15Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
