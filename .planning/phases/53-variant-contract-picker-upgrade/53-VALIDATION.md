---
phase: 53
slug: variant-contract-picker-upgrade
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-21
---

# Phase 53 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. **Scope: Wave A only (D-01)** — Wave B (khs field-map + E2E closure) gated on khs2 v2.4 Phase 25 acceptance; its validation contract is written into the Wave B plan, not this file.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest ^2.1.9 (packages/infinite-canvas, 包内 `npm test`);root 侧契约用 tsx verify 脚本范式(verify-phase-51 同款,node:assert + :memory: knex) |
| **Config file** | `packages/infinite-canvas/vitest.config.*`(既有);root 无 vitest — 契约测试走 verify 脚本 |
| **Quick run command** | `cd packages/infinite-canvas && npx vitest run src/components/variants` |
| **Full suite command** | `npm run verify:phase-53`(+ 包内 `npm test`);e2e 前须 `npm run build`(51-02 已记录前置) |
| **Estimated runtime** | ~180 seconds |

---

## Sampling Rate

- **After every task commit:** 包内 `npx vitest run <相关文件>`(<30s)
- **After every plan wave:** `npm run verify:phase-53` + 包内 `npm test` + 双根 tsc
- **Before `/gsd:verify-work`:** verify:phase-53 全绿 + forced-failure 自检(S5)行为正确
- **Max feedback latency:** 180 seconds

---

## Per-Task Verification Map

*(Plan/task IDs 前缀 53-NN;具体 task 编号由 PLAN.md 落定后回填核对)*

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 53-01-xx | 01 | 1 | VAR-01 | — | envelope 解析今日扁平形状 + Wave B 结构化形状,round-trip 字段不丢(score/prompt 摘要/seed/时长) | contract | `npx tsx scripts/verify-phase-53.ts`(S1) | ❌ W0 | ⬜ pending |
| 53-01-xx | 01 | 1 | VAR-01 | — | legacy 归一化(a-flf/c-* → 统一信封) | unit | vitest/verify-script envelope normalize | ❌ W0 | ⬜ pending |
| 53-02-xx | 02 | 1 | VAR-01/03 | — | 候选组推导幂等 + groupKey 词表与 Phase 48 一致(`shot:{sid}:first|last` / `name:{dir}/{base}`) | integration(:memory: knex) | verify-phase-53 S2 | ❌ W0 | ⬜ pending |
| 53-03-xx | 03 | 2 | VAR-02 | — | wallTransport 漂移校正(>120ms 硬 seek)/solo mute/timeline span 纯逻辑 | unit(fake video) | `npx vitest run src/components/variants/__tests__/wallTransport.test.ts` | ❌ W0 | ⬜ pending |
| 53-03-xx | 03 | 2 | VAR-02 | — | 键盘流映射(1-9 检视/Enter 选定/←→ 切镜/空格同播) | unit | vitest useWallKeyboard.test.ts | ❌ W0 | ⬜ pending |
| 53-03-xx | 03 | 2 | VAR-02 | — | 缩略图自愈三段(onError→POST /v2/thumbnail→占位),fetch mock;sourcePath 仅 /oss/ 形态 | unit | vitest wall thumbnail heal test | ❌ W0 | ⬜ pending |
| 53-03-xx | 03 | 2 | VAR-02/03 | — | 检视+显式选定(点卡=检视/solo;显式「选定」按钮才提交);G13 首尾分选两栏 | unit | 扩展 `src/store/__tests__/selectWinner.test.ts`(既有可扩) | ✅ 既有可扩 | ⬜ pending |
| 53-04-xx | 04 | 3 | VAR-03 | V5 | select-winner 扩展:frameSlot 透传、幂等分支不触发 hook、hook 失败不影响 200(best-effort 隔离) | integration(真模块 + mkdtemp DB) | verify-phase-53 S3 | ❌ W0 | ⬜ pending |
| 53-04-xx | 04 | 3 | VAR-03/D-10 | — | canvas_writeback_queue 入队/退避/重放/幂等(max_attempts + 指数退避 + drain 串行) | integration | verify-phase-53 S3 | ❌ W0 | ⬜ pending |
| 53-05-xx | 05 | 3 | VAR-04 | V4/V5 | G15 桥 waive/requeue payload 形状 + 吞错 + 409 语义;shotIds bounded ≤200 + action enum | unit(注入 fetch) | vitest g15Bridge.test.ts | ❌ W0 | ⬜ pending |
| 53-05-xx | 05 | 3 | VAR-04 | — | 分诊面板勾选/动作条/二次确认状态机 | unit | vitest G15TriagePanel.test.tsx | ❌ W0 | ⬜ pending |
| 全体 | — | — | 全体 | — | forced-failure 自检(gate 能失败) | contract | verify-phase-53 S5 | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `scripts/verify-phase-53.ts` — S1..S5 骨架 + npm script 注册(package.json scripts,41 行后)
- [ ] root 契约测试位约定(root 无 vitest — 契约测试放 verify 脚本,node:assert,verify-phase-51 同款)
- [ ] 包内 `src/components/variants/__tests__/` 目录(store/__tests__ 先例)
- [ ] fixture 文件:两代 candidate 样本(今日 a-flf/c-* data 快照 + Wave B 信封样本)+ take-log/failed-shots 样本

*(e2e:墙为全屏 overlay,detail-panel phase35 契约不回归即可;墙自身 e2e 可选,组件单测优先 — 93 镜真机验收属 HUMAN-UAT。)*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| 同播走带观感(跨变体 playhead 对齐、solo 切换听感) | VAR-02 | 音画主观体验 | 打开变体墙→同播→切 solo→确认无回声/漂移感 |
| 93 镜键盘审片流(1-9/Enter/→ 连续操作手感) | VAR-02/D-20 | 键盘连续操作手感 | 键盘完成 3 个变体组的检视+选定+下一镜 |
| G15 批量重渲二次确认(贵操作防误触体验) | VAR-04/D-14 | 破坏性操作主观确认 | 勾选多条→批量重渲→确认弹层文案与计数 |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 180s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
