#!/usr/bin/env python3
"""Wan 2.2 Demo: Generate FLUX reference → run WF9 (quick I2V) + WF5 (T2V).

Prerequisites:
  - ComfyUI running at localhost:8188 (comfyui-primary container)
  - All Wan 2.2 models installed in container
  - FLUX model available for reference image generation

Output: /mnt/agents/output/gpu1/
"""

import json, time, sys, os, subprocess, urllib.request, urllib.error

API = "http://localhost:8188"
OUTPUT_DIR = "/mnt/agents/output/gpu1"
CONTAINER_COMFY = "/root/ComfyUI"

# Workflow JSON paths (inside container, mounted from host)
WF9_PATH = "/data/workspace/kais-aigc-platform/workflows/workflow9_wan_i2v_quick.json"
WF5_PATH = "/data/workspace/kais-aigc-platform/workflows/workflow5_wan_t2v.json"

os.makedirs(OUTPUT_DIR, exist_ok=True)


# ── Helpers ───────────────────────────────────────────────────────────────────
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
    """Poll ComfyUI history until prompt completes or errors."""
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


def copy_output_from_container(hist_entry, host_dir):
    """Find video/image output in ComfyUI history and copy to host."""
    outputs = hist_entry.get("outputs", {})
    results = []
    for node_id, node_out in outputs.items():
        for key in ("images", "gifs", "videos"):
            if key in node_out:
                for item in node_out[key]:
                    subfolder = item.get("subfolder", "")
                    filename = item.get("filename", "")
                    if subfolder:
                        container_path = f"{CONTAINER_COMFY}/output/{subfolder}/{filename}"
                    else:
                        container_path = f"{CONTAINER_COMFY}/output/{filename}"
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


def upload_image_to_comfy(image_path, name=None):
    """Upload an image to ComfyUI's input folder via API."""
    filename = name or os.path.basename(image_path)
    with open(image_path, "rb") as f:
        data = f.read()
    # Multipart upload
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
    print(f"   📤 Uploaded: {result}")
    return result.get("name", filename)


def load_workflow_json(path):
    """Load a LiteGraph workflow JSON and convert to API prompt format.
    
    For LiteGraph JSON, we need to convert it to the API format that
    ComfyUI expects: {node_id: {class_type, inputs}}.
    """
    # The ComfyUI /prompt endpoint accepts LiteGraph JSON directly with
    # {"prompt": workflow_litegraph, ...} — it handles conversion internally.
    # But it's safer to use the /api endpoint or convert manually.
    
    # Actually, ComfyUI accepts LiteGraph format via the "extra" field approach.
    # The simplest way: use the graph-to-prompt conversion.
    return path


def run_workflow_from_file(wf_path, overrides=None):
    """Load a LiteGraph workflow file and submit via /prompt.
    
    Overrides: dict of {node_id: {widget_name: value}} to patch before submission.
    """
    with open(wf_path, "r") as f:
        wf = json.load(f)
    
    # Apply overrides
    if overrides:
        for n in wf["nodes"]:
            nid = str(n["id"])
            if nid in overrides:
                widgets = overrides[nid]
                wv = list(n.get("widgets_values", []))
                # Simple override: replace by index position
                for idx, val in widgets.items():
                    if isinstance(idx, int) and idx < len(wv):
                        wv[idx] = val
                n["widgets_values"] = wv
    
    # Submit to ComfyUI (it accepts LiteGraph JSON in prompt field)
    prompt_data = api_post("/prompt", {"prompt": wf})
    prompt_id = prompt_data["prompt_id"]
    print(f"   🚀 Prompt ID: {prompt_id}")
    
    hist = wait_for_done(prompt_id, timeout=600)
    return hist


def copy_to_container(host_path, container_dest):
    """Copy a file from host to container."""
    subprocess.run(
        ["docker", "cp", host_path, f"comfyui-primary:{container_dest}"],
        check=True, capture_output=True
    )


