"""Task executor — picks tasks from queue and dispatches to engines."""
from __future__ import annotations

import asyncio
import logging
from typing import Any, Optional

from src.v6.callbacks import build_callback_payload, send_callback
from src.v6.engines.base import BaseEngine
from src.v6.engines.comfyui import ComfyUIEngine
from src.v6.engines.mock import MockEngine
from src.v6.models.task import (
    EnginePool,
    GenerationTask,
    TaskMetadata,
    TaskOutputs,
    TaskStatus,
    TaskType,
)
from src.v6.store import get_task_store

logger = logging.getLogger(__name__)


# Map TaskType → default output fields for mock/local
_TASK_OUTPUT_FIELDS: dict[TaskType, dict[str, str]] = {
    TaskType.VIDEO_FINAL: {"video": "final.mp4", "thumbnail": "thumb.jpg"},
    TaskType.VIDEO_PREVIEW: {"video": "preview.mp4", "thumbnail": "thumb.jpg"},
    TaskType.IMAGE_DRAW: {"image": "render.png", "thumbnail": "thumb.jpg"},
    TaskType.IMAGE_REFINE: {"image": "refined.png"},
    TaskType.TTS: {"audio": "voice.wav"},
    TaskType.MUSIC: {"audio": "bgm.wav"},
    TaskType.SFX: {"audio": "sfx.wav"},
    TaskType.UPSCALE: {"image": "upscaled.png"},
    TaskType.FACE_RESTORE: {"image": "face_restored.png"},
    TaskType.IMAGE_TO_3D: {"image": "model.glb"},
}


