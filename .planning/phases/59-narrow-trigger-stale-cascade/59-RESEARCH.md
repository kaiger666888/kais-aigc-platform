# Phase 59: 窄触发 stale 级联 (Narrow-Trigger Stale Cascade) - Research

**Researched:** 2026-08-23（两轮独立研究合并：第一轮产出后第二轮全量复核——所有断言经代码现场 + :8002 引擎活体探测双重证实，无实质矛盾；第二轮新增 Pitfall 9 引擎源码双树陷阱）
**Domain:** 服务端 stale 级联标记（flowgraph-v3 纯函数服务端复用）+ canvas→引擎 execute 链真实化（:8002 REST 契约对齐/路径翻译/假成功修复）
**Confidence:** HIGH（核心断言全部经代码现场 + :8002 引擎活体任务实证）

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01: 服务端标记。** executeNode(extra) 请求携带 regen 身份标识；服务端在任务成功判定处调 markStaleDownstream 写库（data.stale 上 wire，reload 即在）+ 发 node:updated，客户端**零改动**复用既有 socket node:updated → triggerStaleCascade 级联链。编排/批量不走 executeNode-extra 通道 → SC3 零波及是**架构性保证**而非行为过滤。
- **D-02: 失败不级联。** error/failed 状态绝不标下游（SC1/SC2 锁「成功后」）；修完 D-06 断点③后「成功」信号为真，此语义才可靠。
- **D-03: 级联深度 = 传递闭包。** markStaleDownstream 沿因果边（asset→event→asset→…）级联，flowgraph-v3 stale.ts 现成语义直接复用。
- **D-04: 落选/locked 边界沿用。** isInactive 置灰边不传播（P12×P13「选定版接管下游」——改选定变体不误波及落选）；curation:'locked' 资产是传播终点（自身不标脏、不向下传）；sequence 边不参与。与 Phase 58 CR-01 的落选豁免语义一致，planner 无需重新裁决。
- **D-05: stale 字段复用不另开。** 级联标记写同一 data.stale 字段（52-02 上 wire 语义 + relational store 落库）；StaleInfo.trigger* 已记录链条起点（triggerAssetId/triggerEventId），不区分「手动/级联」来源字段。
- **D-06: 四断点全修**（08-23 review 未修项，编号沿用 review 记录）：
  ① `_engine.ts:133` poll 读 `raw.output_url/raw.result?.*` 但引擎返回 `outputs.image` → outputUrl 恒 null——改读引擎真实返回形状；
  ② 输出 `/mnt/agents/output/` 容器路径无 `/oss/` 翻译——复用 import 链现成的 fsToOssUrl；
  ③ `_simulate.ts:145` 引擎任何错误 catch 后 simulateOnly→广播 success=**假成功**（引擎挂掉时 100% 触发）——改为广播 error/failed + 负向断言锁死；
  ④ ref 参数名错配：canvas 发 `reference_images`/值 `/oss/` web 路径 vs 引擎收 `ref_images`/容器可见路径——对齐参数名与路径形态。
  另：REGEN-02 seed 被 execute.ts 校验后直接丢弃——一并对齐（seed 须真传到引擎请求体）。
- **D-07: 修真优先于接线。** 断点修复 plan 先行/同波前置，标记接线 plan 依赖其产出（假成功不修，STALE-01/02 的「成功后」在引擎故障时是假的）。

### Claude's Discretion
- regen 身份标识的具体形态（extra 字段名、requestId vs 来源枚举）
- 服务端 markStaleDownstream 的执行位置（execute 成功回调内 vs poll 完成处）与 node:updated 的 payload 形状（对齐既有事件格式）
- 断点修复的测试策略（mock 引擎返回形状的构造方式）
- e2e 断言的组织（复用 phase52-regen mock 范式）

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within (expanded) phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| STALE-01 | 面板编辑配方后重生成成功 → 下游自动标 stale（角标可见，无手动动作） | 触发点 NodeDetailPanel.tsx:729 executeNode extra；服务端成功判定缝 execute.ts:68-75；级联语义 stale.ts markStaleDownstream 零改动复用；客户端消费缝见「关键缺口 G1」（node:updated 需新接线） |
| STALE-02 | 事件芯片换 seed 重跑成功 → 下游同样自动标 stale | 触发点 EventParamsPopover.tsx:83 executeNode(params 含 seed)；新 seed 只存在于请求体（地雷 #12：updateEventParams 后置且持久化等下次 save）→ seed 必须经 execute 链透传引擎 |
| STALE-03 | 编排/批量成功**不**触发级联（负向断言锁死） | orchestrate.ts 与 execute.ts 各自独立广播 success；标记代码只放 execute 路径 = 架构性保证；负向断言面三处（见 Validation Architecture） |
</phase_requirements>

## Summary

本 phase 改动面完全在 kap 仓既有代码上，**零新增外部依赖**。三块工作：(1) execute 链四断点 + seed 透传修复（`execute.ts` / `_engine.ts` / `_simulate.ts`）；(2) 服务端成功判定处接 `markStaleDownstream`（写 canvas_nodes.data JSON + 广播 `node:updated`）；(3) 客户端一处近零接线（socket `node:updated` 消费——研究证实该链**今天并不存在**，见 G1）。

引擎契约经 :8002 活体任务实证（两轮探测一致，2026-08-23，`sf-s02_b01-*` completed 任务）：GET /api/v1/tasks/{id} 返回 `outputs.image = "/mnt/agents/output/jimeng_<id>/output.png"`（TaskOutputs 模型四字段 video/thumbnail/audio/image），无任何 `output_url` 键——断点①的修法就是改读 `raw.outputs?.image`。路径翻译断点②的真值是简单前缀置换 `/mnt/agents/output/` → `/oss/`（app.ts:74-87 已有 /oss 静态 fallback 链先查 data/oss 再查 /mnt/agents/output），但 **fsToOssUrl 现有分支不覆盖 /mnt/agents/output**——「复用」需要 export + 增补分支，naive 复用会恒返回 null。断点④反向翻译 `/oss/x` → 引擎可见路径的真值比 CONTEXT 描述更细：引擎容器只挂了 `/mnt/agents/output` 与 `/data/workspace/kais-hermes-skills`（ro）两个宿主目录（docker inspect 活体实证），kap 的 `data/oss` **未挂进引擎**——data/oss 独有文件对引擎不可见，翻译需双根探测取存在者（Pitfall 6）。

