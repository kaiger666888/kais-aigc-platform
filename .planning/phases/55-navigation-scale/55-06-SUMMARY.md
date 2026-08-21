---
phase: 55-navigation-scale
plan: 06
subsystem: branch-panel
tags: [nav-06, branch-panel, select-branch-as-main, event-merge]

# Dependency graph
requires:
  - phase: 55-navigation-scale/55-04
    provides: FlowCanvas 交互层接线基座
provides:
  - selectBranchAsMain 重写:乐观上屏 → 仅对状态变化分支逐个 await REST PATCH → 任一失败整体回滚 + toast 原文(selectWinner 范式)
  - applyBranchUpsert:branch:updated/branch_upsert 事件 status 真相合并点(toLegacyBranches 硬编码 'active' 有损 shim 的运行时修正,Pitfall 4 方案 b)
  - BranchPanel:360px 侧栏浮层(分支名/父链 mono/节点计数/主线徽章);两段式 = 预览(RF selection 压暗通道,非破坏)+ 升主线(3s 内联确认 → async action)
  - UiIcon kind 'branch'(二叉分叉意象)+ 工具栏「分支」入口
affects: [Phase 57 多结局叙事面, 55-07 e2e]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "乐观+回滚范式复刻:prevBranches 快照 → 乐观 set → for-await REST → catch 整体 set 回滚(不留半程态,T-55-06)"
    - "事件真相修正与有损 shim 并存:toLegacyBranches(V3 有损)负责初值,applyBranchUpsert(V2 事件流)负责运行时修正——不扩 flowgraph-v3 schema(A5)"
    - "预览经 RF selection 通道:预览分支 = 选中集 → 既有 selection dim 压暗;零新增样式/零持久化"

key-files:
  created:
    - packages/infinite-canvas/src/store/__tests__/selectBranchAsMain.test.ts(6)
    - packages/infinite-canvas/src/components/BranchPanel.tsx
  modified:
    - packages/infinite-canvas/src/store/canvasStore.ts
    - packages/infinite-canvas/src/components/FlowCanvas.tsx(工具栏入口 + 挂载 + onBranchCreated 接线)
    - packages/infinite-canvas/src/components/canvas/icons.tsx(+branch)

key-decisions:
  - decision: REST import 走别名 updateBranchApi(本地 store action updateBranch 同名)
    rationale: 命名冲突;别名显式区分 REST 通道与 store-only 通道。
  - decision: 预览压暗用 setSelectedNodeIds(既有 selection dim)
    rationale: plan 给「setSelectedNodeIds 或组件层 opacity 映射」二选一;selection 通道零新样式零持久化,且 Esc/再点复原语义天然。

requirements-completed: [NAV-06]

duration: 35 min
completed: 2026-08-22T03:50:00+08:00
---

# Phase 55 Plan 06: 分支 UI 接通 Summary

NAV-06:selectBranchAsMain 乐观+REST+回滚(6 用例锁定)+ applyBranchUpsert 事件合并 + BranchPanel 重建(两段式交互);旧版假删除坑不复刻。

**Duration:** 35 min · **Tasks:** 2/2(TDD ×1)· **Files:** 5

## What Was Built

- **selectBranchAsMain(async)**:早退守卫(上下文/分支存在)→ 变化集计算(仅 status 实际变化者)→ 乐观 set → for-await updateBranchApi → 任一失败 set 恢复 prevBranches + 「主线切换失败，已恢复原状，请重试」
- **applyBranchUpsert**:id merge label/status;未知 id warn 早退;FlowCanvas onBranchCreated(既有死回调位)接线 branch:updated → 合并
- **BranchPanel**:360px 浮层(标题「分支与结局」/✕/Esc);行 = 分支名+主线徽章(冷白底深字)+父链 `← {parent}` mono+节点计数;预览(selection 压暗,取消/关闭即复原);升为主线 3s 确认(确认态玫字/切换中 disabled);空态文案逐字
- **icons**:kind 'branch'(分叉+双端点)

## Self-Check: PASSED

- `npm test` **322/322**(27 文件,+6 分支);双根 tsc 0
- grep:升为主线 3/确认文案原文/selectBranchAsMain 3/applyBranchUpsert 3(store)/主线切换失败原文 1/branch-panel 1/hex 0/kind 'branch' 2

## 设计自检(UI-SPEC §5 + Color 限定)

- ✅ 两段式:预览非破坏(selection 通道,零持久化)→ 确认态 3s → 执行 disabled
- ✅ Accent 冷白只在主线徽章 + 主按钮;Destructive 玫只在确认态按钮文字/描边(UI-SPEC Color 表限定用途)
- ✅ 行高 ≥28px;全交互 button(Do-Not-Regress 5)
- ✅ 文案逐字:升为主线/确认升为主线？当前主线将归档/主线切换失败,已恢复原状,请重试/暂无分支/当前只有主线一条线路…/分支与结局

## Deviations from Plan

**[Rule 2 - 字面 vs 契约] acceptance grep "rejected"===0 无法字面满足** — Found during: Task 2 | Issue: 确认态按 UI-SPEC 必须用 Destructive 色(v3theme.signal.rejected 引用合法命中 grep) | Fix: docblock 措辞去掉字面;颜色引用保留(是 UI-SPEC 指定用途,非假删除状态) | Verification: 无 status 赋值 rejected 的代码路径
**[Rule 1 - 命名] REST updateBranch 与本地 store action 同名 → 别名导入** — Found during: Task 1 | Fix: updateBranchApi | Verification: tsc 0

**Total deviations:** 2 auto-fixed。**Impact:** 无。

## Issues Encountered

None blocking。

---

Ready for 55-07(e2e smoke + phase gate 收口)。
