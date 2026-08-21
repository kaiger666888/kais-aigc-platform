---
phase: 53-variant-contract-picker-upgrade
plan: 06
subsystem: variant-wall-ui
tags: [var-02, var-03, entries, d-12-closeout, adapter-channel]

# Dependency graph
requires:
  - phase: 53-variant-contract-picker-upgrade/53-02
    provides: VariantWall + openWallByGroup store 态(53-05 已接导航)
  - phase: 53-variant-contract-picker-upgrade/53-03
    provides: cand: 组(墙可开的组实体)
  - phase: 53-variant-contract-picker-upgrade/53-05
    provides: 墙导航/键盘流(入口打开后的串行体验)
provides:
  - adapter membership 通道:全部变体组成员节点 data 附 variantGroupIds + variantGroupSize(不限 deprecated)
  - AssetCardNode 组徽章:统一 count(stack ?? groupSize);点击优先 openWallByGroup,deprecated onStackToggle 回落保留
  - AssetLibrary 候选组「去画布选片」:focus + 画布图精确反查组 → 开墙;图缺降级仅定位
  - VariantPicker.tsx 删除(D-12 收尾):零真实引用;store 协议保留
affects: [Phase 54 gate 面板可复用 membership 通道, 53-07 后 Wave A 全收口]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "membership 全组通道与 deprecated-only stack 通道并联:旧通道保留为回落,新通道对任何组通用"
    - "D-19 跳转精确反查优先:不做词汇盲拼——两组键词表不同源时,经图反查成员节点所属组拿确定性 id"
    - "删除三重门:全仓 grep 引用清点(剔除泛型误匹配)+ tsc -b + npm test"
    - "L0 色块态组可见性:右侧 2px 模态色轨(stackCount OR variantGroupSize)"

key-files:
  created: []
  modified:
    - packages/infinite-canvas/src/v3/adapter.ts
    - packages/infinite-canvas/src/components/nodes/AssetCardNode.tsx
    - packages/infinite-canvas/src/components/assetManager/AssetLibrary.tsx
  deleted:
    - packages/infinite-canvas/src/components/variants/VariantPicker.tsx

key-decisions:
  - decision: 「去画布选片」用画布图精确反查,不按计划盲拼 cand:${groupKey}
    rationale: 计划 interfaces 假设资产中心 groupKey 与画布词表同源——实际 AssetLibrary 展示分组键是 char:/scene:/keyframe:(P4 时代前端键),与 Phase 48/canvas 的 shot:/name: 不同词汇。盲拼会常态落空态墙。反查组成员节点(assets-中心主资产 → asset-{id} 画布节点 → 所属 variantGroup)是确定性映射;图未加载时降级仅定位。词汇统一是 Phase 55 zone 注册表/57 taxonomy 的领地,不越界。
  - decision: StackChrome count 统一为 stack?.count ?? groupSize
    rationale: 同一视觉(×N 章 + 残影层)两数据源共用;kmc 候选组(无 deprecated)与手建 deprecated 组渲染一致。

requirements-completed: [VAR-02, VAR-03]

duration: 14 min
completed: 2026-08-21T22:50:00Z
---

# Phase 53 Plan 06: 变体墙双入口 + D-12 收尾 Summary

画布卡组徽章(membership 全组通道)+ 资产中心「去画布选片」两路进墙;旧 VariantPicker.tsx 删除,双轨叙事清零——VAR-02 入口闭环,墙单宿主(D-19)。

**Duration:** 14 min · **Tasks:** 2/2 · **Files:** 4(1 删)

## What Was Built

- **adapter.ts**:graphToViewModel 建 membership 索引(全组,成员 = variantNodeIds ∪ winnerNodeId),node data 附 variantGroupIds/variantGroupSize
- **AssetCardNode.tsx**:数据类型扩展;L0 色块轨 + StackChrome 可见性条件扩为 stack OR group;onToggle 优先开墙、onStackToggle 回落;count 统一
- **AssetLibrary.tsx**:handleGoCanvasSelect(navPushCallback + focus 主资产 + 图反查组开墙 + 切画布视图);组头「去画布选片 →」链接
- **VariantPicker.tsx**:git rm(引用清点:唯一 grep 命中是 `<VariantPickerState` 泛型误匹配)

## Self-Check: PASSED

- `npx tsc -b` exit 0;npm test 235/235;verify:phase-53 75/75
- 组件引用 0;💾 叙事 0(variants/ + assetManager/)
- openWallByGroup 在 AssetCardNode/AssetLibrary 各就位;cand: 词表差异在注释与 devision 记档

## Deviations from Plan

**[Rule 2 - 词汇缺口] D-19 链路改为画布图精确反查(非 cand: 盲拼)** — Found during: Task 2 | Issue: 计划前提"两侧 groupKey 同源"不成立于 AssetLibrary 展示分组(char:/scene:/keyframe: vs shot:/name:) | Fix: 经 store.graph.variantGroups 反查组成员节点确定性拿组 id;降级仅定位 | Files: AssetLibrary.tsx | Verification: tsc/test/人工路径推演 | Commit: 8a24deb2
**[Rule 2 - 环境] shell cwd 在 /data 与 /home/kai 两 bind 视图间漂移,曾致一次写入"丢失"与一次 git rm 路径误判** — Found during: Task 1/2 间 | Issue: mergerfs 多视图瞬时不一致 | Fix: 全部命令显式 cd /data/workspace/kais-aigc-platform 前缀 + 写后即时回读;两路径已核实同 inode(38:6386)同 HEAD | Impact: 无遗留(所有产物均在仓库内验证) | Commit: 贯穿

**Total deviations:** 2 auto-fixed。**Impact:** D-19 链路比计划字面更稳(空态墙 → 确定性开墙/降级定位)。

## Issues Encountered

None blocking。mergerfs 视图漂移已定策(固定 /data 前缀);若再现丢写考虑单视图作业。

---

Ready for 53-07(G15 桥 + 分诊面板)——Wave A 最后一个 plan。
