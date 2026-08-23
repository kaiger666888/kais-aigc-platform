---
phase: 59-narrow-trigger-stale-cascade
reviewed: 2026-08-23T18:28:07Z
depth: standard
files_reviewed: 16
files_reviewed_list:
  - packages/infinite-canvas/src/components/FlowCanvas.tsx
  - packages/infinite-canvas/src/components/eventParams/EventParamsPopover.tsx
  - packages/infinite-canvas/src/components/panel/NodeDetailPanel.tsx
  - packages/infinite-canvas/src/hooks/useCanvasSocket.ts
  - packages/infinite-canvas/src/services/canvasApi.ts
  - packages/infinite-canvas/test/e2e/mock-backend/server.mjs
  - packages/infinite-canvas/test/e2e/probe-59-real.mjs
  - packages/infinite-canvas/test/e2e/tests/phase59-stale-cascade.mjs
  - scripts/verify-59-dispatch.ts
  - scripts/verify-phase-59.ts
  - src/routes/canvas/_engine.ts
  - src/routes/canvas/_simulate.ts
  - src/routes/canvas/_stale.ts
  - src/routes/canvas/execute.ts
  - src/routes/canvas/orchestrate.ts
  - src/routes/canvas/v2/import-from-dir.ts
findings:
  critical: 3
  warning: 4
  info: 4
  total: 11
status: issues_found
---

# Phase 59: Code Review Report

**Reviewed:** 2026-08-23T18:28:07Z
**Depth:** standard
**Files Reviewed:** 16
**Status:** issues_found

## Summary

Reviewed the 16 in-scope files (server: `_engine`/`_simulate`/`_stale`/`execute`/`orchestrate`/`import-from-dir`; client: FlowCanvas/socket/popover/panel/canvasApi; tests: mock backend, e2e, probe, verify gates) at standard depth, with cross-file tracing into `useStale`, `useStaleRerun`, `canvasRelationalStore`, `ws.ts`, `middleware.ts`, `flowgraph-v3/stale.ts`/`migrate.ts`, and `app.ts` to verify load-bearing claims.

The narrow-trigger stale cascade core is well built: the `..`-normalization in `ossToEnginePath` is correct against escape payloads (`../../etc/passwd`, `a/../../b`), `markStaleDownstream` reuse honors the §13 constitution (no self-mark, locked terminal, earliest-since), the `_stale.ts` diff-only-incremental write avoids overwriting existing `since`, the `regenSource` zod enum is genuinely enforced by `validateFields` safeParse (400 on forgery), and the FLAG-3 separation (node:updated as an independent socket handler, never routed through `normalizeSocketNodeState`) is implemented as claimed.

However, the adversarial pass found three BLOCKER-class defects: (1) the client-controlled `params` record — newly wired through to the engine this phase — spreads verbatim into engine task `params`, nullifying the very `ref_images` traversal whitelist this phase advertises as its key security surface; (2) the `node:updated` stale broadcast carries no episodesId and the client handler has no scope guard, enabling cross-episode stale contamination that persists to the DB; (3) `import-from-dir` exposes arbitrary host directories to the unauthenticated `/oss` static mount via a symlink created from an unsanitized `workdir` (pre-existing, in-scope file). Four warnings cover an orchestrate regression for legacy-blob projects, stuck-`running` nodes on execute early-exit paths, whole-graph cascade loss on legacy graphs with unsupported node types, and a recipe-dropping edge in the reroll-seed popover.

Known documented deviations were not re-flagged: mock `suppressGraphSaved` knob; `simulateOnly` branches when `GOLD_TEAM_URL` unset or no prompt; cloud-path dreamina CLI accepting no seed; the SC4 write-write race (Pitfall 4, planner-deferred).

## Critical Issues

### CR-01: Client-controlled `params` bag spreads verbatim into engine task params — bypasses the ref_images traversal whitelist and the model_preference policy

**File:** `src/routes/canvas/execute.ts:81-86`, `src/routes/canvas/_simulate.ts:163-172`, `src/routes/canvas/_engine.ts:113-130`
**Issue:** This phase wired the previously accepted-and-ignored `params` field through to the engine (`execute.ts:81-86` → `overrides.params` → `_simulate.ts:170` spreads it into `metadata` → `_engine.ts:125` spreads `metadata` directly into `payload.params`). The zod contract is `z.record(z.string(), z.unknown())` — an arbitrary, unvalidated key/value bag from the request body. Consequently a caller of `/api/canvas/execute` can inject any engine param key, including:

