#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""拼接前10镜 Foley 成片 + 建三路对比 HTML(原片原声 / rt1静音 / 引擎Foley有声)。"""
import json, subprocess, os
from html import escape

ROOT = "/data/workspace/kais-aigc-platform"
OUT = f"{ROOT}/workflows/ltx-2.3/shot-timeline-ep01-output"
SHOTS = f"{ROOT}/data/oss/shot-timeline-ep01/shots.json"
shots = json.load(open(SHOTS))[:10]


def dur(p):
    return float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", p]).strip())


def concat(foley_segs, dest):
    lst = f"{OUT}/_foley10_concat.txt"
    with open(lst, "w") as f:
        for p in foley_segs: f.write(f"file '{p}'\n")
    r = subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", lst, "-c", "copy", dest], capture_output=True, text=True)
    if r.returncode != 0:
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", lst, "-c:v", "libx264", "-crf", "18", "-c:a", "aac", "-b:a", "192k", dest], check=True)


# 1) 拼接 foley 成片
segs = [f"{OUT}/stlep01_shot{s['id']:03d}_foley.mp4" for s in shots if os.path.exists(f"{OUT}/stlep01_shot{s['id']:03d}_foley.mp4")]
foley_full = f"{OUT}/ep01_first10_foley.mp4"
concat(segs, foley_full)
print(f"✓ 成片: {foley_full} ({dur(foley_full):.2f}s, {len(segs)} 镜)")

# 2) HTML 三路对比
def vid(fname):
    p = f"{OUT}/{fname}"
    return (f'<video controls loop preload="metadata"><source src="{fname}?v=foley" type="video/mp4"></video>'
            if os.path.exists(p) else '<div class="pending">无</div>')

rows = []
for s in shots:
    sid = s["id"]
    cells = [
        ("原片(原声)", f"orig_shot{sid:03d}_sound.mp4"),
        ("rt1 静音画面", f"stlep01_shot{sid:03d}_rt1.mp4"),
        ("引擎 Foley(对白+环境)", f"stlep01_shot{sid:03d}_foley.mp4"),
    ]
    cell_html = "".join(f'<div class="cell"><b>{c[0]}</b>{vid(c[1])}</div>' for c in cells)
    rows.append(f'<section class="shot"><h3>#{sid:03d} <span class="dur">{s["end_sec"]-s["start_sec"]:.1f}s</span></h3><div class="three">{cell_html}</div></section>')

html = f'''<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>小江湖 EP01 · 前10镜 Foley 引擎有声 三路对比</title>
<style>
*{{box-sizing:border-box}} body{{margin:0;background:#0f0f10;color:#eee;font-family:-apple-system,"PingFang SC",sans-serif}}
header{{padding:18px 28px;background:#161616;border-bottom:1px solid #2a2a2a;position:sticky;top:0;z-index:2}}
header h1{{margin:0;font-size:18px}} header p{{margin:6px 0 0;color:#9a9a9a;font-size:12px}}
main{{padding:18px 28px;display:grid;gap:18px;max-width:1400px;margin:0 auto}}
.full{{background:#181818;border:1px solid #3a3a1a;border-radius:10px;padding:16px}}
.full h2{{margin:0 0 12px;font-size:15px;color:#d4c87a}}
.full .three{{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px}}
.shot{{background:#181818;border:1px solid #2a2a2a;border-radius:8px;padding:12px}}
.shot h3{{margin:0 0 8px;font-size:14px;color:#7ee787}} .dur{{color:#888;font-weight:normal;font-size:11px;margin-left:8px}}
.three{{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px}}
.cell b{{display:block;font-size:11px;color:#aaa;margin-bottom:4px}}
.cell:nth-child(3) b{{color:#7ee787}}
video{{width:100%;max-height:30vh;background:#000;border-radius:5px}}
.pending{{height:80px;display:flex;align-items:center;justify-content:center;background:#1a1a1a;border-radius:5px;color:#555;font-size:11px}}
</style></head><body>
<header><h1>《小江湖》EP01 · 前10镜 Foley 引擎有声 三路对比</h1>
<p>左=原片原声 | 中=rt1 静音画面 | 右=<b style="color:#7ee787">引擎 Foley 成片</b>(QwenTTS对白 + Foley V2A环境音 + 口型同步 + sidechain ducking)。
全流程用 kais-aigc-platform 引擎:Qwen3-TTS voice_design/clone 造角色音色,LTX MSR foley_v2a 生成画面+环境音。</p></header>
<main>
  <section class="full">
    <h2>整体成片(前10镜)</h2>
    <div class="three">
      <div class="cell"><b>原片前10镜(原声)</b>{vid("ep01_first10_orig.mp4")}</div>
      <div class="cell"><b>rt1 成片(静音)</b>{vid("ep01_first10_rt1.mp4")}</div>
      <div class="cell"><b>引擎 Foley 成片(有声)</b>{vid("ep01_first10_foley.mp4")}</div>
    </div>
  </section>
  {''.join(rows)}
</main></body></html>'''
open(f"{OUT}/foley_compare.html", "w").write(html)
print(f"✓ {OUT}/foley_compare.html")
print(f"  http://100.124.72.88:8123/foley_compare.html?v=foley")
print(f"  成片 mp4: http://100.124.72.88:8123/ep01_first10_foley.mp4?v=foley")
