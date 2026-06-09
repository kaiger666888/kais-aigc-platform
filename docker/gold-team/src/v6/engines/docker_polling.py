"""ACE-Step polling engine — async submit + poll for music generation tasks.

Supports three parameter profiles (see workflows/acestep_profiles.json):
  - xl-sft-4blm:    High quality (XL-SFT + 0.6B TE + 4B TE2, 50 steps, ~2min)
  - xl-sft-1.7b-4blm: Max quality (XL-SFT + 1.7B TE1 + 4B TE2, 50 steps, ~3min)
  - turbo-4blm:      Quick prototype (Turbo + 0.6B TE + 4B TE2, 8 steps, ~40s)
"""
from __future__ import annotations

import json as _json
import logging
from pathlib import Path
from typing import Any

import httpx

from src.v6.config.engine_schema import EngineConfig
from src.v6.docker.container_manager import ContainerManager
from src.v6.engines.docker_base import DockerAPIEngine

logger = logging.getLogger(__name__)

# Map V6 task types to ACE-Step API task types
_TASK_TYPE_MAP = {
    "music_generation": "text2music",
    "music_cover": "cover",
    "music_remix": "text2music",
    "music_repaint": "repaint",
    "music_extract": "extract",
    "music_lego": "lego",
    "music_complete": "complete",
}

# Default parameter profiles for each ACE-Step model combination
# Sourced from workflows/acestep_profiles.json, last updated 2026-06-10
_ACESTEP_PROFILES = {
    "xl-sft-4blm": {
        "models": {
            "diffusion_model": "acestep_v1.5_xl_sft.safetensors",
            "text_encoder_1": "qwen_0.6b_ace15.safetensors",
            "text_encoder_2": "qwen_4b_ace15.safetensors",
            "vae_name": "ace_1.5_vae.safetensors",
        },
        "generation": {
            "steps": 50, "cfg": 7.0, "sampler_name": "euler",
            "scheduler": "normal", "denoise": 1.0, "infer_method": "ode",
            "guidance_mode": "apg", "use_tiled_vae": True, "shift": 3.0,
        },
        "apg": {"apg_eta": 0.0, "apg_momentum": -0.75, "apg_norm_threshold": 2.5},
        "lm": {"lm_cfg_scale": 2.0, "lm_temperature": 0.85, "lm_top_p": 0.9,
               "lm_top_k": 0, "lm_min_p": 0.0},
        "defaults": {
            "duration": 120.0, "bpm": 72, "timesignature": "4",
            "language": "en", "keyscale": "D minor",
            "generate_audio_codes": True, "instrumental": False,
        },
        "tag_adapter": {
            "adaptation_strength": "aggressive",
            "keep_unknown_tags": True, "add_sft_bias_tags": True,
        },
    },
    "turbo-4blm": {
        "models": {
            "diffusion_model": "acestep_v1.5_turbo.safetensors",
            "text_encoder_1": "qwen_0.6b_ace15.safetensors",
            "text_encoder_2": "qwen_4b_ace15.safetensors",
            "vae_name": "ace_1.5_vae.safetensors",
        },
        "generation": {
            "steps": 8, "cfg": 1.0, "sampler_name": "euler",
            "scheduler": "normal", "denoise": 1.0, "infer_method": "ode",
            "guidance_mode": "apg", "use_tiled_vae": True, "shift": 3.0,
        },
        "apg": {"apg_eta": 0.0, "apg_momentum": -0.75, "apg_norm_threshold": 2.5},
        "lm": {"lm_cfg_scale": 2.0, "lm_temperature": 0.85, "lm_top_p": 0.9,
               "lm_top_k": 0, "lm_min_p": 0.0},
        "defaults": {
            "duration": 30.0, "bpm": 80, "timesignature": "4",
            "language": "en", "keyscale": "A minor",
            "generate_audio_codes": True, "instrumental": False,
        },
        "tag_adapter": {
            "adaptation_strength": "balanced",
            "keep_unknown_tags": True, "add_sft_bias_tags": True,
        },
    },
}