服务端复用 flowgraph-v3 纯函数的可行性为**已证先例**：`src/routes/canvas/v2/import-from-dir.ts:81` 已在服务端运行时以相对路径深链 import `packages/infinite-canvas`（同为 `"type":"module"` ESM TS 源码包）的**值导出**，且生产 bundle `data/serve/app.js`（22MB，2026-08-23 21:48 构建物）实测含 PHASE_REGISTRY 内容（esbuild bundle 打包成功实证，grep 命中 10 处）；verify-phase-58.ts 顶部已相对 import flowgraph-v3 的 recipe.ts。`stale.ts`/`migrate.ts` 的传递依赖全是类型或纯常量（migrate 仅 runtime-import integrity.js + recipe.js，不拉 zod），直接深链 `ts/src/stale.ts` + `ts/src/migrate.ts` 即可，**不要 import index.ts**（index.ts `export * from './zod.js'` 会拉 zod，flowgraph-v3 用 zod 3.23.8 而根仓是 4.3.6）。

**Primary recommendation:** 断点修复（含 seed/model_preference 透传）先行一个 plan；标记接线随后：execute.ts setImmediate 成功块内 `loadFullGraph → migrateV2toV3 → markStaleDownstream([nodeId]) → diff 出新 stale 资产 → 逐节点 upsertNode(data.stale) + broadcastToProject("node:updated",{node})`；客户端按 UI-SPEC §5 Option A 在 useCanvasSocket 加一个 `node:updated` 订阅（全 phase 唯一新增客户端接线，近零）。

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| stale 级联语义计算 | 服务端（flowgraph-v3 纯函数） | — | D-01 服务端标记；纯函数服务端/客户端零逻辑复制（共用 stale.ts） |
| stale 持久化 | DB（canvas_nodes.data JSON） | — | save-v2 关系表是唯一真值源；data.stale 上 wire 即 reload 可见（migrate.ts d.stale 还原，serialize.ts:44-46 注释互证） |
| stale 实时可见（角标/脉动） | 客户端（socket node:updated → triggerStaleCascade） | reload 兜底 | 服务端广播驱动；客户端复用 NodeBadges/StaleSection/useStalePulse 零视觉改动 |
| 重生成身份标识（regen marker） | 客户端（executeNode extra） | 服务端 zod 接受 | 两条窄路径唯一入口；orchestrate 无此通道 = SC3 架构保证 |
| 引擎任务提交/轮询 | 服务端（_engine.ts） | 引擎 :8002 | REST 契约对齐（outputs.image / ref_images / seed / model_preference） |
| 路径翻译（容器↔web） | 服务端（_engine.ts 出向 / _simulate 入向） | — | /mnt/agents/output ↔ /oss/ 前缀置换 + 入向双根探测 |
| 失败真化（error 广播） | 服务端（_simulate rethrow → execute/orchestrate 既有 catch） | 客户端 52-01 链 | execute.ts:72-73 / orchestrate.ts:102-108 的 error 广播代码已存在，只差 _simulate 不再吞错 |
| stale 消除（SC4） | 既有 useStaleRerun + applySocketNodeState | — | 零改动复用（本 phase 不碰） |

## Standard Stack

### Core（全部仓内既有，零安装）

| Library/Module | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `packages/flowgraph-v3/ts/src/stale.ts` | 3.1.0（仓内） | markStaleDownstream / getDownstreamIds 纯函数 | 宪法 §13 语义单点；客户端 canvasStore 同款消费 [VERIFIED: 代码现场] |
| `packages/flowgraph-v3/ts/src/migrate.ts` | 3.1.0 | migrateV2toV3（服务端把关系表 V2 图转 V3 供级联计算） | 事件 id 确定性合成 `evt_${n.id}`（migrate.ts:523）→ 服务端/客户端 triggerEventId 天然一致 [VERIFIED: 代码现场] |
| `src/lib/canvasRelationalStore.ts` | 仓内 | listNodes/loadFullGraph/upsertNode（stale 落库读写原语） | save-v2 唯一真值存储；loadFullGraph 返回 FlowGraphV2{meta.version:'2',nodes,links,branches,variantGroups}，与客户端 adaptV2Graph 消费的输入同源 [VERIFIED: 代码现场] |
| `src/routes/canvas/_engine.ts` | 仓内 | submitEngineTask/pollEngineTask（断点①④修现场） | Phase 39 适配层，storyboardPreview 同走此层 [VERIFIED: 代码现场] |
| express + zod + socket.io（broadcastToProject, src/utils/ws.ts:13-23） | 根仓既有 | 路由/校验/广播（`/ws/projects` 命名空间 room=project:{id}） | 仓约定 |

### Supporting

| Library | Purpose | When to Use |
|---------|---------|-------------|
| `src/routes/canvas/v2/import-from-dir.ts` 的 fsToOssUrl（现为模块私有，L194-212） | 断点②出向翻译 | export + 增补 `/mnt/agents/output` 分支（见 Pitfall 2，naive 复用恒 null） |
| Playwright e2e（packages/infinite-canvas）+ mock-backend :9876 | SC1-4 断言 | getCalls 请求体断言（58-03 范式）+ `window.__kaisCanvas.getGraph()`；mock 已有 `POST /__mock/emit`（server.mjs:380）可主动广播 socket 事件 [VERIFIED: 代码现场] |
| verify-phase-*.ts 聚合门范式（tsx 直跑） | SC3/SC5 负向断言 + 契约锁 | Phase 50/51/52/58 传统（runCmd/exists/read/forced-failure 骨架） |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| 服务端 migrateV2toV3 全图转换后级联 | 服务端手写 V2 因果遍历 | 违反 D-03「复用不改动」——语义双份必然漂移，拒绝 |
| node:updated 逐 stale 节点广播 | 单事件广播全 stale 集合 | 单事件省带宽但 payload 偏离既有 `{node}` 形状（nodes.ts:210 先例），客户端适配面更大；逐节点广播对齐既有格式（D-01 discretion 内推荐前者） |
| fsToOssUrl export 复用 | _engine.ts 内新写 3 行前缀置换 | D-06② 字面锁定「复用」；且 import 链未来增根时单点维护。export + 加分支为准 |

**Installation:** 无——本 phase 零 npm/pip 安装。

## Package Legitimacy Audit

本 phase 不安装任何外部包（全部仓内模块/既有依赖）。无 slopcheck 对象。

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| （无新增外部包） | — | — | — | — | — | N/A |

## Architecture Patterns

### System Architecture Diagram

