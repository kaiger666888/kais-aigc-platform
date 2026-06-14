#!/usr/bin/env python3
"""Unified TTS Server — three tracks, one process, lazy-load on demand.

Runs inside gold-team container (GPU 1 = RTX 3090).

Three tracks (shared GPU, loaded on-demand):
  - gpt_sovits:  中文轨道 (角色/IP克隆, ~4 GB VRAM)
  - chatterbox:  英文轨道 (Chatterbox-Turbo, ~2 GB VRAM)
  - cosyvoice:   双语轨道 (CosyVoice-300M, ~2.5 GB VRAM)

Language routing:
  - Pure CJK               → gpt_sovits
  - Pure Latin             → chatterbox
  - Mixed CJK + Latin      → cosyvoice
  - Explicit backend param  → override

Lifecycle:
  - Server starts with ZERO models loaded (no VRAM used)
  - First TTS request for a track → load model (~3-8s cold start)
  - Subsequent requests → warm inference (~0.5-2s)
  - No requests for IDLE_TIMEOUT → unload track → VRAM freed
  - Multiple tracks can be loaded simultaneously on 3090 (24 GB)

API:
  POST /tts          — Synchronous TTS (returns WAV file directly)
  POST /tts/batch    — Batch TTS (multiple texts, returns JSON with paths)
  GET  /health       — Health + per-track status
  GET  /tracks       — Track status detail
  POST /tracks/load  — Pre-warm a track (load model before requests)
  POST /tracks/unload — Force unload a track

Usage:
  python scripts/tts_unified_server.py [--port 9880] [--idle-timeout 300]
"""
from __future__ import annotations

import argparse
import asyncio
import gc
import logging
import os
import re
import sys
import os

# ── Disable numba JIT to avoid cache issues in container ────────────────
# MUST be done before any import that touches librosa
import numba
numba.config.DISABLE_JIT = True

import tempfile
import time
import wave as wave_mod
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Dict, Optional

import numpy as np
import torch

# ── Paths ───────────────────────────────────────────────────────────────────
COSYVOICE_ROOT = os.environ.get("COSYVOICE_ROOT", os.path.expanduser("~/CosyVoice"))
GPTSOVITS_ROOT = os.environ.get("GPTSOVITS_ROOT", os.path.expanduser("~/GPT-SoVITS"))
CHATTERBOX_ROOT = os.environ.get("CHATTERBOX_ROOT", os.path.expanduser("~/chatterbox"))
OUTPUT_DIR = os.environ.get("KAIS_OUTPUT_ROOT", "/mnt/agents/output")

# ── Language detection ───────────────────────────────────────────────────────
_CJK_RE = re.compile(r"[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]")
_LATIN_RE = re.compile(r"[a-zA-Z]")


def detect_language(text: str) -> str:
    has_cjk = bool(_CJK_RE.search(text))
    has_latin = bool(_LATIN_RE.search(text))
    if has_cjk and not has_latin:
        return "zh"
    if has_latin and not has_cjk:
        return "en"
    return "auto"


# ═══════════════════════════════════════════════════════════════════════════
# Track wrappers — lazy-load, auto-unload
# ═══════════════════════════════════════════════════════════════════════════

