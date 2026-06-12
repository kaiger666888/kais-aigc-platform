# Phase 18: Engine Registration & Task Routing - Research

**Researched:** 2026-06-12
**Domain:** Engine architecture unification, task routing, workflow builder dispatch
**Confidence:** HIGH

## Summary

Phase 18 refactors the engine registration system to group engines by backend type (ComfyUI / Independent API / Cloud / Subprocess) instead of per-model, and extends `params.extra` routing in the executor to support character consistency workflows (IP-Adapter, InstantID, PhotoMaker) for IMAGE_DRAW tasks. The lip sync and frame interpolation routing was already implemented in Phase 17 (verified: all 14 existing tests pass). The primary work is (1) restructuring `main.py` registration to use backend-type grouping with clear logging, (2) removing any per-model ComfyUI engine subclasses, (3) adding IMAGE_DRAW + `params.extra` routing for character consistency, and (4) updating the `/api/v1/engines` endpoint to display the backend-type grouping.

**Primary recommendation:** Refactor `main.py` lifespan registration into grouped sections by backend type (ComfyUI, Subprocess, Cloud, Docker/YAML), add `params.extra` routing for character consistency workflows in the executor's IMAGE_DRAW branch, and update the engines API endpoint to show backend-type grouping.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
All implementation choices are at Claude's discretion -- pure infrastructure phase. Use ROADMAP phase goal, success criteria, and codebase conventions to guide decisions.

### Claude's Discretion
All implementation choices are at Claude's discretion. Prior phases (15-17) established the workflow builder patterns and routing table -- this phase unifies the engine registration architecture.

### Deferred Ideas (OUT OF SCOPE)
None -- infrastructure phase skipped discuss.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ENG-01 | Group engine registration by backend type (ComfyUI/Independent API/Cloud/Subprocess) | `main.py` lifespan has flat registration -- needs restructuring into grouped sections with backend_type metadata |
| ENG-02 | ComfyUI models use ComfyUIEngine + workflow_builder, no per-model Engine subclasses | Verified: only `ComfyUIEngine` class exists, `JoyCaptionEngine` is the only ComfyUI-dependent non-standard engine -- needs backend_type annotation |
| ENG-03 | Verify ComfyUIEngine dual-engine auto-routing (Primary/Auxiliary) | `router.py` already handles this with `LIGHT_TASK_TYPES` routing to auxiliary -- registration logging should show both instances |
| ENG-04 | Verify DockerPollingAPIEngine (ACE-Step) and CloudEngine (Kling/Jimeng) continue working | `docker_polling.py` for ACE-Step, `cloud_base.py` + subclasses for cloud -- both follow BaseEngine lifecycle, no changes needed to internals |
| TASK-01 | Lip sync via VIDEO_FINAL + params.extra.mode = "lip_sync" | Already implemented in Phase 17 -- executor.py lines 327-352, test coverage exists |
| TASK-02 | Frame interpolation via UPSCALE + params.extra.mode = "frame_interp" | Already implemented in Phase 17 -- executor.py lines 376-400, test coverage exists |
| TASK-03 | Character consistency (IP-Adapter/InstantID/PhotoMaker) via IMAGE_DRAW + params.extra | Needs new routing in executor IMAGE_DRAW branch -- `build_flux_ipadapter_workflow` and `build_pulid_flux_workflow` already exist in workflow_builder.py |
| TASK-04 | Update executor/router routing logic for params.extra fine-grained selection | Executor `_execute_task` already has params.extra routing for lip_sync/frame_interp -- needs extension for character consistency modes |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Engine registration grouping | API / Backend | -- | Registration happens in `main.py` lifespan, purely server-side |
| Backend type classification | API / Backend | -- | New `backend_type` attribute on BaseEngine or registration metadata |
| Task routing (params.extra) | API / Backend | -- | Routing logic lives in `executor.py._execute_task` |
| Character consistency workflows | API / Backend | -- | Uses existing ComfyUIEngine + workflow_builder |
| Engine status API | API / Backend | -- | `/api/v1/engines` endpoint needs backend_type in response |
| Workflow building | API / Backend | -- | `workflow_builder.py` already has IP-Adapter and PuLID builders |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| FastAPI | (existing) | HTTP framework | Project standard |
| Pydantic | (existing) | Data models | Project standard |
| httpx | (existing) | Async HTTP client | Used by ComfyUIEngine, CloudBaseEngine |
| pytest | 9.0.3 | Testing | Existing test framework |

