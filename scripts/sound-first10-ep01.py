#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""前10镜逐镜配音 + 拼接有声成片。
用原片 htdemucs 分轨(vocals=对白, drums+bass+other=环境+音乐)按 shots.json
时间码逐镜切分,mux 到前10镜 rt1 视频,再拼接成 ep01_first10_rt1.mp4。

用法: python3 scripts/sound-first10-ep01.py [--n 10]
"""
import json, subprocess, os, sys, argparse

ROOT = "/data/workspace/kais-aigc-platform"
OUT = f"{ROOT}/workflows/ltx-2.3/shot-timeline-ep01-output"
SHOTS = f"{ROOT}/data/oss/shot-timeline-ep01/shots.json"
# 原片分轨(symlink,带空格中文,python 字符串可处理)
STEM_BASE = ("/data/workspace/kais-shot-timeline/output/虫虫武侠小故事《小江湖》第01话："
             "爸爸去哪儿？（ 画面只是工具，情绪才是目的。/stems/htdemucs/虫虫武侠小故事《小江湖》"
             "第01话：爸爸去哪儿？（ 画面只是工具，情绪才是目的。")
STEMS = {s: f"{STEM_BASE}/{s}.wav" for s in ("vocals", "drums", "bass", "other")}


def ffprobe_dur(path):
    return float(subprocess.check_output(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "csv=p=0", path]).strip())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=10)
    args = ap.parse_args()
    shots = json.load(open(SHOTS, encoding="utf-8"))[:args.n]
    os.makedirs(OUT, exist_ok=True)

    list_txt = f"{OUT}/_first10_concat.txt"
    segs = []
    for s in shots:
        sid = s["id"]; start = s["start_sec"]
        rt = f"{OUT}/stlep01_shot{sid:03d}_rt1.mp4"
        out = f"{OUT}/stlep01_shot{sid:03d}_rt1_sound.mp4"
        if not os.path.exists(rt):
            print(f"  #{sid:03d} ✗ 缺 rt1,跳过"); continue
        rt_dur = ffprobe_dur(rt)
        # 逐镜:从4条 stem 各切 [start, start+rt_dur],amix 混合,mux(c:v copy)
        cmd = ["ffmpeg", "-y", "-loglevel", "error",
               "-i", rt,
               "-ss", f"{start:.3f}", "-t", f"{rt_dur:.3f}", "-i", STEMS["vocals"],
               "-ss", f"{start:.3f}", "-t", f"{rt_dur:.3f}", "-i", STEMS["drums"],
               "-ss", f"{start:.3f}", "-t", f"{rt_dur:.3f}", "-i", STEMS["bass"],
               "-ss", f"{start:.3f}", "-t", f"{rt_dur:.3f}", "-i", STEMS["other"],
               "-filter_complex",
               "[1:a][2:a][3:a][4:a]amix=inputs=4:duration=first:dropout_transition=0[a]",
               "-map", "0:v", "-map", "[a]",
               "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", out]
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode != 0:
            print(f"  #{sid:03d} ✗ mux 失败: {r.stderr[:200]}"); continue
        od = ffprobe_dur(out)
        print(f"  #{sid:03d} ✓ {od:.2f}s 有声(vocals+drums+bass+other @ {start:.2f}s)")
        segs.append(out)

    # 拼接(stream copy,同编码)
    with open(list_txt, "w") as f:
        for p in segs:
            f.write(f"file '{p}'\n")
    final = f"{OUT}/ep01_first10_rt1.mp4"
    r = subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0",
         "-i", list_txt, "-c", "copy", final], capture_output=True, text=True)
    if r.returncode != 0:
        # concat stream copy 失败则重编码
        print(f"  concat copy 失败,重编码: {r.stderr[:150]}")
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0",
                        "-i", list_txt, "-c:v", "libx264", "-crf", "18", "-c:a", "aac",
                        "-b:a", "192k", final], check=True)
    print(f"\n✓ 成片: {final} ({ffprobe_dur(final):.2f}s, {len(segs)} 镜)")


if __name__ == "__main__":
    main()
