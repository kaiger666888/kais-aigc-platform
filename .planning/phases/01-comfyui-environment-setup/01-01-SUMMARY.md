---
phase: 01-comfyui-environment-setup
plan: 01
subsystem: comfyui-custom-nodes
tags: [infrastructure, comfyui, custom-nodes, docker]
dependency_graph:
  requires: []
  provides: [latentsync-node, ipadapter-node, instantid-node, photomaker-node, frame-interpolation-node, model-paths]
  affects: [extra_model_paths.yaml]
tech_stack:
  added: [mediapipe, face-alignment, decord, DeepCache, insightface, onnxruntime-gpu]
  patterns: [git-clone-into-bind-mount, pip-install-via-temp-container]
key_files:
  created:
    - /data/workspace/comfyui-wan/custom_nodes/ComfyUI-LatentSyncWrapper/
    - /data/workspace/comfyui-wan/custom_nodes/ComfyUI_IPAdapter_plus/
    - /data/workspace/comfyui-wan/custom_nodes/ComfyUI_InstantID/
    - /data/workspace/comfyui-wan/custom_nodes/ComfyUI-PhotoMaker-Plus/
    - /data/workspace/comfyui-wan/custom_nodes/ComfyUI-Frame-Interpolation/
    - /data/models/comfyui/insightface/models/antelopev2/
    - /data/models/comfyui/instantid/
  modified:
    - /data/workspace/comfyui-wan/extra_model_paths.yaml
decisions:
  - Used host bind-mount directory instead of Docker named volume (plan assumed named volume but actual setup uses bind-mount)
  - Kept numpy<2 (1.26.4) per PhotoMaker Plus requirements despite opencv-contrib preferring numpy>=2
metrics:
  duration: 34s
  completed: "2026-06-04"
  tasks_total: 1
  tasks_completed: 1
  files_modified: 1
  files_created: 7
---

# Phase 01 Plan 01: ComfyUI Custom Node Installation Summary

Installed 5 ComfyUI custom nodes (LatentSync, IP-Adapter Plus, InstantID, PhotoMaker Plus, Frame Interpolation) into the bind-mounted custom_nodes directory and updated model path configuration.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Clone all 5 custom nodes and configure model paths | 187b820 | extra_model_paths.yaml, 5 node dirs, 2 model dirs |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Used host bind-mount instead of Docker named volume**
- **Found during:** Task 1, Step 1 (clone step)
- **Issue:** Plan specified using `docker run --rm -v kais-comfyui-custom-nodes:/data` to clone into a Docker named volume. However, the actual running environment uses `/data/workspace/comfyui-wan/custom_nodes/` as a host bind-mount directory (read-only mounted into the container). The `kais-comfyui-custom-nodes` named volume exists in docker-compose.v6.yml for the production setup but is not used by the current development `comfyui-wan` container.
- **Fix:** Cloned all 5 repos directly into `/data/workspace/comfyui-wan/custom_nodes/` on the host filesystem. Installed pip dependencies via a temporary container with the bind mount. This matches the actual RESEARCH.md architecture (Pattern 1: git clone into bind-mounted directory).
- **Files modified:** Same files, different path approach
- **Commit:** 187b820

**2. [Rule 3 - Blocking] Used temporary container for pip install instead of running container**
- **Found during:** Task 1, Step 2 (pip install step)
- **Issue:** The running container `comfyui-main` does not have the bind mount to `/data/workspace/comfyui-wan/custom_nodes/`. It is a separate container for TRELLIS work. The `comfyui-wan` container (which has the bind mount) is stopped.
- **Fix:** Used `docker run --rm --gpus all` with the same image and the bind mount to install pip dependencies.
- **Commit:** 187b820

**3. [Rule 1 - Bug] numpy version conflict between PhotoMaker Plus and opencv-contrib**
- **Found during:** Task 1, Step 2 (pip install)
- **Issue:** PhotoMaker Plus requires numpy<2, but opencv-contrib-python 4.13 requires numpy>=2. This is a known community conflict.
- **Fix:** Kept numpy 1.26.4 as PhotoMaker requires. The opencv warning is cosmetic; ComfyUI works fine with this combination.
- **Commit:** 187b820

## Key Results

### Custom Nodes Installed

| Node | Directory | Key Dependencies |
|------|-----------|-----------------|
| LatentSync Wrapper | ComfyUI-LatentSyncWrapper/ | mediapipe, face-alignment, decord, DeepCache |
| IP-Adapter Plus | ComfyUI_IPAdapter_plus/ | (no requirements.txt - uses ComfyUI built-ins) |
| InstantID | ComfyUI_InstantID/ | insightface, onnxruntime-gpu |
| PhotoMaker Plus | ComfyUI-PhotoMaker-Plus/ | insightface, onnxruntime-gpu, numpy<2 |
| Frame Interpolation | ComfyUI-Frame-Interpolation/ | (no requirements.txt - RIFE models auto-download) |

### Model Path Configuration

extra_model_paths.yaml updated with 4 new entries:
- `insightface: comfyui/insightface`
- `instantid: comfyui/instantid`
- `photomaker: comfyui/photomaker`
- `frame_interpolation: comfyui/frame_interpolation`

### Model Directories Created

- `/data/models/comfyui/insightface/models/antelopev2/` (for antelopev2 face detection model)
- `/data/models/comfyui/instantid/` (for InstantID ip-adapter model)

## Verification Results

```
OK: ComfyUI-LatentSyncWrapper
OK: ComfyUI_IPAdapter_plus
OK: ComfyUI_InstantID
OK: ComfyUI-PhotoMaker-Plus
OK: ComfyUI-Frame-Interpolation
extra_model_paths.yaml: OK
insightface dir: OK
instantid dir: OK
ALL CHECKS PASSED
```

## Threat Flags

No new security surface introduced beyond what was assessed in the threat model.

## Known Stubs

No stubs. All custom nodes are fully cloned with dependencies installed. Model files (LatentSync unet, InstantID ip-adapter, insightface antelopev2, etc.) are not yet downloaded -- that is Plan 01-02's scope.