### No New Packages Required
This phase is pure refactoring of existing code. No new external packages are needed.

## Architecture Patterns

### System Architecture Diagram

```
Client Request (POST /api/v1/tasks)
    |
    v
[Tasks Router] -- creates GenerationTask, calls engine_router.route()
    |
    v
[EngineRouter] -- selects engine_id (comfyui-primary, cloud-jimeng, etc.)
    |
    v
[TaskExecutor._worker_loop] -- dequeues task
    |
    v
[TaskExecutor._execute_task] -- builds workflow via params.extra routing
    |
    +-- params.extra.mode="lip_sync" --> build_lipsync_workflow --> ComfyUIEngine
    +-- params.extra.mode="frame_interp" --> build_frame_interpolate_workflow --> ComfyUIEngine
    +-- params.extra.mode="ipadapter" --> build_flux_ipadapter_workflow --> ComfyUIEngine
    +-- params.extra.mode="pulid" --> build_pulid_flux_workflow --> ComfyUIEngine
    +-- params.extra.mode="instantid" --> build_flux_ipadapter_workflow --> ComfyUIEngine (reuses IP-Adapter)
    +-- (default IMAGE_DRAW) --> build_flux_dev_workflow --> ComfyUIEngine
    +-- MUSIC/SFX --> ACE-Step (DockerPollingAPIEngine)
    +-- cloud-jimeng/kling --> BaseCloudEngine subclasses
    +-- IMAGE_TO_3D --> Hunyuan3DEngine (Subprocess)
    |
    v
[Engine Registration] -- grouped by backend_type in main.py lifespan
    |
    +-- BackendType.COMFYUI: ComfyUIEngine (primary, auxiliary, joycaption)
    +-- BackendType.SUBPROCESS: Hunyuan3DEngine, Hunyuan3DMvEngine, TTSTracker, TripleTrackTTSEngine
    +-- BackendType.CLOUD: JimengEngine, KlingEngine, SeedanceEngine
    +-- BackendType.DOCKER: ACE-Step, FaceFusion, DockerAPIEngine instances (from YAML registry)
    +-- BackendType.MOCK: MockEngine
```

### Recommended Project Structure
```
docker/gold-team/src/v6/
    engines/
        base.py              # ADD: backend_type property to BaseEngine
        comfyui.py            # NO CHANGE (already correct)
        cloud_base.py         # NO CHANGE
        docker_polling.py     # NO CHANGE
        hunyuan3d.py          # NO CHANGE
        workflow_builder.py   # NO CHANGE (builders already exist)
        ...
    engine/
        router.py             # MINOR: add backend_type awareness if needed
    executor.py               # MODIFY: add character consistency routing in IMAGE_DRAW branch
    main.py                   # MODIFY: restructure registration into grouped sections
    routers/
        engines.py            # MODIFY: add backend_type to API response
    models/
        task.py               # NO CHANGE (TaskType enum is fine)
```

### Pattern 1: Backend Type Enum on BaseEngine
**What:** Add a `backend_type` property to `BaseEngine` that returns one of `COMFYUI`, `SUBPROCESS`, `CLOUD`, `DOCKER`, `MOCK`.
**When to use:** Everywhere an engine needs to declare its backend category.
**Example:**
```python
# In base.py
class BackendType(str, enum.Enum):
    COMFYUI = "comfyui"
    SUBPROCESS = "subprocess"
    CLOUD = "cloud"
    DOCKER = "docker"
    MOCK = "mock"

class BaseEngine(abc.ABC):
    @property
    def backend_type(self) -> BackendType:
        """Engine backend type. Override in subclasses."""
        return BackendType.MOCK
```

### Pattern 2: Grouped Registration in main.py
**What:** Restructure the flat `executor.register_engine()` calls in `lifespan()` into clearly labeled groups by backend type.
**When to use:** During startup registration, and in `/api/v1/engines` API response.
**Example:**
```python
# In main.py lifespan
# ── ComfyUI Backend ──────────────────────────────────
if COMFYUI_ENABLED:
    # Register primary, auxiliary, joycaption
    ...

# ── Subprocess Backend ───────────────────────────────
# Register TTS, Hunyuan3D, Hunyuan3D-Mv
...

# ── Cloud Backend ────────────────────────────────────
# Register Jimeng, Kling, Seedance
...

# ── Docker/YAML Backend ─────────────────────────────
# Register local engines from engine_registry
...

logger.info("Engine registration summary:\n%s", _format_registration_summary(executor))
```

