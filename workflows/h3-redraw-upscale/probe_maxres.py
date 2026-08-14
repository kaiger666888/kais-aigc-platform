#!/usr/bin/env python3
"""Single-pass probe to find the MAX resolution runnable at a given frame count on 24GB.

Low steps (default 4) — enough to trigger the model forward / OOM, cheap to fail.
OOM behavior is set by the forward pass at (res, frames), independent of step count,
so low-step probes reliably locate the ceiling.

Env: FRAMES (default 328 ≈14s@24fps), W, H, STEPS (default 4), RUN=1 to queue.
"""
import json, os, sys, urllib.request, uuid, time
HOST=os.environ.get("COMFY","http://localhost:8188")
HERE=os.path.dirname(os.path.abspath(__file__))
FRAMES=int(os.environ.get("FRAMES","328"))
W=int(os.environ.get("W","736")); H=int(os.environ.get("H","416"))
STEPS=int(os.environ.get("STEPS","4"))
UNET="minimax_h3_ref2va_pruned_int8_convrot.safetensors"
CLIP="qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors"
VAE_V="minimax_h3_video_vae_fp16.safetensors"; VAE_A="minimax_h3_audio_vae_fp32.safetensors"
PROMPT=open(os.path.join(HERE,"case08_prompt.txt")).read()[:400]  # short prompt for probe

def build():
    j={}
    j["unet"]={"class_type":"UNETLoader","inputs":{"unet_name":UNET,"weight_dtype":"default"}}
    j["clip"]={"class_type":"CLIPLoader","inputs":{"clip_name":CLIP,"type":"minimax","device":"default"}}
    j["vv"]={"class_type":"VAELoader","inputs":{"vae_name":VAE_V}}
    j["va"]={"class_type":"VAELoader","inputs":{"vae_name":VAE_A}}
    j["r1"]={"class_type":"LoadImage","inputs":{"image":"case08/1.jpg"}}
    j["r2"]={"class_type":"LoadImage","inputs":{"image":"case08/2.jpg"}}
    j["ref2va"]={"class_type":"MiniMaxH3ReferenceToVideo","inputs":{
        "clip":["clip",0],"vae":["vv",0],"audio_vae":["va",0],"prompt":PROMPT,
        "width":W,"height":H,"length":FRAMES,"ref_image_size":"match",
        "ref_images.ref_image_0":["r1",0],"ref_images.ref_image_1":["r2",0]}}
    j["noise"]={"class_type":"RandomNoise","inputs":{"noise_seed":1}}
    j["sampler"]={"class_type":"KSamplerSelect","inputs":{"sampler_name":"euler"}}
    j["sigmas"]={"class_type":"BasicScheduler","inputs":{"model":["unet",0],"scheduler":"beta","steps":STEPS,"denoise":1.0}}
    j["guider"]={"class_type":"BasicGuider","inputs":{"model":["unet",0],"conditioning":["ref2va",0]}}
    j["samp"]={"class_type":"SamplerCustomAdvanced","inputs":{"noise":["noise",0],"guider":["guider",0],
              "sampler":["sampler",0],"sigmas":["sigmas",0],"latent_image":["ref2va",1]}}
    j["dv"]={"class_type":"VAEDecode","inputs":{"samples":["samp",0],"vae":["vv",0]}}
    j["da"]={"class_type":"VAEDecodeAudio","inputs":{"samples":["samp",0],"vae":["va",0]}}
    j["cv"]={"class_type":"CreateVideo","inputs":{"images":["dv",0],"fps":24,"audio":["da",0],"bit_depth":8}}
    j["save"]={"class_type":"SaveVideo","inputs":{"video":["cv",0],"filename_prefix":f"probe_{W}x{H}_{FRAMES}f","format":"auto","codec":"auto"}}
    return j

def run(j):
    body=json.dumps({"prompt":j,"client_id":str(uuid.uuid4())}).encode()
    req=urllib.request.Request(f"{HOST}/prompt",data=body,headers={"Content-Type":"application/json"})
    try: resp=json.loads(urllib.request.urlopen(req,timeout=30).read())
    except urllib.error.HTTPError as e:
        print("REJECTED:",e.code,e.read().decode()[:800]); sys.exit(2)
    if resp.get("node_errors"): print("NODE ERRORS:",json.dumps(resp["node_errors"],ensure_ascii=False)[:800]); sys.exit(3)
    pid=resp["prompt_id"]; print(f"[{W}x{H} {FRAMES}f steps={STEPS}] QUEUED {pid}")
    t0=time.time()
    while time.time()-t0<900:
        try: h=json.loads(urllib.request.urlopen(f"{HOST}/history/{pid}",timeout=20).read())
        except Exception: time.sleep(6); continue
        if pid in h:
            st=h[pid].get("status",{})
            if st.get("completed"): print(f"  ✅ FITS — completed in {time.time()-t0:.0f}s"); return 0
            if st.get("status_str")=="error":
                msgs=st.get("messages",[])
                oom=any("memory" in str(m).lower() or "OutOfMemory" in str(m) for m in msgs)
                print(f"  ❌ {'OOM' if oom else 'ERROR'} after {time.time()-t0:.0f}s")
                for m in msgs[-3:]:
                    em=m[1] if isinstance(m,list) and len(m)>1 else m
                    if isinstance(em,dict) and em.get("exception_message"): print("     ",em["exception_message"][:200])
                return 1
        time.sleep(6)
    print("  ⏰ timeout"); return 2

if __name__=="__main__":
    print(f"PROBE: single-pass {W}x{H} @ {FRAMES}f (~{FRAMES/24:.1f}s), steps={STEPS}")
    if os.environ.get("RUN")=="1": sys.exit(run(build()))
    else: json.dump(build(),open(os.path.join(HERE,"probe_maxres_api.json"),"w"),indent=2); print("built (RUN=1 to queue)")
