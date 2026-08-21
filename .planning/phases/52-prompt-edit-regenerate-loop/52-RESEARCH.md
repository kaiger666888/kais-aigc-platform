# Phase 52 Research — 生成-迭代闭环 (Prompt Edit → Regenerate Loop)

**Researched:** 2026-08-21
**Inputs:** 52-CONTEXT.md (16 锁定决策) · 51-RESEARCH.md · 51-02-SUMMARY.md · REQUIREMENTS.md · STATE.md · 代码实证(全部关键文件已直读)

---

## Summary

Phase 52 的图景是"四条需求、两颗真地雷、其余皆是接线"。地基(51 的 canonical 写路径 + save-v2 + 模拟器执行通道)全部就位，但直读代码后发现**两个不解决就会让功能"看着能跑、一刷新就没"的结构性缺口**:

1. **事件配方不落盘**:`serializeGraphToV2` 丢弃全部 event 节点(51 锁定语义),reload 时 `migrate.ts §14 recipeParams` 只从**产出资产节点的 flat `data.prompt/data.seed/data.engine`** 重建 `EventNodeV3.params`。因此 `updateEventParams` 写了 canonical 之后，若序列化器不反向把产生事件的 prompt/seed/engine 覆盖回产出资产的 data 袋，**prompt 编辑在第一次保存+刷新后无声丢失**。这是 REGEN-01 的成败手。
2. **stale 不可见于服务端**:`asset.stale` 在 migrate 时硬编码 `null`、序列化器也不写——orchestrate 服务端"对 stale success 节点不跳过"的锁定决策**没有信息通道**(`orchestrate.ts` 只读持久化 V2 blob)。必须给 wire 加 `data.stale` 标记(同时顺手修复 stale 刷新即丢的预存缺口),否则 REGEN-03 服务端改动无从落地、e2e 也无法注入 stale 态。

其余关键实证结论:
- `updateEventParams` **无 allowlist 风险**——`META_PATCHABLE_KEYS` 只管 `updateAssetMeta`(资产 meta strict 判别联合);事件 params 的 zod 是 `generationParamsSchema.catchall(z.unknown())`(全图唯一非 strict 点),任意 key 合法。
- `validateFields` 中间件**只校验不回写**(`safeParse` 后 `next()`,`req.body` 原样保留)——`params` 等未声明 extra key 不会被剥掉，但为契约诚实仍应补进 execute.ts zod shape。
- mock backend 的 `logCall` 对 execute/orchestrate **只挑字段记录**,e2e 要断言"任务参数含新 prompt/seed"必须先让 mock 记录完整 body;mock 的 orchestrate skip 逻辑(L260)也要镜像服务端 stale 改动。
- e2e 跑 dist 非源码(51-02 教训),复跑前必须 `npm run build`;phase35/phase40 现有断言与 REGEN-04 单击行为变更**零冲突**(全部用 dblclick 开面板、✕ 关面板)。

---

## Task 1 — updateEventParams 设计

### 模板(已直读 canvasStore.ts L573-655)

51-02 三 action 的范式完全可套:
- **早退守卫**:graph===null / 节点不存在 → `console.warn` 静默早退(不 throw;socket/异步时序安全)。
- **写入通道**:`applyGraphTransform((g) => ({...g, nodes: g.nodes.map(...)}))` 纯函数映射,`setGraph` 重建派生缓存(memo 按 graph 引用失效,边中点 op 芯片的 params 快照随之刷新——无需额外失效处理)。
- **空值语义**:`undefined/null/''` = 删字段(与 updateAssetMeta「未设置」清空语义对齐)。

### 建议签名(Claude discretion 内)

```ts
updateEventParams: (eventId: string, patch: Partial<GenerationParams>) => void
```
- 守卫加一条:目标节点 `kind !== 'event'` → warn 早退(防误传 asset id)。
- **不需要 allowlist**:GenerationParams 有 `[key: string]: unknown` catchall(types.ts L191),zod `generationParamsSchema.catchall(z.unknown())`(zod.ts L115)——与 META_PATCHABLE_KEYS 的 strict 联合场景根本不同。轻量防御可做可不做(已知 key 类型不符时 warn),不建议引入 key 白名单(会堵死 op 级扩展字段如 `variantRecipes`、`sourcePath`)。

### Round-trip(成败手,必须随本 phase 做)