### Pattern 3: params.extra Routing for Character Consistency
**What:** In the executor's IMAGE_DRAW branch, check `params.extra` for character consistency mode indicators before falling through to the default FLUX Dev workflow.
**When to use:** IMAGE_DRAW tasks that need IP-Adapter, PuLID, or InstantID processing.
**Example:**
```python
# In executor.py _execute_task, IMAGE_DRAW branch
elif task.type == TaskType.IMAGE_DRAW:
    extra = task.params.get("extra", {})
    extra_mode = extra.get("mode", "")

    if extra_mode == "ipadapter":
        # IP-Adapter character consistency
        ref_img = task.params.get("reference_image", "")
        if not ref_img:
            # fail
            return
        workflow = build_flux_ipadapter_workflow(...)
    elif extra_mode == "pulid":
        # PuLID character consistency
        ref_img = task.params.get("image", "") or task.params.get("reference_image", "")
        workflow = build_pulid_flux_workflow(...)
    elif extra_mode == "instantid":
        # InstantID reuses IP-Adapter infrastructure
        ref_img = task.params.get("reference_image", "")
        workflow = build_flux_ipadapter_workflow(...)
    else:
        # Default: FLUX Dev txt2img
        workflow = build_flux_dev_workflow(...)
```

### Anti-Patterns to Avoid
- **Creating per-model Engine subclasses for ComfyUI:** All ComfyUI models (FLUX, Wan, TRELLIS, etc.) go through `ComfyUIEngine` with different workflows. The workflow_builder pattern is the correct abstraction.
- **Routing in the EngineRouter instead of the Executor:** The router selects WHICH engine instance (primary vs auxiliary vs cloud). The executor's `_execute_task` decides WHAT workflow to build. These are separate concerns.
- **Changing TaskType enum to add per-mode types:** The design decision is "TaskType stays broad, details via params.extra." Do not add new TaskTypes for lip_sync, frame_interp, ipadapter, etc.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| ComfyUI workflow construction | Custom JSON builder per model | `workflow_builder.py` functions | 15+ builder functions already handle all node graphs |
| Engine lifecycle management | Custom start/stop/poll per engine | `BaseEngine` abstract class | Already handles submit/poll/get_output/cancel/health |
| GPU VRAM management | Manual VRAM tracking | `EnginePool` + `gpu_monitor.py` | LRU eviction, idle timeout, auto-evict on OOM |
| Docker container lifecycle | Manual container management | `ContainerManager` + `DockerAPIEngine` | Start/stop/cleanup/health_wait already handled |
| Cloud API auth | Custom auth per provider | `BaseCloudEngine._build_auth_headers()` | Provider-specific headers, API key management |

**Key insight:** The engine infrastructure is mature. This phase is about organizing existing code better (grouping, logging, routing) not building new engine types.

## Common Pitfalls

### Pitfall 1: Breaking existing routing by reordering executor branches
**What goes wrong:** The executor's `_execute_task` uses if/elif chains. Reordering them can change which branch a task hits.
**Why it happens:** The IMAGE_DRAW default branch is at the bottom of the chain. Adding character consistency routing before it but after other branches could shift the fallthrough logic.
**How to avoid:** Add the IMAGE_DRAW + `params.extra` routing as a NEW elif branch at the point where IMAGE_DRAW is currently handled (the `else` clause at the end). Or better, restructure IMAGE_DRAW into its own explicit `elif task.type == TaskType.IMAGE_DRAW:` branch.
**Warning signs:** Tasks that previously matched `model == "flux-dev-ipa"` or `model == "flux-dev"` stop routing correctly.

### Pitfall 2: JoyCaption registration outside ComfyUI group
**What goes wrong:** `JoyCaptionEngine` talks to ComfyUI but is registered separately from the ComfyUI group in `main.py`. After the refactor, it might end up in the wrong backend group.
**Why it happens:** JoyCaption registration (lines 177-193 in main.py) is a separate try/except block that doesn't check `COMFYUI_ENABLED`.
**How to avoid:** Move JoyCaption registration inside the `COMFYUI_ENABLED` block or group it with the ComfyUI backend type explicitly.
**Warning signs:** JoyCaption appears under "Docker" or "Independent API" instead of "ComfyUI" in the engine listing.

