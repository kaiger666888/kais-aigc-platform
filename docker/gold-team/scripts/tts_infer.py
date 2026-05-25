#!/usr/bin/env python3
"""Standalone TTS inference script for kais-gold-team V6.

Supports two backends:
  - CosyVoice: High-quality Chinese TTS (if installed)
  - edge-tts: Microsoft Edge TTS fallback (always available)

Usage:
    python scripts/tts_infer.py \
        --text "你好世界" \
        --output /mnt/agents/output/{task_id}/voice.wav \
        --voice default \
        --speed 1.0 \
        --backend auto

Output: WAV file at --output path. Prints JSON status to stdout.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import time
import uuid
from pathlib import Path


def ensure_output_dir(output_path: str) -> None:
    """Create output directory if needed."""
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)


def infer_cosyvoice(text: str, output_path: str, voice: str, speed: float) -> dict:
    """Run CosyVoice inference.

    Expects CosyVoice to be cloned and installed at COSYVOICE_ROOT.
    """
    cosy_root = os.environ.get(
        "COSYVOICE_ROOT",
        os.path.expanduser("~/CosyVoice"),
    )
    if not os.path.isdir(cosy_root):
        return {
            "status": "error",
            "error": f"CosyVoice not found at {cosy_root}. Set COSYVOICE_ROOT env var.",
            "backend": "cosyvoice",
        }

    try:
        sys.path.insert(0, cosy_root)
        from cosyvoice.cli.cosyvoice import CosyVoice  # type: ignore

        model_dir = os.environ.get(
            "COSYVOICE_MODEL_DIR",
            os.path.join(cosy_root, "pretrained_models", "CosyVoice2-0.5B"),
        )

        cosy = CosyVoice(model_dir)
        # Use first available speaker or 'default'
        speakers = cosy.list_available_spks()
        speaker = voice if voice in speakers else (speakers[0] if speakers else "中文女")

        ensure_output_dir(output_path)

        import torchaudio
        for i, result in enumerate(cosy.inference_sft(tts_text=text, spk_id=speaker)):
            # Take the first chunk (streaming — save last or only chunk)
            wav = result["tts_speech"]
            torchaudio.save(output_path, wav, 22050)
            break  # Save first chunk as full output

        return {
            "status": "ok",
            "output_path": output_path,
            "backend": "cosyvoice",
            "sample_rate": 22050,
        }

    except Exception as e:
        return {
            "status": "error",
            "error": f"CosyVoice inference failed: {e}",
            "backend": "cosyvoice",
        }


async def infer_edge_tts(text: str, output_path: str, voice: str, speed: float) -> dict:
    """Run edge-tts inference (Microsoft Edge TTS)."""
    try:
        import edge_tts
    except ImportError:
        return {
            "status": "error",
            "error": "edge-tts not installed. Run: pip install edge-tts",
            "backend": "edge-tts",
        }

    ensure_output_dir(output_path)

    # Voice mapping: short names → edge-tts voice IDs
    voice_map = {
        "default": "zh-CN-XiaoxiaoNeural",
        "中文女": "zh-CN-XiaoxiaoNeural",
        "中文男": "zh-CN-YunxiNeural",
        "english_female": "en-US-JennyNeural",
        "english_male": "en-US-GuyNeural",
        "japanese_female": "ja-JP-NanamiNeural",
    }
    edge_voice = voice_map.get(voice, voice if "-" in voice else "zh-CN-XiaoxiaoNeural")

    # Speed format for edge-tts: "+0%", "-50%", etc.
    speed_str = f"{int((speed - 1.0) * 100):+d}%"

    communicate = edge_tts.Communicate(text, edge_voice, rate=speed_str)
    await communicate.save(output_path)

    if not os.path.isfile(output_path) or os.path.getsize(output_path) == 0:
        return {
            "status": "error",
            "error": "edge-tts produced empty output",
            "backend": "edge-tts",
        }

    return {
        "status": "ok",
        "output_path": output_path,
        "backend": "edge-tts",
        "voice_used": edge_voice,
    }


async def main():
    parser = argparse.ArgumentParser(description="TTS inference for kais-gold-team")
    parser.add_argument("--text", required=True, help="Text to synthesize")
    parser.add_argument("--output", required=True, help="Output WAV/MP3 file path")
    parser.add_argument("--voice", default="default", help="Voice name or ID")
    parser.add_argument("--speed", type=float, default=1.0, help="Speech speed (1.0 = normal)")
    parser.add_argument(
        "--backend",
        default="auto",
        choices=["auto", "cosyvoice", "edge-tts"],
        help="TTS backend to use",
    )
    args = parser.parse_args()

    start = time.monotonic()

    if args.backend == "cosyvoice":
        result = infer_cosyvoice(args.text, args.output, args.voice, args.speed)
    elif args.backend == "edge-tts":
        result = await infer_edge_tts(args.text, args.output, args.voice, args.speed)
    else:
        # Auto: try CosyVoice first, fall back to edge-tts
        result = infer_cosyvoice(args.text, args.output, args.voice, args.speed)
        if result["status"] != "ok":
            print(f"CosyVoice unavailable ({result.get('error', '')}), falling back to edge-tts", file=sys.stderr)
            result = await infer_edge_tts(args.text, args.output, args.voice, args.speed)

    elapsed = time.monotonic() - start
    result["duration_sec"] = round(elapsed, 2)
    result["text_length"] = len(args.text)

    print(json.dumps(result, ensure_ascii=False))
    sys.exit(0 if result["status"] == "ok" else 1)


if __name__ == "__main__":
    asyncio.run(main())
