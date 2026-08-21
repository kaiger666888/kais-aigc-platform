# Phase 51: 写路径地基统一 (Canonical Write Path + Coordination Guard) - Context

**Gathered:** 2026-08-21
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous) — 4 灰区 × 16 决策全部按推荐接受

<domain>
## Phase Boundary

画布所有写操作(保存/右键审核删除/MetadataEditor 编辑/socket node:preview/node:state 更新)统一走 V3 canonical graph 持久化,legacy v1 mapper 绕行与派生缓存直改彻底废弃;约 2500-3200 行死代码清除;khs2 v2.4 并行开发的冲突管理规则(COORD-01)成文落地。

Requirements: WRITE-01, WRITE-02, WRITE-03, WRITE-04, COORD-01

</domain>

<decisions>
## Implementation Decisions

### 写路径切换策略
- save-v2 序列化器:新写 canonical graph → FlowGraphV2 正向序列化器(v3 adapter 的逆变换),作为 `canvasToFlowGraph` 的替代;替换 FlowCanvas.handleSave/handleOrchestrate 与 CanvasContextMenu.handleBatchExecute 共 3 处调用点
- 切换方式:一次性切换——`saveCanvasGraph` 改指 `/canvas/v2/save-v2`(既有端点,带 zod 校验 + graph:saved 广播),删除 v1 `/canvas/save` 路由,不留双写
- 保存失败反馈:复用既有 `showToast(..., 'error')` store 通知(handleSave 当前仅 console.error),不新建通知组件
- flowDataMapper 整个文件删除(含死导出 flowDataToCanvas/flowGraphToCanvas),而非部分保留

### 审核/删除回写语义
- 右键 approve/reject:直接改调既有 `store.approveNode/rejectNode`(已实现 canonical optimistic + 回滚),右键菜单是当前唯一绕行点
- handleDelete 持久化:删除落 canonical graph 后走 save-v2 统一保存通道,不新增专用 delete 端点
- 删除确认 UI:复用画布现有轻量确认模式(与画布风格一致),不用浏览器原生 confirm()
- "删除后不复活"验证:verify-phase-51 集成断言(删除 → save-v2 → load-v2 → 断言节点不存在),遵循 verify-phase-50 范式(真实模块、:memory: sqlite、无逻辑重实现)

### 派生缓存直改修复 (MetadataEditor & socket)
- MetadataEditor 回写:新增 store canonical 编辑 action——写 `asset.meta` canonical graph + 派生缓存同步刷新,治本
- phase35 e2e 契约:迁移 e2e 断言到新 canonical 回写路径(旧 flat data[field] overlay 契约是历史绕行产物)
- socket node:preview/node:state:经 store action 回写 canonical graph(state/progress/thumbnailUrl 落 node.state/asset.meta),不再只写派生 RF 缓存
- applyGraphTransform 覆盖防护:canonical-first 合并——transform 以 canonical graph 为真值源重建派生缓存,派生缓存永不反向覆盖,机制层面消灭该类 bug

### 死代码清理与 COORD-01
- 删除范围:全量 ~3,200 行——需求列出的 ~2,637 行(ScriptNode/VideoNode/AudioNode/StoryboardNode/VariantGroupDetail/BranchPanel/StructuredFieldPanel/ScoreBadge/VariantBadge/FeedbackBadge) + AssetNode(同样无引用) + flowDataMapper 死导出
- legacy 类型(ScriptNodeData/StoryboardNodeData/VideoNodeData/AudioNodeData):随调用点清理一并删除(CanvasContextMenu add-node 处理器、flowDataMapper 清理后无消费者)
- `@kais/flowgraph-v3`:声明进 packages/infinite-canvas package.json dependencies,与仓库现有本地包声明方式保持一致,消除幽灵依赖
- COORD-01:文档 + plan 模板 checklist 双落地——约束成文,plan 开工 checklist 含"kais-hermes-skills 工作树干净"检查项

### Claude's Discretion
- 正向序列化器的具体函数命名/放置位置(建议 canvasStore 或独立 serializer 模块)
- store 新增 action 的具体命名(canonicalEditNodeMeta / applySocketNodeUpdate 等)
- 删除确认的具体 UI 实现细节

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/routes/canvas/v2/save-v2.ts` — canonical 保存端点已存在(zod 校验 + structured-params 强制 + graph:saved 广播),前端未接
- `canvasStore.approveNode` (L453) / `rejectNode` (L489) — canonical-graph optimistic + 回滚模式已实现,仅 ReviewActionButtons 消费
- `showToast` store 通知基建已存在
- `packages/flowgraph-v3` (@kais/flowgraph-v3 v3.1.0) — canonical graph 类型与 adapter

### Established Patterns
- 写/读不对称现状:saveCanvasGraph → POST /canvas/save (v1);loadCanvasGraph → POST /canvas/v2/load-v2
- MetaRenderer (MetadataEditor) 当前 flat data[field] overlay 直改派生缓存 (MetaRenderer.tsx L138-175)
- socket 处理器在 FlowCanvas.tsx L208-225,仅写派生 RF 缓存
- verify-phase-*.ts 范式:真实模块、:memory: sqlite、section 化契约组、npm script 注册 verify:phase-NN

### Integration Points
- `canvasToFlowGraph` 活引用仅 2 文件:FlowCanvas.tsx (handleSave L520, handleOrchestrate L557)、CanvasContextMenu.tsx (handleBatchExecute L136)
- nodeTypes 注册 (FlowCanvas L71-91) 已全部路由到 AssetCardNode — 4 个旧节点渲染器安全可删
- vite.config.ts/tsconfig paths alias 当前承担 flowgraph-v3 解析,声明依赖后保留 alias 或清理均可
- tsc 双根:root tsconfig (excludes packages) + packages/infinite-canvas/tsconfig (noEmit)

### 死代码清单(已核实无引用)
| 文件 | 行数 |
|---|---|
| nodes/ScriptNode.tsx | 258 |
| nodes/VideoNode.tsx | 294 |
| nodes/AudioNode.tsx | 239 |
| nodes/StoryboardNode.tsx | 218 |
| nodes/AssetNode.tsx | 270 |
| VariantGroupDetail.tsx | 722 |
| BranchPanel.tsx | 235 |
| StructuredFieldPanel.tsx | 329 |
| ScoreBadge.tsx | 74 |
| VariantBadge.tsx | 117 |
| FeedbackBadge.tsx | 151 |
| utils/flowDataMapper.ts | 410 |
(注意:badges/NodeBadges.tsx + badges/ScoreMiniBar.tsx 是活的 C 层组件,不可删)

</code_context>

<specifics>
## Specific Ideas

- 保留 NodeBadges/ScoreMiniBar(C 层,经 variants/registerCInteractions 注册,被 AssetCardNode 消费)
- MetaRenderer 旧行为是 phase35 e2e fixture 契约(packages/infinite-canvas/test/e2e/),迁移而非保留
- packages/flowgraph-v3 内层 ts/package.json 名为 "flowgraph-v3"(与外层 @kais/flowgraph-v3 不一致),声明依赖时注意
- src/routes/canvas/static/assets/*.js.map 中 7 处 canvasToFlowGraph 是构建产物,重build 即消失,不算引用

</specifics>

<deferred>
## Deferred Ideas

None — 讨论未超出 phase 范围。

</deferred>
