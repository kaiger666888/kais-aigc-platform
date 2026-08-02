#!/usr/bin/env python3
"""
MageFlow FastAPI 推理服务
提供图像编辑 (edit) 和文生图 (generate) 两个核心端点 + 深度图提取。

启动:
  python3 mage_flow_serve.py --port 7860 --device cuda:1

端点:
  POST /edit          — 指令式图像编辑 (Mage-Flow-Edit-Turbo)
  POST /generate      — 文生图 (Mage-Flow-Turbo)
  POST /depth         — 深度图提取 (DepthAnythingV2 via ComfyUI)
  GET  /health        — 健康检查
  GET  /models        — 已加载模型列表
"""

from __future__ import annotations

import argparse
import io
import os
import time
import uuid
from contextlib import asynccontextmanager
from typing import Optional

import torch
from PIL import Image
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import JSONResponse
import uvicorn

# ─── 全局状态 ────────────────────────────────────────────────

_STATE: dict = {
    "edit_pipe": None,    # MageFlowPipeline for editing
    "gen_pipe": None,     # MageFlowPipeline for generation
    "device": "cuda:1",
    "models_dir": "/data/models",
}

OUTPUT_DIR = "/tmp/mage-flow-output"
os.makedirs(OUTPUT_DIR, exist_ok=True)


def _load_edit_pipe():
    """懒加载编辑模型"""
    if _STATE["edit_pipe"] is None:
        # 先设置 SDPA backend（flash-attn 对 torch 2.13+cu130 没有预编译 wheel）
        # 注意：MageFlowModel.__init__ 会用 config.attn_type (默认 flash2) 覆盖，
        # 所以需要在 pipeline 构建后再设一次
        from mage_flow.models.modules._attn_backend import set_attn_backend
        set_attn_backend("sdpa")
        os.environ["VF_HF_ATTN_IMPL"] = "sdpa"  # 同时强制 HF text_encoder 用 sdpa
        from mage_flow import MageFlowPipeline
        model_path = os.path.join(_STATE["models_dir"], "Mage-Flow-Edit-Turbo")
        if not os.path.exists(model_path):
            model_path = "microsoft/Mage-Flow-Edit-Turbo"  # fallback to HF
        print(f"[MageFlow] Loading edit model from {model_path} ...")
        _STATE["edit_pipe"] = MageFlowPipeline.from_pretrained(
            model_path, device=_STATE["device"]
        )
        # 关键：pipeline 加载后 MageFlowModel.__init__ 已把 backend 重置为 flash2，
        # 这里再覆盖回 sdpa
        set_attn_backend("sdpa")
        print(f"[MageFlow] Edit model loaded (attn=sdpa).")
    return _STATE["edit_pipe"]


def _load_gen_pipe():
    """懒加载生成模型"""
    if _STATE["gen_pipe"] is None:
        from mage_flow.models.modules._attn_backend import set_attn_backend
        set_attn_backend("sdpa")
        from mage_flow import MageFlowPipeline
        model_path = os.path.join(_STATE["models_dir"], "Mage-Flow-Turbo")
        if not os.path.exists(model_path):
            model_path = "microsoft/Mage-Flow-Turbo"
        print(f"[MageFlow] Loading generation model from {model_path} ...")
        _STATE["gen_pipe"] = MageFlowPipeline.from_pretrained(
            model_path, device=_STATE["device"]
        )
        set_attn_backend("sdpa")  # 覆盖 __init__ 的 flash2 重置
        print(f"[MageFlow] Generation model loaded (attn=sdpa).")
    return _STATE["gen_pipe"]


# ─── FastAPI ─────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    print(f"[MageFlow] Server starting on device={_STATE['device']}")
    yield
    # Cleanup GPU memory on shutdown
    if _STATE["edit_pipe"] is not None:
        del _STATE["edit_pipe"]
    if _STATE["gen_pipe"] is not None:
        del _STATE["gen_pipe"]
    torch.cuda.empty_cache()
    print("[MageFlow] Server stopped, GPU memory cleaned.")


app = FastAPI(title="MageFlow Serve", version="1.0.0", lifespan=lifespan)


