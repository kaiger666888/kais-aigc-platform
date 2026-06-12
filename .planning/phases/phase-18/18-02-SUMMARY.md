---
phase: 18-engine-registration-task-routing
plan: 02
subsystem: engine-routing
tags: [comfyui, ip-adapter, pulid, instantid, character-consistency, workflow-builder, executor-routing]

# Dependency graph
requires:
  - phase: 17-workflow-builder-extension
    provides: build_flux_ipadapter_workflow, build_pulid_flux_workflow, build_lipsync_workflow, build_frame_interpolate_workflow
  - phase: 18-plan-01
    provides: BackendType enum and engine classification system
provides:
  - IMAGE_DRAW params.extra.mode routing for character consistency (ipadapter/pulid/instantid)
  - TestCharacterConsistencyRouting test class with 9 tests
  - Legacy model-based routing backward compatibility preserved
affects: [engine-registration, task-routing, character-consistency, image-generation]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "params.extra.mode routing takes priority over model-based routing for IMAGE_DRAW"
    - "Unrecognized extra.mode values fall through to model-based routing (threat model T-18-02)"

key-files:
  created: []
  modified:
    - docker/gold-team/src/v6/executor.py
    - docker/gold-team/tests/test_executor_routing.py

key-decisions:
  - "params.extra.mode routing takes priority over model param for IMAGE_DRAW tasks"
  - "InstantID reuses IP-Adapter infrastructure (build_flux_ipadapter_workflow) rather than separate workflow"
  - "Unrecognized extra.mode values fall through to model-based routing, not rejected"

patterns-established:
  - "IMAGE_DRAW routing chain: extra.mode check -> model check -> default flux_dev"
  - "Character consistency modes validated for required reference images before workflow construction"

requirements-completed: [TASK-01, TASK-02, TASK-03, TASK-04]

# Metrics
duration: 2min
completed: 2026-06-12
---

# Phase 18 Plan 02: Character Consistency Routing Summary

**IMAGE_DRAW params.extra.mode routing for IP-Adapter, PuLID, and InstantID character consistency workflows with legacy model-based fallback**

## Performance

- **Duration:** 2 min
- **Started:** 2026-06-12T13:56:49Z
- **Completed:** 2026-06-12T13:58:36Z
- **Tasks:** 1 (TDD: RED + GREEN)
- **Files modified:** 2

## Accomplishments
- Added IMAGE_DRAW params.extra.mode routing to executor.py for character consistency workflows
- IP-Adapter mode routes to build_flux_ipadapter_workflow with reference_image validation
- PuLID mode routes to build_pulid_flux_workflow with image/reference_image validation
- InstantID mode reuses IP-Adapter infrastructure (build_flux_ipadapter_workflow)
- Unrecognized extra.mode values fall through to model-based routing (threat model T-18-02 mitigation)
- Legacy model="flux-dev" and model="flux-dev-ipa" backward compatibility preserved
- All 59 tests pass with zero regressions

## Task Commits

Each task was committed atomically:

1. **Task 1 (RED): Add TestCharacterConsistencyRouting tests** - `67dcf59` (test)
2. **Task 1 (GREEN): Add IMAGE_DRAW params.extra.mode routing** - `7d9352e` (feat)

## Files Created/Modified
- `docker/gold-team/src/v6/executor.py` - Added IMAGE_DRAW params.extra.mode routing branch with ipadapter/pulid/instantid modes
- `docker/gold-team/tests/test_executor_routing.py` - Added TestCharacterConsistencyRouting class with 9 tests

## Decisions Made
- params.extra.mode routing takes priority over model param (per research Pitfall 3)
- InstantID reuses IP-Adapter infrastructure rather than requiring a separate workflow builder
- Unrecognized extra.mode values silently fall through to model-based routing (per threat model T-18-02)
- Legacy model-based routing (flux-dev, flux-dev-ipa) preserved as fallback chain

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- docker/gold-team is in .gitignore, required `git add -f` to stage files. Pre-existing condition, not a plan issue.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- IMAGE_DRAW character consistency routing complete
- Ready for Phase 18 plan 03 (next routing or integration task)
- Lip sync (Phase 17 WFB-08) and frame interpolation routing confirmed working via regression tests

---
*Phase: 18-engine-registration-task-routing*
*Completed: 2026-06-12*

## Self-Check: PASSED

- FOUND: docker/gold-team/src/v6/executor.py
- FOUND: docker/gold-team/tests/test_executor_routing.py
- FOUND: .planning/phases/phase-18/18-02-SUMMARY.md
- FOUND: 67dcf59 (test commit)
- FOUND: 7d9352e (feat commit)
- Pattern "extra_mode.*ipadapter" present in executor.py
- Pattern "TestCharacterConsistencyRouting" present in test file
