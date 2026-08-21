---
phase: 54
slug: gate-gate-center-blocking-state-ux
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-08-21
---

# Phase 54 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. **三仓生效**:kap(vitest + verify 脚本)、khs(pytest, plugins/review_gates)、review-platform(pytest, tests/integration)。**硬前置:REVIEW_PLATFORM_URL env 修复**(RESEARCH §I.2——生产默认 URL 不可达,Phase 49 bridge 从未生效;S-live 与 gate-ops 活体验收都依赖它)。

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest ^2.1.9 (packages/infinite-canvas, 包内 `npm test`);kap 契约/集成 = tsx verify 脚本范式(`scripts/verify-phase-54.ts`, node:assert, verify-phase-51/53 同款)——gateCatalog/foldDisplayState/gateStateService 均在 kap 根 src/lib(服务端折叠 + verify 直读,P7 纪律),由 verify S 节覆盖,**不走包内 vitest**;khs = pytest 3.12.3(`plugins/review_gates/tests`、`plugins/kais_aigc/tests` 既有);review-platform = pytest(`tests/` 既有) |
| **Config file** | `packages/infinite-canvas/vitest.config.*`(既有);root 无 vitest — 契约测试走 verify 脚本;khs/平台仓 pytest 既有配置 |
| **Quick run command** | `cd packages/infinite-canvas && npm test` + `npx tsc --noEmit`(<30s);kap 服务端契约 `npm run verify:phase-54`;涉 khs 文件加 `python3 -m pytest plugins/review_gates/tests -k <相关>` |
| **Full suite command** | `npm run verify:phase-54`(全 S 节)+ 包内 `npm test` + khs 两 plugin 目录 pytest |
| **Estimated runtime** | ~180 seconds |

---

## Sampling Rate

- **After every task commit:** 包内 `npm test`(或相关文件 `npx vitest run <file>`)+ `npx tsc --noEmit`;kap 根涉 gateCatalog/gateStateService 的 task 加 `npm run verify:phase-54` 相关 S 节;涉 khs/平台文件的 task 加对应 pytest 子集
- **After every plan wave:** `npm run verify:phase-54` + khs `python3 -m pytest plugins/review_gates/tests plugins/kais_aigc/tests`
- **Before `/gsd:verify-work`:** verify:phase-54 全绿 + 活体 SC1 smoke(S-live,需 env 已修)绿 + SC3 全链手工签收(HUMAN-UAT)
- **Max feedback latency:** 180 seconds

---

## Per-Task Verification Map

