#!/usr/bin/env python3
"""
BGM (background music) detector for generated videos.

Usage:
    python3 detect_bgm.py <video_or_wav> [--threshold 0.10] [--json]

Decision logic:
    1. CNN-based segmenter (inaSpeechSegmenter) classifies each audio chunk as
       speech / music / noise / noEnergy. Music + mixed = BGM.
    2. Spectral analysis cross-checks: spectral flatness < 0.15 (highly tonal)
       OR strong tempo autocorrelation (>0.3, 60-200 BPM) indicates music.
    3. Final verdict = BGM if either method flags music above threshold.

Output (JSON):
    {
      "has_bgm": true|false,
      "confidence": 0.0-1.0,
      "music_pct": float,
      "speech_pct": float,
      "noise_pct": float,
      "silence_pct": float,
      "spectral_flatness": float,
      "tempo_bpm": float,
      "tempo_strength": float,
      "interpretation": "MUSIC"|"NOISE/AMBIENT"|"MIXED"|"SILENT",
      "duration_s": float,
      "segments": [[label, start, end], ...]
    }

Requirements (in venv):
    pip install inaSpeechSegmenter soundfile scipy numpy

    Models download automatically to ~/.keras/inaSpeechSegmenter/ on first run.
    If downloads stall, set https_proxy and run again, or download manually:
      curl -o ~/.keras/inaSpeechSegmenter/keras_speech_music_noise_cnn.hdf5 \
        https://github.com/ina-foss/inaSpeechSegmenter/releases/download/models/keras_speech_music_noise_cnn.hdf5

Design rationale:
    - Two-method cross-validation: CNN alone can false-positive on sustained
      tonal ambient sounds (engine hum, wind drone); spectral flatness alone
      misses vocal-heavy music. Requiring both directions reduces error.
    - detect_gender=False: the gender sub-model is unrelated to BGM and adds
      6MB + load time. Skipped.
"""

import argparse
import json
import os
import subprocess
import sys
import tempfile
from collections import defaultdict


