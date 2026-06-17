---
gsd_state_version: 1.0
milestone: v1.7
milestone_name: Infinite Canvas Storyboard & Orchestration
status: planning
last_updated: "2026-06-17T16:30:00.000Z"
last_activity: 2026-06-17
progress:
  total_phases: 4
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-17)

**Core value:** AI creative production pipeline that runs end-to-end, pluggable across multiple creative workflows via a published skill contract.
**Current focus:** Phase 35 — Storyboard Metadata Extension (v1.7 kickoff)

## Current Position

Phase: 35 of 38 (Storyboard Metadata Extension) — not yet planned
Plan: —
Status: Ready to plan
Last activity: 2026-06-17 — v1.7 roadmap created (4 phases, 24/24 requirements mapped, 100% coverage).

Progress: [░░░░░░░░░░] 0%

## Performance Metrics

**Velocity:**

- Total plans completed: 25 across v1.5 (last fully-executed milestone); v1.6 plans not yet tabulated.
- v1.6 milestone shipped in single session 2026-06-15 (7 phases, 277 automated assertions PASSED / 1 SKIPPED / 0 FAILED).

**By Phase (v1.7 — table populates after first plan execution):**

| Phase | Plans | Status |
|-------|-------|--------|
| 35 | 0 | Not started |
| 36 | 0 | Not started |
| 37 | 0 | Not started |
| 38 | 0 | Not started (Tier 2 optional) |

*Updated after each plan completion*

## Accumulated Context

### Roadmap Evolution

- **v1.7 roadmap created (2026-06-17):** 4 phases (35-38) derived from 24 requirements across 4 categories (STORYBOARD / ORCHESTRATE / BATCH / CANVAS-PREVIEW). Serial Tier 1 chain 35→36→37; Phase 38 (Tier 2 preview) parallel-safe, depends only on 35, may be deferred without blocking milestone close.
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

### Pending Todos

None.

### Blockers/Concerns

- **Phase 36 orchestrator topology order (CRITICAL):** ORCHESTRATE-03 requires stable topological sort over the FlowGraph (script → asset → storyboard → video → audio). Must handle cycles gracefully and document behavior. Resolve during `/gsd:plan-phase 36`.
- **Phase 36 run-state machine:** Toolbar button has 4 states (idle / running / done / error). Ensure no race conditions when multiple runs are triggered or when a run completes while user navigates. Resolve during plan-phase 36.
- **Phase 36/37 WebSocket channel sharing:** BATCH-04 requires batch run progress over the same channel as full orchestration. Disambiguate via event payload (`runId` + `mode: 'full' | 'batch'`). Resolve during plan-phase 37.
- **Phase 37 single-node execution path:** BATCH-05 requires single-node right-click "执行节点" to reuse the orchestrate endpoint (one-element `nodeIds`), not call a legacy single-node execute. Verify no existing single-node endpoint breaks. Resolve during plan-phase 37.
- **Phase 38 engine reuse:** PREVIEW-02 must call existing IMAGE_DRAW engine at 1280×720 — no new engine registration. Confirm resolution + aspect ratio params route through existing params.extra convention (TaskType stays broad). Resolve during plan-phase 38.
- **Phase 38 Electron caching (inherited from v1.6 Phase 32):** Updated canvas bundle may not reach running Electron instances without a bundle version bump. Plan-phase 38 must include bundle-version-bump step.

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| v1.7 out-of-scope | Story blueprint generator (LLM script→storyboard expansion) | v1.8+ — needs LLM integration layer | v1.7 kickoff |
| v1.7 out-of-scope | Character consistency management (cross-scene/episode) | v1.8+ — needs `o_character_role` table + consistency engine | v1.7 kickoff |
| v1.7 out-of-scope | Multi-episode batch generation (Xiaoyunque 80-episode capability) | v1.9+ — needs queue + scheduler coordination | v1.7 kickoff |
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

## Session Continuity

Last session: 2026-06-17T16:30:00
Stopped at: v1.7 roadmap created. 4 phases (35-38) with 24 requirements mapped at 100% coverage. Serial Tier 1 chain 35→36→37; Phase 38 (Tier 2 preview) parallel-safe, depends only on 35.
Resume: `/gsd:plan-phase 35` to plan the first phase (Storyboard Metadata Extension).
