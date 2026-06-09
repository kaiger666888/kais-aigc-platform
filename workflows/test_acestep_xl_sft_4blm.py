#!/usr/bin/env python3
"""
AceStep 1.5 XL-SFT + 4B LM Audio Generation Workflow
ComfyUI API workflow for kais-aigc-platform (comfyui-primary)

Model: acestep_v1.5_xl_sft + qwen_0.6b + qwen_4b (text_encoder_2)
Nodes: jeankassio/ComfyUI-AceStep_SFT (all-in-one: AceStepSFTGenerate)
VRAM: ~21.5GB on RTX 3090 (lowvram offload text encoder)

Usage:
  python3 test_acestep_xl_sft_4blm.py [--duration 120] [--output-prefix acetest/custom] [--seed 42]
"""

import json, time, argparse, urllib.request, urllib.error

COMFYUI_URL = "http://localhost:8188"

# ── Lyrics ──────────────────────────────────────────────────────────────────
LYRICS = """[Intro]
(solo cello, deep and mournful, adagio)

[Verse 1]
The tide has turned, the stars grow dim
A thousand roads I've walked, none led to him
The compass spins, the winds obey
But not a single word I'd take away

[Chorus]
We are but dust upon the tide
Carried far beyond the other side
What lives must end, what ends may rise
A new horizon greets these eyes

[Verse 2]
The harbors burn, the anchors break
I leave behind the vows I couldn't make
But in the silence, standing tall
I hear the cello's ancient call

[Bridge]
(strings swell, brass enters softly)
Not every soul is meant to stay
Not every dawn will light the way
But those who dare to face the dark
Will find a fire in their heart

[Chorus]
We are but dust upon the tide
Carried far beyond the other side
What lives must end, what ends may rise
A new horizon greets these eyes

[Outro]
(solo cello, fading into silence)
(farewell, farewell...)"""

# ── Turbo Tags (style description) ─────────────────────────────────────────
TURBO_TAGS = (
    "epic orchestral, melancholic and grandiose, "
    "solo cello leading with deep strings section, "
    "brass accent, cinematic film score, "
    "dramatic swells, pirate-inspired sea shanty undertone, "
    "Hans Zimmer style, adagio to moderato tempo, "
    "D minor key, sorrowful yet powerful, oceanic atmosphere"
)


def build_prompt(
    duration: float = 120.0,
    bpm: int = 72,
    keyscale: str = "D minor",
    seed: int = 42,
    steps: int = 50,
    cfg: float = 7.0,
    sampler_name: str = "euler",
    scheduler: str = "normal",
    output_prefix: str = "acetest/epic_xl4blm",
):
    """Build ComfyUI API prompt JSON for XL-SFT + 4B LM generation."""

    prompt = {
        # ── Node 1: Turbo Tag Adapter ────────────────────────────────────────
        "1": {
            "class_type": "AceStepSFTTurboTagAdapter",
            "inputs": {
                "turbo_tags": TURBO_TAGS,
                "adaptation_strength": "aggressive",
                "keep_unknown_tags": True,
                "add_sft_bias_tags": True,
            },
        },
        # ── Node 5: AceStep SFT Generate (all-in-one) ──────────────────────
        "5": {
            "class_type": "AceStepSFTGenerate",
            "inputs": {
                "diffusion_model": "acestep_v1.5_xl_sft.safetensors",
                "text_encoder_1": "qwen_0.6b_ace15.safetensors",
                "text_encoder_2": "qwen_4b_ace15.safetensors",
                "vae_name": "ace_1.5_vae.safetensors",
                "caption": ["1", 0],
                "lyrics": LYRICS,
                "instrumental": False,
                "seed": seed,
                "steps": steps,
                "cfg": cfg,
                "sampler_name": sampler_name,
                "scheduler": scheduler,
                "denoise": 1.0,
                "infer_method": "ode",
                "guidance_mode": "apg",
                "duration": duration,
                "bpm": bpm,
                "timesignature": "4",
                "language": "en",
                "keyscale": keyscale,
                "generate_audio_codes": True,
                "use_tiled_vae": True,
                "apg_eta": 0.0,
                "apg_momentum": -0.75,
                "apg_norm_threshold": 2.5,
                "shift": 3.0,
                "lm_cfg_scale": 2.0,
                "lm_temperature": 0.85,
                "lm_top_p": 0.9,
                "lm_top_k": 0,
                "lm_min_p": 0.0,
                "style_tags": ["1", 0],
            },
        },
        # ── Node 6: Save Audio ────────────────────────────────────────────
        "6": {
            "class_type": "SaveAudio",
            "inputs": {"audio": ["5", 0], "filename_prefix": output_prefix},
        },
        # ── Node 7: Preview Audio ───────────────────────────────────────────
        "7": {
            "class_type": "PreviewAudio",
            "inputs": {"audio": ["5", 0]},
        },
    }

    return prompt


