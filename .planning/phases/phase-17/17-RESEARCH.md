# Phase 17: Workflow Builder Expansion - Research

**Researched:** 2026-06-12
**Domain:** ComfyUI workflow builder patterns, executor routing, LatentSync/RIFE node integration
**Confidence:** HIGH

## Summary

Phase 17 adds two new ComfyUI workflow builders (LatentSync lip sync and RIFE frame interpolation) and wires all unregistered workflows into the executor routing chain. The existing codebase has 13 workflow builder functions in `workflow_builder.py` and a monolithic if/elif routing chain in `executor.py` (lines 128-402). Five of those builders (WFB-01 through WFB-05) already exist but some lack routing entries; the two new builders (WFB-06, WFB-07) require understanding of the LatentSync and RIFE ComfyUI custom node APIs.

LatentSync's ComfyUI wrapper node (`LatentSyncNode`) accepts IMAGE tensor batches and AUDIO waveforms, not video file paths. This means the workflow builder must compose a pipeline: video loading (frames extraction) + audio loading + LatentSyncNode + VHS_VideoCombine output. RIFE VFI similarly operates on IMAGE tensor batches, requiring a video-to-frames-to-interpolated-frames-to-video pipeline. Both follow the same ComfyUI pattern established by `build_wan21_i2v_dual_stage_workflow` which uses `VHS_VideoCombine` for video output.

**Primary recommendation:** Follow the established numbered-node dict pattern from existing builders. For routing, insert `params.extra.mode` checks at the TOP of the relevant if/elif branches (before the existing fallback) so lip_sync and frame_interp intercept before the default wan_i2v/upscale paths.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Lip sync audio input: accept both file path and URL via `audio_input` param -- flexible, matches existing patterns
- Lip sync output format: MP4 video file -- standard, matches video pipeline
- RIFE frame interpolation factor: configurable via `interpolation_factor` param (2x/4x/8x) -- user controls quality vs speed
- RIFE input format: video file input -- simpler API, matches user mental model
- TRELLIS workflow routes through `IMAGE_TO_3D` with `params.extra.engine="trellis"` to distinguish from Hunyuan3D
- FLUX+TRELLIS full chain routes through `IMAGE_TO_3D` with `params.extra.mode="flux_trellis"` -- end-to-end pipeline
- Lip sync routes via `VIDEO_FINAL` + `params.extra.mode="lip_sync"` -- matches TASK-01 spec
- Frame interpolation routes via `UPSCALE` + `params.extra.mode="frame_interp"` -- matches TASK-02 spec

### Claude's Discretion
Exact ComfyUI node IDs, parameter naming conventions, and workflow JSON structure are at Claude's discretion -- follow existing patterns in workflow_builder.py.

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| WFB-01 | Verify `build_flux_dev_workflow` exists and register in routing | Verified: function exists at workflow_builder.py:23, already routed at executor.py:177 |
| WFB-02 | Verify `build_flux_ipadapter_workflow` exists and register in routing | Verified: function exists at workflow_builder.py (after flux_dev), routed via model=="flux-dev-ipa" at executor.py:189 |
| WFB-03 | Verify `build_hunyuan3d_workflow` exists and register in routing | Verified: function exists, routed at executor.py:155 via IMAGE_TO_3D |
| WFB-04 | Verify `build_trellis_image_to_3d_workflow` exists and register in routing | Verified: function exists at workflow_builder.py (~line 480), NOT routed in executor.py |
| WFB-05 | Verify `build_flux_trellis_full_workflow` exists and register in routing | Verified: function exists at workflow_builder.py (~line 587), NOT routed in executor.py |
| WFB-06 | Implement `build_lipsync_workflow` (LatentSync, params.extra.mode routing) | New builder; LatentSync node API documented below, pipeline: LoadVideo+LoadAudio+LatentSyncNode+VHS_VideoCombine |
| WFB-07 | Implement `build_frame_interpolate_workflow` (RIFE, params.extra.mode routing) | New builder; RIFE VFI node API documented below, pipeline: LoadVideo+RIFE_VFI+VHS_VideoCombine |
| WFB-08 | Update workflow_builder routing table with all new entries | Routing is if/elif chain in executor.py:128-402; insert params.extra checks before existing fallbacks |
| TASK-01 | Lip sync via VIDEO_FINAL + params.extra.mode="lip_sync" | Insert mode check before wan_i2v fallback at executor.py:274 |
| TASK-02 | Frame interpolation via UPSCALE + params.extra.mode="frame_interp" | Insert mode check before upscale fallback at executor.py:296 |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| ComfyUI workflow JSON construction | API / Backend | -- | workflow_builder.py builds API-format dicts consumed by ComfyUIEngine |
| Task type routing logic | API / Backend | -- | executor.py routes TaskType+params to the correct builder function |
| LatentSync inference | GPU / ComfyUI | -- | Runs inside ComfyUI process on RTX 3090 (~20GB VRAM) |
| RIFE frame interpolation | GPU / ComfyUI | -- | Runs inside ComfyUI process, moderate VRAM |
| Video file I/O | GPU / ComfyUI | -- | ComfyUI handles video loading (frames) and saving (VHS_VideoCombine) |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| (no new packages) | -- | -- | Phase modifies existing Python code only |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| ComfyUI-LatentSyncWrapper | [ASSUMED] | LatentSync ComfyUI node | Must be installed in ComfyUI custom_nodes before lip sync works |
| ComfyUI-Frame-Interpolation | [ASSUMED] | RIFE VFI ComfyUI node | Must be installed in ComfyUI custom_nodes before frame interp works |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| LatentSync via ComfyUI node | FaceFusion lip_syncer (already in codebase) | FaceFusion is subprocess-based, less flexible, but already deployed. LatentSync chosen for quality. |

