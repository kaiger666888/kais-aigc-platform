# Roadmap: KAIS AIGC Platform — Engine Integration

## Overview

This milestone completes the AI short drama engine by adding six capability layers to the gold-team execution engine: ComfyUI environment setup, post-processing workflows, character consistency workflows, lip sync, frame interpolation, and pipeline templates that tie everything together. The journey goes from environment preparation through increasingly complex engines, finishing with pipeline templates that orchestrate the individual engines into complete production workflows.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: ComfyUI Environment Setup** - Install all custom nodes and download models required by new workflows
- [ ] **Phase 2: Post-Processing Workflows** - Upscale and face restore workflows using built-in ComfyUI nodes
- [ ] **Phase 3: Character Consistency Workflows** - IP-Adapter, InstantID, and PhotoMaker face-locking workflows
- [ ] **Phase 4: Lip Sync Engine** - LatentSync image+audio to lip-synced video engine
- [ ] **Phase 5: Frame Interpolation** - RIFE frame interpolation workflow
- [ ] **Phase 6: Pipeline Templates** - Talking head and character-scene pipeline templates that orchestrate all engines

## Phase Details

### Phase 1: ComfyUI Environment Setup
**Goal**: All custom nodes and models are installed and verified in the ComfyUI Worker, ready for workflow execution
**Depends on**: Nothing (first phase)
**Requirements**: LIPS-01, CHAR-01, FRAM-01
**Success Criteria** (what must be TRUE):
  1. ComfyUI Worker starts without errors after installing all new custom nodes (LatentSync, IP-Adapter Plus, InstantID, PhotoMaker, ComfyUI-Frame-Interpolation)
  2. All required models are present in /data/models/ (latentsync_unet, whisper_tiny, arcface, ipadapter models, instantid models, photomaker models, RIFE models)
  3. Each custom node appears in ComfyUI's node registry and can be instantiated in a workflow without import errors
  4. Existing workflows (Wan2.2 T2V/I2V, FLUX txt2img, CosyVoice TTS) continue to execute correctly after the new installations
**Plans**: TBD

Plans:
- [ ] 01-01: Install all ComfyUI custom nodes and verify node registration
- [ ] 01-02: Download and verify all required models
- [ ] 01-03: Regression test existing workflows

### Phase 2: Post-Processing Workflows
**Goal**: Users can submit upscale and face-restore tasks through the gold-team API and receive processed results
**Depends on**: Phase 1
**Requirements**: POST-01, POST-02, POST-03, POST-04
**Success Criteria** (what must be TRUE):
  1. User can submit an UPSCALE task via gold-team /api/v1/tasks and receive a Real-ESRGAN super-resolution image as output
  2. User can submit a FACE_RESTORE task via gold-team /api/v1/tasks and receive a GFPGAN/CodeFormer face-restored image as output
  3. Executor correctly routes UPSCALE and FACE_RESTORE TaskTypes to their respective workflow builders and submits to ComfyUIEngine
  4. Both workflows complete end-to-end: submit returns task_id, poll shows progress, callback delivers result
**Plans**: TBD

Plans:
- [ ] 02-01: Implement build_upscale_workflow and build_face_restore_workflow in workflow_builder.py
- [ ] 02-02: Add UPSCALE and FACE_RESTORE routing to Executor._execute_task
- [ ] 02-03: End-to-end test both post-processing workflows

### Phase 3: Character Consistency Workflows
**Goal**: Users can generate character-consistent images using three different face-locking modes through the existing IMAGE_DRAW task type
**Depends on**: Phase 1
**Requirements**: CHAR-02, CHAR-03, CHAR-04, CHAR-05, CHAR-06
**Success Criteria** (what must be TRUE):
  1. User can submit an IMAGE_DRAW task with params.extra.character_consistency.mode="ipadapter" and receive an image that preserves the reference face
  2. User can submit an IMAGE_DRAW task with mode="instantid" and receive a zero-sample face-preserving image
  3. User can submit an IMAGE_DRAW task with mode="photomaker" and receive a multi-reference character image
  4. Executor IMAGE_DRAW branch routes to the correct workflow builder based on character_consistency mode in params.extra
  5. All three workflows execute end-to-end in ComfyUI without errors
