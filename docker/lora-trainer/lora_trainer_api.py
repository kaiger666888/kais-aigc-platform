"""
lora_trainer_api.py — FLUX.1-dev LoRA Training API Server

Provides REST endpoints for:
  POST /train        — Start a LoRA training job
  GET  /status/{id}  — Get training status
  POST /cancel/{id}  — Cancel a running training job
  GET  /health       — Health check
  GET  /models       — List available base models

Training runs sd-scripts (kohya_ss) flux_train_network.py in background.
All state persisted to /data (host-mounted).
"""

import os
import sys
import json
import time
import uuid
import signal
import subprocess
import threading
import logging
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, BackgroundTasks
from pydantic import BaseModel, Field

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(levelname)s: %(message)s")
logger = logging.getLogger("lora-trainer")

app = FastAPI(title="KAIS LoRA Trainer", version="1.0.0")

# ─── Paths ─────────────────────────────────────────────
SD_SCRIPTS_DIR = os.environ.get("SD_SCRIPTS_DIR", "/opt/sd-scripts")
PYTHON_BIN = sys.executable
DATA_DIR = os.environ.get("DATA_DIR", "/data")
DATASETS_DIR = os.path.join(DATA_DIR, "datasets")
OUTPUT_DIR = os.path.join(DATA_DIR, "output", "lora")
MODELS_DIR = os.environ.get("MODELS_DIR", "/data/models/comfyui")
TRAIN_LOG_DIR = os.path.join(DATA_DIR, "logs", "lora-train")

for d in [DATASETS_DIR, OUTPUT_DIR, TRAIN_LOG_DIR]:
    Path(d).mkdir(parents=True, exist_ok=True)

# ─── Training State ────────────────────────────────────
_trainings: dict[str, dict] = {}
_lock = threading.Lock()


class TrainRequest(BaseModel):
    """Request to start a LoRA training job."""
    dataset_dir: str = Field(..., description="Path to dataset directory with images + metadata.json")
    output_name: str = Field("flux-lora", description="Output LoRA file name (without extension)")
    
    # Model paths (defaults point to ComfyUI model store)
    base_model: str = Field("", description="Path to FLUX model .safetensors (empty = auto-detect)")
    clip_l: str = Field("", description="Path to CLIP-L model")
    t5xxl: str = Field("", description="Path to T5-XXL model")
    ae: str = Field("", description="Path to VAE model")
    
    # Training hyperparameters
    resolution: int = Field(512, ge=256, le=1024)
    train_batch_size: int = Field(1, ge=1, le=4)
    gradient_accumulation_steps: int = Field(4, ge=1, le=16)
    learning_rate: float = Field(4e-4, gt=0)
    max_train_steps: int = Field(200, ge=10, le=10000)
    save_every_n_steps: int = Field(100, ge=10)
    network_dim: int = Field(4, ge=2, le=128, description="LoRA rank")
    network_alpha: int = Field(4, ge=1)
    optimizer_type: str = Field("adamw8bit")
    mixed_precision: str = Field("bf16")
    fp8_base: bool = Field(True, description="Use fp8 quantization for base model (required for 24GB VRAM)")
    gradient_checkpointing: bool = Field(True)
    cache_latents: bool = Field(True)
    cache_text_encoder_outputs: bool = Field(True)
    
    # Repeat count for dataset
    num_repeats: int = Field(10, ge=1, le=100)


class TrainResponse(BaseModel):
    training_id: str
    status: str
    log_file: str
    output_dir: str


class StatusResponse(BaseModel):
    training_id: str
    status: str  # queued | running | completed | failed | cancelled
    progress: Optional[float] = None  # 0.0 - 1.0
    current_step: Optional[int] = None
    total_steps: Optional[int] = None
    loss: Optional[float] = None
    output_file: Optional[str] = None
    error: Optional[str] = None
    started_at: Optional[float] = None
    finished_at: Optional[float] = None
    elapsed_seconds: Optional[float] = None


