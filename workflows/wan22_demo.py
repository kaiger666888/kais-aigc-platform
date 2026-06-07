#!/usr/bin/env python3
"""
Wan 2.2 Demo Pipeline - 基于 kais-aigc-platform 的 4 个核心工作流演示

使用 ComfyUI API 格式（非 LiteGraph JSON），确保节点兼容性。

Workflow 1: T2V (文本生成视频)
Workflow 2: I2V Quick (图生视频快速版)
Workflow 3: Animate Move (动作参考迁移 - 如果有动作视频)
Workflow 4: FirstLastFrame (首尾帧插值)

Author: Clawd (kais-aigc-platform)
"""

import json, time, sys, os, subprocess, urllib.request, urllib.error, urllib.parse

API = "http://localhost:8188"
OUTPUT_DIR = "/mnt/agents/output/gpu1/wan22_demo"
os.makedirs(OUTPUT_DIR, exist_ok=True)

# ── Model Config ───────────────────────────────────────────────────────────────
MODELS = {
    "i2v_high_noise": "wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors",
    "i2v_low_noise": "wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors",
    "text_encoder": "umt5-xxl-enc-bf16.pth",
    "vae": "wan_2.1_vae.safetensors",
}

# Default generation params (from Kai's guide)
DEFAULT_WIDTH = 832
DEFAULT_HEIGHT = 480
DEFAULT_FRAMES = 81   # ~3s at 27fps
DEFAULT_STEPS = 30
DEFAULT_CFG = 5.0
DEFAULT_SAMPLER = "uni_pc_bh2"
DEFAULT_SCHEDULER = "beta"


# ── Helpers ─────────────────────────────────────────────────────────────────
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


def wait_for_done(prompt_id, timeout=600):
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
        time.sleep(3)
    raise TimeoutError(f"Timeout ({timeout}s) waiting for {prompt_id}")


def upload_image_to_comfy(image_path, name=None):
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
    print(f"   📤 Uploaded: {filename} → {result}")
    return result.get("name", filename)


def upload_video_to_comfy(video_path, name=None):
    filename = name or os.path.basename(video_path)
    with open(video_path, "rb") as f:
        data = f.read()
    boundary = "----WebKitFormBoundary7MA4YWxkTrZu0gW"
    body = (
        f"------WebKitFormBoundary7MA4YWxkTrZu0gW\r\n"
        f'Content-Disposition: form-data; name="video"; filename="{filename}"\r\n'
        f"Content-Type: video/mp4\r\n\r\n"
    ).encode() + data + b"\r\n------WebKitFormBoundary7MA4YWxkTrZu0gW--\r\n"

    req = urllib.request.Request(
        f"{API}/upload/video",
        data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary[2:]}"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        result = json.loads(resp.read())
    print(f"   📤 Uploaded video: {filename} → {result}")
    return result.get("name", filename)


def copy_output_from_container(hist_entry, host_dir, prefix=""):
    outputs = hist_entry.get("outputs", {})
    results = []
    for node_id, node_out in outputs.items():
        for key in ("images", "gifs", "videos"):
            if key in node_out:
                for item in node_out[key]:
                    subfolder = item.get("subfolder", "")
                    filename = item.get("filename", "")
                    if prefix:
                        base, ext = os.path.splitext(filename)
                        filename = f"{prefix}_{base}{ext}"
                    container_path = f"/root/ComfyUI/output/{subfolder}/{item.get('filename', '')}" if subfolder else f"/root/ComfyUI/output/{item.get('filename', '')}"
                    host_path = f"{host_dir}/{filename}"
                    try:
                        result = subprocess.run(
                            ["docker", "exec", "comfyui-primary", "cat", container_path],
                            capture_output=True, timeout=120
                        )
                        with open(host_path, "wb") as f:
                            f.write(result.stdout)
                        size_mb = len(result.stdout) / (1024 * 1024)
                        print(f"   💾 {filename} ({size_mb:.1f} MB) → {host_path}")
                        results.append(host_path)
                    except Exception as e:
                        print(f"   ⚠️ Failed to copy {filename}: {e}")
    return results