class BaseTrack:
    """Base class for a TTS track — manages model lifecycle."""

    name: str = "base"
    language: str = "auto"
    vram_mb: int = 0

    def __init__(self, idle_timeout: float = 300.0):
        self._model = None
        self._loaded = False
        self._loading = False
        self._last_used: float = 0.0
        self._idle_timeout = idle_timeout
        self._lock = asyncio.Lock()

    @property
    def is_loaded(self) -> bool:
        return self._loaded

    @property
    def last_used(self) -> float:
        return self._last_used

    async def ensure_loaded(self) -> None:
        """Load model if not already loaded (with dedup lock)."""
        async with self._lock:
            if self._loaded:
                self._last_used = time.monotonic()
                return
            if self._loading:
                # Wait for other caller to finish loading
                while self._loading:
                    await asyncio.sleep(0.5)
                return
            self._loading = True
            try:
                await asyncio.get_event_loop().run_in_executor(None, self._load_model)
                self._loaded = True
                self._last_used = time.monotonic()
                logging.info("Track '%s' loaded successfully", self.name)
            except Exception as e:
                logging.error("Track '%s' failed to load: %s", self.name, e)
                raise
            finally:
                self._loading = False

    def _load_model(self) -> None:
        """Override in subclass — loads model to GPU."""
        raise NotImplementedError

    async def synthesize(self, text: str, voice: str = "default",
                         speed: float = 1.0, reference_audio: str = "",
                         output_path: str = "") -> dict:
        """Synthesize speech. Must be called after ensure_loaded."""
        raise NotImplementedError

    async def unload(self) -> None:
        """Unload model, free VRAM."""
        async with self._lock:
            if not self._loaded:
                return
            await asyncio.get_event_loop().run_in_executor(None, self._unload_model)

    def _unload_model(self) -> None:
        """Override in subclass — frees GPU memory."""
        self._model = None
        self._loaded = False
        torch.cuda.empty_cache()
        gc.collect()
        logging.info("Track '%s' unloaded, VRAM freed", self.name)

    def is_idle(self) -> bool:
        return self._loaded and (time.monotonic() - self._last_used > self._idle_timeout)

    def status(self) -> dict:
        return {
            "name": self.name,
            "language": self.language,
            "loaded": self._loaded,
            "loading": self._loading,
            "vram_mb": self.vram_mb,
            "last_used": self._last_used,
            "idle_seconds": time.monotonic() - self._last_used if self._loaded else None,
        }


class CosyVoiceTrack(BaseTrack):
    """Track 3: CosyVoice-300M — Chinese + English + mixed."""

    name = "cosyvoice"
    language = "auto"
    vram_mb = 2500

    def _load_model(self) -> None:
        sys.path.insert(0, COSYVOICE_ROOT)
        sys.path.insert(0, os.path.join(COSYVOICE_ROOT, "third_party", "Matcha-TTS"))
        from cosyvoice.cli.cosyvoice import AutoModel

        model_dir = os.path.join(COSYVOICE_ROOT, "pretrained_models", "CosyVoice-300M")
        self._model = AutoModel(model_dir=model_dir)
        # AutoModel already loads model and calls .to(device) internally
        logging.info("CosyVoice-300M loaded (auto-detected model type)")

    def _unload_model(self) -> None:
        if self._model is not None:
            del self._model
            self._model = None
        self._loaded = False
        torch.cuda.empty_cache()
        gc.collect()
        logging.info("CosyVoice track unloaded")

    async def synthesize(self, text: str, voice: str = "default",
                         speed: float = 1.0, reference_audio: str = "",
                         output_path: str = "") -> dict:
        await self.ensure_loaded()
        loop = asyncio.get_event_loop()

        def _synth():
            nonlocal output_path
            try:
                if reference_audio and os.path.isfile(reference_audio):
                    # Zero-shot voice cloning
                    result = self._model.inference_zero_shot(
                        text, "", reference_audio, stream=False, speed=speed,
                    )
                else:
                    # Check if preset speakers exist
                    spks = self._model.list_available_spks()
                    if spks:
                        # SFT mode with preset speaker
                        spk_id = voice if voice in spks else spks[0]
                        result = self._model.inference_sft(
                            text, spk_id, stream=False, speed=speed,
                        )
                    else:
                        # No preset speakers (CosyVoice-300M has empty spk2info)
                        # Use cross_lingual with a 3s sine reference
                        import soundfile as sf
                        dummy_sr = 22050
                        t = np.arange(0, 3.0, 1.0 / dummy_sr)
                        dummy_wav = np.sin(2 * np.pi * 440 * t).astype(np.float32) * 0.3
                        dummy_path = os.path.join(OUTPUT_DIR, "_dummy_ref.wav")
                        sf.write(dummy_path, dummy_wav, dummy_sr)
                        result = self._model.inference_cross_lingual(
                            text, dummy_path, stream=False, speed=speed,
                        )
                # Result is a generator yielding model_output dicts
                import soundfile as sf
                all_audio = []
                sr = self._model.sample_rate
                for model_output in result:
                    tts_speech = model_output['tts_speech']
                    if hasattr(tts_speech, 'cpu'):
                        tts_speech = tts_speech.cpu().numpy()
                    if tts_speech.ndim == 3:
                        tts_speech = tts_speech.squeeze(0)
                    if tts_speech.ndim == 1:
                        tts_speech = tts_speech.unsqueeze(0)
                    all_audio.append(tts_speech)
                if not all_audio:
                    return {"error": "No audio generated"}
                audio_np = np.concatenate(all_audio, axis=1).squeeze(0) if len(all_audio) > 1 else all_audio[0].squeeze(0)
                if not output_path:
                    output_path = os.path.join(OUTPUT_DIR, f"tts_{int(time.time())}.wav")
                os.makedirs(os.path.dirname(output_path), exist_ok=True)
                sf.write(output_path, audio_np, sr)
                duration = len(audio_np) / sr
                return {
                    "output_path": output_path,
                    "duration_sec": round(duration, 2),
                    "sample_rate": sr,
                    "backend": "cosyvoice",
                }
            except Exception as e:
                logging.error("CosyVoice synthesis error: %s", e)
                raise

        return await loop.run_in_executor(None, _synth)


