"""Workflow Builder — converts task params to engine-specific formats.

Supports:
  - ComfyUI txt2img workflows (via build_txt2img_workflow)
  - ComfyUI video workflows (via build_video_workflow) — Wan2.x T2V/I2V
  - ComfyUI GGUF workflows (via build_wan_gguf_i2v_workflow / build_wan_gguf_t2v_workflow)
  - LTX-2.3 workflows (via build_ltx_prompt_relay_i2v / build_ltx_extension / build_ltx_fflf / build_ltx_two_stage_audio_i2v)
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


def build_wan_gguf_t2v_workflow(
    prompt: str,
    negative_prompt: str = "",
    width: int = 832,
    height: int = 480,
    num_frames: int = 81,
    steps: int = 30,
    fps: int = 16,
    seed: int | None = None,
    model: str = "wan2.1-t2v-14b-Q8_0.gguf",
    cfg: float = 5.0,
    shift: float = 5.0,
    scheduler: str = "unipc",
    precision: str = "bf16",
    attention_mode: str = "sdpa",
    force_offload: bool = False,
    enable_vae_tiling: bool = True,
    tile_x: int = 256,
    tile_y: int = 256,
    tile_stride_x: int = 224,
    tile_stride_y: int = 224,
    t5_model_name: str = "t5xxl_fp16.safetensors",
    vae_model_name: str = "wan_2.1_vae.safetensors",
    t5_load_device: str = "offload_device",
    unet_load_device: str = "main_device",
    task_id: str = "",
) -> dict[str, Any]:
    """Build Wan 2.1 T2V-14B Q8_0 GGUF text-to-video workflow.

    Uses WanVideoWrapper nodes (quantized linear CUDA kernels) for
    single-stage T2V generation with GGUF quantized transformer.

    Quantization: Q8_0 (8-bit, ~15GB, quality ≈ 97% of fp16) or Q4_K_M (4-bit, ~10GB)
    Runtime env: ComfyUI + WanVideoWrapper custom nodes on RTX 3090 24GB.

    Performance benchmarks (RTX 3090, 832x480, 81 frames, 30 steps, Q8_0):
      - Model load: ~30s (T5 on CPU + GGUF transformer on GPU)
      - Sampling: ~48s/step × 30 steps ≈ 24 min
      - VAE decode: ~3-5 min
      - Total: ~28 min per generation
      - Peak VRAM: ~19.3GB (model 8.2GB + KV cache ~11GB)
      - GPU utilization: 100% throughout sampling

    Quality note: Q8_0 retains 97%+ of fp16 quality with minimal artifacts.
               Q4_K_M trades ~5-10% quality for faster inference and lower VRAM.

    Args:
        prompt: Text prompt describing the video.
        negative_prompt: What to avoid.
        width: Video width (16-aligned, e.g. 832).
        height: Video height (16-aligned, e.g. 480).
        num_frames: Number of frames (81 = ~5s at 16fps).
        steps: Sampling steps (30 recommended for GGUF).
        fps: Output FPS.
        seed: Random seed (None = random).
        model: GGUF model filename (e.g. wan2.1-t2v-14b-Q8_0.gguf,
               wan2.1-t2v-14b-Q4_K_M.gguf).
        cfg: CFG scale (5.0 for T2V).
        shift: Noise shift (5.0 default).
        scheduler: Scheduler name ("unipc", "uni_pc_bh2", "euler", etc.).
        precision: Weight precision ("bf16").
        attention_mode: Attention implementation ("sdpa", "flash", etc.).
        force_offload: Force model offload after each operation.
        enable_vae_tiling: Enable VAE tiling to reduce VRAM.
        tile_x: VAE tile width.
        tile_y: VAE tile height.
        tile_stride_x: VAE tile stride X.
        tile_stride_y: VAE tile stride Y.
        t5_model_name: T5 text encoder model filename.
        vae_model_name: VAE model filename.
        t5_load_device: T5 device ("offload_device" to save VRAM).
        unet_load_device: UNet device ("main_device" for speed).
        task_id: For output file naming.

    Returns:
        ComfyUI API-format workflow dict.
    """
    import random
    if seed is None:
        seed = random.randint(0, 2**32 - 1)

    output_prefix = f"video/{task_id}" if task_id else "video/wan_gguf_t2v"

    workflow: dict[str, Any] = {
        "1": {
            "class_type": "LoadWanVideoT5TextEncoder",
            "inputs": {
                "model_name": t5_model_name,
                "precision": precision,
                "load_device": t5_load_device,
            },
        },
        "3": {
            "class_type": "WanVideoModelLoader",
            "inputs": {
                "model": model,
                "base_precision": precision,
                "quantization": "disabled",
                "attention_mode": attention_mode,
                "load_device": unet_load_device,
            },
        },
        "4": {
            "class_type": "WanVideoTextEncode",
            "inputs": {
                "t5": ["1", 0],
                "positive_prompt": prompt,
                "negative_prompt": negative_prompt,
            },
        },
        "5": {
            "class_type": "WanVideoSchedulerv2",
            "inputs": {
                "scheduler": scheduler,
                "steps": steps,
                "shift": shift,
            },
        },
        "6": {
            "class_type": "WanVideoEmptyEmbeds",
            "inputs": {
                "width": width,
                "height": height,
                "num_frames": num_frames,
            },
        },
        "7": {
            "class_type": "WanVideoSamplerv2",
            "inputs": {
                "model": ["3", 0],
                "image_embeds": ["6", 0],
                "cfg": cfg,
                "seed": seed,
                "force_offload": force_offload,
                "scheduler": ["5", 0],
                "text_embeds": ["4", 0],
            },
        },
        "8": {
            "class_type": "WanVideoVAELoader",
            "inputs": {
                "model_name": vae_model_name,
                "precision": precision,
            },
        },
        "9": {
            "class_type": "WanVideoDecode",
            "inputs": {
                "vae": ["8", 0],
                "samples": ["7", 0],
                "enable_vae_tiling": enable_vae_tiling,
                "tile_x": tile_x,
                "tile_y": tile_y,
                "tile_stride_x": tile_stride_x,
                "tile_stride_y": tile_stride_y,
            },
        },
        "10": {
            "class_type": "SaveAnimatedWEBP",
            "inputs": {
                "images": ["9", 0],
                "filename_prefix": output_prefix,
                "fps": fps,
                "lossless": False,
                "quality": 80,
            },
        },
    }

    return workflow


def build_tts_workflow(
    text: str,
    voice: str = "default",
    speed: float = 1.0,
    backend: str = "auto",       # auto | gpt_sovits | chatterbox | cosyvoice
    reference_audio: str = "",   # optional reference audio for voice cloning
    output_path: str = "",
    task_id: str = "",
    language: str = "auto",      # auto | zh | en
) -> dict[str, Any]:
    """Build a TTS workflow dict for the TTS engine.

    Supports both the legacy TTSEngine (subprocess) and the new
    TripleTrackTTSEngine (HTTP backends). Extra keys (reference_audio,
    language) are simply ignored by the legacy engine.

    Args:
        text: Text to synthesize.
        voice: Voice name or speaker ID.
        speed: Speech speed multiplier (1.0 = normal).
        backend: 'auto' (language detection), 'gpt_sovits', 'chatterbox',
                 or 'cosyvoice'.
        reference_audio: Optional path to a reference audio clip for
                         voice cloning (GPT-SoVITS / Chatterbox).
        output_path: Explicit output file path. Auto-generated if empty.
        task_id: Used for auto-generating output path.
        language: 'auto' (detect from text), 'zh', or 'en'.

    Returns:
        Dict with TTS parameters for TTSEngine / TripleTrackTTSEngine.
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
        "reference_audio": reference_audio,
        "output_path": output_path,
        "language": language,
    }


