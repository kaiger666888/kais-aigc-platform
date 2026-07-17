#!/usr/bin/env python3
"""
Flux Kontext Dev 微服务
独立运行，不依赖 kais-aigc-platform 主服务

POST /api/production/flux/kontext-generate
  multipart: reference_image (必选)
  body: prompt, negative_prompt?, width?, height?, seed?, steps?, guidance?
"""

from flask import Flask, request, jsonify
import subprocess, json, time, os, uuid, shutil

app = Flask(__name__)

COMFYUI_URL = os.environ.get("COMFYUI_URL", "http://localhost:8188")
CONTAINER_NAME = os.environ.get("COMFYUI_CONTAINER", "comfyui-primary")
STAGING_DIR = "/tmp/kontext-staging"
os.makedirs(STAGING_DIR, exist_ok=True)

def copy_to_container(local_path, container_path):
    subprocess.run(["docker", "cp", local_path, f"{CONTAINER_NAME}:{container_path}"], 
                   check=True, timeout=30)

def build_workflow(prompt, negative_prompt, width, height, seed, steps, guidance, ref_name, prefix):
    return {
        "10": {"class_type": "LoadImage", "inputs": {"image": ref_name}},
        "11": {"class_type": "FluxKontextImageScale", "inputs": {"image": ["10", 0]}},
        "12": {"class_type": "VAELoader", "inputs": {"vae_name": "flux1-dev-ae.safetensors"}},
        "13": {"class_type": "VAEEncode", "inputs": {"pixels": ["11", 0], "vae": ["12", 0]}},
        "14": {"class_type": "UNETLoader", "inputs": {
            "unet_name": "flux1-kontext-dev-fp8.safetensors", "weight_dtype": "fp8_e4m3fn"}},
        "15": {"class_type": "DualCLIPLoader", "inputs": {
            "clip_name1": "clip_l.safetensors", "clip_name2": "t5xxl_fp8_e4m3fn.safetensors", "type": "flux"}},
        "20": {"class_type": "CLIPTextEncode", "inputs": {"text": prompt, "clip": ["15", 0]}},
        "22": {"class_type": "CLIPTextEncode", "inputs": {"text": negative_prompt, "clip": ["15", 0]}},
        "25": {"class_type": "FluxKontextConditioning", "inputs": {
            "positive": ["20", 0], "negative": ["22", 0], "reference_latent": ["13", 0]}},
        "30": {"class_type": "EmptySD3LatentImage", "inputs": {"width": width, "height": height, "batch_size": 1}},
        "40": {"class_type": "KSampler", "inputs": {
            "seed": seed, "steps": steps, "cfg": guidance, "sampler_name": "euler",
            "scheduler": "simple", "denoise": 1.0, "model": ["14", 0],
            "positive": ["25", 0], "negative": ["25", 1], "latent_image": ["30", 0]}},
        "50": {"class_type": "VAEDecode", "inputs": {"samples": ["40", 0], "vae": ["12", 0]}},
        "60": {"class_type": "SaveImage", "inputs": {"filename_prefix": prefix, "images": ["50", 0]}},
    }

@app.route("/api/production/flux/kontext-generate", methods=["POST"])
def kontext_generate():
    import urllib.request
    
    start = time.time()
    
    if "reference_image" not in request.files:
        return jsonify({"error": "reference_image is required"}), 400
    
    prompt = request.form.get("prompt")
    if not prompt:
        return jsonify({"error": "prompt is required"}), 400
    
    negative_prompt = request.form.get("negative_prompt", "")
    width = int(request.form.get("width", 1024))
    height = int(request.form.get("height", 1024))
    seed = int(request.form.get("seed", 0)) or random_seed()
    steps = int(request.form.get("steps", 28))
    guidance = float(request.form.get("guidance", 3.5))
    
    job_id = uuid.uuid4().hex[:8]
    
    # 1. Save and upload reference image
    ref_file = request.files["reference_image"]
    ref_ext = os.path.splitext(ref_file.filename)[1] or ".png"
    ref_local = os.path.join(STAGING_DIR, f"ref_{job_id}{ref_ext}")
    ref_file.save(ref_local)
    
    ref_name = f"kontext_ref_{job_id}{ref_ext}"
    copy_to_container(ref_local, f"/root/ComfyUI/input/{ref_name}")
    
    # 2. Build and submit workflow
    prefix = f"kontext_{job_id}"
    workflow = build_workflow(prompt, negative_prompt, width, height, seed, steps, guidance, ref_name, prefix)
    
    data = json.dumps({"prompt": workflow}).encode("utf-8")
    req = urllib.request.Request(f"{COMFYUI_URL}/prompt", data=data, 
                                 headers={"Content-Type": "application/json"})
    resp = urllib.request.urlopen(req, timeout=30)
    prompt_id = json.loads(resp.read())["prompt_id"]
    
    # 3. Poll for completion
    images = []
    for i in range(120):
        time.sleep(5)
        try:
            hist = json.loads(urllib.request.urlopen(f"{COMFYUI_URL}/history/{prompt_id}").read())
            if prompt_id in hist:
                entry = hist[prompt_id]
                status = entry.get("status", {})
                if status.get("status_str") == "error":
                    msgs = status.get("messages", [])
                    for m in msgs:
                        if isinstance(m, list) and len(m) > 1 and isinstance(m[1], dict):
                            if "exception_message" in m[1]:
                                return jsonify({"error": m[1]["exception_message"]}), 500
                    return jsonify({"error": "ComfyUI execution error"}), 500
                
                outputs = entry.get("outputs", {})
                if "60" in outputs:
                    for img in outputs["60"].get("images", []):
                        fname = img["filename"]
                        subfolder = img.get("subfolder", "")
                        img_url = f"{COMFYUI_URL}/view?filename={fname}&subfolder={subfolder}&type=output"
                        images.append({"url": img_url, "filename": fname})
                    break
        except:
            pass
    
    elapsed = int((time.time() - start) * 1000)
    
    # Cleanup
    try: os.unlink(ref_local)
    except: pass
    
    if not images:
        return jsonify({"error": "Generation timeout"}), 504
    
    return jsonify({
        "success": True,
        "message": "Kontext generation complete",
        "data": {
            "images": images,
            "seed": seed,
            "steps": steps,
            "guidance": guidance,
            "elapsed_ms": elapsed,
        }
    })

@app.route("/api/production/flux/kontext-status", methods=["GET"])
def kontext_status():
    return jsonify({
        "service": "flux-kontext",
        "status": "running",
        "comfyui_url": COMFYUI_URL,
        "container": CONTAINER_NAME,
    })

def random_seed():
    import random
    return random.randint(1, 999999)

if __name__ == "__main__":
    port = int(os.environ.get("KONTEXT_PORT", 10591))
    print(f"[Flux Kontext Service] http://localhost:{port}")
    app.run(host="0.0.0.0", port=port, threaded=False)
