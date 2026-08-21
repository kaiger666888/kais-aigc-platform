---
phase: 53-variant-contract-picker-upgrade
plan: 01
subsystem: wire-contract
tags: [candidate-envelope, zod, var-01, contract-test, g15-taxonomy, fixtures]

# Dependency graph
requires:
  - phase: 48-ingest-candidate-grouping
    provides: groupKey 词表(shot:{sid}:first|last / name:{dir}/{base})——envelope 逐字节对齐
  - phase: 51-canonical-write-path
    provides: verify-phase-51 门范式(docblock/assert 收集器/mkdtemp+chdir/forced-failure)
provides:
  - candidateEnvelopeSchema(looseObject 未知键容忍)+ candidateSourceSchema(5 源)+ candidateScoreSchema(unit/percent 刻度声明)
  - normalizeLegacyCandidateData(今日扁平形状→信封;a-flf {sid}_{slot}→canonical;c-* → groupKey 空串 derivable:false)
  - parseCandidateEnvelope 两代形状单入口
  - G15 taxonomy:g15ErrorCategorySchema(9 值)+ takeVerdictCategory + classifyG15Error 字符串特征分类
  - takeLogEntrySchema(五 verdict)+ failedShotEntrySchema
  - verify:phase-53 npm script(S1 live 35 断言 + S2..S4 FILLED-BY 占位 + S5 forced-failure)
  - scripts/fixtures/phase53/ 四 fixture(双代 wire 快照)
affects: [53-03 组推导消费 normalizeLegacyCandidateData, 53-04 端点消费 candidateSourceSchema, 53-07 G15 面板消费 taxonomy]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "两代形状单入口:safeParse 结构化直通 → 失败走 legacy 归一化;绝不 throw,识别不了返回 null(fail-closed 不猜)"
    - "groupKey 逐字节复用 Phase 48 词表;legacy 短横格式 {sid}_{first|last} 由归一化层映射,词汇表单一来源"
    - "c-* 无组信号裁定:groupKey 置空串 + derivable:false 语义——归一化产物不经 schema 再校验(schema min(1) 意图在文档注明),53-03 据此跳过等 Wave B"
    - "take_verdict_* 占位值 + 映射函数:zod enum 不支持 pattern,字面占位 + takeVerdictCategory() 出具体值"
    - "score 缺省 = undefined:今日 khs call site 丢弃 score 是 VAR-01 实锤,envelope 不造 0 分"
    - "forced-failure 自检实证:翻转一条 shadow 为真断言 → exit 1(执行后还原,35/35 复绿)"

key-files:
  created:
    - src/lib/candidateEnvelope.ts
    - scripts/verify-phase-53.ts
    - scripts/fixtures/phase53/candidates-legacy.json
    - scripts/fixtures/phase53/candidates-envelope.json
    - scripts/fixtures/phase53/take-log.json
    - scripts/fixtures/phase53/failed-shots.json
  modified:
    - package.json

key-decisions:
  - decision: c-* p01 候选无组信号 → envelope groupKey 空串(derivable:false)
    rationale: 今日 c-* 节点无任何组通道;伪造 groupKey 会让 53-03 物化出错误组。空串 + 跳过语义把组推导的开口留给 Wave B 结构化 groupKey。
  - decision: take_verdict_* 用 enum 占位值 + 映射函数
    rationale: zod enum 无 pattern 支持;占位值保住 9 值 taxonomy 的机器可读性,具体值经 takeVerdictCategory() 派生,分类面不散落字符串拼接。
  - decision: classifyG15Error 字符串特征表(verdict→needsRegenerate→timeout→parse→schema→bgm→render→vision→unknown)
    rationale: DR-6 对号;fixture 三条实锤(timeout→delegate_timeout / schema→schema_validation / CUDA→engine_render_error)。纯字符串分类无 IO。

requirements-completed: [VAR-01]

duration: 14 min
completed: 2026-08-21T22:20:00Z
---

# Phase 53 Plan 01: 候选信封契约 + verify 门骨架 Summary

统一 candidate 信封 zod 契约(5 源判别 + 两代 wire 形状单入口 + G15 归因 taxonomy)与 verify:phase-53 契约门骨架——Wave A 后续全部 plan 的契约地基。

**Duration:** 14 min · **Tasks:** 2/2 · **Files:** 7

## What Was Built

- `src/lib/candidateEnvelope.ts`(294 行,纯模块):candidateSource/candidateScore/candidateEnvelope/takeLogEntry/failedShotEntry/g15ErrorCategory 六 schema + normalizeLegacyCandidateData + parseCandidateEnvelope + takeVerdictCategory + classifyG15Error
- `scripts/verify-phase-53.ts`(mkdtemp+chdir 隔离):S1 live 35 断言全绿;S2/S3/S4 留 FILLED-BY-53-03/04/07 占位;S5 forced-failure 自检 4 条 shadow 全部按预期失败(翻转实证 exit 1)
- 4 fixtures:legacy 4 节点快照(a-flf ×3 + c-* ×1)/ Wave B 5 源信封(percent 刻度实锤)/ take-log 5 verdict / failed-shots 3 类错误
- package.json 注册 `verify:phase-53`

## Self-Check: PASSED

- `npm run verify:phase-53` exit 0(35/35)
- `npx tsc --noEmit` exit 0
- canvasAssetSchema.ts 零修改(assetDataSchemas 基线不含 envelope——per-source 判别与 per-node-type 基线分离)
- forced-failure 实证:翻转 shadow → exit 1,还原后复绿

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

---

Ready for 53-02(变体墙引擎——同播主时钟/键盘流/缩略图自愈)。
