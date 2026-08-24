---
phase: 61
slug: audit-debt-clearance
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-08-24
---

# Phase 61 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Source: 61-RESEARCH.md §Validation Architecture (all four debts line-pinned; DEBT-04 Branch A pre-verdicted).

---

## Test Infrastructure

| Property | Value |
|-------|-------|
| **Framework** | vitest 2.1.9 双包 · Playwright e2e · node:test+tsx(根仓,61-02 勘正:根仓无 vitest)· tsx 聚合门(新 verify-phase-61.ts) |
| **Config file** | vitest built-in · playwright.config.mjs (mock :9876, workers=1) |
| **Quick run command** | `npx tsc --noEmit` (root) + touched package vitest / `node --import tsx --test`(根仓) |
| **Full suite command** | `npm run verify:phase-61` + `cd packages/infinite-canvas && npm run build && npx playwright test test/e2e/tests/phase61-debt.mjs` |
| **Estimated runtime** | ~90 seconds |

---

## Sampling Rate

- After every task commit: `npx tsc --noEmit` + touched vitest / node:test
- After every plan wave: `npm run verify:phase-61` + phase61 e2e (serve dist)
- Before `/gsd:verify-work`: 全量 e2e(52 三件套 + 59 + 60 + 61)+ phase55-nav standalone(DEBT-01 共享放置面)
- Max feedback latency: ~30 seconds

---

## Per-Task Verification Map

> Planner-finalized (2026-08-24). Task IDs reference `61-{plan}-PLAN.md` Task N.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 61-01 T1 | 61-01 | 1 | DEBT-01 mock 通道 + e2e 骨架(Wave 0) | T-61-01 | N/A | syntax+grep 门 | `node --check server.mjs && node --check phase61-debt.mjs && grep -c 路由锚` | ❌ W0→T1 建 | ✅ green |
| 61-01 T2 | 61-01 | 1 | DEBT-01 拖入接线 + stub 处置(placeAssetOnCanvas 退役/接活) | T-61-01..04 | zod 门不绕过 | build+unit+负 grep | `npm run build && npx vitest run src/components/__tests__/placeNewAsset.test.ts && grep 退役三 token 零命中` | ✅ 既有(8 用例) | ✅ green |
| 61-01 T3 | 61-01 | 1 | DEBT-01 拖入 source 锚活路径 + 有界落点 + 409 | T-61-01 | N/A | e2e | `npm run build && npx playwright test test/e2e/tests/phase61-debt.mjs && npx playwright test test/e2e/tests/phase55-nav.mjs` | ❌ W0→T1 建 | ✅ green |
| 61-02 T1 | 61-02 | 1 | DEBT-02 尾斜杠一字修 + 契约注释 | T-61-05 | N/A | grep+tsc | `grep -c 'reviews/?' && ! grep -Eq 'reviews\?' && npx tsc --noEmit` | ✅ 目标文件在 | ✅ green |
| 61-02 T2 | 61-02 | 1 | DEBT-02 回归锁(删斜杠必红) | T-61-07 | N/A | node:test unit | `node --import tsx --test src/lib/__tests__/reviewBridge.test.ts`(注入 fetchImpl 断言 URL 尾斜杠,字面量正反双断言) | ❌ W0→T2 建 | ✅ green |
| 61-03 T1 | 61-03 | 1 | DEBT-03 buildMeta 5 字段读回 + migrate 单测 | T-61-08 | zod strict 回归网 | unit | `cd packages/flowgraph-v3 && npm test && npm run typecheck && grep -c 五句式` | ✅ 测试文件在,用例 ❌ W0 | ✅ green |
| 61-03 T2 | 61-03 | 1 | DEBT-03 往返保真(raw=null 档)+ 三面收口 | T-61-08/09 | N/A | unit roundtrip | `cd packages/infinite-canvas && npx vitest run src/v3/__tests__/serialize.test.ts && npm test && cd ../flowgraph-v3 && npm test && cd .. && npx tsc --noEmit` | ✅ 测试文件在,用例 ❌ W0 | ✅ green |
| 61-04 T1 | 61-04 | 1 | DEBT-04 Branch A 裁定成文(证据链/I5 原文/锁规格) | T-61-10 | N/A | doc+grep | `test -f 61-DEBT-04-VERDICT.md && grep -c 锚 && 引文核对` | ❌ W0→T1 建 | ✅ green |
| 61-05 T1 | 61-05 | 2 | 四债静态锁聚合(S-DEBT1..4)+ 行为门 + forced-failure | T-61-11..13 | 命令字面量·无注入 | verify 门 | `npm run verify:phase-61` | ❌ W0→T1 建 | ✅ green |
| 61-05 T2 | 61-05 | 2 | D-04 销账(REQUIREMENTS 勾选 + Traceability) | — | N/A | 门两连绿+grep | `npm run verify:phase-61 && grep -c "[x] **DEBT-0" REQUIREMENTS.md` | ✅ 目标文件在 | ✅ green |
| verify-work 前 | — | — | 回归面 (52/59/60 + 55 standalone) | — | N/A | e2e 全量 | `npx playwright test phase52-* phase59-* phase60-* phase61-debt.mjs` + `phase55-nav.mjs` | ✅ 既有 | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠ flaky*

---

## Wave 0 Requirements

- [x] `packages/infinite-canvas/test/e2e/tests/phase61-debt.mjs` — 归 61-01 Task 1(骨架)/Task 3(用例体)
- [x] `scripts/verify-phase-61.ts` + package.json `verify:phase-61` — 归 61-05 Task 1(wave 2 收口,依赖 61-01..04 落地)
- [x] mock-backend 两条新路由(`POST /api/canvas/v2/nodes/` zod-lite + node:created 回放、`/v1/assets-registry/search` fixture)— 归 61-01 Task 1
- [x] `src/lib/__tests__/reviewBridge.test.ts` — 归 61-02 Task 2(node:test 形态,根仓无 vitest——planner 勘正)
- [x] flowgraph-v3 buildMeta roundtrip 测试挂点 — 归 61-03 Task 1(migrate.test.ts 扩用例)+ Task 2(serialize.test.ts 往返)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| 资产中心拖入的真实手感(跨视图拖拽连续性) | DEBT-01 | Chromium 拖拽会话跨源元素卸载存活是机制前提,合成事件不覆盖真实浏览器行为 | :10588 资产中心拖资产卡→「画布」页签→画布面板松手,观察落位与拖拽连续性 |

*All other phase behaviors have automated verification.*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies (planner pass 2026-08-24)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify (planner pass)
- [x] Wave 0 covers all MISSING references (each ❌ mapped to owning task above)
- [x] No watch-mode flags
- [x] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter (executor flips after wave 0 artifacts land)

**Approval:** pending
