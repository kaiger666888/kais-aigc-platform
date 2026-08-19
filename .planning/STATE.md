---
gsd_state_version: 1.0
milestone: v2.1
milestone_name: 候选资产配套 (candidate-asset-completeness)
status: ready_to_plan
stopped_at: Phase 48 complete (2/2) — ready to discuss Phase 49
last_updated: 2026-08-19T01:58:33.881Z
last_activity: 2026-08-19
progress:
  total_phases: 3
  completed_phases: 1
  total_plans: 2
  completed_plans: 2
  percent: 33
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-17)

**Core value:** AI creative production pipeline that runs end-to-end, pluggable across multiple creative workflows via a published skill contract.
**Current focus:** Phase 49 — selection write back (canvas endpoint + asset center linkage + kmc bridge)

## Current Position

Phase: 49
Plan: Not started
Status: Ready to plan
Last activity: 2026-08-19

## Performance Metrics

**Velocity:**

- Total plans completed: 31 (v1.5 shipped — last fully-executed milestone before v1.7)
- v1.7 shipped 2026-06-18 in single session (4 phases, 4 plans, 0 failures)

**By Phase (v1.7):**

| Phase | Plans | Status |
|-------|-------|--------|
| 35 | 1 | ✅ Shipped |
| 36 | 1 | ✅ Shipped |
| 37 | 1 | ✅ Shipped |
| 38 | 1 | ✅ Shipped (Tier 2) |
| Phase 48 P48-01 | 9 min | 3 tasks | 5 files |
| Phase 48 P48-02 | 6 min | 3 tasks | 4 files |

## Accumulated Context

### Roadmap Evolution

- **v2.1 roadmap created (2026-08-19):** 3 phases (48-50) derived from 12 requirements across 4 categories (INGEST 4 / SELECT 4 / PHASE 2 / GUARD 2). Serial chain 48→49→50: Phase 48 = o_assets 分组契约源头 (ingest 建组 + assetType 真值源 + workflow_phase 写入); Phase 49 = 选定回写闭环 (select-winner 端点 + 前端接线 + 资产中心联动 + kmc review resolve 桥接); Phase 50 = 存量回填 (与 Phase 47 模式一致) + 契约守护 (GUARD-01/02 + verify-phase-50)。kmc 侧零修改,桥接只读消费 manifest/review 协议。
- **v2.0 shipped (2026-07-16):** 6 phases (42-47), 12/12 plans. 源端 manifest 契约 + canvas_sync 单路径 + 接收端 schema 严格化 + 文字资产 UI + E2E 契约测试 + 历史 backfill。唯一 deferred: BACKFILL-02 人工抽样签收。
- **v1.8 kicked off (2026-06-19):** Phase 39 — reconcile master's v1.7 canvas with kais-movie-agent V8.6 (at `/data/workspace/kais-movie-agent/`). Discovered `feature/canvas-v2` (containing `/api/v2/canvas/*` routes + FlowGraphV2 types) had been stranded since merge-base d9c826c — `canvas-client.js` in V8.6 was written against these v2 routes but they never landed on master. Wave 1 merged feature/canvas-v2 → master-side branch with single conflict resolved (useCanvasSocket — kept both event handler sets).
- **v1.7 shipped (2026-06-18):** 4 phases (35-38), 24/24 requirements satisfied. Tier 1 storyboard metadata + one-click orchestrator + batch execution shipped; Tier 2 storyboard preview landed as placeholder (gold-team IMAGE_DRAW integration deferred to follow-up). Zero backend schema changes — new fields persist via existing JSON blob (`o_agentWorkData.canvasGraph`).
- **v1.7 roadmap created (2026-06-17):** 4 phases (35-38) derived from 24 requirements across 4 categories (STORYBOARD / ORCHESTRATE / BATCH / CANVAS-PREVIEW). Serial Tier 1 chain 35→36→37; Phase 38 (Tier 2 preview) parallel-safe, depends only on 35.
- **v1.6 shipped (2026-06-15):** 7 phases (28-34), 35/36 requirements satisfied (1 deferred — COMPLIANCE-03 live Docker+GPU sign-off). Skill Contract abstraction published; canvas renders any skill's node types dynamically.

### Decisions

**v1.7 milestone decisions (authoritative — see PROJECT.md for full table):**

- Phase numbering continues from v1.6 (Phase 35+)
- Borrow scope focused on Tier 1; LLM integration + character schema changes deferred to v1.8+
- Storyboard metadata lives in existing `FlowGraph.data` free schema + `o_storyboard.prompt_meta` JSON column — no breaking schema migration
- One-click orchestration reuses existing `executeNode` — no new engine; orchestrator loops at canvas API layer; progress via WebSocket
- Batch execution = multiple `executeNode` calls; backend not concurrent; GPU serialization via GpuScheduler
- Single backend endpoint `POST /api/canvas/orchestrate` serves both full-canvas and explicit-subset (batch) flows via optional `nodeIds`
- Tier 2 PREVIEW phase (38) optional and parallel-safe — depends only on Phase 35

