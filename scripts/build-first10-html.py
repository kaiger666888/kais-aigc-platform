#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""前10镜有声对比 HTML:原片(原声 stems) vs rt1 成片。
生成原片整体+逐镜有声段(原片mp4视频 + htdemucs stems混音),建并排对比页。

用法: python3 scripts/build-first10-html.py [--n 10]
"""
import json, subprocess, os, argparse
from html import escape

ROOT = "/data/workspace/kais-aigc-platform"
OUT = f"{ROOT}/workflows/ltx-2.3/shot-timeline-ep01-output"
SHOTS = f"{ROOT}/data/oss/shot-timeline-ep01/shots.json"
PROMPTS = f"{ROOT}/data/oss/shot-timeline-ep01/prompts.json"
ORIG_MP4 = ("/data/workspace/kais-shot-timeline/output/虫虫武侠小故事《小江湖》第01话：爸爸去哪儿？"
            "（ 画面只是工具，情绪才是目的。/虫虫武侠小故事《小江湖》第01话：爸爸去哪儿？（ 画面只是工具，情绪才是目的。.mp4")
STEM_BASE = ("/data/workspace/kais-shot-timeline/output/虫虫武侠小故事《小江湖》第01话：爸爸去哪儿？"
             "（ 画面只是工具，情绪才是目的。/stems/htdemucs/虫虫武侠小故事《小江湖》第01话：爸爸去哪儿？"
             "（ 画面只是工具，情绪才是目的。")
STEMS = {s: f"{STEM_BASE}/{s}.wav" for s in ("vocals", "drums", "bass", "other")}


def ffprobe_dur(p):
    return float(subprocess.check_output(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", p]).strip())


def orig_sound(start, dur, out):
    """原片视频段 + 4 stems 混音 → 有声 mp4(视频重编码,音 aac)。"""
    cmd = ["ffmpeg", "-y", "-loglevel", "error",
           "-ss", f"{start:.3f}", "-t", f"{dur:.3f}", "-i", ORIG_MP4,
           "-ss", f"{start:.3f}", "-t", f"{dur:.3f}", "-i", STEMS["vocals"],
           "-ss", f"{start:.3f}", "-t", f"{dur:.3f}", "-i", STEMS["drums"],
           "-ss", f"{start:.3f}", "-t", f"{dur:.3f}", "-i", STEMS["bass"],
           "-ss", f"{start:.3f}", "-t", f"{dur:.3f}", "-i", STEMS["other"],
           "-filter_complex", "[1:a][2:a][3:a][4:a]amix=inputs=4:duration=first:dropout_transition=0[a]",
           "-map", "0:v", "-map", "[a]",
           "-c:v", "libx264", "-crf", "20", "-preset", "fast",
           "-c:a", "aac", "-b:a", "192k", "-shortest", out]
    r = subprocess.run(cmd, capture_output=True, text=True)
    return r.returncode == 0, r.stderr[:200]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=10)
    args = ap.parse_args()
    shots = json.load(open(SHOTS, encoding="utf-8"))[:args.n]
    prompts = {p["shot_id"]: p for p in json.load(open(PROMPTS, encoding="utf-8"))}

    # 整体原片有声段(0 ~ 前 n 镜结束)
    total_end = shots[-1]["end_sec"]
    orig_full = f"{OUT}/ep01_first10_orig.mp4"
    if not os.path.exists(orig_full):
        ok, err = orig_sound(0.0, total_end, orig_full)
        print(f"整体原片段: {'✓' if ok else '✗ '+err}")
    else:
        print(f"整体原片段: 已存在")

    # 逐镜原片有声段
    per_shot = []
    for s in shots:
        sid = s["id"]; start = s["start_sec"]; dur = s["end_sec"] - s["start_sec"]
        o = f"{OUT}/orig_shot{sid:03d}_sound.mp4"
        if not os.path.exists(o):
            ok, err = orig_sound(start, dur, o)
            if not ok:
                print(f"  #{sid:03d} 原片段 ✗ {err}"); o = None
        per_shot.append(o)

    # ---- HTML ----
    rt_full = "ep01_first10_rt1.mp4"
    def vid(fname):
        return (f'<video controls loop preload="metadata">'
                f'<source src="{fname}?v=f10" type="video/mp4"></video>'
                if fname and os.path.exists(f"{OUT}/{fname}") else
                f'<video controls loop preload="metadata"><source src="{fname}?v=f10" type="video/mp4"></video>'
                if fname and os.path.exists(fname) else
                '<div class="pending">无</div>')

    rows = []
    for s, o in zip(shots, per_shot):
        sid = s["id"]
        rt = f"stlep01_shot{sid:03d}_rt1_sound.mp4"
        rt_path = f"{OUT}/{rt}"
        p = prompts.get(sid, {})
        subj = escape((p.get("subject") or "")[:48])
        act = escape((p.get("action") or "")[:70])
        cell_o = (f'<video controls loop preload="metadata"><source src="orig_shot{sid:03d}_sound.mp4?v=f10" type="video/mp4"></video>'
                  if o else '<div class="pending">无</div>')
        cell_r = (f'<video controls loop preload="metadata"><source src="{rt}?v=f10" type="video/mp4"></video>'
                  if os.path.exists(rt_path) else '<div class="pending">无</div>')
        rows.append(f'''<section class="shot">
  <h3>#{sid:03d} <span class="dur">{s["end_sec"]-s["start_sec"]:.1f}s</span></h3>
  <div class="two">
    <div class="cell"><b>原片(原声)</b>{cell_o}</div>
    <div class="cell"><b>AI 生成 rt1(有声)</b>{cell_r}</div>
  </div>
  <div class="meta"><span class="subj">{subj}</span> · <span class="act">{act}</span></div>
</section>''')

    html = f'''<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>小江湖 EP01 · 前10镜有声对比</title>
<style>
*{{box-sizing:border-box}} body{{margin:0;background:#0f0f10;color:#eee;font-family:-apple-system,"PingFang SC",sans-serif}}
header{{padding:18px 28px;background:#161616;border-bottom:1px solid #2a2a2a;position:sticky;top:0;z-index:2}}
header h1{{margin:0;font-size:18px}} header p{{margin:6px 0 0;color:#9a9a9a;font-size:12px}}
main{{padding:18px 28px;display:grid;gap:18px;max-width:1320px;margin:0 auto}}
.full{{background:#181818;border:1px solid #333;border-radius:10px;padding:16px}}
.full h2{{margin:0 0 12px;font-size:15px;color:#7ee787}}
.full .two{{display:grid;grid-template-columns:1fr 1fr;gap:10px}}
.shot{{background:#181818;border:1px solid #2a2a2a;border-radius:8px;padding:12px}}
.shot h3{{margin:0 0 8px;font-size:14px;color:#7ee787}} .shot h3 .dur{{color:#888;font-weight:normal;font-size:11px;margin-left:8px}}
.two{{display:grid;grid-template-columns:1fr 1fr;gap:8px}}
.cell b{{display:block;font-size:11px;color:#aaa;margin-bottom:4px}}
video{{width:100%;max-height:34vh;background:#000;border-radius:5px}}
.pending{{height:90px;display:flex;align-items:center;justify-content:center;background:#1a1a1a;border-radius:5px;color:#555;font-size:11px}}
.meta{{margin-top:7px;font-size:11px;line-height:1.5}} .meta .subj{{color:#f0c674}} .meta .act{{color:#9a9a9a}}
</style></head><body>
<header><h1>《小江湖》EP01 · 前10镜有声成片对比</h1>
<p>左=原片(原声:对白 vocnals + 环境/音乐 drums/bass/other) | 右=AI生成 rt1(同原声音轨按时间码对齐)。
音频来自原片 htdemucs 分轨,逐镜精确切分(整体误差 &lt;0.2s)。</p></header>
<main>
  <section class="full">
    <h2>整体成片对比(0–{total_end:.1f}s)</h2>
    <div class="two">
      <div class="cell"><b>原片前10镜(原声)</b>{vid("ep01_first10_orig.mp4")}</div>
      <div class="cell"><b>AI 成片 rt1(有声)</b>{vid(rt_full)}</div>
    </div>
  </section>
  {''.join(rows)}
</main></body></html>'''
    open(f"{OUT}/first10_compare.html", "w").write(html)
    print(f"\n✓ {OUT}/first10_compare.html")
    print(f"  http://100.124.72.88:8123/first10_compare.html?v=f10")
    print(f"  成片 mp4: http://100.124.72.88:8123/{rt_full}?v=f10")


if __name__ == "__main__":
    main()
