#!/usr/bin/env python3
"""
RTX Video Super Resolution Standalone Service
Fast HTTP API for AI video/image upscaling using NVIDIA RTX VSR

Runs inside comfyui-primary container alongside ComfyUI (shares GPU but doesn't
block ComfyUI's queue — VSR only needs ~13MB VRAM).

API:
  POST /upscale          — upload image, get upscaled result (multipart)
  POST /upscale/video    — upload video, get upscaled video (multipart)
  POST /upscale/batch    — upload multiple images (multipart, files[])
  GET  /health           — health check
  GET  /benchmark        — run quick benchmark

Parameters:
  scale: float (1.0-4.0, default 2.0)
  quality: str (LOW/MEDIUM/HIGH/ULTRA, default HIGH)
  mode: str (VSR/HIGHBITRATE/DENOISE/DEBLUR, default VSR)
"""

import torch
import nvvfx
import numpy as np
from PIL import Image
import io
import time
import os
import tempfile
import traceback
import warnings
from typing import Optional
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import subprocess
import json

warnings.filterwarnings('ignore')

# ─── Config ──────────────────────────────────────────────
PORT = int(os.environ.get('RTX_VSR_PORT', '10589'))
OUTPUT_DIR = os.environ.get('RTX_VSR_OUTPUT', '/mnt/agents/output/gpu1/rtx-vsr')
os.makedirs(OUTPUT_DIR, exist_ok=True)

# Quality level mapping
QUALITY_MAP = {
    'LOW': nvvfx.VideoSuperRes.QualityLevel.LOW,
    'MEDIUM': nvvfx.VideoSuperRes.QualityLevel.MEDIUM,
    'HIGH': nvvfx.VideoSuperRes.QualityLevel.HIGH,
    'ULTRA': nvvfx.VideoSuperRes.QualityLevel.ULTRA,
    # High-bitrate variants (for clean sources)
    'HIGHBITRATE_LOW': nvvfx.VideoSuperRes.QualityLevel.HIGHBITRATE_LOW,
    'HIGHBITRATE_MEDIUM': nvvfx.VideoSuperRes.QualityLevel.HIGHBITRATE_MEDIUM,
    'HIGHBITRATE_HIGH': nvvfx.VideoSuperRes.QualityLevel.HIGHBITRATE_HIGH,
    'HIGHBITRATE_ULTRA': nvvfx.VideoSuperRes.QualityLevel.HIGHBITRATE_ULTRA,
    # Denoise (same-resolution)
    'DENOISE_LOW': nvvfx.VideoSuperRes.QualityLevel.DENOISE_LOW,
    'DENOISE_MEDIUM': nvvfx.VideoSuperRes.QualityLevel.DENOISE_MEDIUM,
    'DENOISE_HIGH': nvvfx.VideoSuperRes.QualityLevel.DENOISE_HIGH,
    'DENOISE_ULTRA': nvvfx.VideoSuperRes.QualityLevel.DENOISE_ULTRA,
    # Deblur (same-resolution)
    'DEBLUR_LOW': nvvfx.VideoSuperRes.QualityLevel.DEBLUR_LOW,
    'DEBLUR_MEDIUM': nvvfx.VideoSuperRes.QualityLevel.DEBLUR_MEDIUM,
    'DEBLUR_HIGH': nvvfx.VideoSuperRes.QualityLevel.DEBLUR_HIGH,
    'DEBLUR_ULTRA': nvvfx.VideoSuperRes.QualityLevel.DEBLUR_ULTRA,
}

# ─── VSR Engine ───────────────────────────────────────────

