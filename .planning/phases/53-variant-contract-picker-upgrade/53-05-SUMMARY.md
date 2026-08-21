---
phase: 53-variant-contract-picker-upgrade
plan: 05
subsystem: variant-wall-ui
tags: [var-02, var-03, frame-slot, review-pipeline, d-12-dedup]

# Dependency graph
requires:
  - phase: 53-variant-contract-picker-upgrade/53-02
    provides: VariantWall 剧场 + 下一镜/键盘占位 + selectWinner 接线位
  - phase: 53-variant-contract-picker-upgrade/53-03
    provides: cand: 组(groupKey 形如 shot:{sid}:first|last)
  - phase: 53-variant-contract-picker-upgrade/53-04
    provides: select-winner 端点 frameSlot 参数面(zod enum)
provides:
  - variantOps:frameSlotOfGroup(组键后缀推导,cand: 前缀剥离)+ nextReviewGroup(shot 自然序/first<last/name 后置/跳已选/不回绕)+ prevReviewGroup(←对称)
  - canvasApi:selectVariantWinner 第 6 参 frameSlot(spread-omit)+ g15Ops sibling(53-07 预置通道)
  - canvasStore.selectWinner(nodeId, {frameSlot}) 透传 + legacy RF 路径废弃(warn 早退,D-12)
  - VariantWall:首帧/尾帧 slot 标签 + 选定后自动下一待审组(墙不关)+「本 phase 审完 ✓」终态 + 下一镜/←→ 接通(手动可越已选)
affects: [53-06 入口扩展 + 旧 VariantPicker 删除, 53-07 g15Ops 端点消费]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "frameSlot 只从组键后缀推导(frameSlotOfGroup),UI 无自由输入面;端点 zod enum 二道闸(T-53-05-01)"
    - "结构化 ReviewGroupLike 最小类型:V3 VariantGroupV3 与 RF VariantGroup 双兼容,纯函数不绑 store 形状"
    - "审片线性流不回绕(planner 裁定):nextReviewGroup 到头 null → 终态提示,不循环"
    - "导航统一走 openWallByGroup(next.id):自动下一镜/手动/键盘三入口同一转换路径,组切换 effect 统一重置 transport"
    - "legacy RF 废弃 = warn 早退不 throw(T-53-05-02):旧调用方静默降级,53-06 删 Picker 后调用方消失"

key-files:
  created: []
  modified:
    - packages/infinite-canvas/src/store/variantOps.ts
    - packages/infinite-canvas/src/services/canvasApi.ts
    - packages/infinite-canvas/src/store/canvasStore.ts
    - packages/infinite-canvas/src/store/__tests__/selectWinner.test.ts
    - packages/infinite-canvas/src/components/variants/VariantWall.tsx

key-decisions:
  - decision: 组键解析从 groupKey 改为 id(cand: 前缀剥离)
    rationale: V3 VariantGroupV3 无 groupKey 字段只有 id(`cand:shot:...`);frameSlotOfGroup 同时接受两种输入,推导单一来源。
  - decision: legacy RF 路径整段删除(非条件保留)
    rationale: D-12 双轨清除;RF 本地写与 v3 canonical 真值分叉正是 Phase 51 要消灭的形态。applyWinnerSelection/rollback/syncWinnerToGroups 在本文件的唯一消费者随段删除,import 一并清。
  - decision: 选定后自动下一镜用默认跳已选,手动用 includeSelected
    rationale: D-17 审完即走的流水语义 + D-18 手动可越的纠错语义分离。

requirements-completed: [VAR-02, VAR-03]

duration: 18 min
completed: 2026-08-21T22:32:00Z
---

# Phase 53 Plan 05: 审片流水线接线 Summary

frameSlot 透传链(墙→store→api→端点)打通、G13 首尾两组依序各选各的、选定后墙不关自动载入下一待审组 + 手动/键盘切组、legacy RF 双轨废死(D-12)——93 镜串行审片流成形。

**Duration:** 18 min · **Tasks:** 3/3(TDD ×1)· **Files:** 5

## What Was Built

- **variantOps**:frameSlotOfGroup / nextReviewGroup / prevReviewGroup 三个纯函数(结构化 ReviewGroupLike 双兼容)
- **canvasApi**:selectVariantWinner frameSlot 第 6 参(spread-omit)+ g15Ops sibling 预置
- **canvasStore**:selectWinner +opts 透传;legacy RF 路径 1634 字符整段替换为 warn 早退;死 import 清除
- **VariantWall**:slot 标签(首帧/尾帧)、选定后自动下一组、审完终态、下一镜按钮 + ←/→ 接通、组切换 transport 重置(seek 0 + 检视第一卡)
- **selectWinner.test.ts**:9/9(frameSlot 三组 + 废弃语义 + 既有守卫回归)

## Self-Check: PASSED

- variants+store 套件 55/55;全套件 235/235;`npx tsc -b` exit 0;root tsc exit 0
- frameSlotOfGroup/nextReviewGroup 在 VariantWall 各 ≥1 调用;中文 copy(下一镜/首帧/尾帧/本 phase 审完)齐
- 下一镜 disabled 由 nextReviewGroup 结果驱动(无硬编码残留)

## Deviations from Plan

**[Rule 2 - 类型系统] nextReviewGroup 输入从 groupKey 改为结构化 id** — Found during: Task 1 | Issue: 计划 interfaces 假设组带 groupKey 字段,但 V3 VariantGroupV3 只有 id(含 cand: 前缀),RF VariantGroup 只有 groupId | Fix: ReviewGroupLike {id, winnerNodeId?} 结构类型 + keyOfGroup 前缀剥离,两侧通用 | Verification: tsc -b + 后续接线全绿 | Commit: variantOps 提交
**[Rule 2 - 环境] variantOps 首次写入丢失(cwd 漂移 + 疑似 FS 疑点),绝对路径重写恢复** — Found during: Task 1 | Issue: 相对路径 python 写入后文件回退原状(git status 不显示修改) | Fix: 绝对路径重写并即时 grep 验证落盘 | Verification: grep 3 exports + tsc | Commit: 同上
**[Rule 1 - 测试语义] 既有成功用例断言补第 5/6 参 undefined** — Found during: Task 2 RED | Issue: 调用形状按计划扩展后 toHaveBeenCalledWith(4 参)必然失败 | Fix: 断言补 undefined, undefined(向后兼容语义不变) | Verification: 9/9 | Commit: RED 提交内

**Total deviations:** 3 auto-fixed。**Impact:** 无行为影响;结构化类型是净改善。

## Issues Encountered

None blocking。注:本会话已遇两次文件写入丢失(cwd 漂移为主因,一次疑似 FS 悬空 dentry)——后续所有写入用绝对路径 + 即时回读验证。

---

Ready for 53-06(入口扩展 + 旧 VariantPicker 删除)与 53-07(G15 桥 + 分诊面板)。
