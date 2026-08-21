---
phase: 56-creative-visualization
plan: 01
subsystem: viz-data-foundation
tags: [viz-01, scored-dead-letter, score-vocabulary, qc-verdict]
requires: []
provides:
  - applySocketScored canonical 写(scored 死信修复;state/stale 零触碰;overall>1 视为 percent 归一)
  - onNodeScored 回调(socket state==='scored' 先于归一拦截;payload.state 放宽 string)
  - scoreVocabulary:p03 五维/p14 八维/视角/verdict 四表 + normalizeScore 量纲归一(未知回退 fail-soft)
  - qcVerdict.deriveQcVerdicts:审计节点(voice-audit/video-qc/preview-qc)× shot_id join + shortcut 直读 → Map<nodeId, QcVerdict[]>
affects: [56-03 角标/popover 消费, 56-05 G16 工作台消费, verify:phase-56 S-vocabulary/S-socket-scored 锚点]
key-decisions:
  - decision: payload.state 类型放宽 string(handler 内 as NodeState)
    rationale: 'scored' 不在 NodeState 联合;先判 scored 分流后窄化,既有语义零变。
  - decision: overall>1 即按 percent 归一(不做显式 scale 字段)
    rationale: 服务端 p14 八维 0-100 与 unit 混流;>1 不可能是合法 unit 值,启发式安全。
  - decision: shortcut verdict 的 judge 缺省 eye(仅值含 'ear' 字样判 ear)
    rationale: shortcut 无判官元数据;保守缺省,演进位留 khs 直写。
requirements-completed: [VIZ-01]
duration: 32 min
completed: 2026-08-22T06:40:00+08:00
---

# Phase 56 Plan 01: VIZ-01 数据地基 Summary

scored 死信修复(onNodeScored → applySocketScored canonical,52-01 stale 红线零扰动)+ scoreVocabulary(13 维中文/量纲归一,9 用例)+ qcVerdict 派生(眼/耳 join,6 用例);341/341 全绿。

**Tasks:** 3/3(TDD ×3)· **Files:** 8 · 证据:vitest 19 新用例全绿;tsc 双根 0;归一表锁死断言在测。

**Deviations:** ①verdictLabel 未知值返回原串非大写(首版 toUpperCase 泄漏);②normalizeSocketNodeState 补 export(测试直测锁死);③payload.state 放宽 string(TS2367);④throw 字面注释改「绝不抛异常」(grep 门)。全部 auto-fixed。

---

Ready for 56-02(TheaterShell/audioPeaks/transcriptAlign 引擎)。