def submit_prompt(prompt, client_id="wan22-demo"):
    """Submit a ComfyUI API-format prompt."""
    data = {"prompt": prompt, "client_id": client_id}
    prompt_data = api_post("/prompt", data)
    prompt_id = prompt_data["prompt_id"]
    print(f"   🚀 Submitted: prompt_id={prompt_id}")
    return prompt_id


# ── Workflow 1: Text-to-Video ───────────────────────────────────────────────
def build_w1_t2v(prompt_text, negative_prompt="blurry, low quality, distorted, watermark, text, ugly, deformed",
                 seed=42, width=DEFAULT_WIDTH, height=DEFAULT_HEIGHT,
                 num_frames=DEFAULT_FRAMES, steps=DEFAULT_STEPS, cfg=DEFAULT_CFG):
    """
    Wan 2.2 T2V: text → video
    Uses WanImageToVideo in "text-to-video" mode (no start_image)
    """
    return {
        # Model loading
        "1": {
            "class_type": "UNETLoader",
            "inputs": {
                "unet_name": MODELS["i2v_high_noise"],
                "weight_dtype": "fp8_e4m3fn"
            }
        },
        # Text encoder (Wan uses UMT5-XXL)
        "2": {
            "class_type": "CLIPLoader",
            "inputs": {
                "clip_name": MODELS["text_encoder"],
                "type": "wan"
            }
        },
        # VAE
        "3": {
            "class_type": "VAELoader",
            "inputs": {
                "vae_name": MODELS["vae"]
            }
        },
        # Positive prompt
        "4": {
            "class_type": "CLIPTextEncode",
            "inputs": {
                "text": prompt_text,
                "clip": ["2", 0],
            }
        },
        # Negative prompt
        "5": {
            "class_type": "CLIPTextEncode",
            "inputs": {
                "text": negative_prompt,
                "clip": ["2", 0],
            }
        },
        # WanImageToVideo (I2V latent creation - without start_image it acts as T2V)
        "6": {
            "class_type": "WanImageToVideo",
            "inputs": {
                "positive": ["4", 0],
                "negative": ["5", 0],
                "vae": ["3", 0],
                "width": width,
                "height": height,
                "length": num_frames,
                "batch_size": 1,
            }
        },
        # KSampler
        "7": {
            "class_type": "KSampler",
            "inputs": {
                "seed": seed,
                "steps": steps,
                "cfg": cfg,
                "sampler_name": DEFAULT_SAMPLER,
                "scheduler": DEFAULT_SCHEDULER,
                "denoise": 1.0,
                "model": ["1", 0],
                "positive": ["6", 0],  # Wan positive conditioning with latent
                "negative": ["6", 1],  # Wan negative conditioning
                "latent_image": ["6", 2],  # Wan latent
            }
        },
        # Decode
        "8": {
            "class_type": "VAEDecode",
            "inputs": {
                "samples": ["7", 0],
                "vae": ["3", 0],
            }
        },
        # Save
        "9": {
            "class_type": "VHS_VideoCombine",
            "inputs": {
                "images": ["8", 0],
                "frame_rate": 27,
                "loop_count": 0,
                "filename_prefix": "wan22_t2v",
                "format": "video/h264-mp4",
                "pingpong": False,
                "save_output": True,
            }
        },
    }


