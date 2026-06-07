#!/usr/bin/env python3
"""
Wan 2.2 I2V Demo - Based on official ComfyUI blueprint
Two-stage sampling: high_noise (stage 1) + low_noise (stage 2)

Models needed:
  - wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors
  - wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors
  - umt5_xxl_fp8_e4m3fn_scaled.safetensors (or .pth)
  - wan_2.1_vae.safetensors

Usage: python3 wan22_i2v_demo.py [--ref REF_IMAGE] [--prompt TEXT] [--seed N]
"""

import json, time, sys, os, subprocess, urllib.request, urllib.error, argparse

API = "http://localhost:8188"
OUTPUT_DIR = "/mnt/agents/output/gpu1/wan22_demo"
os.makedirs(OUTPUT_DIR, exist_ok=True)


def api_post(path, data):
    req = urllib.request.Request(
        f"{API}{path}",
        data=json.dumps(data).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())


def api_get(path):
    with urllib.request.urlopen(f"{API}{path}", timeout=30) as resp:
        return json.loads(resp.read())


def wait_for_done(prompt_id, timeout=900):
    start = time.time()
    while time.time() - start < timeout:
        try:
            hist = api_get(f"/history/{prompt_id}")
            if prompt_id in hist:
                status = hist[prompt_id].get("status", {})
                if status.get("completed", False) or status.get("status_str") == "success":
                    return hist[prompt_id]
                if status.get("status_str") == "error":
                    msgs = status.get("messages", [])
                    raise RuntimeError(f"Workflow error: {msgs}")
        except urllib.error.HTTPError:
            pass
        time.sleep(5)
    raise TimeoutError(f"Timeout ({timeout}s) waiting for {prompt_id}")


def upload_image(image_path, name=None):
    filename = name or os.path.basename(image_path)
    with open(image_path, "rb") as f:
        data = f.read()
    boundary = "----WebKitFormBoundary7MA4YWxkTrZu0gW"
    body = (
        f"------WebKitFormBoundary7MA4YWxkTrZu0gW\r\n"
        f'Content-Disposition: form-data; name="image"; filename="{filename}"\r\n'
        f"Content-Type: image/png\r\n\r\n"
    ).encode() + data + b"\r\n------WebKitFormBoundary7MA4YWxkTrZu0gW--\r\n"
    req = urllib.request.Request(
        f"{API}/upload/image",
        data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary[2:]}"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        result = json.loads(resp.read())
    print(f"   📤 Uploaded: {filename}")
    return result.get("name", filename)


def copy_outputs(hist_entry, host_dir, prefix=""):
    outputs = hist_entry.get("outputs", {})
    results = []
    for node_id, node_out in outputs.items():
        for key in ("images", "gifs", "videos"):
            if key in node_out:
                for item in node_out[key]:
                    subfolder = item.get("subfolder", "")
                    orig_name = item.get("filename", "")
                    filename = f"{prefix}_{orig_name}" if prefix else orig_name
                    container_path = f"/root/ComfyUI/output/{subfolder}/{orig_name}" if subfolder else f"/root/ComfyUI/output/{orig_name}"
                    host_path = f"{host_dir}/{filename}"
                    try:
                        result = subprocess.run(
                            ["docker", "exec", "comfyui-primary", "cat", container_path],
                            capture_output=True, timeout=120
                        )
                        with open(host_path, "wb") as f:
                            f.write(result.stdout)
                        size_mb = len(result.stdout) / (1024 * 1024)
                        print(f"   💾 {filename} ({size_mb:.1f} MB)")
                        results.append(host_path)
                    except Exception as e:
                        print(f"   ⚠️ Failed: {e}")
    return results