class VSREngine:
    """Manages RTX VideoSuperRes instances with caching"""

    _instances = {}  # quality → VideoSuperRes instance

    @classmethod
    def get_instance(cls, quality_level: nvvfx.VideoSuperRes.QualityLevel) -> nvvfx.VideoSuperRes:
        """Get or create a cached VSR instance"""
        key = quality_level
        if key not in cls._instances:
            vsr = nvvfx.VideoSuperRes(quality=quality_level)
            vsr.load()
            cls._instances[key] = vsr
            print(f"[VSR] Created instance for quality={quality_level.name}")
        return cls._instances[key]

    @classmethod
    def upscale_image(
        cls,
        image: Image.Image,
        scale: float = 2.0,
        quality: str = 'HIGH',
        target_width: Optional[int] = None,
        target_height: Optional[int] = None,
    ) -> tuple[Image.Image, float]:
        """
        Upscale a PIL image using RTX VSR.
        Returns (upscaled_image, elapsed_ms)
        """
        # Convert PIL → tensor (C, H, W) on CUDA, contiguous, float32 [0,1]
        img_rgb = image.convert('RGB')
        arr = np.array(img_rgb).astype(np.float32) / 255.0
        frame = torch.from_numpy(arr).permute(2, 0, 1).cuda().contiguous()

        # Determine output dimensions
        if target_width and target_height:
            out_w = target_width
            out_h = target_height
        else:
            out_w = int(frame.shape[2] * scale)
            out_h = int(frame.shape[1] * scale)

        # Align to 8
        out_w = max(8, round(out_w / 8) * 8)
        out_h = max(8, round(out_h / 8) * 8)

        # Get quality level
        quality_level = QUALITY_MAP.get(quality.upper(), nvvfx.VideoSuperRes.QualityLevel.HIGH)
        vsr = cls.get_instance(quality_level)

        # Configure output
        vsr.output_width = out_w
        vsr.output_height = out_h

        # Run VSR
        start = time.time()
        result = vsr.run(frame)
        out_tensor = torch.from_dlpack(result.image).clone()
        torch.cuda.synchronize()
        elapsed_ms = (time.time() - start) * 1000

        # Convert back to PIL
        out_arr = (out_tensor.permute(1, 2, 0).cpu().numpy() * 255).clip(0, 255).astype(np.uint8)
        return Image.fromarray(out_arr), elapsed_ms


# ─── FastAPI App ──────────────────────────────────────────