class GPTSoVITSTrack(BaseTrack):
    """Track 1: GPT-SoVITS — Chinese voice cloning.

    Uses GPT-SoVITS api_v2.py as an independent subprocess.
    This avoids the massive import-time side effects in inference_webui.py.
    """

    name = "gpt_sovits"
    language = "zh"
    vram_mb = 4000
    _api_port: int = 9988  # Separate port from unified server
    _process: Optional[asyncio.subprocess.Process] = None

    def _load_model(self) -> None:
        """Start GPT-SoVITS api_v2.py as subprocess."""
        import subprocess
        script = os.path.join(GPTSOVITS_ROOT, "api_v2.py")
        config = os.path.join(GPTSOVITS_ROOT, "GPT_SoVITS", "configs", "tts_infer.yaml")

        # Use venv python if available (has librosa and other deps)
        venv_python = os.path.join(GPTSOVITS_ROOT, ".venv", "bin", "python3")
        python_bin = venv_python if os.path.isfile(venv_python) else "python3"
        logging.info("Using python: %s", python_bin)
        self._process = subprocess.Popen(
            [python_bin, script, "-a", "127.0.0.1", "-p", str(self._api_port), "-c", config],
            cwd=GPTSOVITS_ROOT,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env={**os.environ, "NUMBA_DISABLE_JIT": "1"},
        )
        # Wait for server to be ready (up to 120s)
        import urllib.request
        import urllib.error
        for i in range(240):
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{self._api_port}/", timeout=1)
                logging.info("GPT-SoVITS api_v2 started on port %d", self._api_port)
                return
            except (urllib.error.URLError, ConnectionRefusedError, OSError):
                time.sleep(0.5)
                # Check if process crashed
                if self._process.poll() is not None:
                    stderr = self._process.stderr.read().decode(errors='replace')
                    raise RuntimeError(f"GPT-SoVITS api_v2 crashed: {stderr[-500:]}")
        raise RuntimeError("GPT-SoVITS api_v2 failed to start within 120s")

    def _unload_model(self) -> None:
        if self._process and self._process.poll() is None:
            self._process.terminate()
            try:
                self._process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self._process.kill()
            logging.info("GPT-SoVITS api_v2 process stopped")
        self._process = None
        self._loaded = False
        torch.cuda.empty_cache()
        gc.collect()
        logging.info("GPT-SoVITS track unloaded")

    async def synthesize(self, text: str, voice: str = "default",
                         speed: float = 1.0, reference_audio: str = "",
                         output_path: str = "") -> dict:
        await self.ensure_loaded()
        loop = asyncio.get_event_loop()

        def _synth():
            nonlocal output_path
            import urllib.request
            import urllib.error
            import json as _json
            import soundfile as sf

            # GPT-SoVITS requires reference audio
            ref_path = reference_audio
            if not ref_path or not os.path.isfile(ref_path):
                # Generate dummy reference
                dummy_sr = 32000
                t = np.arange(0, 3.0, 1.0 / dummy_sr)
                dummy_wav = np.sin(2 * np.pi * 440 * t).astype(np.float32) * 0.3
                ref_path = os.path.join(OUTPUT_DIR, "_gpt_sovits_ref.wav")
                sf.write(ref_path, dummy_wav, dummy_sr)

            payload = _json.dumps({
                "text": text,
                "text_lang": "zh",
                "ref_audio_path": ref_path,
                "prompt_text": "",
                "prompt_lang": "zh",
                "top_k": 15,
                "top_p": 1.0,
                "temperature": 1.0,
                "speed_factor": speed,
                "media_type": "wav",
            }).encode()

            req = urllib.request.Request(
                f"http://127.0.0.1:{self._api_port}/tts",
                data=payload,
                headers={"Content-Type": "application/json"},
            )
            resp = urllib.request.urlopen(req, timeout=120)
            audio_bytes = resp.read()

            if not output_path:
                output_path = os.path.join(OUTPUT_DIR, f"tts_{int(time.time())}.wav")
            os.makedirs(os.path.dirname(output_path), exist_ok=True)
            with open(output_path, "wb") as f:
                f.write(audio_bytes)

            # Get duration from file
            data, sr = sf.read(output_path)
            duration = len(data) / sr

            return {
                "output_path": output_path,
                "duration_sec": round(duration, 2),
                "sample_rate": sr,
                "backend": "gpt_sovits",
            }

        return await loop.run_in_executor(None, _synth)


