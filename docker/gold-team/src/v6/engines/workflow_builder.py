"""Workflow Builder — converts task params to engine-specific formats.

Supports:
  - ComfyUI txt2img workflows (via build_txt2img_workflow)
  - ComfyUI video workflows (via build_video_workflow) — Wan2.x T2V/I2V
  - TTS workflows (via build_tts_workflow) — subprocess-based, not ComfyUI
"""
from __future__ import annotations

import os
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


def build_video_workflow(
    prompt: str,
    negative_prompt: str = "",
    width: int = 832,
    height: int = 480,
    num_frames: int = 81,
    steps: int = 20,
    fps: int = 16,
    seed: int | None = None,
    source_image_path: str = "",
    model: str = "wan2.5-t2v-preview",
    duration: int = 5,
    task_id: str = "",
) -> dict[str, Any]:
    """Build a Wan video generation workflow for ComfyUI.

    Uses WanTextToVideoApi for text-to-video or WanImageToVideoApi for
    image-to-video (when source_image_path is provided).

    These Api nodes auto-download models on first run.

    Args:
        prompt: Text prompt describing the video.
        negative_prompt: What to avoid.
        width: Video width (should be 16-aligned, e.g. 832).
        height: Video height (should be 16-aligned, e.g. 480).
        num_frames: Number of frames (33 for preview, 81 for final).
        steps: Not used directly by Api nodes, kept for compatibility.
        fps: Output FPS.
        seed: Random seed.
        source_image_path: If provided, use I2V mode.
        model: Wan model selector ("wan2.5-t2v-preview", "wan2.6-t2v",
               "wan2.5-i2v-preview", "wan2.6-i2v").
        duration: Video duration in seconds (5, 10, or 15).
        task_id: For output naming.

    Returns:
        ComfyUI API-format workflow dict.
    """
    import random
    if seed is None:
        seed = random.randint(0, 2**32 - 1)

    # Determine size string from width x height
    size_str = _wan_size_string(width, height)

    has_source_image = bool(source_image_path and source_image_path.strip())

    if has_source_image:
        # Image-to-video workflow using WanImageToVideo + CLIPVision
        workflow = {
            "1": {  # DiffusersLoader
                "class_type": "DiffusersLoader",
                "inputs": {
                    "model_path": "Wan2.1-T2V-1.3B",
                },
            },
            "2": {  # LoadImage
                "class_type": "LoadImage",
                "inputs": {
                    "image": source_image_path,
                },
            },
            "3": {  # CLIPTextEncode positive
                "class_type": "CLIPTextEncode",
                "inputs": {
                    "text": prompt,
                    "clip": ["1", 1],
                },
            },
            "4": {  # CLIPTextEncode negative
                "class_type": "CLIPTextEncode",
                "inputs": {
                    "text": negative_prompt,
                    "clip": ["1", 1],
                },
            },
            "5": {  # WanImageToVideo
                "class_type": "WanImageToVideo",
                "inputs": {
                    "positive": ["3", 0],
                    "negative": ["4", 0],
                    "vae": ["1", 2],
                    "width": width,
                    "height": height,
                    "length": num_frames,
                    "batch_size": 1,
                    "start_image": ["2", 0],
                },
            },
            "6": {  # KSampler
                "class_type": "KSampler",
                "inputs": {
                    "seed": seed,
                    "steps": steps,
                    "cfg": 5.0,
                    "sampler_name": "uni_pc_bh2",
                    "scheduler": "beta",
                    "denoise": 1.0,
                    "model": ["1", 0],
                    "positive": ["5", 0],
                    "negative": ["5", 1],
                    "latent_image": ["5", 2],
                },
            },
            "7": {  # VAEDecode
                "class_type": "VAEDecode",
                "inputs": {
                    "samples": ["6", 0],
                    "vae": ["1", 2],
                },
            },
            "8": {  # CreateVideo (IMAGE batch → VIDEO)
                "class_type": "CreateVideo",
                "inputs": {
                    "images": ["7", 0],
                    "fps": fps,
                },
            },
            "9": {  # SaveVideo
                "class_type": "SaveVideo",
                "inputs": {
                    "video": ["8", 0],
                    "filename_prefix": f"kais-video/{task_id or 'i2v'}",
                    "format": "mp4",
                    "codec": "h264",
                },
            },
        }
    else:
        # Text-to-video workflow using WanImageToVideo (without start_image)
        workflow = {
            "1": {  # DiffusersLoader
                "class_type": "DiffusersLoader",
                "inputs": {
                    "model_path": "Wan2.1-T2V-1.3B",
                },
            },
            "2": {  # CLIPTextEncode positive
                "class_type": "CLIPTextEncode",
                "inputs": {
                    "text": prompt,
                    "clip": ["1", 1],
                },
            },
            "3": {  # CLIPTextEncode negative
                "class_type": "CLIPTextEncode",
                "inputs": {
                    "text": negative_prompt,
                    "clip": ["1", 1],
                },
            },
            "4": {  # WanImageToVideo (without start_image = T2V)
                "class_type": "WanImageToVideo",
                "inputs": {
                    "positive": ["2", 0],
                    "negative": ["3", 0],
                    "vae": ["1", 2],
                    "width": width,
                    "height": height,
                    "length": num_frames,
                    "batch_size": 1,
                },
            },
            "5": {  # KSampler
                "class_type": "KSampler",
                "inputs": {
                    "seed": seed,
                    "steps": steps,
                    "cfg": 5.0,
                    "sampler_name": "uni_pc_bh2",
                    "scheduler": "beta",
                    "denoise": 1.0,
                    "model": ["1", 0],
                    "positive": ["4", 0],
                    "negative": ["4", 1],
                    "latent_image": ["4", 2],
                },
            },
            "6": {  # VAEDecode
                "class_type": "VAEDecode",
                "inputs": {
                    "samples": ["5", 0],
                    "vae": ["1", 2],
                },
            },
            "7": {  # CreateVideo (IMAGE batch → VIDEO)
                "class_type": "CreateVideo",
                "inputs": {
                    "images": ["6", 0],
                    "fps": fps,
                },
            },
            "8": {  # SaveVideo
                "class_type": "SaveVideo",
                "inputs": {
                    "video": ["7", 0],
                    "filename_prefix": f"kais-video/{task_id or 't2v'}",
                    "format": "mp4",
                    "codec": "h264",
                },
            },
        }

    return workflow