app = FastAPI(
    title="RTX Video Super Resolution Service",
    description="NVIDIA RTX VSR upscaling micro-service for kais-aigc-platform",
    version="1.0.0",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    """Health check"""
    try:
        free, total = torch.cuda.mem_get_info()
        gpu_name = torch.cuda.get_device_name(0)
        return {
            "status": "ok",
            "gpu": gpu_name,
            "vram_free_gb": round(free / 1024**3, 1),
            "vram_total_gb": round(total / 1024**3, 1),
            "cached_instances": list(VSREngine._instances.keys()),
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}


@app.get("/benchmark")
async def benchmark():
    """Run a quick benchmark"""
    # Create test frame
    h, w = 432, 768
    frame = torch.rand(3, h, w, device='cuda', dtype=torch.float32).contiguous()
    results = {}

    for q in ['LOW', 'MEDIUM', 'HIGH', 'ULTRA']:
        quality_level = QUALITY_MAP[q]
        vsr = VSREngine.get_instance(quality_level)
        vsr.output_width = w * 2
        vsr.output_height = h * 2

        # Warmup
        vsr.run(frame)
        torch.cuda.synchronize()

        # Benchmark
        start = time.time()
        for _ in range(20):
            result = vsr.run(frame)
            _ = torch.from_dlpack(result.image).clone()
        torch.cuda.synchronize()
        elapsed = time.time() - start

        results[q] = {
            "fps": round(20 / elapsed, 1),
            "ms_per_frame": round(elapsed / 20 * 1000, 1),
        }

    return {"input": f"{w}x{h}", "output": f"{w*2}x{h*2}", "results": results}


@app.post("/upscale")
async def upscale_image(
    file: UploadFile = File(...),
    scale: float = Form(2.0),
    quality: str = Form('HIGH'),
    target_width: Optional[int] = Form(None),
    target_height: Optional[int] = Form(None),
    return_format: str = Form('png'),  # png, jpeg, webp
):
    """
    Upsscale a single image using RTX VSR.
    Returns the upscaled image as a download.
    """
    # Validate
    if quality.upper() not in QUALITY_MAP:
        raise HTTPException(400, f"Invalid quality: {quality}. Available: {list(QUALITY_MAP.keys())}")
    if scale < 1.0 or scale > 4.0:
        raise HTTPException(400, f"Scale must be 1.0-4.0, got {scale}")

    # Read image
    contents = await file.read()
    try:
        img = Image.open(io.BytesIO(contents))
    except Exception as e:
        raise HTTPException(400, f"Invalid image: {e}")

    input_size = img.size

    try:
        # Upscale
        result_img, elapsed_ms = VSREngine.upscale_image(
            img, scale=scale, quality=quality,
            target_width=target_width, target_height=target_height,
        )

        # Save
        ext = return_format.lower().replace('jpeg', 'jpg')
        filename = f"vsr_{int(time.time())}_{scale}x_{quality}.{ext}"
        filepath = os.path.join(OUTPUT_DIR, filename)
        result_img.save(filepath, quality=95 if ext == 'jpg' else None)

        return JSONResponse({
            "status": "ok",
            "input_size": input_size,
            "output_size": result_img.size,
            "scale": scale,
            "quality": quality,
            "elapsed_ms": round(elapsed_ms, 1),
            "output_path": filepath,
            "output_url": f"/output/{filename}",
        })

    except Exception as e:
        traceback.print_exc()
        raise HTTPException(500, f"Upscale failed: {e}")


@app.post("/upscale/batch")
async def upscale_batch(
    files: list[UploadFile] = File(...),
    scale: float = Form(2.0),
    quality: str = Form('HIGH'),
):
    """Upscale multiple images"""
    if quality.upper() not in QUALITY_MAP:
        raise HTTPException(400, f"Invalid quality: {quality}")

    results = []
    for file in files:
        contents = await file.read()
        try:
            img = Image.open(io.BytesIO(contents))
            input_size = img.size

            result_img, elapsed_ms = VSREngine.upscale_image(img, scale=scale, quality=quality)

            ext = 'png'
            filename = f"vsr_{int(time.time())}_{file.filename}"
            filepath = os.path.join(OUTPUT_DIR, filename)
            result_img.save(filepath)

            results.append({
                "filename": file.filename,
                "input_size": input_size,
                "output_size": result_img.size,
                "elapsed_ms": round(elapsed_ms, 1),
                "output_path": filepath,
            })
        except Exception as e:
            results.append({"filename": file.filename, "error": str(e)})

    return {"status": "ok", "count": len(results), "results": results}


@app.post("/upscale/video")
async def upscale_video(
    file: UploadFile = File(...),
    scale: float = Form(2.0),
    quality: str = Form('HIGH'),
):
    """
    Upscale a video using RTX VSR (frame-by-frame).
    Uses ffmpeg for decode/encode, RTX VSR for each frame.
    """
    if quality.upper() not in QUALITY_MAP:
        raise HTTPException(400, f"Invalid quality: {quality}")

    # Save uploaded video to temp
    with tempfile.NamedTemporaryFile(suffix='.mp4', delete=False) as tmp_input:
        contents = await file.read()
        tmp_input.write(contents)
        tmp_input_path = tmp_input.name

    try:
        # Get video info
        probe = subprocess.run(
            ['ffprobe', '-v', 'quiet', '-print_format', 'json', '-show_streams', tmp_input_path],
            capture_output=True, text=True, timeout=30
        )
        streams = json.loads(probe.stdout)['streams']
        video_stream = next(s for s in streams if s['codec_type'] == 'video')
        src_w = int(video_stream['width'])
        src_h = int(video_stream['height'])
        fps_str = video_stream.get('avg_frame_rate', '30/1')
        fps_num, fps_den = map(int, fps_str.split('/'))
        fps = fps_num / fps_den
        total_frames = int(video_stream.get('nb_frames', 0))

        out_w = int(src_w * scale) // 2 * 2
        out_h = int(src_h * scale) // 2 * 2

        # Output path
        out_filename = f"vsr_video_{int(time.time())}_{scale}x_{quality}.mp4"
        out_path = os.path.join(OUTPUT_DIR, out_filename)

        # Frame-by-frame processing using ffmpeg pipe
        # Decode frames as raw RGB
        decode_cmd = [
            'ffmpeg', '-i', tmp_input_path,
            '-f', 'rawvideo', '-pix_fmt', 'rgb24',
            '-v', 'quiet', '-'
        ]

        # Encode output from raw RGB frames
        encode_cmd = [
            'ffmpeg', '-y',
            '-f', 'rawvideo', '-pix_fmt', 'rgb24',
            '-s', f'{out_w}x{out_h}',
            '-r', str(fps),
            '-i', '-',
            '-c:v', 'libx264', '-preset', 'fast',
            '-crf', '18',
            '-pix_fmt', 'yuv420p',
            '-movflags', '+faststart',
            out_path,
            '-v', 'quiet'
        ]

        # Get VSR instance
        quality_level = QUALITY_MAP[quality.upper()]
        vsr = VSREngine.get_instance(quality_level)
        vsr.output_width = out_w
        vsr.output_height = out_h

        # Pipe decode → process → encode
        decode_proc = subprocess.Popen(decode_cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        encode_proc = subprocess.Popen(encode_cmd, stdin=subprocess.PIPE, stderr=subprocess.DEVNULL)

        frame_size = src_w * src_h * 3
        frame_count = 0
        start_time = time.time()

        while True:
            raw_frame = decode_proc.stdout.read(frame_size)
            if len(raw_frame) < frame_size:
                break

            # Convert to tensor
            arr = np.frombuffer(raw_frame, dtype=np.uint8).reshape(src_h, src_w, 3)
            frame = torch.from_numpy(arr.astype(np.float32) / 255.0).permute(2, 0, 1).cuda().contiguous()

            # VSR upscale
            result = vsr.run(frame)
            out_tensor = torch.from_dlpack(result.image).clone()

            # Convert back to raw bytes
            out_arr = (out_tensor.permute(1, 2, 0).cpu().numpy() * 255).clip(0, 255).astype(np.uint8)
            encode_proc.stdin.write(out_arr.tobytes())

            frame_count += 1
            if frame_count % 10 == 0:
                elapsed = time.time() - start_time
                print(f"[VSR Video] Frame {frame_count}/{total_frames}, {frame_count/elapsed:.1f} fps")

        decode_proc.stdout.close()
        encode_proc.stdin.close()
        decode_proc.wait()
        encode_proc.wait()

        elapsed_total = time.time() - start_time

        return JSONResponse({
            "status": "ok",
            "input_resolution": f"{src_w}x{src_h}",
            "output_resolution": f"{out_w}x{out_h}",
            "frames": frame_count,
            "fps": round(frame_count / elapsed_total, 1) if elapsed_total > 0 else 0,
            "total_time_s": round(elapsed_total, 1),
            "scale": scale,
            "quality": quality,
            "output_path": out_path,
            "output_url": f"/output/{out_filename}",
        })

    except Exception as e:
        traceback.print_exc()
        raise HTTPException(500, f"Video upscale failed: {e}")
    finally:
        os.unlink(tmp_input_path)


# ─── Static file serving ──────────────────────────────────
from fastapi.staticfiles import StaticFiles
app.mount("/output", StaticFiles(directory=OUTPUT_DIR), name="output")


# ─── Main ─────────────────────────────────────────────────
if __name__ == '__main__':
    print(f"=== RTX VSR Service Starting on port {PORT} ===")
    print(f"GPU: {torch.cuda.get_device_name(0)}")
    free, total = torch.cuda.mem_get_info()
    print(f"VRAM: {free/1024**3:.1f} GB free / {total/1024**3:.1f} GB total")
    print(f"Output dir: {OUTPUT_DIR}")
    print()

    uvicorn.run(app, host="0.0.0.0", port=PORT, log_level="info")