# ── Workflow 2: Image-to-Video Quick ──────────────────────────────────────────
def build_w2_i2v(image_filename, prompt_text,
                  negative_prompt="blurry, low quality, distorted, watermark, text",
                  seed=42, width=DEFAULT_WIDTH, height=DEFAULT_HEIGHT,
                  num_frames=DEFAULT_FRAMES, steps=DEFAULT_STEPS, cfg=DEFAULT_CFG,
                  start_percent=0.55):
    """
    Wan 2.2 I2V Quick: single-stage, high-noise model
    Uses Wan22ImageToVideoLatent with start_image
    """
    return {
        "1": {
            "class_type": "UNETLoader",
            "inputs": {
                "unet_name": MODELS["i2v_high_noise"],
                "weight_dtype": "fp8_e4m3fn"
            }
        },
        "2": {
            "class_type": "CLIPLoader",
            "inputs": {
                "clip_name": MODELS["text_encoder"],
                "type": "wan"
            }
        },
        "3": {
            "class_type": "VAELoader",
            "inputs": {
                "vae_name": MODELS["vae"]
            }
        },
        "4": {
            "class_type": "LoadImage",
            "inputs": {
                "image": image_filename,
            }
        },
        "5": {
            "class_type": "CLIPTextEncode",
            "inputs": {
                "text": prompt_text,
                "clip": ["2", 0],
            }
        },
        "6": {
            "class_type": "CLIPTextEncode",
            "inputs": {
                "text": negative_prompt,
                "clip": ["2", 0],
            }
        },
        # I2V latent with start_image
        "7": {
            "class_type": "Wan22ImageToVideoLatent",
            "inputs": {
                "vae": ["3", 0],
                "width": width,
                "height": height,
                "length": num_frames,
                "batch_size": 1,
                "start_image": ["4", 0],
            }
        },
        "8": {
            "class_type": "KSampler",
            "inputs": {
                "seed": seed,
                "steps": steps,
                "cfg": cfg,
                "sampler_name": DEFAULT_SAMPLER,
                "scheduler": DEFAULT_SCHEDULER,
                "denoise": 1.0,
                "model": ["1", 0],
                "positive": ["5", 0],
                "negative": ["6", 0],
                "latent_image": ["7", 0],
            }
        },
        "9": {
            "class_type": "VAEDecode",
            "inputs": {
                "samples": ["8", 0],
                "vae": ["3", 0],
            }
        },
        "10": {
            "class_type": "VHS_VideoCombine",
            "inputs": {
                "images": ["9", 0],
                "frame_rate": 27,
                "loop_count": 0,
                "filename_prefix": "wan22_i2v_quick",
                "format": "video/h264-mp4",
                "pingpong": False,
                "save_output": True,
            }
        },
    }


# ── Workflow 3: Animate Move (动作参考迁移) ─────────────────────────────────
def build_w3_animate_move(image_filename, prompt_text,
                          negative_prompt="blurry, low quality, distorted, watermark",
                          seed=42, width=DEFAULT_WIDTH, height=DEFAULT_HEIGHT,
                          num_frames=81, steps=DEFAULT_STEPS, cfg=DEFAULT_CFG):
    """
    Wan 2.2 Animate Move: 动作参考视频 + 角色图 → 角色做相同动作的视频
    Uses WanMoveTrackToVideo (simplified - without actual move tracks, uses T2V approach)
    
    Note: Full move track requires WanMoveTracksFromCoords or specific move track data.
    This is a simplified version using WanAnimateToVideo.
    """
    return {
        "1": {
            "class_type": "UNETLoader",
            "inputs": {
                "unet_name": MODELS["i2v_high_noise"],
                "weight_dtype": "fp8_e4m3fn"
            }
        },
        "2": {
            "class_type": "CLIPLoader",
            "inputs": {
                "clip_name": MODELS["text_encoder"],
                "type": "wan"
            }
        },
        "3": {
            "class_type": "VAELoader",
            "inputs": {
                "vae_name": MODELS["vae"]
            }
        },
        "4": {
            "class_type": "LoadImage",
            "inputs": {
                "image": image_filename,
            }
        },
        "5": {
            "class_type": "CLIPTextEncode",
            "inputs": {
                "text": prompt_text,
                "clip": ["2", 0],
            }
        },
        "6": {
            "class_type": "CLIPTextEncode",
            "inputs": {
                "text": negative_prompt,
                "clip": ["2", 0],
            }
        },
        # Move track video generation with start_image
        "7": {
            "class_type": "WanMoveTrackToVideo",
            "inputs": {
                "positive": ["5", 0],
                "negative": ["6", 0],
                "vae": ["3", 0],
                "strength": 1.0,
                "width": width,
                "height": height,
                "length": num_frames,
                "batch_size": 1,
                "start_image": ["4", 0],
            }
        },
        "8": {
            "class_type": "KSampler",
            "inputs": {
                "seed": seed,
                "steps": steps,
                "cfg": cfg,
                "sampler_name": DEFAULT_SAMPLER,
                "scheduler": DEFAULT_SCHEDULER,
                "denoise": 1.0,
                "model": ["1", 0],
                "positive": ["7", 0],
                "negative": ["7", 1],
                "latent_image": ["7", 2],
            }
        },
        "9": {
            "class_type": "VAEDecode",
            "inputs": {
                "samples": ["8", 0],
                "vae": ["3", 0],
            }
        },
        "10": {
            "class_type": "VHS_VideoCombine",
            "inputs": {
                "images": ["9", 0],
                "frame_rate": 27,
                "loop_count": 0,
                "filename_prefix": "wan22_animate_move",
                "format": "video/h264-mp4",
                "pingpong": False,
                "save_output": True,
            }
        },
    }