class TaskExecutor:
    """Background worker that pulls pending tasks and runs them through engines."""

    def __init__(self) -> None:
        self._engines: dict[str, BaseEngine] = {}
        self._running = False
        self._worker_task: Optional[asyncio.Task] = None

    def register_engine(self, engine: BaseEngine) -> None:
        """Register an engine by its engine_id."""
        self._engines[engine.engine_id] = engine
        logger.info("Executor: registered engine '%s' (%s)", engine.engine_id, engine.name)

    def get_engine(self, engine_id: str) -> Optional[BaseEngine]:
        return self._engines.get(engine_id)

    def list_engines(self) -> list[BaseEngine]:
        return list(self._engines.values())

    async def start(self) -> None:
        """Start all registered engines and the background worker loop."""
        for engine in self._engines.values():
            await engine.start()

        if self._running:
            return
        self._running = True
        self._worker_task = asyncio.create_task(self._worker_loop())
        logger.info("TaskExecutor started with %d engine(s)", len(self._engines))

    async def stop(self) -> None:
        """Stop worker and teardown engines."""
        self._running = False
        if self._worker_task:
            self._worker_task.cancel()
            try:
                await self._worker_task
            except asyncio.CancelledError:
                pass

        for engine in self._engines.values():
            await engine.stop()

    async def _worker_loop(self) -> None:
        """Continuously poll the task queue and dispatch."""
        store = get_task_store()

        while self._running:
            try:
                task_id = await asyncio.wait_for(store._queue.get(), timeout=1.0)
            except asyncio.TimeoutError:
                continue
            except asyncio.CancelledError:
                break

            task = await store.get(task_id)
            if not task or task.status == TaskStatus.CANCELLED:
                continue

            # Run task
            await self._execute_task(task)

    async def _execute_task(self, task: GenerationTask) -> None:
        """Execute a single task through the appropriate engine."""
        store = get_task_store()

        await store.update(task.task_id, status=TaskStatus.RUNNING, progress=0.0)

        engine_id = task.engine_id or "mock"
        engine = self._resolve_engine(engine_id, task)

        if not engine:
            await store.update(
                task.task_id,
                status=TaskStatus.FAILED,
                error=f"No engine available for '{engine_id}'",
            )
            return

        try:
            # Build workflow from task params
            workflow = task.params.get("workflow")
            if not workflow or "__mock__" in workflow:
                # Auto-build ComfyUI workflow from prompt params
                from src.v6.engines.workflow_builder import build_txt2img_workflow
                workflow = build_txt2img_workflow(
                    prompt=task.params.get("prompt", ""),
                    negative_prompt=task.params.get("negative_prompt", ""),
                    width=task.params.get("width", 1024),
                    height=task.params.get("height", 1024),
                    steps=task.params.get("steps", 20),
                    cfg_scale=task.params.get("cfg_scale", 7.5),
                    seed=task.params.get("seed"),
                )
                logger.info("Auto-built ComfyUI workflow for task %s", task.task_id)
            engine_params = {"task_id": task.task_id, "type": task.type.value}

            engine_job_id = await engine.submit(workflow, engine_params)

            # Poll until done
            while self._running:
                result = await engine.poll(engine_job_id)
                status = result.get("status", "running")
                progress = result.get("progress", 0.0)

                await store.update(task.task_id, progress=progress)

                if status == "completed":
                    output_data = await engine.get_output(engine_job_id)
                    outputs = self._build_task_outputs(task, output_data)
                    metadata = TaskMetadata(
                        seed=task.params.get("seed", 42),
                        cost_usd=0.0,
                        inference_time_sec=3.0,
                        gpu_memory_peak_gb=8.0,
                        model_name=engine.name,
                    )
                    await store.update(
                        task.task_id,
                        status=TaskStatus.COMPLETED,
                        outputs=outputs,
                        metadata=metadata,
                        progress=100.0,
                    )
                    logger.info("Task %s completed via %s", task.task_id, engine.engine_id)
                    break

                if status == "failed":
                    error_msg = result.get("error", "Engine execution failed")
                    await store.update(
                        task.task_id,
                        status=TaskStatus.FAILED,
                        error=error_msg,
                    )
                    logger.error("Task %s failed: %s", task.task_id, error_msg)
                    break

                await asyncio.sleep(0.5)

            # Send callback if configured
            if task.callback_url:
                await send_callback(task, task.callback_url, task.callback_secret)

        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.exception("Task %s execution error", task.task_id)
            await store.update(
                task.task_id,
                status=TaskStatus.FAILED,
                error=str(e),
            )
            if task.callback_url:
                await send_callback(task, task.callback_url, task.callback_secret)

    def _resolve_engine(self, engine_id: str, task: GenerationTask) -> Optional[BaseEngine]:
        """Resolve engine by ID, preferring real engines over mock."""
        # Direct match
        if engine_id in self._engines:
            return self._engines[engine_id]

        # For local/unset engine_id, prefer comfyui-local over mock
        if engine_id is None or engine_id in ("local", "local-comfyui", "local-comfyui-mock"):
            comfyui = self._engines.get("comfyui-local")
            if comfyui and comfyui.status().value == "online":
                return comfyui
            # Fallback to mock if comfyui unavailable
            return self._engines.get("mock")

        # Fallback to mock
        return self._engines.get("mock")

    def _build_task_outputs(self, task: GenerationTask, output_data: dict[str, Any]) -> TaskOutputs:
        """Build TaskOutputs from engine output data."""
        # If engine returned structured outputs with URLs, map them
        artifacts = output_data.get("outputs", [])

        video = None
        image = None
        audio = None
        thumbnail = None

        for a in artifacts:
            url = a.get("url", "")
            a_type = a.get("type", "")
            if a_type == "video" and not video:
                video = url
            elif a_type == "image" and not image:
                image = url
            elif a_type == "audio" and not audio:
                audio = url

        # Use first image as thumbnail if not set
        if not thumbnail and image:
            thumbnail = image

        # Fallback to template paths
        if not any([video, image, audio]):
            fields = _TASK_OUTPUT_FIELDS.get(task.type, {"image": "output.png"})
            paths = {
                k: f"/mnt/agents/output/{task.task_id}/{v}"
                for k, v in fields.items()
            }
            return TaskOutputs(**paths)

        return TaskOutputs(video=video, image=image, audio=audio, thumbnail=thumbnail)


# Singleton
_executor: Optional[TaskExecutor] = None


def get_executor() -> TaskExecutor:
    global _executor
    if _executor is None:
        _executor = TaskExecutor()
    return _executor
