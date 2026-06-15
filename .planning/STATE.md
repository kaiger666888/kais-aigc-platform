---
gsd_state_version: 1.0
milestone: v1.6
milestone_name: Workflow Skill Contract
status: planning
last_updated: "2026-06-15T02:08:14.488Z"
last_activity: 2026-06-15
progress:
  total_phases: 0
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-14)

**Core value:** AI short drama production pipeline that runs end-to-end -- from character design to deliverable final video
**Current focus:** Phase 23 (GpuScheduler Redis Migration)

## Current Position

Phase: Not started (defining requirements)
Plan: —
Status: Defining requirements
Last activity: 2026-06-15 — Milestone v1.6 started

## Performance Metrics

**Velocity:**

- Total plans completed: 16 (v1.3 — most recent fully-planned milestone)
- Previous milestones: v1.1 (10 plans), v1.2 (8 plans), v1.3 (13 plans incl. 19.1)
- v1.4 phases (20-22) planned but not yet executed

**By Phase (v1.3 — most recent executed):**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 17 | 4 | - | - |
| 18 | 3 | - | - |
| 19 | 3 | - | - |
| 19.1 | 3 | - | - |

*v1.4 + v1.5 phases not yet executed — table updates after first plan execution*

## Accumulated Context

### Roadmap Evolution

- **v1.5 roadmap created (2026-06-14):** 5 phases derived from 9 requirements across 5 categories (SCHED/GOLD/PATH/HERMES/CORE). Phase 23 (Redis) → 24 (Python cleanup) → 25 (Paths) → 26 (Hermes TS exclude) → 27 (router.ts fix). Phases 23 & 24 independent (parallelizable); 25/26/27 also independent.
- **v1.4 roadmap (2026-06-13):** 3 phases from 13 requirements (FIX-04/05/06, VERIFY-01/02/03/04, REPO-01..06). Order: 20 → 21 → 22 ("先稳定再治理").
- **v1.3 closeout:** 102/102 tests passing. 4 deferred gaps (FIX-02/03, MERGE-03, ENG-04) carried into v1.4. Phase 19.1 inserted to close partial gaps.
- **ACE route convergence (mid-v1.4):** Commits e3d649e + e817e18 collapsed ACE routes to Node layer — exposed the 5 v1.5 engineering-coordination gaps.

### Decisions

- Engine registration by backend type (ComfyUI/Independent API/Cloud/Subprocess), not by model
- TaskType stays broad (VIDEO/IMAGE/AUDIO/POSTPROCESS), details via params.extra
- All generation capabilities go through workflow_builder
- Merge direction: research repo -> deploy repo (deploy encompasses all)
- movie-agent fully removed, OpenClaw Agent replaces
- ACE-Step stays standalone container, fix permission bug
- BackendType str enum with 5 values (COMFYUI/SUBPROCESS/CLOUD/DOCKER/MOCK) as engine classification system
- BaseEngine.backend_type returns MOCK default, subclasses override
- v1.4 priority: FIX before VERIFY before REPO (stabilize, then verify, then govern)
- v1.3/v1.4 phase directories preserved as audit evidence — NOT archived
- Repo archival strategy: `git mv` to `.archive/repos/` OR DEPRECATED marker — NO deletion

**v1.5 milestone decisions:**

- Phase numbering continues from v1.4 (Phase 23+)
- Scope strictly limited to 5 identified improvements; no new features
- Phases 23 (Redis) and 24 (Python cleanup) are independent — may run in parallel
- Hermes fix direction: exclude from main tsconfig.json; do NOT modify the vendored React project itself
- Output paths: unified convention in `src/lib/paths.ts`; new code forced, old code migrated progressively (33-route migration deferred to future milestone)
- Router auto-gen fix: source-of-truth fix is the skip rule in `src/core.ts` glob, NOT manual `router.ts` edits

### Pending Todos

None.

### Blockers/Concerns

- Phase 21 (v1.4 VERIFY) still requires live Docker runtime with RTX 3090 GPU. VERIFY-03 (E2E music gen) is hardware-blocked on 24GB GPU. Not a v1.5 concern but noted for context.
- v1.5 Phase 23 (Redis migration) requires a Redis instance available in dev — verify `REDIS_URL` is in `.env` or docker-compose before execution.
- v1.5 Phase 24 (Python cleanup) requires `docker compose build kais-gold-team` to rebuild image — needs Docker daemon access during execution.

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| v1.3 gap | FIX-02 (ACE-Step container health live verify) | v1.4 VERIFY-02 will close | v1.3 close |
| v1.3 gap | FIX-03 (E2E music generation live verify) | v1.4 VERIFY-03 will close | v1.3 close |
| v1.3 gap | MERGE-03 (Dockerfile build verify) | v1.4 VERIFY-04 will close | v1.3 close |
| v1.3 gap | ENG-04 (ACEStepEngine backend_type MOCK→DOCKER) | v1.4 FIX-04/05/06 will close | v1.3 close |
| v1.5 out-of-scope | GpuScheduler wired into 32 other ComfyUI routes | Future milestone (v1.5 only builds Redis-backed state infra) | v1.5 kickoff |
| v1.5 out-of-scope | Output path forced migration of all 33 routes | Future milestone (v1.5 only establishes convention + migration guide) | v1.5 kickoff |
| v1.5 out-of-scope | gold-team service full retirement | Out of scope — gold-team still hosts Hunyuan3D, pipeline render, etc. | v1.5 kickoff |

## Session Continuity

Last session: 2026-06-14
Stopped at: v1.5 roadmap created. 5 phases (23-27) with 9 requirements mapped at 100% coverage.
Resume: `/gsd:plan-phase 23` to plan the first phase (GpuScheduler Redis Migration).

## Operator Next Steps

- Start the next milestone with /gsd-new-milestone
