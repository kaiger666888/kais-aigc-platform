"""Tests for engine backend-type classification and registration correctness."""
from __future__ import annotations

import importlib
import inspect
import os
import sys

import pytest

# Ensure src is importable
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from src.v6.engines.base import BackendType, BaseEngine


# ---------------------------------------------------------------------------
# Helper: lightweight engine instantiation (avoids heavy GPU / HTTP deps)
# ---------------------------------------------------------------------------

def _make_comfyui_engine():
    from src.v6.engines.comfyui import ComfyUIEngine
    return ComfyUIEngine(host="127.0.0.1", port=9999, engine_id="test-comfyui")


def _make_mock_engine():
    from src.v6.engines.mock import MockEngine
    return MockEngine()


def _make_hunyuan3d_engine():
    from src.v6.engines.hunyuan3d import Hunyuan3DEngine
    return Hunyuan3DEngine(output_root="/tmp/test_output", model_dir="/tmp/test_model")


def _make_hunyuan3d_mv_engine():
    from src.v6.engines.hunyuan3d_mv import Hunyuan3DMvEngine
    return Hunyuan3DMvEngine(output_root="/tmp/test_output", model_dir="/tmp/test_model",
                              code_dir="/tmp/test_code")


def _make_tts_tracker():
    from src.v6.engines.tts import TTSTracker
    return TTSTracker(idle_timeout=300, output_root="/tmp/test_output")


def _make_tts_http_engine():
    from src.v6.engines.tts_http import TripleTrackTTSEngine
    return TripleTrackTTSEngine(output_root="/tmp/test_output")


def _make_joycaption_engine():
    from src.v6.engines.joycaption import JoyCaptionEngine
    return JoyCaptionEngine(host="127.0.0.1", port=9999)


def _make_cloud_engine():
    """Instantiate a concrete cloud subclass (JimengEngine) for testing."""
    from src.v6.engines.cloud_jimeng import JimengEngine
    return JimengEngine()


def _make_docker_api_engine():
    """Instantiate DockerAPIEngine with minimal mocked config/container_mgr."""
    from unittest.mock import MagicMock
    from src.v6.engines.docker_base import DockerAPIEngine
    config = MagicMock()
    config.name = "test-docker-engine"
    config.engine_id = "test-docker"
    config.api_port = 9999
    config.task_types = ["image_draw"]
    config.vram_mb = 0
    config.task_type_params = {}
    config.task_type_endpoints = {}
    config.submit_endpoint = "/api/generate"
    config.health_endpoint = "/health"
    config.health_timeout = 5.0
    config.poll_timeout = 30.0
    config.extra_docker_args = []
    config.gpu_device = "all"
    config.docker_image = "test:latest"
    config.task_type_assets = {}
    container_mgr = MagicMock()
    return DockerAPIEngine(config=config, container_mgr=container_mgr)


def _make_docker_cli_engine():
    """Instantiate DockerCLIEngine with minimal mocked config/container_mgr."""
    from unittest.mock import MagicMock
    from src.v6.engines.docker_cli import DockerCLIEngine
    config = MagicMock()
    config.name = "test-cli-engine"
    config.engine_id = "test-cli"
    config.task_types = ["render"]
    config.vram_mb = 0
    config.gpu_device = "all"
    config.extra_docker_args = []
    config.docker_image = "blender:latest"
    container_mgr = MagicMock()
    return DockerCLIEngine(config=config, container_mgr=container_mgr)


# ===================================================================
# Test class: backend_type classification for every engine
# ===================================================================

