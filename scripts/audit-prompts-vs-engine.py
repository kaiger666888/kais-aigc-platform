#!/usr/bin/env python3
"""把 shot_analysis 引擎 ground truth(shot_XXX.json)与 prompts.json 对照,
标出 camera 运镜 / 景别 / 主体运动 不符的镜。用法: python3 audit-prompts-vs-engine.py"""
import json, os

ROOT = "/data/workspace/kais-aigc-platform"
SA = "/mnt/agents/output/gpu1/shot_analysis"
prompts = {p["shot_id"]: p for p in json.load(open(f"{ROOT}/data/oss/shot-timeline-ep01/prompts.json"))}

# prompt camera 关键词 → primitive(顺序敏感:先匹配更具体的)
KW_PRIM = [
    ("固定", "static"), ("静止", "static"),
    ("跟拍", "follow"), ("跟随", "follow"), ("跟", "follow"),
    ("手持", "handheld"), ("晃动", "handheld"),
    ("拉镜头", "dolly_out"), ("拉至", "dolly_out"), ("拉远", "dolly_out"), ("后拉", "dolly_out"), ("拉", "dolly_out"),
    ("推近", "dolly_in"), ("推进", "dolly_in"), ("前推", "dolly_in"), ("推", "dolly_in"),
    ("左摇", "pan_left"), ("右摇", "pan_right"),
    ("上摇", "tilt_up"), ("下摇", "tilt_down"), ("仰", "tilt_up"), ("俯", "tilt_down"),
    ("平移", "truck"), ("横移", "truck"),
]
def prompt_camera_prim(cam):
    if not cam: return None
    for kw, p in KW_PRIM:
        if kw in cam: return p
    return None

def norm(x):
    x = x or ""
    if "out" in x: return "拉"
    if "in" in x: return "推"
    return x

print(f"{'镜':>4} | {'引擎运镜':14s} | {'速':6s} | {'景别':6s} | {'prompt推断':12s} | {'camera原文':26s} | 判定")
print("-" * 116)
mismatch = []
done = 0
for sid in range(1, 94):
    sj = f"{SA}/shot_{sid:03d}.json"
    if not os.path.exists(sj): continue
    done += 1
    d = json.load(open(sj))
    geo = d.get("geometry", {}) or {}
    sem = d.get("semantic", {}) or {}
    prim = geo.get("primitive") or "?"
    amb = geo.get("ambiguous")
    agree = geo.get("flow_agreement") or 0
    speed = geo.get("speed") or "?"
    scale = sem.get("shot_scale") or "?"
    cam_full = prompts.get(sid, {}).get("camera") or ""
    cam_txt = cam_full[:26]
    pprim = prompt_camera_prim(cam_full)
    reliable = (not amb) and agree >= 0.3
    ok = "—"
    if pprim and reliable:
        ok = "✓" if (norm(pprim) == norm(prim) or pprim == prim) else "⚠️不符"
        if ok == "⚠️不符": mismatch.append((sid, prim, agree, pprim, cam_full))
    elif not reliable:
        ok = "(引擎不可信)"
    flag = "" if reliable else f" 🔧{agree:.2f}"
    print(f"#{sid:03d} | {prim:14s} | {speed:6s} | {scale:6s} | {(pprim or '-'):12s} | {cam_txt:26s} | {ok}{flag}")

print(f"\n已分析 {done}/93 镜。=== 运镜明确不符(引擎可信 & 与prompt矛盾):{len(mismatch)} 镜 ===")
for sid, prim, agree, pprim, cam in mismatch:
    print(f"  #{sid:03d}: 引擎={prim}(agree {agree:.2f}) vs prompt={pprim} | {cam}")
