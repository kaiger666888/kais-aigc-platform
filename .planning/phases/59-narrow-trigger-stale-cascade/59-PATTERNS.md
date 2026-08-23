# Phase 59: 窄触发 stale 级联 - Pattern Map

**Mapped:** 2026-08-23
**Files analyzed:** 15（11 修改 + 4 新建；另列 8 处零改动复用面）
**Analogs found:** 15 / 15（全部命中仓内 analog——本 phase 改动面全部落在既有文件的既有范式上）

> 结论先行：本 phase 没有真正「无先例」的文件。服务端三件（execute/_engine/_simulate）的修改点各自有**自身文件内**的既有范式可循；新服务端接缝（markStaleAndBroadcast）有 `_engine.ts`/`_simulate.ts` 的下划线模块先例 + `import-from-dir.ts:81` 的跨包相对 import 先例；测试四件各有一个 Phase 5x 的**同型前任**（verify-phase-58 / phase52-regen / mock-backend execute mock / probe-58-real）。唯一接近「新写」的逻辑是 fsToOssUrl 的 `/mnt/agents/output` 分支与 regen marker 字段。

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/routes/canvas/execute.ts`（改） | route | request-response + event-driven（setImmediate + socket 广播） | 自身 L13-29（zod extra 通道范式）+ L68-75（成功/失败广播缝，D-01 落点） | exact（in-file） |
| `src/routes/canvas/_engine.ts`（改） | service（引擎 HTTP 适配层） | request-response（submit/poll 轮询） | 自身 L66-105（submitEngineTask payload）+ L132-141（poll completed 分支，断点①现场） | exact（in-file） |
| `src/routes/canvas/_simulate.ts`（改） | service | request-response + event-driven（进度广播） | 自身 L18-24（映射表）/L33-53（readNode）/L144-147（假成功 catch） | exact（in-file） |
| `src/routes/canvas/v2/import-from-dir.ts`（改） | route + utility | file-I/O transform | 自身 L194-212（fsToOssUrl）+ L187-191（export-for-test 先例 setWorkdirToOss） | exact（in-file） |
| `src/routes/canvas/_stale.ts`（新建，或并入 execute.ts——planner 裁定住所） | service | event-driven（图变换 + DB 写 + 广播） | `_engine.ts`/`_simulate.ts` 下划线私有模块范式；跨包 import 先例 `import-from-dir.ts:81` | role-match |
| `packages/infinite-canvas/src/hooks/useCanvasSocket.ts`（改） | hook | event-driven（socket 订阅） | 自身 L226-234（variant:selected 订阅三件套：options 声明 + callbacksRef + socket.on） | exact（in-file） |
| `packages/infinite-canvas/src/components/FlowCanvas.tsx`（改） | component | event-driven（socket 回调接线） | 自身 L349-376（onGateState/onVariantSelected：scope 守卫 + store action 派发） | exact（in-file） |
| `packages/infinite-canvas/src/services/canvasApi.ts`（改） | service（API client） | request-response | 自身 L372-388（executeNode extra 通道，52-02 契约——regenSource 就加在这） | exact（in-file） |
| `packages/infinite-canvas/src/components/panel/NodeDetailPanel.tsx`（改） | component | request-response | 自身 L720-740（handleRegenerate——regenSource:'panel-regen' 加一行） | exact（in-file） |
| `packages/infinite-canvas/src/components/eventParams/EventParamsPopover.tsx`（改） | component | request-response | 自身 L62-94（handleRerollSeed——regenSource:'reroll-seed' 加一行） | exact（in-file） |
| `package.json`（改） | config | — | 自身 L43-51（verify:phase-5x 注册序列） | exact（in-file） |
| `scripts/verify-phase-59.ts`（新） | test（聚合门） | batch | `scripts/verify-phase-58.ts`（289 行，S 段 + runCmd + forced-failure 全骨架） | exact |
| `packages/infinite-canvas/test/e2e/tests/phase59-stale-cascade.mjs`（新） | test（e2e） | request-response 断言 + event-driven 消费 | `test/e2e/tests/phase52-regen.mjs`（getCalls body 断言）+ `phase58-recipe.mjs` | exact |
| `packages/infinite-canvas/test/e2e/mock-backend/server.mjs`（改） | test infra | request-response + pub-sub | 自身 L358-366（execute mock）+ L380-384（`/__mock/emit`） | exact（in-file） |
| `packages/infinite-canvas/test/e2e/probe-59-real.mjs`（新） | test（真机零足迹探针） | request-response | `test/e2e/probe-58-real.mjs`（200 行，捕获-改-断言-恢复全骨架） | exact |

---

## Pattern Assignments

### A. `src/routes/canvas/execute.ts`（route，request-response + event-driven）

**Analog:** 自身（zod extra 通道 + setImmediate 广播缝两处既有范式）+ `src/routes/canvas/orchestrate.ts`（姊妹路径——SC3 负向断言的参照物，**不加**任何标记代码即架构性保证）。

**Imports pattern**（L1-8）：
```typescript
import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { broadcastToProject } from "@/utils/ws";
import { simulateExecution } from "./_simulate";
const router = express.Router();
```
— 新增 `regenSource` 的 zod 声明与 `./_stale`（若独立模块）import 都挂在这个块。

**zod extra 通道范式**（L24-28——regenSource 照 `params` 的写法加，52-02 契约注释风格延续）：
```typescript
    // 52-02: params(配方袋,REGEN-02 换 seed 提交通道)。validateFields 只校验不回写
    // (middleware safeParse 后 next(),extra key 本就原样穿透无行为变化)——此字段为
    // 契约诚实 + 防未来有人给 middleware 加 strip 回写踩雷。模拟器语义不变:
    // handler 不把 prompt/params 传给 simulateExecution(归宿 = 接受并忽略)。
    params: z.record(z.string(), z.unknown()).optional(),