### Pitfall 3: Duplicate model-based routing for flux-dev-ipa
**What goes wrong:** The existing executor has `model == "flux-dev-ipa"` routing (line 241) AND the new `params.extra.mode == "ipadapter"` routing. Both could trigger for the same task if both fields are set.
**Why it happens:** Legacy tasks might set `model: "flux-dev-ipa"` while new tasks use `params.extra.mode: "ipadapter"`.
**How to avoid:** Make `params.extra.mode` take priority over `model` param. The `params.extra` routing should be checked first, with `model` as fallback.
**Warning signs:** IP-Adapter tasks produce wrong workflow because `model` param overrides `params.extra.mode`.

### Pitfall 4: Missing backend_type in Engine API response
**What goes wrong:** The `/api/v1/engines` endpoint (routers/engines.py) doesn't include `backend_type` in its response. Success criterion #1 requires engines "grouped by backend type" in the registration log.
**Why it happens:** The endpoint builds response dicts manually without referencing backend_type.
**How to avoid:** Add `backend_type` field to each engine dict in the `list_engines` response.
**Warning signs:** Registration log shows flat list, not grouped by backend type.

### Pitfall 5: Breaking DockerAPIEngine/YAML-registered engines
**What goes wrong:** The YAML-based engines (lines 216-265 in main.py) are registered via `build_engine_registry` and `EnginePool`. If the refactor changes how these are registered, ACE-Step and other Docker engines could stop working.
**Why it happens:** The YAML registry path is separate from the hardcoded registration. It uses `build_engine_registry` + `EnginePool.register` instead of `executor.register_engine`.
**How to avoid:** Keep the YAML registry path intact. Add backend_type metadata to `EngineConfig` or `DockerAPIEngine` so they report their type correctly, but don't change the registration flow.
**Warning signs:** ACE-Step music generation fails after refactor.

## Code Examples

### Adding BackendType to BaseEngine
```python
# In engines/base.py -- add after EngineStatus enum
class BackendType(str, enum.Enum):
    """Engine backend classification."""
    COMFYUI = "comfyui"
    SUBPROCESS = "subprocess"
    CLOUD = "cloud"
    DOCKER = "docker"
    MOCK = "mock"

class BaseEngine(abc.ABC):
    # ... existing abstract methods ...

    @property
    def backend_type(self) -> "BackendType":
        """Engine backend type. Override in subclasses."""
        return BackendType.MOCK
```

### Setting backend_type in ComfyUIEngine
```python
# In engines/comfyui.py
class ComfyUIEngine(BaseEngine):
    @property
    def backend_type(self) -> BackendType:
        return BackendType.COMFYUI
```

### Setting backend_type in Subprocess engines
```python
# In engines/hunyuan3d.py, engines/tts.py, engines/tts_http.py, engines/hunyuan3d_mv.py
@property
def backend_type(self) -> BackendType:
    return BackendType.SUBPROCESS
```

### Setting backend_type in Cloud engines
```python
# In engines/cloud_base.py
class BaseCloudEngine(BaseEngine):
    @property
    def backend_type(self) -> BackendType:
        return BackendType.CLOUD
```

### Setting backend_type in Docker engines
```python
# In engines/docker_base.py
class DockerAPIEngine(BaseEngine):
    @property
    def backend_type(self) -> BackendType:
        return BackendType.DOCKER
```

