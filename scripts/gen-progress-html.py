#!/usr/bin/env python3
"""扫描已生成的 stlep01_shotNNN_<TAG>.mp4,配 prompts.json/shots.json,生成进度 index.html。
用法: python3 scripts/gen-progress-html.py [TAG=rt1]
成片视频优先:每镜顶部可播放 mp4;未生成的镜灰显。"""
import json, os, sys, glob
from html import escape

TAG = sys.argv[1] if len(sys.argv) > 1 else "rt1"
ROOT = "/data/workspace/kais-aigc-platform"
OUT = f"{ROOT}/workflows/ltx-2.3/shot-timeline-ep01-output"
ASSET = f"{ROOT}/data/oss/shot-timeline-ep01"

prompts = {p["shot_id"]: p for p in json.load(open(f"{ASSET}/prompts.json"))}
shots = {s["id"]: s for s in json.load(open(f"{ASSET}/shots.json"))}

def nf(d, fps=24):
    t = round(d * fps); k = round((t - 1) / 8); return 8 * k + 1

done = set()
for f in glob.glob(f"{OUT}/stlep01_shot*_{TAG}.mp4"):
    try:
        n = int(os.path.basename(f).split("_")[1].replace("shot", ""))
        done.add(n)
    except Exception:
        pass

cards = []
for sid in range(1, 94):
    p = prompts.get(sid, {})
    s = shots.get(sid, {})
    dur = s.get("duration", 0)
    nfr = nf(dur) if dur else 0
    is_done = sid in done
    mp4 = f"stlep01_shot{sid:03d}_{TAG}.mp4"
    prompt = escape(p.get("prompt_text", "") or p.get("action", ""))
    if is_done:
        vid = f'<video controls muted loop preload="metadata"><source src="{mp4}?v={TAG}" type="video/mp4"></video>'
        badge = '<span class="ok">✓ 已生成</span>'
    else:
        vid = '<div class="pending">⏳ 待生成</div>'
        badge = '<span class="pend">— 待生成</span>'
    cards.append(f'''<section class="shot {'done' if is_done else 'todo'}">
  <h2>#{sid} {badge}<span class="dur">真实 {dur:.2f}s · {nfr}f</span></h2>
  {vid}
  <p class="prompt">{prompt}</p>
</section>''')

v = TAG
html = f'''<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>小江湖 EP01 · 生成进度 ({TAG})</title>
<style>
*{{box-sizing:border-box}} body{{margin:0;background:#0f0f10;color:#eee;font-family:-apple-system,"PingFang SC",sans-serif}}
header{{padding:20px 28px;background:#161616;border-bottom:1px solid #2a2a2a;position:sticky;top:0;z-index:9}}
header h1{{margin:0;font-size:19px}} header p{{margin:6px 0 0;color:#9a9a9a;font-size:13px}}
.bar{{margin-top:10px;height:8px;background:#2a2a2a;border-radius:4px;overflow:hidden}}
.bar>i{{display:block;height:100%;background:#3fb950;width:{len(done)/93*100:.1f}%}}
main{{padding:24px 28px;display:grid;grid-template-columns:repeat(auto-fill,minmax(420px,1fr));gap:18px}}
.shot{{background:#181818;border:1px solid #2a2a2a;border-radius:10px;padding:14px}}
.shot.todo{{opacity:.45}}
.shot h2{{margin:0 0 10px;font-size:14px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}}
.dur{{color:#888;font-weight:normal;font-size:12px;margin-left:auto}}
.ok{{color:#3fb950;font-size:12px}} .pend{{color:#888;font-size:12px}}
video{{width:100%;max-height:42vh;background:#000;border-radius:6px}}
.pending{{height:120px;display:flex;align-items:center;justify-content:center;background:#1a1a1a;border-radius:6px;color:#555;font-size:13px}}
.prompt{{color:#999;font-size:12px;line-height:1.6;margin:10px 0 0;max-height:5em;overflow:auto}}
</style></head><body>
<header>
  <h1>《小江湖》EP01 · shot-timeline 生成进度 — tag {TAG}</h1>
  <p>已完成 <b style="color:#3fb950">{len(done)}</b> / 93 镜 · 新 turnaround 角色卡 + 逐镜真实首尾帧 + 完整物理动作链 · int8_convrot · 自动刷新请手动重载</p>
  <div class="bar"><i></i></div>
</header>
<main>
{''.join(cards)}
</main></body></html>'''

open(f"{OUT}/index.html", "w").write(html)
print(f"✓ {OUT}/index.html — {len(done)}/93 镜")
print(f"  http://100.124.72.88:8123/index.html?v={v}")
