---
phase: 17-workflow-builder-expansion
plan: 04
subsystem: executor-routing
tags: [comfyui, workflow-builder, lip-sync, frame-interpolation, rife, latentsync, params-extra-routing]

# Dependency graph
requires:
  - phase: 17-02
    provides: "build_lipsync_workflow and build_frame_interpolate_workflow functions in workflow_builder.py"
  - phase: 17-03
    provides: "TRELLIS routing pattern in executor.py (params.extra.mode check before default handler)"
provides:
  - "VIDEO_FINAL + params.extra.mode=lip_sync routing to build_lipsync_workflow"
  - "UPSCALE + params.extra.mode=frame_interp routing to build_frame_interpolate_workflow"
  - "Validation for missing video/audio_input params with FAILED status"
  - "8 new routing tests in test_executor_routing.py"
affects: [phase-18, phase-19]

# Tech tracking
tech-stack:
  added: []
  patterns: [params.extra.mode routing check before default handler in elif branches]

key-files:
  created: []
  modified:
    - "docker/gold-team/src/v6/executor.py — lip_sync and frame_interp routing in VIDEO_FINAL and UPSCALE branches"
    - "docker/gold-team/tests/test_executor_routing.py — 8 new routing tests for WFB-08"

key-decisions:
  - "params.extra.mode check placed BEFORE default handler to prevent default path from swallowing mode-specific requests"
  - "lip_sync requires both video and audio_input params; frame_interp requires video param"

patterns-established:
  - "params.extra.mode routing pattern: check mode first, fall through to else for default behavior (consistent with TRELLIS routing from Plan 17-03)"

requirements-completed: [WFB-08]

# Metrics
duration: 3min
completed: 2026-06-12
---

# Phase 17 Plan 04: Lip Sync & Frame Interp Routing Summary

**VIDEO_FINAL + lip_sync and UPSCALE + frame_interp executor routing with params.extra.mode discrimination, 8 routing tests, full regression suite passing (38 tests)**

## Performance

- **Duration:** 3 min
- **Started:** 2026-06-12T13:19:51Z
- **Completed:** 2026-06-12T13:23:12Z
- **Tasks:** 1
- **Files modified:** 2

## Accomplishments
- WFB-08 routing table complete: lip_sync and frame_interp callable through API
- VIDEO_FINAL + params.extra.mode="lip_sync" triggers LatentSync workflow
- UPSCALE + params.extra.mode="frame_interp" triggers RIFE workflow
- Default VIDEO_FINAL (wan_i2v) and UPSCALE (image upscale) preserved as regression tests
- Missing param validation returns FAILED status with descriptive error messages
- Full test suite (38 tests) passes with zero failures

## Task Commits

Each task was committed atomically (TDD: RED then GREEN):

1. **Task 1 (RED): Routing tests** - `9fc1b10` (test)
2. **Task 1 (GREEN): Executor routing implementation** - `a0a3780` (feat)

## Files Created/Modified
- `docker/gold-team/src/v6/executor.py` - Added lip_sync routing in VIDEO_FINAL branch and frame_interp routing in UPSCALE branch
- `docker/gold-team/tests/test_executor_routing.py` - Added TestLipSyncRouting (5 tests) and TestFrameInterpRouting (3 tests)

## Decisions Made
- params.extra.mode check placed BEFORE default handler in both branches (matches TRELLIS pattern from 17-03, avoids pitfall 4 from research)
- lip_sync requires both `video` and `audio_input` params; missing either sets task to FAILED with descriptive error
- frame_interp requires `video` param; missing sets task to FAILED

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- docker/gold-team is in .gitignore, required `git add -f` to stage files (consistent with previous plans in this phase)

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 17 complete (all 4 plans delivered). WFB-01 through WFB-08 satisfied.
- Ready for Phase 18: Engine Registration & Task Routing (unified engine registration by backend type)
- Executor routing table has all Phase 17 entries: FLUX Dev, FLUX IP-Adapter, TRELLIS, FLUX+TRELLIS, LatentSync, RIFE, plus existing wan_i2v, upscale, face_restore, etc.

## Self-Check: PASSED

All files verified present. Both task commits verified in git log.

---
*Phase: 17-workflow-builder-expansion*
*Completed: 2026-06-12*