# ─── LTX-2.3 Workflows (Kijai) ───


def build_ltx_prompt_relay_i2v_workflow(
    prompt: str,
    local_prompts: str,
    source_image_path: str,
    negative_prompt: str = "",
    width: int = 832,
    height: int = 480,
    num_frames: int = 81,
    fps: int = 25,
    steps: int = 8,
    cfg: float = 5.5,
    seed: int | None = None,
    sampler_name: str = "euler_ancestral",
    scheduler: str = "normal",
    denoise: float = 1.0,
    strength: float = 1.0,
    num_blend: int = 0,
    epsilon: float = 0.001,
    model_name: str = "ltx-2.3-22b-distilled-mxfp8.safetensors",
    clip_name1: str = "gemma_3_12B_it_fp8_scaled.safetensors",
    clip_name2: str = "ltx-2.3_text_projection_bf16.safetensors",
    vae_name: str = "ltx2_vae/LTX23_video_vae_bf16.safetensors",
    filename_prefix: str = "ltx_relay_i2v",
    crf: int = 19,
) -> dict[str, Any]:
    """Build LTX-2.3 Prompt Relay I2V workflow with director beats.

    Uses PromptRelayEncode for multi-beat temporal control via pipe-separated
    local_prompts. Each segment describes a distinct temporal beat in the video.

    Pipeline: UNETLoader -> DualCLIPLoader -> VAELoader -> LoadImage ->
              EmptyLTXVLatentVideo -> LTXVImgToVideoConditionOnly ->
              PromptRelayEncode -> CLIPTextEncode(neg) -> LTXVConditioning ->
              KSampler -> VAEDecodeTiled -> VHS_VideoCombine

    Args:
        prompt: Global style/scene prompt (applied across all beats).
        local_prompts: Pipe-separated director beats describing temporal segments.
        source_image_path: Filename of source image in ComfyUI input folder.
        negative_prompt: Negative prompt.
        width: Video width (should be 32-aligned, e.g. 832).
        height: Video height (should be 32-aligned, e.g. 480).
        num_frames: Number of frames (81 for ~3s at 25fps).
        fps: Output FPS.
        steps: Sampling steps (8 for distilled).
        cfg: CFG scale.
        seed: Random seed (None = random).
        sampler_name: Sampler name.
        scheduler: Scheduler name.
        denoise: Denoise strength.
        strength: Image conditioning strength.
        num_blend: Number of blend frames for smooth transition.
        epsilon: Prompt relay epsilon for temporal smoothness.
        model_name: UNET model filename.
        clip_name1: First CLIP model filename.
        clip_name2: Second CLIP model filename.
        vae_name: VAE model filename.
        filename_prefix: Output filename prefix.
        crf: H.264 CRF quality (lower = better, 19 default).

    Returns:
        ComfyUI API-format workflow dict.
    """
    import random
    if seed is None:
        seed = random.randint(0, 2**32 - 1)

    workflow: dict[str, Any] = {
        "1": {
            "class_type": "UNETLoader",
            "inputs": {
                "unet_name": model_name,
                "weight_dtype": "default",
            },
        },
        "2": {
            "class_type": "DualCLIPLoader",
            "inputs": {
                "clip_name1": clip_name1,
                "clip_name2": clip_name2,
                "type": "ltxv",
                "device": "default",
            },
        },
        "3": {
            "class_type": "VAELoader",
            "inputs": {
                "vae_name": vae_name,
            },
        },
        "4": {
            "class_type": "LoadImage",
            "inputs": {
                "image": source_image_path,
                "upload": "image",
            },
        },
        "5": {
            "class_type": "EmptyLTXVLatentVideo",
            "inputs": {
                "width": width,
                "height": height,
                "length": num_frames,
                "batch_size": 1,
            },
        },
        "6": {
            "class_type": "LTXVImgToVideoConditionOnly",
            "inputs": {
                "vae": ["3", 0],
                "image": ["4", 0],
                "latent": ["5", 0],
                "strength": strength,
                "blend_with_first": bool(num_blend),
            },
        },
        "7": {
            "class_type": "PromptRelayEncode",
            "inputs": {
                "model": ["1", 0],
                "clip": ["2", 0],
                "latent": ["6", 0],
                "global_prompt": prompt,
                "segment_lengths": "",
                "local_prompts": local_prompts,
                "negative": negative_prompt,
                "epsilon": epsilon,
            },
        },
        "8": {
            "class_type": "CLIPTextEncode",
            "inputs": {
                "clip": ["2", 0],
                "text": negative_prompt,
            },
        },
        "9": {
            "class_type": "LTXVConditioning",
            "inputs": {
                "positive": ["7", 1],
                "negative": ["8", 0],
                "frame_rate": float(fps),
            },
        },
        "10": {
            "class_type": "KSampler",
            "inputs": {
                "model": ["7", 0],
                "positive": ["9", 0],
                "negative": ["9", 1],
                "latent_image": ["6", 0],
                "seed": seed,
                "steps": steps,
                "cfg": cfg,
                "sampler_name": sampler_name,
                "scheduler": scheduler,
                "denoise": denoise,
            },
        },
        "11": {
            "class_type": "VAEDecodeTiled",
            "inputs": {
                "samples": ["10", 0],
                "vae": ["3", 0],
                "tile_size": 512,
                "overlap": 64,
                "temporal_size": 64,
                "temporal_overlap": 8,
            },
        },
        "12": {
            "class_type": "VHS_VideoCombine",
            "inputs": {
                "images": ["11", 0],
                "frame_rate": fps,
                "loop_count": 0,
                "filename_prefix": filename_prefix,
                "format": "video/h264-mp4",
                "pix_fmt": "yuv420p",
                "crf": crf,
                "save_metadata": True,
                "trim_to_audio": False,
                "pingpong": False,
                "save_output": True,
            },
        },
    }

    return workflow