class ChatterboxTrack(BaseTrack):
    """Track 2: Chatterbox-Turbo — English TTS.

    Uses chatterbox CLI via subprocess to avoid import-time issues.
    """

    name = "chatterbox"
    language = "en"
    vram_mb = 2000

    def _load_model(self) -> None:
        """Verify chatterbox is importable."""
        chatterbox_src = os.path.join(CHATTERBOX_ROOT, "src")
        if os.path.isdir(chatterbox_src):
            sys.path.insert(0, CHATTERBOX_ROOT)
            sys.path.insert(0, chatterbox_src)
        try:
            from chatterbox.tts_turbo import ChatterboxTurboTTS
            logging.info("Chatterbox-Turbo importable")
        except ImportError as e:
            logging.warning("Chatterbox import failed: %s (track will fallback)", e)

    def _unload_model(self) -> None:
        self._model = None
        self._loaded = False
        torch.cuda.empty_cache()
        gc.collect()
        logging.info("Chatterbox track unloaded")

    async def synthesize(self, text: str, voice: str = "default",
                         speed: float = 1.0, reference_audio: str = "",
                         output_path: str = "") -> dict:
        await self.ensure_loaded()
        loop = asyncio.get_event_loop()

        def _synth():
            nonlocal output_path
            from chatterbox.tts_turbo import ChatterboxTurboTTS

            # Check HuggingFace cache for model files
            cache_dir = os.path.expanduser("~/.cache/huggingface/hub")
            repo_cache = os.path.join(cache_dir, "models--ResembleAI--chatterbox-turbo")
            snapshots_dir = os.path.join(repo_cache, "snapshots")

            local_path = None
            if os.path.isdir(snapshots_dir):
                for snap in os.listdir(snapshots_dir):
                    snap_dir = os.path.join(snapshots_dir, snap)
                    if os.path.isdir(snap_dir) and os.path.exists(os.path.join(snap_dir, "t3_turbo_v1.safetensors")):
                        local_path = snap_dir
                        break

            if local_path:
                model = ChatterboxTurboTTS.from_local(local_path, "cuda")
            else:
                model = ChatterboxTurboTTS.from_pretrained("cuda")

            if reference_audio and os.path.isfile(reference_audio):
                model.prepare_conditionals(reference_audio)

            wav_tensor = model.generate(
                text=text,
                temperature=0.8,
                top_k=1000,
                top_p=0.95,
            )

            audio_np = wav_tensor.squeeze(0).numpy()
            sr = model.sr

            if not output_path:
                output_path = os.path.join(OUTPUT_DIR, f"tts_{int(time.time())}.wav")
            os.makedirs(os.path.dirname(output_path), exist_ok=True)

            import soundfile as sf
            sf.write(output_path, audio_np, sr)
            duration = len(audio_np) / sr

            # Free model immediately (no caching between requests)
            del model
            torch.cuda.empty_cache()

            return {
                "output_path": output_path,
                "duration_sec": round(duration, 2),
                "sample_rate": sr,
                "backend": "chatterbox",
            }

        return await loop.run_in_executor(None, _synth)


# ═══════════════════════════════════════════════════════════════════════════
# Track Manager — orchestrates all three tracks
# ═══════════════════════════════════════════════════════════════════════════

