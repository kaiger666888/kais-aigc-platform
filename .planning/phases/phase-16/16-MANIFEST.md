---
phase: 16
plan: 01
type: manifest
status: complete
generated: 2026-06-12
---

# Phase 16: v6 Code Merge — Change Manifest

## Repository Paths

| Role | Path |
|------|------|
| Research (source of truth) | /home/kai/workspace/kais-gold-team/src/v6/ |
| Deploy (target) | docker/gold-team/src/v6/ |

## New Files (Research → Deploy)

Files that exist only in research repo and need to be copied:

| File | Purpose |
|------|---------|
| engine_pool.py | Engine pool management for multi-engine selection |
| gpu_monitor.py | GPU memory monitoring and resource tracking |
| engines/acestep.py | ACE-Step music generation engine |
| engines/hunyuan3d.py | Hunyuan3D single-image 3D generation |
| engines/hunyuan3d_mv.py | Hunyuan3D-2mv multi-view 3D generation |
| engines/workflows/__init__.py | Workflow module init |
| engines/workflows/ipadapter_flux.py | IP-Adapter + FLUX face-preservation workflow |
| middleware/__init__.py | Middleware module init |
| middleware/gpu_guard.py | GPU VRAM guard middleware (blocks overcommit) |
| routes/v1/gpu.py | GPU status and monitoring API route |

## Modified Files (Research overwrites Deploy)

Files that exist in both repos with different content — research version is source of truth:

| File | Key Changes |
|------|-------------|
| config/engine_registry.py | New engine registrations (Hunyuan3D, ACE-Step) |
| config/engine_schema.py | Schema updates for new engine types |
| config/gpu_config.py | GPU allocation for dual-engine setup |
| docker/container_manager.py | Container lifecycle improvements |
| engine/router.py | Updated routing for new task types and engines |
| engines/cloud_base.py | Cloud engine base improvements |
| engines/cloud_seedance.py | Seedance engine updates |
| engines/comfyui.py | ComfyUI engine improvements (dual-engine, workflow routing) |
| engines/docker_base.py | Docker engine base improvements |
| engines/docker_cli.py | Docker CLI engine improvements |
| engines/docker_polling.py | Docker polling engine improvements |
| engines/__init__.py | New engine exports (ACE-Step, Hunyuan3D) |
| engines/tts.py | TTS engine updates |
| engines/workflow_builder.py | New workflow builders |
| executor.py | Executor routing updates for new engines/task types |
| main.py | App initialization with new engines, middleware, routes |
| models/task.py | New TaskType values |
| routers/engines.py | New engine info endpoints |

## Deploy-Only Files (Preserve)

Files that exist only in deploy repo — must NOT be overwritten:

| File | Purpose |
|------|---------|
| engines/joycaption.py | JoyCaption image description engine |
| engines/tts_http.py | HTTP-based TTS engine (chatterbox/GPT-SoVITS) |

## Merge Strategy

1. **Copy new files** from research to deploy (10 files)
2. **Overwrite modified files** with research version (18 files)
3. **Preserve deploy-only files** (2 files: joycaption.py, tts_http.py)
4. **Merge main.py** manually — combine research structure with deploy-specific engines
5. **Merge engines/__init__.py** — combine exports from both repos
6. **Update Dockerfile** if new dependencies needed
7. **Run regression tests**

## Summary

| Category | Count |
|----------|-------|
| New files to copy | 10 |
| Modified files to overwrite | 18 |
| Deploy-only to preserve | 2 |
| Manual merges required | 2 (main.py, engines/__init__.py) |
| **Total files affected** | **30** |
