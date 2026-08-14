#!/usr/bin/env python3
"""
LTX-2.5 T2V demo — 验证 2.5 int8_convrot 在 3090/24GB 上能跑出视频。

模型(已下到 /data/models/comfyui):
  - transformer: ltx-2.5-22b-distilled-transformer-comfy-int8-convrot (int8_convrot, 21.5G)
  - encoder:     gemma4-12b-with-proj-ltx-2.5-bf16 (Gemma4 12B, 26G)
  - vae:         ltx-2.5-video-vae-bf16
  - lora:        ltx-2.5-22b-distilled-lora-450-bf16 (distilled 配套)

加载链(与 2.3 int8 蒸馏同构,encoder 换 LTXVGemmaCLIPModelLoader):
  OTUNetLoaderW8A8(int8 transformer) + distilled LoRA
  → LTXVGemmaCLIPModelLoader → CLIPTextEncode×2 → LTXVConditioning
  → EmptyLTXVLatentVideo → SamplerCustomAdvanced(ManualSigmas 9步 + CFGGuider cfg=1)
  → VAEDecode → SaveAnimatedPNG
"""
import json, time, sys, urllib.request, urllib.parse

COMFY = "http://localhost:8188"
CLIENT_ID = "ltx25-demo"

TRANSFORMER = "ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors"
ENCODER = "gemma4-12b-with-proj-ltx-2.5-bf16/gemma4-12b-with-proj-ltx-2.5-bf16.safetensors"
VAE = "ltx-2.5-video-vae-conv-bf16.safetensors"
LORA = "ltx-2.5-22b-distilled-lora-450-bf16.safetensors"

POS = ("A cinematic tracking shot of a golden retriever puppy running through a "
       "sunflower field at golden hour, slow motion, warm light, shallow depth of field, "
       "dust particles in the air, photorealistic.")
NEG = "blurry, low quality, distorted, watermark, text, signature, cartoon"

# 2.3 distilled 9-step sigma(2.5 先试同样,跑通后再调 2.5 专用)
SIGMAS = "1.0,0.99375,0.9875,0.98125,0.975,0.909375,0.725,0.421875,0.0"

WIDTH, HEIGHT, LENGTH, FPS, SEED = 768, 512, 97, 24, 42  # 97帧@24fps≈4s, 8n+1


def build_workflow():
    return {
        # 1. 加载 int8 transformer(OTUNetLoaderW8A8 + enable_convrot,同 2.3 路径)
        "1": {"class_type": "OTUNetLoaderW8A8", "inputs": {
            "unet_name": TRANSFORMER, "weight_dtype": "default", "model_type": "ltx2",
            "on_the_fly_quantization": False, "enable_convrot": True, "lora_mode": "None"}},
        # 2. distilled 配套 LoRA(2.3 也是 distilled+lora,2.5 同理)
        "2": {"class_type": "LoraLoaderModelOnly", "inputs": {
            "model": ["1", 0], "lora_name": LORA, "strength_model": 1.0}},
        # 3. Gemma4 encoder(ltxv_path 先试 transformer,跑报错再调)
        "3": {"class_type": "LTXVGemmaCLIPModelLoader", "inputs": {
            "gemma_path": ENCODER, "ltxv_path": TRANSFORMER, "max_length": 512}},
        # 4-5. 文本编码
        "4": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["3", 0], "text": POS}},
        "5": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["3", 0], "text": NEG}},
        # 6. 空 video latent
        "6": {"class_type": "EmptyLTXVLatentVideo", "inputs": {
            "width": WIDTH, "height": HEIGHT, "length": LENGTH, "batch_size": 1}},
        # 7. LTXV conditioning(加 frame_rate)
        "7": {"class_type": "LTXVConditioning", "inputs": {
            "positive": ["4", 0], "negative": ["5", 0], "frame_rate": FPS}},
        # 8-11. 蒸馏采样器链(ManualSigmas + euler + cfg=1)
        "8": {"class_type": "RandomNoise", "inputs": {"noise_seed": SEED}},
        "9": {"class_type": "KSamplerSelect", "inputs": {"sampler_name": "euler"}},
        "10": {"class_type": "CFGGuider", "inputs": {
            "model": ["2", 0], "positive": ["7", 0], "negative": ["7", 1], "cfg": 1.0}},
        "11": {"class_type": "ManualSigmas", "inputs": {"sigmas": SIGMAS}},
        "12": {"class_type": "SamplerCustomAdvanced", "inputs": {
            "noise": ["8", 0], "guider": ["10", 0], "sampler": ["9", 0],
            "sigmas": ["11", 0], "latent_image": ["6", 0]}},
        # 13-14. VAE decode
        "13": {"class_type": "VAELoader", "inputs": {"vae_name": VAE}},
        "14": {"class_type": "VAEDecode", "inputs": {"samples": ["12", 0], "vae": ["13", 0]}},
        # 15. 保存(webp 动画,先验证能跑;mp4 后续)
        "15": {"class_type": "SaveAnimatedPNG", "inputs": {
            "images": ["14", 0], "filename_prefix": "ltx25_demo", "fps": FPS, "compress_level": 4}},
    }


def post(path, data=None):
    url = COMFY + path
    if data is not None:
        req = urllib.request.Request(url, data=json.dumps(data).encode(),
                                     headers={"Content-Type": "application/json"})
    else:
        req = urllib.request.Request(url)
    return json.loads(urllib.request.urlopen(req, timeout=30).read())


def main():
    wf = build_workflow()
    print(f"=== 提交 LTX-2.5 T2V demo({WIDTH}x{HEIGHT} {LENGTH}帧@{FPS}fps,9步)===")
    try:
        r = post("/prompt", {"prompt": wf, "client_id": CLIENT_ID})
    except urllib.error.HTTPError as e:
        print("提交失败:", e.read().decode()[:500]); sys.exit(1)
    if "error" in r:
        print("工作流错误:", json.dumps(r["error"], ensure_ascii=False)[:600]); sys.exit(1)
    pid = r["prompt_id"]
    print(f"prompt_id={pid}")

    print("=== 轮询执行 ===")
    start = time.time()
    last_node = None
    while time.time() - start < 900:  # 15min 上限
        try:
            q = post("/queue")
            run = q.get("queue_running", [])
            if run:
                # 看当前执行节点
                pass
        except Exception:
            pass
        try:
            h = post("/history/" + pid)
            if pid in h:
                o = h[pid]
                status = o.get("status", {}).get("status_str", "?")
                print(f"\n=== 完成 status={status} 用时 {int(time.time()-start)}s ===")
                if status == "error":
                    print("错误详情:", json.dumps(o.get("status", {}), ensure_ascii=False)[:800])
                for nid, out in o.get("outputs", {}).items():
                    print(f"  节点 {nid}: {json.dumps(out, ensure_ascii=False)[:200]}")
                # 下载结果
                for nid, out in o.get("outputs", {}).items():
                    for img in out.get("images", out.get("gifs", [])):
                        fn, sub = img["filename"], img.get("subfolder", "")
                        url = f"{COMFY}/view?filename={urllib.parse.quote(fn)}&subfolder={urllib.parse.quote(sub)}&type=output"
                        print(f"  结果: {url}")
                return
        except Exception:
            pass
        time.sleep(3)
        if int(time.time() - start) % 15 < 3:
            print(f"  ...{int(time.time()-start)}s", flush=True)
    print("超时")


if __name__ == "__main__":
    main()
