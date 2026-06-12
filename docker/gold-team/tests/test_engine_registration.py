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