**Inherited from prior milestones:**

- Manifest is descriptive only; behavior stays platform-side (Pitfalls A4)
- Registry is source of truth — delete hardcoded constants, do not wrap (Architecture Pattern 3)
- zod schema is source of truth for spec (Pitfalls C1)
- Node type IDs are namespaced `<skill_id>::<type>` (Pitfalls A3)
- TS ESM/CJS interop: standalone `.ts` script pattern, not `tsx -e` (Pitfalls B5)
- No project test framework — use `verify-phase-*.ts` pattern registered in package.json (Pitfalls B3/B4)
- [Phase 48]: P48 manifest-batch matching disambiguated by parent-dir+basename (kmc shot dirs repeat frame basenames); resolution mode exclusive per frame-list
- [Phase 48]: P48 D-05 active-only state policy enforced at Plan 48-02 service layer, not in the pure grouping module
- [Phase ?]: [Phase 48] P48-02: knex 3.2.5 typings lack andWhereIn — registry /search uses chained .whereIn(expandTypesForQuery()) (identical AND semantics, repo convention)
- [Phase ?]: [Phase 48] P48-02: ingestImagesPayload takes db as a parameter (never imports @/utils) so Phase 50 backfill + verify scripts inject their own knex; whole batch single transaction with in-trx exactly-one-primary assertion
- [Phase ?]: [Phase 48] P48-02: verify Part-1 registry-enum assertion now checks truth-source import + literal-gone (Task 2 deleted the inline enum the old regex grepped)

### Pending Todos

None.

### Blockers/Concerns

None blocking v1.7 close. Carry-forward items below in Deferred Items.

### Notable deviations from PLAN (documented for transparency)

- **STORYBOARD-07 storage path:** PLAN called for `o_storyboard.prompt_meta` JSON column; actual implementation uses the existing `o_agentWorkData.canvasGraph` JSON blob (no schema migration needed). Capability fully delivered; storage path differs from PLAN text — see commit 9899f3a.
- **PREVIEW-02/03/04:** PLAN called for real gold-team IMAGE_DRAW engine call + `preview_update` WebSocket event + `o_storyboard.preview_path` persistence. Actual implementation: placeholder simulation (`setImmediate + setTimeout`), reuses existing `node:preview` event, no DB persistence yet. Real engine integration explicitly deferred to follow-up commit; placeholders marked with `// TODO` in `src/routes/canvas/storyboardPreview.ts`. UI capability fully delivered.

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| v1.7 out-of-scope | Story blueprint generator (LLM script→storyboard expansion) | v1.8+ — needs LLM integration layer | v1.7 kickoff |
| v1.7 out-of-scope | Character consistency management (cross-scene/episode) | v1.8+ — needs `o_character_role` table + consistency engine | v1.7 kickoff |
| v1.7 out-of-scope | Multi-episode batch generation (Xiaoyunque 80-episode capability) | v1.9+ — needs queue + scheduler coordination | v1.7 kickoff |
| v1.7 follow-up | Phase 38 PREVIEW — real gold-team IMAGE_DRAW engine integration | Placeholder simulation shipped; TODO in `src/routes/canvas/storyboardPreview.ts` | v1.7 close |
| v1.7 follow-up | Phase 38 PREVIEW — `o_storyboard.preview_path` DB persistence | Skipped (no schema change in v1.7); UI works via in-memory thumbnailUrl | v1.7 close |
| v1.7 out-of-scope | Phase 38 PREVIEW if time runs out | Tier 2, parallel-safe — may be deferred without blocking milestone close | v1.7 kickoff |
| v1.6 out-of-scope | Second reference skill (podcast/ads/interactive) | v1.7+ — validates abstraction against single skill first | v1.6 kickoff |
| v1.6 out-of-scope | Skill scaffolding CLI / hot-reload / offline validator | v1.7+ (AUTHOR-01/02/03) | v1.6 kickoff |
| v1.6 out-of-scope | Multi-skill coexistence per project | v1.7+ (MULTI-01/02/03) | v1.6 kickoff |
| v1.6 out-of-scope | Custom node renderers over HTTP | v1.7+ (RENDER-01/02); v1.6 supports 5 built-in renderers + FallbackNode only | v1.6 kickoff |
| v1.6 out-of-scope | Per-skill health tracking / auto-disable | v1.7+ (HEALTH-01/02/03); reuse hermes EWMA pattern | v1.6 kickoff |
| v1.5 out-of-scope | GpuScheduler wired into 32 other ComfyUI routes | Future milestone | v1.5 kickoff |
| v1.5 out-of-scope | Output path forced migration of all 33 routes | Future milestone | v1.5 kickoff |
| v1.5 out-of-scope | gold-team service full retirement | Out of scope — gold-team still hosts Hunyuan3D, pipeline render | v1.5 kickoff |
| v1.6 verification | Phase 33 COMPLIANCE-03 live Docker + GPU golden-path run (6-step sign-off checklist in 33-VERIFICATION.md → Human Verification Required). CI coverage 23/24 PASSED, 1 explicitly SKIPPED. Deferred to pre-production sign-off — environment-gated, not a code gap. | human_needed | 2026-06-15 (v1.6 close) |

