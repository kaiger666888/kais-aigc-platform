# Phase 60: 保存后面板保持 (Post-Save Panel Persistence) - Context

**Gathered:** 2026-08-24
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous) — 3 areas, all accepted as recommended

<domain>
## Phase Boundary

保存动作不再打断审片流。graph:saved 触发的整图重载链保住 `detailNode`：真机后端保存 200 后详情面板保持打开，重载恢复的锚定与保存前语义等价，mock/真机行为对齐。

改动面：canvasStore reload 链（loadCanvas/loadGraphFromV2/setGraph 锚语义对齐）+ FlowCanvas onGraphSaved 自回声判定 + e2e/probe/verify 验证面。与 58/59 数据通道正交。

</domain>

<decisions>
## Implementation Decisions

### 保存事件源语义与 reload 收口
- **D-01: 自保存跳过自回声 reload。** 客户端自己发起的 save-v2 返回 200 后，服务端 graph:saved 自回声不再触发整图 reload——本地 store 已是 canonical 真相 + 200 确认。他端（pipeline/其他 tab）保存仍走 reload。
- **D-02: 他端 reload 路径按 id 重锚。** loadCanvas/loadGraphFromV2 对齐 setGraph L445 既有语义（`detailNode`/`selectedNode` 按 id 从派生模型重找）——PANEL-02「语义等价」的实现口径。
- **D-03: 锚丢失诚实收起。** 重锚找不到同 id 节点（id 漂移/节点已删）→ 收起面板 + console.warn，不做 assetKey 模糊匹配。
- **D-04: mock/真机契约对齐。** e2e mock 的 save-v2 回声路径与真机一致；自回声跳过在客户端实现（非 mock 旋钮绕开），PANEL-01 的 mock 断言即真机行为。

### 面板保持的 UX 细节
- **D-05: 自保存静默。** 自保存成功无 toast（200 即反馈）；「Pipeline 同步了新数据,正在刷新画布…」toast 仅他端保存触发。
- **D-06: 保持锚 + 数据刷新。** 面板保持锚定但内容以 reload 后真相渲染（级联 stale 等实时可见），不冻结保存前快照。
- **D-07: selected/detail 对称。** `selectedNode` 与 `detailNode` 保持语义一致处理，加对称断言。
- **D-08: SC4 竞态销案。** 自回声不 reload → 59 Known Issue #1（rerun save 自回声 reload 与 success 清 stale 的写-写竞态致角标短暂复活）根因消失；phase60 e2e 断言 rerun 后角标不再复活，Known Issue 关闭。

### 验证策略
- **D-09: 新建 `phase60-panel-persist.mjs`** — 四用例：自保存保持 / 他端 reload 重锚 / 锚丢失诚实收起 / SC4 竞态销案。
- **D-10: probe-60-real.mjs 零足迹范式** — 真机保存 200 → 面板锚保持断言（沿 probe-59-real 捕获-恢复范式）。
- **D-11: 独立 `verify:phase-60`** — 沿 verify-phase-59 骨架（静态锁 + 行为断言 + forced-failure 自检）。
- **D-12: 回归面 = phase52 三件套 + phase59 全部** — stale 面共享 reload 链，全量回归。

### Claude's Discretion
- 自回声判定的实现机制（保存请求携带 client requestId vs socket 回声时间窗比对 vs save promise 挂起期标记）
- loadCanvas 内部重构的具体形状（保持 API 不变前提下）
- e2e 断言的 DOM 选择器细节

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### reload 链现场
- `packages/infinite-canvas/src/store/canvasStore.ts` L430-460 — setGraph 重锚语义（本 phase 的对齐目标）；loadGraphFromV2/loadCanvas 为嫌疑收起点
- `packages/infinite-canvas/src/components/FlowCanvas.tsx` L266/L328-342 — onGraphSaved 回调 + health 轮询基线重置（自回声判定的接入点）
- `packages/infinite-canvas/src/hooks/useCanvasSocket.ts` L234-237 — graph:saved 订阅（payload: projectId/episodesId/timestamp）

### 契约与验证范式
- `packages/infinite-canvas/test/e2e/mock-backend/server.mjs` L135/L179 — 59-04 suppressGraphSaved 旋钮（本 phase 应随 D-04 移除对自回声的绕开）与 save-v2 广播行为
- `packages/infinite-canvas/test/e2e/probe-59-real.mjs` — 零足迹真机探针范式（D-10 模板）
- `scripts/verify-phase-59.ts` + `verify-59-dispatch.ts` — 聚合门骨架范式（D-11 模板）
- `.planning/phases/59-narrow-trigger-stale-cascade/59-VERIFICATION.md` W2 — SC4 竞态 Known Issue 记录（D-08 销案对象）

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- setGraph 的 id 重锚逻辑（L445-446）— 直接复用的锚语义
- probe-59-real 零足迹探针范式、verify-phase-59 聚合门骨架 — 验证面模板

### Established Patterns
- socket 事件 scope 守卫（projectId/episodesId 比对）— 所有 canvas 事件订阅的既有守卫
- e2e getCalls 请求体断言 + mock `/__mock/emit` 手动广播

### Integration Points
- FlowCanvas onGraphSaved → loadCanvas（自回声判定插入点）
- save-v2 调用方（画布保存按钮/pipeline 同步）— D-01 需要区分「自己发起」与「他端」

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>
