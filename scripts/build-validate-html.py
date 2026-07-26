#!/usr/bin/env python3
"""验证页:对指定镜(默认 3,8,9,10)做 [原片|rt1旧prompt|rt2引擎grounded] 三路对比,
+ 旧prompt/新prompt/引擎ground truth。用法: python3 build-validate-html.py 3,8,9,10"""
import json, os, sys, glob
from html import escape

ROOT = "/data/workspace/kais-aigc-platform"
OUT = f"{ROOT}/workflows/ltx-2.3/shot-timeline-ep01-output"
ASSET = f"{ROOT}/data/oss/shot-timeline-ep01"
SA = "/mnt/agents/output/gpu1/shot_analysis"
ids = [int(x) for x in (sys.argv[1] if len(sys.argv)>1 else "3,8,9,10").split(",")]

newP = {p["shot_id"]: p for p in json.load(open(f"{ASSET}/prompts.json"))}
# 找最新备份(旧 prompt)
baks = sorted(glob.glob(f"{ASSET}/prompts.json.bak.*"))
oldP = {p["shot_id"]: p for p in json.load(open(baks[-1]))} if baks else newP

rows = []
for sid in ids:
    eng = {}
    try: eng = json.load(open(f"{SA}/shot_{sid:03d}.json"))["semantic"]
    except: pass
    o = oldP.get(sid, {}); n = newP.get(sid, {})
    def vid(tag, fname):
        return f'<video controls muted loop preload="metadata"><source src="{fname}?v=v" type="video/mp4"></video>' if os.path.exists(f"{OUT}/{fname}") else '<div class="pending">无</div>'
    row = f'''<section class="v">
  <h2>#{sid}</h2>
  <div class="three">
    <div class="cell"><b>原视频</b>{vid("o",f"orig_shot{sid:03d}.mp4")}</div>
    <div class="cell"><b>rt1 旧prompt(错)</b>{vid("1",f"stlep01_shot{sid:03d}_rt1.mp4")}</div>
    <div class="cell"><b>rt2 引擎grounded(新)</b>{vid("2",f"stlep01_shot{sid:03d}_rt2.mp4")}</div>
  </div>
  <table>
    <tr><th>引擎 ground truth</th><td>角色: <b>{escape(eng.get('subjects','') or '?')}</b> | 动作: {escape(eng.get('action_detail','') or '?')} | {eng.get('shot_scale','')}·{eng.get('camera_primitive','') or ''}</td></tr>
    <tr><th>旧 prompt(错)</th><td class="old">subj: {escape((o.get('subject','') or '')[:70])}<br>action: {escape((o.get('action','') or '')[:70])}</td></tr>
    <tr><th>新 prompt(rt2)</th><td class="new">subj: {escape((n.get('subject','') or '')[:70])}<br>action: {escape((n.get('action','') or '')[:70])}</td></tr>
  </table>
</section>'''
    rows.append(row)

html = f'''<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>小江湖 EP01 · 引擎grounded 修复验证</title>
<style>
*{{box-sizing:border-box}} body{{margin:0;background:#0f0f10;color:#eee;font-family:-apple-system,"PingFang SC",sans-serif}}
header{{padding:16px 28px;background:#161616;border-bottom:1px solid #2a2a2a;position:sticky;top:0}}
header h1{{margin:0;font-size:17px}} header p{{margin:5px 0 0;color:#9a9a9a;font-size:12px}}
main{{padding:18px 28px;display:grid;gap:16px;max-width:1280px}}
.v{{background:#181818;border:1px solid #2a2a2a;border-radius:10px;padding:14px}}
.v h2{{margin:0 0 10px;font-size:15px;color:#7ee787}}
.three{{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px}}
.cell b{{display:block;font-size:11px;color:#aaa;margin-bottom:4px}}
video{{width:100%;max-height:30vh;background:#000;border-radius:5px}}
.pending{{height:100px;display:flex;align-items:center;justify-content:center;background:#1a1a1a;border-radius:5px;color:#555;font-size:11px}}
table{{width:100%;border-collapse:collapse;margin-top:10px;font-size:12px}}
th{{text-align:left;width:130px;color:#888;padding:4px 8px;vertical-align:top;border-bottom:1px solid #222}}
td{{color:#bbb;padding:4px 8px;border-bottom:1px solid #222;line-height:1.5}}
td.old{{color:#f08080}} td.new{{color:#7ee787}}
</style></head><body>
<header><h1>《小江湖》EP01 · 引擎 ground truth 修复验证(rt1→rt2)</h1>
<p>左=原片 | 中=rt1 旧prompt(角色/动作错) | 右=rt2 引擎grounded(修正)。对比 rt2 是否更贴近原片。</p></header>
<main>{''.join(rows)}</main></body></html>'''
open(f"{OUT}/validate.html","w").write(html)
print(f"✓ {OUT}/validate.html")
print(f"  http://100.124.72.88:8123/validate.html?v=v")
