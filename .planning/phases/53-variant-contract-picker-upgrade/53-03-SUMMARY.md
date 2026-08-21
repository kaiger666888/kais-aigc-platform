---
phase: 53-variant-contract-picker-upgrade
plan: 03
subsystem: wire-contract
tags: [var-01, var-03, candidate-groups, materialize, idempotent, load-hook]

# Dependency graph
requires:
  - phase: 53-variant-contract-picker-upgrade/53-01
    provides: parseCandidateEnvelope(groupKey 归一化入口,零逻辑复制)
  - phase: 48-ingest-candidate-grouping
    provides: parseVariantName(_v{N} 命名通道)+ groupKey 词表
provides:
  - deriveCandidateGroups 纯函数(通道 A envelope + 通道 B 命名;首尾两键;成员<2 丢弃;id cand:{groupKey} 确定性幂等;>128 拒绝不截断;永不 throw)
  - materializeCandidateGroups(db 参数 P4 + 单事务 + 参数化 SQL;只写 cand: 行;既有 winner 不覆盖;成员自愈)
  - mergeDerivedGroups(既有组优先,响应合并)
  - load-v2 全量加载钩子(derive→materialize→merge;best-effort warn 降级;since/空图路径零改动)
affects: [53-04 select-winner 端点对候选组可写, 53-05/53-06 墙对 kmc 候选可开]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "load-time 触发 + 确定性幂等 id:与 khs 重同步互不清组(khs 不写组,推导只补 cand: 机器组)"
    - "db-as-parameter(P4):materialize 收 Knex 参数不走模块级单例——verify 才能 :memory: 注入"
    - "用户组保护双闸:机器组 id 恒带 cand: 前缀(构造保证)+ 非 cand: 既有行跳过(防御)"
    - "命名通道 /oss/ 媒体根相对化:groupKey 与 Phase 48 ingest 扫描词汇同构"
    - "spawn 子进程端点 dispatch:knex 池怪癖隔离(49-01 范式),子进程文件须在仓内供相对 import"

key-files:
  created:
    - src/lib/candidateGroupDeriver.ts
  modified:
    - src/routes/canvas/v2/load-v2.ts
    - scripts/verify-phase-53.ts

key-decisions:
  - decision: 命名通道 canonical 兄弟也是组成员(v1+v2+canonical = 3 成员)
    rationale: Phase 48 命名通道把无后缀 canonical 视为组默认成员;墙上 canonical = 原版对照。判定 = 同 dir 同 base + canonical filePath 在节点集内。
  - decision: winner 保留语义——既有 winner 永不被推导覆盖(仅 NULL 时落 derived winner)
    rationale: 用户显式选定是决策真值;推导 selected 只是 khs 同步态快照。成员集自愈但决策不自愈。
  - decision: load-time 触发(非 sync 接收时)
    rationale: 全量加载是天然的确定性重放点;增量 since 轮询高频,推导在彼处会放大 O(n);空图无候选可推。

requirements-completed: [VAR-01]

duration: 16 min
completed: 2026-08-21T22:22:00Z
---

# Phase 53 Plan 03: 候选组推导/物化 Summary

解 Critical Gap:kmc 候选节点(a-flf 条件帧 + `_v{N}` 命名族)在图加载时自动物化为 canvas variantGroups——select-winner 端点/前端守卫/广播的操作单元从此对 kmc 候选可用。

**Duration:** 16 min · **Tasks:** 2/2 · **Files:** 3

## What Was Built

- **candidateGroupDeriver.ts**:双通道推导(envelope 归一化 + 命名 canonical 兄弟)→ `cand:{groupKey}` 确定性幂等组;事务物化(db 参数 + 参数化 SQL);响应合并(既有优先)
- **load-v2.ts**:全量分支 best-effort 钩子,失败 warn 不影响加载;since/空图路径零改动
- **verify S2 live**:56/56 断言(推导 6 + 首尾两键 + 幂等 5 + 用户组保护 2 + 词表 2 + 端点 dispatch 5)

## Self-Check: PASSED

- `npm run verify:phase-53` exit 0(56/56,S1+S2+S3/S4 占位+S5)
- `npx tsc --noEmit` exit 0
- 端点二次 POST 幂等(组数不翻倍);since 路径返回 nodes/links 形状(推导不触发)

## Deviations from Plan

**[Rule 2 - 测试基建] S2f 子进程文件从 /tmp 移入仓内(scripts/.tmp)** — Found during: Task 2 | Issue: /tmp 子进程的绝对路径 dynamic import 解析为 file:// URL 找不到 src/utils/index | Fix: 子进程文件写 scripts/ 下,相对 import 与父进程同解析;跑完即删 | Verification: S2f 5/5 | Commit: 见本 plan 测试提交
**[Rule 1 - 契约] 命名通道 groupKey 相对 /oss/ 媒体根** — Found during: Task 1 | Issue: filePath 全路径直接当 parentDir 会产出 name:/oss/kmc/...(计划断言是 name:kmc/P04/charA) | Fix: /oss/ 前缀剥离,与 Phase 48 ingest 扫描词汇同构 | Verification: S2a-3 | Commit: 同上

**Total deviations:** 2 auto-fixed。**Impact:** 无;均在校验器捕获后立即修正。

## Issues Encountered

None.

---

Ready for 53-04(select-winner 扩展 + manifest hook + 重试队列)。
