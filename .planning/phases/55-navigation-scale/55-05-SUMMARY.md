---
phase: 55-navigation-scale
plan: 05
subsystem: lane-zoom-memory
tags: [nav-05, lane-zoom, column-focus, scene-num-of-migration]

# Dependency graph
requires:
  - phase: 55-navigation-scale/55-02
    provides: sceneNumOf/sceneColorOf 共享口径
provides:
  - PersistedCanvasState.laneZoom(phaseIndex → 记忆 zoom;patch-merge 持久化,沿 kais:canvas:v1 key)
  - PhaseColumns 列头聚焦:热区(pointerEvents 局部反转 + role=button/tabIndex/aria-label;aria-hidden 根删除)→ fitView 列节点 + 恢复记忆 zoom(clamp 0.6..1.5);记忆写入节流 1s(复用既有 useViewport 订阅,零新增订阅者)
  - ShotTree:sceneNumOf 口径迁移(binding 4 最后一个使用点收口)+ 场景行聚焦(色点+◎ fitView 入口,节头零冲突)
  - LOD 阈值回归守卫测试(0.22/0.6/0.03/0.4 四常量钉死)
affects: [55-07 e2e, Phase 54 泳道高亮(同坐标系零影响)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "零新增 viewport 订阅者(T-55-REG):记忆写入复用 PhaseColumns 既有 useViewport 订阅 + ref 节流,不挂 onMove/LodProvider 之外任何监听"
    - "局部 pointerEvents 反转:SVG 根 none 保持(节点零遮挡),仅列头热区 g 置 auto"
    - "恢复时序取简:fitView 620ms 后读 getViewport 保持中心只改 zoom(注释标注假设)"
    - "主导列 = cx 距视口中心(flow 坐标换算)最近者"

key-files:
  modified:
    - packages/infinite-canvas/src/hooks/useCanvasPersistence.ts(+laneZoom 字段)
    - packages/infinite-canvas/src/hooks/__tests__/canvasState.test.ts(+4)
    - packages/infinite-canvas/src/components/canvas/PhaseColumns.tsx
    - packages/infinite-canvas/src/components/canvas/ShotTree.tsx

key-decisions:
  - decision: 记忆写入走 PhaseColumns 既有订阅(plan 字面「onMoveEnd 时机」不可用——FlowCanvas 零 diff 红线)
    rationale: W1 裁决本 plan 对 FlowCanvas.tsx 零 diff;onMoveEnd 需在 FlowCanvas 注册。组件内 useEffect on zoom(既有订阅)+ 1s 节流等价满足「≥1s 或仅 moveEnd」。
  - decision: ShotTree 场景行聚焦按钮嵌在节头按钮内(headerExtra + stopPropagation)
    rationale: 节头本无点击语义,与折叠 toggle 共存需 stopPropagation;聚焦与折叠两个动作并置不冲突。

requirements-completed: [NAV-05]

duration: 38 min
completed: 2026-08-22T03:20:00+08:00
---

# Phase 55 Plan 05: 泳道缩放记忆 + 列头聚焦 + 场景口径收口 Summary

NAV-05:laneZoom 持久化 + PhaseColumns 列头「聚焦本阶段」(fitView + 恢复记忆 zoom ≥0.6)+ ShotTree sceneNumOf 迁移与场景聚焦并列入口;LOD 红线四常量测试钉死。

**Duration:** 38 min · **Tasks:** 3/3(TDD ×1)· **Files:** 4

## What Was Built

- **useCanvasPersistence**:laneZoom?: Record<number, number>(patch-merge 天然覆盖,零额外逻辑);4 新用例(回读/patch 键级合并/旧档向后兼容/LOD 四常量守卫)
- **PhaseColumns**:列头热区(title tooltip「聚焦本阶段（恢复上次可读缩放）」/Enter+Space 键盘/role+tabIndex+aria-label);focusColumn(fitView 600ms maxZoom 1.5 → 620ms 后 setViewport 恢复 clamp[0.6,1.5]);记忆写入 effect(1s 节流,主导列 cx 最近);aria-hidden 根删除(a11y 树可达)
- **ShotTree**:scenePrefix 删除 → sceneNumOf 数字段分组(场景号 0 平铺;≥2 distinct 才分组;数字升序);场景行 headerExtra(8px sceneColorOf 色点 + ◎ 聚焦按钮 → fitView 场景节点 maxZoom 1.0);单击选中/双击详情语义未动

## Self-Check: PASSED

- `npm test` **316/316**;双根 tsc 0
- 红线:useLod.ts 0 diff;tokens.css 0 diff;FITVIEW_MIN_ZOOM=0.4 在 FlowCanvas 原样(grep 5 处)
- grep:聚焦本阶段 2/pointerEvents auto 1 + none 1(局部反转)/laneZoom 2/aria-hidden 0;scenePrefix 0/sceneNumOf 7/fitView 2

## 设计自检(UI-SPEC §3 + State Matrix)

- ✅ 列头聚焦三态:默认(纯标签)/hover(title chip「聚焦本阶段（恢复上次可读缩放）」)/恢复(fitView 600ms + zoom 回设 120ms)
- ✅ 仅列头热区可点(28px 文字带 rect,列身/节点零遮挡)
- ✅ Do-Not-Regress 4:列头色仍 v3theme.phaseGroup[col.group](Phase 54 同坐标系)
- ✅ 恢复下限 0.6 = L2 可读档;默认 fitView 与 FITVIEW_MIN_ZOOM 完全不动

## Deviations from Plan

**[Rule 2 - 红线冲突] 记忆写入时机从 onMoveEnd 改为组件内 zoom effect + 1s 节流** — Found during: Task 2 | Issue: onMoveEnd 须在 FlowCanvas 注册,违反 W1 零 diff 红线 | Fix: 复用既有 useViewport 订阅(零新增订阅者,T-55-REG 达成)| Verification: hooks 测试绿 + tsc 0
**[Rule 1 - JSX 结构] headerExtra 插入时闭合标签丢失(两轮修复)** — Found during: Task 3 | Issue: python 正则替换吞 </button> | Fix: 行级定位插入 | Verification: tsc 0

**Total deviations:** 2 auto-fixed。**Impact:** 无。

## Issues Encountered

None blocking。

---

Ready for Wave 3(55-06 BranchPanel 重写 / 55-07 e2e smoke + phase gate)。