```
【STALE-01/02 窄触发路径】
NodeDetailPanel.handleRegenerate (L729)          EventParamsPopover.handleRerollSeed (L83)
  │ executeNode(pid,eid, assetId, stage,          │ executeNode(pid,eid, outputAssetId, stage,
  │   {prompt, params})                            │   {params:{...evt.params, seed:新值}})
  └───────────────┬───────────────────────────────┘
                  ▼  POST /api/canvas/execute  (body 含 regen 身份标识[新增] + prompt/params/seed)
        execute.ts validateFields(zod, 不 strip 未知键)
                  │ episodesId 存在 → setImmediate
                  ▼
        simulateExecution(pid, nodeId, eid, overrides[签名扩展])
                  │ ① readNode → 关系表 listNodes（替代 legacy blob）
                  │ ② stage→TaskType 映射（V3 Stage 全集）
                  ▼
        _engine.submitEngineTask({taskType, prompt, seed, ref_images[容器路径], model_preference})
                  │ POST :8002/api/v1/tasks
                  ▼
        _engine.pollEngineTask(taskId) ── GET /api/v1/tasks/{id}
                  │ 读 raw.outputs.image（断点①）；/mnt/agents/output→/oss/（断点②）
                  ▼
        任务成功? ──否──> throw（断点③：不再 simulateOnly 假成功）
                  │              └→ execute.ts catch → broadcast node:state error（既有 L72-73）
                  ▼ 是
   ┌──────────────标记接线（本 phase 新增，唯一新服务端缝）──────────────┐
   │ loadFullGraph → migrateV2toV3 → markStaleDownstream([nodeId], now) │
   │ → diff 新 stale 资产集 → 逐节点 upsertNode(data.stale)（落库）      │
   │ → 逐节点 broadcastToProject("node:updated", {node})                 │
   └────────────────────────────┬──────────────────────────────────────┘
                                ▼ socket /ws/projects
        useCanvasSocket socket.on("node:updated")【新增，G1】
                  → triggerStaleCascade([triggerAssetId])（复用 markStaleDownstream 纯函数,幂等收敛）
                  → NodeBadges stale 角标 + cv-stale-pulse（零视觉改动）
                  → 用户点「重跑下游」= useStaleRerun（既有,零改动）→ save-v2 + orchestrate 子集
                                                  → node:state success → applySocketNodeState 清 stale（SC4, 52-01 链）

【STALE-03 负向路径（架构性保证）】
orchestrate.ts（无 regen 身份标识、无标记调用）→ simulateExecution → 各自广播 node:state
  → 永不触达 markStaleDownstream → 下游零 stale 角标（负向断言锁死）
```

### Pattern 1: 服务端标记缝（D-01 落点）
**What:** 在 execute.ts:68-75 的 setImmediate 成功块内（`await simulateExecution` resolve 后、success 广播前后）执行标记。不在 simulateExecution 内部做——它与 orchestrate 共享，放里面就得靠行为过滤而非结构隔离。
**When to use:** 唯一新增服务端接缝。
**Example:**
```typescript
// execute.ts L68-75 现状（成功/失败广播已存在，只差中间插标记）
setImmediate(async () => {
  try {
    await simulateExecution(projectId, nodeId, episodesId, overrides);
    if (regenMarker) await markStaleAndBroadcast(projectId, episodesId, nodeId); // 新增
    broadcastToProject(projectId, "node:state", { nodeId, state: "success" });
  } catch (err) {
    broadcastToProject(projectId, "node:state", { nodeId, state: "error" }); // D-02: 失败路径不进标记
  }
});
```

### Pattern 2: 服务端 stale 落库 + 广播
```typescript
// Source: 仓内证据组合 —— canvasRelationalStore.upsertNode(L91)/loadFullGraph(L987) / migrate.ts:523 / stale.ts:69 / nodes.ts:210
import { markStaleDownstream } from "../../../../packages/flowgraph-v3/ts/src/stale";
import { migrateV2toV3 } from "../../../../packages/flowgraph-v3/ts/src/migrate";
import { loadFullGraph, listNodes, upsertNode } from "@/lib/canvasRelationalStore";

async function markStaleAndBroadcast(pid: number, eid: number, changedAssetId: string) {
  const v2 = await loadFullGraph({ projectId: pid, episodesId: eid });
  if (!v2) return;
  const { graph: v3 } = migrateV2toV3(v2 as any); // 事件 id 确定性 evt_<nodeId>，客户端同款
  const next = markStaleDownstream(v3, [changedAssetId], Date.now());
  const prevById = new Map(v3.nodes.map((n) => [n.id, n]));
  const newlyStale = next.nodes.filter((n) => {
    if (n.kind !== "asset" || n.stale == null) return false;
    const prev = prevById.get(n.id);
    return !(prev && prev.kind === "asset" && (prev as any).stale != null); // 只写增量，不覆盖既有 since
  });
  const existing = await listNodes({ projectId: pid, episodesId: eid });
  for (const asset of newlyStale) {
    const row = existing.find((r) => r.id === asset.id);
    if (!row) continue;
    const data = { ...(row.data ?? {}) };
    data.stale = { since: asset.stale!.since, triggerAssetId: asset.stale!.triggerAssetId,
                   triggerEventId: asset.stale!.triggerEventId }; // serialize.ts:276-281 同款 wire 形状
    await upsertNode({ projectId: pid, episodesId: eid }, { ...row, data });
    broadcastToProject(pid, "node:updated", { node: { ...row, data }, changedFields: ["data.stale"] });
  }
}
```

### Pattern 3: 断点①②修正读法（_engine.ts pollEngineTask L132-140）
```typescript
// 引擎真实返回（活体实证 + TaskOutputs 模型 task.py:90-96）:
// { status:"completed", outputs:{ video, thumbnail, audio, image }, metadata:{seed,...}, ... }
if (status === "completed") {
  const out = raw.outputs ?? {};
  const containerPath =
    out.image ?? out.video ?? out.audio ?? out.thumbnail ??   // 真实形状（v6 全引擎经 _build_task_outputs 归一）
    raw.output_url ?? raw.outputUrl ?? null;                   // 旧读法保留为兜底（无害）
  const outputUrl = containerPath ? enginePathToOss(containerPath) : null; // 断点②
  return { taskId, status: "completed", outputUrl, raw };
}
```

### Pattern 4: regen 身份标识（Claude discretion 推荐形态）
```typescript
// canvasApi.ts executeNode extra 扩一字段（两个调用点各加一行）
extra?: { prompt?: string; seed?: number; params?: Record<string, unknown>;
          regenSource?: 'panel-regen' | 'reroll-seed' }   // 新增;orchestrate/ContextMenu 永不携带
// execute.ts zod: regenSource: z.enum(['panel-regen','reroll-seed']).optional()
// 服务端规则: regenSource 存在 = 窄触发（成功后级联）;不存在 = 既有行为（含 IterationEngine queued 路径）
```

