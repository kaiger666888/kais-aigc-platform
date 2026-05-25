"""ComfyUI Workflow Builder — converts task params to ComfyUI API format."""
from __future__ import annotations

from typing import Any


def build_txt2img_workflow(
    prompt: str,
    negative_prompt: str = "",
    width: int = 1024,
    height: int = 1024,
    steps: int = 20,
    cfg_scale: float = 7.5,
    seed: int | None = None,
    checkpoint: str = "sd_xl_turbo_1.0_fp16.safetensors",
) -> dict[str, Any]:
    """Build a basic txt2img ComfyUI workflow.

    Uses the standard KSampler + CheckpointLoader + CLIPTextEncode + VAEDecode + SaveImage pipeline.
    """
    import random
    if seed is None:
        seed = random.randint(0, 2**32 - 1)

    workflow = {
        "3": {  # KSampler
            "class_type": "KSampler",
            "inputs": {
                "seed": seed,
                "steps": steps,
                "cfg": cfg_scale,
                "sampler_name": "euler",
                "scheduler": "normal",
                "denoise": 1.0,
                "model": ["4", 0],
                "positive": ["6", 0],
                "negative": ["7", 0],
                "latent_image": ["5", 0],
            },
        },
        "4": {  # CheckpointLoaderSimple
            "class_type": "CheckpointLoaderSimple",
            "inputs": {
                "ckpt_name": checkpoint,
            },
        },
        "5": {  # EmptyLatentImage
            "class_type": "EmptyLatentImage",
            "inputs": {
                "width": width,
                "height": height,
                "batch_size": 1,
            },
        },
        "6": {  # CLIPTextEncode (positive)
            "class_type": "CLIPTextEncode",
            "inputs": {
                "text": prompt,
                "clip": ["4", 1],
            },
        },
        "7": {  # CLIPTextEncode (negative)
            "class_type": "CLIPTextEncode",
            "inputs": {
                "text": negative_prompt,
                "clip": ["4", 1],
            },
        },
        "8": {  # VAEDecode
            "class_type": "VAEDecode",
            "inputs": {
                "samples": ["3", 0],
                "vae": ["4", 2],
            },
        },
        "9": {  # SaveImage
            "class_type": "SaveImage",
            "inputs": {
                "filename_prefix": "kais-render",
                "images": ["8", 0],
            },
        },
    }
    return workflow
