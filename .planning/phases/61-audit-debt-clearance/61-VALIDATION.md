---
phase: 61
slug: audit-debt-clearance
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-24
---

# Phase 61 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Source: 61-RESEARCH.md §Validation Architecture (all four debts line-pinned; DEBT-04 Branch A pre-verdicted).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 2.1.9 双包 · Playwright 1.61 e2e · tsx 聚合门（新 verify-phase-61.ts） |
| **Config file** | vitest built-in · playwright.config.mjs (mock :9876, workers=1) |
| **Quick run command** | `npx tsc --noEmit` (root) + touched package vitest |
| **Full suite command** | `npm run verify:phase-61` + `cd packages/infinite-canvas && npm run build && npx playwright test test/e2e/tests/phase61-debt.mjs` |
| **Estimated runtime** | ~90 seconds |

---

## Sampling Rate

- **After every task commit:** `npx tsc --noEmit` + touched vitest
- **After every plan wave:** `npm run verify:phase-61` + phase61 e2e (serve dist)
- **Before `/gsd:verify-work`:** 全量 e2e（52 三件套 + 59 + 60 + 61）+ phase55-nav standalone（DEBT-01 共享放置面）
- **Max feedback latency:** ~30 seconds

---

## Per-Task Verification Map

> To be finalized by planner with concrete task IDs:

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| {planner fills} | — | — | DEBT-01 资产中心拖入 source 锚活路径 + 有界落点 | — | N/A | e2e | `npx playwright test test/e2e/tests/phase61-debt.mjs -g "drag-in"` | ❌ W0 | ⬜ pending |
| {planner fills} | — | — | DEBT-01 stub 处置 (placeAssetOnCanvas 退役/接活) | — | N/A | static + e2e | verify 静态锁 + `… -g "add-to-canvas"` | ❌ W0 | ⬜ pending |
| {planner fills} | — | — | DEBT-02 尾斜杠 307 消除 | — | N/A | unit + static | vitest (注入 fetchImpl 断言 URL 尾斜杠) + verify grep | ❌ W0 | ⬜ pending |
| {planner fills} | — | — | DEBT-03 buildMeta 5 字段往返保真 | — | N/A | unit roundtrip | `cd packages/flowgraph-v3 && npx vitest run` (rawDataByNodeId=null 断言) | ❌ W0 | ⬜ pending |
| {planner fills} | — | — | DEBT-04 Branch A 裁定成文 + 守护锁 | — | N/A | static | verify grep (addNodeFromSocket in onNewAsset / 无 setNodes 直写) + verdict doc | ❌ W0 | ⬜ pending |
| {planner fills} | — | — | 回归面 (52/59/60 + 55 standalone) | — | N/A | e2e 全量 | `npx playwright test phase52-* phase59-* phase60-*` + `phase55-nav.mjs` | ✅ 既有 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠ flaky*

---

## Wave 0 Requirements

- [ ] `packages/infinite-canvas/test/e2e/tests/phase61-debt.mjs` — drag-in/add-to-canvas 用例骨架
- [ ] `scripts/verify-phase-61.ts` + package.json `verify:phase-61` — 聚合门（静态锁/unit 调度/forced-failure）
- [ ] mock-backend 两条新路由：`POST /api/canvas/v2/nodes/`（zod position + node:created 回放）+ `/v1/assets-registry/search`
- [ ] flowgraph-v3 buildMeta roundtrip 测试挂点（tests/ 既有文件扩充或新文件）

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| 资产中心拖入的真实手感（拖拽连续性） | DEBT-01 | 拖拽交互观感需人眼 | :10588 资产中心拖资产入画布,观察落位 |

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