```
— Pitfall 8：validateFields 不 strip 未知键，**漏声明 regenSource 不会 400 只会丢类型提示**——必须显式 `regenSource: z.enum(['panel-regen','reroll-seed']).optional()`（RESEARCH Pattern 4），verify 静态断言 zod 声明存在。

**D-01 唯一新增服务端缝**（L68-75 现状——标记插在 `simulateExecution` resolve 后、success 广播前后；失败路径不进标记 = D-02）：
```typescript
      setImmediate(async () => {
        try {
          await simulateExecution(projectId, nodeId, episodesId);
          broadcastToProject(projectId, "node:state", { nodeId, state: "success" });
        } catch (err) {
          broadcastToProject(projectId, "node:state", { nodeId, state: "error" });
        }
      });
```

**seed 丢弃点**（L31——REGEN-02 现场-handler 解构未取 params，seed 须改为透传给 simulateExecution 签名扩展）：
```typescript
    const { projectId, episodesId, nodeId, nodeType, prompt, branchId } = req.body;
```

**Error handling**（L78-82 既有兜底，保持不动）：
```typescript
    } catch (err) {
      console.error("[canvas:execute] 执行节点失败:", err);
      broadcastToProject(projectId, "node:state", { nodeId, state: "error" });
      return res.status(500).send(error("执行节点失败"));
    }
```

**SC3 参照**：`src/routes/canvas/orchestrate.ts` L96-108 与 execute 各自独立广播 success、无 extra 通道——planner 的负向断言（grep orchestrate.ts 无 markStaleDownstream import + spawn 无 regenSource 执行零 stale 写）以此为靶。

---

### B. `src/routes/canvas/_engine.ts`（service，request-response）

**Analog:** 自身（Phase 39 适配层；storyboardPreview 共用此层——改内部不改签名）。

**断点④现场——submitEngineTask payload**（L66-82）：
```typescript
  const taskId = `canvas-${input.nodeId}-${Date.now()}`;
  const payload: Record<string, any> = {
    task_id: taskId,
    type: input.taskType,
    priority: "normal",
    params: {
      projectId: input.projectId,
      episodesId: input.episodesId,
      nodeId: input.nodeId,
      prompt: input.prompt,
      ...(input.referenceImages?.length
        ? { reference_images: input.referenceImages }
        : {}),
      ...input.metadata,
    },
  };
```
— 改法：`reference_images` 键改 `ref_images`（引擎 v6 直通表键名），值经新入向翻译（`/oss/x` → 双根探测宿主路径）。`...input.metadata` 展开点即 seed / `model_preference:"cloud"` 的透传位（metadata 键会平铺进 params 顶层）。

**断点①现场——pollEngineTask completed 分支**（L132-141 现状，outputUrl 恒 null）：
```typescript
      const raw = (await resp.json()) as Record<string, any>;
      const status = String(raw.status ?? raw.state ?? "running");
      if (status === "completed") {
        const outputUrl =
          raw.output_url ??
          raw.outputUrl ??
          raw.result?.output_url ??
          raw.result?.url ??
          raw.result?.image_url ??
          null;
        return { taskId, status: "completed", outputUrl, raw };
      }
```
— 改法（RESEARCH Pattern 3，读 `raw.outputs?.image ?? .video ?? .audio ?? .thumbnail` + 旧键兜底 + 断点② `enginePathToOss` 翻译）。

**Error handling**（L142-146 failed/cancelled throw——断点③修复后 _simulate 不再吞这个 throw）：
```typescript
      if (status === "failed" || status === "cancelled") {
        throw new Error(
          `gold-team task ${taskId} ${status}: ${JSON.stringify(raw.error ?? raw).slice(0, 200)}`,
        );
      }