**Installation:**
```bash
# No pip installs needed -- this phase modifies existing Python files only.
# ComfyUI custom nodes (LatentSync, RIFE) must be pre-installed on the ComfyUI instance.
```

**Version verification:** Not applicable -- no new packages.

## Package Legitimacy Audit

> No new packages installed in this phase. Phase modifies existing Python code files only.
> ComfyUI custom nodes (LatentSync, RIFE) are dependencies of the running ComfyUI instance, not pip packages in this project.

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
TaskRequest (API)
    |
    v
executor.py: _execute_task()
    |
    +--> DEDICATED_ENGINES check (router.py)
    |       |
    |       +--> IMAGE_TO_3D --> hunyuan3d-local
    |       |       |
    |       |       +--> params.extra.engine="trellis"? --> bypass to ComfyUI + TRELLIS builder  [NEW]
    |       |       +--> params.extra.mode="flux_trellis"? --> bypass to ComfyUI + FLUX+TRELLIS builder  [NEW]
    |       |
    |       +--> MUSIC/SFX --> acestep-internal
    |       +--> TTS variants --> tts-tracker
    |
    +--> ComfyUI workflow builder selection (if/elif chain)
            |
            +--> VIDEO_FINAL?
            |       |
            |       +--> params.extra.mode="lip_sync"? --> build_lipsync_workflow()  [NEW]
            |       +--> else --> build_wan21_i2v_dual_stage_workflow() (existing)
            |
            +--> UPSCALE?
            |       |
            |       +--> params.extra.mode="frame_interp"? --> build_frame_interpolate_workflow()  [NEW]
            |       +--> else --> build_upscale_workflow() (existing)
            |
            +--> IMAGE_TO_3D? --> build_hunyuan3d_workflow() (existing, handles non-TRELLIS)
            +--> ... other existing types ...
```

### Recommended Project Structure
```
docker/gold-team/src/v6/
├── engines/
│   ├── workflow_builder.py    # ADD: build_lipsync_workflow, build_frame_interpolate_workflow
│   ├── comfyui.py             # NO CHANGES -- existing ComfyUIEngine handles all workflows
│   ├── facefusion.py          # NO CHANGES -- reference for lip_syncer subprocess
│   └── ...
├── executor.py                # MODIFY: routing if/elif chain (add params.extra checks)
├── engine/
│   └── router.py              # MODIFY: add VRAM estimates for new workflows
└── models/
    └── task.py                # NO CHANGES -- TaskType enum already sufficient
```

### Pattern 1: ComfyUI Workflow Builder Function
**What:** Each workflow is a function returning a `dict[str, Any]` with string-numbered keys mapping to node definitions.
**When to use:** Every ComfyUI workflow must follow this pattern.
**Example:**
```python
# Source: workflow_builder.py:68-104 (build_flux_dev_workflow)
def build_something_workflow(
    param1: str,
    seed: int | None = None,
) -> dict[str, Any]:
    import random
    if seed is None:
        seed = random.randint(0, 2**32 - 1)

    workflow = {
        "1": {  # Node 1
            "class_type": "LoadImage",
            "inputs": {
                "image": param1,
            },
        },
        "2": {  # Node 2 (references Node 1 output)
            "class_type": "SaveImage",
            "inputs": {
                "images": ["1", 0],  # ["source_node_id", output_index]
                "filename_prefix": "output",
            },
        },
    }
    return workflow