- `ref_images` — completely bypassing `ossToEnginePath` (the T-59-01 path-traversal mitigation this phase was built around). Raw unvalidated host paths (`/etc/...`, `/home/...`) reach the engine container, which has host mounts. The mitigation only sanitizes the server-side `referenceImages` input of `submitEngineTask` (`_engine.ts:106-108`); the `...input.metadata` spread happens after it and re-introduces the key unguarded.
- `model_preference` — `_engine.ts:129` only forces `cloud` for `image*` tasks; for `video_final`/`tts`/`music`/`sfx` tasks a forged `params.model_preference` lands verbatim, contradicting the A3 policy that this is a server constant ("model_preference 服务端常量非用户输入").
- `prompt`, `nodeId`, `projectId`, `episodesId`, `nodeType`, `originalNodeId` — all overridable inside engine `params` after the server-set values.

The routes run without auth ("V6.0 API routes: pass through without auth", `app.ts:336`), so this is a genuine external input surface, not a trusted-caller assumption. The Security V5 note in `execute.ts:32-36` reasons that forged signals only cause "one extra stale badge" — that argument covers `regenSource` (correctly enum-whitelisted) but does not hold for the params bag, which reaches engine execution.
**Fix:** Whitelist what may flow from client `params` into engine metadata instead of spreading the whole record. Minimal hardening:

```ts
// _simulate.ts — replace `...(overrides?.params ?? {})` with a filtered flatten
const CLIENT_PARAM_KEYS = new Set(["seed", "steps", "cfg", "quant", "sageAttention", "negative"]);
const clientParams = Object.fromEntries(
  Object.entries(overrides?.params ?? {}).filter(([k]) => CLIENT_PARAM_KEYS.has(k)),
);
// metadata: { nodeType, originalNodeId: nodeId, ...seed, ...clientParams }

// _engine.ts — defense in depth: scrub reserved keys after the metadata spread
const RESERVED = new Set(["ref_images", "model_preference", "prompt", "nodeId", "projectId", "episodesId", "nodeType", "originalNodeId"]);
for (const k of Object.keys(input.metadata ?? {})) {
  if (RESERVED.has(k)) delete params[k]; // or throw
}
```

### CR-02: `node:updated` stale broadcast carries no episodesId scope and the client handler has no guard — cross-episode stale contamination that persists to the DB

**File:** `src/routes/canvas/_stale.ts:84-87`, `packages/infinite-canvas/src/components/FlowCanvas.tsx:379-399`
**Issue:** The socket room is `project:{projectId}` only (`ws.ts` `broadcastToProject`), so **all episodes of the same project share one room**. Every other broadcast consumer in the same `useCanvasSocket` call guards scope by `payload.projectId === projectId && payload.episodesId === episodesId` (`onGraphSaved` FlowCanvas:331-336, `onGateState`:354-356, `onVariantSelected`:363-364). The new `onNodeUpdated` deliberately omits the guard ("socket room 即 project:{id} … 无跨项目串扰面,无需 scope 守卫") — the reasoning covers cross-*project* leakage but misses cross-*episode* leakage within the same room. Worse, the server payload makes a client-side guard impossible: `markStaleAndBroadcast` emits `{ node: {...row, data} }` where `row` comes from `listNodes` (FlowNodeV2-shaped, no `episodesId` field).

Concrete contamination path: `import-from-dir` generates deterministic node ids per phase (`p04`, `a-p04-art0` …, `import-from-dir.ts:702,651`) that are identical across episodes of the same project (each episode is a separate relational scope but shares the id space). User A regenerates `a-p04-art0` in episode 1 → `node:updated` broadcast → user B's client, viewing episode 2 of the same project, receives it, passes the shape guard, and calls `triggerStaleCascade(['a-p04-art0'])` against **its own episode-2 graph** → episode 2's `a-p04-art0` and its downstream get `stale` marks (with episode-2-local `Date.now()` as `since`) → B's next save-v2 persists bogus stale rows into episode 2's DB. That is silent cross-episode data corruption, not just a cosmetic badge.
**Fix:** Thread the scope through the wire and guard on the client, matching the established pattern:

```ts
// _stale.ts
broadcastToProject(projectId, "node:updated", {
  projectId, episodesId,            // add scope to the payload
  node: { ...row, data },
  changedFields: ["data.stale"],
});

// FlowCanvas.tsx onNodeUpdated — add the same two-line guard as onGateState
if (!projectId || episodesId == null) return
if (payload.projectId !== projectId || payload.episodesId !== episodesId) return
```

