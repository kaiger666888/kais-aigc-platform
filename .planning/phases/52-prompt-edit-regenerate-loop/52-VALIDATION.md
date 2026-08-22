---
phase: 52
slug: prompt-edit-regenerate-loop
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-08-21
---

# Phase 52 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (packages/infinite-canvas + packages/flowgraph-v3/ts) + e2e (node:test, dist-based) + tsx verify 脚本 |
| **Config file** | `packages/infinite-canvas/vite.config.ts` |
| **Quick run command** | `cd packages/infinite-canvas && npm test` |
| **Full suite command** | `cd packages/infinite-canvas && npm run build && npm test && npm run test:e2e && cd ../flowgraph-v3/ts && npm test && npx tsc --noEmit && npx tsx scripts/verify-phase-52.ts` |
| **Estimated runtime** | ~180 seconds(e2e 需先 build,51-02 已记录该前置) |

---

## Sampling Rate

- **After every task commit:** Run `cd packages/infinite-canvas && npm test`
- **After every plan wave:** Run 双根 tsc + 双包 vitest
- **Before `/gsd:verify-work`:** Full suite must be green(含 verify-phase-52)
- **Max feedback latency:** 180 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 52-01 | 01 | 1 | REGEN-01 | — | updateEventParams/persistEventParams + applySocketNodeState stale 清除 + getDownstreamIds | unit | canonicalWriteback.test 5 组 + stale.test(flowgraph-v3 130/130) | ✅ | ✅ green |
| 52-02 | 02 | 1 | REGEN-03 | — | stale wire 化(data.stale 序列化+migrate restoreStaleInfo 还原)+ execute extra 契约 | unit | serialize.test + migrate.test stale 三用例 + mock logCall 镜像 | ✅ | ✅ green |
| 52-03 | 03 | 2 | REGEN-01 | — | PromptSection 保存→重生成,任务参数含新 prompt | unit+e2e | phase52-regen a/b/c(mock logCall 完整 body) | ✅ | ✅ green(52-08 装置对齐后) |
| 52-04 | 04 | 2 | REGEN-02 | — | 换 seed 提交同配方+新 seed,pending 反馈+canonical 回写 | unit+e2e | phase52-reroll a/b | ✅ | ✅ green |
| 52-05 | 05 | 3 | REGEN-03/04 | — | stale 重跑链双出口 + 面板 480 + 单击跟随 | unit+e2e | phase52-stale-panel 四用例 + adapter/scorePopover 单测 | ✅ | ✅ green |
| 52-07 | 07 | 3(gap) | REGEN-01 | — | save-v2 存量宽容 + 真机闭环 | 离线锁+真机探针 | verify:save-v2-legacy 17 断言 + probe-52-real 两段式 | ✅ | ✅ green |
| 52-08 | 08 | 4(gap) | REGEN-01 | — | 落选详情入口 + e2e 装置对齐 | unit+e2e | adapter.test +3 + phase52-regen 3/3 | ✅ | ✅ green |
| 52-06 | 06 | 5 | REGEN-01..04 | — | 聚合门 S1-S5 + forced-failure | gate | npm run verify:phase-52(31 断言) | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `scripts/verify-phase-52.ts` — 聚合门(S1-S5 grep/source-shape + 命令门 + forced-failure,verify-phase-51 范式)
- [x] vitest 新增:updateEventParams(canonicalWriteback 5 组)、事件配方序列化反向覆盖、stale wire round-trip(migrate 3 用例)、getDownstreamIds、orchestrate stale 包含(mock 镜像谓词)、applySocketNodeState stale 清除
- [x] e2e mock-backend:logCall 记完整 body(52-02);stale 镜像(52-02)
- [x] (超出 W0 预判)migrate Pass 3 变体组防御回归 ×2(52-07 真机地雷)、syntheticDetailNode ×3(52-08)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| 审片场景面板开合体验(480px 视觉、单击跟随流畅度) | REGEN-04 | UI 主观体验 | 打开面板→单击多个节点→确认不反复开合 |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 180s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-08-22(全 8 plan SUMMARY + verify:phase-52 31/31;e2e/真机结果见 52-VERIFICATION.md)