# ── Workflow 4: First-Last Frame Interpolation ───────────────────────────────
def build_w4_fflf(first_frame_filename, last_frame_filename, prompt_text,
                  negative_prompt="blurry, low quality, distorted, watermark",
                  seed=42, width=DEFAULT_WIDTH, height=DEFAULT_HEIGHT,
                  num_frames=DEFAULT_FRAMES, steps=DEFAULT_STEPS, cfg=DEFAULT_CFG):
    """
    Wan 2.2 FirstLastFrame: 首帧+尾帧 → 中间过渡视频
    Uses WanFirstLastFrameToVideo
    """
    return {
        "1": {
            "class_type": "UNETLoader",
            "inputs": {
                "unet_name": MODELS["i2v_high_noise"],
                "weight_dtype": "fp8_e4m3fn"
            }
        },
        "2": {
            "class_type": "CLIPLoader",
            "inputs": {
                "clip_name": MODELS["text_encoder"],
                "type": "wan"
            }
        },
        "3": {
            "class_type": "VAELoader",
            "inputs": {
                "vae_name": MODELS["vae"]
            }
        },
        "4": {
            "class_type": "LoadImage",
            "inputs": {
                "image": first_frame_filename,
            }
        },
        "5": {
            "class_type": "LoadImage",
            "inputs": {
                "image": last_frame_filename,
            }
        },
        "6": {
            "class_type": "CLIPTextEncode",
            "inputs": {
                "text": prompt_text,
                "clip": ["2", 0],
            }
        },
        "7": {
            "class_type": "CLIPTextEncode",
            "inputs": {
                "text": negative_prompt,
                "clip": ["2", 0],
            }
        },
        # FirstLastFrame latent encoding
        "8": {
            "class_type": "WanFirstLastFrameToVideo",
            "inputs": {
                "positive": ["6", 0],
                "negative": ["7", 0],
                "vae": ["3", 0],
                "width": width,
                "height": height,
                "length": num_frames,
                "batch_size": 1,
            }
        },
        "9": {
            "class_type": "KSampler",
            "inputs": {
                "seed": seed,
                "steps": steps,
                "cfg": cfg,
                "sampler_name": DEFAULT_SAMPLER,
                "scheduler": DEFAULT_SCHEDULER,
                "denoise": 1.0,
                "model": ["1", 0],
                "positive": ["8", 0],
                "negative": ["8", 1],
                "latent_image": ["8", 2],
            }
        },
        "10": {
            "class_type": "VAEDecode",
            "inputs": {
                "samples": ["9", 0],
                "vae": ["3", 0],
            }
        },
        "11": {
            "class_type": "VHS_VideoCombine",
            "inputs": {
                "images": ["10", 0],
                "frame_rate": 27,
                "loop_count": 0,
                "filename_prefix": "wan22_fflf",
                "format": "video/h264-mp4",
                "pingpong": False,
                "save_output": True,
            }
        },
    }


