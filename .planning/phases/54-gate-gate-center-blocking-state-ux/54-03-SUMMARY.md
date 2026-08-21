---
phase: 54-gate-gate-center-blocking-state-ux
plan: 03
subsystem: khs-r2-r3
tags: [gate-03, r2, r3, complete-vocabulary, review-result-extraction, chosen-channel]

# Dependency graph
requires:
  - phase: 54-gate-gate-center-blocking-state-ux/54-02
    provides: 平台 decision 持久化数据面(metadata.review_result)+ 已部署活体平台
provides:
  - R2:query_review_status 第五键 result(data.metadata.review_result 提取;旧四键不动;degrade envelope 原样透传)
  - R3:Path 2 + poll_until_terminal 终态词汇对齐 COMPLETE(并集保留 resolved/closed)+ decision 优先 result(waive→approve C.4)+ chosen 第三通道(result.selected → choose:v{N} 复用解析器)
  - SC3 后半链成立:平台 COMPLETE+decision → kmc resolve → review-outcomes/PipelineState 消费链贯通
affects: [54-05 kap GateStateService 消费同一平台状态面, Wave B kmc chosen 消费]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "decision 白名单映射(approve/reject/waive→approve 三值小写枚举),未知值落 None → disposition 兜底——T-54-03-02 缓解:不崩溃不错放大"
    - "chosen 第三通道构造 choose:v{N} 字符串复用 _chosen_from_suggested 解析器(解析器零改动),排在 chosen_variant_id/suggested_action 之后"
    - "红先基线对照组:legacy resolved/closed 终态 + degrade 透传两组用例在红阶段即绿(证明失败全集来自新契约)"

key-files:
  created:
    - kais-hermes-skills:plugins/review_gates/tests/test_poller_complete_state.py(11 用例 4 组)
  modified:
    - kais-hermes-skills:plugins/kais_aigc/review_platform.py(query_review_status +result 键)
    - kais-hermes-skills:plugins/review_gates/runner_hooks.py(L539 poll_until_terminal + L661 Path 2)

key-decisions:
  - decision: poll_until_terminal(L539)不止加词汇,同补 result-first 映射(超出 plan 字面)
    rationale: plan truth #2 要求 decision 优先 result;若只加 COMPLETE 词汇,disposition=HUMAN/AUTO 的 COMPLETE 会走旧映射读成 reject(错误拒绝)。两站点同构映射是 truth #1+#2 的唯一一致实现;偏离已按 Rule 1 记录。
  - decision: khs 变更不落 commit,工作树留三文件改动
    rationale: plan 明示"本 phase 不做 git commit(orchestrator 在 checker 门后统一处理)";具名文件清单见上,严禁 add -A。

requirements-completed: [GATE-03]

duration: 34 min
completed: 2026-08-21T23:52:00+08:00
---

# Phase 54 Plan 03: khs R2+R3 — COMPLETE 词汇 + review_result 提取 Summary

G1/G3/G4 缺口关闭:kmc poller 认 COMPLETE 终态、decision 优先 result 键(waive→approve)、chosen 第三通道(result.selected);R2 给 status dict 加第五键 result。红先(9 红/2 基线绿)绿后(11/11)。

**Duration:** 34 min · **Tasks:** 2/2(TDD ×1)· **Files:** 3(khs 仓,未 commit 按计划)

## COORD-01 Checklist 结果

- **工作树干净(D-04 收窄口径)**:代码文件改动 = p04_character_design.py + p09c_storyboard_board.py(已知基线,khs2 v2.4 mid-flight,零交集);**plugins/ 下零脏文件** ✓
- **与上游同步**:fetch 无落后显示;HEAD a7b18d7 ✓
- **变更面自查**:runner_hooks.py review_gates 契约缝 + review_platform.py 平台客户端提取 = 纯契约层,不碰 22-phase 内部算法 ✓
- **排序自查**:不涉 p04/p09 输出字段映射,N/A ✓

## What Was Built

- **R2(review_platform.py ~6 行)**:query_review_status 返回 `{"review_id","state","disposition","version","result"}`,result = `(data.metadata or {}).review_result`;degrade envelope 原样返回逻辑零改动
- **R3(runner_hooks.py ~24 行)**:
  - L661 Path 2 终态集合 `{"COMPLETE","resolved","closed"}`;decision 白名单映射 `{"approve":"approve","reject":"reject","waive":"approve"}`(小写,取不到走 disposition 兜底 APPROVED/REJECTED/contest)
  - L539 poll_until_terminal 同词汇 + 同 result-first 映射(见 key-decisions)
  - chosen 三通道:`chosen_variant_id` → `_chosen_from_suggested(outcome.suggested_action)` → `_chosen_from_suggested(f"choose:v{selected[0]}")`(解析器 L612-615 零改动)
- **测试**:test_poller_complete_state.py 11 用例 4 组(COMPLETE 词汇 5/ chosen 通道 2/ poll_until_terminal 1/ R2 提取 3)

## Self-Check: PASSED

- 红:9 failed(全部 COMPLETE/result/selected 契约)+ 2 passed(legacy resolved/closed + degrade 透传基线对照)
- 绿:`test_poller_complete_state.py` 11/11;`plugins/review_gates/tests` 全绿
- 全量:`plugins/review_gates/tests + plugins/kais_aigc/tests` = **825 passed, 4 failed**;4 失败经 git stash 基线复跑(无我方改动同样 4 failed,2.16s)**确证 PRE-EXISTING**(canvas_sync_integration ×2 / dreamina_manager / review_platform JWT——khs2 并行域),非 R2/R3 回归
- grep:runner_hooks.py 两处 "COMPLETE"(L539/L661);review_platform.py "result" 键命中且旧四键在
- 工作树:plugins/ 下改动恰三文件(具名),p04/p09c 基线未动

## Deviations from Plan

**[Rule 1 - 范围正确性] poll_until_terminal 同补 result-first 映射(plan 字面仅要求加词汇)** — Found during: Task 2 | Issue: COMPLETE+disposition HUMAN/AUTO 在旧映射下读成 reject(错误拒绝) | Fix: 两站点同构 decision 映射(白名单 + 兜底) | Verification: TestPollUntilTerminalComplete 绿
**[Rule 2 - 测试基建] GateConfig import 自 gate.py 非 gate_config.py** — Found during: Task 1 | Issue: ImportError(收集期) | Fix: 照 test_runner_hooks 实际 import 路径修正 | Verification: 11/11 收集运行

**Total deviations:** 2 auto-fixed。**Impact:** 无;第一项是 plan truth #2 的必要一致化。

## Issues Encountered

None blocking(khs 全量 4 失败为 PRE-EXisting 基线,stash 对照确证)。

---

Ready for 54-04(前端地基:gateStore/foldDisplayState 消费)。