def submit_and_wait(prompt: dict, timeout: int = 1800):
    """Submit prompt to ComfyUI and wait for completion."""

    data = json.dumps({"prompt": prompt}).encode()
    req = urllib.request.Request(
        f"{COMFYUI_URL}/prompt", data=data, headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        pid = json.loads(resp.read())["prompt_id"]
    print(f"Queued: {pid}")

    start = time.time()
    while time.time() - start < timeout:
        try:
            req = urllib.request.Request(f"{COMFYUI_URL}/history/{pid}")
            with urllib.request.urlopen(req, timeout=10) as resp:
                h = json.loads(resp.read())
                if pid in h:
                    st = h[pid]
                    if st.get("status", {}).get("completed", False):
                        elapsed = time.time() - start
                        print(f"Done in {elapsed:.0f}s")
                        for nid, out in st.get("outputs", {}).items():
                            for typ in out:
                                for a in out[typ]:
                                    fn = a["filename"]
                                    sf = a.get("subfolder", "")
                                    path = f"{sf}/{fn}" if sf else fn
                                    print(f"  Output: {path}")
                        return st
                    msgs = st.get("status", {}).get("messages", [])
                    for m in msgs:
                        if "error" in str(m).lower() or "exception" in str(m).lower():
                            print(f"Error: {str(m)[:500]}")
                            return None
        except Exception:
            pass
        time.sleep(20)

    print("Timeout!")
    return None


def main():
    parser = argparse.ArgumentParser(description="AceStep XL-SFT + 4B LM Audio Gen")
    parser.add_argument("--duration", type=float, default=120.0, help="Audio duration in seconds")
    parser.add_argument("--bpm", type=int, default=72, help="Beats per minute")
    parser.add_argument("--keyscale", default="D minor", help="Musical key")
    parser.add_argument("--seed", type=int, default=42, help="Random seed")
    parser.add_argument("--steps", type=int, default=50, help="Denoising steps (SFT: 50)")
    parser.add_argument("--cfg", type=float, default=7.0, help="CFG scale")
    parser.add_argument("--sampler", default="euler", help="Sampler name (euler/dpmpp_2m)")
    parser.add_argument("--output-prefix", default="acetest/epic_xl4blm", help="Output filename prefix")
    args = parser.parse_args()

    prompt = build_prompt(
        duration=args.duration,
        bpm=args.bpm,
        keyscale=args.keyscale,
        seed=args.seed,
        steps=args.steps,
        cfg=args.cfg,
        sampler_name=args.sampler,
        output_prefix=args.output_prefix,
    )

    print(f"Generating: {args.duration}s {args.keyscale} via XL-SFT + 4B LM...")
    print(f"  Steps: {args.steps} | CFG: {args.cfg} | Sampler: {args.sampler}")
    result = submit_and_wait(prompt)
    if result:
        print("Success!")
    else:
        print("Failed!")
        exit(1)


if __name__ == "__main__":
    main()