def _wan_size_string(width: int, height: int) -> str:
    """Map pixel dimensions to WanTextToVideoApi size string."""
    if width == 832 and height == 480:
        return "480p: 16:9 (832x480)"
    if width == 480 and height == 832:
        return "480p: 9:16 (480x832)"
    if width == 624 and height == 624:
        return "480p: 1:1 (624x624)"
    if width == 1280 and height == 720:
        return "720p: 16:9 (1280x720)"
    if width == 720 and height == 1280:
        return "720p: 9:16 (720x1280)"
    if width == 960 and height == 960:
        return "720p: 1:1 (960x960)"
    if width == 1920 and height == 1080:
        return "1080p: 16:9 (1920x1080)"
    if width == 1080 and height == 1920:
        return "1080p: 9:16 (1080x1920)"
    # Fallback: closest match
    if width >= 1280:
        return "720p: 16:9 (1280x720)"
    return "480p: 16:9 (832x480)"


def _wan_i2v_resolution(width: int, height: int) -> str:
    """Map pixel dimensions to WanImageToVideoApi resolution string."""
    if max(width, height) >= 1080:
        return "1080P"
    if max(width, height) >= 720:
        return "720P"
    return "480P"


def build_wan_gguf_i2v_workflow(
    prompt: str,
    negative_prompt: str = "",
    width: int = 832,
    height: int = 480,
    num_frames: int = 81,
    fps: int = 16,
    seed: int | None = None,
    source_image_path: str = "",
    cfg: float = 3.5,
    shift: float = 5.0,
    high_noise_steps: int = 10,
    total_steps: int = 20,
    sampler: str = "euler",
    scheduler: str = "beta",
    high_noise_model: str = "HighNoise/Wan2.2-I2V-A14B-HighNoise-Q8_0.gguf",
    high_noise_dtype: str = "fp8_e4m3fn",
    low_noise_model: str = "wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors",
    low_noise_dtype: str = "fp8_e4m3fn",
    clip_name: str = "umt5_xxl_fp8_scaled.safetensors",
    vae_name: str = "wan_2.1_vae.safetensors",
    task_id: str = "",
) -> dict[str, Any]:
    """Build Wan 2.2 I2V workflow using GGUF/FP8 quantized models.

    Two-stage sampling with separate HighNoise + LowNoise models.
    Validated on RTX 3090 24GB — VRAM peak ~22GB via ComfyUI RAM cache.

    Model setup:
      - T5 text encoder: FP8 safetensors (~5.5GB)
      - HighNoise model: GGUF Q8_0 (~15GB) or FP8 safetensors (~7GB)
      - LowNoise model: FP8 safetensors (~14GB)
      - VAE: Wan2.1 (~485MB)

    Args:
        prompt: Text prompt for video generation.
        negative_prompt: Negative prompt.
        width: Video width (16-aligned, e.g. 832).
        height: Video height (16-aligned, e.g. 480).
        num_frames: Number of frames (81 = ~5s at 16fps).
        fps: Output FPS.
        seed: Random seed (None = random).
        source_image_path: Filename of uploaded image in ComfyUI input folder.
        cfg: CFG scale (community best: 3.5).
        shift: Noise shift (Wan default: 5.0).
        high_noise_steps: Steps for high noise stage (0 to this value).
        total_steps: Total sampling steps.
        sampler: Sampler name ("euler").
        scheduler: Scheduler name ("beta").
        high_noise_model: HighNoise GGUF/FP8 model filename.
        high_noise_dtype: Weight dtype for high noise model.
        low_noise_model: LowNoise FP8 model filename.
        low_noise_dtype: Weight dtype for low noise model.
        clip_name: CLIP text encoder filename.
        vae_name: VAE model filename.
        task_id: For output file naming.

    Returns:
        ComfyUI API-format workflow dict.
    """
    import random
    if seed is None:
        seed = random.randint(0, 2**32 - 1)

    output_prefix = f"video/{task_id}" if task_id else "video/wan_gguf"

    # Validate source image
    if not source_image_path or not source_image_path.strip():
        raise ValueError("source_image_path is required for GGUF I2V workflow")

    # Detect GGUF vs safetensors by extension
    use_gguf_high = high_noise_model.endswith(".gguf")
    use_gguf_low = low_noise_model.endswith(".gguf")

    def _load_unet(model_path: str, dtype: str, is_gguf: bool, node_id: str):
        if is_gguf:
            return {
                "class_type": "UnetLoaderGGUF",
                "inputs": {"unet_name": model_path, "weight_dtype": dtype},
            }
        else:
            return {
                "class_type": "UNETLoader",
                "inputs": {"unet_name": model_path, "weight_dtype": dtype},
            }

    high_noise_loader = _load_unet(high_noise_model, high_noise_dtype, use_gguf_high, "hn")
    low_noise_loader = _load_unet(low_noise_model, low_noise_dtype, use_gguf_low, "ln")

    workflow: dict[str, Any] = {
        "3": {
            "class_type": "LoadImage",
            "inputs": {"image": source_image_path},
        },
        "105": {
            "class_type": "CLIPLoader",
            "inputs": {"clip_name": clip_name, "type": "wan"},
        },
        "106": {
            "class_type": "VAELoader",
            "inputs": {"vae_name": vae_name},
        },
        "122": high_noise_loader,
        "123": low_noise_loader,
        "124": {
            "class_type": "ModelSamplingSD3",
            "inputs": {"model": ["122", 0], "shift": shift},
        },
        "109": {
            "class_type": "ModelSamplingSD3",
            "inputs": {"model": ["123", 0], "shift": shift},
        },
        "107": {
            "class_type": "CLIPTextEncode",
            "inputs": {"text": prompt, "clip": ["105", 0]},
        },
        "125": {
            "class_type": "CLIPTextEncode",
            "inputs": {"text": negative_prompt, "clip": ["105", 0]},
        },
        "128": {
            "class_type": "WanImageToVideo",
            "inputs": {
                "positive": ["107", 0],
                "negative": ["125", 0],
                "vae": ["106", 0],
                "width": width,
                "height": height,
                "length": num_frames,
                "batch_size": 1,
                "start_image": ["3", 0],
            },
        },
        # Stage 1: High Noise sampling
        "110": {
            "class_type": "KSamplerAdvanced",
            "inputs": {
                "add_noise": "enable",
                "noise_seed": seed,
                "start_at_step": 0,
                "end_at_step": high_noise_steps,
                "steps": total_steps,
                "cfg": cfg,
                "model": ["124", 0],
                "positive": ["128", 0],
                "negative": ["128", 1],
                "sampler_name": sampler,
                "scheduler": scheduler,
                "latent_image": ["128", 2],
                "return_with_leftover_noise": "enable",
            },
        },
        # Stage 2: Low Noise sampling
        "111": {
            "class_type": "KSamplerAdvanced",
            "inputs": {
                "add_noise": "disable",
                "noise_seed": 0,
                "start_at_step": high_noise_steps,
                "end_at_step": 10000,
                "steps": total_steps,
                "cfg": cfg,
                "model": ["109", 0],
                "positive": ["128", 0],
                "negative": ["128", 1],
                "sampler_name": sampler,
                "scheduler": scheduler,
                "latent_image": ["110", 0],
                "return_with_leftover_noise": "disable",
            },
        },
        "129": {
            "class_type": "VAEDecode",
            "inputs": {"samples": ["111", 0], "vae": ["106", 0]},
        },
        "117": {
            "class_type": "CreateVideo",
            "inputs": {"images": ["129", 0], "fps": float(fps)},
        },
        "130": {
            "class_type": "SaveVideo",
            "inputs": {
                "video": ["117", 0],
                "filename_prefix": output_prefix,
                "format": "mp4",
                "codec": "h264",
            },
        },
    }

    return workflow