(The mock backend's `replayStaleCascade` should mirror the payload shape.)

### CR-03: `import-from-dir` exposes arbitrary host directories to the unauthenticated `/oss` web mount via an unsanitized `workdir` symlink

**File:** `src/routes/canvas/v2/import-from-dir.ts:1983-1986, 2004-2030` (with `src/app.ts:72, 317-336`)
**Issue:** `workdir` is validated only as `z.string().min(1)` plus "exists and is a directory" — no root restriction (compare the iteration routes, which zod-constrain `workdir` under `/data/workspace`). The handler then creates `data/oss/{basename(workdir)} → workdir` and the `/oss` static chain serves it with no authentication (`/oss` is registered at `app.ts:72` before the auth middleware, and canvas API routes are auth-pass-through). Net effect: a single unauthenticated POST with `workdir: "/home/kai"` creates `data/oss/kai → /home/kai`, after which `GET /oss/kai/.ssh/id_ed25519` (or any other readable file under that tree) is served over HTTP. The scan half of the route also reads and imports every JSON/media file under the chosen directory. This is pre-existing (this phase only touched `fsToOssUrl` in this file), but it is a standing directory-disclosure + arbitrary-read hole in an in-scope file and directly undermines the "ossToEnginePath whitelist" story this phase leans on (`/oss/<anything>` inputs are presumed server-curated; this route lets a client mint new `/oss/` roots at will).
**Fix:** Constrain `workdir` to the sanctioned roots before any scanning or symlink creation:

```ts
const ALLOWED_WORKDIR_ROOTS = ["/data/workspace/", "/mnt/agents/output/"];
const abs = path.resolve(workdir);
if (!ALLOWED_WORKDIR_ROOTS.some((r) => abs.startsWith(r))) {
  return res.status(400).send(error("workdir 必须位于允许的根目录下"));
}
```

Also consider rejecting `basename(workdir)` values that already exist in `data/oss` pointing at a different target (the current recreate path unlinks and re-points, letting a caller rebind an existing `/oss/` name to a new host directory).

## Warnings

### WR-01: orchestrate data-source switch 404s legacy-blob-only projects, contradicting the documented "legacy-blob → simulateOnly 兜底"

**File:** `src/routes/canvas/orchestrate.ts:40-47` vs `src/routes/canvas/_simulate.ts:26-33`
**Issue:** The phase replaced the `o_agentWorkData.canvasGraph` blob read with `loadFullGraph` (relational store). For projects whose graph exists only in the legacy blob (never saved via save-v2/import-from-dir), `loadFullGraph` returns null → orchestrate now responds 404 "画布数据不存在" where the old code discovered targets from the blob and executed. The `_simulate.ts` header claims "legacy-blob-only 项目此后落 simulateOnly 兜底(行为对外无回归)" — but via orchestrate that fallback is unreachable: the route 404s before any node reaches `simulateExecution`. One-of-the-two call paths regressed for legacy projects with no fallback or migration notice.
**Fix:** Either add a legacy-blob fallback read when `loadFullGraph` returns null (old query preserved behind the new primary), or explicitly reject legacy scopes with a distinct error code + runbook note ("re-save via save-v2 to migrate"), and correct the "对外无回归" claim in the `_simulate.ts` header.

### WR-02: `node:state running` is broadcast before every early-exit path with no terminal event — client nodes stick in "running" forever

**File:** `src/routes/canvas/execute.ts:42-47, 53-60, 72-75`
**Issue:** The unconditional `running` broadcast (L43-47) fires before (a) the IterationEngine early-return (L53-60: `queued` response, no dispatch — comment admits "engine dispatch will be wired in a follow-up") and (b) the unsupported-nodeType 400 (L72-75). In both cases no `success`/`error` ever follows, so any canvas client that receives the room broadcast renders the node as 生成中 indefinitely (until an unrelated reload). With D-06③ this phase made "success must be true" a contract — the stuck-running counterpart on the early-exit paths is left in place.
**Fix:** Move the `running` broadcast below all early-exit branches (emit it only when `setImmediate` dispatch actually arms), and/or emit a terminal `node:state error` (or `idle`) on the 400 branch:

```ts
if (!supportedTypes.includes(effectiveType)) {
  broadcastToProject(projectId, "node:state", { nodeId, state: "error" });
  return res.status(400).send(error(`不支持的节点类型: ${effectiveType}`));
}
```

### WR-03: `markStaleAndBroadcast` throws wholesale on graphs containing any unsupported V2 node type — cascade silently disabled for the entire legacy graph

**File:** `src/routes/canvas/_stale.ts:47` (+ `execute.ts:90-96` catch, `packages/flowgraph-v3/ts/src/migrate.ts:445`)
**Issue:** `migrateV2toV3` → `planNode` throws on any unsupported V2 type (e.g. `'phase'`), so a single legacy node in the graph aborts `markStaleAndBroadcast` for **all** nodes; `execute.ts` swallows it with `console.error` and still broadcasts `success`. `probe-59-real.mjs:41-46` discovered and documented this on scope 1/2 ("legacy 图级联结构性失效 … 如实记录") but the product code path remains all-or-nothing: no per-node tolerance, no partial marking, no operator-visible signal beyond a console line. Result: reroll/panel-regen on legacy graphs reports success, marks nothing stale, and downstream consumers never learn.
**Fix:** Contain the blast radius inside `markStaleAndBroadcast` — wrap `migrateV2toV3` and on `planNode` failure fall back to a best-effort path: skip unsupported nodes (filter by `MIGRATE_SUPPORTED`-style check on `v2.nodes` before migrate, mirroring the probe's guard) or, minimally, catch and rethrow a typed error so `execute.ts` can include it in a distinct log channel/metric ("stale cascade structurally unavailable for this graph") instead of a generic console.error.

### WR-04: Reroll-seed popover submits a seed-only recipe when the event node lookup fails, silently breaking the "同配方" contract

**File:** `packages/infinite-canvas/src/components/eventParams/EventParamsPopover.tsx:47-48, 69-91`
**Issue:** `const params: GenerationParams = evt?.params ?? {}` — when `evt` is not found (event node deleted while popover is open, e.g. deprecated-variant refold, or a stale chip anchor after graph reload) the popover still renders the reroll button and, on click, submits `params: { seed }` only. The server then falls back to `extractPrompt(node)`, so the generation runs with a different recipe than the popover displayed and different from the "同配方换 seed 重跑" label promises. Additionally, the output-asset reverse lookup takes the first `role:'output'` match with no multi-output detection — `PromptSection` (`NodeDetailPanel.tsx:635-637`) logs a `console.warn` for the same ambiguity; the popover silently picks one.
**Fix:** Guard the button the way `PromptSection` guards: disable reroll with a hint when `!evt` ("事件已被折叠/删除,无法换 seed"), and mirror the multi-output `console.warn` (or pick deterministically and document) in the output-asset lookup.

## Info

### IN-01: Error paths in `execute`/`orchestrate` broadcast `error` without logging the underlying error server-side

**File:** `src/routes/canvas/execute.ts:98-102`, `src/routes/canvas/orchestrate.ts:107-114`
**Issue:** The `setImmediate` catch and the orchestrate per-node catch broadcast `node:state error` but never log `err` themselves; only `_simulate.ts:215` logs. Failures originating in `markStaleAndBroadcast` rethrow paths, `broadcastToProject`, or future dispatch code would be invisible in server logs while clients see errors.
**Fix:** Add `console.error("[canvas:execute] node failed:", nodeId, err)` in both catches.

### IN-02: `canvasApi.executeNode` `extra.seed` is a dead contract — the server only reads `params.seed`

**File:** `packages/infinite-canvas/src/services/canvasApi.ts:385-390` vs `src/routes/canvas/execute.ts:83`
**Issue:** The `extra` type advertises a top-level `seed` channel, but `execute.ts` only extracts `typeof params?.seed === "number"`. A future caller passing `extra.seed` (without nesting it in `params`) would silently lose the seed — exactly the class of bug REGEN-02 was meant to close.
**Fix:** Either remove `seed?: number` from the `extra` type or make `executeNode` fold it in: `params: { ...extra.params, ...(extra.seed != null ? { seed: extra.seed } : {}) }`.

### IN-03: Hardcoded absolute deployment roots in the path-translatORS silently degrade if the repo relocates

**File:** `src/routes/canvas/_engine.ts:84-91`, `src/routes/canvas/v2/import-from-dir.ts:206-215`
**Issue:** `/data/workspace/kais-aigc-platform/data/oss` and `/mnt/agents/output` are duplicated literals across `ossToEnginePath`, `fsToOssUrl`, and the symlink-creation block. On any relocated deployment both `existsSync` probes miss → every `/oss/` reference image is silently dropped (`filter r !== null`) with no warning log, and output translation returns null. Consistency today is verified by convention, not by a shared constant.
**Fix:** Hoist the two roots into one shared exported constant consumed by both files; emit a `console.warn` when an `/oss/` input fails both whitelist probes so the degradation is observable.

### IN-04: `_stale.ts` sequential upsert+broadcast loop applies cascades all-or-nothing per node on mid-loop failure

**File:** `src/routes/canvas/_stale.ts:69-88`
**Issue:** If `upsertNode` throws on node k of N, nodes k+1..N are neither persisted nor broadcast, and `execute.ts:93-95` swallows the error (by design, "标记自身失败不把成功翻成 error"). Clients converge to the partial DB truth on next reload, but there is no continuation, retry, or per-node error record — a partial cascade looks identical to a completed one in logs.
**Fix:** Wrap the per-node body in try/catch, collect failures, log each (`console.error("[canvas:_stale] node ${asset.id} 标记失败:", e)`), continue the loop, and only rethrow after the loop if any failed — preserving the "don't flip success to error" contract while applying the maximum correct subset.

---

_Reviewed: 2026-08-23T18:28:07Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