def build_i2v_workflow(image_filename, prompt_text, negative_prompt,
                        width=480, height=480, num_frames=81, seed=0,
                        steps_stage1=20, steps_stage2=20, cfg=5.0):
    """
    Wan 2.2 I2V Two-Stage workflow (based on official blueprint)
    
    Stage 1: high_noise model, denoise 0→2 (steps_stage1 steps)
    Stage 2: low_noise model, denoise 2→4 (steps_stage2 steps)
    
    Without LightX2V LoRA, use 20+20=40 steps for good quality.
    """
    return {
        # ── Loaders ──
        # Text encoder
        "1": {
            "class_type": "CLIPLoader",
            "inputs": {
                "clip_name": "umt5_xxl_fp8_e4m3fn_scaled.safetensors",
                "type": "wan",
            }
        },
        # VAE
        "2": {
            "class_type": "VAELoader",
            "inputs": {
                "vae_name": "wan_2.1_vae.safetensors"
            }
        },
        # High noise model (stage 1)
        "3": {
            "class_type": "UNETLoader",
            "inputs": {
                "unet_name": "wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors",
                "weight_dtype": "default",
            }
        },
        # Low noise model (stage 2)
        "4": {
            "class_type": "UNETLoader",
            "inputs": {
                "unet_name": "wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors",
                "weight_dtype": "default",
            }
        },
        # ModelSamplingSD3 for high noise model
        "5": {
            "class_type": "ModelSamplingSD3",
            "inputs": {
                "model": ["3", 0],
                "shift": cfg,
            }
        },
        # ModelSamplingSD3 for low noise model
        "6": {
            "class_type": "ModelSamplingSD3",
            "inputs": {
                "model": ["4", 0],
                "shift": cfg,
            }
        },
        # ── Conditioning ──
        # Positive prompt
        "7": {
            "class_type": "CLIPTextEncode",
            "inputs": {
                "text": prompt_text,
                "clip": ["1", 0],
            }
        },
        # Negative prompt
        "8": {
            "class_type": "CLIPTextEncode",
            "inputs": {
                "text": negative_prompt,
                "clip": ["1", 0],
            }
        },
        # ── Latent ──
        # Load reference image
        "9": {
            "class_type": "LoadImage",
            "inputs": {
                "image": image_filename,
            }
        },
        # WanImageToVideo: creates I2V latent with start_image
        "10": {
            "class_type": "WanImageToVideo",
            "inputs": {
                "positive": ["7", 0],
                "negative": ["8", 0],
                "vae": ["2", 0],
                "width": width,
                "height": height,
                "length": num_frames,
                "batch_size": 1,
                "start_image": ["9", 0],
            }
        },
        # ── Stage 1: High Noise Sampler ──
        "11": {
            "class_type": "KSamplerAdvanced",
            "inputs": {
                "add_noise": "enable",
                "noise_seed": seed,
                "seed": 0,
                "control_after_generate": "randomize",
                "steps": steps_stage1,
                "cfg": 1.0,  # Not used in advanced mode
                "sampler_name": "euler",
                "scheduler": "simple",
                "start_at_step": 0,
                "end_at_step": steps_stage1,
                "return_with_leftover_noise": "enable",
                "model": ["5", 0],  # High noise model with shift
                "positive": ["10", 0],  # WanImageToVideo positive
                "negative": ["10", 1],  # WanImageToVideo negative
                "latent_image": ["10", 2],  # WanImageToVideo latent
            }
        },
        # ── Stage 2: Low Noise Sampler ──
        "12": {
            "class_type": "KSamplerAdvanced",
            "inputs": {
                "add_noise": "disable",
                "noise_seed": seed,
                "seed": 0,
                "control_after_generate": "fixed",
                "steps": steps_stage2,
                "cfg": 1.0,
                "sampler_name": "euler",
                "scheduler": "simple",
                "start_at_step": 0,
                "end_at_step": steps_stage2,
                "return_with_leftover_noise": "disable",
                "model": ["6", 0],  # Low noise model with shift
                "positive": ["10", 0],
                "negative": ["10", 1],
                "latent_image": ["11", 0],  # Stage 1 output
            }
        },
        # ── Decode ──
        "13": {
            "class_type": "VAEDecode",
            "inputs": {
                "samples": ["12", 0],
                "vae": ["2", 0],
            }
        },
        # ── Output ──
        "14": {
            "class_type": "VHS_VideoCombine",
            "inputs": {
                "images": ["13", 0],
                "frame_rate": 16,
                "loop_count": 0,
                "filename_prefix": "wan22_i2v",
                "format": "video/h264-mp4",
                "pingpong": False,
                "save_output": True,
            }
        },
    }


