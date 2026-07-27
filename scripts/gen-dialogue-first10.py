#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""前10镜对白生成编排(QwenTTS)。
1) 每角色 voice_design_Advanced 一次(固定seed)→ 参考wav(上传 input/)
2) 每句台词 VoiceClone_Advanced 复用该角色参考 → 一致音色
3) 按 transcript 时间戳 ffmpeg 拼成 46.87s 对白轨 dialogue_track.wav
"""
import json, os, sys, time, urllib.request, urllib.parse, subprocess

SERVER = "http://localhost:8188"
ROOT = "/data/workspace/kais-aigc-platform"
OUT = f"{ROOT}/workflows/ltx-2.3/shot-timeline-ep01-output/engine_audio"
LINES_DIR = f"{OUT}/lines"
PLAN = f"{OUT}/dialogue_plan.json"
os.makedirs(LINES_DIR, exist_ok=True)

# 角色 voice_design 参考样本句(用于造音色)
SAMPLE = {
    "kid": "爸爸，我喜欢和你一起玩呀",
    "dad": "好小子，知道心疼爸爸了",
    "narrator": "我的爸爸，是世界上最厉害的人",
}


def submit(prompt):
    req = urllib.request.Request(SERVER + "/prompt",
        data=json.dumps({"prompt": prompt}).encode(),
        headers={"Content-Type": "application/json"})
    try:
        r = json.loads(urllib.request.urlopen(req, timeout=20).read())
        return r["prompt_id"], None
    except urllib.error.HTTPError as e:
        return None, e.read().decode()[:400]


def wait(pid, timeout=300):
    deadline = time.time() + timeout
    while time.time() < deadline:
        with urllib.request.urlopen(SERVER + f"/history/{pid}", timeout=15) as r:
            hist = json.load(r)
        if pid in hist:
            rec = hist[pid]
            if rec.get("status", {}).get("status_str") in ("success", "error"):
                return rec
        time.sleep(2)
    raise TimeoutError(pid)


def run(prompt, timeout=300):
    pid, err = submit(prompt)
    if err:
        return None, f"submit: {err}"
    rec = wait(pid, timeout)
    if rec.get("status", {}).get("status_str") == "error":
        msgs = rec.get("status", {}).get("messages", [])
        em = next((m[1] for m in msgs if m[0] == "execution_error"), {})
        return None, f"exec: {json.dumps(em, ensure_ascii=False)[:300]}"
    # 抽音频
    for out in (rec.get("outputs") or {}).values():
        if out.get("audio"):
            a = out["audio"][0]
            return (a["filename"], a.get("subfolder", ""), a.get("type", "output")), None
    return None, "no audio output"


def download(au, dest):
    fname, sub, typ = au
    q = urllib.parse.urlencode({"filename": fname, "subfolder": sub, "type": typ})
    urllib.request.urlretrieve(f"{SERVER}/view?{q}", dest)


def upload_input(host_path, name):
    """上传宿主文件到 ComfyUI input/,返回 input 内文件名。"""
    import urllib.request as u
    boundary = "----b" + str(os.getpid())
    with open(host_path, "rb") as f:
        data = f.read()
    body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"image\"; filename=\"{name}\"\r\n"
            f"Content-Type: audio/wav\r\n\r\n").encode() + data + f"\r\n--{boundary}--\r\n".encode()
    req = u.Request(f"{SERVER}/upload/image", data=body,
                    headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    return json.loads(u.urlopen(req, timeout=30).read())["name"]


def build_design(instruct, text, seed):
    return {
        "1": {"class_type": "AILab_Qwen3TTSVoiceDesign_Advanced", "inputs": {
            "text": text, "instruct": instruct, "model_size": "1.7B",
            "device": "cuda", "precision": "bf16", "language": "Chinese", "seed": seed}},
        "2": {"class_type": "SaveAudio", "inputs": {"audio": ["1", 0], "filename_prefix": "voice_design"}},
    }


def build_clone(target_text, ref_input_name, ref_text, seed):
    return {
        "1": {"class_type": "LoadAudio", "inputs": {"audio": ref_input_name, "channel": "input"}},
        "2": {"class_type": "AILab_Qwen3TTSVoiceClone_Advanced", "inputs": {
            "target_text": target_text, "reference_audio": ["1", 0], "reference_text": ref_text,
            "model_size": "1.7B", "device": "cuda", "precision": "bf16",
            "language": "Chinese", "seed": seed}},
        "3": {"class_type": "SaveAudio", "inputs": {"audio": ["2", 0], "filename_prefix": "voice_clone"}},
    }


def main():
    plan = json.load(open(PLAN))
    voices = plan["voices"]
    lines = plan["lines"]
    end = plan["first10_end"]

    # 1) 每角色造参考音色(带缓存)
    ref_input = {}
    for char, prof in voices.items():
        host_ref = f"{OUT}/ref_{char}.wav"
        if not os.path.exists(host_ref) or os.path.getsize(host_ref) < 1000:
            print(f"[design] {char}: instruct={prof['instruct'][:24]}... seed={prof['seed']}")
            au, err = run(build_design(prof["instruct"], SAMPLE[char], prof["seed"]), timeout=300)
            if err:
                print(f"  ✗ {char} design 失败: {err}"); sys.exit(1)
            download(au, host_ref)
            print(f"  ✓ ref_{char}.wav")
        # 上传到 input(每次确保最新)
        ref_input[char] = upload_input(host_ref, f"ref_{char}.wav")
        print(f"[upload] {char} → input/{ref_input[char]}")

    # 2) 逐句 VoiceClone(按 voice 字段选音色:narration→narrator, dialogue→kid/dad)
    print(f"\n[clone] {len(lines)} 句生成中...")
    for i, ln in enumerate(lines):
        v = ln["voice"]  # narrator / kid / dad
        out_wav = f"{LINES_DIR}/line_{i+1:02d}_{v}.wav"
        if os.path.exists(out_wav) and os.path.getsize(out_wav) > 1000:
            print(f"  {i+1:02d}/{len(lines)} [{ln['kind']}/{v}] cached"); continue
        au, err = run(build_clone(ln["text"], ref_input[v], SAMPLE[v], voices[v]["seed"]), timeout=180)
        if err:
            print(f"  {i+1:02d} ✗ [{v}]: {err}"); continue
        download(au, out_wav)
        dur = float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                                              "-of", "csv=p=0", out_wav]).strip())
        print(f"  {i+1:02d}/{len(lines)} [{ln['kind']}/{v}] @{ln['start']:.1f}s → {dur:.1f}s  «{ln['text'][:18]}»")

    # 3) ffmpeg 按时间戳拼对白轨
    print("\n[stitch] 拼接对白轨...")
    inputs, filters = [], []
    idx = 0
    for i, ln in enumerate(lines):
        f = f"{LINES_DIR}/line_{i+1:02d}_{ln['voice']}.wav"
        if not os.path.exists(f):
            continue
        inputs += ["-i", f]
        ms = int(ln["start"] * 1000)
        filters.append(f"[{idx}:a]adelay={ms}|{ms}[d{idx}]")
        idx += 1
    mix = "".join(f"[d{j}]" for j in range(idx))
    filt = ";".join(filters) + f";{mix}amix=inputs={idx}:duration=longest:normalize=0,atrim=0:{end+2}[a]"
    cmd = ["ffmpeg", "-y", "-loglevel", "error"] + inputs + \
          ["-filter_complex", filt, "-map", "[a]", "-ar", "22050", "-ac", "1",
           f"{OUT}/dialogue_track.wav"]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        print("拼接失败:", r.stderr[:300]); sys.exit(1)
    dur = float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                                          "-of", "csv=p=0", f"{OUT}/dialogue_track.wav"]).strip())
    print(f"\n✓ 对白轨: {OUT}/dialogue_track.wav ({dur:.2f}s)")


if __name__ == "__main__":
    main()