```

### Pattern 2: Video Output via VHS_VideoCombine
**What:** All video-producing workflows use VHS_VideoCombine to encode frames as MP4.
**When to use:** Any workflow that outputs a video file.
**Example:**
```python
# Source: workflow_builder.py:1234-1245 (build_wan21_i2v_dual_stage_workflow)
"14": {
    "class_type": "VHS_VideoCombine",
    "inputs": {
        "images": ["13", 0],         # frames from upstream node
        "frame_rate": 16,             # output FPS
        "loop_count": 0,
        "filename_prefix": filename_prefix,
        "format": "video/h264-mp4",   # MP4 container with H.264
        "pingpong": False,
        "save_output": True,
    },
},
```

### Pattern 3: Executor Routing with params.extra Discrimination
**What:** The executor checks `params.extra.mode` to route sub-types within a TaskType.
**When to use:** When multiple workflows share a TaskType (e.g., VIDEO_FINAL has both wan_i2v and lip_sync).
**Example:**
```python
# PATTERN: Check params.extra.mode BEFORE the default behavior
# Insert at executor.py BEFORE the existing VIDEO_FINAL/VIDEO_PREVIEW handler (line 274)

# -- NEW: Lip sync via VIDEO_FINAL + params.extra.mode --
extra_mode = task.params.get("extra", {}).get("mode", "")
if extra_mode == "lip_sync":
    from src.v6.engines.workflow_builder import build_lipsync_workflow
    workflow = build_lipsync_workflow(
        video_input=task.params.get("video", ""),
        audio_input=task.params.get("audio_input", ""),
        # ... other params
    )
    logger.info("Auto-built LipSync workflow for task %s", task.task_id)
else:
    # -- EXISTING: VIDEO_FINAL/VIDEO_PREVIEW = wan_i2v --
    from src.v6.engines.workflow_builder import build_wan21_i2v_dual_stage_workflow
    # ... existing code
