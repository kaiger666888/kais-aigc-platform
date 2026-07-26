#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""解析 transcript.json → 前10镜(≤46.87s)逐句对白 + 说话人标注。
前10镜是"毛毛虫小孩(孩子)"与"独角仙武士(爸爸)"的对话 + 孩子开场旁白。
输出 engine_audio/dialogue_plan.json。
"""
import json, os

ROOT = "/data/workspace/kais-aigc-platform"
OUT = f"{ROOT}/workflows/ltx-2.3/shot-timeline-ep01-output/engine_audio"
TRANS = ("/data/workspace/kais-shot-timeline/output/虫虫武侠小故事《小江湖》第01话：爸爸去哪儿？"
         "（ 画面只是工具，情绪才是目的。/transcript.json")
SHOTS = f"{ROOT}/data/oss/shot-timeline-ep01/shots.json"
FIRST10_END = json.load(open(SHOTS))[9]["end_sec"]  # 46.87

# 说话人映射(按 transcript 段 start 时间,孩子=旁白者)。基于剧情人工标注。
SPEAKER_BY_START = {
    0.0: "kid",   # 八七六(孩子数数,游戏)
    2.16: "kid",  # 他有一百种方法逗我开心(孩子旁白)
    4.06: "kid",  # 每次都能成功
    5.62: "kid",  # 三二
    8.02: "kid",  # 我喜欢他
    9.1: "kid",   # 我的爸爸
    10.26: "kid", # 爸爸我不喜欢你总跟别人打架
    16.72: "kid", # 你打伤了怎么办
    18.16: "dad", # 好小子知道心疼爸爸了
    21.32: "dad", # 不过他们想找爸爸切磋
    23.28: "dad", # 爸爸是不能拒绝的
    25.28: "kid", # 爸爸(孩子喊)
    25.64: "dad", # 这是江湖的规矩
    27.44: "kid", # 爸爸(孩子喊)
    28.04: "kid", # 你不是说等我长大了就教我功夫吗
    32.08: "dad", # 可你还没长大呢
    33.44: "kid", # 你得快点呀
    34.68: "kid", # 不然等你老了谁来保护你呀
    37.42: "dad", # 不会那么快老的
    39.42: "dad", # 爸爸还要陪你玩呢
    41.44: "kid", # 又有人来打架了(孩子观察)
    45.16: "dad", # 阁下可是黑头前辈(爸爸对新来挑战者的正式称呼)
}

# 角色 instruct(音色描述),固定 seed 保证 voice_design 可复现
VOICE_PROFILES = {
    "kid": {
        "instruct": "奶声奶气的三岁幼儿童声,稚嫩柔软,带着奶音,口齿略微不清,天真可爱带撒娇,幼童学语的感觉,音调偏高",
        "seed": 42,
    },
    "dad": {
        "instruct": "沉稳温和的中年男性声音,略带沧桑与慈父感,语速平缓,武侠气质",
        "seed": 7,
    },
    "narrator": {  # 旁白:温暖青年男声画外音(明显区别于 3 岁童声对白,一听就是旁白)
        "instruct": "温暖醇厚的青年男性旁白声音,娓娓道来讲故事口吻,带有回忆与温情,成熟稳重,纪录片式画外音,语速平缓从容",
        "seed": 101,
    },
}

# 旁白/对白分界:0-10.26s 是孩子开场旁白(画外音回忆),10.26s 起才是与爸爸的实时对白
NARRATION_END = 10.26

trans = json.load(open(TRANS))
segs = trans["segments"]
lines = []
for s in segs:
    st = float(s["start"])
    if st >= FIRST10_END:
        break
    # 匹配说话人(允许 0.15s 容差)
    spk = None
    for k, v in SPEAKER_BY_START.items():
        if abs(st - k) < 0.15:
            spk = v; break
    if spk is None:
        spk = "kid"  # 默认孩子(旁白)
    txt = (s.get("text") or "").strip()
    if not txt:
        continue
    kind = "narration" if st < NARRATION_END else "dialogue"
    lines.append({
        "start": round(st, 2), "end": round(float(s["end"]), 2),
        "text": txt, "speaker": spk,
        "kind": kind,                       # narration=旁白(画外音,不驱动口型) / dialogue=对白(口型同步)
        "voice": "narrator" if kind == "narration" else spk,  # 用哪个 TTS 音色
    })

plan = {"first10_end": FIRST10_END, "voices": VOICE_PROFILES, "lines": lines}
os.makedirs(OUT, exist_ok=True)
json.dump(plan, open(f"{OUT}/dialogue_plan.json", "w"), ensure_ascii=False, indent=2)

# 打印
print(f"前10镜截止 {FIRST10_END}s | 对白 {len(lines)} 句(旁白分界 {NARRATION_END}s)")
print(f"{'#':>3} {'start':>6} {'kind':>5} {'voice':>5} {'spk':>4}  text")
print("-" * 72)
for i, ln in enumerate(lines):
    print(f"{i+1:>3} {ln['start']:>6.2f} {ln['kind']:>5} {ln['voice']:>5} {ln['speaker']:>4}  {ln['text']}")
from collections import Counter
c = Counter(ln["kind"] for ln in lines)
print("-" * 72)
print(f"统计: " + " | ".join(f"{k}={v}句" for k, v in c.items()))
print(f"\n✓ {OUT}/dialogue_plan.json")