### Anti-Patterns to Avoid
- **在 simulateExecution 内部做标记/用行为开关区分 orchestrate**：违反 D-01「架构性保证」；标记只属 execute 路由层。
- **import flowgraph-v3 的 index.ts 进服务端**：index.ts `export * from './zod.js'` 会拉 zod（包内 zod 3.23.8 vs 根仓 4.3.6，STATE Pitfall 4 版本分裂）；深链具体模块 stale.ts/migrate.ts（依赖仅类型+纯常量）。
- **服务端手写 V2 因果遍历代替 migrate+markStaleDownstream**：语义双份必漂移（D-03）。
- **断点③修复保留「引擎错误→simulateOnly」的任何降级**：GOLD_TEAM_URL 未配置的模拟模式是唯一合法保留分支（无引擎环境行为）；引擎配置了但调用失败必须 throw。
- **客户端 node:updated handler 里碰 normalizeSocketNodeState / 执行态映射**：UI-SPEC FLAG-3 红线（52-01 stale 保留语义）。
- **去 /data/workspace/kais-gold-team 查引擎源码**：该树与运行容器**不同源**（见 Pitfall 9）——查 `docker/gold-team/`。

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| 下游 stale 集合计算 | 自写 BFS/因果边遍历 | `flowgraph-v3 stale.ts markStaleDownstream/getDownstreamIds` | 宪法 §13 边界（sequence/isInactive/locked/环防御/最早 since 保留）单点维护，客户端同款 |
| V2→V3 图转换 | 自写节点/边映射 | `migrate.ts migrateV2toV3` | 事件 id 合成规则（`evt_` 前缀）必须与客户端一致，否则 triggerEventId 跨端漂移 |
| stale wire 形状 | 自定 data.stale 字段结构 | `{since,triggerAssetId,triggerEventId}`（serialize.ts:276 写侧 / migrate.ts d.stale 还原，双端契约） | 三字段缺一 migrate 还原为 null（stale 刷新即丢） |
| 引擎任务提交/轮询 HTTP | 新写 fetch 循环 | `_engine.ts` 既有 submitEngineTask/pollEngineTask（改内部） | storyboardPreview 共用此层，契约单点 |
| e2e 断言基建 | 新建 mock 服务 | mock-backend :9876 + getCalls/getGraph helpers + `/__mock/emit` | phase52-regen/58-recipe 已锁范式 |

**Key insight:** 本 phase 的一切「新」都是接线：语义函数、wire 契约、角标渲染、重跑出口全部已存在且被 e2e 锁定；唯一真正新写的逻辑只有路径翻译分支和 regen marker。

## Common Pitfalls

### Pitfall 1: 「客户端零改动」前提不成立（关键缺口 G1）
**What goes wrong:** D-01 设想的「既有 socket node:updated → triggerStaleCascade 链」今天**不存在**：useCanvasSocket.ts:136-244 的订阅清单（node:state/node:preview/node:created/execution:progress/orchestrate:*/branch:*/review:*/graph:saved/variant:selected/gate:state/canvas:event/canvas:reset）没有 `node:updated`；canvasApi.ts:648 注释明言「前端 socket 当前未消费该事件」；triggerStaleCascade 现调用方仅 VariantWall.tsx:206 与 NodeDetailPanel.tsx:62。59-UI-SPEC FLAG-1 已独立证实同结论。
**How to avoid:** 按 UI-SPEC §5 Option A 加一个 `socket.on('node:updated')` 订阅（+callbacks ref + FlowCanvas.tsx:267 接线 triggerStaleCascade），这是全 phase 唯一客户端改动（近零而非零）。Option B（reload-only 可见）会丢实时脉动且 SC1/SC2 e2e 只能 reload 后断言——不推荐。
**Warning signs:** e2e 里等角标出现超时而服务端日志已有 node:updated 广播。

### Pitfall 2: fsToOssUrl 现有分支不覆盖 /mnt/agents/output
**What goes wrong:** D-06②说「复用 import 链现成的 fsToOssUrl」，但该函数（import-from-dir.ts:194-212，模块私有）只认 `/oss/` 前缀、kap 本地 ossDir（`/data/workspace/kais-aigc-platform/data/oss`）、请求级 `_workdirToOss` 映射、http(s) URL 四类——`/mnt/agents/output/...` 输入**每分支都穿透返回 null**。直接调用不添分支 = 断点②白修。
**How to avoid:** export fsToOssUrl 并增补 `/mnt/agents/output` → `/oss/` 前缀分支（该分支是纯字符串运算，不依赖 `_workdirToOss` 全局态，测试可独立断言）。verify 脚本锁「/mnt/agents/output 输入 → 非 null」。注意 http(s) URL（cloud 引擎 CDN 直链形态）必须原样透传——活体任务 outputs 一律容器路径，但 cloud_kling 等引擎 artifact 可为 http。
**Warning signs:** 重生成后 node:preview 的 thumbnailUrl 仍是容器路径（图片 404）。

### Pitfall 3: 断点④入向翻译——引擎容器只挂了两个宿主目录
**What goes wrong:** `/oss/x` 反查宿主路径时，引擎容器（docker inspect 活体实证 Mounts）只挂载 `/mnt/agents/output`（rw）与 `/data/workspace/kais-hermes-skills`（ro）；kap 的 `data/oss` 目录**不在引擎可见范围**。活体任务里 kmc 传的 ref_images 是宿主绝对路径（`/data/workspace/kais-hermes-skills/...png`），证明「容器可见=宿主绝对路径且落在挂载点内」。
**How to avoid:** 入向翻译 oss→engine 做双根探测：`/oss/x` 先试 `/mnt/agents/output/x` 再试 kap `data/oss/x`，取 fs.existsSync 者；都不存在→按引擎错误处理（真失败，配合断点③）。若面板重生成确需引用 data/oss 独有资产作 i2i 参考图，需在 docker-compose 增挂 `data/oss`（kap 仓内改动，允许）——planner 裁定是否本 phase 做。
**Warning signs:** 引擎日志 dreamina CLI "no such file" 或 image2image 提交 400。

### Pitfall 4: 客户端全量 save 会抹掉服务端写的 stale（写-写竞态）
**What goes wrong:** save-v2 是全量替换（saveFullGraph + upsert 全行；upsertNode data 列整列覆盖）；serialize.ts 规则「stale 为 null 不写键」。若客户端图尚未消费 node:updated（未级联），此时任何全量保存（useStaleRerun 的保存、persistEventParams、layout 保存等）会把服务端刚写的 data.stale 整行抹掉——Phase 58 CR-01 配方被抹是同款事故。
**How to avoid:** ① 标记顺序：先落库后广播（Pattern 2 已按此序）；② 客户端 node:updated handler 即刻级联（Option A），使本端图与库收敛；③ e2e 覆盖「标记到达 → 随后全量 save → reload 后 stale 仍在」。竞态窗口（广播在途时他端 save）存在但窄——记录为已知边界，不做合并写。
**Warning signs:** reload 后角标消失、canvas_nodes.data 里 stale 键时有时无。

