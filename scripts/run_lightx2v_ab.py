#!/usr/bin/env python3
"""
kais-validation 高动态 case (07/08) → LightX2V Turbo LoRA v1.0 vs v1.1 A/B 直跑 ComfyUI。

用法: run_lightx2v_ab.py <lora_version> <case> [seed]
  lora_version: v1.0 | v1.1
  case: 07 | 08
拓扑: 精确复刻 KAP generate.ts buildH3WorkflowLightX2V(mode=ref2va, variant=lightx2v-4)。
参数: 官方对齐版 (commit 931136e8): steps=5 (4去噪+1终步), euler, strength=1.0, shift 6/3。
"""
import json, time, sys, uuid, shutil, subprocess, urllib.request, urllib.error, urllib.parse, os

COMFYUI = "http://localhost:8188"
CONTAINER = "comfyui-primary"
INPUT_DIR = "/root/ComfyUI/input"
OUT_DIR = "/mnt/agents/output/lightx2v_ab"

LORA_VERSION = sys.argv[1] if len(sys.argv) > 1 else "v1.1"
CASE = sys.argv[2] if len(sys.argv) > 2 else "08"
SEED = int(sys.argv[3]) if len(sys.argv) > 3 else 1008
CASE_DIR = f"/home/kai/文档/LTX/validition_v1/{CASE}"

WIDTH, HEIGHT, FPS, LENGTH = 1216, 672, 24, 362
FL2VA_MODEL = "minimax_h3_fl2va_int8_convrot.safetensors"
CLIP_NAME = "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors"
VIDEO_VAE = "minimax_h3_video_vae_fp16.safetensors"
AUDIO_VAE = "minimax_h3_audio_vae_fp32.safetensors"

LORAS = {
    "v1.0": "minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors",
    "v1.1": "minimax_h3_fl2v_turbo_4step_v1.1_768p_comfyui_bf16.safetensors",
}
LORA_NAME = LORAS[LORA_VERSION]
SHIFT_VIDEO, SHIFT_AUDIO = 6.0, 3.0
STEPS = 5          # 官方 infer_steps=5 (4步去噪+1终步sigma=0)
SAMPLER = "euler"  # 官方 training_euler
SCHEDULER = "simple"
NEG = "worst quality, blurry, jittery, distorted, inconsistent appearance, text, watermark, deformed, low quality"
PREFIX = f"case{CASE}_lightx2v4_{LORA_VERSION}_{LENGTH}f_{WIDTH}x{HEIGHT}"

def log(m): print(f"[{time.strftime('%H:%M:%S')}] {m}", flush=True)

def http_json(url, data=None, timeout=30):
    if data is not None:
        req = urllib.request.Request(url, data=json.dumps(data).encode(),
                                     headers={"Content-Type": "application/json"}, method="POST")
    else:
        req = urllib.request.Request(url)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())

def container_input(filename):
    name = f"{uuid.uuid4().hex}{os.path.splitext(filename)[1] or '.png'}"
    dst = f"{INPUT_DIR}/{name}"
    subprocess.run(["docker", "cp", filename, f"{CONTAINER}:{dst}"],
                   check=True, capture_output=True, timeout=60)
    return name

def build_workflow(ref_files, prompt):
    ref0, ref1, ref2 = ref_files
    return {
        "10": {"class_type": "CLIPLoader", "inputs": {"clip_name": CLIP_NAME, "type": "minimax"}},
        "11": {"class_type": "VAELoader", "inputs": {"vae_name": VIDEO_VAE}},
        "12": {"class_type": "UNETLoader", "inputs": {"unet_name": FL2VA_MODEL, "weight_dtype": "default"}},
        "13": {"class_type": "VAELoader", "inputs": {"vae_name": AUDIO_VAE}},
        "14_shift": {"class_type": "MiniMaxH3SigmaShift", "inputs": {
            "model": ["12", 0], "shift_video": SHIFT_VIDEO, "shift_audio": SHIFT_AUDIO}},
        "15": {"class_type": "LoraLoaderModelOnly", "inputs": {
            "model": ["14_shift", 0], "lora_name": LORA_NAME, "strength_model": 1.0}},
        "14":  {"class_type": "LoadImage", "inputs": {"image": ref0}},
        "141": {"class_type": "LoadImage", "inputs": {"image": ref1}},
        "142": {"class_type": "LoadImage", "inputs": {"image": ref2}},
        "16": {"class_type": "MiniMaxH3ImageToVideo", "inputs": {
            "clip": ["10", 0], "vae": ["11", 0], "prompt": NEG,
            "width": WIDTH, "height": HEIGHT, "length": LENGTH}},
        "20": {"class_type": "MiniMaxH3ReferenceToVideo", "inputs": {
            "clip": ["10", 0], "vae": ["11", 0], "audio_vae": ["13", 0], "prompt": prompt,
            "width": WIDTH, "height": HEIGHT, "length": LENGTH, "ref_image_size": "match",
            "ref_images.ref_image_0": ["14", 0],
            "ref_images.ref_image_1": ["141", 0],
            "ref_images.ref_image_2": ["142", 0]}},
        "30": {"class_type": "KSamplerSelect", "inputs": {"sampler_name": SAMPLER}},
        "31": {"class_type": "BasicScheduler", "inputs": {
            "model": ["15", 0], "scheduler": SCHEDULER, "steps": STEPS, "denoise": 1.0}},
        "32": {"class_type": "RandomNoise", "inputs": {"noise_seed": SEED}},
        "33": {"class_type": "BasicGuider", "inputs": {"model": ["15", 0], "conditioning": ["20", 0]}},
        "34": {"class_type": "SamplerCustomAdvanced", "inputs": {
            "noise": ["32", 0], "guider": ["33", 0], "sampler": ["30", 0],
            "sigmas": ["31", 0], "latent_image": ["20", 1]}},
        "40": {"class_type": "VAEDecode", "inputs": {"samples": ["34", 0], "vae": ["11", 0]}},
        "41": {"class_type": "VAEDecodeAudio", "inputs": {"samples": ["34", 0], "vae": ["13", 0]}},
        "42": {"class_type": "CreateVideo", "inputs": {"images": ["40", 0], "fps": FPS, "audio": ["41", 0]}},
        "50": {"class_type": "SaveVideo", "inputs": {
            "video": ["42", 0], "filename_prefix": PREFIX, "format": "mp4", "codec": "auto"}},
    }

