---
phase: 58
slug: full-recipe-persistence
status: draft
nyquist_compliant: true
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
| 58-01-T1（recipe.ts 契约 + migrate 全集提取） | 01 | 1 | RECIPE-01/03 | — | N/A | unit | flowgraph-v3 `npx vitest run tests/migrate.test.ts && npx tsc --noEmit` | ⬜ 扩展既有 | ⬜ pending |
| 58-01-T2（serialize 拓宽 + delete 传播 + 51 注解） | 01 | 1 | RECIPE-01/03 | T-58-01/02 | N/A | unit | `npx vitest run src/v3/__tests__/serialize.test.ts && npx tsc -b` + root `npm run verify:phase-51` | ⬜ 扩展既有 | ⬜ pending |
| 58-02-T1（PromptSection 高级参数编辑器） | 02 | 2 | RECIPE-01/03 | T-58-02/03 | number 边界 min/max/step；catchall 只读 | tsc+vitest（e2e 断言在 03） | `npx tsc -b && npx vitest run`（406 基线） | ✅（面板文件在，控件新增） | ⬜ pending |
| 58-02-T2（popover 换源 + canvasAssetSchema 五类型声明） | 02 | 2 | RECIPE-04 断言侧 | T-58-01 | lora 形状 {name,strength}[] 在场强制 | tsc | root `npx tsc --noEmit` + `npx tsc -b` | ✅（schema 文件在，声明新增） | ⬜ pending |
| 58-03-T1（fixture 注入 + 编辑往返用例组） | 03 | 3 | RECIPE-01/03 | — | N/A | e2e | `npm run build && npx playwright test phase58-recipe` | ❌ W0（本 task 建） | ⬜ pending |
| 58-03-T2（请求体整袋 + 清空 delete + 落选只读 + 全量回归） | 03 | 3 | RECIPE-02 | — | N/A | e2e mock | `npm run build && npm run test:e2e`（≥62+新增） | ❌ W0（本 task 建） | ⬜ pending |
| 58-04-T1（verify-phase-58 聚合门 + 注册） | 04 | 3 | RECIPE-04 | — | N/A | verify | `npm run verify:phase-58`（三方集合相等 + nullish 计数锁 + forced-failure 自检） | ❌ W0（本 task 建） | ⬜ pending |
| 58-04-T2（probe-58-real 真机零足迹） | 04 | 3 | RECIPE-01 | T-58-04/05 | 捕获-恢复零足迹 | manual probe | `node test/e2e/probe-58-real.mjs`（须先 deploy） | ❌ W0（本 task 建） | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements（planner 已映射到 plan task，执行期创建）

- [ ] `packages/infinite-canvas/test/e2e/tests/phase58-recipe.mjs` — RECIPE-01/02/03 → 58-03-T1/T2（须先经 save-v2 注入带高级字段的 fixture，RESEARCH Pitfall 6）
- [ ] `scripts/verify-phase-58.ts` + package.json `verify:phase-58` 注册 — RECIPE-04 → 58-04-T1
- [ ] `packages/infinite-canvas/test/e2e/probe-58-real.mjs` — 真机零足迹探针（复用 probe-52-real Part B 模式）→ 58-04-T2
- [ ] serialize.test.ts 新增 describe（Phase 58: 全配方反向覆盖 + delete 传播）→ 58-01-T2 / migrate.test.ts 新增提取全集用例 → 58-01-T1（框架在，用例缺）

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
