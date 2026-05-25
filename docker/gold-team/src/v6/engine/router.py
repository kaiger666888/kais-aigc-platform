"""Engine Router — default local RTX 3090, degrade to cloud."""
from __future__ import annotations

import logging
from typing import Optional

from src.v6.models.task import EnginePool, GenerationTask, ModelPreference, TaskType

logger = logging.getLogger(__name__)

# VRAM requirements by task type (mock estimates, GB)
VRAM_ESTIMATES: dict[TaskType, float] = {
    TaskType.VIDEO_FINAL: 22.0,
    TaskType.VIDEO_PREVIEW: 14.0,
    TaskType.IMAGE_DRAW: 8.0,
    TaskType.IMAGE_REFINE: 6.0,
    TaskType.TTS: 2.0,
    TaskType.MUSIC: 4.0,
    TaskType.SFX: 2.0,
    TaskType.UPSCALE: 2.0,
    TaskType.FACE_RESTORE: 1.5,
    TaskType.IMAGE_TO_3D: 10.0,
}

# Local-only task types (no cloud fallback)
LOCAL_ONLY_TYPES: set[TaskType] = set()

# Cloud-capable task types
CLOUD_CAPABLE: set[TaskType] = {
    TaskType.VIDEO_FINAL,
    TaskType.VIDEO_PREVIEW,
    TaskType.IMAGE_DRAW,
    TaskType.IMAGE_REFINE,
    TaskType.IMAGE_TO_3D,
}

# Total VRAM available on RTX 3090
LOCAL_VRAM_GB = 24.0
VRAM_HARD_CAP_GB = 23.5


class EngineRouter:
    """Decides which engine pool (local/cloud) a task should run on."""

    def __init__(
        self,
        local_available: bool = True,
        local_vram_used_gb: float = 0.0,
    ) -> None:
        self.local_available = local_available
        self.local_vram_used_gb = local_vram_used_gb

    def _vram_available(self) -> float:
        return max(0.0, VRAM_HARD_CAP_GB - self.local_vram_used_gb)

    def route(self, task: GenerationTask) -> tuple[EnginePool, str]:
        """
        Route a task to an engine pool.
        Returns (pool, engine_id).
        """
        # Explicit preference
        if task.model_preference == ModelPreference.CLOUD:
            return EnginePool.CLOUD, "cloud-mock"

        if task.model_preference == ModelPreference.LOCAL:
            if self.local_available:
                return EnginePool.LOCAL, "comfyui-local"
            return EnginePool.CLOUD, "cloud-mock"  # fallback even if forced local

        # AUTO: try local first
        if not self.local_available:
            logger.info("Local unavailable → cloud for task %s", task.task_id)
            return EnginePool.CLOUD, "cloud-mock"

        vram_needed = VRAM_ESTIMATES.get(task.type, 8.0)
        vram_available = self._vram_available()

        if vram_needed <= vram_available:
            return EnginePool.LOCAL, "comfyui-local"

        # Local VRAM insufficient
        if task.type in CLOUD_CAPABLE:
            logger.info(
                "VRAM insufficient (%.1f/%.1f GB) → cloud for task %s",
                vram_needed,
                vram_available,
                task.task_id,
            )
            return EnginePool.CLOUD, "cloud-mock"

        # No cloud fallback
        logger.warning(
            "VRAM insufficient and no cloud fallback for task %s (type=%s)",
            task.task_id,
            task.type.value,
        )
        return EnginePool.LOCAL, "local-comfyui-mock"  # will queue and wait


# Singleton
_router: Optional[EngineRouter] = None


def get_engine_router() -> EngineRouter:
    global _router
    if _router is None:
        _router = EngineRouter(local_available=True, local_vram_used_gb=0.0)
    return _router