# Profile name mapping from API-friendly names
_PROFILE_ALIASES = {
    "quality": "xl-sft-4blm",
    "max_quality": "xl-sft-1.7b-4blm",
    "fast": "turbo-4blm",
    "prototype": "turbo-4blm",
}


class DockerPollingAPIEngine(DockerAPIEngine):
    """Engine for ACE-Step: submit task, poll for async completion, download results.

    Supports parameter profiles: xl-sft-4blm, xl-sft-1.7b-4blm, turbo-4blm.
    Use params.extra.acestep.profile to select, or "quality" / "max_quality" / "fast" aliases.
    """

    def __init__(self, config: EngineConfig, container_mgr: ContainerManager) -> None:
        super().__init__(config, container_mgr)
        self._pending_job_id: str | None = None

    @staticmethod
    def resolve_profile(profile_name: str) -> dict[str, Any]:
        """Resolve a profile name (or alias) to its full parameter set."""
        resolved = _PROFILE_ALIASES.get(profile_name, profile_name)
        if resolved not in _ACESTEP_PROFILES:
            valid = sorted(_ACESTEP_PROFILES.keys())
            raise ValueError(
                f"Unknown ACE-Step profile '{profile_name}'. "
                f"Valid: {valid}, aliases: quality/max_quality/fast"
            )
        return _ACESTEP_PROFILES[resolved]

    @staticmethod
    def list_profiles() -> dict[str, str]:
        """Return {name: description} for all available profiles."""
        return {name: p["models"]["diffusion_model"] for name, p in _ACESTEP_PROFILES.items()}

    async def submit(self, workflow: dict[str, Any], params: dict[str, Any] | None = None) -> str:
        """Submit to /release_task and return the real job ID."""
        params = params or {}
        task_id = workflow.get("task_id", "unknown")
        task_type = workflow.get("task_type", "music_generation")
        task_params = workflow.get("params", {})
        workspace = Path(workflow.get("workspace", "/workspace"))

        # Ensure container running
        owned = await self._ensure_container_running(task_id)

        try:
            payload = self._build_acestep_payload(task_id, task_type, task_params)
            url = f"{self._base_url}/release_task"

            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.post(url, json=payload)
                resp.raise_for_status()
                data = resp.json()

            if data.get("code") != 200:
                raise RuntimeError(f"ACE-Step submit failed: {data.get('error', 'unknown')}")

            job_id = data["data"]["task_id"]
            self._pending_job_id = job_id
            logger.info("[%s] submitted job %s (type=%s)", self._config.name, job_id, task_type)

            # Now poll until complete
            result = await self._poll_until_done(job_id)

            # Download audio files
            if result.get("success"):
                self._download_results(task_id, result, workspace)

            return job_id

        finally:
            if owned:
                await self._stop_and_cleanup()

    async def poll(self, engine_job_id: str) -> dict[str, Any]:
        """Poll /query_result for job status."""
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{self._base_url}/query_result",
                json={"task_id_list": [engine_job_id]},
            )
            resp.raise_for_status()
            data = resp.json()

        jobs = data.get("data", [])
        if not jobs:
            return {"status": "running", "progress": 0.0}

        job = jobs[0]
        status = job.get("status")

        if status == 1:
            return {"status": "completed", "progress": 100.0}
        elif status == 2:
            return {"status": "failed", "error": "ACE-Step job failed"}
        return {"status": "running", "progress": 50.0}

    def _build_acestep_payload(
        self, task_id: str, task_type: str, params: dict[str, Any],
    ) -> dict[str, Any]:
        """Build ACE-Step specific request payload.

        If params.extra.acestep.profile is set, merge the profile defaults
        before applying explicit overrides. Explicit params always win.
        """
        ace_params = params.get("extra", {}).get("acestep", {})
        p = {**params, **ace_params}
        p.pop("extra", None)

        # Resolve and merge profile if specified
        profile_name = p.pop("profile", None)
        if profile_name:
            profile = self.resolve_profile(profile_name)
            gen = profile["generation"]
            lm = profile["lm"]
            apg = profile["apg"]
            defs = profile["defaults"]

            # Profile defaults as base, explicit params override
            merged = {**defs, **lm, **apg, **gen}
            # Remove None entries so they don't clobber explicit values
            merged = {k: v for k, v in merged.items() if v is not None}
            # Apply explicit params on top
            for k, v in p.items():
                if v is not None:
                    merged[k] = v
            p = merged

        api_task_type = _TASK_TYPE_MAP.get(task_type, "text2music")

        payload: dict[str, Any] = {
            "task_type": api_task_type,
            "prompt": p.get("prompt", ""),
            "lyrics": p.get("lyrics", ""),
            "thinking": p.get("thinking", True),
            "sample_mode": p.get("sample_mode", False),
            "sample_query": p.get("sample_query", ""),
            "seed": p.get("seed", -1),
            "use_random_seed": p.get("seed", -1) == -1,
            "audio_format": p.get("audio_format", "wav"),
            "batch_size": p.get("batch_size", 1),
        }

        # Add optional params (only non-None)
        for key in ("model", "global_caption", "use_format", "audio_duration",
                     "bpm", "key_scale", "time_signature", "vocal_language",
                     "inference_steps", "guidance_scale", "shift",
                     "cfg_scale", "temperature", "top_p", "top_k", "min_p",
                     "duration", "language", "instrumental"):
            val = p.get(key)
            if val is not None:
                # Map internal names to ACE-Step API names
                api_key = key
                if key == "audio_duration":
                    api_key = "duration"
                payload[api_key] = val

        # Reference audio
        ref_audio = p.get("reference_audio")
        if ref_audio:
            payload["reference_audio_path"] = (
                ref_audio if ref_audio.startswith("/") else f".assets/{task_id}/{ref_audio}"
            )

        src_audio = p.get("src_audio_path")
        if src_audio:
            payload["src_audio_path"] = (
                src_audio if src_audio.startswith("/") else f".assets/{task_id}/{src_audio}"
            )

        return payload

    async def _poll_until_done(self, job_id: str) -> dict[str, Any]:
        """Poll until the ACE-Step job completes or times out."""
        import asyncio
        start = __import__("time").time()
        timeout = self._config.poll_timeout

        while __import__("time").time() - start < timeout:
            result = await self.poll(job_id)
            if result["status"] == "completed":
                return {"success": True, "job_id": job_id}
            if result["status"] == "failed":
                return {"success": False, "error": result.get("error", "Job failed")}
            await asyncio.sleep(self._config.poll_interval)

        return {"success": False, "error": f"Polling timed out after {timeout}s"}

    def _download_results(
        self, task_id: str, result: dict[str, Any], workspace: Path,
    ) -> None:
        """Download audio files from the ACE-Step container to workspace."""
        job_id = result.get("job_id", "")
        if not job_id:
            return

        output_dir = workspace / ".done" / task_id
        output_dir.mkdir(parents=True, exist_ok=True)

        # Query for result URLs
        try:
            resp = httpx.post(
                f"{self._base_url}/query_result",
                json={"task_id_list": [job_id]},
                timeout=30,
            )
            data = resp.json()
            jobs = data.get("data", [])
            if not jobs:
                return

            result_raw = jobs[0].get("result", "{}")
            if isinstance(result_raw, str):
                result_items = _json.loads(result_raw)
            else:
                result_items = result_raw if isinstance(result_raw, list) else []

            for i, item in enumerate(result_items):
                file_path = item.get("file", "")
                if not file_path:
                    continue
                full_url = f"{self._base_url}{file_path}" if file_path.startswith("/") else f"{self._base_url}/{file_path}"
                try:
                    resp = httpx.get(full_url, timeout=60)
                    if resp.status_code == 200:
                        ct = resp.headers.get("content-type", "")
                        ext = "wav" if "wav" in ct else "mp3"
                        fname = f"output_{i}.{ext}" if len(result_items) > 1 else f"output.{ext}"
                        (output_dir / fname).write_bytes(resp.content)
                except Exception:
                    pass
        except Exception as e:
            logger.warning("Failed to download ACE-Step results: %s", e)
