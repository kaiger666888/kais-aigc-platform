# Phase 18: Engine Registration & Task Routing - Context

**Gathered:** 2026-06-12
**Status:** Ready for planning
**Mode:** Auto-generated (infrastructure phase)

<domain>
## Phase Boundary

Refactor engine registration to group by backend type (ComfyUI/Independent API/Cloud/Subprocess) instead of per-model. Implement params.extra routing in executor for lip sync, frame interpolation, and character consistency. Verify all engine types function correctly after refactor.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — pure infrastructure phase. Use ROADMAP phase goal, success criteria, and codebase conventions to guide decisions. Prior phases (15-17) established the workflow builder patterns and routing table — this phase unifies the engine registration architecture.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `docker/gold-team/src/v6/engines/` — 17 engine files with established BaseEngine pattern
- `docker/gold-team/src/v6/main.py` — Current engine registration entry point
- `docker/gold-team/src/v6/executor.py` — Task routing with params.extra.mode support (added in Phase 17)
- `docker/gold-team/src/v6/engine/router.py` — DEDICATED_ENGINES + VRAM estimates + light task routing

### Established Patterns
- BaseEngine abstract class: submit/poll/get_output/cancel/health lifecycle
- ComfyUIEngine handles all ComfyUI models via workflow_builder pattern
- DockerPollingAPIEngine for standalone containers (ACE-Step)
- CloudBaseEngine subclasses for cloud APIs (Kling, Jimeng, Seedance)
- params.extra.mode routing already works for lip_sync and frame_interp (Phase 17)

### Integration Points
- Engine registration in main.py needs grouping by backend type
- Executor routing already supports params.extra — extend for character consistency
- DEDICATED_ENGINES bypass mechanism for TRELLIS established in Phase 17

</code_context>

<specifics>
## Specific Ideas

No specific requirements — infrastructure phase. Refer to ROADMAP phase description and success criteria.

</specifics>

<deferred>
## Deferred Ideas

None — infrastructure phase skipped discuss.
