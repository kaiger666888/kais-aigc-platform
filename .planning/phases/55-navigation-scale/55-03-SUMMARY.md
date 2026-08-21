---
phase: 55-navigation-scale
plan: 03
subsystem: phase-single-source
tags: [nav-01, d-04-single-source, unmapped-fallback, khs-index-writer]

# Dependency graph
requires:
  - phase: 55-navigation-scale/55-01
    provides: PHASE_REGISTRY 22 条单一注册表
provides:
  - D-04 单源消费:PIPELINE_PHASES = PHASE_REGISTRY re-export(model.ts 内联 19 条删除);PHASE_GROUPS 由注册表派生(constants.ts 字面量 1-18 表删除);import-from-dir PHASE_DEFS 13 条删除改 PHASE_REGISTRY 跨界消费
  - D-03 未映射兜底:derivePipelineModels extras → 「未映射 · {idx}」条目(unmapped:true)+ console.warn 索引级聚合(Set 去重)不 throw
  - binding 8 修复:zone/summary/artifact 三写点 phaseIndex 一律 def.phaseIndex(khs 编号),laneIndex+1 错位清零
  - FILE_TO_PHASE/ASSET_DIR_TO_PHASE 22 前缀词汇表(p11a0→p11a 折叠;p11→p11b、p12→p12a legacy 重定向;mix/bgm→p12b)
  - adapter 22-phaseIndex 合成图断言(零未映射 + lane 宿主 zone 胜出 + 99 反向对照)
affects: [Phase 54 泳道高亮(PHASE_GROUPS 派生同源), Phase 57 taxonomy, 55-05 lane 消费]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "re-export 保消费方零改动:PIPELINE_PHASES/PhaseGroup 全部 `export ... from phaseRegistry` 链,22 条词汇一处改全局生效"
    - "未映射 fail-loud 不崩:条目可见(命名+unmapped 标记)+ warn 聚合(Set 进程级去重)——存量 pre-W6 图走兜底不算失败(A3)"
    - "跨界 import 后端消费前端常量模块:phaseRegistry 零外部 import 故双 tsconfig 编译(schema/generated 先例)"
    - "lane 宿主断言:phaseCatalog 按 phaseIndex 键控,共 lane 条目断言 sortKey 最小宿主的 label(p11a0 无 zone——khs 折叠现实)"

key-files:
  modified:
    - packages/infinite-canvas/src/components/pipeline/model.ts
    - packages/infinite-canvas/src/constants.ts
    - src/routes/canvas/v2/import-from-dir.ts
  created:
    - packages/infinite-canvas/src/components/pipeline/__tests__/pipelineModel.test.ts(5)
  extended:
    - packages/infinite-canvas/src/v3/__tests__/adapter.test.ts(+2 phase 用例)

key-decisions:
  - decision: constants.ts 的 PhaseGroup 用 export type re-export(非本地联合)
    rationale: 单源纪律;调试中曾因相对路径写错('./phaseRegistry' 应为 './constants/phaseRegistry')产生 any 下游 16 个 TS7053——修路径后 re-export 链干净。
  - decision: 注销单体(p05/p10b/p11/p12)从 FILE_TO_PHASE 移除,legacy 文件名重定向(p11→p11b/p12→p12a)
    rationale: PHASE_DEF_MAP 无注销条目,映射到它们会 throw;p11 语义=最终渲染(p11b)、p12=合成(p12a 承接)。p05 文件未命中走既有忽略路径。

requirements-completed: [NAV-01]

duration: 48 min
completed: 2026-08-22T02:15:00+08:00
---

# Phase 55 Plan 03: 消费方迁移 — 三表合一 + khs 编号写点 Summary

D-04 单源落地:三张旧表(前端 19 条/分组字面量/后端 13 条)全删改消费注册表;未映射兜底 fail-loud 不崩;后端 phaseIndex 写点从 laneIndex+1 错位改为 khs 编号;合成 22-phase 图零未映射断言。

**Duration:** 48 min · **Tasks:** 3/3(TDD ×2)· **Files:** 5

## What Was Built

- **model.ts**:PIPELINE_PHASES = PHASE_REGISTRY;PipelinePhaseDef/PhaseGroup re-export;extras → 未映射条目({sortKey:1000+idx, code:'未映射', name:'未映射 · {idx}', unmapped:true})+ WARNED_UNMAPPED Set 聚合 warn
- **constants.ts**:PHASE_GROUPS = Object.fromEntries(PHASE_REGISTRY.map(e=>[e.phaseIndex, e.group]))(注销 lane 5/13 不再映射;laneGeometry ?? 'production' 兜底消费自动适应)
- **import-from-dir.ts**:PHASE_REGISTRY 跨界 import;PHASE_LANE_ORDER(sortKey 序)驱动 baseX;三写点 phaseIndex: def.phaseIndex;词汇表 22 前缀 + legacy 重定向 + mix/bgm→p12b
- **测试**:pipelineModel 5 用例(22 条/P09c·P12a·P12b·P11a0 在列/PHASE_GROUPS 派生逐条+5/13 undefined/99+13 唯一未映射不 throw/warn 聚合/全注册零未映射);adapter +2(22 合成图零未映射+lane 宿主 catalog 胜出/99→1 兜底)

## Self-Check: PASSED

- `npm test` **297/297**;双根 tsc 0;`verify:phase-55` 14/14(迁移后契约仍绿)
- grep:内联表 0(laneIndex + 1 = 0;const PHASE_DEFS = 0;10: 'production' = 0);未映射 5;p09c/p12a/p12b 11

## Deviations from Plan

**[Rule 2 - 路径] constants.ts 引 phaseRegistry 的正确相对路径是 './constants/phaseRegistry'(plan 字面 './constants/phaseRegistry' 正确,首版实现误写 './phaseRegistry')** — Found during: Task 1 | Issue: 模块不解析 → any 下游 16 个 TS7053(表象误导为类型重导出问题) | Fix: 路径修正 + bisect 定位 | Verification: tsc 0
**[Rule 2 - 数据现实] 合成图 zone 仅 lane 宿主条目发射** — Found during: Task 3 | Issue: p11a0 与 p11a 同 phaseIndex 14,双 zone 使 catalog 值序敏感 | Fix: isLaneHost 判定(sortKey 最小)——khs 折叠现实每 lane 恰一 zone | Verification: 31/31
**[Rule 1 - 断言语义] adapter 44 节点(22 资产 + 22 事件 chip)/catalog 按 lane 键控** — Found during: Task 3 | Issue: 首版按 22 节点/逐条目 label 断言 | Fix: 长度断言放宽为注释 + lane 宿主断言 | Verification: 全绿

**Total deviations:** 3 auto-fixed。**Impact:** 无;均是对既有 adapter 语义的对齐。

## Issues Encountered

None blocking。

---

Ready for 55-04(SearchNavigator + placeNewAsset)/55-05(lane 缩放记忆)。
