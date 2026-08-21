---
phase: 55
slug: navigation-scale
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-21
---

# Phase 55 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 2.1.9 (unit) + @playwright/test 1.61 (e2e) + root-repo `verify-phase-*.ts` contract scripts (npx tsx) |
| **Config file** | `packages/infinite-canvas/vite.config.ts` (vitest, jsdom); `packages/infinite-canvas/playwright.config.mjs` (baseURL localhost:9876, workers 1) |
| **Quick run command** | `cd packages/infinite-canvas && npx vitest run src/components/__tests__` |
| **Full suite command** | `cd packages/infinite-canvas && npm test && npm run test:e2e` |
| **Estimated runtime** | ~60s unit / ~3min with e2e smoke |

---

## Sampling Rate

- **After every task commit:** `cd packages/infinite-canvas && npx vitest run <touched dirs> && npx tsc -b --pretty`
- **After every plan wave:** `cd packages/infinite-canvas && npm test` + `npx tsx scripts/verify-phase-55.ts`
- **Before `/gsd:verify-work`:** Full vitest green + verify-phase-55 contract green + playwright smoke (search jump / placement / lane focus)
- **Max feedback latency:** ~90 seconds

---

## Per-Task Verification Map

> Task IDs finalized by planner; rows below are the requirement-level contract the plans must honor (from 55-RESEARCH.md Validation Architecture).

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD (NAV-01 mirror) | TBD | W0 | NAV-01 | T-55-01 | contract test reads khs file read-only via TS regex parse, no code exec; path overridable via `KAIS_HERMES_SKILLS_PATH` | contract | `npx tsx scripts/verify-phase-55.ts` | ❌ W0 | ⬜ pending |
| TBD (NAV-01 fallback) | TBD | W0 | NAV-01 | T-55-02 | unknown phaseIndex → fallback zone entry + console.warn, never throws; zod `Number.isFinite` guard upstream | unit | `npx vitest run src/components/pipeline` | ❌ W0 | ⬜ pending |
| TBD (NAV-01 import assert) | TBD | W1+ | NAV-01 | — | full-episode import fixture leaves unmapped zone empty | integration | `npx vitest run src/v3/__tests__/adapter.test.ts -t phase` | 部分 (assertion added) | ⬜ pending |
| TBD (NAV-02 derive) | TBD | W1+ | NAV-02 | — | scene grouping + shot-card field derivation (shot_id/景别/运镜/时长/video_prompt) | unit | `npx vitest run src/components/__tests__/StoryboardTimeline.shotKey.test.ts` | 部分 (assertion added) | ⬜ pending |
| TBD (NAV-03 navigator) | TBD | W1+ | NAV-03 | V5 marginal | search input client-side only (no injection surface); `/` listener ignores focused text inputs | unit + e2e | `npx vitest run src/components/__tests__/searchNavigator.test.ts` / `npm run test:e2e -- phase55` | ❌ W0 | ⬜ pending |
| TBD (NAV-04 placement) | TBD | W1+ | NAV-04 | — | new node coords bounded within R of viewport center OR source node (pure fn `placeNewAsset`) | unit | `npx vitest run src/components/__tests__/placeNewAsset.test.ts` | ❌ W0 | ⬜ pending |
| TBD (NAV-05 lane memory) | TBD | W1+ | NAV-05 | — | lane zoom memory persist/restore; LOD thresholds (L0<0.22/L1 0.22–0.6/L2≥0.6) + hysteresis 0.03 + FITVIEW_MIN_ZOOM=0.4 regression guard | unit | `npx vitest run src/hooks/__tests__/canvasState.test.ts` + existing useLod assertions | 部分 (assertion added) | ⬜ pending |
| TBD (NAV-06 branch REST) | TBD | W1+ | NAV-06 | — | selectBranchAsMain → PATCH via existing `canvasApi.updateBranch` + optimistic rollback on error | unit | `npx vitest run src/store/__tests__/` | 部分 (case added) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `scripts/verify-phase-55.ts` — NAV-01 contract (mirror of verify-schema-drift.ts pattern + verify harness): kap 22-phase registry ≡ khs `_PHASE_INDEX_MAP` + `ZONE_PHASES` grouping/order
- [ ] `src/components/pipeline/__tests__/phaseRegistry.test.ts` (or co-located) — 22-entry completeness + fallback zone + PHASE_GROUPS coverage (incl. p11a0 → P11a sub=true fold)
- [ ] `src/components/__tests__/placeNewAsset.test.ts` — NAV-04 bounded-placement pure function
- [ ] `src/components/__tests__/searchNavigator.test.ts` — NAV-03 result derivation grouped by scene
- [ ] e2e `test/e2e/tests/phase55-nav.mjs` — `/` open → result click → focus jump → placement → lane focus smoke (probe template `canvas-real-screenshot.mjs`; `window.__kaisCanvas` store bridge exists)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| fitView 后 keyFields 默认可读（或泳道记忆生效） | NAV-05 | 视觉可读性判断 + 需真实超大图 | 打开 93 镜规模图 → fitView → 确认非全 LOD0 色块（八月盲区不回归）；点击泳道列头 → 确认 zoom 恢复到 L2 可读档 |
| 生产库全量 episode 导入后未映射区为空（A1：dev db2 无 post-W6 图） | NAV-01 | 真实数据在生产库/运行服务 | 从生产导出全量 episode 数据导入 → zone 面板确认「未映射」区为空；console 无 fallback warn |
| 多结局探索交互手感（预览 vs 切主线） | NAV-06 | UX 判定 | BranchPanel 切换分支 → 主线变化 + 刷新后持久；预览不落库 |
| 93 镜规模交互性能（缩放/平移不劣化） | NAV-05 | 主观流畅度 + 需真实规模 | 93 镜图上缩放平移，对比 Phase-54 基线手感（memory: 卡顿 ∝ 总节点数，①已修，勿引入逐帧×N 回归） |

*Automated coverage exists for all derivable logic above; these rows are the human/UAT complement.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 90s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
