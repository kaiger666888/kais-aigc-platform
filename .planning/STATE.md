---
gsd_state_version: 1.0
milestone: v1.5
milestone_name: Architecture Hardening + Code Hygiene
status: planning
last_updated: "2026-06-14T07:17:59.266Z"
last_activity: 2026-06-14
progress:
  total_phases: 0
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-13)

**Core value:** AI short drama production pipeline that runs end-to-end -- from character design to deliverable final video
**Current focus:** Phase 20

## Current Position

Phase: Not started (defining requirements)
Plan: —
Status: Defining requirements
Last activity: 2026-06-14 — Milestone v1.5 started

## Performance Metrics

**Velocity:**

- Total plans completed: 16 (v1.3)
- Previous milestones: v1.1 (10 plans), v1.2 (8 plans)

**By Phase (v1.3 — most recent):**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 17 | 4 | - | - |
| 18 | 3 | - | - |
| 19 | 3 | - | - |
| 19.1 | 3 | - | - |

*v1.4 phases not yet planned — table updates after first plan execution*

## Accumulated Context

### Roadmap Evolution

- **v1.4 roadmap created (2026-06-13):** 3 phases derived from 13 requirements. Phase 20 (FIX) → Phase 21 (VERIFY) → Phase 22 (REPO). Order follows PROJECT.md decision "先稳定再治理" — stabilize runtime first, then govern repos.
- Phase 19.1 inserted in v1.3: closed partial gaps but 4 items (FIX-02/03, MERGE-03, ENG-04) remained deferred — these are the v1.4 input.

### Decisions

- Engine registration by backend type (ComfyUI/Independent API/Cloud/Subprocess), not by model
- TaskType stays broad (VIDEO/IMAGE/AUDIO/POSTPROCESS), details via params.extra
- All generation capabilities go through workflow_builder
- Merge direction: research repo -> deploy repo (deploy encompasses all)
- movie-agent fully removed, OpenClaw Agent replaces
- ACE-Step stays standalone container, fix permission bug
- BackendType str enum with 5 values (COMFYUI/SUBPROCESS/CLOUD/DOCKER/MOCK) as engine classification system
- BaseEngine.backend_type returns MOCK default, subclasses override; cloud/docker base classes cover all child subclasses
- JoyCaptionEngine classified as BackendType.COMFYUI (talks to ComfyUI HTTP)
- IMAGE_DRAW params.extra.mode routing takes priority over model param (ipadapter/pulid/instantid)
- InstantID reuses IP-Adapter infrastructure (build_flux_ipadapter_workflow), no separate workflow needed
- Unrecognized extra.mode values fall through to model-based routing (threat model T-18-02)
- Engine registration sections labeled with backend-type comment headers, grouped summary replaces flat engine ID list
- Legacy local-comfyui gets backend_type=comfyui, legacy cloud providers get backend_type=cloud in API response
- v1.4 priority: FIX before VERIFY before REPO (stabilize, then verify, then govern)
- v1.3 phase directories preserved as audit evidence — NOT archived in v1.4
- Repo archival strategy: `git mv` to `.archive/repos/` OR DEPRECATED marker — NO deletion (preserves git history)
- Phase 21 (VERIFY) requires Docker runtime with GPU — must execute on production host, not CI

### Pending Todos

None.

### Blockers/Concerns

- Phase 21 requires live Docker runtime with RTX 3090 GPU access. If runtime is unavailable during execution, VERIFY requirements will need to be deferred again. Flag explicitly in plan.

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| v1.3 gap | FIX-02 (ACE-Step container health live verify) | v1.4 VERIFY-02 will close | v1.3 close |
| v1.3 gap | FIX-03 (E2E music generation live verify) | v1.4 VERIFY-03 will close | v1.3 close |
| v1.3 gap | MERGE-03 (Dockerfile build verify) | v1.4 VERIFY-04 will close | v1.3 close |
| v1.3 gap | ENG-04 (ACEStepEngine backend_type MOCK→DOCKER) | v1.4 FIX-04/05/06 will close | v1.3 close |

## Session Continuity

Last session: 2026-06-13
Stopped at: v1.4 roadmap created. 3 phases (20, 21, 22) with 13 requirements mapped at 100% coverage.
Resume: `/gsd:plan-phase 20` to plan the first phase (ACEStepEngine backend type fix).