def auto_detect_models() -> dict:
    """Auto-detect FLUX model paths from ComfyUI model store."""
    base = Path(MODELS_DIR)
    
    # Find FLUX model
    flux_candidates = list(base.glob("diffusion_models/flux1-dev*.safetensors"))
    flux_candidates = [f for f in flux_candidates if not f.is_symlink() or f.exists()]
    
    clip_l_path = base / "text_encoders" / "clip_l.safetensors"
    t5xxl_candidates = list(base.glob("text_encoders/t5xxl*.safetensors"))
    vae_candidates = list((base / "vae").glob("flux*ae*.safetensors"))
    vae_candidates = [v for v in vae_candidates if not v.is_symlink() or v.exists()]
    
    return {
        "base_model": str(flux_candidates[0]) if flux_candidates else "",
        "clip_l": str(clip_l_path) if clip_l_path.exists() else "",
        "t5xxl": str(t5xxl_candidates[0]) if t5xxl_candidates else "",
        "ae": str(vae_candidates[0]) if vae_candidates else "",
    }


def build_dataset_config(dataset_dir: str, resolution: int, num_repeats: int) -> str:
    """Generate sd-scripts dataset config TOML."""
    metadata_path = os.path.join(dataset_dir, "metadata.json")
    if not os.path.exists(metadata_path):
        raise ValueError(f"metadata.json not found in {dataset_dir}")
    
    # Look for images in dataset_dir directly, or in img/ subdirectory
    img_dir = dataset_dir
    if not os.path.exists(os.path.join(dataset_dir, "metadata.json")):
        raise ValueError(f"metadata.json not found in {dataset_dir}")
    # Check if images are in img/ subdirectory
    img_subdir = os.path.join(dataset_dir, "img")
    if os.path.isdir(img_subdir):
        img_dir = img_subdir
    
    config = f"""[general]
resolution = {resolution}
enable_bucket = false

[[datasets]]
subsets = [
    {{ image_dir = "{img_dir}", metadata_file = "{metadata_path}", num_repeats = {num_repeats}, keep_tokens = 2 }}
]
"""
    return config


def parse_training_log(log_file: str) -> dict:
    """Parse training log for progress and loss."""
    info = {"current_step": None, "total_steps": None, "loss": None, "progress": None}
    try:
        with open(log_file, "r") as f:
            lines = f.readlines()
        for line in reversed(lines):
            # Match: "steps: 42/200"
            if "steps:" in line and "/" in line:
                try:
                    parts = line.split("steps:")[1].strip().split("/")
                    info["current_step"] = int(parts[0].strip())
                    info["total_steps"] = int(parts[0].strip()) if len(parts) < 2 else int(parts[1].split()[0].strip())
                    if info["total_steps"] and info["total_steps"] > 0:
                        info["progress"] = info["current_step"] / info["total_steps"]
                except (ValueError, IndexError):
                    pass
            # Match: "avr_loss" or "loss"
            if "avr_loss" in line:
                try:
                    loss_part = line.split("avr_loss")[1].strip().split()[0]
                    info["loss"] = float(loss_part)
                except (ValueError, IndexError):
                    pass
            if info["current_step"] is not None and info["loss"] is not None:
                break
    except Exception:
        pass
    return info


