#!/usr/bin/env python3
"""Build + queue the kais-validation Case 08 (极高动态全速追逐) render through the
H3 二采重绘放大 workflow. Parametric so OOM retries can dial res/frames without rewriting.

Env knobs:
  W_P1 / H_P1   pass-1 resolution (default 736x416 = 0.3 MP)
  FRAMES         generation length, must be ≡5 (mod 17) (default 158 ≈ 6.6s @24fps)
  SCALE_BY       pass-2 upscale (default 1.5)
  STEPS_P1 / STEPS_P2
  RUN=1          actually queue (default: just build + validate + print)
"""
import json, os, sys, urllib.request, uuid, time

HOST = os.environ.get("COMFY", "http://localhost:8188")
HERE = os.path.dirname(os.path.abspath(__file__))

W_P1 = int(os.environ.get("W_P1", "736")); H_P1 = int(os.environ.get("H_P1", "416"))
FRAMES = int(os.environ.get("FRAMES", "158"))
SCALE_BY = float(os.environ.get("SCALE_BY", "1.5"))
STEPS_P1 = int(os.environ.get("STEPS_P1", "16")); STEPS_P2 = int(os.environ.get("STEPS_P2", "8"))
DENOISE_P2 = float(os.environ.get("DENOISE_P2", "0.35")); AUDIO_DENOISE = 0.35; SCHEDULER = "beta"

UNET="minimax_h3_ref2va_pruned_int8_convrot.safetensors"
CLIP="qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors"
VAE_V="minimax_h3_video_vae_fp16.safetensors"; VAE_A="minimax_h3_audio_vae_fp32.safetensors"

# Case 08 prompt (English, full action chain) + ref tag prefix (TE-Speed convention)
CASE08_PROMPT = (
    "<Picture 1> is the man in the deep red embroidered robe with a black fur collar. "
    "<Picture 2> is the woman in the pale green ornate ancient dress. "
    "<Picture 3> is the scene background — the ancient Jiangnan village alley after rain.\n\n"
    + open(os.path.join(HERE, "case08_prompt.txt")).read()
)

def build():
    W = {}
    W["unet"]={"class_type":"UNETLoader","inputs":{"unet_name":UNET,"weight_dtype":"default"}}
    W["clip"]={"class_type":"CLIPLoader","inputs":{"clip_name":CLIP,"type":"minimax","device":"default"}}
    W["vae_video"]={"class_type":"VAELoader","inputs":{"vae_name":VAE_V}}
    W["vae_audio"]={"class_type":"VAELoader","inputs":{"vae_name":VAE_A}}
    W["te_model"]={"class_type":"TESpeedMiniMaxH3","inputs":{"model":["unet",0],"processing_control_value":0.12,
                   "processing_percent_1":0.1,"processing_percent_2":0.9,"mcs":2,"device":"auto"}}
    # 3 ref images (character, character, scene)
    W["ref1"]={"class_type":"LoadImage","inputs":{"image":"case08/1.jpg"}}
    W["ref2"]={"class_type":"LoadImage","inputs":{"image":"case08/2.jpg"}}
    W["refbg"]={"class_type":"LoadImage","inputs":{"image":"case08/bg.png"}}
    W["ref2va"]={"class_type":"MiniMaxH3ReferenceToVideo","inputs":{
        "clip":["clip",0],"vae":["vae_video",0],"audio_vae":["vae_audio",0],
        "prompt":CASE08_PROMPT,"width":W_P1,"height":H_P1,"length":FRAMES,"ref_image_size":"match",
        "ref_images.ref_image_0":["ref1",0],
        "ref_images.ref_image_1":["ref2",0],
        "ref_images.ref_image_2":["refbg",0]}}
    # pass 1
    W["noise1"]={"class_type":"RandomNoise","inputs":{"noise_seed":20260812}}
    W["sampler"]={"class_type":"KSamplerSelect","inputs":{"sampler_name":"euler"}}
    W["sigmas1"]={"class_type":"BasicScheduler","inputs":{"model":["te_model",0],"scheduler":SCHEDULER,"steps":STEPS_P1,"denoise":1.0}}
    W["guider1"]={"class_type":"BasicGuider","inputs":{"model":["te_model",0],"conditioning":["ref2va",0]}}
    W["pass1"]={"class_type":"SamplerCustomAdvanced","inputs":{"noise":["noise1",0],"guider":["guider1",0],
                "sampler":["sampler",0],"sigmas":["sigmas1",0],"latent_image":["ref2va",1]}}
    # upscale + pass 2
    W["noise2"]={"class_type":"RandomNoise","inputs":{"noise_seed":80808080}}
    W["sigmas2"]={"class_type":"BasicScheduler","inputs":{"model":["te_model",0],"scheduler":SCHEDULER,"steps":STEPS_P2,"denoise":DENOISE_P2}}
    W["upscaler"]={"class_type":"MiniMaxH3LatentUpscaleCombined","inputs":{
        "samples":["pass1",1],"scale_by":SCALE_BY,"method":"bilinear","model":["te_model",0],
        "noise":["noise2",0],"sigmas":["sigmas2",0],"audio_denoise":AUDIO_DENOISE,"positive":["ref2va",0]}}
    W["disable_noise"]={"class_type":"DisableNoise","inputs":{}}
    W["guider2"]={"class_type":"BasicGuider","inputs":{"model":["te_model",0],"conditioning":["upscaler",1]}}
    W["pass2"]={"class_type":"SamplerCustomAdvanced","inputs":{"noise":["disable_noise",0],"guider":["guider2",0],
                "sampler":["sampler",0],"sigmas":["sigmas2",0],"latent_image":["upscaler",0]}}
    W["decode_video"]={"class_type":"VAEDecode","inputs":{"samples":["pass2",0],"vae":["vae_video",0]}}
    W["decode_audio"]={"class_type":"VAEDecodeAudio","inputs":{"samples":["pass2",0],"vae":["vae_audio",0]}}
    W["create_video"]={"class_type":"CreateVideo","inputs":{"images":["decode_video",0],"fps":24,"audio":["decode_audio",0],"bit_depth":8}}
    W["save_video"]={"class_type":"SaveVideo","inputs":{"video":["create_video",0],"filename_prefix":"h3_redraw_case08","format":"auto","codec":"auto"}}
    return W