```

**配置/env 读取范式**（L49-57 `baseUrl()`——fake 引擎 fixture 注入点：verify 里 `env: { ...process.env, GOLD_TEAM_URL: stubUrl }`）。

---

### C. `src/routes/canvas/_simulate.ts`（service，request-response + event-driven）

**Analog:** 自身（三处修改各有 in-file 范式）。

**断点⑥映射表现状**（L18-24——5 个 v1.7 类型，global/keyframe/voice 等全落 simulateOnly）：
```typescript
const NODE_TYPE_TO_TASK_TYPE: Record<string, TaskType> = {
  script: "image_draw", // script 节点不会真正调引擎;在 runner 里短路
  asset: "image_draw",
  storyboard: "image_draw",
  video: "video_final",
  audio: "tts",
};
```
— 扩表照此字面量风格；映射键优先用请求体的 nodeType 值、store 值兜底（Pitfall 6）。

**断点③现场①——readNode 读 legacy blob**（L33-53，v2 项目恒 null → 恒 simulateOnly）：
```typescript
async function readNode(
  projectId: number,
  episodesId: number,
  nodeId: string,
): Promise<{ node: Record<string, any> | null; episodesId: number }> {
  const row = await u
    .db("o_agentWorkData")
    .where("projectId", String(projectId))
    .andWhere("episodesId", String(episodesId))
    .andWhere("key", "canvasGraph")
    .first();

  if (!row?.data) return { node: null, episodesId };
```
— 改法：改走 `canvasRelationalStore.listNodes({projectId, episodesId})` 后 find（消费先例：`v2/nodes.ts` L181-182 的 PATCH handler 同款读法，见 Pattern Assignments E）。

**断点③现场②——假成功 catch**（L144-147，引擎挂掉 100% 触发）：
```typescript
  } catch (err: any) {
    console.error(`[_simulate] nodeId=${nodeId} 引擎调用失败,降级模拟:`, err.message);
    return simulateOnly(projectId, nodeId);
  }
```
— 改法：rethrow（交给 execute.ts L72-73 / orchestrate.ts L102-108 既有 error 广播）；**唯一合法保留的降级分支**是 L100-104：
```typescript
  // GOLD_TEAM_URL 未配置 → 降级模拟,保持 v1.7 行为
  if (!process.env.GOLD_TEAM_URL) {
    console.log(`[_simulate] GOLD_TEAM_URL 未配置,nodeId=${nodeId} 降级为模拟`);
    return simulateOnly(projectId, nodeId);
  }
```

**成功广播链**（L138-143 node:preview——断点②修好后 outputUrl 为 `/oss/` web 路径，此处零改动直接受益）：
```typescript
    if (result?.outputUrl) {
      broadcastToProject(projectId, "node:preview", {
        nodeId,
        thumbnailUrl: result.outputUrl,
      });
    }
```

---

### D. `src/routes/canvas/v2/import-from-dir.ts`（route + utility，file-I/O transform）

**Analog:** 自身 L194-212（fsToOssUrl 现体）+ L23-45（flattenParamsToNodeData 的 **export-for-verify 先例**——Phase 44 为 verify 脚本精确回放而 export 模块私有函数，fsToOssUrl export 照此办理）+ L81（跨包相对 import 先例，见 Shared Patterns）。

**fsToOssUrl 现体**（L194-212——`/mnt/agents/output` 输入每分支穿透返回 null，Pitfall 2）：
```typescript
/** Convert a filesystem path to a /oss/ URL if possible. */
function fsToOssUrl(fsPath: string): string | null {
  if (!fsPath || typeof fsPath !== "string") return null;
  // Check if it's already an /oss/ URL
  if (fsPath.startsWith("/oss/")) return fsPath;
  // Check if it's an absolute path under the OSS dir
  const ossDir = "/data/workspace/kais-aigc-platform/data/oss";
  if (fsPath.startsWith(ossDir + "/")) {
    return "/oss/" + fsPath.substring(ossDir.length + 1);
  }
  // Check if it's under the current workdir (mapped to /oss/{projectSlug}/ via symlink)
  if (_workdirToOss && fsPath.startsWith(_workdirToOss.workdir)) {
    const relPath = fsPath.substring(_workdirToOss.workdir.length);
    return _workdirToOss.ossPrefix + relPath;
  }
  // Check if it's an http URL
  if (fsPath.startsWith("http://") || fsPath.startsWith("https://")) return fsPath;
  // Not convertible
  return null;
}
```
— 改法：`export` + 增 `/mnt/agents/output/` 前缀 → `/oss/` 纯字符串分支（不依赖 `_workdirToOss` 全局态）；http(s) 透传分支保持（cloud 引擎 CDN 直链形态）。

**export-for-verify 先例**（L178-191——fsToOssUrl export 的注释写法与动机模板）：
```typescript
/**
 * Set the global workdir→oss mapping. Production Sets this inside
 * scanAndBuildTree at request scope. Exported for test harnesses
 * (scripts/verify-canvas-shot-timeline.ts) that call
 * extractShotTimelineArtifacts directly without going through
 * scanAndBuildTree — without this, fsToOssUrl falls through every
 * branch and derived filePath values differ from production
 * (WR-07).
 */