def run_training(training_id: str, req: TrainRequest, config_path: str, log_file: str, output_dir: str):
    """Background training function."""
    with _lock:
        _trainings[training_id]["status"] = "running"
        _trainings[training_id]["started_at"] = time.time()
    
    # Auto-detect models if not specified
    models = {}
    if not req.base_model or not req.clip_l or not req.t5xxl or not req.ae:
        models = auto_detect_models()
    
    base_model = req.base_model or models.get("base_model", "")
    clip_l = req.clip_l or models.get("clip_l", "")
    t5xxl = req.t5xxl or models.get("t5xxl", "")
    ae = req.ae or models.get("ae", "")
    
    if not base_model:
        with _lock:
            _trainings[training_id]["status"] = "failed"
            _trainings[training_id]["error"] = "Could not auto-detect FLUX base model"
            _trainings[training_id]["finished_at"] = time.time()
        return
    
    # Build command
    cmd = [
        PYTHON_BIN, os.path.join(SD_SCRIPTS_DIR, "flux_train_network.py"),
        "--pretrained_model_name_or_path", base_model,
        "--clip_l", clip_l,
        "--t5xxl", t5xxl,
        "--ae", ae,
        "--dataset_config", config_path,
        "--output_dir", output_dir,
        "--output_name", req.output_name,
        "--network_module", "networks.lora_flux",
        "--train_batch_size", str(req.train_batch_size),
        "--gradient_accumulation_steps", str(req.gradient_accumulation_steps),
        "--learning_rate", str(req.learning_rate),
        "--lr_scheduler", "constant",
        "--mixed_precision", req.mixed_precision,
        "--save_precision", req.mixed_precision,
        "--optimizer_type", req.optimizer_type,
        "--network_dim", str(req.network_dim),
        "--network_alpha", str(req.network_alpha),
        "--max_train_steps", str(req.max_train_steps),
        "--save_every_n_steps", str(req.save_every_n_steps),
        "--resolution", str(req.resolution),
        "--seed", "42",
        "--loss_type", "l2",
        "--sdpa",
    ]
    
    if req.fp8_base:
        cmd.append("--fp8_base")
    if req.gradient_checkpointing:
        cmd.append("--gradient_checkpointing")
    if req.cache_latents:
        cmd.extend(["--cache_latents", "--cache_latents_to_disk"])
    if req.cache_text_encoder_outputs:
        cmd.extend(["--cache_text_encoder_outputs", "--cache_text_encoder_outputs_to_disk"])
    
    logger.info(f"[{training_id}] Starting training: {' '.join(cmd[:10])}...")
    
    env = os.environ.copy()
    env["HF_HUB_OFFLINE"] = "1"
    env["TRANSFORMERS_OFFLINE"] = "1"
    env["PYTORCH_CUDA_ALLOC_CONF"] = "expandable_segments:True"
    env["GIT_CONFIG_GLOBAL"] = "/tmp/gitconfig"
    
    # Ensure git safe.directory
    os.makedirs("/tmp", exist_ok=True)
    with open("/tmp/gitconfig", "w") as f:
        f.write("[safe]\n\tdirectory = *\n")
    
    try:
        process = subprocess.Popen(
            cmd,
            stdout=open(log_file, "w"),
            stderr=subprocess.STDOUT,
            env=env,
            cwd=SD_SCRIPTS_DIR,
            preexec_fn=os.setsid,
        )
        
        with _lock:
            _trainings[training_id]["pid"] = process.pid
        
        # Wait for completion
        retcode = process.wait()
        
        elapsed = time.time() - _trainings[training_id].get("started_at", time.time())
        
        with _lock:
            if retcode == 0:
                _trainings[training_id]["status"] = "completed"
                # Find output file
                output_file = os.path.join(output_dir, f"{req.output_name}.safetensors")
                if not os.path.exists(output_file):
                    # Look for step checkpoint
                    checkpoints = sorted(Path(output_dir).glob(f"{req.output_name}-step*.safetensors"))
                    if checkpoints:
                        output_file = str(checkpoints[-1])
                _trainings[training_id]["output_file"] = output_file if os.path.exists(output_file) else None
            else:
                _trainings[training_id]["status"] = "failed"
                _trainings[training_id]["error"] = f"Process exited with code {retcode}"
            _trainings[training_id]["finished_at"] = time.time()
            _trainings[training_id]["elapsed_seconds"] = elapsed
    
    except Exception as e:
        with _lock:
            _trainings[training_id]["status"] = "failed"
            _trainings[training_id]["error"] = str(e)
            _trainings[training_id]["finished_at"] = time.time()
    
    # Update final log parse
    log_info = parse_training_log(log_file)
    with _lock:
        _trainings[training_id].update(log_info)


@app.get("/health")
async def health():
    return {"status": "ok", "sd_scripts": SD_SCRIPTS_DIR, "data_dir": DATA_DIR}


@app.get("/models")
async def list_models():
    """List available FLUX models for training."""
    return auto_detect_models()