**链路实证**:
- 保存:`serialize.ts` L212-213 `if (n.kind !== 'asset') continue` — event 不落盘;L246-251 output 边折叠丢弃。
- 重载:`migrate.ts` L153-160 `recipeParams`:`params.prompt = d.prompt; params.seed = d.seed; params.modelVersion = d.engine`;L473-479 **script 例外**(prompt → content,不进 params,P4 防两处抄);L466-472 import 种子事件只带 `sourcePath`。

**结论**:序列化器必须加"事件配方反向覆盖"——对每个资产节点,经 `role:'output'` 边找产生事件,把 `event.params.prompt → data.prompt`、`event.params.seed → data.seed`、`event.params.modelVersion → data.engine` 覆盖进 data 袋(在 `{...raw, ...flattenMeta}` 之后再覆盖,保证 canonical 事件配方是最终真值)。**script stage 跳过 prompt 覆盖**(其真值是 content,flattenMeta 已处理);资产无产生事件或事件无该字段时不伪造。`serializeGraphToV2` 已能拿到完整 graph(含 event 节点与 links),改动自包含。

**窄通道警告**:§14 采集只有 prompt/seed/engine 三个字段——`steps/cfg/lora/quant` 等配方字段**保存+刷新后本来就丢**(预存损耗,非本期引入)。本期 updateEventParams 只编 prompt 是安全的;若未来要持久化全配方,需 §14 采集扩列(migrate + serialize 双侧),记入地雷。

### 持久化动作编排

`保存`按钮 = `updateEventParams` + save-v2 持久化 + 失败回滚。建议照 `deleteNode`(canvasStore.ts L739-792)的店级范式做一个带持久化的 action(乐观写 → `saveCanvasGraph(pid, eid, serializeGraphToV2(cur, rawDataByNodeId))` → 失败回滚 prevParams + error toast),**不要**让 PromptSection 组件自己拼 serialize+api(保持写入方统一在 store)。这样 NodeDetailPanel 的 `Props={node,onClose}` 签名不变(phase35 契约注释 L10 明确要求),PromptSection 直接 `useCanvasStore` 取 action 与 projectId/episodesId。

---

## Task 2 — PromptSection 反查逻辑

### 反查(唯一正道)

```ts
const producingEventIds = graph.links.filter(l => l.role === 'output' && l.target === asset.id).map(l => l.source)
const evt = graph.nodes.find(n => n.kind === 'event' && producingEventIds.includes(n.id))
```

### 边缘 case 实证(比表面多)

| 情况 | 实证来源 | UI 建议 |
|---|---|---|
| **变体组落选候选** | migrate.ts L714-734:候选事件被**删除并并入 winner 的 `params.variantRecipes`**——候选资产在 canonical 图里**没有产生事件** | 只读提示「落选变体配方已并入主事件 variantRecipes」,不给编辑框(否则编辑无处可写) |
| **import 种子事件** | migrate L463-472:孤儿/全局资产补 `op:'import'` 事件,params 仅 `sourcePath` | 可编辑(prompt 初始为空);语义=给导入资产补配方后重抽,合理放行 |
| **无任何产生事件**(fixture 手造图/异常数据) | P2 保证 migrate 路径 1:1 有事件,但 fixture/直通模式无此保证 | 整块只读 + 提示「无产生事件」,保存/重生成按钮 disabled |
| **多个产生事件** | migrate 恒 1:1(`evt_${assetId}`),理论防御 | 取第一条 link 序,加 console.warn;不阻塞 |

### 位置与契约

AssetDetail 区块序(NodeDetailPanel.tsx L151-164):`MediaViewer → CurationBadge → MetaRenderer → ShotIntentSection → RawDataSection → ...`。CONTEXT 锁定插入点是 **MetaRenderer 与 RawDataSection 之间**(即 ShotIntentSection 之后、RawDataSection 之前——注意 L156 还有个 ShotIntentSection,别插错位置)。

### 重生成按钮的 nodeId 选择(重要实证)

持久化 V2 blob 里**没有 evt_* 节点**,`_simulate.ts readNode` 按 nodeId 查 blob:
- 传 **eventId**(evt_*):readNode → null → nodeType='' → `simulateOnly` 降级模拟,正常广播 success——但 `applySocketNodeState(evt_id)` 只更新不可见的 canonical 事件节点,**画布资产卡无 running/success 反镭**。
- 传 **assetId**:readNode 命中,simulate 正常,node:state 打到资产节点 → 51-02 canonical 回写上屏 + REGEN-03 的 stale 清除自动生效。