### Pitfall 5: orchestrate 自身也读 legacy blob（SC3 负向断言与共享修复的边界）
**What goes wrong:** orchestrate.ts 目标筛选（skip success/cached + 52-02 stale-success 不跳过谓词）直接读 `o_agentWorkData.canvasGraph` legacy blob，而 save-v2/sync-assets 只写关系表——修 readNode（共享）后 orchestrate 的「执行载荷」随之变真（用新 prompt），但其「目标筛选」仍读旧 blob，两处数据源不一致；且修断点③后 orchestrate 里引擎失败节点从假 success 变真 error（行为变化，但正是「真化」的应有语义）。
**How to avoid:** planner 明确裁决并把 SC3「零变化」限定为其本义：**stale 级联零触发 + 无 regen 通道结构保证**（负向断言锁这个）；共享 readNode 修复对 orchestrate 执行载荷的改善是 D-06③ 的自然外溢，如实记录进 59-VERIFICATION。orchestrate 自身的目标筛选读法是否同步换关系表留 planner 裁定（换=stale-success 谓词真正生效，与 SC4 链路一致性相关）。
**Warning signs:** orchestrate e2e 断言因 blob/关系表差异抖动。

### Pitfall 6: NODE_TYPE→TaskType 映射缺口是「重生成拿不到引擎」的隐藏层
**What goes wrong:** `_simulate.ts:18-24` 只有 5 个 v1.7 类型（script/asset/storyboard/video/audio）；execute.ts:58-62 supportedTypes 允许 17 种（含 V3 Stage 全集），不匹配者落 simulateOnly——即使修好 readNode，`global`（p04 角色/p07 场景，面板重生成主力资产）/`keyframe`/`voice` 等仍永远不触引擎。
**How to avoid:** 补齐映射（证据表见「State of the Art」节）；`mix`/`composite` 无引擎 TaskType 对应——保持 simulateOnly 或显式报错，planner 裁定（建议：显式 console.warn + simulateOnly 维持现状，避免批量路径突变）。另外注意服务端 readNode 拿到的 store node.type 是粗粒度 V2 类型（asset/...），V3 Stage 以**请求体的 nodeType**为准——映射键优先用请求值、store 值兜底。
**Warning signs:** verify 断言「global stage regen → submitEngineTask 被调用」失败。

### Pitfall 7: model_preference 不设则 image 任务可能走本地 ComfyUI 而非 cloud-jimeng
**What goes wrong:** `_engine.ts` submit 不传 model_preference（默认 AUTO）；引擎 router AUTO 下本地健康时 image_draw 走本地 ComfyUI。本机既定政策是生图走 cloud-jimeng（dreamina-model-policy 2026-08-19：t2i 5.0/i2i 强制 4.6 白名单，cloud_jimeng.py:38-40 `_T2I_DEFAULT_MODEL="5.0"`/`_I2I_MODEL="4.6"` 实证）；活体任务里 kmc 全部 `model_preference:"cloud"`。
**How to avoid:** canvas execute 链 image 类任务显式 `model_preference:"cloud"`（对齐 kmc 惯例）。副作用要如实记录：cloud-jimeng **不接受 seed**（dreamina CLI 无 seed 参数；cloud 参数直通表 executor.py:708 仅 prompt/ratio/model_version/ref_images）——seed 透传对 cloud 路径只落 metadata.seed（活体实证默认 42），确定性重放仅本地 ComfyUI 路径成立；jimeng 本身非确定性，换 seed 语义仍达成（换个结果）。
**Warning signs:** regen 产物风格突然变 ComfyUI 味；metadata.seed 有值但两次同 seed 结果不同。

### Pitfall 8: zod schema 漏加 regenSource/seed 字段不报错（validateFields 不 strip）
**What goes wrong:** middleware（middleware.ts:8-27）safeParse 后 next()，未知键原样穿透——服务端漏声明 regenSource 不会 400，只是 handler 拿不到类型提示；52-02 的 params 注释即为防此雷而写。
**How to avoid:** execute.ts validateFields 显式加 `regenSource`（zod enum optional）；verify 静态断言 zod 声明存在（52-02 S1 同款断言扩一字段）。

### Pitfall 9: 引擎源码双树陷阱——运行容器 ≠ /data/workspace/kais-gold-team（第二轮研究发现）
**What goes wrong:** 仓内有两份 gold-team v6 源码：kap 仓 `docker/gold-team/src/v6/`（**运行容器实际构建源**）与独立仓 `/data/workspace/kais-gold-team/src/v6/`（**陈旧分叉**）。两者已实质分叉：陈旧树 executor.py **没有** ref_images cloud 直通表、IMAGE_REFINE 只认 `params.image`；cloud_jimeng 还是旧的 jimeng-free-api HTTP proxy 版。在陈旧树上核对断点④契约会得出「引擎不收 ref_images」的错误结论，直接误导实现。
**How to avoid:** 一切引擎契约核对以 kap `docker/gold-team/src/v6/` 为准 + :8002 活体任务交叉验证（本轮 `GET /api/v1/tasks?limit=3` 实证 ref_images/passthrough 表与运行行为一致）；如需改引擎（本 phase 不需要）也只改 docker/gold-team 并重建容器。
**Warning signs:** grep `/data/workspace/kais-gold-team` 找 ref_images 无命中而活体任务 params 里明明有。

## Code Examples

### 引擎契约（活体实证，两轮一致，2026-08-23 GET :8002/api/v1/tasks?limit=3）
```json
// completed 任务（kmc 真实调用方 sf-s02_b01-*）:
{ "task_id": "sf-s02_b01-1787483160", "type": "image_refine", "status": "completed",
  "model_preference": "cloud", "engine_id": "cloud-jimeng",
  "params": { "prompt": "…", "ratio": "9:16",
              "ref_images": ["/data/workspace/kais-hermes-skills/…/l2_zhongkui_s2_red_funeral_robe.png"] },
  "outputs": { "video": null, "audio": null,
               "thumbnail": "/mnt/agents/output/jimeng_1787483160_6384/output.png",
               "image":      "/mnt/agents/output/jimeng_1787483160_6384/output.png },
  "metadata": { "seed": 42 } }
// failed 任务:error 字段带原因（"Generation timed out" / "generation failed: …"）→ 断点③修复后可真实上报
```
[VERIFIED: :8002 live probe ×2 + docker/gold-team/src/v6/models/task.py:90-127 TaskOutputs/TaskDetailResponse]

### 引擎提交契约（docker/gold-team/src/v6/executor.py:703-717 cloud 参数直通）
```python
# 云引擎消费 params 顶层键: prompt / ratio / model_version / ref_images
if str(getattr(engine, "engine_id", "")).startswith("cloud-"):
    for key in ("prompt", "ratio", "model_version", "ref_images"):
        if task.params.get(key) is not None: engine_params[key] = task.params[key]
    if "ref_images" not in engine_params:      # 兜底: params.images/image → ref_images
        ref = task.params.get("images") or task.params.get("image")
# seed 不在直通表:本地引擎经 workflow builder 读 params.seed;完成时 metadata.seed=params.seed(默认42)
```
[VERIFIED: docker/gold-team/src/v6/executor.py L703-717 + live probe params/metadata]

## State of the Art

### execute 链现状 vs 目标（四断点全谱）