def build_ltx_extension_workflow(
    prompt: str,
    source_video_path: str,
    negative_prompt: str = "",
    width: int = 832,
    height: int = 480,
    num_frames: int = 49,
    fps: int = 25,
    steps: int = 8,
    cfg: float = 5.5,
    seed: int | None = None,
    sampler_name: str = "euler_ancestral",
    scheduler: str = "normal",
    denoise: float = 1.0,
    lora_name: str = "ltx-2.3-22b-distilled-lora-384-1.1.safetensors",
    lora_strength: float = -0.3,
    strength: float = 1.0,
    num_blend: int = 0,
    model_name: str = "ltx-2.3-22b-distilled-mxfp8.safetensors",
    clip_name1: str = "gemma_3_12B_it_fp8_scaled.safetensors",
    clip_name2: str = "ltx-2.3_text_projection_bf16.safetensors",
    vae_name: str = "ltx2_vae/LTX23_video_vae_bf16.safetensors",
    filename_prefix: str = "ltx_extend",
    crf: int = 19,
    start_frame: int = -1,
) -> dict[str, Any]:
    """Build LTX-2.3 Video Extension workflow with freeze-frame LoRA.

    Extracts the last frame from source video, then generates an extension.
    Uses a LoRA (negative strength) for temporal consistency. Feed output
    back as input for iterative extending.

    Pipeline: UNETLoader -> DualCLIPLoader -> VAELoader -> VHS_LoadVideoPath ->
              GetImagesFromBatchIndexed -> EmptyLTXVLatentVideo ->
              CLIPTextEncode(pos+neg) -> LTXVImgToVideoConditionOnly ->
              LoraLoaderModelOnly -> LTXVConditioning -> KSampler ->
              VAEDecodeTiled -> VHS_VideoCombine

    Args:
        prompt: Text prompt for the extended video segment.
        source_video_path: Filename of source video in ComfyUI input folder.
        negative_prompt: Negative prompt.
        width: Video width.
        height: Video height.
        num_frames: Number of extension frames (49 for ~2s at 25fps).
        fps: Output FPS.
        steps: Sampling steps.
        cfg: CFG scale.
        seed: Random seed (None = random).
        sampler_name: Sampler name.
        scheduler: Scheduler name.
        denoise: Denoise strength.
        lora_name: LoRA model filename for temporal consistency.
        lora_strength: LoRA strength (negative = freeze-frame effect).
        strength: Image conditioning strength.
        num_blend: Number of blend frames.
        model_name: UNET model filename.
        clip_name1: First CLIP model filename.
        clip_name2: Second CLIP model filename.
        vae_name: VAE model filename.
        filename_prefix: Output filename prefix.
        crf: H.264 CRF quality.
        start_frame: Frame index to extract from source (-1 = last frame).

    Returns:
        ComfyUI API-format workflow dict.
    """
    import random
    if seed is None:
        seed = random.randint(0, 2**32 - 1)

    workflow: dict[str, Any] = {
        "1": {
            "class_type": "UNETLoader",
            "inputs": {
                "unet_name": model_name,
                "weight_dtype": "default",
            },
        },
        "2": {
            "class_type": "DualCLIPLoader",
            "inputs": {
                "clip_name1": clip_name1,
                "clip_name2": clip_name2,
                "type": "ltxv",
                "device": "default",
            },
        },
        "3": {
            "class_type": "VAELoader",
            "inputs": {
                "vae_name": vae_name,
            },
        },
        "4": {
            "class_type": "VHS_LoadVideoPath",
            "inputs": {
                "video": source_video_path,
                "force_rate": 0,
                "force_size": "Disabled",
                "custom_width": 0,
                "custom_height": 0,
                "frame_load_cap": 0,
                "skip_first_frames": 0,
                "select_every_nth": 1,
                "choose video to preview": "start_frame",
                "videopreview": {
                    "hidden": False,
                    "paused": False,
                    "params": {},
                },
            },
        },
        "5": {
            "class_type": "GetImagesFromBatchIndexed",
            "inputs": {
                "images": ["4", 0],
                "indexes": str(start_frame),
            },
        },
        "6": {
            "class_type": "EmptyLTXVLatentVideo",
            "inputs": {
                "width": width,
                "height": height,
                "length": num_frames,
                "batch_size": 1,
            },
        },
        "7": {
            "class_type": "CLIPTextEncode",
            "inputs": {
                "clip": ["2", 0],
                "text": prompt,
            },
        },
        "8": {
            "class_type": "CLIPTextEncode",
            "inputs": {
                "clip": ["2", 0],
                "text": negative_prompt,
            },
        },
        "9": {
            "class_type": "LTXVImgToVideoConditionOnly",
            "inputs": {
                "vae": ["3", 0],
                "image": ["5", 0],
                "latent": ["6", 0],
                "strength": strength,
                "blend_with_first": bool(num_blend),
            },
        },
        "10": {
            "class_type": "LoraLoaderModelOnly",
            "inputs": {
                "model": ["1", 0],
                "lora_name": lora_name,
                "strength_model": lora_strength,
            },
        },
        "11": {
            "class_type": "LTXVConditioning",
            "inputs": {
                "positive": ["7", 0],
                "negative": ["8", 0],
                "frame_rate": float(fps),
            },
        },
        "12": {
            "class_type": "KSampler",
            "inputs": {
                "model": ["10", 0],
                "positive": ["11", 0],
                "negative": ["11", 1],
                "latent_image": ["9", 0],
                "seed": seed,
                "steps": steps,
                "cfg": cfg,
                "sampler_name": sampler_name,
                "scheduler": scheduler,
                "denoise": denoise,
            },
        },
        "13": {
            "class_type": "VAEDecodeTiled",
            "inputs": {
                "samples": ["12", 0],
                "vae": ["3", 0],
                "tile_size": 512,
                "overlap": 64,
                "temporal_size": 64,
                "temporal_overlap": 8,
            },
        },
        "14": {
            "class_type": "VHS_VideoCombine",
            "inputs": {
                "images": ["13", 0],
                "frame_rate": fps,
                "loop_count": 0,
                "filename_prefix": filename_prefix,
                "format": "video/h264-mp4",
                "pix_fmt": "yuv420p",
                "crf": crf,
                "save_metadata": True,
                "trim_to_audio": False,
                "pingpong": False,
                "save_output": True,
            },
        },
    }

    return workflow