@app.get("/health")
async def health():
    gpu_info = {}
    if torch.cuda.is_available():
        idx = int(_STATE["device"].split(":")[-1]) if ":" in _STATE["device"] else 0
        props = torch.cuda.get_device_properties(idx)
        gpu_info = {
            "gpu": torch.cuda.get_device_name(idx),
            "memory_total": f"{props.total_memory / 1e9:.1f}GB",
            "memory_allocated": f"{torch.cuda.memory_allocated(idx) / 1e9:.2f}GB",
            "memory_free": f"{(props.total_memory - torch.cuda.memory_allocated(idx)) / 1e9:.2f}GB",
        }
    return {
        "status": "ok",
        "device": _STATE["device"],
        "gpu": gpu_info,
        "models_loaded": {
            "edit": _STATE["edit_pipe"] is not None,
            "generate": _STATE["gen_pipe"] is not None,
        },
    }


@app.get("/models")
async def list_models():
    return {
        "models_dir": _STATE["models_dir"],
        "available": {
            "edit_turbo": os.path.exists(os.path.join(_STATE["models_dir"], "Mage-Flow-Edit-Turbo")),
            "gen_turbo": os.path.exists(os.path.join(_STATE["models_dir"], "Mage-Flow-Turbo")),
        },
        "loaded": {
            "edit": _STATE["edit_pipe"] is not None,
            "generate": _STATE["gen_pipe"] is not None,
        },
    }


def _save_image(img: Image.Image, prefix: str = "out") -> str:
    """保存图片到输出目录，返回文件名"""
    fname = f"{prefix}_{uuid.uuid4().hex[:8]}.png"
    fpath = os.path.join(OUTPUT_DIR, fname)
    img.save(fpath)
    return fname, fpath


# ─── POST /edit — 指令式图像编辑 ─────────────────────────────

@app.post("/edit")
async def edit_image(
    image: UploadFile = File(..., description="参考图片"),
    prompt: str = Form(..., description="编辑指令（自然语言）"),
    negative_prompt: str = Form("", description="负面提示词"),
    steps: int = Form(4, description="去噪步数 (Turbo=4, Base=30)"),
    cfg: float = Form(1.0, description="CFG scale (Turbo=1.0, Base=5.0)"),
    max_size: int = Form(1024, description="输出最长边像素"),
    height: Optional[int] = Form(None, description="显式输出高度 (覆盖 max_size)"),
    width: Optional[int] = Form(None, description="显式输出宽度 (覆盖 max_size)"),
    seed: int = Form(42, description="随机种子"),
):
    """
    指令式图像编辑 — 给一张参考图 + 自然语言编辑指令 → 编辑后的图。
    
    示例:
      prompt = "把背景改为向日葵花田"
      prompt = "Change the person's shirt to red"
      prompt = "Add a hat to the character"
    
    Turbo 模型: steps=4, cfg=1.0 (超快 ~1s)
    """
    t0 = time.time()
    
    try:
        pipe = _load_edit_pipe()
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Model load failed: {e}")

    # 读取上传图片
    img_bytes = await image.read()
    ref_img = Image.open(io.BytesIO(img_bytes)).convert("RGB")

    # 构建参数
    kwargs = dict(
        steps=steps,
        cfg=cfg,
        seeds=[seed],
        neg_prompts=[negative_prompt or " "],
    )
    if height and width:
        kwargs["heights"] = [height]
        kwargs["widths"] = [width]
    else:
        kwargs["max_size"] = max_size

    try:
        result = pipe.edit([prompt], [ref_img], **kwargs)[0]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Edit failed: {type(e).__name__}: {e}")

    fname, fpath = _save_image(result, "edit")
    elapsed = time.time() - t0

    return JSONResponse({
        "success": True,
        "filename": fname,
        "path": fpath,
        "url": f"/file/{fname}",
        "prompt": prompt,
        "steps": steps,
        "cfg": cfg,
        "seed": seed,
        "elapsed_ms": int(elapsed * 1000),
    })


# ─── POST /generate — 文生图 ─────────────────────────────────