*(Task ID 已按 54-01..54-07 PLAN 预落位;54-07-T3 收口时核对映射并按实际结果更新 Status 列)*

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 54-01-T3 | 54-01 | 1 | SC1/GATE-01 | — | gates.yaml 快照 ↔ khs 现值零漂移(js-yaml 逐字段 diff + derive 规则 round-trip + 16 门计数) | contract | `npm run verify:phase-54`(S-catalog 节,读 kap 根 src/lib/gateCatalog.ts) | ✅ | ✅ green |
| 54-01-T3 | 54-01 | 1 | SC1/GATE-01 | — | foldDisplayState 四态折叠全组合枚举(含 legacy 无 decision/AUTO/BLOCK 分支,平台枚举源 app/models/schemas.py L11-37)——gateCatalog 在 kap 根 src/lib,包内 vitest 不覆盖 | contract(S-fold 节) | `npm run verify:phase-54`(S-fold 节) | ✅ | ✅ green |
| 54-01-T2 | 54-01 | 1 | SC1 前置 | — | 生产 `REVIEW_PLATFORM_URL=http://localhost:8090` 配置 + 平台活体可达(health ok + reviews envelope;S-live 硬前置,RESEARCH §I.2) | config smoke | `grep -n "^REVIEW_PLATFORM_URL=http://localhost:8090$" .env && curl -sf http://localhost:8090/api/v1/health \| grep -o '"status":"ok"'` | ✅ | ✅ green |
| 54-05-T1 | 54-05 | 2 | SC1 | — | 轮询列表解析 + 翻页 fail-closed(MAX_LIST_PAGES=10)+ content_ref 三维等值过滤 + 红线 auto + legacy 别名命中 + diff(id+state+version 签名)不广播/变化广播 + 异常 degrade + **blocking 推导(每 scope 最新 pending 门,无阻塞=null)**——deps 注入 fake fetchImpl/nodesReader/broadcast | contract(S-poller 节,服务端) | `npm run verify:phase-54`(S-poller 节) | ✅ | ✅ green |
| 54-04-T1(54-06-T1 扩展) | 54-04 | 1 | SC2/GATE-02 | — | gateStore.apply 载荷级浅比较去重 + degrade 载荷照常应用 + setOpen/初始态;54-06 扩展 resolveRepresentativeNodeId 三级解析(g-/n-/phaseName token 等值,p1≠p11a0)。服务端 blocking 推导在 S-poller 覆盖,此行仅前端 store 面 | unit(vitest) | `cd packages/infinite-canvas && npm test -- gateStore` | ✅ | ✅ green |
| 54-04-T2 | 54-04 | 1 | SC2 | — | 新会话快照拉取 + socket `gate:state` 增量(挂载注册/事件转发/无回调安全/卸载断开四件套) | unit(mock socket) | `cd packages/infinite-canvas && npm test -- useCanvasSocket`(既有 test 扩展 gate:state case) | ✅ 扩展 | ✅ green |
| 54-03-T1/T2 | 54-03 | 1 | SC3/GATE-03 | — | khs poller 词汇对齐:COMPLETE + review_result.decision → resolve/write(mock client 返 COMPLETE + review_result;waive→approve 映射 + chosen 第三通道) | unit(khs) | `cd /data/workspace/kais-hermes-skills && python3 -m pytest plugins/review_gates/tests/test_poller_complete_state.py -v` | ✅ | ✅ green |
| 54-02-T1/T2 | 54-02 | 1 | SC3 | — | 平台 approve 恒写 decision / reject 补写 review_result / waive 端点 | integration(平台仓) | `cd /data/workspace/kais-review-platform && python3 -m pytest tests/test_approve_reject.py`(快速子集 `-k "decision or waive"`;全量 `python3 -m pytest tests/ -x -q`) | ✅ | ✅ green |
| 54-05-T2 | 54-05 | 2 | SC3 | V5/V4 | gate-ops 端点:三维 fail-closed 匹配 + 409 幂等成功语义 + zod 边界(action enum/reviewId int/reason 1..500) | integration(spawn 子进程 dispatch) | `npm run verify:phase-54`(S-ops 节,49-01 在案模式) | ✅ | ✅ green |
| 54-07-T1 | 54-07 | 4 | SC3/GATE-03 | T-54-07-01/02 | GateCenterBlock 操作流:applied:true 行乐观翻转 / 409 already-resolved 行刷新 + 幂等 toast / 异常回滚(mock canvasApi.gateOps;jsdom + react-dom/client,AssetCardNode.playBadge 同法) | unit(vitest,mock gateOps) | `cd packages/infinite-canvas && npm test -- GateCenterBlock` | ✅ | ✅ green |
| 54-05-T3 | 54-05 | 2 | SC1 | V4 | kap gate-state 快照 vs 活体平台列表按折叠表逐条比对(对照表驱动,防活体漂移误报) | live smoke | `npm run verify:phase-54`(S-live 节,需 env 已修) | ✅ | ✅ green |
| 全体 | — | — | 全体 | — | forced-failure 自检(契约测试能红:内存中变异 yaml → S-catalog 红,不写 khs 文件) | contract | `npm run verify:phase-54`(S-forced-fail 节) | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `src/lib/gateCatalog.ts`(**kap 根** src/lib——服务端折叠 + verify 脚本直读,P7 纪律;+ `foldDisplayState` 纯函数)——SC1 契约测试地基(54-01-T1)
- [x] `scripts/verify-phase-54.ts` 骨架(S-catalog/S-fold/S-forced-fail 实节 + S-live/S-ops/S-poller 占位链)+ `verify:phase-54` npm script 注册(54-01-T3)
- [x] khs `plugins/review_gates/tests/test_poller_complete_state.py`(R3 用例,先行红,54-03-T1)
- [x] env 修复:生产 `REVIEW_PLATFORM_URL` 指向可达地址(localhost:8090 直连活体 OK;RESEARCH §I.2)——S-live 硬前置(54-01-T2)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| 阻塞态呈现:topbar 待办 chip + 阻塞列呼吸描边 + gate 面板(一处发光、其余安静;catppuccin 金=等你决策/青=放行/玫=驳回/locked 灰=豁免) | GATE-02 | 视觉主观 + 布局签收 | headless canvas 探针截图 + 人工签收;反模式检查:全画布无多处红 |
| 新会话打开画布即定位当前阻塞门 | GATE-02/SC2 | 端到端会话行为 | 新开会话→打开画布→todo chip 存在且点击跳焦到当前阻塞门节点 |
| SC3 全链:真实 episode run 停在门上 → 画布放行 → kmc 消费续跑 | GATE-03/SC3 | 真实管线 + 跨三仓时序 | 断言 review-outcomes.json 追加 + PipelineState approved + 管线续跑;存量 2 条 APPROVING 活体 review(ep-ccport-test01 p11c/p13)可作首批真实用例 |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 180s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** 54-07-T3 收口 2026-08-22(verify:phase-54 57/57 六节无 SKIP;包内 vitest 260/260;双根 tsc 0;khs pytest 绿;10588 活体 200。SC3 全链手工签收留 HUMAN-UAT)
