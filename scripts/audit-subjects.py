#!/usr/bin/env python3
"""对照引擎(QwenVL 看真实视频)识别的角色 vs prompts.json 声明的角色,
找出 prompt 错标角色(prompt 说有 X 但引擎没看到)。用法: python3 audit-subjects.py"""
import json, os, re

ROOT = "/data/workspace/kais-aigc-platform"
SA = "/mnt/agents/output/gpu1/shot_analysis"
prompts = {p["shot_id"]: p for p in json.load(open(f"{ROOT}/data/oss/shot-timeline-ep01/prompts.json"))}
CHARS = ["毛毛虫", "独角仙", "螳螂", "蜈蚣"]
# 引擎 subjects 文本里角色名可能带后缀(独角仙武士),用关键词匹配
CHAR_KW = {"毛毛虫": "毛毛虫", "独角仙": "独角仙", "螳螂": "螳螂", "蜈蚣": "蜈蚣"}

def chars_in(text):
    return set(c for c in CHARS if c in (text or ""))

print(f"{'镜':>4} | {'引擎识别角色':18s} | {'prompt声明':16s} | {'prompt多声明(疑错标)':18s} | {'引擎多看到':12s}")
print("-" * 95)
suspect = []
done = 0
for sid in range(1, 94):
    sj = f"{SA}/shot_{sid:03d}.json"
    if not os.path.exists(sj): continue
    done += 1
    d = json.load(open(sj))
    sem = d.get("semantic", {}) or {}
    eng_subj = sem.get("subjects") or ""
    if eng_subj.strip() in ("无", "null", ""):
        eng_chars = set()
    else:
        eng_chars = chars_in(eng_subj)
    p = prompts.get(sid, {})
    decl = chars_in((p.get("subject") or "") + " " + (p.get("action") or ""))
    prompt_extra = decl - eng_chars      # prompt 说但引擎没看到 → 疑错标
    engine_extra = eng_chars - decl      # 引擎看到但 prompt 没说
    flag = ""
    if prompt_extra:
        flag = " ⚠️"
        suspect.append((sid, sorted(decl), sorted(eng_chars), eng_subj, (p.get("subject") or "")[:40]))
    print(f"#{sid:03d} | {('/'.join(sorted(eng_chars)) or '空镜'):18s} | {'/'.join(sorted(decl)) or '-':16s} | {'/'.join(sorted(prompt_extra)) or '-':18s} | {'/'.join(sorted(engine_extra)) or '-':12s}{flag}")

print(f"\n已分析 {done}/93。=== 疑似角色错标(prompt 声明了引擎未识别的角色):{len(suspect)} 镜 ===")
for sid, decl, eng, esubj, psubj in suspect:
    print(f"  #{sid:03d}: prompt={decl} vs 引擎={eng or '空镜'}")
    print(f"        引擎subjects: {esubj}")
    print(f"        prompt.subject: {psubj}")
