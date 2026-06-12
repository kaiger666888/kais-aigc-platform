---
phase: 17-workflow-builder-expansion
plan: 03
subsystem: engine-routing
tags: [trellis, comfyui, workflow-builder, routing, dedicated-engines]

# Dependency graph
requires:
  - phase: 17-01
    provides: workflow builders (build_trellis_image_to_3d_workflow, build_flux_trellis_full_workflow)
provides:
  - TRELLIS routing via params.extra.engine="trellis" on IMAGE_TO_3D tasks
  - FLUX+TRELLIS routing via params.extra.mode="flux_trellis" on IMAGE_TO_3D tasks
  - DEDICATED_ENGINES bypass mechanism for TRELLIS in router and executor
  - 6 routing tests covering TRELLIS selection and bypass behavior
affects: [executor, router, workflow-builder, phase-17]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "params.extra.engine/mode routing: use task params.extra dict to select workflow builder variants within the same TaskType"
    - "DEDICATED_ENGINES bypass: check params.extra before dedicated engine lookup to route to comfyui-primary instead"

key-files:
  created:
    - docker/gold-team/tests/test_executor_routing.py
  modified:
    - docker/gold-team/src/v6/executor.py
    - docker/gold-team/src/v6/engine/router.py

key-decisions:
  - "TRELLIS routing uses params.extra.engine='trellis' and params.extra.mode='flux_trellis' on existing IMAGE_TO_3D TaskType (no new TaskType needed)"
  - "DEDICATED_ENGINES bypass is a targeted pre-check in _pick_local_engine_id rather than modifying the DEDICATED_ENGINES dict itself"

patterns-established:
  - "Conditional routing via params.extra: enables TaskType subclasses without enum proliferation"
  - "Dual bypass pattern: both router._pick_local_engine_id and executor._resolve_engine check params.extra for consistency"

requirements-completed: [WFB-04, WFB-05]

# Metrics
duration: 2min
completed: 2026-06-12
---

# Phase 17 Plan 03: TRELLIS Routing Summary

**TRELLIS and FLUX+TRELLIS workflow routing via params.extra on IMAGE_TO_3D tasks with DEDICATED_ENGINES bypass**

## Performance

- **Duration:** 2 min
- **Started:** 2026-06-12T13:15:54Z
- **Completed:** 2026-06-12T13:17:53Z
- **Tasks:** 1 (TDD: RED + GREEN)
- **Files modified:** 3

## Accomplishments
- executor.py IMAGE_TO_3D branch now checks params.extra.engine and params.extra.mode before defaulting to hunyuan3d
- router.py _pick_local_engine_id bypasses DEDICATED_ENGINES for TRELLIS tasks, routing to comfyui-primary
- executor.py _resolve_engine also bypasses dedicated engine lookup for TRELLIS tasks
- 6 new routing tests pass (3 workflow selection + 3 engine routing), 24 existing builder tests pass (0 regressions)

## Task Commits

Each task was committed atomically (TDD):

1. **Task 1 RED: Add failing tests for TRELLIS routing** - `b408374` (test)
2. **Task 1 GREEN: Add TRELLIS routing to executor and engine router** - `bf989af` (feat)

## Files Created/Modified
- `docker/gold-team/tests/test_executor_routing.py` - 6 routing tests (3 workflow selection, 3 engine routing)
- `docker/gold-team/src/v6/executor.py` - TRELLIS routing branch in IMAGE_TO_3D handler + dedicated engine bypass in _resolve_engine
- `docker/gold-team/src/v6/engine/router.py` - TRELLIS bypass in _pick_local_engine_id before DEDICATED_ENGINES lookup

## Decisions Made
- Used params.extra.engine="trellis" and params.extra.mode="flux_trellis" as routing discriminators on existing IMAGE_TO_3D TaskType rather than creating new TaskType enum values
- Implemented bypass as a targeted pre-check in both router and executor rather than modifying the shared DEDICATED_ENGINES dict (keeps bypass logic local and testable)
- Tests verify routing logic in isolation by simulating the executor's routing branch selection, avoiding async engine setup complexity

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- TRELLIS routing complete, all IMAGE_TO_3D variants (hunyuan3d, trellis, flux_trellis) route correctly
- Ready for Plan 17-04 (final plan in phase 17)

---
*Phase: 17-workflow-builder-expansion*
*Completed: 2026-06-12*