**建议:重生成/换 seed 统一用产出资产 id 作为 execute 的 nodeId**(params/prompt 携带配方),eventId 仅用于 canonical 写回。这与 CONTEXT「executeNode(projectId, episodesId, eventId, …)」字面不同,但 CONTEXT 该条的核心锁定是"同配方+新 seed 提交+复用 execute 通道",nodeId 选择属实现层;plan 应明写此裁定及理由(可视化反馈 + stale 清除链都依赖资产 id)。

---

## Task 3 — execute 通道契约

### 现状(execute.ts 全文已读)

- zod shape(L13-24):`projectId: number|string`、`episodesId?: number`、`nodeId: string.min(1)`、`nodeType?: string`、`prompt?: string`、`branchId?: string`。**zod 已接受 prompt**(CONTEXT 所言不虚),但 handler L60 `simulateExecution(projectId, nodeId, episodesId)` **不把 prompt 传下去**——模拟器从持久化 blob 读 prompt(`_simulate.ts extractPrompt` L58-64:prompt/text/description/data.prompt 兼容四键)。
- **episodesId 省略时走 queued stub**(L39-46,IterationEngine 路径),不进 simulate;前端必须始终传 episodesId。
- 响应:`{nodeId, status:'triggered'}`;异步广播 `node:state running → success/error`。
- `validateFields`(middleware.ts L8-24):`z.object(shape).safeParse(req.body)` 后**不回写 req.body**——extra key(params 对象等)原样穿透,不会被剥。但契约诚实仍应把 `params: z.record(z.string(), z.unknown()).optional()` 补进 shape(文档化 + 防未来有人给 middleware 加 strip 回写时踩雷)。

### canvasApi.executeNode(canvasApi.ts L370-378)

现签名 `(projectId, episodesId, nodeId, nodeType, cancelToken?)`,body 只发四字段。唯一其他调用方是 CanvasContextMenu `handleExecute`(L162)→ 扩签名须向后兼容:建议第 5 参数前插 `extra?: { prompt?: string; seed?: number; params?: GenerationParams }`(或 options 对象),body 展开 `{projectId, episodesId, nodeId, nodeType, ...extra}`。

### "任务参数含新 prompt"的自动化断言(三层)

1. **e2e(主断言)**:mock backend `logCall` 对 execute **目前只记 `{projectId, episodesId, nodeId, nodeType}`**(server.mjs L349)——必须改为记录完整 `req.body`(或至少透传 prompt/params/seed),然后 `GET /__mock/calls` 断言 execute 调用 body 含新 prompt/新 seed。这是与 36/37 既有 e2e 同构的断言通道(`getCalls` helper 已存在)。
2. **verify-phase-52 source-shape**:execute.ts zod 含 `prompt` 且含 `params`;canvasApi executeNode body 展开 extra;序列化器含事件配方反向覆盖(grep 特征行)。
3. **vitest(前端)**:PromptSection 保存→重生成链路可测 store action(mock canvasApi 模块,断言调用参数)。组件级建议轻测或不测,主断言放 e2e。

**注意**:真实引擎语义不变(本期不接 GPU)——`prompt`/`params` 在服务端的归宿是"接受并忽略(模拟器照旧读 blob)",断言只锁"参数到达服务端契约层"。这与 CONTEXT「自动化断言=任务参数含新 prompt;真实引擎派发维持现状」完全一致。

---

## Task 4 — REGEN-02 wiring

### eventChipBus 现状(eventChipBus.ts 全文 27 行)

`EventChipClickInfo = { eventId, op, clientX, clientY }`,Context 默认 noop。EventChipNode.handleClick(L77-89)发射,FlowCanvas `handleEventChipClick`(L198)`setActiveChip(info)` 接收,`<EventParamsPopover anchor={activeChip}>`(L1005)消费。

### 最小注入(CONTEXT 锁定:经 anchor 扩展)

1. `EventChipClickInfo` 加 `projectId?: number | null; episodesId?: number | null`(可选,不破坏 EventChipNode 发射端)。
2. FlowCanvas `handleEventChipClick` 一行改:`setActiveChip({ ...info, projectId, episodesId })`——FlowCanvas L151-152 已从 store 拿到这两个值(URL 参数初始化 L96-103 → store.setProject)。
3. popover 内 `anchor.projectId/episodesId` 守卫:空(fixture 模式/无项目上下文)→ 重跑按钮 disabled 或 toast「缺少项目上下文」早退(与 store.deleteNode L742-745 范式一致)。

