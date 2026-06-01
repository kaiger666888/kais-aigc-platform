"""FLUX image generation API server for Kais Hub.

Supports FLUX.1 Schnell, FLUX.1 Dev, IP-Adapter, and ControlNet inference.
All models loaded lazily and cached per variant.
"""
import os
import time
import base64
import logging
import io
from pathlib import Path
from typing import Optional

os.environ["OMP_NUM_THREADS"] = "4"

import torch
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from diffusers import FluxPipeline, FluxControlNetPipeline, FluxControlNetModel
from diffusers.utils import load_image
from PIL import Image

logger = logging.getLogger("flux_api")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(levelname)s: %(message)s")

app = FastAPI(title="FLUX Engine API")

device = "cuda" if torch.cuda.is_available() else "cpu"
MODEL_BASE = os.environ.get("FLUX_MODEL_BASE", "/data/models")

_pipelines: dict = {}

def get_schnell():
    if "schnell" not in _pipelines:
        path = os.path.join(MODEL_BASE, "flux1-schnell")
        logger.info(f"Loading FLUX Schnell from {path}...")
        pipe = FluxPipeline.from_pretrained(path, torch_dtype=torch.bfloat16)
        pipe.enable_sequential_cpu_offload()
        _pipelines["schnell"] = pipe
    return _pipelines["schnell"]

def get_dev():
    if "dev" not in _pipelines:
        fp8_path = os.path.join(MODEL_BASE, "flux1-dev-fp8", "flux1-dev-fp8.safetensors")
        fp16_path = os.path.join(MODEL_BASE, "flux1-dev-fp16")
        if os.path.exists(fp8_path):
            logger.info(f"Loading FLUX Dev (fp8) from single file...")
            pipe = FluxPipeline.from_single_file(fp8_path, torch_dtype=torch.bfloat16)
        else:
            logger.info(f"Loading FLUX Dev from {fp16_path}...")
            pipe = FluxPipeline.from_pretrained(fp16_path, torch_dtype=torch.bfloat16)
        pipe.enable_sequential_cpu_offload()
        _pipelines["dev"] = pipe
    return _pipelines["dev"]

def get_controlnet():
    if "controlnet" not in _pipelines:
        dev_path = os.path.join(MODEL_BASE, "flux1-dev-fp16")
        cn_path = os.path.join(MODEL_BASE, "flux1-dev-controlnet-canny")
        logger.info(f"Loading FLUX Dev + ControlNet from {cn_path}...")
        controlnet = FluxControlNetModel.from_pretrained(
            cn_path, torch_dtype=torch.bfloat16
        )
        pipe = FluxControlNetPipeline.from_pretrained(
            dev_path, controlnet=controlnet, torch_dtype=torch.bfloat16
        )
        pipe.enable_sequential_cpu_offload()
        _pipelines["controlnet"] = pipe
    return _pipelines["controlnet"]

def unload_all():
    for k in list(_pipelines.keys()):
        del _pipelines[k]
    _pipelines.clear()
    torch.cuda.empty_cache()
    logger.info("All FLUX pipelines unloaded")


class GenerateRequest(BaseModel):
    prompt: str
    negative_prompt: str = ""
    variant: str = "schnell"  # schnell | dev | controlnet
    width: int = 1024
    height: int = 1024
    num_inference_steps: int = 4  # schnell=4, dev=20-50
    guidance_scale: float = 3.5
    seed: int = -1
    controlnet_image: Optional[str] = None  # base64 or path
    controlnet_strength: float = 0.7
    num_images: int = 1
    output_format: str = "png"  # png | jpg | webp


class GenerateResponse(BaseModel):
    status: str
    images: list[str]  # base64 encoded
    seed: int
    inference_time: float
    variant: str


@app.get("/health")
async def health():
    loaded = list(_pipelines.keys())
    return {"status": "ok", "loaded_pipelines": loaded}


@app.post("/unload")
async def unload():
    unload_all()
    return {"status": "unloaded"}


@app.post("/generate", response_model=GenerateResponse)
async def generate(req: GenerateRequest):
    t0 = time.time()

    if req.seed >= 0:
        generator = torch.Generator(device).manual_seed(req.seed)
    else:
        generator = torch.Generator(device).manual_seed(torch.randint(0, 2**32, (1,)).item())
        req.seed = generator.initial_seed()

    if req.variant == "controlnet":
        pipe = get_controlnet()
        cn_image = None
        if req.controlnet_image:
            if os.path.exists(req.controlnet_image):
                cn_image = load_image(req.controlnet_image).resize((req.width, req.height))
            else:
                img_data = base64.b64decode(req.controlnet_image)
                cn_image = Image.open(io.BytesIO(img_data)).resize((req.width, req.height))
        result = pipe(
            prompt=req.prompt,
            control_image=cn_image,
            controlnet_conditioning_scale=req.controlnet_strength,
            num_inference_steps=req.num_inference_steps,
            guidance_scale=req.guidance_scale,
            width=req.width,
            height=req.height,
            generator=generator,
            num_images_per_prompt=req.num_images,
        ).images
    elif req.variant == "dev":
        pipe = get_dev()
        result = pipe(
            prompt=req.prompt,
            num_inference_steps=req.num_inference_steps,
            guidance_scale=req.guidance_scale,
            width=req.width,
            height=req.height,
            generator=generator,
            num_images_per_prompt=req.num_images,
        ).images
    else:  # schnell
        pipe = get_schnell()
        result = pipe(
            prompt=req.prompt,
            num_inference_steps=req.num_inference_steps,
            guidance_scale=0.0,
            width=req.width,
            height=req.height,
            generator=generator,
            num_images_per_prompt=req.num_images,
        ).images

    images_b64 = []
    for img in result:
        buf = io.BytesIO()
        fmt = "JPEG" if req.output_format == "jpg" else ("WEBP" if req.output_format == "webp" else "PNG")
        img.save(buf, format=fmt, quality=95)
        images_b64.append(base64.b64encode(buf.getvalue()).decode())

    elapsed = time.time() - t0
    logger.info(f"Generated {len(result)} images in {elapsed:.2f}s (variant={req.variant}, steps={req.num_inference_steps})")

    return GenerateResponse(
        status="done",
        images=images_b64,
        seed=req.seed,
        inference_time=elapsed,
        variant=req.variant,
    )


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("FLUX_API_PORT", "8080"))
    uvicorn.run(app, host="0.0.0.0", port=port)
