#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""建 prompt 编辑对比页:每镜左=foley成片视频,右=可编辑 prompt 字段(prompts.json 源)。
编辑存 localStorage,顶部「导出 prompts.json」按钮下载修改后的版本供重生成。"""
import json, os
from html import escape

ROOT = "/data/workspace/kais-aigc-platform"
OUT = f"{ROOT}/workflows/ltx-2.3/shot-timeline-ep01-output"
SHOTS = f"{ROOT}/data/oss/shot-timeline-ep01/shots.json"
PROMPTS = f"{ROOT}/data/oss/shot-timeline-ep01/prompts.json"

shots = json.load(open(SHOTS))[:10]
prompts = {p["shot_id"]: p for p in json.load(open(PROMPTS))}
# 嵌入每镜 prompt 数据(只保留可编辑字段)
edit_fields = ["subject", "action", "camera", "scene", "lighting", "style", "prompt_text"]
data = {}
for s in shots:
    sid = s["id"]; p = prompts.get(sid, {})
    data[sid] = {k: p.get(k, "") for k in edit_fields}

DATA_JSON = json.dumps(data, ensure_ascii=False)

def vid(fname, label):
    if not os.path.exists(f"{OUT}/{fname}"):
        return f'<div class="cell"><b>{label}</b><div class="pending">无</div></div>'
    return (f'<div class="cell"><b>{label}</b><video controls loop preload="metadata">'
            f'<source src="{fname}?v=pe2" type="video/mp4"></video></div>')

rows = []
for s in shots:
    sid = s["id"]
    tall = {"action", "prompt_text", "subject"}
    fields_html = "".join(
        f'<label>{k}<textarea data-sid="{sid}" data-k="{k}" rows="{2 if k in tall else 1}"></textarea></label>'
        for k in edit_fields)
    orig = vid(f"orig_shot{sid:03d}_sound.mp4", "原片(原声)")
    gen = vid(f"stlep01_shot{sid:03d}_foley.mp4", "生成 Foley")
    rows.append(f'''<section class="shot" data-sid="{sid}">
  <div class="vleft"><div class="title"><b>#{sid:03d}</b> <span class="dur">({s["end_sec"]-s["start_sec"]:.1f}s)</span></div><div class="vrow">{orig}{gen}</div></div>
  <div class="vright">{fields_html}</div>
</section>''')

html = f'''<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>小江湖 EP01 前10镜 · prompt 编辑</title>
<style>
*{{box-sizing:border-box}} body{{margin:0;background:#0f0f10;color:#eee;font-family:-apple-system,"PingFang SC",sans-serif}}
header{{padding:14px 24px;background:#161616;border-bottom:1px solid #2a2a2a;position:sticky;top:0;z-index:3;display:flex;align-items:center;gap:14px;flex-wrap:wrap}}
header h1{{margin:0;font-size:16px}} header .hint{{color:#888;font-size:11px;flex:1;min-width:200px}}
button{{background:#2a4a2a;color:#7ee787;border:1px solid #3a6a3a;padding:7px 14px;border-radius:5px;cursor:pointer;font-size:12px}}
button:hover{{background:#3a5a3a}} #status{{color:#888;font-size:11px}}
main{{padding:14px 24px;display:grid;gap:12px;max-width:1600px;margin:0 auto}}
.shot{{display:grid;grid-template-columns:560px 1fr;gap:14px;background:#181818;border:1px solid #2a2a2a;border-radius:8px;padding:12px}}
.vleft .title{{margin-bottom:6px}} .vleft .title b{{color:#7ee787;font-size:14px}} .vleft .dur{{color:#888;font-size:11px;font-weight:normal}}
.vrow{{display:grid;grid-template-columns:1fr 1fr;gap:8px}}
.vleft .cell{{display:flex;flex-direction:column}} .vleft .cell b{{font-size:10px;color:#aaa;margin-bottom:4px}}
.vleft .cell:nth-child(2) b{{color:#7ee787}}
.vleft video{{width:100%;max-height:170px;background:#000;border-radius:5px}}
.vright{{display:grid;grid-template-columns:1fr 1fr;gap:8px}}
.vright label{{display:flex;flex-direction:column;font-size:10px;color:#888;gap:3px;grid-column:1/-1}}
.vright label:nth-child(-n+3){{grid-column:auto}}
textarea{{background:#0f0f10;color:#ddd;border:1px solid #333;border-radius:4px;padding:6px;font-size:12px;font-family:inherit;line-height:1.45;resize:vertical;min-height:32px}}
textarea:focus{{border-color:#7ee787;outline:none}} textarea[data-k="action"],textarea[data-k="prompt_text"]{{min-height:60px}}
.pending{{height:100px;display:flex;align-items:center;justify-content:center;background:#1a1a1a;border-radius:5px;color:#555;font-size:11px}}
</style></head><body>
<header>
  <h1>前10镜 prompt 编辑</h1>
  <span class="hint">右编辑各镜 prompt(subject/action/camera/scene…),自动存本地。改完点导出 → 把 prompts.json 给我重生成该镜。</span>
  <button onclick="exportJson()">⬇ 导出 prompts.json</button>
  <button onclick="resetAll()">↺ 重置</button>
  <span id="status"></span>
</header>
<main>{''.join(rows)}</main>
<script>
const DATA = {DATA_JSON};
const LS_KEY = "xjh_ep01_prompts_edits";
function loadEdits(){{try{{return JSON.parse(localStorage.getItem(LS_KEY)||"{{}}")}}catch{{return{{}}}}}}
let edits = loadEdits();
// 当前值:edits 覆盖原数据
function cur(sid,k){{return (edits[sid]&&edits[sid][k]!==undefined)?edits[sid][k]:DATA[sid][k]}}
function fillAll(){{document.querySelectorAll("textarea").forEach(t=>{{t.value=cur(+t.dataset.sid,t.dataset.k)}})}}
function saveStatus(){{const n=Object.keys(edits).length;document.getElementById("status").textContent=n?"已改 "+n+" 镜(存本地)":""}}
document.querySelectorAll("textarea").forEach(t=>t.addEventListener("input",e=>{{
  const sid=e.target.dataset.sid,k=e.target.dataset.k; if(!edits[sid])edits[sid]={{}};
  if(e.target.value===DATA[sid][k]){{delete edits[sid][k];if(!Object.keys(edits[sid]).length)delete edits[sid]}}
  else edits[sid][k]=e.target.value;
  localStorage.setItem(LS_KEY,JSON.stringify(edits)); saveStatus();
}}));
function exportJson(){{const out=[];for(const[sid,d]of Object.entries(DATA)){{const merged={{...d,...(edits[sid]||{{}})}};merged.shot_id=+sid;out.push(merged)}}out.sort((a,b)=>a.shot_id-b.shot_id);
  const blob=new Blob([JSON.stringify(out,null,2)],{{type:"application/json"}});const a=document.createElement("a");
  a.href=URL.createObjectURL(blob);a.download="prompts_first10_edited.json";a.click();document.getElementById("status").textContent="已导出 prompts_first10_edited.json";}}
function resetAll(){{if(confirm("清空本地修改,恢复源 prompts?")){{edits={{}};
  localStorage.removeItem(LS_KEY);fillAll();saveStatus();}}}}
fillAll();saveStatus();
</script></body></html>'''
open(f"{OUT}/prompt_edit.html", "w").write(html)
print(f"✓ {OUT}/prompt_edit.html")
print(f"  http://100.124.72.88:8123/prompt_edit.html?v=pe")
