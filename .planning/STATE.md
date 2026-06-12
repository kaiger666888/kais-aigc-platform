---
gsd_state_version: 1.0
milestone: v1.3
milestone_name: Architecture Alignment — Engine Consolidation
status: ready_to_plan
stopped_at: Phase 18 complete (3/3) — ready to discuss Phase 19
last_updated: 2026-06-12T14:06:57.329Z
last_activity: 2026-06-12 -- Completed 18-03 (engine registration grouping & API backend_type)
progress:
  total_phases: 5
  completed_phases: 1
  total_plans: 12
  completed_plans: 19
  percent: 20
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-12)

**Core value:** AI short drama production pipeline that runs end-to-end -- from character design to deliverable final video
**Current focus:** Phase 19 — integration verification

## Current Position

Phase: 19
Plan: Not started
Status: Ready to plan
Last activity: 2026-06-12

Progress: [█████▓░░░░] 58%

## Performance Metrics

**Velocity:**

- Total plans completed: 10 (v1.3)
- Previous milestones: v1.1 (10 plans), v1.2 (8 plans)

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 17 | 4 | - | - |
| 18 | 3 | - | - |

*Updated after each plan completion*

## Accumulated Context

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

### Pending Todos

None.

### Blockers/Concerns

None.

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| *(none)* | | | |

## Session Continuity

Last session: 2026-06-12
Stopped at: Completed 18-03, engine registration grouping & API backend_type. Next: 18-04.
Resume file: .planning/phases/phase-18/18-04-PLAN.md
