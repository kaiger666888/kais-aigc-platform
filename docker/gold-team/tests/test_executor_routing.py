"""Unit tests for executor routing — verifies TRELLIS workflow routing (WFB-04, WFB-05).

Covers:
  test_image_to_3d_trellis_routing       WFB-04  params.extra.engine="trellis"
  test_image_to_3d_flux_trellis_routing  WFB-05  params.extra.mode="flux_trellis"
  test_image_to_3d_default_hunyuan3d     regression — no extra params → hunyuan3d
  test_trellis_bypasses_dedicated_engine  TRELLIS goes to comfyui-primary, not hunyuan3d-local
"""
from __future__ import annotations

import pytest

from src.v6.engine.router import EngineRouter, DEDICATED_ENGINES
from src.v6.models.task import (
    EnginePool,
    GenerationTask,
    TaskStatus,
    TaskType,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_task(
    task_type: TaskType = TaskType.IMAGE_TO_3D,
    params: dict | None = None,
    task_id: str = "test-task-001",
) -> GenerationTask:
    """Create a GenerationTask with sensible defaults for routing tests."""
    return GenerationTask(
        task_id=task_id,
        type=task_type,
        params=params or {},
        status=TaskStatus.QUEUED,
    )


def _find_class_type_in_workflow(workflow: dict, class_type: str) -> bool:
    """Check if any node in the workflow dict has the given class_type."""
    for node in workflow.values():
        if isinstance(node, dict) and node.get("class_type") == class_type:
            return True
    return False


# ---------------------------------------------------------------------------
# Routing tests — executor workflow selection
# ---------------------------------------------------------------------------

class TestImageTo3DTrellisRouting:
    """Verify IMAGE_TO_3D + params.extra.engine="trellis" selects TRELLIS builder."""

    def test_image_to_3d_trellis_routing(self):
        """WFB-04: extra.engine="trellis" must produce TRELLISImageTo3D node."""
        from src.v6.engines.workflow_builder import build_trellis_image_to_3d_workflow

        task = _make_task(params={
            "input_image": "test.png",
            "extra": {"engine": "trellis"},
        })

        # Simulate the routing logic the executor will use
        extra = task.params.get("extra", {})
        extra_engine = extra.get("engine", "")
        extra_mode = extra.get("mode", "")

        if extra_mode == "flux_trellis":
            from src.v6.engines.workflow_builder import build_flux_trellis_full_workflow
            workflow = build_flux_trellis_full_workflow(prompt=task.params.get("prompt", ""))
        elif extra_engine == "trellis":
            input_image = task.params.get("input_image") or task.params.get("image", "")
            workflow = build_trellis_image_to_3d_workflow(image_name=input_image)
        else:
            from src.v6.engines.workflow_builder import build_hunyuan3d_workflow
            workflow = build_hunyuan3d_workflow(input_image=task.params.get("input_image", ""))

        assert _find_class_type_in_workflow(workflow, "TRELLISImageTo3D"), \
            "Expected TRELLISImageTo3D node in workflow for trellis routing"

    def test_image_to_3d_flux_trellis_routing(self):
        """WFB-05: extra.mode="flux_trellis" must produce TRELLISImageTo3D node."""
        from src.v6.engines.workflow_builder import build_flux_trellis_full_workflow

        task = _make_task(params={
            "prompt": "a 3d object",
            "extra": {"mode": "flux_trellis"},
        })

        extra = task.params.get("extra", {})
        extra_engine = extra.get("engine", "")
        extra_mode = extra.get("mode", "")

        if extra_mode == "flux_trellis":
            workflow = build_flux_trellis_full_workflow(prompt=task.params.get("prompt", ""))
        elif extra_engine == "trellis":
            from src.v6.engines.workflow_builder import build_trellis_image_to_3d_workflow
            input_image = task.params.get("input_image") or task.params.get("image", "")
            workflow = build_trellis_image_to_3d_workflow(image_name=input_image)
        else:
            from src.v6.engines.workflow_builder import build_hunyuan3d_workflow
            workflow = build_hunyuan3d_workflow(input_image=task.params.get("input_image", ""))

        assert _find_class_type_in_workflow(workflow, "TRELLISImageTo3D"), \
            "Expected TRELLISImageTo3D node in workflow for flux_trellis routing"

    def test_image_to_3d_default_hunyuan3d(self):
        """Regression: no extra params → hunyuan3d workflow (no TRELLIS node)."""
        from src.v6.engines.workflow_builder import build_hunyuan3d_workflow

        task = _make_task(params={
            "input_image": "test.png",
        })

        extra = task.params.get("extra", {})
        extra_engine = extra.get("engine", "")
        extra_mode = extra.get("mode", "")

        if extra_mode == "flux_trellis":
            from src.v6.engines.workflow_builder import build_flux_trellis_full_workflow
            workflow = build_flux_trellis_full_workflow(prompt=task.params.get("prompt", ""))
        elif extra_engine == "trellis":
            from src.v6.engines.workflow_builder import build_trellis_image_to_3d_workflow
            input_image = task.params.get("input_image") or task.params.get("image", "")
            workflow = build_trellis_image_to_3d_workflow(image_name=input_image)
        else:
            workflow = build_hunyuan3d_workflow(input_image=task.params.get("input_image", ""))

        # Must NOT contain TRELLIS nodes — this is the default hunyuan3d path
        assert not _find_class_type_in_workflow(workflow, "TRELLISImageTo3D"), \
            "Default IMAGE_TO_3D should use hunyuan3d, not TRELLIS"


# ---------------------------------------------------------------------------
# Routing tests — engine router DEDICATED_ENGINES bypass
# ---------------------------------------------------------------------------

class TestTrellisBypassesDedicatedEngine:
    """Verify TRELLIS tasks bypass DEDICATED_ENGINES and go to comfyui-primary."""

    def test_trellis_bypasses_dedicated_engine(self):
        """IMAGE_TO_3D + extra.engine="trellis" must route to comfyui-primary."""
        router = EngineRouter(
            local_available=True,
            local_vram_used_gb=0.0,
            primary_available=True,
            auxiliary_available=True,
        )

        task = _make_task(params={
            "input_image": "test.png",
            "extra": {"engine": "trellis"},
        })

        pool, engine_id = router.route(task)

        assert engine_id == "comfyui-primary", \
            f"TRELLIS task should route to comfyui-primary, got '{engine_id}'"
        assert pool == EnginePool.LOCAL

    def test_flux_trellis_bypasses_dedicated_engine(self):
        """IMAGE_TO_3D + extra.mode="flux_trellis" must route to comfyui-primary."""
        router = EngineRouter(
            local_available=True,
            local_vram_used_gb=0.0,
            primary_available=True,
            auxiliary_available=True,
        )

        task = _make_task(params={
            "prompt": "a 3d object",
            "extra": {"mode": "flux_trellis"},
        })

        pool, engine_id = router.route(task)

        assert engine_id == "comfyui-primary", \
            f"flux_trellis task should route to comfyui-primary, got '{engine_id}'"
        assert pool == EnginePool.LOCAL

    def test_default_image_to_3d_routes_to_dedicated(self):
        """Regression: IMAGE_TO_3D without trellis extra → hunyuan3d-local."""
        router = EngineRouter(
            local_available=True,
            local_vram_used_gb=0.0,
            primary_available=True,
            auxiliary_available=True,
        )

        task = _make_task(params={
            "input_image": "test.png",
        })

        pool, engine_id = router.route(task)

        assert engine_id == "hunyuan3d-local", \
            f"Default IMAGE_TO_3D should route to hunyuan3d-local, got '{engine_id}'"
        assert pool == EnginePool.LOCAL