class TrackManager:
    """Manages three TTS tracks with lazy loading and idle auto-unload."""

    def __init__(self, idle_timeout: float = 300.0):
        self._tracks: Dict[str, BaseTrack] = {
            "gpt_sovits": GPTSoVITSTrack(idle_timeout),
            "chatterbox": ChatterboxTrack(idle_timeout),
            "cosyvoice": CosyVoiceTrack(idle_timeout),
        }
        self._idle_timeout = idle_timeout
        self._reaper_task: Optional[asyncio.Task] = None

    async def start(self) -> None:
        """Start the idle reaper background task."""
        self._reaper_task = asyncio.create_task(self._idle_reaper())
        logging.info("TrackManager started (idle_timeout=%.0fs)", self._idle_timeout)

    async def stop(self) -> None:
        """Unload all tracks and stop reaper."""
        if self._reaper_task:
            self._reaper_task.cancel()
            try:
                await self._reaper_task
            except asyncio.CancelledError:
                pass
        for track in self._tracks.values():
            await track.unload()
        logging.info("TrackManager stopped, all tracks unloaded")

    def select_track(self, text: str, backend: str = "auto",
                     language: str = "auto") -> str:
        """Select the best track for the given text."""
        if backend != "auto" and backend in self._tracks:
            return backend

        if language == "auto":
            language = detect_language(text)

        lang_map = {"zh": "gpt_sovits", "en": "chatterbox", "auto": "cosyvoice"}
        return lang_map.get(language, "cosyvoice")

    async def synthesize(self, text: str, voice: str = "default",
                         speed: float = 1.0, backend: str = "auto",
                         language: str = "auto", reference_audio: str = "",
                         output_path: str = "") -> dict:
        """Route to the correct track and synthesize."""
        track_id = self.select_track(text, backend, language)
        track = self._tracks[track_id]

        try:
            result = await track.synthesize(
                text=text, voice=voice, speed=speed,
                reference_audio=reference_audio, output_path=output_path,
            )
            result["track"] = track_id
            return result
        except Exception as e:
            # Fallback to cosyvoice if primary fails
            if track_id != "cosyvoice":
                logging.warning("Track '%s' failed (%s), falling back to cosyvoice", track_id, e)
                try:
                    result = await self._tracks["cosyvoice"].synthesize(
                        text=text, voice=voice, speed=speed,
                        reference_audio=reference_audio, output_path=output_path,
                    )
                    result["track"] = "cosyvoice"
                    result["fallback_from"] = track_id
                    return result
                except Exception as e2:
                    return {"error": f"All tracks failed: {e}, cosyvoice: {e2}"}
            return {"error": str(e)}

    async def preload(self, track_id: str) -> dict:
        """Pre-warm a track."""
        track = self._tracks.get(track_id)
        if not track:
            return {"error": f"Unknown track: {track_id}"}
        try:
            await track.ensure_loaded()
            return {"status": "loaded", "track": track_id}
        except Exception as e:
            return {"error": str(e), "track": track_id}

    async def unload_track(self, track_id: str) -> dict:
        """Force unload a track."""
        track = self._tracks.get(track_id)
        if not track:
            return {"error": f"Unknown track: {track_id}"}
        await track.unload()
        return {"status": "unloaded", "track": track_id}

    def get_status(self) -> dict:
        return {
            "idle_timeout": self._idle_timeout,
            "tracks": {tid: t.status() for tid, t in self._tracks.items()},
            "total_vram_mb": sum(t.vram_mb for t in self._tracks.values() if t.is_loaded),
            "available_vram_mb": sum(t.vram_mb for t in self._tracks.values()),
        }

    async def _idle_reaper(self) -> None:
        """Background task: unload idle tracks."""
        while True:
            try:
                await asyncio.sleep(30)  # Check every 30s
                for tid, track in self._tracks.items():
                    if track.is_idle():
                        logging.info("Track '%s' idle > %.0fs, unloading", tid, self._idle_timeout)
                        await track.unload()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logging.error("Idle reaper error: %s", e)


# ═══════════════════════════════════════════════════════════════════════════
# FastAPI Server
# ═══════════════════════════════════════════════════════════════════════════

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("tts-unified")

_manager: TrackManager = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _manager
    _manager = TrackManager(args.idle_timeout)
    await _manager.start()
    logger.info("Unified TTS server started on port %d", args.port)
    yield
    await _manager.stop()
    logger.info("Unified TTS server stopped")


