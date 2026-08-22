---
plan: 52-05
phase: 52-prompt-edit-regenerate-loop
status: complete
started: 2026-08-22
completed: 2026-08-22
commits:
  - feat(52-05) useStaleRerun hook — see git log 3 commits (hook / 双出口 / onNodeClick)
key-files:
  created:
    - packages/infinite-canvas/src/hooks/useStaleRerun.ts
    - packages/infinite-canvas/test/e2e/tests/phase52-stale-panel.mjs
  modified:
    - packages/infinite-canvas/src/components/panel/NodeDetailPanel.tsx
    - packages/infinite-canvas/src/components/badges/NodeBadges.tsx
    - packages/infinite-canvas/src/components/FlowCanvas.tsx
---

# 52-05 SUMMARY — REGEN-03 出口 + REGEN-04 面板交互

## What Was Built

- **useStaleRerun.rerunStaleChain(nodeId)**:守卫(graph 空 / pid·eid 缺失 / orchestration running → toast 早退)→ getDownstreamIds+自身过滤 `asset && stale!=null`(空 → toast「无 stale 下游可重跑」)→ saveCanvasGraph(serializeGraphToV2,data.stale 已上 wire)→ orchestrateCanvas(pid, eid, nodeIds 子集)。进度复用 orchestrate:* socket 链;stale 清除交给 node:state→applySocketNodeState(52-01)。
- **双出口**:StaleSection「🔄 重跑下游」按钮(data-testid=stale-rerun-btn,props 加 nodeId)+ NodeBadges stale 三角可点击(stopPropagation 地雷 #8 + cursor pointer + svg `<title>` 重跑下游;aria-label=stale 保持 56-03 测试契约)。
- **REGEN-04**:面板默认宽 `Math.max(400, 480)`(拖拽/min400 不动);onNodeClick 重写——修饰键(ctrl/⌘/shift)只选不切面板(地雷 #9,不 push 导航历史);面板开着 → setDetailNode(node) 跟随切换;关着 → 不打开。点空白/Esc/双击/eventChip early-return 全维持现状。

## NodeBadges nodeId 来源实证

NodeBadgesProps 已含 `nodeId`(L18 既有,useStalePulse 选择子已用)——直接取用,slots/registerCInteractions 零 diff。useStaleRerun 订阅置于 lod===0 早返 **前**(Rules of Hooks,首版放函数中部被 tsc/测试链纠正)。

## 空链早退 UX 文案

toast「无 stale 下游可重跑」(info 级)——点击角标但链上无可重跑项时的唯一反馈,不弹错误。

## onNodeClick 逃生口注释位置

FlowCanvas onNodeClick 函数体尾注释:拖拽误触理论安全(RF 内部位移抑制),若实测误触 → onNodeDragStop suppress 逃生口。

## e2e 实证(phase52-stale-panel.mjs 4 passed)

- REGEN-03-a 全链:注入→角标→点击→orchestrate body nodeIds 含节点 + total=1 + **skipped=0**(52-02 mock 镜像:stale success 不跳过)→ node:state success 广播后角标 count=0(52-01 清除链上屏)。
- REGEN-03-b:stale 图 reload 后角标仍在(地雷 #2 防线,补 UAT Test5 的 e2e 层)。
- REGEN-04-a:面板宽 400..520。
- REGEN-04-b:跟随切换(textarea 主角进入场景→特写镜头)+ 点空白关 + 关后单击不开。
- 全套 e2e 60 passed:REGEN-01-a **因面板 480 化转绿**(旧败因=75% 宽面板遮挡节点挡 dblclick;52-08 gap#7-a 就此消解);phase55-nav 两例失败复跑 5/5×2 确认 flake(两次失败的是不同用例,均与本 plan 无因果)。

## Deviations

- e2e 断言 `skipped` 取 `exec.response`(logCall 第 4 参)非 body——mock 记录形状实证后修正,零产品影响。
- REGEN-01-a 转绿属 52-05 宽度变更的正外部性,52-08 仍需处理 REGEN-01-c(落选节点不渲染)。

## Self-Check: PASSED

- tsc -b exit 0;vitest 401/401(含 aria-label=stale 契约用例);grep 门全命中(rerunStaleChain/getDownstreamIds/orchestrateCanvas/stopPropagation/480/ctrlKey);slots.ts 与 registerCInteractions.ts 零 diff;FlowCanvas diff 限 onNodeClick + 52-04 的 chip 注入区。
