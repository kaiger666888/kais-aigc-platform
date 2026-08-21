---
phase: 53-variant-contract-picker-upgrade
plan: 04
subsystem: wire-contract
tags: [var-03, select-winner, manifest-writeback, retry-queue, frame-slot]

# Dependency graph
requires:
  - phase: 53-variant-contract-picker-upgrade/53-01
    provides: candidateSourceSchema(端点 source 字段)
  - phase: 53-variant-contract-picker-upgrade/53-03
    provides: cand: 组(select-winner 的操作单元对 kmc 候选可用)
  - phase: 49-selection-write-back
    provides: select-winner 事务化端点 + reviewBridge 同位挂点范式
provides:
  - select-winner 端点 frameSlot/source 可选参数(D-11 首尾分选参数面,向后兼容)
  - manifestWriteback.ts:ManifestTransport deps 注入 + targetForParams(D-11 字段名映射)+ enqueueManifestWriteback(never-throws)+ replayManifestWriteback(drain handler)
  - writebackQueue.ts:canvas_writeback_queue 全部读写——enqueue/drainOnce(串行+指数退避 30s·2^n+max 8)/ensureDrainStarted(30s 单例)
  - initDB canvas_writeback_queue DDL(g15_waive/g15_requeue 两 action 枚举已预留,53-07 复用)
affects: [53-05 墙接线消费 frameSlot 参数, 53-07 G15 桥复用队列 action 枚举, Wave B transport 实现]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "transport=null 不入队(warn-once no-op):通道未开通 ≠ 通道故障——避免 Wave A 每笔选定灌成 8 重试 failed 行"
    - "回写三段降级:直投成功 return → 直投失败入队 → 入队失败 warn(最坏丢一次回写,canvas 真值已在,Pitfall 4)"
    - "幂等分支零接触(Pitfall 5):重复选定不触发 hook/队列/广播,既有语义逐字节保持"
    - "deps 注入(getTransport/db):verify 可 fake transport + :memory: 队列(reviewBridge P1 纪律)"
    - "drain 单例空转保护:transport null 时 drain 回调 processed 0,不误标 failed"

key-files:
  created:
    - src/lib/manifestWriteback.ts
    - src/lib/writebackQueue.ts
  modified:
    - src/lib/initDB.ts
    - src/routes/canvas/v2/select-winner.ts
    - scripts/verify-phase-53.ts

key-decisions:
  - decision: Wave A transport 零实现,未配置不入队
    rationale: FS 直写 vs HTTP 是 Wave B 决策(Open Question 1);通道抽象为 ManifestTransport 接口 + KMC_MANIFEST_TRANSPORT 分派点,Wave B 只挂实现零返工。若 Wave A 就入队,每笔选定都会变成 8 次重试的 failed 行——污染审计面。
  - decision: 退避参数 30s 基数 × 2^attempts,max 8 次
    rationale: DR-4 锁定值;8 次 × 指数退避 ≈ 覆盖 1 小时级瞬时故障,超过即终态 failed 留 last_error 审计。
  - decision: G14 无 frameSlot → chosen_variant_id(variantIndex 通用化)
    rationale: G13 首尾有 p11a0 权威字段名;G14 预览的 manifest 字段形状 Wave B 才定,先用通用语义占位,Wave B 在 transport 实现里落最终字段。

requirements-completed: [VAR-03]

duration: 20 min
completed: 2026-08-21T22:40:00Z
---

# Phase 53 Plan 04: 选优回写 kap 半部 Summary

select-winner 端点扩展(frameSlot/source)+ manifest 回写通道(transport 抽象 + never-throws 挂点)+ 持久化重试队列(指数退避/串行 drain/max 8)——选定→kmc manifest 的 kap 侧管线成形,Wave B 只剩挂 transport。

**Duration:** 20 min · **Tasks:** 3/3 · **Files:** 5

## What Was Built

- **canvas_writeback_queue DDL**(initDB relationalCanvasTables family):increments PK/action 3 枚举/state 3 枚举/attempts/max 8/next_attempt_at/last_error(500 截断)/due 四列复合索引
- **writebackQueue.ts**(db 参数 P4):enqueue(pending, next=+30s)/drainOnce(按 id 串行;成功 done;失败 attempts+1,退避 30s×2^n,attempts≥8 → failed 终态;handler throw 按 false)/ensureDrainStarted(30s interval 单例 + unref)/stopDrainForTest
- **manifestWriteback.ts**:ManifestTransport 接口(幂等契约 + FS 路径约束冻结)/getManifestTransport(KMC_MANIFEST_TRANSPORT 分派,Wave A null)/targetForParams(D-11: first→selected_first_variant / last→selected_last_variant / 无→chosen_variant_id,value=1-based variantIndex)/enqueueManifestWriteback(deps 注入,三段降级 never-throws)/replayManifestWriteback
- **select-winner.ts**:schema +frameSlot(z.enum optional)+source(candidateSourceSchema optional);updated 段 reviewBridge 之后挂 hook(void + .catch);bootWritebackDrain 单例;幂等分支/响应形状零改动

## Self-Check: PASSED

- `npm run verify:phase-53` exit 0(**75/75**;S3 四组全绿)
- `npx tsc --noEmit` exit 0
- 端点向后兼容:旧式 POST(无新字段)200 applied:true;幂等 POST applied:false 且队列零行

## Deviations from Plan

**[Rule 2 - 可测性] enqueueManifestWriteback 加 deps 注入(getTransport/db)** — Found during: Task 3 | Issue: 计划未规定注入面,verify 无法 fake transport | Fix: ManifestWritebackDeps 可选参数(reviewBridge P1 同款),生产路径缺省行为不变 | Verification: S3b 5/5 | Commit: 见 manifestWriteback deps 提交
**[Rule 2 - 测试基建] S3c 子进程 emit 行转义层级修正** — Found during: Task 3 | Issue: python 注入的子进程源码 \t/\n 落成真 tab/换行 → 子进程语法错 | Fix: 该行双反斜杠转义;独立提取调试器复现验证 | Verification: 子进程 5/5 | Commit: 见 S3 提交

**Total deviations:** 2 auto-fixed。**Impact:** 无行为影响;deps 注入是净改善。

## Issues Encountered

None.

---

Ready for 53-05(墙接线:frameSlot 透传链/G13 首尾分选/串行下一镜/D-12 双轨废弃)。