### IMAGE_DRAW character consistency routing (executor.py)
```python
# Replace the existing IMAGE_DRAW handling (currently in the else clause at bottom of _execute_task)
elif task.type == TaskType.IMAGE_DRAW:
    extra = task.params.get("extra", {})
    extra_mode = extra.get("mode", "")

    if extra_mode == "ipadapter":
        from src.v6.engines.workflow_builder import build_flux_ipadapter_workflow
        ref_img = task.params.get("reference_image", "")
        if not ref_img:
            logger.error("IP-Adapter requires 'reference_image' param, task %s", task.task_id)
            await store.update(task.task_id, status=TaskStatus.FAILED,
                               error="IP-Adapter requires 'reference_image' param")
            return
        workflow = build_flux_ipadapter_workflow(
            prompt=task.params.get("prompt", ""),
            reference_image=ref_img,
            negative_prompt=task.params.get("negative_prompt", ""),
            width=task.params.get("width", 1024),
            height=task.params.get("height", 1024),
            steps=task.params.get("steps", 28),
            cfg_scale=task.params.get("cfg_scale", 3.5),
            weight=task.params.get("weight", 0.8),
            start_percent=task.params.get("start_percent", 0.0),
            end_percent=task.params.get("end_percent", 0.8),
            seed=task.params.get("seed"),
            filename_prefix=task.params.get("filename_prefix", "flux-ipadapter"),
        )
        logger.info("Auto-built FLUX + IP-Adapter workflow for task %s (params.extra.mode)", task.task_id)

    elif extra_mode == "pulid":
        from src.v6.engines.workflow_builder import build_pulid_flux_workflow
        ref_img = task.params.get("image", "") or task.params.get("reference_image", "")
        if not ref_img:
            logger.error("PuLID requires 'image' param, task %s", task.task_id)
            await store.update(task.task_id, status=TaskStatus.FAILED,
                               error="PuLID requires 'image' param")
            return
        workflow = build_pulid_flux_workflow(
            image_name=ref_img,
            prompt=task.params.get("prompt", ""),
            negative_prompt=task.params.get("negative_prompt", ""),
            width=task.params.get("width", 1024),
            height=task.params.get("height", 1024),
            steps=task.params.get("steps", 28),
            cfg_scale=task.params.get("cfg_scale", 3.5),
            weight=task.params.get("weight", 1.0),
            seed=task.params.get("seed"),
            filename_prefix=task.params.get("filename_prefix", "pulid_flux"),
        )
        logger.info("Auto-built PuLID FLUX workflow for task %s (params.extra.mode)", task.task_id)

    elif extra_mode == "instantid":
        # InstantID reuses IP-Adapter workflow infrastructure
        from src.v6.engines.workflow_builder import build_flux_ipadapter_workflow
        ref_img = task.params.get("reference_image", "")
        if not ref_img:
            logger.error("InstantID requires 'reference_image' param, task %s", task.task_id)
            await store.update(task.task_id, status=TaskStatus.FAILED,
                               error="InstantID requires 'reference_image' param")
            return
        workflow = build_flux_ipadapter_workflow(
            prompt=task.params.get("prompt", ""),
            reference_image=ref_img,
            negative_prompt=task.params.get("negative_prompt", ""),
            width=task.params.get("width", 1024),
            height=task.params.get("height", 1024),
            steps=task.params.get("steps", 28),
            cfg_scale=task.params.get("cfg_scale", 3.5),
            weight=task.params.get("weight", 0.8),
            start_percent=task.params.get("start_percent", 0.0),
            end_percent=task.params.get("end_percent", 0.8),
            seed=task.params.get("seed"),
            filename_prefix=task.params.get("filename_prefix", "instantid"),
        )
        logger.info("Auto-built InstantID workflow for task %s (params.extra.mode)", task.task_id)

    else:
        # Default IMAGE_DRAW: FLUX Dev txt2img
        from src.v6.engines.workflow_builder import build_flux_dev_workflow
        workflow = build_flux_dev_workflow(
            prompt=task.params.get("prompt", ""),
            negative_prompt=task.params.get("negative_prompt", ""),
            width=task.params.get("width", 1024),
            height=task.params.get("height", 1024),
            steps=task.params.get("steps", 28),
            cfg_scale=task.params.get("cfg_scale", 3.5),
            seed=task.params.get("seed"),
        )
        logger.info("Auto-built FLUX Dev workflow for task %s (default IMAGE_DRAW)", task.task_id)
```