app = FastAPI(
    title="Unified TTS Server (Triple Track)",
    version="2.0",
    lifespan=lifespan,
)


class TTSRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=5000)
    voice: str = Field("default", description="Voice name or preset")
    speed: float = Field(1.0, ge=0.3, le=3.0)
    backend: str = Field("auto", description="auto|gpt_sovits|chatterbox|cosyvoice")
    language: str = Field("auto", description="auto|zh|en")
    reference_audio: str = Field("", description="Path to reference audio for cloning")
    output_path: str = Field("", description="Output WAV file path (auto-generated if empty)")


class BatchTTSRequest(BaseModel):
    items: list[TTSRequest] = Field(..., min_length=1, max_length=100)


@app.post("/tts")
async def tts(req: TTSRequest):
    """Synchronous TTS — returns JSON with output path."""
    try:
        result = await _manager.synthesize(
            text=req.text,
            voice=req.voice,
            speed=req.speed,
            backend=req.backend,
            language=req.language,
            reference_audio=req.reference_audio,
            output_path=req.output_path,
        )
        if "error" in result:
            raise HTTPException(500, result["error"])
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error("TTS error: %s", e, exc_info=True)
        raise HTTPException(500, str(e))


@app.post("/tts/batch")
async def tts_batch(req: BatchTTSRequest):
    """Batch TTS — multiple texts, returns JSON array."""
    results = []
    for item in req.items:
        try:
            result = await _manager.synthesize(
                text=item.text, voice=item.voice, speed=item.speed,
                backend=item.backend, language=item.language,
                reference_audio=item.reference_audio, output_path=item.output_path,
            )
            results.append(result)
        except Exception as e:
            results.append({"error": str(e), "text": item.text[:50]})
    return {"results": results, "total": len(results),
            "success": sum(1 for r in results if "error" not in r)}


@app.post("/tts/file")
async def tts_file(req: TTSRequest):
    """TTS — returns WAV file directly."""
    try:
        result = await _manager.synthesize(
            text=req.text, voice=req.voice, speed=req.speed,
            backend=req.backend, language=req.language,
            reference_audio=req.reference_audio, output_path=req.output_path,
        )
        if "error" in result:
            raise HTTPException(500, result["error"])
        return FileResponse(
            result["output_path"],
            media_type="audio/wav",
            filename=os.path.basename(result["output_path"]),
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/health")
async def health():
    """Health check with per-track status."""
    if _manager is None:
        return JSONResponse({"status": "offline"}, status_code=503)
    status = _manager.get_status()
    any_loaded = any(t["loaded"] for t in status["tracks"].values())
    return {
        "status": "healthy",
        "mode": "unified (lazy-load)",
        "any_track_loaded": any_loaded,
        **status,
    }


@app.get("/tracks")
async def tracks():
    """Detailed track status."""
    return _manager.get_status() if _manager else {"error": "not initialized"}


@app.post("/tracks/load")
async def load_track(track_id: str):
    """Pre-warm a track (load model before first request)."""
    result = await _manager.preload(track_id)
    if "error" in result:
        raise HTTPException(400, result["error"])
    return result


@app.post("/tracks/unload")
async def unload_track(track_id: str):
    """Force unload a track to free VRAM."""
    result = await _manager.unload_track(track_id)
    return result


# ── CLI ────────────────────────────────────────────────────────────────────

def parse_args():
    p = argparse.ArgumentParser(description="Unified TTS Server (Triple Track)")
    p.add_argument("--port", type=int, default=int(os.environ.get("TTS_PORT", "9880")),
                    help="Server port (default: 9880)")
    p.add_argument("--host", type=str, default="0.0.0.0",
                    help="Bind host (default: 0.0.0.0)")
    p.add_argument("--idle-timeout", type=float,
                    default=float(os.environ.get("TTS_IDLE_TIMEOUT", "300")),
                    help="Seconds before idle track unloads (default: 300)")
    p.add_argument("--log-level", type=str, default="INFO",
                    choices=["DEBUG", "INFO", "WARNING", "ERROR"])
    return p.parse_args()


if __name__ == "__main__":
    args = parse_args()
    logging.getLogger().setLevel(getattr(logging, args.log_level))

    import uvicorn
    uvicorn.run(app, host=args.host, port=args.port, log_level=args.log_level.lower())
