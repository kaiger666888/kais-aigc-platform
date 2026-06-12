# Phase 17: Workflow Builder Expansion - Context

**Gathered:** 2026-06-12
**Status:** Ready for planning

<domain>
## Phase Boundary

Implement all missing workflow builders and update the routing table so every architecture-required workflow is registered to its correct TaskType. Most workflows already exist (WFB-01 through WFB-05); this phase creates lip sync (WFB-06) and frame interpolation (WFB-07) builders, then wires all workflows into the executor routing table (WFB-08).

</domain>

<decisions>
## Implementation Decisions

### New Workflow Builder Parameters
- Lip sync audio input: accept both file path and URL via `audio_input` param — flexible, matches existing patterns
- Lip sync output format: MP4 video file — standard, matches video pipeline
- RIFE frame interpolation factor: configurable via `interpolation_factor` param (2x/4x/8x) — user controls quality vs speed
- RIFE input format: video file input — simpler API, matches user mental model

### Routing Table Organization
- TRELLIS workflow routes through `IMAGE_TO_3D` with `params.extra.engine="trellis"` to distinguish from Hunyuan3D
- FLUX+TRELLIS full chain routes through `IMAGE_TO_3D` with `params.extra.mode="flux_trellis"` — end-to-end pipeline
- Lip sync routes via `VIDEO_FINAL` + `params.extra.mode="lip_sync"` — matches TASK-01 spec
- Frame interpolation routes via `UPSCALE` + `params.extra.mode="frame_interp"` — matches TASK-02 spec

### Claude's Discretion
Exact ComfyUI node IDs, parameter naming conventions, and workflow JSON structure are at Claude's discretion — follow existing patterns in workflow_builder.py.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `docker/gold-team/src/v6/engines/workflow_builder.py` — 13 existing workflow builders with established patterns
- `docker/gold-team/src/v6/engines/comfyui.py` — ComfyUIEngine handles workflow submission/polling
- `docker/gold-team/src/v6/executor.py` — Task routing with DEDICATED_ENGINES dict and workflow_builder_map
- `docker/gold-team/src/v6/engines/facefusion.py` — FaceFusion engine with lip_syncer processor
- `docker/gold-team/src/v6/models/task.py` — TaskType enum with 18 defined types

### Established Patterns
- ComfyUI workflows use numbered node JSON format (UNetLoader, KSampler, VAEDecode, SaveImage pipeline)
- Workflow builder functions return dicts (ComfyUI API format) or parameter dicts (subprocess engines)
- Executor routes via DEDICATED_ENGINES map (specialized engines) and workflow_builder_map (ComfyUI workflows)
- params.extra currently only used for ACEStep music params — pattern to extend
- Dual GPU: primary (RTX 3090) for heavy tasks, auxiliary (RTX 3060 Ti) for light tasks

### Integration Points
- New lip sync workflow connects to ComfyUI LatentSync custom nodes
- New RIFE workflow connects to ComfyUI RIFE custom nodes
- Routing table entries map TaskType → workflow builder function in executor
- TRELLIS workflows (build_trellis_image_to_3d_workflow, build_flux_trellis_full_workflow) already exist but need routing registration

</code_context>

<specifics>
## Specific Ideas

- WFB-01 through WFB-05 workflows already exist in workflow_builder.py — verify and register in routing table
- LatentSync specified as the lip sync technology (WFB-06)
- RIFE specified as the frame interpolation technology (WFB-07)
- Routing paths pre-specified: VIDEO_FINAL+lip_sync, UPSCALE+frame_interp (TASK-01/02)

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