def validate(api):
    oi=json.load(urllib.request.urlopen(f"{HOST}/object_info",timeout=20))
    errs=[]
    for nid,node in api.items():
        ct=node["class_type"]
        if ct not in oi: errs.append(f"{nid}: unknown {ct}"); continue
        vi=set(); [vi.update(oi[ct]["input"].get(c,{}).keys()) for c in("required","optional")]
        for k,v in node["inputs"].items():
            # autogrow slots like ref_images.ref_image_0 aren't listed in object_info base keys
            if "." in k:
                continue
            if k not in vi: errs.append(f"{nid}.{k}: invalid input")
            # multi-link list
            if isinstance(v,list) and v and isinstance(v[0],list):
                for link in v:
                    if link[0] not in api: errs.append(f"{nid}.{k}: missing node {link[0]}")
            elif isinstance(v,list) and len(v)==2 and isinstance(v[0],str) and v[0] in api:
                pass
    if errs:
        print("VALIDATION FAILED:"); [print("  ✗",e) for e in errs]; sys.exit(1)
    print(f"✓ validated {len(api)} nodes | pass1 {W_P1}x{H_P1} -> pass2 ~{int(W_P1*SCALE_BY)}x{int(H_P1*SCALE_BY)} | {FRAMES} frames (~{FRAMES/24:.1f}s)")

def run(api):
    body=json.dumps({"prompt":api,"client_id":str(uuid.uuid4())}).encode()
    req=urllib.request.Request(f"{HOST}/prompt",data=body,headers={"Content-Type":"application/json"})
    try:
        resp=json.loads(urllib.request.urlopen(req,timeout=30).read())
    except urllib.error.HTTPError as e:
        print("REJECTED:",e.code); print(e.read().decode()[:2000]); sys.exit(2)
    if resp.get("node_errors"):
        print("NODE ERRORS:"); print(json.dumps(resp["node_errors"],indent=2,ensure_ascii=False)[:2000]); sys.exit(3)
    pid=resp["prompt_id"]; print(f"QUEUED {pid}")
    t0=time.time()
    while time.time()-t0 < 1500:
        try: h=json.loads(urllib.request.urlopen(f"{HOST}/history/{pid}",timeout=20).read())
        except Exception: time.sleep(10); continue
        if pid in h:
            rec=h[pid]; st=rec.get("status",{})
            if st.get("completed"):
                print(f"COMPLETED in {time.time()-t0:.0f}s")
                for nid,o in rec.get("outputs",{}).items():
                    for kind in("images","gifs","videos"):
                        for it in o.get(kind,[]):
                            print(f"  OUTPUT node={nid} file={it.get('filename')} subfolder={it.get('subfolder','')}")
                return
            if st.get("status_str")=="error":
                print("EXEC ERROR:",json.dumps(st,ensure_ascii=False)[:1500]); sys.exit(4)
        try:
            q=json.loads(urllib.request.urlopen(f"{HOST}/queue",timeout=10).read())
            print(f"  [{time.time()-t0:.0f}s] running={len(q.get('queue_running',[]))} pending={len(q.get('queue_pending',[]))}")
        except Exception: pass
        time.sleep(12)
    print("TIMEOUT"); sys.exit(5)

if __name__=="__main__":
    api=build()
    api_path=os.path.join(HERE,"h3_redraw_upscale_case08_api.json")
    json.dump(api,open(api_path,"w"),indent=2,ensure_ascii=False)
    validate(api)
    print(f"wrote {api_path}")
    if os.environ.get("RUN")=="1":
        run(api)
    else:
        print("RUN=1 to queue")