| # | 现状（代码现场） | 目标 | 修法落点 |
|---|------------------|------|----------|
| ① | `_engine.ts:133-139` 读 `raw.output_url/raw.outputUrl/raw.result?.*` — v6 引擎（含 mock/cloud/local，全经 `_build_task_outputs` 归一为 `outputs.{image,video,audio,thumbnail}`）**无一键命中** → outputUrl 恒 null | 读 `raw.outputs?.image ?? .video ?? .audio`（+旧键兜底） | pollEngineTask completed 分支 |
| ② | outputs.image 是 `/mnt/agents/output/<task>/output.png` 容器路径，node:preview 直接广播 → web 404 | 翻译为 `/oss/<task>/output.png`（app.ts:74-87 /oss 静态已能服务） | export fsToOssUrl + 增 `/mnt/agents/output` 分支 |
| ③ | `_simulate.ts:144-147` catch 任何引擎错误 → simulateOnly → execute.ts:71 广播 success（假成功）；readNode(L33-53) 读 legacy blob `o_agentWorkData.canvasGraph`（save-v2 只写关系表 → v2 项目 readNode 恒 null → 恒 simulateOnly，**真引擎路径对现代项目整体是死的**） | readNode 改 canvasRelationalStore；引擎错误 rethrow（GOLD_TEAM_URL 未配置的模拟模式保留） | _simulate.ts readNode + catch |
| ④ | `_engine.ts:76-78` 发 `params.reference_images`（值经 storyboardPreview 是 `o_asset.url` = `/oss/` web 路径）；引擎只认 `ref_images` 且要容器可见宿主路径（活体实证） | 参数名改 `ref_images`；值做 `/oss/`→双根探测宿主路径 | submitEngineTask payload + 新入向翻译 |
| ⑤(seed) | execute.ts:28 校验 params 后 handler 不消费（L31 解构丢弃，注释自认「接受并忽略」）；EventParamsPopover 新 seed 只在请求体（地雷 #12） | body.params.seed → submitEngineTask params.seed（本地引擎确定性/cloud 落 metadata） | execute.ts 解构 + simulateExecution overrides 透传 |
| ⑥(映射) | NODE_TYPE_TO_TASK_TYPE 5 类型；V3 Stage（global/keyframe/voice/foley/bgm/mix/composite）全落 simulate | 补映射（下表） | _simulate.ts 映射表 |

### V3 Stage → 引擎 TaskType 映射证据表（planner 终裁）

| Stage（types.ts Stage union） | 建议 TaskType | 依据 |
|--------------------------|---------------|------|
| global（p04 角色/p07 场景） | `image_draw`（无参考）/ `image_refine`（有上游参考） | 面板重生成主力；jimeng t2i 5.0 白名单 |
| script | 无引擎（短路 simulateOnly，现状保留） | script 纯文本节点 |
| storyboard | `image_draw` / 有参考 `image_draw_ipadapter`（storyboardPreview.ts:113-116 先例） | L17 既有注释 |
| keyframe | `image_draw` / `image_refine` | 首帧/关键帧图 |
| video | `video_final` | 既有映射沿用 |
| voice | `tts`（引擎另有 tts_zh/tts_en/tts_bilingual 可细分） | task.py TaskType 枚举 |
| foley | `sfx` | 同上 |
| bgm | `music` | 同上 |
| mix / composite | 无对应 TaskType —— 建议维持 simulateOnly + warn（或显式报错，planner 裁定） | 引擎无混音/合成类型 |
| （legacy）3d | 引擎有 `image_to_3d` 但 kap `_engine.ts` TaskType 联合缺它——窄路径外，本 phase 不扩 | 范围纪律 |

**Deprecated/outdated:**
- `o_agentWorkData.canvasGraph` legacy blob 作为 execute/orchestrate 读取源（本 phase 治 _simulate 侧；orchestrate 筛选侧见 Pitfall 5）；graph-helpers.ts 仍只写 blob（review approve/reject 用）——仓内已知双存储债，本 phase 不扩 scope 但不新增读取点。
- `/data/workspace/kais-gold-team` 独立树作为引擎契约参考（已被运行容器甩开，见 Pitfall 9）。

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | 面板/芯片重生成成功后产物「真实落画布」以 node:preview（/oss/ URL→缩略图）+ 可选 data.filePath 落库为验收口径 | SC5 / Pattern 3 | 若要求产物作为新资产节点/变体入图，改动面显著扩大——planner 需与 SC5 原文「真实落画布」对齐口径 |
| A2 | mix/composite stage 维持 simulateOnly（不显式报错）以守 SC3 批量路径稳定 | Pitfall 6 | 若用户期望这些 stage 真化报错，需 planner 裁定反转 |
| A3 | image 任务补 `model_preference:"cloud"`（对齐 kmc 惯例与本机 dreamina 政策） | Pitfall 7 | 若本机期望走本地 ComfyUI（可确定性 seed 重放），该选择反转——两条路径 seed 语义不同，需用户确认 |
| A4 | 断点④最小实现：面板重生成默认 t2i（image_draw）；解析上游产物作 ref_images（i2i）是增强位而非 SC5 硬门槛 | Pitfall 3 / 映射表 | 若「ref_images 参数全对齐」被解读为必须解析上游因果输入为参考图，需加解析逻辑（因果输入边遍历） |
| A5 | `_engine.ts` TaskType 联合不需扩（3d/wan_i2v/shot_analysis 不进窄路径） | 映射表 | 低风险；扩了也无害 |

## Open Questions

1. **A1 口径——「产物真实落画布」的验收深度**
   - What we know: node:preview → applySocketNodePreview 更新 media.thumbnail（实时视觉）；data.filePath 落库为可选增强。
   - What's unclear: SC5 是否要求产物成为持久化资产事实（reload 后仍在）。
   - Recommendation: planner 把「thumbnail 实时 + filePath 落库（reload 保真）」写进任务验收，成本一行 upsertNode。
2. **A3——image 任务 engine 路由政策**
   - Recommendation: 默认 cloud（jimeng）并在 VERIFICATION 记录 seed 语义差异；如需本地确定性重放可留 env 开关。
