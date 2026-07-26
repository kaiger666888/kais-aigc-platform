#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""后处理硬锚定首帧:把生成 foley 视频的第0帧强制换成原片首帧,
0.3s 淡出 overlay 过渡到生成内容(音轨保留不动)。保证开场帧=原片。

用法: python3 scripts/anchor-firstframe.py 1 3 8 9 [--fade 0.3]
"""
import sys, subprocess, os, json

ROOT = "/data/workspace/kais-aigc-platform"
OUT = f"{ROOT}/workflows/ltx-2.3/shot-timeline-ep01-output"
SF = ("/data/workspace/kais-shot-timeline/output/虫虫武侠小故事《小江湖》第01话：爸爸去哪儿？"
      "（ 画面只是工具，情绪才是目的。/shot_frames")

args = [a for a in sys.argv[1:] if not a.startswith("--")]
fade = 0.3
if "--fade" in sys.argv:
    fade = float(sys.argv[sys.argv.index("--fade") + 1])
ids = [int(a) for a in args] or [1, 3, 8, 9]

def dur(p):
    return float(subprocess.check_output(["ffprobe","-v","error","-show_entries","format=duration","-of","csv=p=0",p]).strip())

for sid in ids:
    gen = f"{OUT}/stlep01_shot{sid:03d}_foley.mp4"
    anchor = f"{SF}/shot_{sid:03d}_first.jpg"
    if not os.path.exists(gen) or not os.path.exists(anchor):
        print(f"  #{sid:03d} ✗ 缺文件"); continue
    gd = dur(gen)
    tmp = f"/tmp/anch_{sid}.mp4"
    # anchor 作 overlay:format=rgba + 从0起 fade out(fade秒内从满透明度→0),盖在 gen 上
    filt = (f"[1:v]scale=1280:704,format=rgba,fade=t=out:st=0:d={fade}:alpha=1[ovr];"
            f"[0:v][ovr]overlay=eof_action=repeat[v]")
    r = subprocess.run(
        ["ffmpeg","-y","-loglevel","error","-i",gen,"-loop","1","-t",f"{gd}","-i",anchor,
         "-filter_complex",filt,"-map","[v]","-map","0:a?",
         "-c:v","libx264","-crf","18","-preset","fast","-c:a","copy","-shortest",tmp],
        capture_output=True, text=True)
    if r.returncode != 0:
        print(f"  #{sid:03d} ✗ ffmpeg: {r.stderr[:200]}"); continue
    # faststart + 覆盖回 OUT_DIR
    subprocess.run(["ffmpeg","-y","-loglevel","error","-i",tmp,"-c","copy","-movflags","+faststart",gen],check=True)
    print(f"  #{sid:03d} ✓ 首帧硬锚定(fade {fade}s) → {gen}")
print("done")