def main():
    parser = argparse.ArgumentParser(description="Wan 2.2 I2V Demo")
    parser.add_argument("--ref", default="/home/kai/workspace/kais-aigc-platform/workflows/hp_dragon_ref.png",
                        help="Reference image path")
    parser.add_argument("--prompt", default="A majestic dragon perches on a dark rocky cliff, wings slightly spread, breathing soft fire. Stormy sky background, cinematic lighting, dramatic atmosphere, epic fantasy.",
                        help="Prompt text")
    parser.add_argument("--negative", default="色调艳丽，过曝，静态，细节模糊不清，字幕，风格，作品，画作，画面，静止，整体发灰，最差质量，低质量，JPEG压缩残留，丑陋的，残缺的，多余的手指，画得不好的手部，画得不好的脸部，畸形的，毁容的，形态畸形的肢体，手指融合，静止不动的画面，杂乱的背景",
                        help="Negative prompt")
    parser.add_argument("--seed", type=int, default=20260607, help="Random seed (0=randomize)")
    parser.add_argument("--width", type=int, default=480, help="Width")
    parser.add_argument("--height", type=int, default=480, help="Height")
    parser.add_argument("--frames", type=int, default=81, help="Number of frames")
    parser.add_argument("--steps1", type=int, default=20, help="Stage 1 steps")
    parser.add_argument("--steps2", type=int, default=20, help="Stage 2 steps")
    args = parser.parse_args()

    print("🚀 Wan 2.2 I2V Two-Stage Demo")
    print(f"   API: {API}")
    print(f"   Output: {OUTPUT_DIR}")
    print(f"   Ref: {args.ref}")
    print(f"   Size: {args.width}x{args.height}, {args.frames} frames")
    print(f"   Steps: {args.steps1}+{args.steps2}={args.steps1+args.steps2}")

    # Check ComfyUI
    try:
        api_get("/system_stats")
        print("   ✅ ComfyUI connected")
    except Exception as e:
        print(f"   ❌ ComfyUI not reachable: {e}")
        sys.exit(1)

    # Upload reference image (skip if already in container input folder)
    img_name = "wan22_demo_ref.png"
    print(f"\n📤 Using image: {img_name}")

    # Build workflow
    print(f"\n🏗️ Building workflow...")
    workflow = build_i2v_workflow(
        image_filename=img_name,
        prompt_text=args.prompt,
        negative_prompt=args.negative,
        width=args.width,
        height=args.height,
        num_frames=args.frames,
        seed=args.seed,
        steps_stage1=args.steps1,
        steps_stage2=args.steps2,
    )

    # Submit
    print(f"\n🚀 Submitting to ComfyUI...")
    prompt_data = api_post("/prompt", {"prompt": workflow})
    prompt_id = prompt_data["prompt_id"]
    print(f"   Prompt ID: {prompt_id}")
    print(f"   ⏳ Generating... (this will take a while with {args.steps1+args.steps2} total steps)")

    # Wait
    try:
        hist = wait_for_done(prompt_id, timeout=1800)
        files = copy_outputs(hist, OUTPUT_DIR, "wan22_i2v")
        if files:
            print(f"\n{'='*60}")
            print(f"🎉 Wan 2.2 I2V Complete!")
            print(f"{'='*60}")
            for f in files:
                print(f"   📹 {f}")
        else:
            print("\n⚠️ No output files")
    except RuntimeError as e:
        print(f"\n❌ Error: {e}")
    except TimeoutError:
        print(f"\n❌ Timeout (1800s)")


if __name__ == "__main__":
    main()
