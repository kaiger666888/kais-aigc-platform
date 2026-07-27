#!/usr/bin/env python3
"""把原视频逐镜首帧拼成带标注网格,供肉眼核对 prompt(subject/action)是否与原片相符。
用法: python3 scripts/montage-shots.py <start> <end> [cols=5]
每格 = 原片该镜首帧 + 顶部红字 shot 号 + 白字 prompt.subject(截断)。"""
import sys, json, os
from PIL import Image, ImageDraw, ImageFont

ROOT = "/data/workspace/kais-aigc-platform"
SHOT_DIR = "/data/workspace/kais-shot-timeline/output/虫虫武侠小故事《小江湖》第01话：爸爸去哪儿？（ 画面只是工具，情绪才是目的。/shot_frames"
ASSET = f"{ROOT}/data/oss/shot-timeline-ep01"
prompts = {p["shot_id"]: p for p in json.load(open(f"{ASSET}/prompts.json"))}

# 支持范围(2参)或逗号列表(1参);kind=first/last
if "," in sys.argv[1]:
    ids = [int(x) for x in sys.argv[1].split(",") if x.strip()]
    kind = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] in ("first", "last") else "first"
    cols = int(sys.argv[3]) if len(sys.argv) > 3 else 4
else:
    a, b = int(sys.argv[1]), int(sys.argv[2])
    kind = sys.argv[3] if len(sys.argv) > 3 and sys.argv[3] in ("first", "last") else "first"
    cols = int(sys.argv[4]) if len(sys.argv) > 4 else 4
    ids = list(range(a, b + 1))
TW, TH = 360, 270  # tile size
PAD = 46          # top label area
ids = [i for i in range(a, b+1) if os.path.exists(f"{SHOT_DIR}/shot_{i:03d}_first.jpg")]
rows = (len(ids) + cols - 1) // cols
W, H = cols*TW, rows*(TH+PAD)
canvas = Image.new("RGB", (W, H), (15,15,15))
draw = ImageDraw.Draw(canvas)
try:
    font_b = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 26)
    font_s = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 15)
except Exception:
    font_b = ImageFont.load_default(); font_s = ImageFont.load_default()

def cn_len(s):  # crude truncation (CJK ~2x)
    out, n = "", 0
    for ch in s:
        w = 2 if ord(ch) > 127 else 1; n += w
        if n > 52: return out + "…"
        out += ch
    return out

for idx, sid in enumerate(ids):
    r, c = divmod(idx, cols)
    x, y = c*TW, r*(TH+PAD)
    img = Image.open(f"{SHOT_DIR}/shot_{sid:03d}_first.jpg").convert("RGB").resize((TW, TH))
    canvas.paste(img, (x, y+PAD))
    subj = cn_len(prompts.get(sid, {}).get("subject", "") or "")
    draw.rectangle([x, y, x+TW, y+PAD], fill=(40,12,12))
    draw.text((x+8, y+4), f"#{sid}", fill=(255,90,90), font=font_b)
    draw.text((x+70, y+10), subj, fill=(235,235,235), font=font_s)

out = f"{ROOT}/workflows/ltx-2.3/shot-timeline-ep01-output/audit_montage_{a:03d}-{b:03d}.jpg"
canvas.save(out, quality=82)
print(f"✓ {out} ({len(ids)} 镜, {cols}×{rows})")
