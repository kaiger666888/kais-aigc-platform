---
phase: 19-integration-verification
plan: 03
type: execute
gap_closure: true
status: complete
started: 2026-06-12T23:05:00Z
completed: 2026-06-12T23:10:00Z

key-files:
  modified:
    - docker/gold-team/tests/test_integration_pipeline.py — Added FACE_RESTORE step to pipeline chain test and new individual step test

self-check: PASSED
---

## Plan 19-03: Face Restoration Pipeline Step (Gap Closure)

**Objective:** Add missing face restoration step to the short-drama pipeline chain test to satisfy ROADMAP Success Criterion 1.

### What was done

1. Added `FACE_RESTORE` case to `_build_workflow_for_task` helper, importing and calling `build_face_restore_workflow`
2. Added `test_step6_face_restore` individual step test verifying UpscaleModelLoader and ImageUpscaleWithModel nodes
3. Updated `test_full_pipeline_chain` to include Step 6 (FACE_RESTORE after super-resolution), changed assertion from 5 to 6 outputs
4. Updated module docstring to reflect 6-step pipeline

### Test Results

- Pipeline tests: 7 passed (was 6)
- Full suite: 102 passed, 0 failed (was 101)

### Deviations

None — implemented exactly as planned.

### Gap Closed

ROADMAP SC1 now covers all 6 steps: IMAGE_DRAW → VIDEO_FINAL → lip_sync → frame_interp → upscale → face_restore