```

### Anti-Patterns to Avoid
- **Adding new TaskType enums for sub-modes:** Do NOT add LIPE_SYNC or FRAME_INTERP to the TaskType enum. The design explicitly routes through existing types via params.extra.mode. [VERIFIED: CONTEXT.md locked decision]
- **Checking params.extra AFTER the default fallback:** The mode check must come BEFORE the existing wan_i2v/upscale paths, or the mode will never be reached.
- **Loading video files directly into LatentSync:** LatentSyncNode takes IMAGE tensors + AUDIO waveform, not video file paths. The workflow must decompose video into frames first.
- **Routing TRELLIS through DEDICATED_ENGINES:** IMAGE_TO_3D is dedicated to hunyuan3d-local. TRELLIS needs params.extra.engine check BEFORE or WITHIN the dedicated engine dispatch, not as a new dedicated engine entry.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Video frame extraction | Custom ffmpeg calls in Python | ComfyUI LoadVideo nodes (e.g., "VHS_LoadVideo" or "LoadVideo") | ComfyUI handles frame decoding, audio extraction, and memory management natively |
| Audio loading for lip sync | Custom audio file reading | ComfyUI "LoadAudio" node | ComfyUI provides standardized audio tensor output |
| Frame interpolation algorithm | Custom optical flow implementation | RIFE VFI ComfyUI node | RIFE is a trained neural network with complex temporal coherence logic |
| Lip sync inference | Custom face detection + mouth generation | LatentSyncNode ComfyUI node | LatentSync uses diffusion-based lip sync with sync loss -- extremely complex to replicate |
| Video encoding from frames | Custom ffmpeg pipe | VHS_VideoCombine node | Handles codec selection, container format, and streaming output |

**Key insight:** Every new workflow builder is pure configuration (ComfyUI node graph assembly). No inference logic should be written in Python -- all computation happens inside ComfyUI nodes.

## Common Pitfalls

### Pitfall 1: LatentSyncNode Input Types
**What goes wrong:** Passing a video file path string to LatentSyncNode expecting IMAGE tensor.
**Why it happens:** LatentSyncNode's INPUT_TYPES specify `("IMAGE",)` and `("AUDIO",)` -- these are ComfyUI tensor types, not file paths.
**How to avoid:** The workflow must include nodes that load video (extracting frames as IMAGE batch) and load audio (extracting waveform as AUDIO) before feeding them to LatentSyncNode.
**Warning signs:** Workflow submits successfully but ComfyUI returns a type mismatch error.

### Pitfall 2: RIFE Multiplier vs Factor
**What goes wrong:** Passing `interpolation_factor=2` to RIFE when it expects `multiplier` which means "number of intermediate frames between each pair", not total output frame count.
**Why it happens:** User says "2x" but RIFE's `multiplier` parameter means something different from a simple "2x" multiplication.
**How to avoid:** Map user-facing interpolation_factor (2x/4x/8x) to the correct RIFE multiplier value. Test with a short video first.
**Warning signs:** Output has wrong number of frames or excessive memory usage.

### Pitfall 3: LatentSync VRAM Requirements
**What goes wrong:** LatentSync runs on auxiliary GPU (RTX 3060 Ti, 8GB) and OOMs.
**Why it happens:** LatentSync requires ~20GB VRAM (UNET + SyncNet + Whisper + intermediate tensors).
**How to avoid:** Route lip sync tasks ONLY to comfyui-primary (RTX 3090). Add VRAM estimate to router.py VRAM_ESTIMATES dict.
**Warning signs:** ComfyUI returns OOM error during LatentSync execution.

### Pitfall 4: params.extra.mode Check Order in Executor
**What goes wrong:** Lip sync request hits the existing VIDEO_FINAL handler and runs wan_i2v instead.
**Why it happens:** The if/elif chain evaluates conditions top-to-bottom. If the existing VIDEO_FINAL branch runs first, the mode check never executes.
**How to avoid:** Insert the params.extra.mode check at the BEGINNING of the VIDEO_FINAL and UPSCALE branches, before the existing code.
**Warning signs:** Lip sync or frame interp requests produce wrong output type.

### Pitfall 5: IMAGE_TO_3D Dedicated Engine Bypass for TRELLIS
**What goes wrong:** TRELLIS request routes to hunyuan3d-local (dedicated engine) instead of ComfyUI with TRELLIS workflow.
**Why it happens:** DEDICATED_ENGINES maps IMAGE_TO_3D to hunyuan3d-local unconditionally. The executor checks DEDICATED_ENGINES first (via router.py), then falls through to the workflow builder chain.
**How to avoid:** Add params.extra.engine check in the DEDICATED_ENGINES dispatch path or in the IMAGE_TO_3D branch of the workflow builder. Two options: (A) check before DEDICATED_ENGINES lookup, or (B) handle within the IMAGE_TO_3D elif branch by checking params.extra.engine to decide between hunyuan3d and TRELLIS.
**Warning signs:** TRELLIS tasks run Hunyuan3D instead, or fail with wrong engine error.

### Pitfall 6: LatentSync Resolution and FPS Constraints
**What goes wrong:** LatentSync produces garbled output at non-standard resolutions.
**Why it happens:** LatentSync models are trained at 512x512 and 25 FPS. Different resolutions require resizing.
**How to avoid:** Include image resize nodes in the workflow to scale to 512x512 before LatentSyncNode, then scale back after. Set frame_rate to 25 in VHS_VideoCombine for lip sync output.
**Warning signs:** Distorted faces, poor lip sync quality, or ComfyUI shape mismatch errors.

## Code Examples

### Example 1: LatentSync Workflow Builder (WFB-06)
```python
# Source: LatentSyncNode input types from ShmuelRonen/ComfyUI-LatentSyncWrapper GitHub
# Node INPUT_TYPES:
#   images: ("IMAGE",)       -- batch of frame tensors
#   audio: ("AUDIO",)        -- audio waveform tensor
#   seed: INT default=1247
#   lips_expression: FLOAT default=1.5, min=1.0, max=3.0
#   inference_steps: INT default=20, min=1, max=999
# RETURN_TYPES: ("IMAGE", "AUDIO")
# FUNCTION: "inference"

