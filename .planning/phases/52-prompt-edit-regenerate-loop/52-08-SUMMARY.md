---
plan: 52-08
phase: 52-prompt-edit-regenerate-loop
status: complete
started: 2026-08-22
completed: 2026-08-22
gap_closure: true
commits:
  - "feat(52-08): 落选变体详情入口 — syntheticDetailNode + focus 未命中分支 deprecated 分流"
  - "test(52-08): phase52-regen 装置对齐真实行为 — a 去重开直连断言 / c 改侧栏落选入口"
key-files:
  modified:
    - packages/infinite-canvas/src/v3/adapter.ts
    - packages/infinite-canvas/src/components/FlowCanvas.tsx
    - packages/infinite-canvas/src/v3/__tests__/adapter.test.ts
    - packages/infinite-canvas/test/e2e/tests/phase52-regen.mjs
---

# 52-08 SUMMARY — 落选变体详情入口(gap #3)+ e2e 装置对齐(gap #7)

## gap #3:落选详情入口(focusAssetNodeId 未命中分支分流)

- **adapter `syntheticDetailNode(asset)`**:data.v3 直载 canonical 落选资产,与真实 asset RF 节点同构(stage/modality/scope/media/meta/curation/stale/variantGroupId/label/legacy 别名全镜像);type=rfTypeOfAsset(=stage);NodeDetailPanel Props={node,onClose} 零改动(地雷 #14)。
- **FlowCanvas focus effect 未命中分支**:canonical 三连查(kind==='asset' && id===focusAssetNodeId && curation==='deprecated')→ setDetailNode(syntheticDetailNode(loser)),不 setSelectedNode/不 fitView(无画布实体);**非 deprecated 未命中保持原「该资产尚未放置在画布上」toast 分支逐字不动**。
- 三条既有通路一处分流受益:侧栏 focusShot / 深链 focus(57-03)/ 资产库「📍定位」;Phase 53 变体墙域(VariantWall)零触碰。
- **合成节点自动关闭语义**(代码路径确定 + adapter 单测锁定):detailNode 在下次 setGraph 派生重解析 `rfNodes.find(id) ?? null` 时置 null → 面板自动关闭——落选只读查阅场景可接受(无编辑写面,52-03 双按钮 disabled)。已写入两处代码注释。

## gap #7:e2e 装置对齐

- **REGEN-01-a(7a)**:删除保存后的重开 dblclick(被仍开面板遮挡致 intercept——UAT 实证产品行为=保存后面板保持打开,graph:saved reload 后 PromptSection 以 canonical 重置草稿);直接 `toHaveValue(NEW_PROMPT)` → regenerate enabled → 点击 → 既有 body 断言不变。
- **REGEN-01-c(7b)**:**主路径采用**=分镜浏览侧栏卡点击——「分镜浏览」按钮切 scene_shots → 点击落选卡 → focusShot(focusAssetNodeId + setViewMode('canvas'))→ 52-08 分流开只读面板 → 断言组(readonly-hint 含「落选变体」+ textarea/save/regenerate disabled)全保留;winner sb-cand-a 对照(画布有实体,dblclick 正常路径)。备路径(深链 focus 参数)未启用。
- **shot-card testid 实证**:`shot-card-分镜候选 B`——displayShotId = raw.label 优先(StoryboardTimeline extractShots 实证),e2e 用 `[data-testid^="shot-card-"] filter hasText` 定位,不依赖精确拼接。

## 实证

- adapter.test +3 用例(v3 引用直载/label 兜底 phaseName??id/deprecated 同构 + rfTypeOfAsset 映射),adapter 34/34;vitest 全套 **404/404**。
- phase52-regen **3/3**(首次运行即绿);全套 e2e **62 passed 零回归**(phase35/36/37/40/41/55/57 + 52 三件套;含 phase57-deeplink 真实后端用例——顺带覆盖了已部署的 52-07 前端)。
- helpers.mjs 零 diff;phase52-regen.mjs 已入 git(52-03 轮已 commit,本轮修正再 commit)。

## 52-06 衔接确认(下游执行器照做)

- S5 命令集补一行 `npm run verify:save-v2-legacy`(52-07 产出)。
- S1 追加 grep 锚:`src/lib/canvasAssetSchema.ts` 含 `nullish`、`packages/infinite-canvas/src/components/FlowCanvas.tsx` 含 `syntheticDetailNode`。

## Deviations

- 无实质偏离。REGEN-01-c 主路径一次推导即通,备路径未启用(plan 允许二选一)。

## Self-Check: PASSED

- tsc -b exit 0;grep 门:adapter/FlowCanvas/test 各含 syntheticDetailNode(3/2/5);原 toast 文案保留(2 处命中:分流未改原分支);FlowCanvas diff 限 focus effect 未命中分支 + import 区。