def build_ltx_fflf_workflow(
    prompt: str,
    first_frame_path: str,
    last_frame_path: str,
    negative_prompt: str = "",
    width: int = 768,
    height: int = 512,
    num_frames: int = 161,
    fps: int = 25,
    steps: int = 30,
    cfg: float = 5.5,
    seed: int | None = None,
    sampler_name: str = "euler_ancestral",
    scheduler: str = "normal",
    denoise: float = 1.0,
    strength: float = 1.0,
    nag_scale: float = 1.0,
    nag_alpha: float = 0.25,
    nag_tau: float = 2.5,
    nag_inplace: bool = True,
    model_name: str = "ltx-2.3-22b-distilled-mxfp8.safetensors",
    clip_name1: str = "gemma_3_12B_it_fp8_scaled.safetensors",
    clip_name2: str = "ltx-2.3_text_projection_bf16.safetensors",
    vae_name: str = "ltx2_vae/LTX23_video_vae_bf16.safetensors",
    filename_prefix: str = "ltx_fflf",
    crf: int = 19,
) -> dict[str, Any]:
    """Build LTX-2.3 FFLF (First Frame Last Frame) interpolation workflow.

    Injects first frame via LTXVImgToVideoInplace and guides last frame
    via LTXVAddGuide. Uses NAG for quality with distilled models.

    Pipeline: UNETLoader -> DualCLIPLoader -> VAELoader -> LoadImage(first) ->
              LoadImage(last) -> EmptyLTXVLatentVideo -> CLIPTextEncode(pos+neg) ->
              LTXVImgToVideoInplace(first) + LTXVAddGuide(last) ->
              LTXVConditioning -> LTX2_NAG ->
              KSampler -> VAEDecodeTiled -> VHS_VideoCombine

    Args:
        prompt: Text prompt describing the transition.
        first_frame_path: Filename of first frame image in ComfyUI input folder.
        last_frame_path: Filename of last frame image in ComfyUI input folder.
        negative_prompt: Negative prompt.
        width: Video width (768 default for FFLF).
        height: Video height (512 default for FFLF).
        num_frames: Number of frames (161 for ~6.4s at 25fps).
        fps: Output FPS.
        steps: Sampling steps (30 for FFLF quality).
        cfg: CFG scale.
        seed: Random seed (None = random).
        sampler_name: Sampler name.
        scheduler: Scheduler name.
        denoise: Denoise strength.
        strength: Image conditioning strength.
        nag_scale: NAG guidance scale (1.0 default).
        nag_alpha: NAG alpha parameter (0.25 default).
        nag_tau: NAG tau parameter (2.5 default).
        nag_inplace: NAG inplace mode (True default).
        model_name: UNET model filename.
        clip_name1: First CLIP model filename.
        clip_name2: Second CLIP model filename.
        vae_name: VAE model filename.
        filename_prefix: Output filename prefix.
        crf: H.264 CRF quality.

    Returns:
        ComfyUI API-format workflow dict.
    """
    import random
    if seed is None:
        seed = random.randint(0, 2**32 - 1)

    workflow: dict[str, Any] = {
        "1": {
            "class_type": "UNETLoader",
            "inputs": {
                "unet_name": model_name,
                "weight_dtype": "default",
            },
        },
        "2": {
            "class_type": "DualCLIPLoader",
            "inputs": {
                "clip_name1": clip_name1,
                "clip_name2": clip_name2,
                "type": "ltxv",
                "device": "default",
            },
        },
        "3": {
            "class_type": "VAELoader",
            "inputs": {
                "vae_name": vae_name,
            },
        },
        "4": {
            "class_type": "LoadImage",
            "inputs": {
                "image": first_frame_path,
                "upload": "image",
            },
        },
        "5": {
            "class_type": "LoadImage",
            "inputs": {
                "image": last_frame_path,
                "upload": "image",
            },
        },
        "6": {
            "class_type": "EmptyLTXVLatentVideo",
            "inputs": {
                "width": width,
                "height": height,
                "length": num_frames,
                "batch_size": 1,
            },
        },
        "7": {
            "class_type": "CLIPTextEncode",
            "inputs": {
                "clip": ["2", 0],
                "text": prompt,
            },
        },
        "8": {
            "class_type": "CLIPTextEncode",
            "inputs": {
                "clip": ["2", 0],
                "text": negative_prompt,
            },
        },
        "9": {
            "class_type": "LTXVImgToVideoInplace",
            "inputs": {
                "vae": ["3", 0],
                "image": ["4", 0],
                "latent": ["6", 0],
                "strength": strength,
                "bypass": False,
            },
        },
        "10": {
            "class_type": "LTXVAddGuide",
            "inputs": {
                "positive": ["7", 0],
                "negative": ["8", 0],
                "vae": ["3", 0],
                "latent": ["9", 0],
                "image": ["5", 0],
                "frame_idx": -1,
                "strength": strength,
            },
        },
        "11": {
            "class_type": "LTXVConditioning",
            "inputs": {
                "positive": ["10", 0],
                "negative": ["10", 1],
                "frame_rate": float(fps),
            },
        },
        "12": {
            "class_type": "LTX2_NAG",
            "inputs": {
                "model": ["1", 0],
                "nag_scale": nag_scale,
                "nag_alpha": nag_alpha,
                "nag_tau": nag_tau,
                "nag_inplace": nag_inplace,
            },
        },
        "13": {
            "class_type": "KSampler",
            "inputs": {
                "model": ["12", 0],
                "positive": ["11", 0],
                "negative": ["11", 1],
                "latent_image": ["9", 0],
                "seed": seed,
                "steps": steps,
                "cfg": cfg,
                "sampler_name": sampler_name,
                "scheduler": scheduler,
                "denoise": denoise,
            },
        },
        "14": {
            "class_type": "VAEDecodeTiled",
            "inputs": {
                "samples": ["13", 0],
                "vae": ["3", 0],
                "tile_size": 512,
                "overlap": 64,
                "temporal_size": 64,
                "temporal_overlap": 8,
            },
        },
        "15": {
            "class_type": "VHS_VideoCombine",
            "inputs": {
                "images": ["14", 0],
                "frame_rate": fps,
                "loop_count": 0,
                "filename_prefix": filename_prefix,
                "format": "video/h264-mp4",
                "pix_fmt": "yuv420p",
                "crf": crf,
                "save_metadata": True,
                "trim_to_audio": False,
                "pingpong": False,
                "save_output": True,
            },
        },
    }

    return workflow