@app.post("/train", response_model=TrainResponse)
async def start_training(req: TrainRequest, bg: BackgroundTasks):
    """Start a new LoRA training job."""
    training_id = f"lora-{uuid.uuid4().hex[:8]}"
    
    # Validate dataset
    if not os.path.exists(req.dataset_dir):
        raise HTTPException(400, f"Dataset directory not found: {req.dataset_dir}")
    
    # Generate dataset config
    try:
        config_content = build_dataset_config(req.dataset_dir, req.resolution, req.num_repeats)
    except ValueError as e:
        raise HTTPException(400, str(e))
    
    config_path = os.path.join(DATASETS_DIR, f"{training_id}_dataset.toml")
    with open(config_path, "w") as f:
        f.write(config_content)
    
    # Setup output dir and log
    output_dir = os.path.join(OUTPUT_DIR, training_id)
    Path(output_dir).mkdir(parents=True, exist_ok=True)
    log_file = os.path.join(TRAIN_LOG_DIR, f"{training_id}.log")
    
    # Register training
    with _lock:
        _trainings[training_id] = {
            "status": "queued",
            "config": req.dict(),
            "log_file": log_file,
            "output_dir": output_dir,
            "started_at": None,
            "finished_at": None,
        }
    
    # Start background training
    bg.add_task(run_training, training_id, req, config_path, log_file, output_dir)
    
    return TrainResponse(
        training_id=training_id,
        status="queued",
        log_file=log_file,
        output_dir=output_dir,
    )


@app.get("/status/{training_id}", response_model=StatusResponse)
async def get_status(training_id: str):
    """Get training status."""
    with _lock:
        info = _trainings.get(training_id)
    if not info:
        raise HTTPException(404, f"Training {training_id} not found")
    
    # Update progress from log if running
    if info.get("status") == "running" and os.path.exists(info.get("log_file", "")):
        log_info = parse_training_log(info["log_file"])
        info.update(log_info)
    
    elapsed = None
    if info.get("started_at"):
        end = info.get("finished_at", time.time())
        elapsed = end - info["started_at"]
    
    return StatusResponse(
        training_id=training_id,
        status=info["status"],
        progress=info.get("progress"),
        current_step=info.get("current_step"),
        total_steps=info.get("total_steps"),
        loss=info.get("loss"),
        output_file=info.get("output_file"),
        error=info.get("error"),
        started_at=info.get("started_at"),
        finished_at=info.get("finished_at"),
        elapsed_seconds=elapsed,
    )


@app.post("/cancel/{training_id}")
async def cancel_training(training_id: str):
    """Cancel a running training job."""
    with _lock:
        info = _trainings.get(training_id)
    if not info:
        raise HTTPException(404, f"Training {training_id} not found")
    
    if info.get("status") not in ("running", "queued"):
        return {"status": "already_finished", "training_id": training_id}
    
    pid = info.get("pid")
    if pid:
        try:
            os.killpg(os.getpgid(pid), signal.SIGTERM)
        except ProcessLookupError:
            pass
    
    with _lock:
        info["status"] = "cancelled"
        info["finished_at"] = time.time()
    
    return {"status": "cancelled", "training_id": training_id}


@app.get("/list")
async def list_trainings():
    """List all training jobs."""
    with _lock:
        return {"trainings": [
            {"training_id": tid, "status": t["status"], **{k: v for k, v in t.items() if k in ("output_file", "started_at", "finished_at", "loss", "progress")}}
            for tid, t in _trainings.items()
        ]}


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8070)
    parser.add_argument("--host", default="0.0.0.0")
    args = parser.parse_args()
    
    logger.info(f"Starting KAIS LoRA Trainer on {args.host}:{args.port}")
    logger.info(f"  SD_SCRIPTS_DIR: {SD_SCRIPTS_DIR}")
    logger.info(f"  DATA_DIR: {DATA_DIR}")
    logger.info(f"  MODELS_DIR: {MODELS_DIR}")
    
    import uvicorn
    uvicorn.run(app, host=args.host, port=args.port)