def build_lipsync_workflow(
    video_input: str,          # video filename in ComfyUI input/ dir
    audio_input: str,          # audio filename in ComfyUI input/ dir
    seed: int | None = None,
    lips_expression: float = 1.5,
    inference_steps: int = 20,
    output_fps: int = 25,
    filename_prefix: str = "lipsync",
) -> dict[str, Any]:
    import random
    if seed is None:
        seed = random.randint(0, 2**32 - 1)

    workflow = {
        "1": {  # Load Video (extracts frames as IMAGE batch)
            "class_type": "VHS_LoadVideo",
            "inputs": {
                "video": video_input,
                "force_rate": 0,        # keep original fps
                "custom_width": -1,
                "custom_height": -1,
                "frame_start": 0,
                "frame_end": -1,
            },
        },
        "2": {  # Load Audio
            "class_type": "LoadAudio",
            "inputs": {
                "audio": audio_input,
            },
        },
        "3": {  # LatentSync Inference
            "class_type": "LatentSyncNode",
            "inputs": {
                "images": ["1", 0],           # frames from video
                "audio": ["2", 0],             # audio waveform
                "seed": seed,
                "lips_expression": lips_expression,
                "inference_steps": inference_steps,
            },
        },
        "4": {  # VHS_VideoCombine (output as MP4)
            "class_type": "VHS_VideoCombine",
            "inputs": {
                "images": ["3", 0],            # synced frames from LatentSync
                "frame_rate": output_fps,
                "loop_count": 0,
                "filename_prefix": filename_prefix,
                "format": "video/h264-mp4",
                "pingpong": False,
                "save_output": True,
            },
        },
    }
    return workflow
```

**Important notes on LatentSync:**
- LatentSync processes at 512x512 resolution internally. If input video is larger, the workflow may need ImageResize before and after the LatentSyncNode. This is at Claude's discretion per CONTEXT.md.
- VHS_LoadVideo returns `(IMAGE, AUDIO, ...)` -- the exact output indices may differ. Verify with `VHS_LoadVideo` node RETURN_TYPES in the installed ComfyUI instance. The pattern shown assumes frame images at output 0.
- Audio output from VHS_LoadVideo could potentially be used instead of a separate LoadAudio node, if the video already contains the desired audio track.

### Example 2: RIFE Frame Interpolation Workflow Builder (WFB-07)
```python
# Source: Fannovel16/ComfyUI-Frame-Interpolation GitHub
# RIFE VFI node:
#   class_type: "RIFE VFI"
#   Inputs: images (IMAGE), ckpt_name (string), multiplier (int)
#   Output: interpolated frames as IMAGE batch

def build_frame_interpolate_workflow(
    video_input: str,           # video filename in ComfyUI input/ dir
    interpolation_factor: int = 2,  # 2x, 4x, or 8x
    ckpt_name: str = "rife49.pth",
    output_fps: int | None = None,  # auto-doubling if None
    filename_prefix: str = "frame_interp",
) -> dict[str, Any]:
    # RIFE multiplier = (interpolation_factor - 1)
    # e.g., 2x interpolation = multiplier 1, 4x = multiplier 3, 8x = multiplier 7
    # OR: RIFE multiplier may directly mean "output N frames between each pair"
    # EXACT multiplier mapping needs verification against the installed RIFE node version
    multiplier = interpolation_factor - 1  # ASSUMED mapping

    # If output_fps not specified, read from video and multiply
    if output_fps is None:
        # Will need to match the input video FPS * interpolation_factor
        output_fps = 30  # default fallback; ideally extracted from input video

    workflow = {
        "1": {  # Load Video
            "class_type": "VHS_LoadVideo",
            "inputs": {
                "video": video_input,
                "force_rate": 0,
                "custom_width": -1,
                "custom_height": -1,
                "frame_start": 0,
                "frame_end": -1,
            },
        },
        "2": {  # RIFE Frame Interpolation
            "class_type": "RIFE VFI",
            "inputs": {
                "images": ["1", 0],
                "ckpt_name": ckpt_name,
                "multiplier": multiplier,
            },
        },
        "3": {  # VHS_VideoCombine
            "class_type": "VHS_VideoCombine",
            "inputs": {
                "images": ["2", 0],
                "frame_rate": output_fps,
                "loop_count": 0,
                "filename_prefix": filename_prefix,
                "format": "video/h264-mp4",
                "pingpong": False,
                "save_output": True,
            },
        },
    }
    return workflow
```

**Important notes on RIFE:**
- The exact `multiplier` parameter semantics may vary by RIFE node version. The standard RIFE VFI node from Fannovel16 uses `multiplier` as the number of intermediate frames to insert between each pair of consecutive input frames.
- Memory usage scales linearly with frame count. A 5-second 30fps video (150 frames) at 4x becomes 600 frames in memory simultaneously. Consider chunking for long videos.
- The `ckpt_name` must match the actual model file in the ComfyUI RIFE models directory.

### Example 3: Executor Routing Modification for VIDEO_FINAL + lip_sync (TASK-01)
```python
# Source: executor.py lines 274-295 (existing VIDEO_FINAL handler)
# MODIFY: Insert params.extra.mode check BEFORE existing wan_i2v fallback