def build_ltx_two_stage_audio_i2v_workflow(
    prompt: str,
    source_image_path: str,
    negative_prompt: str = "",
    width: int = 768,
    height: int = 432,
    num_frames: int = 121,
    fps: int = 25,
    seed: int | None = None,
    cfg: float = 1.0,
    # Stage 1 (Draft)
    stage1_sampler: str = "euler_ancestral_cfg_pp",
    stage1_sigmas: str = "1.0, 0.99375, 0.9875, 0.98125, 0.975, 0.909375, 0.725, 0.421875, 0.0",
    # Stage 2 (Refine)
    stage2_sampler: str = "euler_cfg_pp",
    stage2_sigmas: str = "0.85, 0.725, 0.4219, 0.0",
    # Models
    checkpoint_name: str = "ltx-2.3-22b-dev.safetensors",
    lora_name: str = "ltx-2.3-22b-distilled-lora-384-1.1.safetensors",
    lora_strength: float = 0.5,
    clip_name1: str = "gemma_3_12B_it_fp8_scaled.safetensors",
    clip_name2: str = "ltx-2.3_text_projection_bf16.safetensors",
    strength: float = 0.7,
    filename_prefix: str = "ltx_2stage_audio",
    crf: int = 19,
) -> dict[str, Any]:
    """Build LTX-2.3 Two-Stage I2V workflow with audio generation.

    Uses the dev checkpoint + distilled LoRA for two-stage (draft + refine)
    video generation with synchronized audio. Stage 1 produces a draft video+audio
    latent (9 steps), Stage 2 refines only the video latent (4 steps).
    Audio from Stage 1 is preserved through both stages.

    Pipeline:
      CheckpointLoaderSimple -> LoraLoaderModelOnly -> DualCLIPLoader ->
      CLIPTextEncode(pos+neg) -> LTXVConditioning -> LoadImage ->
      LTXVEmptyLatentVideo + LTXVEmptyLatentAudio(use checkpoint VAE) ->
      [Stage 1] LTXVImgToVideoConditionOnly -> LTXVConcatAVLatent ->
                 RandomNoise + CFGGuider + KSamplerSelect ->
                 SamplerCustomAdvanced -> LTXVSeparateAVLatent ->
      [Stage 2] LTXVImgToVideoConditionOnly(strength=1.0) ->
                 LTXVConcatAVLatent(video=stage2, audio=stage1) ->
                 SamplerCustomAdvanced -> LTXVSeparateAVLatent ->
      LTXVAudioVAEDecode + LTXVTiledVAEDecode (use checkpoint VAE) ->
      CreateVideo(images + audio)

    Args:
        prompt: Text prompt describing the video content.
        source_image_path: Filename of source image in ComfyUI input folder.
        negative_prompt: Negative prompt.
        width: Video width (768 default).
        height: Video height (432 default).
        num_frames: Number of frames (121 for ~4.8s at 25fps).
        fps: Output FPS.
        seed: Random seed (None = random).
        cfg: CFG scale (1.0 for distilled dev model).
        stage1_sampler: Sampler for Stage 1 draft (9 steps).
        stage1_sigmas: Manual sigmas for Stage 1 (comma-separated floats).
        stage2_sampler: Sampler for Stage 2 refine (4 steps).
        stage2_sigmas: Manual sigmas for Stage 2 (comma-separated floats).
        checkpoint_name: Dev model checkpoint filename.
        lora_name: Distilled LoRA filename for dev model.
        lora_strength: LoRA strength (0.5 default).
        clip_name1: First CLIP model filename (Gemma 3 12B).
        clip_name2: Second CLIP model filename (LTX text projection).
        strength: Image conditioning strength for Stage 1 (Stage 2 always 1.0).
        filename_prefix: Output filename prefix.
        crf: H.264 CRF quality (lower = better, 19 default).

    Returns:
        ComfyUI API-format workflow dict.
    """
    import random
    if seed is None:
        seed = random.randint(0, 2**32 - 1)

    stage2_seed = seed + 1

    # Parse sigmas into lists
    s1_sigmas = [float(x.strip()) for x in stage1_sigmas.split(",")]
    s2_sigmas = [float(x.strip()) for x in stage2_sigmas.split(",")]

    workflow: dict[str, Any] = {
        # 100: CheckpointLoaderSimple -> MODEL[0], CLIP[0], VAE[0]
        "100": {
            "class_type": "CheckpointLoaderSimple",
            "inputs": {
                "ckpt_name": checkpoint_name,
            },
        },
        # 101: LoraLoaderModelOnly (apply distilled LoRA to dev model)
        "101": {
            "class_type": "LoraLoaderModelOnly",
            "inputs": {
                "model": ["100", 0],
                "lora_name": lora_name,
                "strength_model": lora_strength,
            },
        },
        # 102: DualCLIPLoader (Gemma 3 + LTX text projection)
        "102": {
            "class_type": "DualCLIPLoader",
            "inputs": {
                "clip_name1": clip_name1,
                "clip_name2": clip_name2,
                "type": "ltxv",
            },
        },
        # 103: CLIPTextEncode (positive)
        "103": {
            "class_type": "CLIPTextEncode",
            "inputs": {
                "clip": ["102", 0],
                "text": prompt,
            },
        },
        # 104: CLIPTextEncode (negative)
        "104": {
            "class_type": "CLIPTextEncode",
            "inputs": {
                "clip": ["102", 0],
                "text": negative_prompt,
            },
        },
        # 105: LTXVConditioning
        "105": {
            "class_type": "LTXVConditioning",
            "inputs": {
                "positive": ["103", 0],
                "negative": ["104", 0],
                "frame_rate": float(fps),
            },
        },
        # 106: LoadImage
        "106": {
            "class_type": "LoadImage",
            "inputs": {
                "image": source_image_path,
                "upload": "image",
            },
        },
        # 107: EmptyLTXVLatentVideo
        "107": {
            "class_type": "EmptyLTXVLatentVideo",
            "inputs": {
                "width": width,
                "height": height,
                "length": num_frames,
                "batch_size": 1,
            },
        },
        # 125: LTXVAudioVAELoader (separate audio VAE from checkpoint)
        "125": {
            "class_type": "LTXVAudioVAELoader",
            "inputs": {
                "ckpt_name": "LTX23_audio_vae_bf16.safetensors",
            },
        },
        # 108: LTXVEmptyLatentAudio
        "108": {
            "class_type": "LTXVEmptyLatentAudio",
            "inputs": {
                "audio_vae": ["125", 0],
                "frames_number": num_frames,
                "frame_rate": fps,
                "batch_size": 1,
            },
        },
        # --- Stage 1: Draft (9 steps) ---
        # 109: LTXVImgToVideoConditionOnly (Stage 1)
        "109": {
            "class_type": "LTXVImgToVideoConditionOnly",
            "inputs": {
                "vae": ["100", 2],
                "image": ["106", 0],
                "latent": ["107", 0],
                "strength": strength,
                "bypass": False,
            },
        },
        # 110: LTXVConcatAVLatent (Stage 1)
        "110": {
            "class_type": "LTXVConcatAVLatent",
            "inputs": {
                "video_latent": ["109", 0],
                "audio_latent": ["108", 0],
            },
        },
        # 111: RandomNoise (Stage 1)
        "111": {
            "class_type": "RandomNoise",
            "inputs": {
                "noise_seed": seed,
            },
        },
        # 112: CFGGuider (Stage 1)
        "112": {
            "class_type": "CFGGuider",
            "inputs": {
                "model": ["101", 0],
                "positive": ["105", 0],
                "negative": ["105", 1],
                "cfg": cfg,
            },
        },
        # 113: KSamplerSelect (Stage 1)
        "113": {
            "class_type": "KSamplerSelect",
            "inputs": {
                "sampler_name": stage1_sampler,
            },
        },
        # 114: ManualSigmas (Stage 1)
        "114": {
            "class_type": "ManualSigmas",
            "inputs": {
                "sigmas": stage1_sigmas,
            },
        },
        # 115: SamplerCustomAdvanced (Stage 1)
        "115": {
            "class_type": "SamplerCustomAdvanced",
            "inputs": {
                "noise": ["111", 0],
                "guider": ["112", 0],
                "sampler": ["113", 0],
                "sigmas": ["114", 0],
                "latent_image": ["110", 0],
            },
        },
        # 116: LTXVSeparateAVLatent (Stage 1 output)
        "116": {
            "class_type": "LTXVSeparateAVLatent",
            "inputs": {
                "av_latent": ["115", 0],
            },
        },
        # --- Stage 2: Refine (4 steps) ---
        # 117: LTXVImgToVideoConditionOnly (Stage 2, strength=1.0)
        "117": {
            "class_type": "LTXVImgToVideoConditionOnly",
            "inputs": {
                "vae": ["100", 2],
                "image": ["106", 0],
                "latent": ["107", 0],
                "strength": 1.0,
                "bypass": False,
            },
        },
        # 118: LTXVConcatAVLatent (Stage 2: video=stage2, audio=stage1)
        "118": {
            "class_type": "LTXVConcatAVLatent",
            "inputs": {
                "video_latent": ["117", 0],
                "audio_latent": ["116", 1],
            },
        },
        # 119: RandomNoise (Stage 2)
        "119": {
            "class_type": "RandomNoise",
            "inputs": {
                "noise_seed": stage2_seed,
            },
        },
        # 120: CFGGuider (Stage 2)
        "120": {
            "class_type": "CFGGuider",
            "inputs": {
                "model": ["101", 0],
                "positive": ["105", 0],
                "negative": ["105", 1],
                "cfg": cfg,
            },
        },
        # 121: KSamplerSelect (Stage 2)
        "121": {
            "class_type": "KSamplerSelect",
            "inputs": {
                "sampler_name": stage2_sampler,
            },
        },
        # 122: ManualSigmas (Stage 2)
        "122": {
            "class_type": "ManualSigmas",
            "inputs": {
                "sigmas": stage2_sigmas,
            },
        },
        # 123: SamplerCustomAdvanced (Stage 2)
        "123": {
            "class_type": "SamplerCustomAdvanced",
            "inputs": {
                "noise": ["119", 0],
                "guider": ["120", 0],
                "sampler": ["121", 0],
                "sigmas": ["122", 0],
                "latent_image": ["118", 0],
            },
        },
        # 124: LTXVSeparateAVLatent (final)
        "124": {
            "class_type": "LTXVSeparateAVLatent",
            "inputs": {
                "av_latent": ["123", 0],
            },
        },
        # --- Decode ---
        # 126: LTXVAudioVAEDecode
        "126": {
            "class_type": "LTXVAudioVAEDecode",
            "inputs": {
                "samples": ["124", 1],
                "audio_vae": ["125", 0],
            },
        },
        # 127: LTXVTiledVAEDecode
        "127": {
            "class_type": "LTXVTiledVAEDecode",
            "inputs": {
                "latents": ["124", 0],
                "vae": ["100", 2],
                "horizontal_tiles": 2,
                "vertical_tiles": 2,
                "overlap": 8,
                "last_frame_fix": True,
            },
        },
        # 128: VHS_VideoCombine (video + audio)
        "128": {
            "class_type": "VHS_VideoCombine",
            "inputs": {
                "images": ["127", 0],
                "audio": ["126", 0],
                "frame_rate": fps,
                "loop_count": 0,
                "filename_prefix": filename_prefix,
                "format": "video/h264-mp4",
                "pix_fmt": "yuv420p",
                "crf": crf,
                "save_metadata": True,
                "pingpong": False,
                "save_output": True,
            },
        },
    }

    return workflow


