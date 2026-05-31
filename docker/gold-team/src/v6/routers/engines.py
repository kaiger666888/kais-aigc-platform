"""Engine status and health query APIs."""
from __future__ import annotations

import time
from datetime import datetime
from typing import Any

from fastapi import APIRouter, HTTPException

from src.v6.engine.cloud_pool import CLOUD_PROVIDERS, get_cloud_pool
from src.v6.executor import get_executor as _get_executor
from src.v6.engine.local_pool import get_local_pool
from src.v6.engine.router import LOCAL_VRAM_GB, VRAM_HARD_CAP_GB
from src.v6.executor import get_executor
from src.v6.models.task import TaskType, TaskStatus
from src.v6.store import get_task_store

router = APIRouter(prefix="/api/v1/engines", tags=["Engine"])

# ── /api/v1/capabilities ──────────────────────────────────────────────
cap_router = APIRouter(prefix="/api/v1", tags=["Capabilities"])

_CAPABILITIES = {
    "version": "6.0",
    "engines": [
        {
            "engine_id": "comfyui-local",
            "name": "ComfyUI Local (RTX 3090)",
            "status": "online",
            "vram_total_mb": 24576,
            "vram_available_mb": 20000,
            "supported_types": ["video_final", "video_preview", "image_draw", "image_refine", "upscale", "face_restore"],
            "models": {
                "wan2.2-i2v-gguf": {
                    "description": "Wan 2.2 I2V 14B GGUF/FP8 (quantized)",
                    "type": "video_final",
                    "requires": ["source_image_path"],
                    "params": {
                        "width": {"type": "integer", "default": 832, "min": 256, "max": 1280, "description": "Video width (16-aligned)"},
                        "height": {"type": "integer", "default": 480, "min": 256, "max": 1280, "description": "Video height (16-aligned)"},
                        "num_frames": {"type": "integer", "default": 81, "min": 1, "max": 161, "description": "Number of frames"},
                        "fps": {"type": "integer", "default": 16, "min": 1, "max": 60, "description": "Output FPS"},
                        "cfg": {"type": "float", "default": 3.5, "min": 1.0, "max": 10.0, "description": "CFG scale"},
                        "shift": {"type": "float", "default": 5.0, "min": 1.0, "max": 10.0, "description": "Noise shift"},
                        "high_noise_steps": {"type": "integer", "default": 10, "description": "High noise sampling steps"},
                        "total_steps": {"type": "integer", "default": 20, "description": "Total sampling steps"},
                        "prompt": {"type": "string", "required": True, "description": "Text prompt"},
                        "negative_prompt": {"type": "string", "default": "static, blurry, low quality", "description": "Negative prompt"},
                        "source_image_path": {"type": "string", "required": True, "description": "Uploaded image filename in ComfyUI input folder"},
                    },
                    "vram_estimate_gb": 22,
                    "quality": "high",
                    "speed": "medium (~3-5 min for 81 frames at 832x480)",
                    "notes": "GGUF Q8_0 + FP8 quantized. Two-stage sampling. Validated on RTX 3090 24GB.",
                },
                "wan2.5-t2v-preview": {
                    "description": "Wan 2.5 T2V 1.3B Preview (fast)",
                    "type": "video_preview",
                    "params": {
                        "width": {"type": "integer", "default": 832},
                        "height": {"type": "integer", "default": 480},
                        "num_frames": {"type": "integer", "default": 33},
                        "fps": {"type": "integer", "default": 16},
                        "prompt": {"type": "string", "required": True},
                        "negative_prompt": {"type": "string", "default": ""},
                    },
                    "vram_estimate_gb": 8,
                    "quality": "preview",
                    "speed": "fast",
                },
                "flux-dev": {
                    "description": "Flux Dev FP16 image generation",
                    "type": "image_draw",
                    "params": {
                        "width": {"type": "integer", "default": 1024},
                        "height": {"type": "integer", "default": 1024},
                        "steps": {"type": "integer", "default": 20},
                        "cfg_scale": {"type": "float", "default": 7.5},
                        "prompt": {"type": "string", "required": True},
                        "negative_prompt": {"type": "string", "default": ""},
                    },
                    "vram_estimate_gb": 18,
                    "quality": "high",
                    "speed": "medium",
                },
            },
        },
        {
            "engine_id": "tts-local",
            "name": "TTS Local (CosyVoice + Edge-TTS)",
            "status": "online",
            "supported_types": ["tts"],
            "models": {
                "cosyvoice": {
                    "description": "CosyVoice Chinese TTS",
                    "params": {
                        "text": {"type": "string", "required": True},
                        "voice": {"type": "string", "default": "default"},
                        "speed": {"type": "float", "default": 1.0},
                    },
                    "quality": "high",
                    "speed": "fast",
                },
                "edge-tts": {
                    "description": "Edge TTS (fallback, multi-language)",
                    "params": {
                        "text": {"type": "string", "required": True},
                        "voice": {"type": "string", "default": "zh-CN-XiaoxiaoNeural"},
                        "speed": {"type": "float", "default": 1.0},
                    },
                    "quality": "medium",
                    "speed": "fast",
                },
            },
        },
    ],
    "task_types": {
        "video_final": {"description": "Final quality video generation", "default_model": "wan2.2-i2v-gguf", "vram_gb": 22},
        "video_preview": {"description": "Quick video preview", "default_model": "wan2.5-t2v-preview", "vram_gb": 8},
        "image_draw": {"description": "Image generation from text", "default_model": "flux-dev", "vram_gb": 18},
        "image_refine": {"description": "Image refinement", "vram_gb": 6},
        "tts": {"description": "Text-to-speech", "default_model": "cosyvoice", "vram_gb": 2},
        "upscale": {"description": "Image upscaling", "vram_gb": 2},
        "face_restore": {"description": "Face restoration", "vram_gb": 1.5},
    },
}


