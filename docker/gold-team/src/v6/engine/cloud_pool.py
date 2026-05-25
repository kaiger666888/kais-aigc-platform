"""Cloud Engine Pool — Kling / Jimeng / Seedance / Runway / Luma (mock mode)."""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from typing import Any, Optional

from src.v6.models.task import (
    GenerationTask,
    TaskMetadata,
    TaskOutputs,
    TaskStatus,
)
from src.v6.store import get_task_store

logger = logging.getLogger(__name__)

CLOUD_PROVIDERS = {
    "kling": {
        "name": "可灵 (Kling)",
        "available": True,
        "supported_types": ["video_final", "video_preview", "image_draw"],
    },
    "jimeng": {
        "name": "即梦 (Jimeng)",
        "available": True,
        "supported_types": ["image_draw", "image_refine", "video_final"],
    },
    "seedance": {
        "name": "Seedance",
        "available": True,
        "supported_types": ["video_final", "video_preview"],
    },
    "runway": {
        "name": "Runway",
        "available": False,
        "supported_types": ["video_final", "video_preview"],
    },
    "luma": {
        "name": "Luma",
        "available": False,
        "supported_types": ["video_final", "video_preview"],
    },
}


class CloudPool:
    """Cloud API pool. Mock mode returns preset results with simulated latency."""

    async def submit(self, task: GenerationTask) -> None:
        """Submit task to cloud engine (mock)."""
        store = get_task_store()

        await store.update(
            task.task_id,
            status=TaskStatus.RUNNING,
            engine_id="cloud-mock-kling",
            progress=0.0,
        )

        # Simulate cloud execution in background
        asyncio.create_task(self._mock_execute(task))

    async def _mock_execute(self, task: GenerationTask) -> None:
        store = get_task_store()

        try:
            # Simulate cloud latency
            await asyncio.sleep(1.0)
            await store.update(task.task_id, progress=30.0)

            await asyncio.sleep(1.0)
            await store.update(task.task_id, progress=70.0)

            await asyncio.sleep(0.5)

            outputs = TaskOutputs(
                video=f"/mnt/agents/output/{task.task_id}/cloud_final.mp4",
                thumbnail=f"/mnt/agents/output/{task.task_id}/cloud_thumb.jpg",
            )
            metadata = TaskMetadata(
                seed=task.params.get("seed", 999),
                cost_usd=0.15,
                inference_time_sec=2.5,
                model_name="cloud-kling-v1",
                cloud_task_id=f"ext_{task.task_id}_mock",
            )

            await store.update(
                task.task_id,
                status=TaskStatus.COMPLETED,
                outputs=outputs,
                metadata=metadata,
                progress=100.0,
            )
            logger.info("Cloud mock task completed: %s", task.task_id)

        except Exception as e:
            await store.update(
                task.task_id,
                status=TaskStatus.FAILED,
                error=str(e),
            )

    def health(self) -> dict[str, Any]:
        providers = []
        for pid, info in CLOUD_PROVIDERS.items():
            providers.append({
                "name": pid,
                "available": info["available"],
                "rate_limit_remaining": 100 if info["available"] else 0,
            })
        return {
            "available": any(p["available"] for p in providers),
            "active_providers": providers,
        }


# Singleton
_cloud_pool: Optional[CloudPool] = None


def get_cloud_pool() -> CloudPool:
    global _cloud_pool
    if _cloud_pool is None:
        _cloud_pool = CloudPool()
    return _cloud_pool
