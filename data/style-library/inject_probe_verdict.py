#!/usr/bin/env python3
"""一次性脚本:向 styles_master.json 注入 probe_verdict 字段(Kai Z-Image Turbo 探针终审)。

背景(2026-09-06,任务书「probe_verdict 注入数据」节):
  20 条风格经 Z-Image Turbo 迁移探针 + Kai 终审判定 pass 12 / fix 7 / reject 1;
  选择器对 reject(Anime-Cel 的 Analog Glitch — Neon Cel Smear)默认隐藏、可显式打开。
  其余 3528 条未探针,写 null(不是 false——「未探针」与「探针不过」是两回事)。

方案 (a) 数据与代码分离:映射直接烧进本脚本(prompt 要求「直接采用勿重新推导」),
探针后续扩量只改这里重跑;幂等——重复执行按 id 覆写同值,无副作用。

用法: python3 inject_probe_verdict.py  (在本目录或仓库任意 cwd 均可,路径按脚本自身定位)
"""

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
MASTER = os.path.join(HERE, "styles_master.json")

# Kai 终审 20 条 id(=category_en::name)→ verdict。逐字采用任务书,勿改写勿重推导。
PROBE_VERDICTS = {
    "Photo-Cinematic Narrative::Amber Transit Nostalgia": "fix",
    "Photo-Cinematic Narrative::Analog Cybernetic Nostalgia": "fix",
    "3D-Photoreal::Cinematic Stylized Fantasy": "pass",
    "3D-Photoreal::Ethereal Solarpunk Pastoral — Glossy 3D Utopia": "fix",
    "3D-Stylized::Architectural Voxel Synthesis": "pass",
    "3D-Stylized::Charming Isometric Voxelworlds": "pass",
    "Anime-Cel::Analog Glitch Nostalgia — Neon Cel Smear": "reject",
    "Anime-Cel::Bioluminescent Cosmic Abyss": "pass",
    "Atmosphere-Cyber Future::Atmospheric Industrial Dystopia — Teal Amber Fog": "pass",
    "Atmosphere-Cyber Future::Celestial Alchemical Opulence": "fix",
    "Atmosphere-Gothic Dark Romantic::Abyssal Gothic Surrealism": "pass",
    "Atmosphere-Gothic Dark Romantic::Amber Chiaroscuro Cinematic": "pass",
    "Painting-Surreal Dreamlike::Amber Surrealist Horizons": "pass",
    "Painting-Surreal Dreamlike::Amber Surrealist Still-Life": "fix",
    "Painting-Oil Classical::Amber Atmospheric Grandeur": "fix",
    "Painting-Oil Classical::Analog Glitch Mysticism": "fix",
    "Digital-Concept Art::Arctic Grimdark Mythos": "pass",
    "Digital-Concept Art::Bioluminescent Abyssal Mysticism": "pass",
    "Design-Flat Vector::Bold Graphic Neon Surrealism": "pass",
    "Design-Flat Vector::Crimson Noir Graphic — Burnt Orange Vector": "pass",
}


def main() -> int:
    with open(MASTER, encoding="utf-8") as f:
        rows = json.load(f)

    hit: dict[str, str] = {}
    for row in rows:
        verdict = PROBE_VERDICTS.get(row.get("id"))
        row["probe_verdict"] = verdict  # 未探针 → null
        if verdict is not None:
            hit[row["id"]] = verdict

    missed = sorted(set(PROBE_VERDICTS) - set(hit))
    if missed:
        # 任务书注:「Ethereal Noir Motion — Spectral Smear 已不存在勿找」——该条
        # 本就不在上表;其余任何 miss 都是 id 漂移,须人工核对勿静默吞。
        print("!! 映射中未被命中的 id:", file=sys.stderr)
        for mid in missed:
            print("   -", mid, file=sys.stderr)
        return 1

    with open(MASTER, "w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False, indent=2)
        f.write("\n")

    tally = {"pass": 0, "fix": 0, "reject": 0, None: 0}
    for row in rows:
        tally[row["probe_verdict"]] += 1
    print(f"OK 总 {len(rows)} 条 | pass {tally['pass']} / fix {tally['fix']} / "
          f"reject {tally['reject']} / null(未探针) {tally[None]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