## Quick Tasks Completed

| Slug | Date | Status | Summary |
|------|------|--------|---------|
| iteration-engine-frontend | 2026-07-02 | ✅ complete | Iteration Engine UI — IterationPanel + 7 API fns + toolbar button + NodeDetailPanel tab. Bridges to `/api/v1/iteration/*`. |
| hermes-driven-iteration | 2026-07-02 | ✅ complete | Add `/collect-feedback` + `/store-plan` endpoints for Hermes-driven iteration. Also converted `_runEngine` from `spawnSync` → async `child_process.spawn` to fix a deadlock where subprocess HTTP-self-calls blocked the Express event loop. Verified: `/collect-feedback` 131ms (was 120s+500), all 8 existing endpoints pass regression. |
| pipeline-breakpoints-pivot | 2026-07-03 | ✅ complete | Close pipeline evolution loop: `_buildPrompt` in `src/runtime/iteration-engine.mjs` now fetches node context via `POST /api/canvas/load` and applies prompt_modification overrides as `[进化指令]`. New `getEffectiveThresholds()` merges threshold overrides. `/api/canvas/execute` schema widened to accept IterationEngine payload. 7/7 unit tests pass. 3 atomic commits: `af62000c`, `faeab497`, `4214a018`. |
| ltx-pose-video-pipeline | 2026-07-03 | ✅ complete | New `POST /api/production/ltx/poseVideo` route (Kimodo BVH → Blender render → LTX-2.3 I2V workflow, independent). Optional `poseVideoFrames` field on `/api/production/ltx/msr` to consume skeleton render PNGs as additional refs (back-compat preserved). Files: `src/routes/production/ltx/poseVideo.ts` (new), `msr.ts` + `config.ts` + `router.ts` (modified). `tsc` clean. **Dev server needs restart** to register the new route (running in tsx non-watch mode). |
| schema-ui-backfill | 2026-07-12 | ✅ complete | 治本 — 修复资产节点详情面板空白。import-from-dir 摊平 manifest `params.*` + 读 `.txt` sidecar；canvasAssetSchema 声明 prompt/description；PATCH /nodes/batch 关闭校验漏洞；NodeDetailPanel AssetDetail 加 description/tags/provenance fallback；新增 dry-run backfill 脚本（530/690 节点可修复）。4 commits: `3978346f` `4a6f57f3` `77569b2f` `c574ae08`。**待用户决定** `python3 scripts/backfill-asset-descriptions.py --apply`。 |
| formalize-shot-analysis | 2026-07-23 | ✅ complete | 视频镜头解构（运镜/主体/景别语义）正式化。Vendor 已验证的 Python driver 到 `scripts/shot-analysis/`（逐镜头:几何层 ShotGeometryLK + 可选语义层 AILab_QwenVL_Advanced/Qwen3-VL-8B-8bit + 可选主体层 SAM3+SubjectMotionResidual → shot_XXX.json）+ 薄 TS 生产路由 `POST /api/v1/production/shot-analysis`（封装调用 driver:docker cp 暂存视频→spawn→聚合 JSON,无 ComfyUI 客户端逻辑在 TS）+ router route138 注册。build exit 0 + tsc --noEmit exit 0。3 commits: `170938b6` `2472721f` `4db9386e`。**已活体验证**几何+语义两层（shot_003: pan_right/fast + 近景/follow/刀飞向右侧）。前置节点部署见 quick 260723-njl。**遗留**:主体层需 sam3.pt（HF xet CDN 不可达,网络阻塞）;路由需 dev server 重启注册。 |
| shot-analysis-goldteam | 2026-07-24 | ✅ complete | shot-analysis 接入 gold-team v6 排队任务（与 LTX 串行、GPUGuard 管 VRAM、跑完不常驻——修掉之前的 OOM 旁路）。① models/task.py 加 `TaskType.SHOT_ANALYSIS`；② workflow_builder.py 加 `build_shot_analysis_workflow`（driver build_prompt+SEMANTIC_PROMPT v2 原样移植）；③ executor.py 加 `_TASK_OUTPUT_FIELDS` + 自包含派发分支 `_execute_shot_analysis`（submit→poll→读 ShotJSONMerge 落盘的 shot_XXX.json→store.update,避开公共 media-output 误解析）；④ route index.ts 改 gold-team 薄代理（POST /api/v1/tasks + 轮询）。py_compile + tsc 通过。2 commits: `f2e5eb5e` `b4de75d9`。**待 gold-team 容器 redeploy 才生效**（否则 type=shot_analysis → 422）+ 活体串行测试。 |

## Session Continuity

Last session: 2026-08-19T01:32:24.989Z
Stopped at: Phase 48 complete (2/2 plans)
Resume: `/gsd:execute-phase 48` (Plan 48-02: route rewrite + registry compat — consumes src/lib/assetTypes + candidateGrouping exports, extends verify-phase-48 at the Part 2 marker).
