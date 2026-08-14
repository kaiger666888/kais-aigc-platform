#!/usr/bin/env python3
"""
Case 08 (古装全速追逐 / 极高动态) → LightX2V Turbo LoRA v1.0 (4-step, 768p) 直跑 ComfyUI。

绕过 aigc-platform API (未启动), 直接 POST 工作流到 comfyui-primary:8188。
工作流拓扑精确复刻 src/routes/production/minimax-h3/generate.ts buildH3WorkflowLightX2V(mode=ref2va, variant=lightx2v-4)。

目标: 1344×768, 15s → 362 帧 (alignH3FrameCount(360)=362, 顶到 H3 训练上限 MAX_FRAMES=362)。
"""
import json, time, sys, uuid, shutil, subprocess, urllib.request, urllib.error, urllib.parse, os

COMFYUI = "http://localhost:8188"
CONTAINER = "comfyui-primary"
INPUT_DIR = "/root/ComfyUI/input"          # 容器内
CASE_DIR = "/home/kai/文档/LTX/validition_v1/08"
OUT_DIR = "/mnt/agents/output"

# ── CLI 参数: LENGTH (帧), 可选 SEED ──
# 默认 362 (15s 上限); 降帧试探 GPU 稳定性时覆盖。
LENGTH = int(sys.argv[1]) if len(sys.argv) > 1 else 362
SEED = int(sys.argv[2]) if len(sys.argv) > 2 else 1008
PREFIX = f"case08_lightx2v4_768p_{LENGTH}f"

# ── 配置常量 (复制自 config.ts, 避免依赖 TS 构建) ──
WIDTH, HEIGHT = 1344, 768
FPS = 24
FL2VA_MODEL = "minimax_h3_fl2va_int8_convrot.safetensors"
CLIP_NAME = "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors"
VIDEO_VAE = "minimax_h3_video_vae_fp16.safetensors"
AUDIO_VAE = "minimax_h3_audio_vae_fp32.safetensors"
LORA_NAME = "minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors"
SHIFT_VIDEO, SHIFT_AUDIO = 6.0, 3.0    # lightx2v-4: shift_video=6 (768p 训练)
STEPS = 4
SAMPLER = "res_multistep"
SCHEDULER = "simple"
NEG = "worst quality, blurry, jittery, distorted, inconsistent appearance, text, watermark, deformed, low quality"

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
    """docker cp 宿主文件进容器 input 目录, 返回容器内文件名。"""
    name = f"{uuid.uuid4().hex}{os.path.splitext(filename)[1] or '.png'}"
    dst = f"{INPUT_DIR}/{name}"
    subprocess.run(["docker", "cp", filename, f"{CONTAINER}:{dst}"],
                   check=True, capture_output=True, timeout=60)
    return name

def build_workflow(ref_files, prompt):
    """精确复刻 buildH3WorkflowLightX2V(mode=ref2va, variant=lightx2v-4)。"""
    ref0, ref1, ref2 = ref_files  # RN(1.jpg), WV(2.jpg), bg.png
    return {
        # loaders
        "10": {"class_type": "CLIPLoader", "inputs": {"clip_name": CLIP_NAME, "type": "minimax"}},
        "11": {"class_type": "VAELoader", "inputs": {"vae_name": VIDEO_VAE}},
        "12": {"class_type": "UNETLoader", "inputs": {"unet_name": FL2VA_MODEL, "weight_dtype": "default"}},
        "13": {"class_type": "VAELoader", "inputs": {"vae_name": AUDIO_VAE}},
        # SigmaShift (lightx2v-4: shift_video=6) + LightX2V LoRA
        "14_shift": {"class_type": "MiniMaxH3SigmaShift", "inputs": {
            "model": ["12", 0], "shift_video": SHIFT_VIDEO, "shift_audio": SHIFT_AUDIO}},
        "15": {"class_type": "LoraLoaderModelOnly", "inputs": {
            "model": ["14_shift", 0], "lora_name": LORA_NAME, "strength_model": 1.0}},
        # ref2va 参考图 LoadImage (14/141/142)
        "14":  {"class_type": "LoadImage", "inputs": {"image": ref0}},
        "141": {"class_type": "LoadImage", "inputs": {"image": ref1}},
        "142": {"class_type": "LoadImage", "inputs": {"image": ref2}},
        # 负面条件占位 (不可达, ComfyUI 跳过执行, 仅拓扑占位)
        "16": {"class_type": "MiniMaxH3ImageToVideo", "inputs": {
            "clip": ["10", 0], "vae": ["11", 0], "prompt": NEG, "width": WIDTH, "height": HEIGHT, "length": LENGTH}},
        # 正面条件 (ref2va): ref_images 通过结构化槽位注入
        "20": {"class_type": "MiniMaxH3ReferenceToVideo", "inputs": {
            "clip": ["10", 0], "vae": ["11", 0], "audio_vae": ["13", 0], "prompt": prompt,
            "width": WIDTH, "height": HEIGHT, "length": LENGTH, "ref_image_size": "match",
            "ref_images.ref_image_0": ["14", 0],
            "ref_images.ref_image_1": ["141", 0],
            "ref_images.ref_image_2": ["142", 0]}},
        # 采样链路 (BasicGuider/Scheduler 的 model = Node 15, 已含 SigmaShift+LoRA)
        "30": {"class_type": "KSamplerSelect", "inputs": {"sampler_name": SAMPLER}},
        "31": {"class_type": "BasicScheduler", "inputs": {
            "model": ["15", 0], "scheduler": SCHEDULER, "steps": STEPS, "denoise": 1.0}},
        "32": {"class_type": "RandomNoise", "inputs": {"noise_seed": SEED}},
        "33": {"class_type": "BasicGuider", "inputs": {"model": ["15", 0], "conditioning": ["20", 0]}},
        "34": {"class_type": "SamplerCustomAdvanced", "inputs": {
            "noise": ["32", 0], "guider": ["33", 0], "sampler": ["30", 0],
            "sigmas": ["31", 0], "latent_image": ["20", 1]}},
        # 解码 + 合并 + 保存
        "40": {"class_type": "VAEDecode", "inputs": {"samples": ["34", 0], "vae": ["11", 0]}},
        "41": {"class_type": "VAEDecodeAudio", "inputs": {"samples": ["34", 0], "vae": ["13", 0]}},
        "42": {"class_type": "CreateVideo", "inputs": {"images": ["40", 0], "fps": FPS, "audio": ["41", 0]}},
        "50": {"class_type": "SaveVideo", "inputs": {
            "video": ["42", 0], "filename_prefix": PREFIX, "format": "mp4", "codec": "auto"}},
    }

