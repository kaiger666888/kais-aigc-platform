---
phase: 58
slug: full-recipe-persistence
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-23
---

# Phase 58 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Source: 58-RESEARCH.md §Validation Architecture (researcher 2026-08-23, 高置信)。

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest ^2.1.9（infinite-canvas + flowgraph-v3 双包）+ Playwright（e2e） |
| **Config file** | packages/infinite-canvas/vite.config.ts (test 段) / packages/flowgraph-v3/ts vitest 默认 / playwright.config.mjs |
| **Quick run command** | `cd packages/infinite-canvas && npx vitest run src/v3`（~4s；flowgraph-v3 `npx vitest run` 515ms） |
| **Full suite command** | 双包 vitest + `cd packages/infinite-canvas && npm run build && npm run test:e2e`（62 基线） |
| **Estimated runtime** | quick ~10s 双包 / full ~3-5min（含 build + 62 e2e） |

---

## Sampling Rate

- **After every task commit:** 双包 vitest（<10s）+ 受触包 `npx tsc --noEmit`
- **After every plan wave:** `npm run verify:phase-58`（含三根 tsc + 双包 vitest 命令门）
- **Before `/gsd:verify-work`:** verify:phase-58 绿 + e2e 全量 ≥62+新增 绿（先 `npm run build`）+ build:server → deploy-canvas.sh → probe-58-real 零足迹通过
- **Max feedback latency:** 10 秒（quick）/ 5 分钟（wave 级）

---

## Per-Task Verification Map

> Task ID 由 planner 填入；Test Type / Command 映射自 RESEARCH §Phase Requirements → Test Map。

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 58-XX-XX（serialize+migrate 同 plan 落地） | 01 | 1 | RECIPE-01/03 | — | N/A | unit | `npx vitest run src/v3/__tests__/serialize.test.ts` + flowgraph-v3 `npx vitest run tests/migrate.test.ts` | ⬜ 扩展既有 | ⬜ pending |
| 58-XX-XX（面板编辑器） | 02 | 1 | RECIPE-01/03 | T-58-02 | number input 有限值；lora 形状 {name,strength}[] | e2e+unit | `npx playwright test phase58-recipe` | ❌ W0 | ⬜ pending |
| 58-XX-XX（e2e 断言） | 02 | 2 | RECIPE-02 | — | N/A | e2e mock | `npx playwright test phase58-recipe`（getCalls 请求体断言） | ❌ W0 | ⬜ pending |
| 58-XX-XX（verify 聚合门） | 03 | 2 | RECIPE-04 | — | N/A | verify | `npm run verify:phase-58`（三方集合相等 + nullish 计数锁 + forced-failure 自检） | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/infinite-canvas/test/e2e/tests/phase58-recipe.mjs` — RECIPE-01/02/03（须先经 save-v2 注入带高级字段的 fixture，RESEARCH Pitfall 6）
- [ ] `scripts/verify-phase-58.ts` + package.json `verify:phase-58` 注册 — RECIPE-04
- [ ] `packages/infinite-canvas/test/e2e/probe-58-real.mjs` — 真机零足迹探针（复用 probe-52-real Part B 模式）
- [ ] serialize.test.ts 新增 describe（Phase 58: 全配方反向覆盖 + delete 传播）/ migrate.test.ts 新增提取全集用例 — 框架在，用例缺

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| 真机改 steps+cfg → 保存 → 重载 → 恢复 | RECIPE-01 | 需生产 :10588 + 真 DB 往返 | `node test/e2e/probe-58-real.mjs`（须先 deploy-canvas.sh；零足迹=结束恢复原值） |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s (quick)
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