elif task.type == TaskType.VIDEO_FINAL or task.type == TaskType.VIDEO_PREVIEW:
    extra_mode = task.params.get("extra", {}).get("mode", "")
    if extra_mode == "lip_sync":
        # -- Lip Sync via LatentSync --
        from src.v6.engines.workflow_builder import build_lipsync_workflow
        video_input = task.params.get("video", "")
        audio_input = task.params.get("audio_input", "")
        if not video_input or not audio_input:
            logger.error("Lip sync requires 'video' and 'audio_input' params, task %s", task.task_id)
            await store.update(task.task_id, status=TaskStatus.FAILED,
                               error="Lip sync requires 'video' and 'audio_input' params")
            return
        workflow = build_lipsync_workflow(
            video_input=video_input,
            audio_input=audio_input,
            seed=task.params.get("seed"),
            lips_expression=task.params.get("lips_expression", 1.5),
            inference_steps=task.params.get("inference_steps", 20),
            filename_prefix=task.params.get("filename_prefix", f"lipsync_{task.task_id}"),
        )
        logger.info("Auto-built LipSync workflow for task %s", task.task_id)
    else:
        # -- EXISTING: VIDEO_FINAL/VIDEO_PREVIEW = wan_i2v --
        # ... keep existing code unchanged ...
```

### Example 4: Executor Routing Modification for UPSCALE + frame_interp (TASK-02)
```python
# Source: executor.py lines 296-308 (existing UPSCALE handler)
# MODIFY: Insert params.extra.mode check BEFORE existing upscale fallback

elif task.type == TaskType.UPSCALE:
    extra_mode = task.params.get("extra", {}).get("mode", "")
    if extra_mode == "frame_interp":
        # -- Frame Interpolation via RIFE --
        from src.v6.engines.workflow_builder import build_frame_interpolate_workflow
        video_input = task.params.get("video", "")
        if not video_input:
            logger.error("Frame interpolation requires 'video' param, task %s", task.task_id)
            await store.update(task.task_id, status=TaskStatus.FAILED,
                               error="Frame interpolation requires 'video' param")
            return
        workflow = build_frame_interpolate_workflow(
            video_input=video_input,
            interpolation_factor=task.params.get("interpolation_factor", 2),
            ckpt_name=task.params.get("ckpt_name", "rife49.pth"),
            output_fps=task.params.get("output_fps"),
            filename_prefix=task.params.get("filename_prefix", f"frame_interp_{task.task_id}"),
        )
        logger.info("Auto-built Frame Interpolation workflow for task %s", task.task_id)
    else:
        # -- EXISTING: UPSCALE = image upscale --
        # ... keep existing code unchanged ...
```

### Example 5: TRELLIS Routing via IMAGE_TO_3D (WFB-04, WFB-05)
```python
# The IMAGE_TO_3D branch already exists at executor.py:155-176
# MODIFY: Add params.extra.engine/mode check to route TRELLIS workflows

elif task.type == TaskType.IMAGE_TO_3D:
    extra_engine = task.params.get("extra", {}).get("engine", "")
    extra_mode = task.params.get("extra", {}).get("mode", "")

    if extra_mode == "flux_trellis":
        # FLUX + TRELLIS full pipeline
        from src.v6.engines.workflow_builder import build_flux_trellis_full_workflow
        workflow = build_flux_trellis_full_workflow(
            prompt=task.params.get("prompt", ""),
            negative_prompt=task.params.get("negative_prompt", ""),
            seed=task.params.get("seed"),
            **{k: v for k, v in task.params.items()
               if k not in ("extra", "image", "input_image")},
        )
        logger.info("Auto-built FLUX+TRELLIS full pipeline for task %s", task.task_id)
    elif extra_engine == "trellis":
        # TRELLIS image-to-3D only
        from src.v6.engines.workflow_builder import build_trellis_image_to_3d_workflow
        input_image = task.params.get("input_image") or task.params.get("image", "")
        if not input_image:
            logger.error("TRELLIS requires 'input_image' param, task %s", task.task_id)
            await store.update(task.task_id, status=TaskStatus.FAILED,
                               error="TRELLIS requires 'input_image' param")
            return
        workflow = build_trellis_image_to_3d_workflow(
            input_image=input_image,
            seed=task.params.get("seed"),
            **{k: v for k, v in task.params.items()
               if k not in ("extra", "image", "input_image")},
        )
        logger.info("Auto-built TRELLIS image-to-3D workflow for task %s", task.task_id)
    else:
        # -- EXISTING: Hunyuan3D --
        from src.v6.engines.workflow_builder import build_hunyuan3d_workflow
        # ... keep existing code unchanged ...