def build_tts_workflow(
    text: str,
    voice: str = "default",
    speed: float = 1.0,
    backend: str = "auto",
    output_path: str = "",
    task_id: str = "",
) -> dict[str, Any]:
    """Build a TTS workflow dict for the TTSEngine.

    Unlike ComfyUI workflows, this returns a parameter dict consumed by
    TTSEngine.submit() which invokes scripts/tts_infer.py via subprocess.

    Args:
        text: Text to synthesize.
        voice: Voice name — 'default', '中文女', '中文男', 'english_female',
               'english_male', or a full edge-tts voice ID.
        speed: Speech speed multiplier (1.0 = normal).
        backend: 'auto' (try CosyVoice → edge-tts), 'cosyvoice', or 'edge-tts'.
        output_path: Explicit output file path. Auto-generated if empty.
        task_id: Used for auto-generating output path.

    Returns:
        Dict with TTS parameters for TTSEngine.submit().
    """
    if not output_path:
        output_root = os.environ.get("KAIS_OUTPUT_ROOT", "/mnt/agents/output")
        tid = task_id or "tts-unknown"
        output_path = os.path.join(output_root, tid, "voice.wav")

    return {
        "text": text,
        "voice": voice,
        "speed": speed,
        "backend": backend,
        "output_path": output_path,
    }
