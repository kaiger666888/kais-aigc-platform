#!/usr/bin/env python3
"""为每个已生成(rt1)镜头,从 bilibili 原版按时间码切出原片片段,生成 [原片|生成] 并排对比 HTML。
用法: python3 scripts/build-compare-html.py [TAG=rt1]
让用户/我直接对照「动作是否符合原视频」。"""
import json, os, sys, glob, subprocess
from html import escape

TAG = sys.argv[1] if len(sys.argv) > 1 else "rt1"
ROOT = "/data/workspace/kais-aigc-platform"
OUT = f"{ROOT}/workflows/ltx-2.3/shot-timeline-ep01-output"
ASSET = f"{ROOT}/data/oss/shot-timeline-ep01"
ORIG = "/data/home/kai/下载/bilibili_xiaojianghu/虫虫武侠小故事《小江湖》第01话：爸爸去哪儿？（ 画面只是工具，情绪才是目的。.mp4"
prompts = {p["shot_id"]: p for p in json.load(open(f"{ASSET}/prompts.json"))}
shots = {s["id"]: s for s in json.load(open(f"{ASSET}/shots.json"))}

done = sorted(int(os.path.basename(f).split("_")[1].replace("shot",""))
              for f in glob.glob(f"{OUT}/stlep01_shot*_{TAG}.mp4"))

def extract(sid):
    s = shots.get(sid)
    if not s: return None
    dst = f"{OUT}/orig_shot{sid:03d}.mp4"
    if os.path.exists(dst) and os.path.getsize(dst) > 1000: return dst
    st = max(0, s["start_sec"] - 0.03)
    dur = s["end_sec"] - s["start_sec"] + 0.06
    subprocess.run(["ffmpeg","-y","-hide_banner","-loglevel","error",
                    "-ss",f"{st:.3f}","-i",ORIG,"-t",f"{dur:.3f}",
                    "-c:v","libx264","-preset","ultrafast","-crf","23","-an",dst],
                   check=False)
    return dst if os.path.exists(dst) else None

rows = []
for sid in done:
    p = prompts.get(sid, {})
    s = shots.get(sid, {})
    orig = extract(sid)
    gen = f"stlep01_shot{sid:03d}_{TAG}.mp4"
    o_tag = f'<video controls muted loop preload="metadata"><source src="orig_shot{sid:03d}.mp4?v={TAG}" type="video/mp4"></video>' if orig else '<div class="pending">原片切取失败</div>'
    g_tag = f'<video controls muted loop preload="metadata"><source src="{gen}?v={TAG}" type="video/mp4"></video>'
    subj = escape((p.get("subject","") or "")[:80])
    act = escape(p.get("action","") or "")
    rows.append(f'''<section class="cmp">
  <h2>#{sid} <span class="dur">原片 {s.get("duration",0):.2f}s</span></h2>
  <div class="two"><div class="cell"><b>原视频</b>{o_tag}</div><div class="cell"><b>生成(rt1)</b>{g_tag}</div></div>
  <p class="sub"><b>subject:</b> {subj}</p>
  <p class="act"><b>action:</b> {act}</p>
</section>''')

html = f'''<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>小江湖 EP01 · 原片 vs 生成 对比 ({TAG})</title>
<style>
*{{box-sizing:border-box}} body{{margin:0;background:#0f0f10;color:#eee;font-family:-apple-system,"PingFang SC",sans-serif}}
header{{padding:18px 28px;background:#161616;border-bottom:1px solid #2a2a2a;position:sticky;top:0}}
header h1{{margin:0;font-size:18px}} header p{{margin:6px 0 0;color:#9a9a9a;font-size:13px}}
main{{padding:20px 28px;display:grid;gap:18px;max-width:1180px}}
.cmp{{background:#181818;border:1px solid #2a2a2a;border-radius:10px;padding:14px}}
.cmp h2{{margin:0 0 10px;font-size:15px}} .dur{{color:#888;font-weight:normal;font-size:12px;margin-left:8px}}
.two{{display:grid;grid-template-columns:1fr 1fr;gap:10px}}
.cell b{{display:block;font-size:12px;color:#aaa;margin-bottom:4px}}
video{{width:100%;max-height:36vh;background:#000;border-radius:6px}}
.pending{{height:120px;display:flex;align-items:center;justify-content:center;background:#1a1a1a;border-radius:6px;color:#555;font-size:12px}}
.sub,.act{{color:#999;font-size:12px;line-height:1.55;margin:8px 0 0}} .act{{color:#bbb}}
</style></head><body>
<header><h1>《小江湖》EP01 · 原视频 vs 生成(rt1) 动作对比</h1>
<p>左=原片该时段,右=AI生成。对照「动作/画面是否符合原视频」。已完成 {len(done)} 镜。</p></header>
<main>{''.join(rows)}</main></body></html>'''
open(f"{OUT}/compare.html","w").write(html)
print(f"✓ {OUT}/compare.html — {len(done)} 镜对比")
print(f"  http://100.124.72.88:8123/compare.html?v={TAG}")