> 备选(更简单但不合锁定决策):popover 直接 `useCanvasStore((s) => s.projectId)`。决策已锁 anchor 注入,按锁定执行;此处仅记录备选以防 plan 评审改判。

### handleRerollSeed 接通(L49-56 接缝)

- 新 seed:现接缝已是 `Math.floor(Math.random() * 1_000_000)`——CONTEXT 允许随机 int,**保留 1e6 域**(与既有芯片 tooltip 展示的 seed 量级一致,免改 chipSummary)。
- 提交:`executeNode(pid, eid, outputAssetId, nodeTypeOfStage, { params: { ...evt.params, seed: newSeed } })`(nodeId 用资产 id,见 Task 2 裁定)。
- **配方真值回写(建议,plan 裁定)**:提交成功后 `updateEventParams(eventId, { seed: newSeed })` 落 canonical(芯片 tooltip/popover 立即显示新 seed;持久化等下一次保存)。不做则 reload 后 seed 回旧值——半个 REGEN-01 地雷,建议一并做。
- pending 态:`useState pending` → 按钮 disabled + 文案「重跑中…」→ `finally` 复位;HTTP 200 后 toast「已提交」;完成反馈由既有 `node:state` socket → `applySocketNodeState` 上屏(51-02 链)。socket 没有 per-request 关联,**不要**试图在 popover 里等 success 事件再解 pending(会泄漏)。

---

## Task 5 — REGEN-03 mechanics

### getDownstreamIds 提取(stale.ts 全文已读)

stale.ts L44-63 的 BFS 索引构建(assetConsumedByEvents / eventOutputs,排除 `role:'sequence'` 与 `isInactive:true` 边)就是要复用的资产。建议:
- stale.ts 内提取私有 `buildCausalIndex(graph)` 供 `markStaleDownstream` 与新导出 `getDownstreamIds(graph, nodeId): string[]` 共用(零逻辑复制,GUARD 传统);
- `getDownstreamIds` 语义:从 nodeId(资产或事件)沿因果边 BFS,返回**下游资产 id 集**(orchestrate nodeIds 只要资产 id);`curation:'locked'` 资产为终点(不越过——与宪法 §13 传播终止一致,locked 自身也本就不会 stale);有向环防御(BFS visited 去重,与 markStaleDownstream 同级);
- 导出自动生效(index.ts L8 `export * from './stale.js'` 已覆盖);
- 测试:flowgraph-v3/ts/tests/stale.test.ts 追加用例(sequence 排除 / inactive 排除 / locked 终止 / 环防御 / 事件起点)。

### orchestrate.ts skip 逻辑(L56)精确改法

