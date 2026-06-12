---
phase: 17-workflow-builder-expansion
plan: 02
subsystem: workflow-builder
tags: [comfyui, lipsync, frame-interpolation, rife, latentsync, tdd]
dependency_graph:
  requires: [17-01]
  provides: [build_lipsync_workflow, build_frame_interpolate_workflow]
  affects: [workflow_builder.py, test_workflow_builder.py]
tech_stack:
  added: []
  patterns: [ComfyUI numbered-node dict, VHS_LoadVideo+VHS_VideoCombine video pipeline, RIFE multiplier mapping]
key_files:
  created: []
  modified:
    - docker/gold-team/src/v6/engines/workflow_builder.py
    - docker/gold-team/tests/test_workflow_builder.py
decisions:
  - RIFE multiplier = interpolation_factor - 1 (2x->1, 4x->3, 8x->7)
  - URL-based audio_input allowed for lipsync (http/https bypass path validation)
  - output_fps defaults to 25 for lipsync (LatentSync standard) and 30 for frame interpolation
metrics:
  duration: ~4min
  completed: 2026-06-12
  tasks: 2
  files: 2
  tests_added: 19
---

# Phase 17 Plan 02: Lip Sync and Frame Interpolation Workflow Builders Summary

Implemented the two remaining workflow builder functions: `build_lipsync_workflow` (WFB-06) using LatentSync and `build_frame_interpolate_workflow` (WFB-07) using RIFE VFI. Both follow TDD with RED/GREEN gates committed separately.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | build_lipsync_workflow (WFB-06) | dd0221e (RED), 3401141 (GREEN) | workflow_builder.py, test_workflow_builder.py |
| 2 | build_frame_interpolate_workflow (WFB-07) | da32349 (RED), edb9269 (GREEN) | workflow_builder.py, test_workflow_builder.py |

## Key Results

### build_lipsync_workflow (WFB-06)
- 4-node ComfyUI pipeline: VHS_LoadVideo -> LoadAudio -> LatentSyncNode -> VHS_VideoCombine
- Path traversal validation on both `video_input` and `audio_input`
- URL-based audio accepted (http/https bypass path checks)
- Configurable `lips_expression` (1.0-3.0), `inference_steps`, `output_fps` (default 25)

### build_frame_interpolate_workflow (WFB-07)
- 3-node ComfyUI pipeline: VHS_LoadVideo -> RIFE VFI -> VHS_VideoCombine
- Correct multiplier mapping: `multiplier = interpolation_factor - 1`
- Configurable `ckpt_name`, `output_fps` (default 30)
- Path traversal validation on `video_input`

## TDD Gate Compliance

- Task 1: RED `dd0221e` -> GREEN `3401141` (9 tests)
- Task 2: RED `da32349` -> GREEN `edb9269` (10 tests)
- Both gates present and in correct order.

## Deviations from Plan

None - plan executed exactly as written.

## Threat Mitigation Verification

| Threat ID | Mitigation | Status |
|-----------|------------|--------|
| T-17-01 | Path traversal validation on video_input/audio_input in build_lipsync_workflow | Verified via tests 8 & 9 |
| T-17-02 | Path traversal validation on video_input in build_frame_interpolate_workflow | Verified via test 10 |
| T-17-03 | All class_type values hardcoded in builder code | Verified - no user-injectable node types |

## Verification

```
24 tests passed, 0 failed
- 5 existing tests (WFB-01 through WFB-03) - no regressions
- 9 new lipsync tests (WFB-06)
- 10 new frame interpolation tests (WFB-07)
```

## Self-Check: PASSED

All files exist, all commits verified in git log.
