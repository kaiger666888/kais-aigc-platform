---
phase: 18-engine-registration-task-routing
plan: 01
subsystem: api
tags: [enum, backend-type, engine-classification, pytest]

# Dependency graph
requires:
  - phase: 17-workflow-builder-expansion
    provides: Engine class hierarchy with ComfyUIEngine, workflow_builder pattern
provides:
  - BackendType enum with 5 values in base.py
  - backend_type property on BaseEngine and all 10+ subclasses
  - Unit tests for backend_type classification and ComfyUI architecture verification
affects: [18-02, 18-03, 19-integration-verification]

# Tech tracking
tech-stack:
  added: []
  patterns: [BackendType enum on BaseEngine, default MOCK override pattern]

key-files:
  created:
    - docker/gold-team/tests/test_engine_registration.py
  modified:
    - docker/gold-team/src/v6/engines/base.py
    - docker/gold-team/src/v6/engines/comfyui.py
    - docker/gold-team/src/v6/engines/cloud_base.py
    - docker/gold-team/src/v6/engines/docker_base.py
    - docker/gold-team/src/v6/engines/docker_cli.py
    - docker/gold-team/src/v6/engines/hunyuan3d.py
    - docker/gold-team/src/v6/engines/hunyuan3d_mv.py
    - docker/gold-team/src/v6/engines/tts.py
    - docker/gold-team/src/v6/engines/tts_http.py
    - docker/gold-team/src/v6/engines/joycaption.py

key-decisions:
  - "BackendType is a str enum with 5 values: COMFYUI, SUBPROCESS, CLOUD, DOCKER, MOCK"
  - "BaseEngine returns MOCK as default backend_type, subclasses override as needed"
  - "JoyCaptionEngine classified as COMFYUI since it talks to ComfyUI via HTTP"
  - "MockEngine inherits MOCK from BaseEngine default without explicit override"
  - "BaseCloudEngine override covers all cloud subclasses (Jimeng, Kling, Seedance) via inheritance"
  - "DockerAPIEngine override covers DockerPollingAPIEngine and FaceFusionEngine via inheritance"

patterns-established:
  - "BackendType enum pattern: str enum with lowercase string values, placed after EngineStatus in base.py"
  - "backend_type property pattern: non-abstract property on BaseEngine with MOCK default, overridden in concrete subclasses"

requirements-completed: [ENG-01, ENG-02, ENG-04]

# Metrics
duration: 3min
completed: 2026-06-12
---

# Phase 18 Plan 01: BackendType Enum & Engine Classification Summary

**BackendType str enum (COMFYUI/SUBPROCESS/CLOUD/DOCKER/MOCK) added to BaseEngine with backend_type property override in all 10 engine subclasses, verified by 12 unit tests**

## Performance

- **Duration:** 3 min
- **Started:** 2026-06-12T13:51:50Z
- **Completed:** 2026-06-12T13:54:52Z
- **Tasks:** 2
- **Files modified:** 11

## Accomplishments
- BackendType enum with 5 values established as the engine classification system
- Every engine subclass returns correct BackendType via property override or inheritance
- ComfyUI architecture verified: no per-model subclasses, all go through ComfyUIEngine + workflow_builder
- Full test suite green: 50 tests (38 existing + 12 new), zero regressions

## Task Commits

Each task was committed atomically:

1. **Task 1 (RED): Failing tests for BackendType classification** - `ff730ae` (test)
2. **Task 1 (GREEN): BackendType enum + all engine overrides** - `8ae8b22` (feat)
3. **Task 2: ComfyUI architecture verification tests** - `e955647` (test)

_Note: Task 1 was TDD with RED/GREEN phases committed separately._

## Files Created/Modified
- `docker/gold-team/src/v6/engines/base.py` - Added BackendType enum and backend_type property to BaseEngine
- `docker/gold-team/src/v6/engines/comfyui.py` - Override backend_type to COMFYUI
- `docker/gold-team/src/v6/engines/cloud_base.py` - Override backend_type to CLOUD in BaseCloudEngine
- `docker/gold-team/src/v6/engines/docker_base.py` - Override backend_type to DOCKER in DockerAPIEngine
- `docker/gold-team/src/v6/engines/docker_cli.py` - Override backend_type to DOCKER in DockerCLIEngine
- `docker/gold-team/src/v6/engines/hunyuan3d.py` - Override backend_type to SUBPROCESS in Hunyuan3DEngine
- `docker/gold-team/src/v6/engines/hunyuan3d_mv.py` - Override backend_type to SUBPROCESS in Hunyuan3DMvEngine
- `docker/gold-team/src/v6/engines/tts.py` - Override backend_type to SUBPROCESS in TTSTracker
- `docker/gold-team/src/v6/engines/tts_http.py` - Override backend_type to SUBPROCESS in TripleTrackTTSEngine
- `docker/gold-team/src/v6/engines/joycaption.py` - Override backend_type to COMFYUI in JoyCaptionEngine
- `docker/gold-team/tests/test_engine_registration.py` - 12 new tests (10 classification + 2 architecture)

## Decisions Made
- BackendType as str enum (not int enum) for human-readable serialization in API responses
- MockEngine does NOT override backend_type -- inherits MOCK from BaseEngine default, keeping the base class as the single source of the default
- Cloud and Docker base classes override backend_type, so all subclasses (Jimeng, Kling, Seedance, DockerPolling, FaceFusion) inherit the correct type automatically

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- BackendType enum and backend_type property ready for Plan 02 (params.extra routing) and Plan 03 (main.py registration grouping + engines API)
- All engine classes now self-describe their backend category, enabling grouped registration in main.py

---
*Phase: 18-engine-registration-task-routing*
*Completed: 2026-06-12*

## Self-Check: PASSED

All 11 source/test files verified present. All 3 commits verified in git log.
