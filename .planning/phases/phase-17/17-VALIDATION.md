---
phase: 17
slug: workflow-builder-expansion
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-12
---

# Phase 17 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest (existing in project) |
| **Config file** | pyproject.toml |
| **Quick run command** | `pytest tests/ -x -q --timeout=30` |
| **Full suite command** | `pytest tests/ -v --timeout=120` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pytest tests/test_workflow_builder.py tests/test_executor_routing.py -x -q`
- **After every plan wave:** Run `pytest tests/ -v --timeout=120`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 17-01-01 | 01 | 1 | WFB-01 | — | N/A | unit | `pytest tests/test_workflow_builder.py::test_build_flux_dev_workflow -x` | ❌ W0 | ⬜ pending |
| 17-01-02 | 01 | 1 | WFB-02 | — | N/A | unit | `pytest tests/test_workflow_builder.py::test_build_flux_ipadapter_workflow -x` | ❌ W0 | ⬜ pending |
| 17-02-01 | 02 | 1 | WFB-03 | — | N/A | unit | `pytest tests/test_workflow_builder.py::test_build_hunyuan3d_workflow -x` | ❌ W0 | ⬜ pending |
| 17-02-02 | 02 | 1 | WFB-04 | — | N/A | unit | `pytest tests/test_executor_routing.py::test_image_to_3d_trellis_routing -x` | ❌ W0 | ⬜ pending |
| 17-02-03 | 02 | 1 | WFB-05 | — | N/A | unit | `pytest tests/test_executor_routing.py::test_image_to_3d_flux_trellis_routing -x` | ❌ W0 | ⬜ pending |
| 17-03-01 | 03 | 1 | WFB-06 | T-17-01 | Validate video_input/audio_input filenames reject `..` and absolute paths | unit | `pytest tests/test_workflow_builder.py::test_build_lipsync_workflow -x` | ❌ W0 | ⬜ pending |
| 17-03-02 | 03 | 2 | WFB-07 | T-17-01 | Validate video_input filenames reject `..` and absolute paths | unit | `pytest tests/test_workflow_builder.py::test_build_frame_interpolate_workflow -x` | ❌ W0 | ⬜ pending |
| 17-04-01 | 04 | 2 | WFB-08 | — | N/A | unit | `pytest tests/test_executor_routing.py::test_video_final_lip_sync_routing -x` | ❌ W0 | ⬜ pending |
| 17-04-02 | 04 | 2 | WFB-08 | — | N/A | unit | `pytest tests/test_executor_routing.py::test_upscale_frame_interp_routing -x` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/test_workflow_builder.py` — unit tests for all workflow builders (new + existing verification)
- [ ] `tests/test_executor_routing.py` — unit tests for routing logic with params.extra discrimination
- [ ] Test fixtures: sample task params dicts for each workflow type

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| LatentSync produces synced video | WFB-06 | Requires GPU + ComfyUI runtime with LatentSync custom nodes | Submit VIDEO_FINAL task with params.extra.mode="lip_sync" via API, verify output MP4 has lip-synced audio |
| RIFE produces interpolated video | WFB-07 | Requires GPU + ComfyUI runtime with RIFE custom nodes | Submit UPSCALE task with params.extra.mode="frame_interp" via API, verify output has N*2 frames |
| FLUX Dev generates image | WFB-01 | Requires GPU + ComfyUI runtime | Submit IMAGE_DRAW task with model="flux-dev", verify image output |
| FLUX + IP-Adapter preserves face | WFB-02 | Requires GPU + ComfyUI runtime + reference image | Submit IMAGE_DRAW task with reference image, verify face consistency |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