```

**CRITICAL NOTE on TRELLIS routing:** The current architecture routes IMAGE_TO_3D to the dedicated engine `hunyuan3d-local` via DEDICATED_ENGINES in router.py. When `params.extra.engine="trellis"`, the task must be routed to `comfyui-primary` instead. This requires either:
- (A) Removing IMAGE_TO_3D from DEDICATED_ENGINES and handling all routing in the executor if/elif chain, OR
- (B) Adding a pre-check in the executor BEFORE the DEDICATED_ENGINES dispatch that intercepts TRELLIS tasks, OR
- (C) Modifying the router to check params.extra before returning the dedicated engine.

Option (A) is simplest but changes routing behavior for all IMAGE_TO_3D tasks. Option (C) is cleanest architecturally. The planner should evaluate which approach least disrupts existing behavior.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Single engine per TaskType | params.extra mode discrimination | Phase 17 | Multiple workflows can share a TaskType |
| Dedicated engine always preferred | Conditional dedicated engine bypass | Phase 17 | TRELLIS can coexist with Hunyuan3D under IMAGE_TO_3D |

**Deprecated/outdated:**
- None for this phase -- this is additive, not replacing existing patterns.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | LatentSyncNode class_type is `"LatentSyncNode"` from ComfyUI-LatentSyncWrapper | Code Examples | Workflow fails to submit if class_type is different in installed version |
| A2 | RIFE VFI class_type is `"RIFE VFI"` from Fannovel16's ComfyUI-Frame-Interpolation | Code Examples | Workflow fails to submit if class_type differs |
| A3 | VHS_LoadVideo node is available and returns IMAGE tensor at output index 0 | Code Examples | Video loading fails; need different node (e.g., "LoadVideo") |
| A4 | RIFE multiplier = interpolation_factor - 1 | Code Examples | Wrong number of output frames |
| A5 | LoadAudio node exists in the ComfyUI installation | Code Examples | Audio loading fails |
| A6 | LatentSync models (latentsync_unet.pt, stable_syncnet.pt, whisper/tiny.pt) are pre-installed | Pitfalls | Inference fails with model not found error |
| A7 | RIFE model files (rife49.pth) are pre-installed in ComfyUI | Code Examples | Inference fails with model not found error |
| A8 | ComfyUI-LatentSyncWrapper and ComfyUI-Frame-Interpolation are installed in ComfyUI custom_nodes | Supporting | Entire lip sync / frame interp functionality fails |

## Open Questions (RESOLVED)

1. **LatentSync node output indices and exact class_type** (RESOLVED)
   - Resolution: Plan 17-02 uses class_type "LatentSyncNode" per GitHub source. Tests verify the node class_type is correct. Runtime validation added as a test step.

2. **RIFE multiplier parameter semantics** (RESOLVED)
   - Resolution: Plan 17-02 uses multiplier = interpolation_factor - 1 mapping (e.g., 2x → multiplier=1). Tests verify the mapping logic.

3. **TRELLIS routing vs DEDICATED_ENGINES** (RESOLVED)
   - Resolution: Plan 17-03 implements option C — modify router.py to check params.extra before returning dedicated engine. Centralized routing logic maintained.

## Environment Availability

> This phase modifies existing Python code only. No external tools/services beyond the existing Python runtime and ComfyUI instance.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Python 3.10+ | Code execution | Verified | -- | -- |
| ComfyUI instance | Runtime inference (not build-time) | Assumed running | -- | Builders will error at runtime if ComfyUI is down |
| LatentSync custom node | WFB-06 runtime | [ASSUMED] installed | -- | Workflow fails at runtime |
| RIFE VFI custom node | WFB-07 runtime | [ASSUMED] installed | -- | Workflow fails at runtime |

**Missing dependencies with no fallback:**
- None at build-time (this phase only writes Python code)

**Missing dependencies with fallback:**
- LatentSync/RIFE nodes: Not needed during development. Workflows are JSON configs; they fail at runtime if nodes are missing. Planner should note this as a deployment prerequisite, not a development blocker.

## Validation Architecture

> `workflow.nyquist_validation` is not set in `.planning/config.json` (treated as enabled).

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest (existing in project) |
| Config file | pyproject.toml or pytest.ini |
| Quick run command | `pytest tests/ -x -q --timeout=30` |
| Full suite command | `pytest tests/ -v --timeout=120` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| WFB-06 | build_lipsync_workflow returns valid ComfyUI dict | unit | `pytest tests/test_workflow_builder.py::test_build_lipsync_workflow -x` | No -- Wave 0 |
| WFB-07 | build_frame_interpolate_workflow returns valid ComfyUI dict | unit | `pytest tests/test_workflow_builder.py::test_build_frame_interpolate_workflow -x` | No -- Wave 0 |
| WFB-08 | Executor routes VIDEO_FINAL+lip_sync to build_lipsync_workflow | unit | `pytest tests/test_executor_routing.py::test_video_final_lip_sync_routing -x` | No -- Wave 0 |
| WFB-08 | Executor routes UPSCALE+frame_interp to build_frame_interpolate_workflow | unit | `pytest tests/test_executor_routing.py::test_upscale_frame_interp_routing -x` | No -- Wave 0 |
| WFB-04 | Executor routes IMAGE_TO_3D+trellis to build_trellis_image_to_3d_workflow | unit | `pytest tests/test_executor_routing.py::test_image_to_3d_trellis_routing -x` | No -- Wave 0 |
| WFB-05 | Executor routes IMAGE_TO_3D+flux_trellis to build_flux_trellis_full_workflow | unit | `pytest tests/test_executor_routing.py::test_image_to_3d_flux_trellis_routing -x` | No -- Wave 0 |

### Sampling Rate
- **Per task commit:** `pytest tests/test_workflow_builder.py tests/test_executor_routing.py -x -q`
- **Per wave merge:** `pytest tests/ -v --timeout=120`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/test_workflow_builder.py` -- unit tests for new builders + validation of existing builders
- [ ] `tests/test_executor_routing.py` -- unit tests for routing logic with params.extra discrimination
- [ ] Test fixtures: sample task params dicts for each workflow type

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | N/A |
| V3 Session Management | no | N/A |
| V4 Access Control | no | N/A |
| V5 Input Validation | yes | Pydantic models in task.py validate params structure; workflow builder validates required params |
| V6 Cryptography | no | N/A |

