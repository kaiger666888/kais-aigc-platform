---
phase: 59
slug: narrow-trigger-stale-cascade
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-23
---

# Phase 59 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from 59-RESEARCH.md "Validation Architecture" (HIGH confidence). Task IDs are finalized by the planner; SC-level rows below are the assertion surface of record.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 2.1.9（infinite-canvas + flowgraph-v3/ts 双包）· Playwright 1.61（e2e :9876 mock）· tsx 聚合门（根仓，B3/B4 仓约定） |
| **Config file** | 双包 vitest 内置配置 / playwright 既有配置（`packages/infinite-canvas/test/e2e/`） |
| **Quick run command** | `cd packages/infinite-canvas && npx vitest run <最窄相关测试文件>`（触及包为准；根仓改动加 `npx tsc --noEmit`） |
| **Full suite command** | `npx tsx scripts/verify-phase-59.ts`（新建聚合门：三根 tsc + 双包 vitest + 契约/负向断言 + forced-failure 自检） |
| **Estimated runtime** | quick ~10-30s · full ~2-4min · e2e wave ~1-2min |

---

## Sampling Rate

- **After every task commit:** quick run command（触及的最窄 vitest 文件 / `npx tsc --noEmit`）
- **After every plan wave:** full suite command + `cd packages/infinite-canvas && npx playwright test tests/phase59-stale-cascade.mjs`（e2e 前置纪律：serve dist 非 source，地雷 #10）
- **Before `/gsd:verify-work`:** 全量 e2e（含 phase52 三件套回归——级联共享 stale 面）+ probe-59-real 真机零足迹 + SC3 真机负向
- **Max feedback latency:** 30s（task 级）· 4min（wave 级）

### 负向断言三件套（锁死，phase 验收门组成部分）

1. 无 `regenSource` 的 execute（ContextMenu 路径）→ **零** stale 写
2. orchestrate/batch → **零** stale 写（STALE-03/SC3）
3. 引擎故障 → error 广播且**零** stale 写（D-02，断点③修真后）

---

## Per-SC Verification Map

| SC/Req | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|--------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| SC1 面板 regen→下游角标 | TBD | TBD | STALE-01 | V4 注记 | regenSource 仅标记信号非权限依据 | e2e (mock) | `npx playwright test tests/phase59-stale-cascade.mjs -g "panel"` | ❌ W0 | ⬜ pending |
| SC2 换 seed→下游角标+seed 透传 | TBD | TBD | STALE-02 | V5 | seed 经 zod + 引擎 pydantic 双校验 | e2e + 请求体断言 | `… -g "reroll"` | ❌ W0 | ⬜ pending |
| SC3 编排/批量零波及（负向） | TBD | TBD | STALE-03 | — | orchestrate.ts 无 markStaleDownstream import（静态断言） | e2e 负向 + 集成负向 + 静态 | `… -g "orchestrate"` + verify S 段 | ❌ W0 | ⬜ pending |
| SC4 重跑出口清角标+无关节点不受波及 | TBD | TBD | STALE-01/02/03 | — | N/A | e2e（复用 phase52-stale-panel 面 + 服务端标记来源变体） | `… -g "rerun-clears"` | 部分 | ⬜ pending |
| SC5-① poll 读 outputs.image | TBD | TBD | STALE-01/02 | — | 翻译层只接受 /mnt/agents/output 前缀 | 集成（fake 引擎活体形状直调） | verify S 段 | ❌ W0 | ⬜ pending |
| SC5-② /mnt/agents/output→/oss/ 翻译 | TBD | TBD | SC5 | 路径穿越 T1 | path.normalize + 前缀白名单，拒 `..` 逃逸 | 单元（fsToOssUrl 新分支直测） | verify S 段 / vitest | ❌ W0 | ⬜ pending |
| SC5-③ 引擎错误真广播（假成功修真） | TBD | TBD | SC5 | Repudiation | error 广播 + 零 stale 写（负向） | 集成（fake 引擎 500/超时→spawn 路由收广播） | verify S 段（49-01 子进程范式） | ❌ W0 | ⬜ pending |
| SC5-④ ref_images 参数名+宿主路径 | TBD | TBD | SC5 | V5 | 入向翻译白名单校验 | 集成（fake 引擎捕获请求体） | verify S 段 | ❌ W0 | ⬜ pending |
| REGEN-02 seed 到引擎 | TBD | TBD | STALE-02 | — | N/A | 集成 + e2e getCalls | verify S 段 | ❌ W0 | ⬜ pending |
| 级联语义 D-03/04 收敛 | TBD | TBD | STALE-01/02/03 | — | N/A | 单元（服务端 fixture 图快照 vs stale.test.ts 基线） | vitest + verify S 段 | 部分（stale.test.ts ✅） | ⬜ pending |
| reload 保真 D-05 | TBD | TBD | STALE-01 | — | N/A | 集成（:memory: sqlite load-v2 往返） | verify S 段 | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `scripts/verify-phase-59.ts` — 聚合门骨架（S 段：断点①②/③/④+seed/级联接线/SC3 负向/命令门/forced-failure）+ package.json 注册 `verify:phase-59`
- [ ] `packages/infinite-canvas/test/e2e/tests/phase59-stale-cascade.mjs` — SC1-4 e2e（mock-backend 扩：execute mock 认 regenSource 并回放 node:updated 契约事件）
- [ ] fake 引擎 fixture（verify 内联 http server：活体实证形状三模式——outputs.image 容器路径 / failed+error / params 捕获）
- [ ] fsToOssUrl export + 新分支单测挂点（planner 定居住所）
- [ ] probe-59-real.mjs（:10588 零足迹探针 + finally 恢复）

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| cloud-jimeng 换 seed 非确定性 | STALE-02 | dreamina CLI 无 seed 参数（RESEARCH MEDIUM 项） | 真机 reroll 两次观察产物差异；如无差异在 SUMMARY 如实记录（语义靠非确定性达成） |

*其余全部自动化（含真机面走 probe-59-real）。*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s（task 级）
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
