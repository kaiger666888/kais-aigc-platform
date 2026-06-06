#!/usr/bin/env python3
"""Generate a FLUX image for LTX I2V demo, then run Kijai Workflow 1."""

import json, time, sys, os, urllib.request, urllib.error, subprocess

API = "http://localhost:8188"
OUTPUT_DIR = "/mnt/agents/output/gpu1"

def api_post(path, data):
    req = urllib.request.Request(
        f"{API}{path}",
        data=json.dumps(data).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())

def api_get(path):
    with urllib.request.urlopen(f"{API}{path}") as resp:
        return json.loads(resp.read())

def wait_for_done(prompt_id, timeout=300):
    start = time.time()
    while time.time() - start < timeout:
        try:
            hist = api_get(f"/history/{prompt_id}")
            if prompt_id in hist:
                status = hist[prompt_id].get("status", {})
                if status.get("completed", False) or status.get("status_str") == "success":
                    return hist[prompt_id]
                if status.get("status_str") == "error":
                    raise Exception(f"Workflow error: {status.get('messages', [])}")
        except urllib.error.HTTPError:
            pass
        time.sleep(3)
    raise TimeoutError(f"Timeout waiting for {prompt_id}")

def find_output(hist_entry):
    outputs = hist_entry.get("outputs", {})
    for node_id, node_out in outputs.items():
        if "images" in node_out:
            for img in node_out["images"]:
                subfolder = img.get("subfolder", "")
                filename = img.get("filename", "")
                if subfolder:
                    full_path = f"output/{subfolder}/{filename}"
                else:
                    full_path = f"output/{filename}"
                # Copy to our output dir
                container_path = f"/root/ComfyUI/{full_path}"
                return container_path, filename
    raise Exception("No image output found")


# ============================================================
# Step 1: Generate FLUX reference image (832x480)
# ============================================================
print("📸 Step 1: Generating FLUX reference image...")

flux_workflow = {
    "3": {
        "class_type": "KSampler",
        "inputs": {
            "seed": 42,
            "steps": 20,
            "cfg": 3.5,
            "sampler_name": "euler",
            "scheduler": "simple",
            "denoise": 1.0,
            "model": ["4", 0],
            "positive": ["6", 0],
            "negative": ["7", 0],
            "latent_image": ["5", 0],
        }
    },
    "4": {
        "class_type": "UNETLoader",
        "inputs": {
            "unet_name": "flux1-dev-fp8.safetensors",
            "weight_dtype": "fp8_e4m3fn"
        }
    },
    "5": {
        "class_type": "EmptyLatentImage",
        "inputs": {
            "width": 832,
            "height": 480,
            "batch_size": 1
        }
    },
    "6": {
        "class_type": "CLIPTextEncode",
        "inputs": {
            "text": "cinematic film still, a young woman in red dress standing in a neon-lit alley, night, rain, high detail, 35mm film grain, moody atmosphere",
            "clip": ["8", 0],
        }
    },
    "7": {
        "class_type": "CLIPTextEncode",
        "inputs": {
            "text": "blurry, low quality, distorted, ugly, watermark, text",
            "clip": ["8", 0],
        }
    },
    "8": {
        "class_type": "DualCLIPLoader",
        "inputs": {
            "clip_name1": "clip_l.safetensors",
            "clip_name2": "t5xxl_fp8_e4m3fn_scaled.safetensors",
            "type": "flux",
        }
    },
    "9": {
        "class_type": "VAEDecode",
        "inputs": {
            "samples": ["3", 0],
            "vae": ["10", 0],
        }
    },
    "10": {
        "class_type": "VAELoader",
        "inputs": {
            "vae_name": "flux1-ae.safetensors",
        }
    },
    "11": {
        "class_type": "SaveImage",
        "inputs": {
            "filename_prefix": "kijai_demo_ref",
            "images": ["9", 0],
        }
    },
}

try:
    prompt_data = api_post("/prompt", {"prompt": flux_workflow})
    prompt_id = prompt_data["prompt_id"]
    print(f"   Prompt ID: {prompt_id}")
    
    hist = wait_for_done(prompt_id, timeout=180)
    container_path, filename = find_output(hist)
    print(f"   ✅ Generated: {filename}")
    
    # Get the image data
    # The file is inside the container
    img_data = subprocess.run(
        ["docker", "exec", "comfyui-primary", "cat", container_path],
        capture_output=True
    )
    
    # Save to host
    host_path = f"{OUTPUT_DIR}/{filename}"
    with open(host_path, "wb") as f:
        f.write(img_data.stdout)
    print(f"   💾 Saved to: {host_path}")
    
except Exception as e:
    print(f"   ❌ FLUX generation failed: {e}")
    sys.exit(1)

print(f"\n✅ Reference image ready: {filename}")
print(f"   Next: Run Workflow 1 with this image as first frame")