3. **orchestrate 目标筛选是否同步换关系表读法**（Pitfall 5）
   - Recommendation: 换（一致性 + 52-02 stale-success 谓词才真正生效，SC4 链路依赖它）；但作为独立小任务并负向断言「不引入级联」。

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| 引擎 :8002（gold-team v6，容器 kais-aigc-platform-gold-team-1） | 断点①④修复验证 / probe-59-real | ✓（两轮探测 healthy：v6.0.0；/api/v1/engines 10 引擎 5 online，cloud-jimeng online 支持 image_draw/image_refine；docker inspect 实证挂载 /mnt/agents/output rw + kais-hermes-skills ro + dreamina CLI） | 6.0.0 | verify 用本地 fake HTTP 引擎（随机端口）不依赖真机 |
| kap :10588（生产 dev server） | probe-59-real 零足迹真机探针 | ✓（/api/canvas/projects 200） | build 产物运行 | 探针 SKIP 退出口径（probe-58-real 同款：不阻塞 verify 门但 SUMMARY 记录） |
| esbuild 生产链（build:server → data/serve/app.js） | 服务端 import flowgraph-v3 的部署路径 | ✓（bundle 实测含跨包相对 import 内容；tsx dev 链同构） | esbuild（仓内） | — |
| Playwright / vitest / tsx | 全部测试层 | ✓ 仓内既有 | @playwright/test 1.61 / vitest 2.1.9 | — |
| /mnt/agents/output ↔ /oss 服务链 | 断点② | ✓ app.ts:74-87 静态 fallback 已上线（.env OUTPUT_DIR=/mnt/agents/output 实证） | — | — |

**Missing dependencies with no fallback:** none。
**Missing dependencies with fallback:** 无（:8002/:10588 均在线；即便下线，verify 走 fake 引擎 + 探针 SKIP 条款）。

## Validation Architecture

> config.json 无 `workflow.nyquist_validation` 键 → 视为启用。测试基建沿仓约定：根仓无测试框架（STATE Pitfalls B3/B4）→ verify-phase-*.ts 聚合门；双包 vitest；e2e Playwright :9876 mock。

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 2.1.9（packages/infinite-canvas + packages/flowgraph-v3/ts）· Playwright 1.61（e2e）· tsx 聚合门（根仓） |
| Config file | packages/infinite-canvas（vitest 内置）/ packages/flowgraph-v3/ts（vitest 内置）/ playwright.config.mjs（既有，webServer=mock-backend :9876，workers=1 串行） |
| Quick run command | `npx tsc --noEmit`（根仓）+ 触及包 `npx vitest run <最窄相关文件>` |
| Full suite command | `npx tsx scripts/verify-phase-59.ts`（新建聚合门，内含三根 tsc + 双包 vitest + 契约断言 + forced-failure） |

### Phase Requirements → Test Map（含 SC1-5 断言面）

| Req/SC | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| STALE-01/SC1 | 面板 regen 成功 → 下游 stale 角标出现（`svg[aria-label="stale"]`） | e2e（mock: execute 200 → mock 侧发 node:state success + node:updated 契约事件 → 断言角标 + getGraph().stale.triggerAssetId；`/__mock/emit` 已可用） | `cd packages/infinite-canvas && npx playwright test test/e2e/tests/phase59-stale-cascade.mjs -g "panel"` | ❌ Wave 0 |
| STALE-02/SC2 | 芯片换 seed 成功 → 同款角标；请求体含 seed 透传断言 | e2e + 请求体断言 | `… -g "reroll"`（getCalls 找 /api/canvas/execute body.params.seed） | ❌ Wave 0 |
| STALE-03/SC3 | orchestrate/batch 成功 → 角标计数不变（负向） | e2e 负向 + 服务端集成负向 + 静态结构断言 | `… -g "orchestrate"`；verify S 段（spawn 真路由无 regenSource 执行 → canvas_nodes 零 data.stale 新增；grep orchestrate.ts 无 markStaleDownstream import） | ❌ Wave 0 |
| SC4 | stale 节点经既有出口重跑 → success 后角标消失（52-01 链），无关节点不受波及 | e2e（既有 phase52-stale-panel 已覆盖大半，本 phase 复跑 + 服务端标记来源变体） | `… -g "rerun-clears"` | 部分（phase52-stale-panel.mjs 可复用） |
| SC5/断点① | poll 读 outputs.image（不再恒 null） | 单元/集成（fake 引擎 :随机端口 返回活体形状 → submitEngineTask+pollEngineTask 直调断言 outputUrl=/oss/…） | verify S 段直调（tsx 脚本内 http server） | ❌ Wave 0 |
| SC5/断点② | /mnt/agents/output→/oss/ 翻译 | 单元（fsToOssUrl export 后直测新分支；http URL 透传分支同测） | verify 内断言或 vitest | ❌ Wave 0 |
| SC5/断点③ | 引擎错误 → node:state error 广播，**无** success（负向）；GOLD_TEAM_URL 未配置仍模拟 | 集成（fake 引擎 500/超时 → spawn execute 路由 → 收集广播事件） | verify S 段（verify-phase-49 子进程 dispatch 范式，注意 knex 池不落共享进程的 49-01 教训） | ❌ Wave 0 |
| SC5/断点④ | 提交体 params.ref_images（非 reference_images）且值为宿主路径 | 集成（fake 引擎捕获请求体断言） | verify S 段 | ❌ Wave 0 |
| REGEN-02/seed | body.params.seed 到达引擎任务 params.seed | 集成（fake 引擎捕获）+ e2e getCalls | verify S 段 | ❌ Wave 0 |
| 级联语义（D-03/04） | 服务端标记与客户端 markStaleDownstream 收敛一致（locked/isInactive/sequence 边界） | 单元（flowgraph-v3 stale.test.ts 既有基线 + 服务端 markStaleAndBroadcast 对 fixture 图的期望快照） | `cd packages/flowgraph-v3 && npx vitest run` + verify S 段 | 部分（stale.test.ts ✅） |
| reload 保真（D-05） | 服务端写 data.stale → load-v2 → migrate 还原 stale | 集成（:memory: sqlite 仓内既有测试库模式） | verify S 段 | ❌ Wave 0 |

### Sampling Rate（Nyquist 采样策略）
- **Per task commit（快速回路）:** `npx tsc --noEmit`（根仓）+ 触及包的 `npx vitest run <最窄相关文件>`——保证类型与纯函数回归在秒级反馈。
- **Per wave merge:** `npm run verify:phase-59`（聚合门：三根 tsc + 双包 vitest + 全部契约/负向断言 + forced-failure 自检）+ `cd packages/infinite-canvas && npm run build && npx playwright test test/e2e/tests/phase59-stale-cascade.mjs`（e2e 前置纪律：serve dist 非 source，地雷 #10）。
- **Phase gate（/gsd:verify-work 前）:** 全量 e2e 套件（含 phase52 三件套回归——级联改动共享 stale 面）+ probe-59-real（:10588 真机零足迹：选真项目窄路径 regen → 轮询 canvas_nodes 出现 data.stale → finally 恢复原 图（probe-58-real 零足迹范式））+ SC3 真机负向（orchestrate 子集 → 断言零新增 stale 行）。
- **负向断言三件套（锁死）:** ①无 regenSource 的 execute（ContextMenu 路径）→ 零 stale 写；②orchestrate → 零 stale 写；③引擎故障 → error 广播且零 stale 写（D-02）。

