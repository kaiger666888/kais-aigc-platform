"""Health check endpoint."""
from __future__ import annotations

import time
from datetime import datetime

from fastapi import APIRouter

from src.v6.engine.local_pool import get_local_pool
from src.v6.engine.cloud_pool import get_cloud_pool
from src.v6 import __version__

router = APIRouter(tags=["Health"])

_start_time = time.monotonic()


@router.get("/health")
async def health_check():
    local_pool = get_local_pool()
    cloud_pool = get_cloud_pool()
    local_health = local_pool.health()
    cloud_health = cloud_pool.health()

    overall = "healthy"
    if not local_health["available"] and not cloud_health["available"]:
        overall = "unhealthy"
    elif not local_health["available"]:
        overall = "degraded"

    return {
        "status": overall,
        "version": __version__,
        "uptime_sec": round(time.monotonic() - _start_time, 1),
        "gpu": {
            "device": "NVIDIA GeForce RTX 3090",
            "vram_total_mb": local_health["vram_total_mb"],
            "vram_used_mb": local_health.get("vram_used_mb", 0),
            "utilization_pct": local_health["gpu_utilization_pct"],
        } if local_health["available"] else None,
        "redis": "connected",
        "timestamp": datetime.utcnow().isoformat() + "Z",
    }
