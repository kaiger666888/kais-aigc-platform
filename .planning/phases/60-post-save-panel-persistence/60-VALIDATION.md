---
phase: 60
slug: post-save-panel-persistence
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-08-24
---

# Phase 60 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Source: 60-RESEARCH.md §Validation Architecture (chain anatomy line-verified; collapse root-cause pending Wave-1 diagnosis).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 2.1.9 (双包) · Playwright 1.61 (e2e) · tsx aggregate gate (root, new verify-phase-60.ts) |
| **Config file** | vitest built-in per package · playwright.config.mjs (mock-backend :9876, workers=1) |
| **Quick run command** | `npx tsc --noEmit` (root) + touched package `npx vitest run <narrowest relevant file>` |
| **Full suite command** | `npm run verify:phase-60` + `cd packages/infinite-canvas && npm run build && npx playwright test test/e2e/tests/phase60-panel-persist.mjs` |
| **Estimated runtime** | ~90 seconds |

---

## Sampling Rate

- After every task commit: `npx tsc --noEmit` (root) + touched package `npx vitest run <file>`
- After every plan wave: `npm run verify:phase-60` + phase60 e2e (serve dist, not source)
- Before `/gsd:verify-work`: 全量 e2e（phase52 三件套 + phase59 全部 + phase60）+ probe-60-real (:10588 零足迹)
- Max feedback latency: ~30 seconds (quick loop)

---

## Per-Task Verification Map

> Finalized by planner (60-PLAN set, 2026-08-24). Requirement→test mapping from RESEARCH.md.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 60-01-T1 | 60-01 | 1 | PANEL-02 id 前提 (roundtrip 诊断) | T-60-01a 捕获-恢复 | 零足迹恢复 deep-equal | dispatch harness | `npx tsx scripts/diagnose-60-roundtrip.ts --strict` | ❌ 本任务创建 | ⬜ pending |
| 60-01-T2 | 60-01 | 1 | PANEL-02 store 重锚 survive/collapse | — | N/A | vitest | `npx vitest run src/store/__tests__/reloadAnchor.test.ts` | ❌ 本任务创建 | ⬜ pending |
| 60-02-T1 | 60-02 | 1 | PANEL-01 契约面 (savedBy zod+broadcast) | T-60-02 savedBy 伪造/Informational | zod max64 echo-only | static + tsc | `npx tsc --noEmit && node --check …/server.mjs` + grep savedBy | ✅ 改既有 | ⬜ pending |
| 60-02-T2 | 60-02 | 1 | PANEL-01 self-save skip + D-05 silent + FLAG-1/FLAG-4 | T-60-02 | 客户端判定, mock 回声活性保留 | e2e (59 SC4 自然通过) | `npx playwright test test/e2e/tests/phase59-stale-cascade.mjs -g "SC4"` | ✅ 改既有 | ⬜ pending |
| 60-03-T1 | 60-03 | 2 | D-03 anchor-miss honest collapse + D-07 对称 | T-60-05 warn 防刷屏 | 转移守卫 warn 一次 | vitest | `npx vitest run src/store/__tests__/reloadAnchor.test.ts` (7 case) | ✅ 60-01 创建/本任务扩充 | ⬜ pending |
| 60-03-T2 | 60-03 | 2 | PANEL-02 修复分支 (A 锁/B 定层修) | T-60-04 wire 契约不扩散 | id 稳定性 only, 字段集不变 | dispatch + vitest | `npx tsx scripts/diagnose-60-roundtrip.ts --strict` + vitest roundtrip 锁 | ✅ 60-01 创建 | ⬜ pending |
| 60-04-T1 | 60-04 | 3 | PANEL-01 self-save | T-60-02 (savedBy 上 wire 证据) | body.savedBy /^tab_/ | e2e | `npx playwright test test/e2e/tests/phase60-panel-persist.mjs -g "self-save"` (含 "silent") | ❌ 本任务创建 | ⬜ pending |
| 60-04-T1 | 60-04 | 3 | PANEL-02 other-client re-anchor | — | N/A | e2e | `… -g "other-client"` (含 "symmetry") | ❌ 本任务创建 | ⬜ pending |
| 60-04-T1 | 60-04 | 3 | D-03 anchor-miss | — | N/A (negative) | e2e neg | `… -g "anchor-miss"` | ❌ 本任务创建 | ⬜ pending |
| 60-04-T1 | 60-04 | 3 | D-08 SC4 no-revival | — | N/A (negative) | e2e neg (采样窗) | `… -g "no-revival"` | ❌ 本任务创建 | ⬜ pending |
| 60-04-T2 | 60-04 | 3 | D-12 回归面 (52 三件套+59 全部) | — | N/A | e2e 全量 | `npx playwright test phase52-regen phase52-reroll phase52-stale-panel phase59-stale-cascade phase60-panel-persist` | ✅ 既有+新建 | ⬜ pending |
| 60-05-T1 | 60-05 | 4 | D-11 聚合门 (FLAG-1/2/4 + D-01/D-03 链) | T-60-09 锁恒真假绿 | forced-failure 自检 | tsx gate | `npm run verify:phase-60` | ❌ 本任务创建 | ⬜ pending |
| 60-05-T2 | 60-05 | 4 | PANEL-01 真机 + savedBy 真机契约 (D-10) | T-60-08 生产写恢复 | 零足迹恢复 deep-equal | probe (零足迹) | `node test/e2e/probe-60-real.mjs` (:10588) | ❌ 本任务创建 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠ flaky*

---

## Wave 0 Requirements

所有 Wave 0 缺口由 60-PLAN 集内的任务自带创建(Nyquist: 每任务的 automated verify 或任务内先建验证物,无任务依赖更晚 wave 的文件):

- [x] `packages/infinite-canvas/test/e2e/tests/phase60-panel-persist.mjs` — 由 60-04-T1 创建并同任务运行
- [x] `scripts/verify-phase-60.ts` + package.json `verify:phase-60` — 由 60-05-T1 创建并同任务运行
- [x] mock save-v2 `savedBy` 透传 — 60-02-T1;`suppressGraphSaved` 移除 — 60-02-T2(与客户端跳过同 commit,保每步绿)
- [x] `packages/infinite-canvas/test/e2e/probe-60-real.mjs` — 由 60-05-T2 创建并同任务运行

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| 真机面板保持人工观感（panelWidth/滚动连续性） | PANEL-01 | 内部态连续性需人眼判断 | :10588 面板编辑→保存→观察 |

*All other phase behaviors have automated verification.*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies (in-plan creation)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify (every task has one)
- [x] Wave 0 covers all MISSING references (mapped to creating tasks above)
- [x] No watch-mode flags
- [x] Feedback latency < 30s (quick loop: tsc + narrowest vitest)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending (execute-phase 开始前)
