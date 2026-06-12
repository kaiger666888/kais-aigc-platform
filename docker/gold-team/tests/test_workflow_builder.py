"""Unit tests for workflow_builder — verifies existing builders produce correct
ComfyUI workflow dicts before new builders are added in subsequent plans.

Covers:
  WFB-01  build_flux_dev_workflow
  WFB-02  build_flux_ipadapter_workflow
  WFB-03  build_hunyuan3d_workflow
"""
from __future__ import annotations

import os

import pytest

from src.v6.engines.workflow_builder import (
    build_flux_dev_workflow,
    build_flux_ipadapter_workflow,
    build_hunyuan3d_workflow,
)


# ---------------------------------------------------------------------------
# WFB-01: build_flux_dev_workflow
# ---------------------------------------------------------------------------

class TestBuildFluxDevWorkflow:
    """Verify FLUX Dev FP8 workflow node graph."""

    def test_build_flux_dev_workflow(self, sample_seed: int):
        wf = build_flux_dev_workflow(prompt="test prompt", seed=sample_seed)

        # Top-level is a dict with string keys
        assert isinstance(wf, dict)
        assert all(isinstance(k, str) for k in wf.keys())

        # Node 1: UNETLoader
        assert wf["1"]["class_type"] == "UNETLoader"

        # Node 4: CLIPTextEncode with the prompt
        assert wf["4"]["class_type"] == "CLIPTextEncode"
        assert wf["4"]["inputs"]["text"] == "test prompt"

        # Node 6: KSampler with expected defaults
        assert wf["6"]["class_type"] == "KSampler"
        assert wf["6"]["inputs"]["seed"] == sample_seed
        assert wf["6"]["inputs"]["steps"] == 28
        assert wf["6"]["inputs"]["cfg"] == 3.5

        # Node 8: SaveImage
        assert wf["8"]["class_type"] == "SaveImage"

        # Node 7: VAEDecode links to KSampler output and VAELoader output
        assert wf["7"]["class_type"] == "VAEDecode"
        assert wf["7"]["inputs"]["samples"] == ["6", 0]
        assert wf["7"]["inputs"]["vae"] == ["3", 0]

        # Node 5: EmptySD3LatentImage default dimensions
        assert wf["5"]["class_type"] == "EmptySD3LatentImage"
        assert wf["5"]["inputs"]["width"] == 1024
        assert wf["5"]["inputs"]["height"] == 1024

    def test_build_flux_dev_workflow_custom_params(self, sample_seed: int):
        wf = build_flux_dev_workflow(
            prompt="custom",
            width=512,
            height=768,
            steps=15,
            cfg_scale=7.0,
            seed=99,
        )

        # KSampler reflects custom params
        assert wf["6"]["inputs"]["steps"] == 15
        assert wf["6"]["inputs"]["cfg"] == 7.0
        assert wf["6"]["inputs"]["seed"] == 99

        # EmptySD3LatentImage reflects custom dimensions
        assert wf["5"]["inputs"]["width"] == 512
        assert wf["5"]["inputs"]["height"] == 768


# ---------------------------------------------------------------------------
# WFB-02: build_flux_ipadapter_workflow
# ---------------------------------------------------------------------------

class TestBuildFluxIPAdapterWorkflow:
    """Verify FLUX + IP-Adapter workflow node graph."""

    def test_build_flux_ipadapter_workflow(self, sample_seed: int):
        wf = build_flux_ipadapter_workflow(
            prompt="test",
            reference_image="ref.png",
            seed=sample_seed,
        )

        # Node 10: IPAdapterFluxLoader
        assert wf["10"]["class_type"] == "IPAdapterFluxLoader"

        # Node 11: LoadImage with reference
        assert wf["11"]["class_type"] == "LoadImage"
        assert wf["11"]["inputs"]["image"] == "ref.png"

        # Node 12: ApplyIPAdapterFlux links correctly
        assert wf["12"]["class_type"] == "ApplyIPAdapterFlux"
        assert wf["12"]["inputs"]["ipadapter_flux"] == ["10", 0]
        assert wf["12"]["inputs"]["image"] == ["11", 0]

        # KSampler (node 6) uses IPAdapter-modified model from node 12
        assert wf["6"]["inputs"]["model"] == ["12", 0]

    def test_build_flux_ipadapter_workflow_custom_weight(self, sample_seed: int):
        wf = build_flux_ipadapter_workflow(
            prompt="test",
            reference_image="ref.png",
            weight=0.5,
            start_percent=0.2,
            end_percent=0.6,
            seed=sample_seed,
        )

        assert wf["12"]["inputs"]["weight"] == 0.5
        assert wf["12"]["inputs"]["start_percent"] == 0.2
        assert wf["12"]["inputs"]["end_percent"] == 0.6


# ---------------------------------------------------------------------------
# WFB-03: build_hunyuan3d_workflow
# ---------------------------------------------------------------------------

class TestBuildHunyuan3dWorkflow:
    """Verify Hunyuan3D subprocess parameter dict."""

    def test_build_hunyuan3d_workflow(self):
        wf = build_hunyuan3d_workflow(
            input_image="/path/to/img.png",
            task_id="test-123",
        )

        # Flat dict, NOT a numbered-node ComfyUI graph
        assert isinstance(wf, dict)
        assert all(isinstance(k, str) for k in wf.keys())
        # No class_type keys — not a node graph
        for v in wf.values():
            assert not isinstance(v, dict) or "class_type" not in v

        assert wf["input_image"] == "/path/to/img.png"
        assert "output_path" in wf
        assert "test-123" in wf["output_path"]
        assert wf["model"] == "full"
        assert wf["steps"] == 50