### Known Threat Patterns for ComfyUI Workflow Construction

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Path traversal via video_input/audio_input | Tampering | Validate filenames don't contain `..` or absolute paths; ComfyUI sandboxes to input/ directory |
| Arbitrary ComfyUI node injection | Elevation | Workflow builders hardcode class_type values; user params only fill data fields, not node structure |
| Resource exhaustion (video decode) | Denial | ComfyUI poll timeout (600s) acts as safety net; frame count limits in LoadVideo nodes |

## Sources

### Primary (HIGH confidence)
- `docker/gold-team/src/v6/engines/workflow_builder.py` -- all 13 existing builder patterns, node structure conventions
- `docker/gold-team/src/v6/executor.py` -- routing if/elif chain, params.extra handling
- `docker/gold-team/src/v6/engine/router.py` -- DEDICATED_ENGINES map, VRAM estimates
- `docker/gold-team/src/v6/engines/comfyui.py` -- ComfyUIEngine submit/poll/output API
- `docker/gold-team/src/v6/models/task.py` -- TaskType enum, all 18 types

### Secondary (MEDIUM confidence)
- ShmuelRonen/ComfyUI-LatentSyncWrapper GitHub -- LatentSyncNode class_type, INPUT_TYPES, RETURN_TYPES [CITED: github.com/ShmuelRonen/ComfyUI-LatentSyncWrapper]
- Fannovel16/ComfyUI-Frame-Interpolation GitHub -- RIFE VFI class_type, inputs [CITED: github.com/Fannovel16/ComfyUI-Frame-Interpolation]

### Tertiary (LOW confidence)
- LatentSync VRAM estimate (~20GB) from community reports, not official docs [ASSUMED]
- RIFE performance characteristics (~46s for 121 frames) from community benchmarks [ASSUMED]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new packages, all existing code verified by reading source files
- Architecture: HIGH -- patterns extracted directly from existing working code
- Pitfalls: HIGH -- common issues well-documented in ComfyUI community, node APIs verified from source
- LatentSync node details: MEDIUM -- verified from GitHub source but not tested against installed version
- RIFE node details: MEDIUM -- verified from GitHub source but multiplier semantics need testing

**Research date:** 2026-06-12
**Valid until:** 2026-07-12 (stable codebase, no fast-moving dependencies)
