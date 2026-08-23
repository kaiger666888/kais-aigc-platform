---
phase: 60
slug: post-save-panel-persistence
status: draft
nyquist_compliant: false
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

- **After every task commit:** `npx tsc --noEmit` (root) + touched package `npx vitest run <file>`
- **After every plan wave:** `npm run verify:phase-60` + phase60 e2e (serve dist, not source)
- **Before `/gsd:verify-work`:** 全量 e2e（phase52 三件套 + phase59 全部 + phase60）+ probe-60-real (:10588 零足迹)
- **Max feedback latency:** ~30 seconds (quick loop)

---

## Per-Task Verification Map

> To be finalized by planner with concrete task IDs. Requirement→test mapping from RESEARCH.md:

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| {planner fills} | — | — | PANEL-01 self-save panel stays | savedBy-forgery / Informational | savedBy zod max64, echo-only | e2e | `npx playwright test test/e2e/tests/phase60-panel-persist.mjs -g "self-save"` | ❌ W0 | ⬜ pending |
| {planner fills} | — | — | PANEL-02 other-client reload re-anchor | — | N/A | e2e | `… -g "other-client"` | ❌ W0 | ⬜ pending |
| {planner fills} | — | — | D-03 anchor-miss honest collapse | — | N/A (negative) | e2e neg | `… -g "anchor-miss"` | ❌ W0 | ⬜ pending |
| {planner fills} | — | — | D-05 self-save silent (no toast) | — | N/A | e2e | `… -g "silent"` | ❌ W0 | ⬜ pending |
| {planner fills} | — | — | D-08 SC4 no-revival | — | N/A (negative) | e2e neg | `… -g "no-revival"` | ❌ W0 | ⬜ pending |
| {planner fills} | — | — | D-07 selected/detail symmetry | — | N/A | e2e + static | `… -g "symmetry"` + verify lock | ❌ W0 | ⬜ pending |
| {planner fills} | — | — | FLAG-1 baseline reset retained in skip branch | — | N/A | static lock | verify-phase-60 S-segment | ❌ W0 | ⬜ pending |
| {planner fills} | — | — | F-2 roundtrip id diff (diagnosis) | — | N/A | probe/dispatch | verify-phase-60 dispatch mode | ❌ W0 | ⬜ pending |
| {planner fills} | — | — | PANEL-01 real-machine | — | N/A | probe (zero-footprint) | probe-60-real.mjs | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠ flaky*

---

## Wave 0 Requirements

- [ ] `packages/infinite-canvas/test/e2e/tests/phase60-panel-persist.mjs` — 四用例骨架
- [ ] `scripts/verify-phase-60.ts` + package.json `verify:phase-60` — 聚合门骨架（静态锁/行为断言/forced-failure）
- [ ] mock save-v2 `savedBy` 透传 + `suppressGraphSaved` 移除（与实现任务同波）
- [ ] `packages/infinite-canvas/test/e2e/probe-60-real.mjs` — 零足迹探针骨架

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| 真机面板保持人工观感（panelWidth/tab/滚动连续性） | PANEL-01 | 内部态连续性需人眼判断 | :10588 面板编辑→保存→观察 |

*All other phase behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