@cap_router.get("/capabilities")
async def get_capabilities():
    """Return full engine & model capabilities catalog.

    Static declaration — no live ComfyUI queries, so it responds instantly.
    Agents use this to pick the right engine/model/params for a task.
    """
    cap = dict(_CAPABILITIES)  # shallow copy to allow mutation

    # Patch engine status from live executor if available
    executor = _get_executor()
    for engine_def in cap["engines"]:
        live = executor.get_engine(engine_def["engine_id"])
        if live:
            try:
                h = await live.health()
                engine_def["status"] = "online" if h.get("available") else "offline"
            except Exception:
                pass

    return cap


@router.get("")
async def list_engines():
    """List all registered engines (executor-managed + legacy)."""
    executor = get_executor()
    local_pool = get_local_pool()
    cloud_pool = get_cloud_pool()
    local_health = local_pool.health()

    engines = []

    # Executor-managed engines (new)
    for engine in executor.list_engines():
        cap = engine.capabilities
        engines.append({
            "id": engine.engine_id,
            "name": engine.name,
            "pool": "local",
            "type": "executor",
            "status": "online",
            "supported_types": cap.supported_types,
            "vram_total_mb": cap.vram_total_mb,
            "vram_used_mb": cap.vram_total_mb - cap.vram_available_mb,
            "queue_depth": 0,
            "models": cap.models,
        })

    # Legacy local ComfyUI
    engines.append({
        "id": "local-comfyui",
        "name": "ComfyUI Local (RTX 3090)",
        "pool": "local",
        "type": "comfyui",
        "status": "online" if local_health["available"] else "offline",
        "supported_types": [t.value for t in TaskType],
        "vram_total_mb": local_health["vram_total_mb"],
        "vram_used_mb": local_health.get("vram_used_mb", 0),
        "queue_depth": 0,
        "models": ["wan2.2-14b", "flux-dev", "ace-step", "cosyvoice", "real-esrgan"],
    })

    # Legacy cloud providers
    for pid, info in CLOUD_PROVIDERS.items():
        engines.append({
            "id": f"cloud-{pid}",
            "name": info["name"],
            "pool": "cloud",
            "type": pid,
            "status": "online" if info["available"] else "offline",
            "supported_types": info["supported_types"],
            "vram_total_mb": None,
            "vram_used_mb": None,
            "queue_depth": 0,
            "models": [],
        })

    return {"engines": engines}


@router.get("/capacity")
async def get_capacity():
    local_pool = get_local_pool()
    cloud_pool = get_cloud_pool()
    store = get_task_store()
    local_health = local_pool.health()
    cloud_health = cloud_pool.health()

    _, queue_total = await store.list_tasks(limit=1)
    running_tasks, _ = await store.list_tasks(status=TaskStatus.RUNNING, limit=1)

    return {
        "local": {
            "available": local_health["available"],
            "vram_total_mb": local_health["vram_total_mb"],
            "vram_available_mb": local_health["vram_available_mb"],
            "gpu_utilization_pct": local_health["gpu_utilization_pct"],
            "running_tasks": len(running_tasks),
            "queued_tasks": await store.queue_size(),
            "estimated_wait_sec": await store.queue_size() * 5.0,
        },
        "cloud": cloud_health,
        "total_queue_depth": await store.queue_size(),
        "timestamp": datetime.utcnow().isoformat() + "Z",
    }


@router.get("/{engine_id}/health")
async def engine_health(engine_id: str):
    executor = get_executor()
    local_pool = get_local_pool()
    cloud_pool = get_cloud_pool()

    start = time.monotonic()

    # Check executor-managed engines first
    engine = executor.get_engine(engine_id)
    if engine:
        health_data = await engine.health()
        elapsed = (time.monotonic() - start) * 1000
        return {
            "id": engine_id,
            "status": "healthy" if health_data.get("available") else "unhealthy",
            "response_time_ms": elapsed,
            "details": health_data,
            "checked_at": datetime.utcnow().isoformat() + "Z",
        }

    # Legacy engines
    if engine_id.startswith("local"):
        health = local_pool.health()
        status = "healthy" if health["available"] else "unhealthy"
        details = health
    elif engine_id.startswith("cloud-"):
        provider = engine_id.replace("cloud-", "")
        info = CLOUD_PROVIDERS.get(provider, {})
        status = "healthy" if info.get("available") else "unhealthy"
        details = {"provider": provider, "available": info.get("available", False)}
    else:
        raise HTTPException(status_code=404, detail={
            "error": "engine_not_found",
            "message": f"Engine '{engine_id}' not found",
        })

    elapsed = (time.monotonic() - start) * 1000

    return {
        "id": engine_id,
        "status": status,
        "response_time_ms": elapsed,
        "details": details,
        "checked_at": datetime.utcnow().isoformat() + "Z",
    }


@router.get("/{engine_id}/status")
async def engine_status(engine_id: str):
    """Detailed status for a specific executor-managed engine."""
    executor = get_executor()
    engine = executor.get_engine(engine_id)
    if not engine:
        raise HTTPException(status_code=404, detail={
            "error": "engine_not_found",
            "message": f"Executor engine '{engine_id}' not found",
        })

    health_data = await engine.health()
    cap = engine.capabilities

    return {
        "id": engine.engine_id,
        "name": engine.name,
        "health": health_data,
        "capabilities": {
            "supported_types": cap.supported_types,
            "max_resolution": list(cap.max_resolution),
            "max_duration_sec": cap.max_duration_sec,
            "vram_total_mb": cap.vram_total_mb,
            "models": cap.models,
        },
    }