def ensure_audio_input(path: str) -> str:
    """If input is a video, extract audio via ffmpeg. Return wav path."""
    if path.lower().endswith((".wav", ".flac", ".ogg", ".mp3", ".m4a", ".aac")):
        return path
    wav_out = tempfile.NamedTemporaryFile(suffix=".wav", delete=False).name
    cmd = [
        "ffmpeg", "-hide_banner", "-loglevel", "error",
        "-y", "-i", path,
        "-ac", "1", "-ar", "16000",
        wav_out,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        # Probably no audio stream (silent video)
        if "does not contain any stream" in result.stderr or "Invalid argument" in result.stderr:
            return ""
        raise RuntimeError(f"ffmpeg failed: {result.stderr}")
    return wav_out


def cnn_classify(wav_path: str, batch_size: int = 1):
    """Run inaSpeechSegmenter (speech/music/noise). Returns segments + aggregates."""
    os.environ["TF_CPP_MIN_LOG_LEVEL"] = "3"
    from inaSpeechSegmenter import Segmenter  # local import — heavy
    seg = Segmenter(detect_gender=False, batch_size=batch_size)
    segments = seg(wav_path)  # list of (label, start, end)

    durations = defaultdict(float)
    for label, start, end in segments:
        durations[label] += (end - start)
    total = sum(durations.values()) or 1.0
    music_s = durations.get("music", 0.0) + durations.get("mixed", 0.0)
    return {
        "segments": [(lbl, round(float(s), 3), round(float(e), 3)) for lbl, s, e in segments],
        "music_pct": round(music_s / total * 100, 2),
        "speech_pct": round(durations.get("speech", 0.0) / total * 100, 2),
        "noise_pct": round(durations.get("noise", 0.0) / total * 100, 2),
        "silence_pct": round(durations.get("noEnergy", 0.0) / total * 100, 2),
        "total_s": round(total, 3),
    }


def spectral_analyze(wav_path: str) -> dict:
    """Compute spectral flatness, tempo, harmonic ratio."""
    import numpy as np
    import soundfile as sf
    from scipy import signal

    y, sr = sf.read(wav_path)
    if y.ndim > 1:
        y = y.mean(axis=1)
    duration = len(y) / sr

    if duration < 0.1 or float(np.abs(y).max()) < 1e-5:
        return {
            "duration_s": round(duration, 3),
            "spectral_flatness": 0.0,
            "spectral_centroid_hz": 0.0,
            "tempo_bpm": 0.0,
            "tempo_strength": 0.0,
            "interpretation": "SILENT",
        }

    f, t, Sxx = signal.spectrogram(y, sr, nperseg=2048, noverlap=1536)

    # Spectral flatness (Wiener entropy): low => tonal, high => noise-like
    geo_mean = np.exp(np.mean(np.log(Sxx + 1e-10), axis=0))
    arith_mean = np.mean(Sxx, axis=0)
    flatness = float(np.mean(geo_mean / (arith_mean + 1e-10)))

    # Spectral centroid (brightness)
    power_per_freq = Sxx.mean(axis=1)
    centroid = float((f * power_per_freq).sum() / (power_per_freq.sum() + 1e-10))

    # Tempo via onset autocorrelation
    hop = 512
    rms = np.sqrt([
        np.mean(y[i:i + hop] ** 2)
        for i in range(0, len(y) - hop, hop)
    ])
    onset = np.diff(rms)
    onset[onset < 0] = 0
    tempo_bpm, tempo_strength = 0.0, 0.0
    if len(onset) > 20:
        autocorr = np.correlate(onset, onset, mode='full')[len(onset) - 1:]
        if autocorr[0] > 0:
            autocorr = autocorr / autocorr[0]
            lo = int(0.3 * sr / hop)   # 200 BPM
            hi = int(2.0 * sr / hop)   # 30 BPM
            if hi < len(autocorr):
                region = autocorr[lo:hi]
                tempo_strength = float(region.max())
                peak_idx = int(region.argmax()) + lo
                tempo_bpm = 60.0 / (peak_idx * hop / sr)

    # Interpretation
    if flatness < 0.15 or (tempo_strength > 0.3 and 60 < tempo_bpm < 200):
        interp = "MUSIC"
    elif flatness > 0.30:
        interp = "NOISE/AMBIENT"
    else:
        interp = "MIXED"

    return {
        "duration_s": round(duration, 3),
        "spectral_flatness": round(flatness, 3),
        "spectral_centroid_hz": round(centroid, 1),
        "tempo_bpm": round(tempo_bpm, 1),
        "tempo_strength": round(tempo_strength, 3),
        "interpretation": interp,
    }


def detect_bgm(path: str, music_threshold: float = 0.10) -> dict:
    """
    Full pipeline. Returns dict with has_bgm, confidence, full report.
    music_threshold: fraction of total duration classified as music to flag BGM.
    """
    wav_path = ensure_audio_input(path)

    # Silent video (no audio stream)
    if not wav_path:
        return {
            "has_bgm": False,
            "confidence": 1.0,
            "music_pct": 0.0,
            "speech_pct": 0.0,
            "noise_pct": 0.0,
            "silence_pct": 100.0,
            "spectral_flatness": 0.0,
            "tempo_bpm": 0.0,
            "tempo_strength": 0.0,
            "interpretation": "SILENT",
            "duration_s": 0.0,
            "segments": [],
            "input": path,
            "note": "No audio stream found (silent video).",
        }

    try:
        cnn = cnn_classify(wav_path)
        spec = spectral_analyze(wav_path)
    finally:
        if wav_path != path and os.path.exists(wav_path):
            os.unlink(wav_path)

    music_pct = cnn["music_pct"]
    cnn_flag = music_pct / 100.0 > music_threshold
    spec_flag = spec["interpretation"] == "MUSIC"

    # Confidence: 0.0 (definitely no BGM) to 1.0 (definitely BGM)
    # Use agreement between methods
    if cnn_flag and spec_flag:
        confidence = 0.9 + min(0.1, (music_pct / 100.0 - music_threshold))
    elif cnn_flag and not spec_flag:
        # CNN says music, spectral says no — likely tonal ambience false-positive
        confidence = 0.55
    elif not cnn_flag and spec_flag:
        # Spectral says music, CNN says no — borderline
        confidence = 0.45
    else:
        confidence = 0.05

    has_bgm = confidence >= 0.5

    return {
        "has_bgm": has_bgm,
        "confidence": round(confidence, 3),
        "music_pct": music_pct,
        "speech_pct": cnn["speech_pct"],
        "noise_pct": cnn["noise_pct"],
        "silence_pct": cnn["silence_pct"],
        "spectral_flatness": spec["spectral_flatness"],
        "tempo_bpm": spec["tempo_bpm"],
        "tempo_strength": spec["tempo_strength"],
        "interpretation": spec["interpretation"],
        "duration_s": cnn["total_s"],
        "segments": cnn["segments"][:50],  # cap for log readability
        "input": path,
        "method_agreement": {
            "cnn_flag": cnn_flag,
            "spectral_flag": spec_flag,
        },
    }


def main():
    parser = argparse.ArgumentParser(description="Detect background music in a video/audio file.")
    parser.add_argument("input", help="Path to .mp4/.mkv/.mov/.wav/.mp3 etc.")
    parser.add_argument("--threshold", type=float, default=0.10,
                        help="Music fraction threshold for BGM flag (default: 0.10 = 10%%)")
    parser.add_argument("--json", action="store_true", help="Output full JSON report")
    parser.add_argument("--no-json", dest="json", action="store_false")
    parser.set_defaults(json=True)
    args = parser.parse_args()

    if not os.path.exists(args.input):
        print(f"ERROR: input not found: {args.input}", file=sys.stderr)
        sys.exit(2)

    report = detect_bgm(args.input, music_threshold=args.threshold)

    if args.json:
        print(json.dumps(report, indent=2, ensure_ascii=False))
    else:
        verdict = "BGM DETECTED" if report["has_bgm"] else "no BGM"
        print(f"{report['input']}  ->  {verdict}  (confidence={report['confidence']}, music={report['music_pct']}%)")

    sys.exit(1 if report["has_bgm"] else 0)


if __name__ == "__main__":
    main()