**Plans**: TBD

Plans:
- [ ] 03-01: Implement build_ipadapter_face_workflow, build_instantid_workflow, and build_photomaker_workflow
- [ ] 03-02: Add character_consistency mode routing to Executor IMAGE_DRAW branch
- [ ] 03-03: End-to-end test all three character consistency workflows

### Phase 4: Lip Sync Engine
**Goal**: Users can submit a lip sync task that takes a character image and audio clip and produces a lip-synced video
**Depends on**: Phase 1
**Requirements**: LIPS-02, LIPS-03, LIPS-04, LIPS-05
**Success Criteria** (what must be TRUE):
  1. User can submit a LIP_SYNC task with an image and audio file and receive a lip-synced video as output
  2. TaskType enum contains LIP_SYNC = "lip_sync" and Executor has a matching routing branch
  3. The build_lip_sync_workflow produces a valid ComfyUI workflow that chains image+audio through LatentSync nodes
  4. Full submit-poll-callback lifecycle works: task submits, polls show progress, callback delivers the video result
**Plans**: TBD

Plans:
- [ ] 04-01: Add LIP_SYNC to TaskType enum and implement build_lip_sync_workflow
- [ ] 04-02: Add lip_sync routing branch to Executor._execute_task
- [ ] 04-03: End-to-end test lip sync workflow

### Phase 5: Frame Interpolation
**Goal**: Users can submit a frame interpolation task that increases video smoothness by generating intermediate frames
**Depends on**: Phase 1
**Requirements**: FRAM-02, FRAM-03, FRAM-04, FRAM-05
**Success Criteria** (what must be TRUE):
  1. User can submit a FRAME_INTERPOLATE task with a video and receive a frame-multiplied video as output
  2. TaskType enum contains FRAME_INTERPOLATE = "frame_interpolate" and Executor has a matching routing branch
  3. The build_frame_interp_workflow produces a valid ComfyUI workflow that runs RIFE interpolation
  4. Full submit-poll-callback lifecycle works end-to-end
**Plans**: TBD

Plans:
- [ ] 05-01: Add FRAME_INTERPOLATE to TaskType enum and implement build_frame_interp_workflow
- [ ] 05-02: Add frame_interpolate routing to Executor and end-to-end test

### Phase 6: Pipeline Templates
**Goal**: Users can trigger complete short drama production pipelines that orchestrate multiple engines into a single automated workflow
**Depends on**: Phase 2, Phase 3, Phase 4
**Requirements**: PIPE-01, PIPE-02
**Success Criteria** (what must be TRUE):
  1. User can trigger a talking_head pipeline that automatically chains image generation, lip sync, face restore, and upscale into a final delivered video
  2. User can trigger a character_scene pipeline that automatically chains IP-Adapter face-locking, video generation, lip sync, and post-processing into a final delivered video
  3. Each pipeline step produces verifiable intermediate output before the next step begins
  4. Pipeline failures at any step are reported with the failed step identified and partial results preserved
**Plans**: TBD

Plans:
- [ ] 06-01: Implement talking_head pipeline template (image_gen -> lip_sync -> face_restore -> upscale)
- [ ] 06-02: Implement character_scene pipeline template (ipadapter -> video_gen -> lip_sync -> postprocess)

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 6

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. ComfyUI Environment Setup | 0/3 | Not started | - |
| 2. Post-Processing Workflows | 0/3 | Not started | - |
| 3. Character Consistency Workflows | 0/3 | Not started | - |
| 4. Lip Sync Engine | 0/3 | Not started | - |
| 5. Frame Interpolation | 0/2 | Not started | - |
| 6. Pipeline Templates | 0/2 | Not started | - |