# ── Step 1: Generate FLUX Reference Image ────────────────────────────────────
def generate_flux_reference():
    """Generate an 832x480 reference image using FLUX."""
    print("\n📸 Step 1: Generating FLUX reference image (832x480)...")
    
    flux_prompt = {
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
            "inputs": {"width": 832, "height": 480, "batch_size": 1}
        },
        "6": {
            "class_type": "CLIPTextEncode",
            "inputs": {
                "text": "cinematic film still, a young woman in red dress standing in a neon-lit alley at night, rain reflecting neon signs, moody atmosphere, 35mm film grain, volumetric lighting",
                "clip": ["8", 0],
            }
        },
        "7": {
            "class_type": "CLIPTextEncode",
            "inputs": {
                "text": "blurry, low quality, distorted, watermark, text",
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
            "inputs": {"vae_name": "flux1-ae.safetensors"}
        },
        "11": {
            "class_type": "SaveImage",
            "inputs": {
                "filename_prefix": "wan_demo_ref",
                "images": ["9", 0],
            }
        },
    }
    
    prompt_data = api_post("/prompt", {"prompt": flux_prompt})
    prompt_id = prompt_data["prompt_id"]
    print(f"   Prompt ID: {prompt_id}")
    
    hist = wait_for_done(prompt_id, timeout=180)
    files = copy_output_from_container(hist, OUTPUT_DIR)
    
    if not files:
        print("   ❌ No image generated!")
        sys.exit(1)
    
    img_path = files[0]
    print(f"   ✅ Reference image: {img_path}")
    return img_path


# ── Step 2: Upload image to ComfyUI and update workflow ───────────────────────
def prepare_i2v_workflow(img_path):
    """Upload image and patch WF9 with the correct filename."""
    print(f"\n📤 Step 2: Uploading reference image to ComfyUI...")
    
    img_name = upload_image_to_comfy(img_path, "wan_demo_ref.png")
    
    # Patch workflow9: set LoadImage filename
    wf_path = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                          "workflow9_wan_i2v_quick.json")
    with open(wf_path, "r") as f:
        wf = json.load(f)
    
    for n in wf["nodes"]:
        if n["type"] == "LoadImage":
            # widgets_values: [filename, image_subfolder]
            wv = list(n.get("widgets_values", []))
            wv[0] = img_name
            n["widgets_values"] = wv
            print(f"   📝 Patched LoadImage → {img_name}")
    
    # Save patched version
    patched_path = os.path.join(OUTPUT_DIR, "workflow9_patched.json")
    with open(patched_path, "w") as f:
        json.dump(wf, f, indent=2, ensure_ascii=False)
    
    return patched_path


# ── Step 3: Run Workflow 9 (Quick I2V) ──────────────────────────────────────
def run_i2v_quick(wf_path):
    print(f"\n🎬 Step 3: Running Workflow 9 (Wan 2.2 I2V Quick)...")
    hist = run_workflow_from_file(wf_path)
    files = copy_output_from_container(hist, OUTPUT_DIR)
    print(f"   ✅ I2V Quick output: {len(files)} file(s)")
    return files


# ── Step 4: Run Workflow 5 (T2V) ────────────────────────────────────────────
def run_t2v(wf_path):
    print(f"\n🎬 Step 4: Running Workflow 5 (Wan 2.2 T2V)...")
    hist = run_workflow_from_file(wf_path)
    files = copy_output_from_container(hist, OUTPUT_DIR)
    print(f"   ✅ T2V output: {len(files)} file(s)")
    return files


# ── Step 5: Summary ─────────────────────────────────────────────────────────
def print_summary(ref_img, i2v_files, t2v_files):
    print(f"\n{'='*60}")
    print("🎉 Wan 2.2 Demo Complete!")
    print(f"{'='*60}")
    print(f"\n📁 Output directory: {OUTPUT_DIR}")
    print(f"\n📸 Reference image: {ref_img}")
    print(f"\n🎬 I2V Quick (WF9) videos:")
    for f in i2v_files:
        print(f"   • {f}")
    print(f"\n🎬 T2V (WF5) videos:")
    for f in t2v_files:
        print(f"   • {f}")
    print(f"\n{'='*60}")


# ── Main ─────────────────────────────────────────────────────────────────────
def main():
    print("🚀 Wan 2.2 Demo Pipeline")
    print(f"   API: {API}")
    print(f"   Output: {OUTPUT_DIR}")
    
    # Check ComfyUI is running
    try:
        api_get("/system_stats")
    except Exception as e:
        print(f"❌ ComfyUI not reachable at {API}: {e}")
        sys.exit(1)
    print("   ✅ ComfyUI connected")
    
    # Step 1: FLUX reference image
    ref_img = generate_flux_reference()
    
    # Step 2: Upload + patch WF9
    patched_wf9 = prepare_i2v_workflow(ref_img)
    
    # Step 3: Run I2V Quick
    i2v_files = run_i2v_quick(patched_wf9)
    
    # Step 4: Run T2V
    wf5_path = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                           "workflow5_wan_t2v.json")
    t2v_files = run_t2v(wf5_path)
    
    # Step 5: Summary
    print_summary(ref_img, i2v_files, t2v_files)


if __name__ == "__main__":
    main()