### Grouped registration summary in main.py
```python
def _format_registration_summary(executor) -> str:
    """Build a summary string of registered engines grouped by backend type."""
    from collections import defaultdict
    groups = defaultdict(list)
    for engine in executor.list_engines():
        groups[engine.backend_type.value].append(f"{engine.engine_id} ({engine.name})")

    lines = []
    for bt in ("comfyui", "subprocess", "cloud", "docker", "mock"):
        engines = groups.get(bt, [])
        if engines:
            lines.append(f"  [{bt.upper()}] {', '.join(engines)}")
    return "\n".join(lines)
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Per-model Engine subclasses | Single ComfyUIEngine + workflow_builder | Phase 17 | No per-model engines exist for ComfyUI models |
| Flat engine registration | Grouped by backend type | This phase (18) | Registration log shows clear grouping |
| TaskType per mode (e.g., IMAGE_PULID) | Broad TaskType + params.extra | Phases 17-18 | IMAGE_PULID and IMAGE_DRAW_IPADAPTER TaskTypes exist but routing should prefer params.extra |

**Deprecated/outdated:**
- `model == "flux-dev-ipa"` routing pattern in executor: should be replaced by `params.extra.mode == "ipadapter"` for consistency. Keep as backward-compatible fallback.

## Current State Assessment

### What Already Works (from Phase 17)
1. **Lip sync routing:** VIDEO_FINAL + `params.extra.mode="lip_sync"` correctly triggers `build_lipsync_workflow` (executor.py lines 327-352)
2. **Frame interpolation routing:** UPSCALE + `params.extra.mode="frame_interp"` correctly triggers `build_frame_interpolate_workflow` (executor.py lines 376-400)
3. **TRELLIS routing:** IMAGE_TO_3D + `params.extra.engine="trellis"` routes to comfyui-primary via DEDICATED_ENGINES bypass
4. **14 passing tests:** All existing routing tests pass

### What Needs Work (Phase 18 scope)
1. **Backend type grouping:** `main.py` registration is flat -- needs grouping + logging
2. **BackendType property:** `BaseEngine` has no backend_type classification
3. **IMAGE_DRAW character consistency:** No `params.extra.mode` routing for IP-Adapter/PuLID/InstantID on IMAGE_DRAW tasks (currently uses `model` param)
4. **Engines API response:** `/api/v1/engines` doesn't include backend_type

### Existing IMAGE_DRAW Routing
The executor currently handles IMAGE_DRAW via a chain at the bottom of `_execute_task`:
- `model == "flux-dev"` -> `build_flux_dev_workflow`
- `model == "flux-dev-ipa"` -> `build_flux_ipadapter_workflow` (legacy)
- `TaskType.IMAGE_PULID` -> `build_pulid_flux_workflow`
- `TaskType.CONTROLNET_DEPTH` -> `build_controlnet_depth_workflow`
- `TaskType.WAN_I2V` -> `build_wan21_i2v_dual_stage_workflow`
- Default (else clause) -> `build_flux_dev_workflow` or `build_txt2img_workflow`

The IMAGE_DRAW + params.extra routing needs to slot into this chain correctly, checking params.extra.mode before falling through to model-based routing.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | InstantID reuses the IP-Adapter workflow builder (same ComfyUI node structure) | Architecture Patterns | May need a separate `build_instantid_workflow` if node graphs differ |
| A2 | PhotoMaker is not currently supported and does not have a workflow builder | Phase Requirements | If PhotoMaker exists, needs routing -- but no builder found in codebase |
| A3 | `JoyCaptionEngine` should be classified as BackendType.COMFYUI since it talks to ComfyUI | Architecture Patterns | Could be classified differently if it's considered an independent service |
| A4 | The existing `model == "flux-dev-ipa"` routing should remain as backward-compatible fallback | Architecture Patterns | Could break existing callers if removed without deprecation period |
| A5 | No new TaskType enum values needed -- existing IMAGE_DRAW, IMAGE_PULID, IMAGE_DRAW_IPADAPTER are sufficient | Phase Requirements | May need to reconsider if character consistency requires distinct task types |

## Open Questions

1. **PhotoMaker support**
   - What we know: REQUIREMENTS.md TASK-03 mentions "IP-Adapter/InstantID/PhotoMaker" but no PhotoMaker workflow builder exists in the codebase. The `workflow_builder.py` has `build_flux_ipadapter_workflow` and `build_pulid_flux_workflow`.
   - What's unclear: Whether PhotoMaker support is expected in this phase or is future work.
   - Recommendation: If no builder exists, skip PhotoMaker routing and document it as a future addition. The success criteria says "triggers the correct character consistency workflow" which implies all three should work, but we can only route to workflows that exist.

2. **IMAGE_PULID and IMAGE_DRAW_IPADAPTER TaskTypes**
   - What we know: These TaskTypes exist in the enum and have dedicated routing in the executor. Success criterion #5 says IMAGE_DRAW with IP-Adapter params should trigger the correct workflow.
   - What's unclear: Should tasks use `type=IMAGE_DRAW + params.extra.mode="ipadapter"` or `type=IMAGE_DRAW_IPADAPTER`? The design says "TaskType stays broad" but specialized types already exist.
   - Recommendation: Support BOTH paths for backward compatibility. `params.extra.mode` takes priority; TaskType-specific routing remains as fallback.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Python 3.12 | Core runtime | Yes | 3.12.3 | -- |
| pytest | Testing | Yes | 9.0.3 | -- |
| Pydantic | Data models | Yes | (installed) | -- |
| httpx | Engine HTTP clients | Yes | (installed) | -- |
| yaml | Engine config parsing | Yes | (installed) | -- |

**Missing dependencies with no fallback:** None

**Missing dependencies with fallback:** None

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest 9.0.3 |
| Config file | none -- pytest auto-discovers tests/ |
| Quick run command | `cd docker/gold-team && python3 -m pytest tests/test_executor_routing.py -v --tb=short` |
| Full suite command | `cd docker/gold-team && python3 -m pytest tests/ -v --tb=short` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ENG-01 | Engine registration grouped by backend type | unit | `pytest tests/test_engine_registration.py -v` | No -- Wave 0 |
| ENG-02 | No per-model Engine subclasses for ComfyUI | unit | `pytest tests/test_engine_registration.py::test_no_comfyui_model_subclasses -v` | No -- Wave 0 |
| ENG-03 | ComfyUIEngine dual-engine routing | unit | `pytest tests/test_executor_routing.py::TestTrellisBypassesDedicatedEngine -v` | Yes (existing) |
| ENG-04 | DockerPollingAPIEngine + CloudEngine work after refactor | unit | `pytest tests/test_engine_registration.py::test_backend_type_classifications -v` | No -- Wave 0 |
| TASK-01 | VIDEO_FINAL + lip_sync routing | unit | `pytest tests/test_executor_routing.py::TestLipSyncRouting -v` | Yes (existing) |
| TASK-02 | UPSCALE + frame_interp routing | unit | `pytest tests/test_executor_routing.py::TestFrameInterpRouting -v` | Yes (existing) |
| TASK-03 | IMAGE_DRAW + ipadapter/pulid/instantid routing | unit | `pytest tests/test_executor_routing.py::TestCharacterConsistencyRouting -v` | No -- Wave 0 |
| TASK-04 | params.extra routing in executor | unit | `pytest tests/test_executor_routing.py -v` | Partial -- Wave 0 |

### Sampling Rate
- **Per task commit:** `cd docker/gold-team && python3 -m pytest tests/test_executor_routing.py tests/test_workflow_builder.py -v --tb=short`
- **Per wave merge:** `cd docker/gold-team && python3 -m pytest tests/ -v --tb=short`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/test_engine_registration.py` -- covers ENG-01, ENG-02, ENG-04 (backend type grouping, no per-model subclasses, classification)
- [ ] `tests/test_executor_routing.py` needs new `TestCharacterConsistencyRouting` class -- covers TASK-03
- [ ] No new framework install needed -- pytest 9.0.3 already available

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | N/A -- internal service |
| V3 Session Management | No | N/A |
| V4 Access Control | No | N/A -- internal API |
| V5 Input Validation | Yes | Pydantic models validate task params |
| V6 Cryptography | No | N/A |

### Known Threat Patterns for Engine Architecture

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Workflow injection via params.extra | Tampering | Pydantic validates task params; workflow_builder constructs all node graphs |
| Engine ID spoofing | Spoofing | Engine IDs are hardcoded in main.py, not user-supplied |

## Sources

### Primary (HIGH confidence)
- Codebase analysis: `executor.py`, `engine/router.py`, `engines/base.py`, `main.py`, `models/task.py`, `config/engine_registry.py`
- Existing test suite: `tests/test_executor_routing.py` (14 passing tests)
- Phase 17 completion: WFB-06, WFB-07, WFB-08 implemented and verified

### Secondary (MEDIUM confidence)
- CONTEXT.md: Phase boundary and established patterns documented by prior phases

### Tertiary (LOW confidence)
- A1 (InstantID reuses IP-Adapter): Based on workflow structure similarity, not explicit documentation

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new packages, all existing code verified by reading source
- Architecture: HIGH - clear separation between router (which engine) and executor (which workflow), established in Phase 17
- Pitfalls: HIGH - identified from reading the actual if/elif chain in executor.py

**Research date:** 2026-06-12
**Valid until:** 2026-07-12 (stable architecture, no fast-moving dependencies)