# ── Runners ───────────────────────────────────────────────────────────────────
def run_workflow(name, prompt):
    print(f"\n{'='*60}")
    print(f"🎬 {name}")
    print(f"{'='*60}")
    prompt_id = submit_prompt(prompt)
    print(f"   ⏳ Waiting for completion...")
    try:
        hist = wait_for_done(prompt_id, timeout=900)
        files = copy_output_from_container(hist, OUTPUT_DIR)
        if not files:
            print(f"   ⚠️ No output files found")
        else:
            print(f"   ✅ Generated {len(files)} file(s)")
        return files
    except RuntimeError as e:
        print(f"   ❌ Error: {e}")
        return []
    except TimeoutError:
        print(f"   ❌ Timeout after 900s")
        return []


def check_comfyui():
    try:
        stats = api_get("/system_stats")
        print(f"   ✅ ComfyUI connected (v{stats['system']['comfyui_version']})")
        return True
    except Exception as e:
        print(f"   ❌ ComfyUI not reachable at {API}: {e}")
        return False


# ── Main ─────────────────────────────────────────────────────────────────────
def main():
    print("🚀 Wan 2.2 Demo Pipeline")
    print(f"   API: {API}")
    print(f"   Output: {OUTPUT_DIR}")
    
    if not check_comfyui():
        sys.exit(1)

    all_results = {}

    # ── Workflow 1: T2V ───────────────────────────────────────────────────
    print("\n📸 [W1] Text-to-Video")
    t2v_prompt = (
        "A young woman in a flowing red dress walks slowly through a neon-lit alley "
        "at night. Rain falls gently, reflecting colorful lights on wet pavement. "
        "Cinematic film still, moody atmosphere, volumetric lighting, 35mm film grain."
    )
    wf1 = build_w1_t2v(t2v_prompt, seed=20260607)
    all_results["t2v"] = run_workflow("W1: Text-to-Video", wf1)

    # ── Workflow 2: I2V Quick ─────────────────────────────────────────────
    print("\n📸 [W2] Image-to-Video Quick")
    # Upload the dragon reference image
    ref_path = "/home/kai/workspace/kais-aigc-platform/workflows/hp_dragon_ref.png"
    ref_name = upload_image_to_comfy(ref_path, "wan22_demo_dragon.png")
    
    i2v_prompt = (
        "A majestic dragon perches on a dark rocky cliff, wings slightly spread, "
        "breathing soft fire. Stormy sky background, cinematic lighting, "
        "dramatic atmosphere, epic fantasy."
    )
    wf2 = build_w2_i2v(ref_name, i2v_prompt, seed=20260608)
    all_results["i2v_quick"] = run_workflow("W2: I2V Quick", wf2)

    # ── Workflow 3: Animate Move (simplified T2V with start image) ────────
    print("\n📸 [W3] Animate Move")
    # Use the same reference image for character motion
    move_prompt = (
        "The dragon slowly spreads its wings and takes flight, soaring upward "
        "into the storm clouds. Epic motion, cinematic camera follows the dragon, "
        "dramatic wing beats."
    )
    wf3 = build_w3_animate_move(ref_name, move_prompt, seed=20260609)
    all_results["animate_move"] = run_workflow("W3: Animate Move", wf3)

    # ── Workflow 4: First-Last Frame ────────────────────────────────────────
    print("\n📸 [W4] First-Last Frame")
    # For demo: generate a first frame with FLUX, then use a rotated/modified version as last frame
    # For simplicity, we use the same image as both (will generate a looping-style video)
    # In production, you'd upload two different frames
    fflf_prompt = (
        "A woman in a red dress stands in a neon alley, rain falling. "
        "She slowly turns to face the camera. Cinematic, moody, volumetric lighting."
    )
    wf4 = build_w4_fflf(ref_name, ref_name, fflf_prompt, seed=20260610)
    all_results["fflf"] = run_workflow("W4: First-Last Frame", wf4)

    # ── Summary ───────────────────────────────────────────────────────────
    print(f"\n{'='*60}")
    print("🎉 Wan 2.2 Demo Complete!")
    print(f"{'='*60}")
    print(f"\n📁 Output directory: {OUTPUT_DIR}")
    for name, files in all_results.items():
        status = "✅" if files else "❌"
        print(f"\n{status} {name}: {len(files)} file(s)")
        for f in files:
            print(f"   • {f}")
    print(f"\n{'='*60}")


if __name__ == "__main__":
    main()