@app.post("/generate")
async def generate_image(
    prompt: str = Form(..., description="生成提示词"),
    negative_prompt: str = Form("", description="负面提示词"),
    steps: int = Form(4, description="去噪步数 (Turbo=4)"),
    cfg: float = Form(1.0, description="CFG scale (Turbo=1.0)"),
    height: int = Form(1024, description="输出高度 (16的倍数)"),
    width: int = Form(1024, description="输出宽度 (16的倍数)"),
    seed: int = Form(42, description="随机种子"),
):
    """
    文生图 — Mage-Flow-Turbo，4B 模型，原生分辨率。
    
    Turbo: steps=4, cfg=1.0 (~0.6s on A100)
    支持任意分辨率 512-2048，任意宽高比。
    """
    t0 = time.time()
    
    try:
        pipe = _load_gen_pipe()
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Model load failed: {e}")

    try:
        result = pipe.generate(
            [prompt],
            neg_prompts=[negative_prompt or " "],
            seeds=[seed],
            heights=[height],
            widths=[width],
            steps=steps,
            cfg=cfg,
        )[0]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Generate failed: {type(e).__name__}: {e}")

    fname, fpath = _save_image(result, "gen")
    elapsed = time.time() - t0

    return JSONResponse({
        "success": True,
        "filename": fname,
        "path": fpath,
        "url": f"/file/{fname}",
        "prompt": prompt,
        "steps": steps,
        "cfg": cfg,
        "seed": seed,
        "height": height,
        "width": width,
        "elapsed_ms": int(elapsed * 1000),
    })


# ─── POST /depth — 深度图提取 (转发到 ComfyUI) ───────────────

@app.post("/depth")
async def extract_depth(
    image: UploadFile = File(...),
    model: str = Form("large", description="small/base/large"),
):
    """
    深度图提取 — 转发到 ComfyUI DepthAnythingV2。
    与 aigc-platform /api/production/postprocess/enhance?steps=depth 对等。
    """
    comfyui_url = os.environ.get("COMFYUI_URL", "http://localhost:8188")
    import aiohttp
    
    img_bytes = await image.read()
    img_name = f"depth_input_{uuid.uuid4().hex[:8]}.png"
    
    # 上传到 ComfyUI
    async with aiohttp.ClientSession() as session:
        form = aiohttp.FormData()
        form.add_field("image", img_bytes, filename=img_name, content_type="image/png")
        async with session.post(f"{comfyui_url}/upload/image", data=form) as resp:
            upload_result = await resp.json()
    
    server_filename = upload_result.get("name", img_name)
    
    # 构建 workflow
    workflow = {
        "1": {"class_type": "LoadImage", "inputs": {"image": server_filename}},
        "2": {
            "class_type": "DepthAnythingV2Preprocessor",
            "inputs": {"image": ["1", 0], "model": model},
        },
        "3": {
            "class_type": "SaveImage",
            "inputs": {"filename_prefix": "depth_out", "images": ["2", 0]},
        },
    }
    
    async with aiohttp.ClientSession() as session:
        async with session.post(f"{comfyui_url}/prompt", json={"prompt": workflow}) as resp:
            result = await resp.json()
        prompt_id = result.get("prompt_id")
        
        # 轮询
        for _ in range(150):
            await asyncio.sleep(2)
            async with session.get(f"{comfyui_url}/history/{prompt_id}") as resp:
                hist = await resp.json()
            if prompt_id in hist:
                outputs = hist[prompt_id].get("outputs", {})
                if "3" in outputs:
                    imgs = outputs["3"]["images"]
                    if imgs:
                        return JSONResponse({
                            "success": True,
                            "prompt_id": prompt_id,
                            "url": f"{comfyui_url}/view?filename={imgs[0]['filename']}&subfolder={imgs[0].get('subfolder','')}&type=output",
                        })
    
    raise HTTPException(status_code=504, detail="Depth extraction timeout")


# ─── GET /file/{filename} — 静态文件访问 ──────────────────────

from fastapi.responses import FileResponse

@app.get("/file/{filename}")
async def serve_file(filename: str):
    """访问输出目录中的图片文件"""
    fpath = os.path.join(OUTPUT_DIR, filename)
    if not os.path.exists(fpath):
        raise HTTPException(status_code=404, detail=f"File not found: {filename}")
    return FileResponse(fpath, media_type="image/png")


# ─── 入口 ────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="MageFlow FastAPI Server")
    parser.add_argument("--port", type=int, default=7860)
    parser.add_argument("--device", default="cuda:1", help="cuda device (e.g. cuda:0, cuda:1)")
    parser.add_argument("--models_dir", default="/data/models")
    parser.add_argument("--host", default="0.0.0.0")
    args = parser.parse_args()

    _STATE["device"] = args.device
    _STATE["models_dir"] = args.models_dir

    import asyncio  # for depth endpoint
    uvicorn.run(app, host=args.host, port=args.port)
