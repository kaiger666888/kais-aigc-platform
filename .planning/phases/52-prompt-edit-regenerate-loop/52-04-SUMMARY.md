---
plan: 52-04
phase: 52-prompt-edit-regenerate-loop
status: complete
started: 2026-08-22
completed: 2026-08-22
commits:
  - 81b61000 feat(52-04): eventChipBus anchor 注入 projectId/episodesId(REGEN-02 通道)
  - bc7a0dce feat(52-04): handleRerollSeed 接通 execute 通道 + pending 态 + seed 回写 canonical
  - ee1e62a7 test(52-04): phase52-reroll e2e — REGEN-02 同配方+新 seed 提交断言
key-files:
  created:
    - packages/infinite-canvas/test/e2e/tests/phase52-reroll.mjs
  modified:
    - packages/infinite-canvas/src/components/canvas/eventChipBus.ts
    - packages/infinite-canvas/src/components/FlowCanvas.tsx
    - packages/infinite-canvas/src/components/eventParams/EventParamsPopover.tsx
    - packages/infinite-canvas/src/components/edges/EdgeOpChip.tsx
---

# 52-04 SUMMARY — EventParamsPopover「同配方换 seed 重跑」接通(REGEN-02)

## What Was Built

UAT Test 7 的 TODO/console.log 残桩清零,REGEN-02 闭环落地:

- **anchor 扩展**:EventChipClickInfo 加可选 `projectId/episodesId`;FlowCanvas handleEventChipClick 注入(EventChipNode/EdgeOpChip 发射端零改动)。
- **handleRerollSeed 接通**:守卫(pid/eid 缺失 → toast「缺少项目上下文」早退;pending 中抑制连点)→ 新 seed → graph 反查产出资产 → `executeNode(pid, eid, outputAsset.id, outputAsset.stage, { params: {...params, seed} })`。
- **pending 态**:提交期按钮 disabled +「重跑中…」,finally 复位;不等 socket success(无 per-request 关联,防 pending 泄漏)。
- **seed 回写 canonical**:提交成功后 `updateEventParams(eventId, { seed })`(地雷 #12 裁定:防 reload 回旧值;持久化等下一次 save)。

## 1e6 seed 域保留理由

`Math.floor(Math.random() * 1_000_000)` 与芯片 tooltip/chipSummary 既有 seed 量级一致,免改 chipSummary;e2e 断言 `0 ≤ seed < 1_000_000`。

## 产出资产反查失败早退路径

`graph.links.filter(role:'output' && source===eventId)` 无命中 → toast「未找到该事件的产出资产,无法重跑」+ return(不提交)。fixture 正常图不触发;防御落选变体共享主事件等异常拓扑。

## e2e 实证

- phase52-reroll.mjs **2 passed**:同配方(params.prompt=「主角进入场景」不变)+ 新 seed(域内+≠旧)+ nodeId=storyboard-1 非 evt_*(地雷 #4)+ pending 观测(route 挂起 execute,disabled+「重跑中…」,finally 复位)+ 回写上屏(data-seed)+ toast。
- 回归:vitest 401/401;全套 e2e 56 passed,仅剩 REGEN-01-a/c 两败(**52-08 路由的装置错位**,非本 plan 范围)。

## Deviations

- **文件清单偏差(+1)**:EdgeOpChip.tsx 外层 DOM 补 `data-event-id` 属性——现行架构事件折叠为**边中点 op 芯片**(adapter L775 event 不渲染为节点),两条边折叠同一事件时 `data-op` 不足以唯一定位,e2e 需要确定性 locator。零行为变更(纯 data 属性),与 plan 在 popover 侧补 data-testid 的授权同构。
- plan 文中「EventChipClickInfo … FlowCanvas handleEventChipClick(L197-198)」行号已漂移(实际 L250-251),语义位置一致。

## Self-Check: PASSED

- tsc -b exit 0;grep 门:eventChipBus 含 projectId/episodesId、FlowCanvas `{ ...info` 注入、popover 含 executeNode/updateEventParams、「执行后端待接入」0 命中、pending 文案命中。
- FlowCanvas diff 限于 handleEventChipClick(+deps,共 +4 行)。
