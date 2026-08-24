# Phase 61: 审计清债 TD-3/4/5 (Audit Debt Clearance) - Context

**Gathered:** 2026-08-24
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous) — 1 area, accepted as recommended

<domain>
## Phase Boundary

清偿审计登记的四笔低优先债，每项带回归/守护，清完即销账：
1. **DEBT-01** `placeNewAsset(anchor='source')` 获得活调用方（资产中心/画布入口放置新资产）+ e2e 有界落点断言
2. **DEBT-02** reviewBridge 列表 URL 尾斜杠修正，307 中间跳消除，回归锁死
3. **DEBT-03** buildMeta 读回 5 个持久化字段（emotion/promptMeta/murchGrade/archetype/viewAngle）save→reload 往返保真（51-REVIEW I1）
4. **DEBT-04** `node:created` 写 canonical 或显式文档化 ephemeral + 守护注释（51-REVIEW I5），裁定成文可查

四项相互独立，parallel-safe；排在末位避免与 58-60 在途改动冲突。

</domain>

<decisions>
## Implementation Decisions

### 执行口径
- **D-01: 资产中心拖入为 anchor='source' 唯一活调用方。** 源锚定 + 8px 网格有界落位（55-04 NAV-04 既有 placeNewAsset 语义），e2e 断言落点有界；不做全路径统一（改动面控制）。
- **D-02: DEBT-04 证据驱动裁定。** 沿 60-01 Branch A/B 范式：planner 先查 node:created 当前写路径——已走 canonical（addNodeFromSocket/WRITE-03）则断言+文档化收口；绕过 canonical 则接线。裁定结果写入 phase 目录成文文档。
- **D-03: 4 个独立 mini-plan 并行单 wave。** ROADMAP 明示 parallel-safe、零文件交集；每项自带回归/守护与独立 verify。
- **D-04: 每笔债销账动作。** 修完即在 REQUIREMENTS.md 勾选 + 51-REVIEW 对应 finding 标注已清偿（若该文件存在追踪节）。

### Claude's Discretion
- e2e 断言组织（复用 phase55-nav 的放置断言面 vs 新文件）
- DEBT-02 回归锁形态（verify 聚合门静态锁 vs e2e 请求断言）
- DEBT-03 往返测试挂点（vitest 纯函数往返 vs dispatch 集成）

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### 四笔债现场
- `packages/infinite-canvas/src/store/canvasStore.ts` — placeNewAsset（anchor 参数与 8px 网格语义，55-04 NAV-04）
- reviewBridge 列表请求侧（尾斜杠 URL 现场在资产中心/审核页桥接代码，51-REVIEW 记录）
- `packages/infinite-canvas/src/v3/adapter.ts` buildMeta — 5 字段持久化读回缺口（51-REVIEW I1）
- `packages/infinite-canvas/src/hooks/useCanvasSocket.ts` node:created 订阅与 `canvasStore.addNodeFromSocket`（WRITE-03 canonical 写路径，55-04）
- `.planning/phases/51-*/51-REVIEW.md`（若在）— I1/I5 finding 原文

### 验证范式
- `scripts/verify-phase-{58,59,60}.ts` — 聚合门范式
- `packages/infinite-canvas/test/e2e/tests/phase55-nav.mjs` — new-asset-placement e2e 断言面（落点 ≤64px 有界既有先例）

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- placeNewAsset 既有 bounded placement 语义（NAV-04）
- addNodeFromSocket canonical 写路径（WRITE-03）
- verify 聚合门三连范式（58/59/60）

### Established Patterns
- e2e 落点有界断言（phase55-nav new-asset-placement）
- 静态锁 + forced-failure 自检

### Integration Points
- 资产中心拖入 → placeNewAsset(anchor='source')
- reviewBridge 列表 URL 常量/调用点
- buildMeta ← serialize/flattenMeta 往返链

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>