现状:`const targets = filtered.filter((n) => n.state !== "success" && n.state !== "cached")`
改法:`success/cached` 且**无 stale 标记**才跳过:
```ts
const isStale = (n: any) => n.data != null && n.data.stale != null
const targets = filtered.filter((n) => (n.state !== "success" && n.state !== "cached") || isStale(n))
```
- **前置依赖(地雷 #2)**:服务端只读持久化 blob,stale 必须先上 wire——序列化器写 `data.stale = asset.stale`(StaleInfo 三字段),orchestrate 才看得见。**同时** mock server.mjs L260 镜像同一改动(否则 e2e 与生产语义分叉)。
- **兼容性实证**:ORCHESTRATE-04 e2e(phase36 L25-33)断言 `skipped===1`——fixture 里 success 节点(script-0)**无** `data.stale`,改动后仍被跳过,用例保持绿。无需迁移既有 e2e。
- 不加 force 参数(CONTEXT 锁定),stale 即重跑语义。

### stale 的 wire round-trip(连带修复,强烈建议同 phase 做)

- 序列化器:`asset.stale != null` → `data.stale = {since, triggerAssetId, triggerEventId}`(服务端 zod `data: z.record(z.string(), z.any())` 全放行,无 allowlist 风险;RawDataSection 会多显示一个 stale 键,可接受或加进其噪音过滤)。
- migrate.ts L552 `stale: null` → `stale: d.stale ? {since, triggerAssetId, triggerEventId} : null`(轻校验三字段存在)。
- 收益:① orchestrate 改动有了信息源;② e2e 可经 save-v2 注入 stale 图(phase40 已有同款注入范式 L54-57);③ 顺带修复"stale 角标刷新即丢"的预存缺口。不做的替代方案不存在——服务端无法凭空知道 stale。

### applySocketNodeState stale 清除(canvasStore.ts L603-635)

锁定决策:running/success 自动清 stale,与回写同路径。改法:L630-633 的 transform map 里:
```ts
n.id === nodeId
  ? { ...n, state: normalized, ...(n.kind === 'asset' && (normalized === 'running' || normalized === 'success') ? { stale: null } : {}) }
  : n
```
- **error/failed → 保留 stale**(重跑没产出新事实,脏标记不该消);CONTEXT 只授权 running/success,plan 明写此裁定。
- 事件节点无 stale 字段,`kind==='asset'` 守卫天然处理(evt_ id 的 state 回写不受影响)。
- 单测锁三条:success 清 stale / running 清 stale / failed 保留 stale(+ transform-survival 既有范式)。

### 双出口接线

**统一处理器**:新建 `src/hooks/useStaleRerun.ts`(或并入 useStale.ts)导出 `rerunStaleChain(nodeId)`:
1. `getDownstreamIds(graph, nodeId)` + 自身 → 过滤 `kind==='asset' && stale != null` → nodeIds(空则 toast「无 stale 下游」早退);
2. 保存(serializeGraphToV2,此刻 data.stale 已上 wire)→ `orchestrateCanvas(pid, eid, nodeIds)`(handleBatchExecute L118-128 同款范式,含 orchestration.status==='running' 守卫);
3. 既有 `orchestrate:*` socket 进度链(useCanvasSocket L163-171 → FlowCanvas L225-249)零改动复用;node:state → applySocketNodeState 清 stale → 角标/StaleSection 自动消失。

- **StaleSection 按钮**:NodeDetailPanel L580-593 现为纯展示,加「🔄 重跑下游」按钮调 `rerunStaleChain(node.id)`——需把 nodeId 传进 StaleSection(现 props 只有 stale+graph,加 nodeId 字段,内部组件无外部契约)。
- **stale 角标可点击**:NodeBadges(badges/NodeBadges.tsx L71-80)是 C 层经 slots 注册的组件,但**它就在包内、可直接 import hooks**(L14 已 import useStalePulse)——给 stale `<svg>` 包一层 `onClick` + `e.stopPropagation()` + `cursor:'pointer'` + title「重跑下游」,**无需改 NodeBadgesProps/slots 契约**。`stopPropagation` 必须:否则冒泡到 RF onNodeClick(在 REGEN-04 落地后会连带切换详情面板)。

---

## Task 6 — REGEN-04 interactions

### onNodeClick 改法(FlowCanvas.tsx L470-477)

现状:单击 = 选中 + `setDetailNode(null)`(面板必关)。锁定改法:**面板开着时单击另一节点 → `setDetailNode(node)` 保持打开并跟随刷新;面板关着时单击不打开**:
```ts
const detailOpen = useCanvasStore.getState().detailNode != null // 或用已订阅的 detailNode
setSelectedNode(node)
if (detailOpen) setDetailNode(node)
```
面板跟随刷新已安全(51 实证:store setGraph L430-431 detailNode 随派生重解析;同 id 切换时 NodeDetailPanel L61 `useEffect(() => setTab('detail'), [node?.id])` 重置 tab——CONTEXT 锁定维持)。

### 交互矩阵(逐个核过)

| 交互 | 风险 | 裁定 |
|---|---|---|
| **ctrl/shift/⌘ 多选点击** | RF 多选时 onNodeClick 照样发射;此时切面板会打断批量选择流 | **加修饰键守卫**:`if (e.ctrlKey \|\| e.metaKey \|\| e.shiftKey)` 只选不切面板(多选语义优先) |
| **拖拽节点** | RF 拖拽结束不触发干净 click(内部有位移抑制),理论安全 | 不加防护;若实测误触,plan 留 `onNodeDragStop` 后短暂 suppress 的逃生口 |
| **点空白 (onPaneClick L462-468)** | 关面板 + 关 chip popover | **维持现状**(CONTEXT 锁定关闭路径不变) |
| **Esc(L729-735)** | detailNode 优先关闭,再轮到其他 | 维持现状 |
| **双击(L482-487)** | 开面板;RF 对同节点双击会先发两次 click——面板开着时单击同节点 `setDetailNode(同 node)` 无害 | 无需改动;`zoomOnDoubleClick={false}` 已设 |
| **eventChip 节点** | L472 已 early-return | 保持 |
| **e2e 回归** | phase35 全用 dblclick 开 + ✕ 关(L60-105);phase40 NORMALIZE-01 用 dblclick(L69);**无**用例断言"单击关面板" | 零迁移;新增 phase52 e2e 锁新行为 |
| **handleLocateNode(L497-504)/管线定位** | 显式 setDetailNode(target) | 不受影响 |

### 默认宽度

NodeDetailPanel L35-38:`window.innerWidth * 0.75` → `480`(`Math.max(400, 480)` = 480;拖拽调宽与 min 400 逻辑 L68 不动)。一行改。

---

## Task 7 — Validation Architecture

见文末统一映射表。核心思路:**单测(vitest 双包)锁纯逻辑,e2e(mock backend + logCall)锁"任务参数"断言,verify-phase-52 聚合 grep/source-shape 门**,完全沿袭 verify-phase-51 范式(含头注释 e2e 前置 `npm run build`、forced-failure 自检、npm script 注册)。

## Task 8 — 建议 Plan 分解

| Plan | 范围 | 需求 | Wave | files_modified 边界 |
|---|---|---|---|---|
| **52-01 事件配方与 stale 的 store 地基** | canvasStore:`updateEventParams` 新 action(含持久化+回滚,deleteNode 范式)+ `applySocketNodeState` stale 清除;flowgraph-v3:`buildCausalIndex` 提取 + `getDownstreamIds` 导出;vitest:store(eventParams + stale-clear)+ stale.test.ts(downstream 用例) | REGEN-01/03 地基 | **W1** | 独占 canvasStore.ts、flowgraph-v3/ts/src/stale.ts、两包 tests |
| **52-02 wire round-trip + 服务端 stale 语义** | serialize.ts:事件配方反向覆盖(prompt/seed/engine,script 例外)+ `data.stale` 落 wire;migrate.ts:`d.stale` 还原;orchestrate.ts L56 stale-success 不跳过;mock server.mjs:orchestrate skip 镜像 + execute/orchestrate logCall 记完整 body;vitest:serialize round-trip(配方 + stale) | REGEN-01/03 通道 | **W1**(与 01 并行:文件零交集) | 独占 serialize.ts、migrate.ts、orchestrate.ts、mock server.mjs |
| **52-03 PromptSection + 重生成(REGEN-01)** | NodeDetailPanel:PromptSection 组件(反查产生事件、边缘 case 只读态、textarea+保存/重生成);canvasApi.executeNode extra 参数;execute.ts zod 补 params;e2e phase52-regen.mjs:编辑→保存→重生成→断言 mock execute body 含新 prompt + reload 往返保真 | REGEN-01 | **W2**(依赖 01 action + 02 round-trip) | 独占 NodeDetailPanel.tsx、canvasApi.ts、execute.ts、新 e2e 文件 |
| **52-04 换 seed 重跑(REGEN-02)** | eventChipBus anchor 扩展;FlowCanvas handleEventChipClick 注入 projectId/episodesId;EventParamsPopover handleRerollSeed 接通 + pending 态 + 成功后 updateEventParams(seed);e2e:芯片→popover→🎲→断言 mock execute 同配方+新 seed+toast | REGEN-02 | **W2**(与 03 并行:canvasApi 是交集——约定 03 改 executeNode 签名、04 只消费;若评估冲突则 04 排 W2 后半) | EventParamsPopover、eventChipBus、FlowCanvas(L197-198 区) |
| **52-05 stale 重跑链 + 面板交互(REGEN-03/04)** | useStaleRerun.ts(rerunStaleChain);StaleSection 按钮(+nodeId prop);NodeBadges stale 角标可点击(stopPropagation);NodeDetailPanel L36 默认宽 480;FlowCanvas onNodeClick 保持打开 + 修饰键守卫;e2e:stale 注入→角标/按钮→orchestrate nodeIds→stale 消除 + 面板跟随/宽度断言 | REGEN-03/04 | **W3**(依赖 01/02;与 03 在 NodeDetailPanel 有交集故串行;FlowCanvas onNodeClick 区与 04 的 chip 区不冲突,但同文件建议顺序提交) | useStaleRerun、NodeDetailPanel(StaleSection+L36 区)、NodeBadges、FlowCanvas(L470-477 区)、新 e2e |
| **52-06 聚合门** | scripts/verify-phase-52.ts(S1-S5 + forced-failure 自检)+ npm script 注册 + VERIFICATION;确认全套 vitest/tsc/e2e 绿 | 全部 | **W4** | scripts/verify-phase-52.ts、package.json |

时序理由:01/02 是纯逻辑+通道,无 UI 依赖可并行;03/04 是两条独立用户路径可并行(canvasApi 交集按约定划界);05 与 03 共享 NodeDetailPanel 必须串行;06 收尾聚合。

---

## Risks / Landmines

1. **【成败手】事件配方不落盘**:序列化器丢 event 节点,migrate 只从资产 flat `data.prompt/seed/engine` 重建 params——不加反向覆盖,updateEventParams 的编辑**保存+刷新后无声丢失**。script stage 例外(prompt→content,不覆盖)。
2. **【成败手】stale 不上 wire 则服务端改动无源**:orchestrate 只读持久化 blob;必须 `data.stale` 序列化 + migrate 还原(连带修复 stale 刷新即丢),mock 同步镜像。否则 REGEN-03 服务端锁定决策无法落地。
3. **§14 采集窄通道**:steps/cfg/lora/quant 等配方字段保存+刷新后**本来就丢**(预存损耗)。本期只编 prompt/seed 安全;PLAN 应注明"全配方持久化"出范围,防执行期 scope creep。
4. **变体落选候选无产生事件**(事件被并入 winner 的 variantRecipes):PromptSection 反查必须处理缺失(只读态),否则候选资产面板报错或写无处写。
5. **重生成 nodeId 用资产 id 不用 evt_ id**:evt_* 不在持久化 blob(simulate readNode null,能跑但无画布反馈、不过 applySocketNodeState 的资产 stale 清除)。与 CONTEXT 字面(eventId)有出入,plan 须明写裁定(见 Task 2)。
6. **mock logCall 挑字段**:execute/orchestrate 现只记选定字段——不改为记完整 body,"任务参数含新 prompt/seed"的 e2e 断言无观测点。
7. **ORCHESTRATE-04 兼容**:服务端/mock skip 改动只对"success **且** 有 stale 标记"放行;fixture success 节点无 stale,`skipped===1` 断言保持绿。改动时勿顺手重构 filter 语义。
8. **NodeBadges 角标点击必须 stopPropagation**:否则冒泡触发 RF onNodeClick,REGEN-04 落地后会连带切详情面板;slots/NodeBadgesProps 契约无需改(C 层组件包内直接 import handler)。
9. **多选修饰键守卫**:ctrl/shift/⌘ 点击也发 onNodeClick——不加守卫,批量选择会意外切面板。phase37 多选 e2e 经 testMode hook 驱动(setSelectedNodeIds),不点节点,不受守卫影响。
10. **e2e 跑 dist**:任何 e2e 复跑前 `npm run build`(51-02 记录在案的教训);verify-phase-52 头注释须沿袭此前置说明。
11. **重生成后下游不会自动标 stale**:socket node:state success 路径无 triggerStaleCascade 接线,锁定决策也未授权。贸然在 applySocketNodeState success 里全局触发会把 Phase 37 批量执行的下游全标脏(行为越界)。**建议:本期不做,记入 VERIFICATION 遗留说明**;若 plan 评审要求,最小方案是仅在 PromptSection/reroll 发起的路径上成功后触发(需 per-request 关联,复杂度升级,不建议)。
12. **换 seed 后配方真值不回写则 reload 丢新 seed**:建议 reroll 成功后 `updateEventParams(eventId, {seed})` 落 canonical(持久化等下次保存);plan 裁定。
13. **fixture 模式无 projectId/episodesId**:popover 重跑与 StaleSection 重跑都须守卫早退(deleteNode「缺少项目上下文」范式),e2e fixture 路径(testMode)有 projectId=1 不受影响。
14. **NodeDetailPanel Props 签名不变**(phase35 契约注释):PromptSection 的保存/重生成能力全部经 store action 获取,不加 props。
15. **StaleSection 在 AssetDetail 区块序的位置**:L151-164 中 MetaRenderer 与 RawDataSection 之间还隔着 ShotIntentSection——PromptSection 插入点别错位(CONTEXT 说"MetaRenderer 与 RawDataSection 之间",实际落 ShotIntentSection 之后即可,两个表述指同一空档)。

---

## Validation Architecture

| 需求 | 自动化检查 | 类型 | 位置 |
|---|---|---|---|
| **REGEN-01** updateEventParams canonical | store vitest:写 event params + transform-survival(编辑→无关 applyGraphTransform→值仍在)+ 清空语义(''→删键)+ 守卫(graph null/非 event 节点 warn 早退) | vitest | packages/infinite-canvas store __tests__ |
| REGEN-01 配方 round-trip | serialize vitest:事件 params.prompt/seed/modelVersion 覆盖进产出资产 data.prompt/seed/engine;script stage 不覆盖 prompt;无事件/无字段不伪造;`adaptV2Graph(serialize(g))` 往返保 params.prompt | vitest | packages/infinite-canvas vitest(serialize 套件扩展) |
| REGEN-01 任务参数含新 prompt | e2e:dblclick storyboard-1→PromptSection 显示「主角进入场景」→编辑→保存→重生成→`__mock/calls` 的 execute body 含新 prompt(mock logCall 记完整 body 后);保存后 graph:saved reload 往返 panel 仍显示新 prompt(STORYBOARD-07 范式) | playwright e2e | packages/infinite-canvas test/e2e/tests/phase52-*.mjs |
| REGEN-01 契约形状 | verify-phase-52 S1:canvasStore 含 `updateEventParams(`;NodeDetailPanel 含 PromptSection;serialize 含配方反向覆盖特征;execute.ts zod 含 `prompt` 与 `params` | source-shape | verify-phase-52 S1 |
| **REGEN-02** 换 seed 提交 | e2e:点击 event 芯片→popover 可见→🎲→mock execute body 同配方(prompt 不变)+ 新 seed(≠旧 seed)+ pending 态(按钮 disabled)+ 提交 toast | playwright e2e | phase52-*.mjs |
| REGEN-02 接线形状 | verify-phase-52 S2:EventParamsPopover 无「执行后端待接入」/console.log 残桩、含 `executeNode(`;eventChipBus anchor 含 projectId/episodesId;FlowCanvas 注入行存在 | source-shape | verify-phase-52 S2 |
| **REGEN-03** getDownstreamIds | flowgraph-v3 vitest:下游 BFS 正确;sequence 边排除;isInactive 边排除;locked 终止;环防御;事件节点起点 | vitest | packages/flowgraph-v3/ts/tests/stale.test.ts |
| REGEN-03 stale 清除语义 | store vitest:applySocketNodeState success→stale 清除;running→清除;failed→**保留** stale | vitest | store __tests__ |
| REGEN-03 服务端不跳过 | ① verify-phase-52 S3 source-shape:orchestrate.ts skip 谓词含 `data.stale`/`stale` 条件;mock 镜像同构;② e2e:save-v2 注入带 `data.stale` 的 success 节点(phase40 注入范式)→点角标/StaleSection 按钮→mock orchestrate 调用 nodeIds 含该节点且 response.total 计入(未跳过)→node:state success→stale 角标消失 | source-shape + e2e | verify-phase-52 S3 + phase52-*.mjs |
| REGEN-03 stale wire | serialize vitest:stale 资产 → `data.stale` 三字段;migrate vitest:d.stale → asset.stale 还原(round-trip 保真) | vitest | 双包 tests |
| **REGEN-04** 面板宽度/跟随 | e2e:dblclick A→detail-panel 可见且宽度≈480(≤520 容差);单击 B→面板仍可见 + 标题为 B;✕→面板关闭;单击空白→关闭(回归) | playwright e2e | phase52-*.mjs |
| REGEN-04 交互形状 | verify-phase-52 S4:NodeDetailPanel 含 `480`(默认宽);FlowCanvas onNodeClick 含 detailNode 条件分支 + 修饰键守卫;phase35/phase40 e2e 全套回归绿(40+/40+) | source-shape + 回归 | verify-phase-52 S4 + npm run test:e2e |
| 全部 | 编译/测试命令门:根 `tsc --noEmit`、pkg `tsc -b`、双 vitest、`npm run build` 后 `npm run test:e2e` 全绿;verify-phase-52 含 forced-failure 自检(51 范式)+ npm script `verify:phase-52` 注册 | 命令门 + 聚合门 | phase VERIFICATION / verify-phase-52 S5 |