def main():
    t0 = time.time()
    log(f"Case 08 → LightX2V-4 @ {WIDTH}×{HEIGHT} {LENGTH}f ({LENGTH/FPS:.1f}s), seed={SEED}")

    # 1. 读 prompt
    with open(f"{CASE_DIR}/prompt.txt", encoding="utf-8") as f:
        prompt = f.read().strip()
    log(f"prompt 长度 {len(prompt)} 字符")

    # 2. 上传参考图进容器
    refs = [
        container_input(f"{CASE_DIR}/1.jpg"),    # RN 男
        container_input(f"{CASE_DIR}/2.jpg"),    # WV 女
        container_input(f"{CASE_DIR}/bg.png"),   # 场景
    ]
    log(f"参考图已上传容器: {refs}")

    # 3. 构建 + 提交
    wf = build_workflow(refs, prompt)
    try:
        resp = http_json(f"{COMFYUI}/prompt", {"prompt": wf, "client_id": "case08-runner"}, timeout=30)
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        log(f"❌ ComfyUI 拒绝 prompt (HTTP {e.code}): {body[:1500]}")
        sys.exit(2)
    prompt_id = resp["prompt_id"]
    log(f"✅ 已提交 prompt_id={prompt_id}")

    # 4. 轮询 (45 min 上限)
    TIMEOUT = 45 * 60
    last_progress = ""
    while time.time() - t0 < TIMEOUT:
        try:
            hist = http_json(f"{COMFYUI}/history/{prompt_id}", timeout=15)
        except Exception as e:
            log(f"history 查询异常 (忽略): {e}")
            time.sleep(5); continue
        if prompt_id in hist:
            entry = hist[prompt_id]
            status = entry.get("status", {})
            if status.get("completed") or status.get("status_str") == "success":
                outs = entry.get("outputs", {})
                log(f"🎉 完成 ({time.time()-t0:.0f}s)。outputs={json.dumps(outs)[:400]}")
                # 下载产物
                download_output(outs)
                return
            if status.get("status_str") == "error":
                log(f"❌ 执行失败: {json.dumps(status)[:1000]}")
                # 节点错误细节
                for n, e in (status.get("messages") or []):
                    log(f"   msg: {e}")
                sys.exit(3)
        # 进度
        try:
            q = http_json(f"{COMFYUI}/queue", timeout=10)
            prog = http_json(f"{COMFYUI}/progress", timeout=10)
            pinfo = f"run={len(q.get('queue_running',[]))} pending={len(q.get('queue_pending',[]))} step {prog.get('value','?')}/{prog.get('max','?')}"
            if pinfo != last_progress:
                log(f"… {pinfo}"); last_progress = pinfo
        except Exception:
            pass
        time.sleep(5)
    log(f"⏰ 超时 {TIMEOUT}s 未完成"); sys.exit(4)

def download_output(outs):
    """从 SaveVideo (node 50) 输出找文件并下载到 OUT_DIR。"""
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
        log(f"⚠️ 未在 outputs 找到 mp4, 原始={json.dumps(outs)[:800]}"); return
    fn, sf, tp = found
    q = f"?filename={urllib.parse.quote(fn)}&subfolder={urllib.parse.quote(sf)}&type={tp}"
    url = f"{COMFYUI}/view{q}"
    dst = os.path.join(OUT_DIR, fn)
    with urllib.request.urlopen(url, timeout=120) as r, open(dst, "wb") as f:
        shutil.copyfileobj(r, f)
    size = os.path.getsize(dst)
    log(f"📥 下载到 {dst} ({size/1024/1024:.1f} MB)")
    # 同时写一个稳定别名方便 HTML 引用
    alias = os.path.join(OUT_DIR, f"{PREFIX}.mp4")
    try:
        shutil.copy2(dst, alias); log(f"📥 别名 {alias}")
    except Exception as e:
        log(f"别名复制失败: {e}")

if __name__ == "__main__":
    main()
