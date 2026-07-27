#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Qwen3-TTS 直连 ComfyUI 驱动(绕开平台坏路由)。
voice_design 模式:text + instruct(音色描述)→ 生成 wav。
用法:
  python3 qwen-tts-gen.py --text "..." --instruct "..." --out dad_line1.wav
  python3 qwen-tts-gen.py --mode voice_clone --text "..." --ref ref.wav --out x.wav
"""
import argparse, json, time, urllib.request, urllib.parse, os, sys

SERVER = "http://localhost:8188"
OUT_DIR = "/mnt/agents/output/gpu1"  # ComfyUI output 挂载到宿主


def submit(prompt):
    req = urllib.request.Request(SERVER + "/prompt",
        data=json.dumps({"prompt": prompt}).encode(),
        headers={"Content-Type": "application/json"})
    r = json.loads(urllib.request.urlopen(req, timeout=20).read())
    return r["prompt_id"]


def wait(pid, timeout=300):
    deadline = time.time() + timeout
    while time.time() < deadline:
        with urllib.request.urlopen(SERVER + f"/history/{pid}", timeout=15) as r:
            hist = json.load(r)
        if pid in hist:
            return hist[pid]
        time.sleep(2)
    raise TimeoutError(f"timeout {pid}")


def get_audio_url(rec):
    """从 history 记录里抽音频输出(filename/subfolder/type)。"""
    for nid, out in (rec.get("outputs") or {}).items():
        if out.get("audio"):
            a = out["audio"][0]
            return a["filename"], a.get("subfolder", ""), a.get("type", "output")
    return None


def build_voice_design(text, instruct, language="Chinese", prefix="qwen_vd"):
    return {
        "1": {"class_type": "AILab_Qwen3TTSVoiceDesign", "inputs": {
            "text": text, "instruct": instruct, "model_size": "1.7B", "language": language}},
        "2": {"class_type": "SaveAudio", "inputs": {"audio": ["1", 0], "filename_prefix": prefix}},
    }


def build_voice_clone(text, ref_audio, ref_text="", language="Auto", prefix="qwen_vc"):
    return {
        "1": {"class_type": "LoadAudio", "inputs": {"audio": ref_audio, "channel": "input"}},
        "2": {"class_type": "AILab_Qwen3TTSVoiceClone", "inputs": {
            "target_text": text, "ref_audio": ["1", 0], "ref_text": ref_text,
            "model_size": "1.7B", "language": language}},
        "3": {"class_type": "SaveAudio", "inputs": {"audio": ["2", 0], "filename_prefix": prefix}},
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", default="voice_design", choices=["voice_design", "voice_clone"])
    ap.add_argument("--text", required=True)
    ap.add_argument("--instruct", default="")
    ap.add_argument("--ref", help="voice_clone 参考音频(ComfyUI input/ 文件名)")
    ap.add_argument("--ref-text", default="")
    ap.add_argument("--language", default="Chinese")
    ap.add_argument("--out", required=True, help="宿主输出 wav 路径")
    ap.add_argument("--timeout", type=int, default=300)
    args = ap.parse_args()

    if args.mode == "voice_design":
        prompt = build_voice_design(args.text, args.instruct, args.language)
    else:
        assert args.ref, "voice_clone 需要 --ref"
        prompt = build_voice_clone(args.text, args.ref, args.ref_text, args.language)

    pid = submit(prompt)
    rec = wait(pid, args.timeout)
    status = rec.get("status", {})
    if status.get("status_str") == "error":
        msgs = status.get("messages", [])
        err = next((m[1] for m in msgs if m[0] == "execution_error"), "unknown")
        print(f"✗ 执行错误: {json.dumps(err, ensure_ascii=False)[:400]}", file=sys.stderr)
        sys.exit(1)

    au = get_audio_url(rec)
    if not au:
        print("✗ 无音频输出", file=sys.stderr); sys.exit(1)
    fname, sub, typ = au
    # 下载到本地
    q = urllib.parse.urlencode({"filename": fname, "subfolder": sub, "type": typ})
    url = f"{SERVER}/view?{q}"
    urllib.request.urlretrieve(url, args.out)
    import subprocess
    dur = float(subprocess.check_output(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", args.out]).strip())
    print(f"✓ {args.out} ({dur:.2f}s, {os.path.getsize(args.out)//1024}KB)")


if __name__ == "__main__":
    main()