class TestBackendTypeClassification:
    """Verify each engine subclass reports the correct BackendType."""

    def test_01_comfyui_engine_is_comfyui(self):
        engine = _make_comfyui_engine()
        assert engine.backend_type == BackendType.COMFYUI

    def test_02_cloud_engine_is_cloud(self):
        engine = _make_cloud_engine()
        assert engine.backend_type == BackendType.CLOUD

    def test_03_docker_api_engine_is_docker(self):
        engine = _make_docker_api_engine()
        assert engine.backend_type == BackendType.DOCKER

    def test_04_hunyuan3d_engine_is_subprocess(self):
        engine = _make_hunyuan3d_engine()
        assert engine.backend_type == BackendType.SUBPROCESS

    def test_05_hunyuan3d_mv_engine_is_subprocess(self):
        engine = _make_hunyuan3d_mv_engine()
        assert engine.backend_type == BackendType.SUBPROCESS

    def test_06_tts_tracker_is_subprocess(self):
        engine = _make_tts_tracker()
        assert engine.backend_type == BackendType.SUBPROCESS

    def test_07_triple_track_tts_engine_is_subprocess(self):
        engine = _make_tts_http_engine()
        assert engine.backend_type == BackendType.SUBPROCESS

    def test_08_mock_engine_is_mock(self):
        engine = _make_mock_engine()
        assert engine.backend_type == BackendType.MOCK

    def test_09_joycaption_engine_is_comfyui(self):
        engine = _make_joycaption_engine()
        assert engine.backend_type == BackendType.COMFYUI

    def test_10_docker_cli_engine_is_docker(self):
        engine = _make_docker_cli_engine()
        assert engine.backend_type == BackendType.DOCKER


# ===================================================================
# Test class: ComfyUI architectural correctness (ENG-02)
# ===================================================================

class TestComfyUIArchitecture:
    """Verify no per-model ComfyUI Engine subclasses exist."""

    def test_no_comfyui_model_subclasses(self):
        """ENG-02: No per-model Engine subclasses for ComfyUI models.

        All ComfyUI models go through ComfyUIEngine + workflow_builder,
        not through separate Engine subclasses per model.
        The only ComfyUI-related engines are ComfyUIEngine and JoyCaptionEngine.
        """
        engines_dir = os.path.join(os.path.dirname(__file__), "..", "src", "v6", "engines")
        engines_dir = os.path.abspath(engines_dir)

        # Collect all classes that inherit from BaseEngine
        comfyui_engine_classes = []
        allowed_names = {"ComfyUIEngine", "JoyCaptionEngine"}

        for filename in os.listdir(engines_dir):
            if not filename.endswith(".py") or filename.startswith("_"):
                continue
            filepath = os.path.join(engines_dir, filename)
            module_name = filename[:-3]

            spec = importlib.util.spec_from_file_location(
                f"src.v6.engines.{module_name}", filepath,
                submodule_search_locations=[],
            )
            if spec is None or spec.loader is None:
                continue

            module = importlib.util.module_from_spec(spec)
            try:
                spec.loader.exec_module(module)
            except Exception:
                # Some modules require heavy deps (torch, etc.) -- skip import errors
                continue

            for attr_name, attr_value in inspect.getmembers(module, inspect.isclass):
                if (
                    issubclass(attr_value, BaseEngine)
                    and attr_value is not BaseEngine
                    and "comfyui" in attr_name.lower()
                    and attr_name not in allowed_names
                ):
                    comfyui_engine_classes.append((attr_name, filename))

        assert comfyui_engine_classes == [], (
            f"Found per-model ComfyUI engine subclasses (violates ENG-02): "
            f"{comfyui_engine_classes}"
        )

    def test_comfyui_engine_uses_workflow_builder(self):
        """ComfyUIEngine delegates workflow construction to workflow_builder.

        ComfyUIEngine should not contain any model-specific build_*_workflow
        methods. All workflow construction goes through workflow_builder.py.
        """
        from src.v6.engines.comfyui import ComfyUIEngine

        # Verify module source
        assert ComfyUIEngine.__module__ == "src.v6.engines.comfyui"

        # Verify no build_*_workflow methods on the class
        build_methods = [
            name for name in dir(ComfyUIEngine)
            if name.startswith("build_") and name.endswith("_workflow")
        ]
        assert build_methods == [], (
            f"ComfyUIEngine has model-specific workflow methods "
            f"(should use workflow_builder): {build_methods}"
        )
