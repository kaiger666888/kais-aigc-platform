---
phase: 17-workflow-builder-expansion
plan: 01
subsystem: gold-team/workflow-builder
tags: [testing, workflow-builder, comfyui, pytest]
dependency_graph:
  requires: [workflow_builder.py]
  provides: [tests/conftest.py, tests/test_workflow_builder.py]
  affects: []
tech_stack:
  added: [pytest]
  patterns: [unit-test, sys.path-fixture, node-graph-assertion]
key_files:
  created:
    - docker/gold-team/tests/__init__.py
    - docker/gold-team/tests/conftest.py
    - docker/gold-team/tests/test_workflow_builder.py
  modified: []
decisions:
  - Class-based test grouping by builder function for readability
  - autouse sys.path fixture so all tests can import src.v6 without boilerplate
  - hunyuan3d test asserts flat-dict structure (not ComfyUI node graph)
metrics:
  duration: ~2min
  completed: "2026-06-12"
  tasks: 1
  files: 3
---

# Phase 17 Plan 01: Workflow Builder Test Infrastructure Summary

Test harness for ComfyUI workflow builders, verifying existing builders produce correct node graphs before new builders are added.

## What Was Done

Created `docker/gold-team/tests/` with 5 passing unit tests covering the 3 existing workflow builders:

1. **test_build_flux_dev_workflow** (WFB-01) -- Verifies UNETLoader, CLIPTextEncode, KSampler, VAEDecode, SaveImage, EmptySD3LatentImage nodes with correct class_types, wiring, and default parameters.

2. **test_build_flux_dev_workflow_custom_params** -- Verifies custom width/height/steps/cfg_scale/seed are propagated correctly through the node graph.

3. **test_build_flux_ipadapter_workflow** (WFB-02) -- Verifies IPAdapterFluxLoader, LoadImage, ApplyIPAdapterFlux nodes and that KSampler uses IPAdapter-modified model from node 12.

4. **test_build_flux_ipadapter_workflow_custom_weight** -- Verifies custom weight/start_percent/end_percent passthrough to ApplyIPAdapterFlux.

5. **test_build_hunyuan3d_workflow** (WFB-03) -- Verifies flat subprocess parameter dict (not ComfyUI node graph), input_image, output_path with task_id, and default model/steps values.

## Verification

```
5 passed in 2.00s
```

## Deviations from Plan

None -- plan executed exactly as written.

## Commits

| Hash | Message |
|------|---------|
| 5e33476 | test(17-01): add workflow builder unit tests for flux_dev, flux_ipadapter, hunyuan3d |

## Self-Check: PASSED

- docker/gold-team/tests/__init__.py: FOUND
- docker/gold-team/tests/conftest.py: FOUND
- docker/gold-team/tests/test_workflow_builder.py: FOUND
- 5e33476: FOUND