export function setWorkdirToOss(
```

---

### E. 新服务端接缝 `src/routes/canvas/_stale.ts`（service，event-driven）——或并入 execute.ts，planner 裁定

**Analog ①（模块形态）:** `_engine.ts`/`_simulate.ts` 的下划线私有模块——文件头块注释（Phase/决策编号 + 配置说明）+ 具名 export，被路由层 import。
**Analog ②（跨包 import）:** `import-from-dir.ts` L81（服务端运行时深链 infinite-canvas 值导出，esbuild bundle 实证存活）：
```typescript
import { PHASE_REGISTRY, type PipelinePhaseDef } from "../../../../packages/infinite-canvas/src/constants/phaseRegistry";
```
— `markStaleDownstream`/`migrateV2toV3` 的 import 照此相对深链：`../../../../packages/flowgraph-v3/ts/src/stale` 与 `.../migrate`（**禁 index.ts**——会拉包内 zod 3.23.8，Anti-Pattern #2）。verify-phase-58.ts L40-43 已有同款相对 import flowgraph-v3 先例。
**Analog ③（落库 + 广播序列）:** `v2/nodes.ts` PATCH handler L180-213——「listNodes find → merge → upsertNode → touchMeta → broadcastToProject("node:updated")」完整先例：
```typescript
      await ensureMeta({ projectId, episodesId });
      const existing = await listNodes({ projectId, episodesId });
      const node = existing.find((n) => n.id === nodeId);
      if (!node) {
        return res.status(404).send(error(`节点 ${nodeId} 不存在`));
      }
      // ... merged = { ...node, ...updates } + validateNodeData 门 ...
      await upsertNode({ projectId, episodesId }, merged);
      await touchMeta({ projectId, episodesId });

      broadcastToProject(projectId, "node:updated", {
        node: merged,
        changedFields: Object.keys(updates),
      });
```
— `node:updated` payload 形状 `{ node, changedFields }` 即 D-01 discretion 内推荐的既有事件格式（nodes.ts:210 先例），客户端新订阅按此消费。注意本接缝非 HTTP handler，无需 404/validateNodeData 响应门，但「先落库后广播」顺序（Pitfall 4）与 changedFields: ["data.stale"] 照此。

**核心逻辑骨架**（RESEARCH Pattern 2 已给全文；其调用的原语签名——`canvasRelationalStore.ts`）：
```typescript
export async function upsertNode(scope: Scope, node: FlowNodeV2): Promise<void>   // L91 — data 列整列覆盖（JSON.stringify(node.data ?? {})）
export async function listNodes(scope: Scope): Promise<FlowNodeV2[]>              // L162
export async function loadFullGraph(scope: Scope): Promise<FlowGraphV2 | null>    // L987 — {meta.version:'2', nodes, links, branches, variantGroups}
```
级联纯函数签名（`flowgraph-v3/ts/src/stale.ts` L69-73 / L139）：
```typescript
export function markStaleDownstream(
  graph: FlowGraphV3,
  changedAssetIds: string[],
  now: number,
): FlowGraphV3
export function getDownstreamIds(graph: FlowGraphV3, nodeId: string): string[]
```
stale wire 三字段（`v3/serialize.ts` L276-281——写侧形状，缺一 migrate 还原为 null）：
```typescript
    if (n.stale != null) {
      data.stale = {
        since: n.stale.since,
        triggerAssetId: n.stale.triggerAssetId,
        triggerEventId: n.stale.triggerEventId,
      }
    }
```

---

### F. `packages/infinite-canvas/src/hooks/useCanvasSocket.ts`（hook，event-driven）——G1 唯一客户端新增订阅

**Analog:** 自身——`variant:selected` 订阅是「新增一个 socket 事件消费」的最近先例（Phase 49 WR-08 同样是「服务端一直在广播、客户端死信」的场景，注释可直接参考）。

**三件套之一：options 声明**（L74-77 + 接口 L58-81 的可选回调清单）：
```typescript
  /** Phase 49 (WR-08): 他端选定了变体组 winner — 消费方负责回显守卫。 */
  onVariantSelected?: (payload: VariantSelectedPayload) => void
  /** Phase 54 (D-03): gate 中心状态推送,scope 守卫由消费方负责。 */
  onGateState?: (payload: GateStatePayload) => void
```
— 新增 `onNodeUpdated?: (payload: { node: Record<string, unknown>; changedFields?: string[] }) => void` 照此（含 doc 注释标注 Phase 59 D-01）。

**三件套之二：callbacksRef**（L111-122——两处字面量清单同步加，防重连丢回调）：
```typescript
  const callbacksRef = useRef({
    onNodeStateChange, onNodeScored, onNodePreviewUpdate, onNewAsset,
    onOrchestrateStart, onOrchestrateProgress, onOrchestrateDone,
    onBranchCreated, onReviewApproved, onReviewRejected,
    onGraphSaved, onVariantSelected, onGateState, onCanvasEvent, onCanvasReset,
  })
```

**三件套之三：socket.on 注册**（L226-234 范式）：
```typescript
    socket.on('variant:selected', (payload: VariantSelectedPayload) => {
      callbacksRef.current.onVariantSelected?.(payload)
    })
```
— 新增 `socket.on('node:updated', ...)` 放在其旁；坏形状静默忽略照 `node:created` 的守卫写法（L171-178：`node != null && typeof node === 'object'` 才转发）。**红线**：handler 里不得碰 normalizeSocketNodeState / 执行态映射（52-01 stale 保留语义，Anti-Pattern #5）。

---

### G. `packages/infinite-canvas/src/components/FlowCanvas.tsx`（component，event-driven）

**Analog:** 自身 L349-376——onGateState/onVariantSelected 的「scope 守卫 + store action 派发」接线范式：
```typescript
    onGateState: (payload) => {
      // Phase 54 (D-03): gate 中心状态推送。守卫 scope(与 onVariantSelected
      // 同法)——他项目的 payload 不进本端 store(防跨项目串扰)。
      if (!projectId || episodesId == null) return
      if (payload.projectId !== projectId || payload.episodesId !== episodesId) return
      useGateStore.getState().apply(payload)
    },
```
— 新增 `onNodeUpdated` 回调照此结构：轻校验 payload.node 形状 → 从 `node.data.stale.triggerAssetId` 提取触发资产 → `triggerStaleCascade([triggerAssetId])`（幂等收敛，复用 `useStale.ts` L48-60 的现成函数——它内部调 store.markStaleDownstream + 脉动）。useCanvasSocket 调用点 L267-269。

**消费函数本体**（`useStale.ts` L48-60，零改动复用）：
```typescript
export function triggerStaleCascade(changedAssetIds: string[]): void {
  if (changedAssetIds.length === 0) return
  const store = useCanvasStore.getState()
  store.markStaleDownstream(changedAssetIds)

  const g = useCanvasStore.getState().graph
  if (!g) return
  const changed = new Set(changedAssetIds)
  const newlyStale = g.nodes
    .filter((n) => n.kind === 'asset' && n.stale != null && changed.has(n.stale.triggerAssetId))
    .map((n) => n.id)
  useStalePulse.getState().addPulse([...changedAssetIds, ...newlyStale])
}
```

---

### H. `packages/infinite-canvas/src/services/canvasApi.ts`（service，request-response）

**Analog:** 自身 L372-388（executeNode extra 通道——regenSource 扩展点，注释风格照 52-02 段落续写 59 段）：
```typescript
export async function executeNode(
  projectId: number,
  episodesId: number,
  nodeId: string,
  nodeType: string,
  // 52-02: extra 提交通道(REGEN-01/02)——重生成/换 seed 经此携带新 prompt/seed/params;
  // 服务端 zod 契约层接受并忽略(模拟器语义不变),e2e 经 mock logCall 完整 body 断言到达。
  // 可选参数,既有调用方(CanvasContextMenu handleExecute)不传 extra,向后兼容零改动。
  extra?: { prompt?: string; seed?: number; params?: Record<string, unknown> },
  cancelToken?: CancelToken,
): Promise<void> {
  await apiCall<void>(
    '/canvas/execute',
    { projectId, episodesId, nodeId, nodeType, ...extra },
    { cancelToken },
  )
}
```
— 改法：extra 类型加 `regenSource?: 'panel-regen' | 'reroll-seed'`（展开逻辑零改动，`...extra` 已透传）。

**互证注释**（L642-649 updateCanvasNode doc——「前端 socket 当前未消费该事件」即 G1 缺口的代码侧自认，改后此注释需同步更新）：
```typescript
 * 后端广播 `node:updated`，前端 socket 当前未消费该事件 → 不触发全图重载，
 * 适合乐观更新（点选不闪烁、不跳顶）。写入的 relational store 正是 load-v2 的数据源。
```

---

### I. `NodeDetailPanel.tsx` + `EventParamsPopover.tsx`（component，request-response）

**Analog:** 各自身——两个窄触发点的 handleRegenerate / handleRerollSeed（regenSource 各加一行）。

`NodeDetailPanel.tsx` L720-740：
```typescript
  const handleRegenerate = async () => {
    // 缺项目上下文 → toast 早退（deleteNode 店级范式）
    if (!projectId || !episodesId) {
      showToast('缺少项目上下文', 'warning')
      return
    }
    setSubmitting(true)
    try {
      // nodeId = 资产 id（地雷 #4 裁定，见组件头注释）；eventId 仅用于 canonical 写回
      await executeNode(projectId, episodesId, asset.id, asset.stage, {
        prompt: canonicalPrompt,
        params: { ...evt.params, prompt: canonicalPrompt },
      })
```
— extra 里加 `regenSource: 'panel-regen'`。同文件 L54-65 有 triggerStaleCascade 既有消费（审核通过触发）可参考语义但**本路径不需要客户端标记**（服务端负责）。

`EventParamsPopover.tsx` L80-88：
```typescript
    const newSeed = Math.floor(Math.random() * 1_000_000)
    setPending(true)
    try {
      await executeNode(anchor.projectId, anchor.episodesId, outputAsset.id, outputAsset.stage, {
        params: { ...params, seed: newSeed },
      })
```
— extra 里加 `regenSource: 'reroll-seed'`。注意 L86-87 注释：新 seed 只在请求体（updateEventParams 后置持久化）——seed 透传引擎的 REGEN-02 断言以 `getCalls` 找 `/api/canvas/execute` body.params.seed 为观测点。

---

### J. `scripts/verify-phase-59.ts`（新，test 聚合门）

**Analog:** `scripts/verify-phase-58.ts`（289 行全骨架——S 段划分/命令门/forced-failure 三件全可复刻）。

**骨架①断言记录**（L47-61）：
```typescript
interface TestResult { name: string; pass: boolean; detail?: string; }
const results: TestResult[] = [];
function assert(cond: boolean, name: string, detail?: string): void {
  results.push({ name, pass: cond, detail });
  console.log(`  ${cond ? "PASS" : "FAIL"}: ${name}${detail ? " — " + detail : ""}`);
}
const REPO_ROOT = path.resolve(__dirname, "..");
function read(rel: string): string { ... }
function exists(rel: string): boolean { ... }
```

**骨架②命令门**（L64-81——WR-01 教训注释原样保留：不经 shell 管道、maxBuffer 16MB）：
```typescript
function runCmd(name: string, cwdRel: string, cmd: string, tailLines = 3): void {
  const res = spawnSync(cmd, {
    cwd: path.join(REPO_ROOT, cwdRel),
    shell: true,
    encoding: "utf8",
    timeout: 300_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  const out = (res.stdout ?? "") + (res.stderr ?? "");
  const tail = out.split("\n").filter((l) => l.trim().length > 0).slice(-tailLines).join(" | ");
  assert(res.status === 0, `S5 cmd: ${name} (exit ${res.status})`, ...);
}
```
命令门序列（L222-230）：`root tsc --noEmit` / `infinite-canvas tsc -b` / `flowgraph-v3 tsc --noEmit` / 双包 vitest。

**骨架③forced-failure 自检**（L233-264——shadowAssert 收集 must-fail 组，意外 PASS 整门红）+ 退出码约定（0/1/2，L271-289 try-catch 包 main）。

**fake 引擎 fixture 先例**（`verify-phase-54.ts` L284-328——内联 http stub + 随机端口 + spawn 子进程注入 env，正是断点①③④集成断言所需的形态）：
```typescript
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://stub");
    const bodyChunks: Buffer[] = [];
    req.on("data", (c: Buffer) => bodyChunks.push(c));
    req.on("end", () => {
      const body = bodyChunks.length > 0 ? JSON.parse(Buffer.concat(bodyChunks).toString()) : {};
      const json = (status: number, payload: unknown) => { ... };
      // 路由匹配 + recorded[op].push(body) 捕获请求体 → 断言侧经 /__recorded 取回
    });
  });
  return { server, port: () => (server.address() as { port: number }).port };
  // 用法:await listen(0, "127.0.0.1") → spawn("npx", ["tsx", ...], { env: { ...process.env, REVIEW_PLATFORM_URL: stubUrl } })
```
— Phase 59 版：env 键换 `GOLD_TEAM_URL`，stub 路由实现 `POST /api/v1/tasks`（捕获 params 断言 ref_images/seed）与 `GET /api/v1/tasks/:id`（返回活体形状 `outputs.image` 容器路径 / failed+error 两模式）。同款先例另见 `verify-phase-49-bridge.ts` L61/L127（子进程 dispatch 范式，注意 49-01 knex 池不落共享进程的教训——spawn 子进程而非同进程 import 路由）。

**package.json 注册**（L43-51 序列尾加一行）：
```json
    "verify:phase-58": "npx tsx scripts/verify-phase-58.ts",
```

---

### K. `phase59-stale-cascade.mjs`（新 e2e）+ mock-backend 扩展

**Analog:** `test/e2e/tests/phase52-regen.mjs`（177 行——getCalls 请求体断言 + /__mock/state 轮询两大观测范式）。

**观测①getCalls body 断言**（L72-84）：
```javascript
    let exec
    await expect.poll(async () => {
      const calls = await getCalls(page)
      exec = calls.find((c) => c.path === '/api/canvas/execute')
      return exec?.body?.prompt
    }, { timeout: 5_000 }).toBe(NEW_PROMPT)
    expect(exec.body.nodeId).toBe('storyboard-1')
    expect(exec.body.params?.prompt).toBe(NEW_PROMPT)
```
— Phase 59 版：断言 `exec.body.regenSource` / `exec.body.params.seed`（SC2）。

**观测②mock 状态轮询**（L51-55）：
```javascript
  await expect.poll(async () => {
    const res = await page.request.get('/__mock/state')
    const s = await res.json()
    return s.canvas.nodes.find((n) => n.id === 'storyboard-1')?.data?.prompt
  }, { timeout: 5_000 }).toBe(NEW_PROMPT)
```

**前置纪律注释**（L15-16——「e2e 跑 dist 非源码，运行前必须 `npm run build`」必须复制进新文件头）。

**mock-backend 扩展点**（`mock-backend/server.mjs`）——execute mock 现体 L358-366：
```javascript
app.post('/api/canvas/execute', (req, res) => {
  const { projectId, episodesId, nodeId, nodeType } = req.body
  res.json({ code: 200, data: { nodeId, status: 'triggered' } })
  // 52-02: logCall 记完整 req.body(prompt/params/seed 等任务参数为 e2e 断言观测点)
  logCall('POST', '/api/canvas/execute', req.body, null)
  setTimeout(() => {
    broadcastToProject(projectId, 'node:state', { nodeId, state: 'success' })
  }, 30)
})
```
— 扩展：body 含 regenSource 时，在 node:state success 前后按 D-01 契约回放 `node:updated`（payload 形状对齐 nodes.ts:210 `{node, changedFields}`）；无 regenSource 时**不**发（SC3 负向路径在 mock 侧同样成立）。`/__mock/emit`（L380-384）已可手动广播兜底：
```javascript
app.post('/__mock/emit', (req, res) => {
  const { projectId, event, data } = req.body
  broadcastToProject(projectId, event, data)
  res.json({ ok: true })
})
```
角标断言选择器：`svg[aria-label="stale"]`（RESEARCH 测试映射表）+ `window.__kaisCanvas.getGraph()`（helpers.mjs 提供 loadCanvas/nodeSelector/getCalls/switchToCanvasView）。

---

### L. `probe-59-real.mjs`（新真机探针）

**Analog:** `test/e2e/probe-58-real.mjs`（200 行）。

**头部部署纪律**（L15-23——build → deploy-canvas.sh → build:server → :10588 restart 全序列 + SKIP 退出条款，原样复刻）：
```javascript
//   部署前置纪律(地雷 #10:10588 跑 build 产物,须 rebuild+restart):
//     cd packages/infinite-canvas && npm run build
//     → 根仓 bash scripts/deploy-canvas.sh(自带备份,dist → data/web/infinite-canvas)
//     → 根仓 npm run build:server(src/app.ts → data/serve/app.js)
//     → 重启 dev server:kill 旧 pid 后
//       NODE_ENV=production PORT=10588 setsid nohup node data/serve/app.js \
//         > data/serve/app-10588.log 2>&1 &
//   若 :10588 不可达或重启失败:输出 SKIP 理由并退出非零(RESEARCH Environment
//   Availability fallback 条款——延后探针不阻塞 verify 门,但 SUMMARY 必须记录)。
```

**零足迹骨架**（L85-97——捕获原图 → 操作 → 断言 → finally saveV2 恢复 + stripUpdatedAt 深比对净足迹=0；L53-82 的 stripUpdatedAt/firstDiff 工具函数直接复制）：
```javascript
  const health = await loadV2(9999, 1)
  if (health.status !== 200) { console.error(`SKIP: ...`); process.exit(1) }
  originalGraph = health.json.data
  const nodeA = originalGraph.nodes.find(n => n.id === NODE_A)
```
— Phase 59 版操作段：真项目窄路径 regen（POST /api/canvas/execute 带 regenSource）→ 轮询 load-v2 断言 canvas_nodes 出现 data.stale → finally 恢复原图。SC3 真机负向（orchestrate 子集 → 断言零新增 stale 行）同文件第二段。

---

## Shared Patterns

### broadcastToProject（唯一广播原语）
**Source:** `src/utils/ws.ts` L13-23
**Apply to:** execute.ts 标记接线 / _stale.ts / _engine.ts / _simulate.ts 全部服务端广播
```typescript
export function broadcastToProject(
  projectId: string | number,
  event: string,
  data: any,
) {
  if (!_io) return;
  _io
    .of("/ws/projects")
    .to(`project:${projectId}`)
    .emit(event, data);
}
```

### validateFields（不 strip 的 zod 中间件）
**Source:** `src/middleware/middleware.ts` L8-24
**Apply to:** execute.ts 新增 regenSource 声明（Pitfall 8：未知键原样穿透——漏声明不报错，verify 必须静态断言 zod 声明在场）
```typescript
  return (req: Request, res: Response, next: NextFunction) => {
    const data = req[source];
    const parseResult = schema.safeParse(data);
    if (!parseResult.success) {
      const errors = parseResult.error.issues.map((issue) => `字段 ${issue.path.join(".")} ${issue.message}`);
      console.error(errors);
      return res.status(400).json({ message: "参数错误", errors });
    }
    next();
  };
```

### node:updated wire 契约
**Source:** `src/routes/canvas/v2/nodes.ts` L210-213（服务端发射形状）+ `canvasApi.ts` L642-649（消费侧现状注释）
**Apply to:** _stale.ts 广播 / useCanvasSocket 新订阅 / mock-backend execute 回放——三处 payload 必须同为 `{ node, changedFields }`
```typescript
      broadcastToProject(projectId, "node:updated", {
        node: merged,
        changedFields: Object.keys(updates),
      });
```

### data.stale wire 三字段 + evt_ 确定性 id（双端一致性的两块基石）
**Source:** `packages/infinite-canvas/src/v3/serialize.ts` L276-281（写侧形状，见 Pattern Assignments E）+ `packages/flowgraph-v3/ts/src/migrate.ts` L523（`const eventId = \`evt_${n.id}\``——服务端 migrateV2toV3 与客户端 adaptV2Graph 同规则，triggerEventId 跨端不漂移的前提）
**Apply to:** _stale.ts 落库写 / 客户端 node:updated 消费 / reload 保真断言。

### 服务端跨包相对深链 import
**Source:** `src/routes/canvas/v2/import-from-dir.ts` L81（运行时值导入 infinite-canvas，esbuild bundle 实证存活）+ `scripts/verify-phase-58.ts` L40-43（verify 侧相对 import flowgraph-v3 recipe.ts）
**Apply to:** _stale.ts 引 markStaleDownstream/migrateV2toV3——**只深链 stale.ts/migrate.ts，禁 index.ts**（zod 3.23.8 vs 根仓 4.3.6，Anti-Pattern #2）。

### 入向路径防穿越
**Source:** `src/utils/replaceUrl.ts` L14-21
**Apply to:** 断点④的 `/oss/x` → 宿主路径翻译（Security Domain 路径穿越缓解——双根探测结果必须落在挂载根内）
```typescript
    // 防止路径穿越：对路径进行规范化后，确保不含上溯分量
    const normalized = path.posix.normalize(cleanedPath);
    if (normalized.startsWith('../') || normalized === '..') {
        return '';
    }
```

### /oss 静态服务链（断点② 的下游保障，零改动）
**Source:** `src/app.ts` L74-87——`/oss` 先查 `data/oss` 再 fallback `OUTPUT_DIR=/mnt/agents/output`（`.env` 实证）——`/mnt/agents/output/<task>/output.png` 翻译成 `/oss/<task>/output.png` 后此链已能服务，planner 无需动 app.ts。

### SC4 消除链（零改动复用面，验收时引用）
**Source:** `canvasStore.ts` applySocketNodeState（L720-735 附近）——running/success 自动清 stale、error/failed 保留（52-01 红线）；`useStaleRerun.ts` 全文（71 行）——getDownstreamIds + saveCanvasGraph + orchestrateCanvas 子集的统一重跑出口。

---

## No Analog Found

| File/部件 | Role | Data Flow | Reason |
|------|------|-----------|--------|
| fake 引擎三模式 fixture 的具体返回体 | test fixture | request-response | 仓内无「模拟 :8002 gold-team」的既有 fixture——但有**同型**先例 `verify-phase-54.ts` L284-328（stub review 平台）与 `verify-phase-49-bridge.ts` L61（stub HTTP server + spawn 注入 env）；返回体形状照 RESEARCH「引擎契约」活体 JSON（outputs.image 容器路径 / failed+error / params 捕获），属「换数据不换骨架」 |
| `/oss/` → 引擎宿主路径的**双根探测**入向翻译函数 | utility | file-I/O | 仓内无现成入向（web→容器）翻译——replaceUrl.ts 只做防穿越规范化；RESEARCH Pitfall 3 给了算法（先试 `/mnt/agents/output/x` 再试 `data/oss/x`，fs.existsSync 取存在者），planner 定住所（_engine.ts 内 or _stale.ts 旁新 util） |

其余全部文件均有 exact/role-match analog。

## Metadata

**Analog search scope:** `src/routes/canvas/`（含 v2/）、`src/lib/`、`src/utils/`、`src/middleware/`、`src/app.ts`、`scripts/`（verify-phase-\*）、`packages/infinite-canvas/src/`（hooks/components/services/store/v3）、`packages/infinite-canvas/test/e2e/`（tests + mock-backend + probe）、`packages/flowgraph-v3/ts/src/`
**Files scanned:** 约 30（重点精读 18）
**Pattern extraction date:** 2026-08-23
**与 RESEARCH.md 的差异核对:** 无实质矛盾——G1（useCanvasSocket 无 node:updated 订阅）、Pitfall 2（fsToOssUrl 无 /mnt/agents/output 分支）、断点①③④现场行号（_engine.ts:133 / _simulate.ts:144 / execute.ts:31）均经本轮代码现场独立复核一致。

---

*Phase: 59-narrow-trigger-stale-cascade*
*Pattern map for gsd-planner — 每个新/改文件都能在上表找到可复制的文件与行号。*
