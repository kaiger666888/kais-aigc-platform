# Phase 52: 生成-迭代闭环 (Prompt Edit → Regenerate Loop) - Context

**Gathered:** 2026-08-21
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous) — 4 灰区 × 16 决策全部按推荐接受

<domain>
## Phase Boundary

kmc 最高频创作循环"改 prompt → 重抽"在画布内闭环——详情面板可编辑 prompt 并一键重生成、同配方换 seed 重跑接通既有接缝、stale 下游一键重跑、审片场景面板不再反复开合。

Requirements: REGEN-01, REGEN-02, REGEN-03, REGEN-04

</domain>

<decisions>
## Implementation Decisions

### Prompt 编辑与重生成写回 (REGEN-01)
- prompt 真值位置:产生事件 `EventNodeV3.params.prompt`(P4「配方唯一合法存放处」);新增 store canonical action `updateEventParams`,落 canonical graph + save-v2 持久化——与 Phase 51 地基同构;不写 asset.meta
- 编辑 UI:AssetDetail 新增 PromptSection(MetaRenderer 与 RawDataSection 之间),经 graph.links(event→asset role:'output')反查产生事件;可编辑 textarea + 保存/重生成按钮
- 重生成通道:复用 `/canvas/execute`(zod 已接受 prompt 参数,execute.ts L21-23);自动化断言=任务参数含新 prompt;真实引擎派发维持现状(execute/orchestrate 模拟器语义不变,本期不接 GPU)
- 保存时机:显式「保存」按钮落 canonical,保存后「重生成」可用(防半编辑状态误触发)

### 换 Seed 重跑 (REGEN-02)
- 提交实现:接通 `EventParamsPopover.handleRerollSeed`(L49-56 接缝)——`executeNode(projectId, episodesId, eventId, {params: {...recipe, seed: newSeed}})`
- 新 seed:随机 int(crypto.getRandomValues 或 Math.random×2^32),与既有事件 seed 域一致
- 反馈:popover 内 pending 态 + 既有 `node:state` socket 完成反馈(51-02 已落 canonical)+ toast 提交提示
- projectId/episodesId:FlowCanvas 经 eventChipBus anchor 扩展注入(popover 当前缺这两个值,FlowCanvas 持有)

### Stale 下游重跑链 (REGEN-03)
- 下游计算:flowgraph-v3 `stale.ts` 提取导出 `getDownstreamIds(nodeId)`(复用既有 BFS 索引;sequence/inactive 边排除、locked 终止语义一致)
- success 跳过:服务端 orchestrate 对带 stale 标记的 success 节点不再跳过(stale 即"需重跑"语义);不加 force 参数
- stale 清除:`applySocketNodeState` 收到 running/success 时自动清除该节点 stale(与回写同路径,无需新 action)
- 出口:StaleSection「重跑下游」按钮 + stale 角标可点击(双出口);点击=收集自身+下游 stale 链 → `orchestrateCanvas` nodeIds 子集 → 既有 `orchestrate:*` socket 进度反馈

### 面板交互优化 (REGEN-04)
- 默认宽度:~480px(NodeDetailPanel L36 一行改;拖拽调宽保留,min 400 不变)
- 单击行为:面板已打开时单击另一节点 → `setDetailNode(node)` 保持打开并跟随刷新;面板关闭时单击维持现状(不打开)
- 关闭路径:维持现状(点空白/Esc/关闭按钮)
- tab 行为:维持现状(切节点重置回 detail tab,既有 useEffect)

### Claude's Discretion
- PromptSection 的具体样式/组件结构(textarea 行数、按钮排布)
- updateEventParams 的参数签名细节
- popover pending 态的具体呈现(spinner vs disabled 按钮文案)
- stale 角标点击的 hover/光标提示细节

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets (Phase 51 地基 + 既有接缝)
- store canonical actions: `updateAssetMeta` / `applySocketNodeState` / `applySocketNodePreview` (canvasStore.ts, 51-02 建) — updateEventParams 同构新增
- `serializeGraphToV2` + save-v2 通道 (51-01 建) — updateEventParams 持久化复用
- `handleRerollSeed` 接缝: EventParamsPopover.tsx L49-56 (当前 console.log + toast「执行后端待接入」)
- `/canvas/execute` zod 已接受 `prompt?: string` + `branchId?: string` (execute.ts L21-23)
- orchestrate nodeIds 子集 = mode:'batch' (orchestrate.ts L31, L51-53);`orchestrate:*` socket 进度链已接 (useCanvasSocket L163-171 → FlowCanvas L225-249)
- stale 基建: `markStaleDownstream` (flowgraph-v3 stale.ts) + NodeBadges stale 角标 (L71-80) + StaleSection (NodeDetailPanel L580-593) + useStale triggerStaleCascade
- `focusAssetNodeId` 机制 (canvasStore L958-959) — 面板定位既有先例
- detailNode 随 transform 重解析 (canvasStore L430-431) — 面板跟随刷新已安全

### Established Patterns
- 配方真值: EventNodeV3.params (P4「配方唯一合法存放处」, GenerationParams types.ts L181-192 开放 catchall)
- 事件→资产反查: graph.links role:'output'
- execute 后端当前为 simulateExecution 模拟器 (_simulate.ts);episodesId 省略时 queued stub「engine dispatch will be wired in a follow-up」(execute.ts L39-46)
- orchestrate 服务端跳过 state==='success'|'cached' (orchestrate.ts L56)

### Integration Points
- NodeDetailPanel: 默认宽 L36 (`window.innerWidth * 0.75`);AssetDetail 区块序 L147-165
- FlowCanvas: onNodeClick L470-477 (当前 setDetailNode(null) 关面板);onNodeDoubleClick L482-487;activeChip L197/L1005
- META_PATCHABLE_KEYS allowlist 不含 prompt — updateEventParams 须走事件节点,不经 updateAssetMeta
- 测试: e2e phase35 (detail-panel 契约不可回归)、phase36/phase37 (orchestrate/batch 契约);vitest store/__tests__ 与 flowgraph-v3/ts/tests/stale.test.ts

### 已知缺口 (本 phase 补)
- 无 `getDownstreamIds` 独立导出 (stale.ts BFS 索引可提取)
- 无 stale 清除路径 (applySocketNodeState 当前只设 state)
- orchestrate 跳过 success 与 stale 重跑语义冲突
- EventParamsPopover 缺 projectId/episodesId

</code_context>

<specifics>
## Specific Ideas

- 真实引擎派发不在本期 — execute/orchestrate 模拟器语义不变;自动化断言锁"任务参数含新 prompt/新 seed"
- e2e 跑 dist 非源码 — 任何 e2e 复跑前须 `npm run build` (51-02 已记录在 verify-phase-51 头注释)
- phase35 e2e 契约 (data-testid="detail-panel"、3 tabs、镜头意图 4 selects) 不可回归

</specifics>

<deferred>
## Deferred Ideas

None — 讨论未超出 phase 范围。(真实 GPU/引擎派发属平台既有待办,见 execute.ts L39-46 注释,不记入本期。)

</deferred>