def download_output(outs):
    os.makedirs(OUT_DIR, exist_ok=True)
    found = None
    for node_id, out in outs.items():
        gifs = out.get("gifs") or out.get("images") or out.get("videos") or []
        for g in gifs:
            fn = g.get("filename"); sf = g.get("subfolder", ""); tp = g.get("type", "output")
            if fn and fn.endswith(".mp4"):
                found = (fn, sf, tp); break
        if found: break
    if not found:
        log(f"⚠️ 未找到 mp4, 原始={json.dumps(outs)[:800]}"); return
    fn, sf, tp = found
    q = f"?filename={urllib.parse.quote(fn)}&subfolder={urllib.parse.quote(sf)}&type={tp}"
    with urllib.request.urlopen(f"{COMFYUI}/view{q}", timeout=120) as r, open(os.path.join(OUT_DIR, fn), "wb") as f:
        shutil.copyfileobj(r, f)
    alias = os.path.join(OUT_DIR, f"{PREFIX}_seed{SEED}.mp4")
    shutil.copy2(os.path.join(OUT_DIR, fn), alias)
    log(f"📥 {alias} ({os.path.getsize(alias)/1024/1024:.1f} MB)")

def main():
    t0 = time.time()
    log(f"Case {CASE} → LightX2V-4 {LORA_VERSION} @ {WIDTH}×{HEIGHT} {LENGTH}f, seed={SEED}")
    with open(f"{CASE_DIR}/prompt.txt", encoding="utf-8") as f:
        prompt = f.read().strip()
    log(f"prompt {len(prompt)} chars, LoRA={LORA_NAME}")
    refs = [container_input(f"{CASE_DIR}/1.jpg"),
            container_input(f"{CASE_DIR}/2.jpg"),
            container_input(f"{CASE_DIR}/bg.png")]
    wf = build_workflow(refs, prompt)
    try:
        resp = http_json(f"{COMFYUI}/prompt", {"prompt": wf, "client_id": "lx2v-ab"})
    except urllib.error.HTTPError as e:
        log(f"❌ HTTP {e.code}: {e.read().decode()[:1500]}"); sys.exit(2)
    pid = resp["prompt_id"]; log(f"✅ prompt_id={pid}")
    TIMEOUT = 45 * 60; last = ""
    while time.time() - t0 < TIMEOUT:
        try:
            hist = http_json(f"{COMFYUI}/history/{pid}", timeout=15)
        except Exception as e:
            log(f"history 异常(忽略): {e}"); time.sleep(5); continue
        if pid in hist:
            entry = hist[pid]; status = entry.get("status", {})
            if status.get("completed") or status.get("status_str") == "success":
                log(f"🎉 完成 ({time.time()-t0:.0f}s)")
                download_output(entry.get("outputs", {})); return
            if status.get("status_str") == "error":
                log(f"❌ 失败: {json.dumps(status)[:1000]}"); sys.exit(3)
        try:
            prog = http_json(f"{COMFYUI}/progress", timeout=10)
            pinfo = f"step {prog.get('value','?')}/{prog.get('max','?')}"
            if pinfo != last: log(f"… {pinfo}"); last = pinfo
        except Exception: pass
        time.sleep(5)
    log(f"⏰ 超时"); sys.exit(4)

if __name__ == "__main__":
    main()