### Wave 0 Gaps
- [ ] `scripts/verify-phase-59.ts` — 聚合门骨架（S 段划分：断点①②/③/④+seed/级联接线/SC3 负向/SC5 负向/命令门/forced-failure）+ package.json 注册 `verify:phase-59`
- [ ] `packages/infinite-canvas/test/e2e/tests/phase59-stale-cascade.mjs` — SC1-4（mock-backend 需扩：execute mock 认 regenSource 并回放 node:updated 契约事件；`/__mock/emit` 已可手动广播）
- [ ] fake 引擎 fixture（verify 内联 http server，返回活体实证形状——含 outputs.image 容器路径/failed+error/params 捕获三模式）
- [ ] fsToOssUrl export + 新分支的单测挂点（import-from-dir 侧或搬移后位置——planner 定居住所）
- [ ] probe-59-real.mjs（:10588 零足迹探针 + 恢复逻辑）

## Security Domain

> config.json 未设 `security_enforcement` → 缺省启用。

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no（既有会话面不变） | — |
| V3 Session Management | no | — |
| V4 Access Control | partial | execute/orchestrate 路由既有鉴权链不变；regenSource 仅作标记信号**不得**当权限依据（客户端可伪造——本 phase 语义上无害：多标 stale 只是 UI 提示，重跑仍走既有通道） |
| V5 Input Validation | yes | zod：`regenSource: z.enum([...]).optional()`（白名单枚举，禁裸 string）；params 既有 record 校验沿用；seed 数值经引擎侧 pydantic 二次校验 |
| V6 Cryptography | no | — |

### Known Threat Patterns for 本 phase 改动面

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| 路径穿越（/oss/…/../../etc 传入向翻译→引擎读任意宿主文件） | Information Disclosure / Tampering | 入向翻译先 path.posix.normalize + 前缀白名单校验（结果必须落在 /mnt/agents/output 或 data/oss 或 kais-hermes-skills 挂载根内），拒绝 `..` 逃逸（仓内先例：src/utils/replaceUrl.ts 同款防穿越） |
| 伪造 node:updated 广播污染画布 | Tampering | 既有 broadcastToProject 通道信任模型不变（ws 命名空间按 projectId 隔离）；payload 只消费 node.data.stale 三字段且经 restoreStaleInfo 同款轻校验形状（畸形→忽略） |
| 引擎输出 URL 注入（outputs.image 非预期值直灌前端） | XSS/Tampering | 翻译层只接受 `/mnt/agents/output` 前缀字符串输出（非该前缀原样 null/保留 http 透传），不做 HTML 拼接；前端仅作 img src（React 转义面） |
| 假成功掩盖引擎故障（既有风险，本 phase 修复对象） | Repudiation | 断点③真化 + error 广播 + 负向断言——审计面增强而非新增风险 |

## Sources

### Primary (HIGH confidence)
- 代码现场（两轮 Read 核对一致）：`src/routes/canvas/execute.ts`、`_engine.ts`、`_simulate.ts`、`orchestrate.ts`、`storyboardPreview.ts`、`v2/save-v2.ts`、`v2/load-v2.ts`、`v2/nodes.ts:130-214`、`v2/import-from-dir.ts:176-212`、`src/lib/canvasRelationalStore.ts:91,162,987-1030`、`src/app.ts:60-115`、`src/middleware/middleware.ts:8-27`、`src/utils/ws.ts:13-23`、`src/utils/replaceUrl.ts`、`docker-compose.real.yml`、`packages/flowgraph-v3/ts/src/{stale,migrate,index,recipe}.ts`（migrate.ts:523 evt_ 合成；stale/migrate runtime import 链核实：仅 integrity.js+recipe.js）、`packages/infinite-canvas/src/services/canvasApi.ts:331-388,648`、`hooks/{useCanvasSocket,useStale,useStaleRerun}.ts`、`store/canvasStore.ts:430-475,695-760`、`components/panel/NodeDetailPanel.tsx:726-737`、`components/eventParams/EventParamsPopover.tsx:75-95`、`components/CanvasContextMenu.tsx:57`、`v3/serialize.ts:42-46,274-281`、`v3/adapter.ts:491-530（adaptV2Node 单节点迁移先例）`、tsconfig.json（exclude packages 但 import 图可达）、package.json scripts（build:server esbuild alias @/）
- 引擎源码（**运行容器构建源 = kap `docker/gold-team/src/v6/`**）：models/task.py:90-127（TaskOutputs/TaskDetailResponse）、executor.py:570-650（IMAGE_REFINE 双通道 image/ref_images）、:703-717（cloud 直通表）、:960-1010（_build_task_outputs + /mnt/agents/output fallback）、engines/cloud_jimeng.py:38-40,118-177,209-287（dreamina CLI、模型白名单 5.0/4.6、ref_images→--images、无 seed）、engine/router.py:160-195（image_*→cloud-jimeng）
- 引擎活体探测（两轮，2026-08-23 15:00 与 23:10）：GET :8002/health（healthy, v6.0.0）、GET :8002/api/v1/engines（10 引擎 5 online；cloud-jimeng online）、GET :8002/api/v1/tasks?limit=3（真实 completed/failed 任务样本：outputs.image 容器路径 / params.ref_images 宿主绝对路径 / model_preference=cloud / metadata.seed=42 / error 字段）、`docker inspect kais-aigc-platform-gold-team-1`（Mounts 实证）
- 生产 bundle 实证：`data/serve/app.js`（2026-08-23 21:48 构建物）grep PHASE_REGISTRY 命中——跨包相对 import 经 build:server esbuild 打包存活
- 仓内文档：59-CONTEXT.md、59-UI-SPEC.md（FLAG-1/2/3 与本研究独立交叉印证）、REQUIREMENTS.md、ROADMAP.md Phase 59、STATE.md（Phase 49/58 决策史）、memory: kmc-kap-engine-canvas-review-2026-08-23（四断点原始记录）

### Secondary (MEDIUM confidence)
- dreamina CLI 无 seed 参数（由 cloud_jimeng.py 的 CLI 调用参数表反推 + cloud 参数直通表无 seed + 活体 metadata.seed 恒 42 佐证）——结论可靠但未读 dreamina 二进制本身

### Tertiary (LOW confidence)
- 无

## Metadata

**Confidence breakdown:**
- 引擎契约（断点①④/seed/model_preference）: HIGH — 活体任务（两轮探测一致）+ 运行容器构建源源码双证
- 服务端级联接线可行性: HIGH — import 先例（import-from-dir.ts:81 运行时值导入 + 生产 bundle 实证）+ 确定性事件 id + loadFullGraph/migrate 形状核对
- 客户端改动面: HIGH — 订阅清单逐一核对（G1 缺口确凿，UI-SPEC 独立同证）
- 映射表/A1-A4 口径: MEDIUM — 证据充分但属 planner 裁定域

**Research date:** 2026-08-23（两轮合并）
**Valid until:** 2026-09-23（仓内代码域，稳定；引擎契约随 gold-team 容器重建变化需复核）
