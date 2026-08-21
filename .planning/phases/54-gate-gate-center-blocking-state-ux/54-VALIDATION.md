---
phase: 54
slug: gate-gate-center-blocking-state-ux
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-21
---

# Phase 54 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. **三仓生效**:kap(vitest + verify 脚本)、khs(pytest, plugins/review_gates)、review-platform(pytest, tests/integration)。**硬前置:REVIEW_PLATFORM_URL env 修复**(RESEARCH §I.2——生产默认 URL 不可达,Phase 49 bridge 从未生效;S-live 与 gate-ops 活体验收都依赖它)。

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest ^2.1.9 (packages/infinite-canvas, 包内 `npm test`);kap 契约/集成 = tsx verify 脚本范式(`scripts/verify-phase-54.ts`, node:assert, verify-phase-51/53 同款);khs = pytest 3.12.3(`plugins/review_gates/tests`、`plugins/kais_aigc/tests` 既有);review-platform = pytest(`tests/integration`、`tests/e2e` 既有) |
| **Config file** | `packages/infinite-canvas/vitest.config.*`(既有);root 无 vitest — 契约测试走 verify 脚本;khs/平台仓 pytest 既有配置 |
| **Quick run command** | `cd packages/infinite-canvas && npm test` + `npx tsc --noEmit`(<30s);涉 khs 文件加 `python3 -m pytest plugins/review_gates/tests -k <相关>` |
| **Full suite command** | `npm run verify:phase-54`(全 S 节)+ 包内 `npm test` + khs 两 plugin 目录 pytest |
| **Estimated runtime** | ~180 seconds |

---

## Sampling Rate

- **After every task commit:** 包内 `npm test`(或相关文件 `npx vitest run <file>`)+ `npx tsc --noEmit`;涉 khs/平台文件的 task 加对应 pytest 子集
- **After every plan wave:** `npm run verify:phase-54` + khs `python3 -m pytest plugins/review_gates/tests plugins/kais_aigc/tests`
- **Before `/gsd:verify-work`:** verify:phase-54 全绿 + 活体 SC1 smoke(S-live,需 env 已修)绿 + SC3 全链手工签收(HUMAN-UAT)
- **Max feedback latency:** 180 seconds

---

## Per-Task Verification Map

*(Plan/task IDs 前缀 54-NN;具体 task 编号由 PLAN.md 落定后回填核对)*

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 54-NN-xx | — | — | SC1/GATE-01 | — | gates.yaml 快照 ↔ khs 现值零漂移(js-yaml 逐字段 diff + derive 规则 round-trip + 16 门计数) | contract | `npx tsx scripts/verify-phase-54.ts`(S-catalog) | ❌ W0 | ⬜ pending |
| 54-NN-xx | — | — | SC1/GATE-01 | — | foldDisplayState 四态折叠全组合枚举(含 legacy 无 decision/AUTO/BLOCK 分支,平台枚举源 app/models/schemas.py L11-37) | unit | `npm test -- foldDisplayState` | ❌ W0 | ⬜ pending |
| 54-NN-xx | — | — | SC1 | — | 轮询列表解析 + 翻页 + fail-closed content_ref 过滤 + (id+state+version) diff | unit(deps 注入 fetch) | `npm test -- gateStateService` | ❌ W0 | ⬜ pending |
| 54-NN-xx | — | — | SC1 | V4 | kap gate-state 快照 vs 活体平台列表按折叠表逐条比对 | live smoke | verify-phase-54 S-live(需 env 修复) | ❌ W0 | ⬜ pending |
| 54-NN-xx | — | — | SC2/GATE-02 | — | blocking 推导(每 episode 最新 pending 门)+ 无阻塞=null | unit | `npm test -- gateStore/blocking` | ❌ W0 | ⬜ pending |
| 54-NN-xx | — | — | SC2 | — | 新会话快照拉取 + socket `gate:state` 增量 | unit(mock socket) | `npm test -- useCanvasSocket`(既有 test 扩展 gate:state case) | ✅ 扩展 | ⬜ pending |
| 54-NN-xx | — | — | SC3/GATE-03 | — | khs poller 词汇对齐:COMPLETE + review_result.decision → resolve/write(mock client 返 COMPLETE + review_result) | unit(khs) | `python3 -m pytest plugins/review_gates/tests -k complete` | ❌ W0(khs) | ⬜ pending |
| 54-NN-xx | — | — | SC3 | — | 平台 approve 恒写 decision / reject 补写 review_result / waive 端点 | integration(平台仓) | 平台仓 `pytest tests/integration`(既有 approve/reject 用例扩展) | ❌ W0(平台仓) | ⬜ pending |
| 54-NN-xx | — | — | SC3 | V5/V4 | gate-ops 端点:三维 fail-closed 匹配 + 409 幂等成功语义 + zod 边界(action enum/reviewId int/reason 1..500) | integration(spawn 子进程 dispatch) | verify-phase-54 S-ops(49-01 在案模式) | ❌ W0 | ⬜ pending |
| 全体 | — | — | 全体 | — | forced-failure 自检(契约测试能红:khs gates.yaml 篡改 → S-catalog 红) | contract | verify-phase-54 自检节 | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/infinite-canvas/src/lib/gateCatalog.ts`(+ `foldDisplayState` 纯函数)——SC1 单元与契约测试地基
- [ ] `scripts/verify-phase-54.ts` 骨架(S-catalog/S-live/S-ops 分节)+ `verify:phase-54` npm script 注册
- [ ] khs `plugins/review_gates/tests/test_poller_complete_state.py`(R3 用例,先行红)
- [ ] env 修复:生产 `REVIEW_PLATFORM_URL` 指向可达地址(localhost:8090 直连活体 OK;RESEARCH §I.2)——S-live 硬前置

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| 阻塞态呈现:topbar 待办 chip + 阻塞列呼吸描边 + gate 面板(一处发光、其余安静;catppuccin 金=等你决策/青=放行/玫=驳回/locked 灰=豁免) | GATE-02 | 视觉主观 + 布局签收 | headless canvas 探针截图 + 人工签收;反模式检查:全画布无多处红 |
| 新会话打开画布即定位当前阻塞门 | GATE-02/SC2 | 端到端会话行为 | 新开会话→打开画布→todo chip 存在且点击跳焦到当前阻塞门节点 |
| SC3 全链:真实 episode run 停在门上 → 画布放行 → kmc 消费续跑 | GATE-03/SC3 | 真实管线 + 跨三仓时序 | 断言 review-outcomes.json 追加 + PipelineState approved + 管线续跑;存量 2 条 APPROVING 活体 review(ep-ccport-test01 p11c/p13)可作首批真实用例 |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 180s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
