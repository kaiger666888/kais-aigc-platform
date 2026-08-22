# Roadmap

## Milestones

- ✅ **v1.0 MVP** — Phases 1-6 (shipped)
- ✅ **v1.1 Hermes Intelligent Decision Engine** — Phases 7-10 (shipped 2026-06-06)
- ✅ **v1.2 Integration Testing** — Phases 11-14 (shipped 2026-06-07)
- ✅ **v1.3 Architecture Alignment** — Phases 15-19.1 (shipped 2026-06-13)
- ✅ **v1.4 Production Verification + Repo Governance** — Phases 20-22 (shipped 2026-06-13, partial)
- ✅ **v1.5 Architecture Hardening + Code Hygiene** — Phases 23-27 (shipped 2026-06-14)
- ✅ **v1.6 Workflow Skill Contract** — Phases 28-34 (shipped 2026-06-15)
- ✅ **v1.7 Infinite Canvas Storyboard & Orchestration** — Phases 35-38 (shipped 2026-06-18)
- ✅ **v1.8 Canvas ↔ Movie-Agent V8.6 Adaptation** — Phase 39 (shipped 2026-06-19)
- ✅ **v1.9 Canvas Sync Reliability** — Phases 40-41 (shipped 2026-06-24)
- ✅ **v2.0 Canvas Sync Permanence** — Phases 42-47 (shipped 2026-07-16)
- ✅ **v2.1 候选资产配套 (candidate-asset-completeness)** — Phases 48-50 (shipped 2026-08-19)
- ✅ **v3.0 画布创作体验 (Canvas Creative Experience for kmc)** — Phases 51-57 (shipped 2026-08-22, audit passed)

## Phases

**Phase Numbering:**

- Integer phases (1-14): Shipped in v1.0-v1.2
- Integer phases (15-19) + decimal (19.1): Shipped v1.3
- Integer phases (20-22): v1.4
- Integer phases (23-27): v1.5
- Integer phases (28-34): v1.6 (shipped)
- Integer phases (35-38): v1.7 (shipped)
- Integer phase (39): v1.8 (shipped)
- Integer phases (40-41): v1.9 (shipped)
- Integer phases (42-47): v2.0 (shipped)
- Integer phases (48-50): v2.1 (shipped)
- Integer phases (51-57): **v3.0 (shipped 2026-08-22 — audit passed; Phase 52 externally owned, code-on-master, user-accepted)**
- Decimal phases (e.g., 48.1): Urgent insertions

Decimal phases appear between their surrounding integers in numeric order.

### ✅ Previous Milestones (Shipped)

<details>
<summary>Phases 1-50: v1.0 through v2.1 — collapsed</summary>

See [milestones/](milestones/) for per-milestone ROADMAP/REQUIREMENTS/AUDIT archives and [MILESTONES.md](MILESTONES.md) for summaries:

- v1.0-v1.2: generation pipeline + hermes decision engine + integration testing
- v1.3-v1.5: engine consolidation, production verification, architecture hardening
- v1.6: Workflow Skill Contract (manifest/registry/canvas dynamic node types)
- v1.7: storyboard metadata + one-click orchestrator + batch execution
- v1.8-v2.0: canvas ↔ movie-agent adaptation, sync reliability, sync permanence
- v2.1: ingest candidate grouping + selection write-back + historical backfill + contract guards

</details>

<details>
<summary>✅ v3.0 画布创作体验 (Phases 51-57) — SHIPPED 2026-08-22</summary>

以 kmc 22-phase/16-gate 创作流为准绳：画布写路径统一走 V3 canonical graph，"看/选/改/批"四类创作交互一等公民化。

- [x] Phase 51: 写路径地基统一 (Canonical Write Path + Coordination Guard) — completed 2026-08-21
- [x] Phase 52: 生成-迭代闭环 (Prompt Edit → Regenerate Loop) — **materials delivered 2026-08-22 by owning session** (8/8 SUMMARYs + VERIFICATION passed + UAT gaps closed; verify:phase-52 31/31, e2e 62, 真机 probe 全绿)
- [x] Phase 53: 候选变体契约与选片 (Variant Contract + Picker Upgrade) — completed 2026-08-21 (Wave A; Wave B gated on khs2 v2.4 Phase 25)
- [x] Phase 54: Gate 中心 (Gate Center + Blocking-State UX) — completed 2026-08-21
- [x] Phase 55: 画布导航与规模 (Navigation & Scale) — completed 2026-08-22
- [x] Phase 56: 创作环节可视化 (Creative Visualization) — completed 2026-08-22
- [x] Phase 57: 平台页面与门户 (Portal & Delivery Pages) — completed 2026-08-22

Audit: **passed** (305/305 verify assertions · 435/435 vitest · 3× tsc clean · live probes ok). Full detail: [milestones/v3.0-ROADMAP.md](milestones/v3.0-ROADMAP.md) · [milestones/v3.0-MILESTONE-AUDIT.md](milestones/v3.0-MILESTONE-AUDIT.md)

</details>

## Deferred (out of v3.0 scope — carried forward from v3.0 REQUIREMENTS)

- 剧本前段 UI 承载 (p01/p02/p03/p06 专用页面)、剧本打磨 diff 视图、跨集进化建议审批队列、真实音频波形、director-desk 后端接线、分组折叠
- Out of scope: Toonflow 本体改造、review-platform 消费侧改造(SC-4 跨仓库债务)、data/web bak 清理、kmc phases 内部算法改动(khs2 v2.4 战场)
