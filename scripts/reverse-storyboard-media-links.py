#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
reverse-storyboard-media-links.py — 逆推资产集项目 storyboard 节点媒体富化（一次性、幂等）。

背景（小江湖·逆推资产集 ep01, project 1786905537220）：
  93 个 a-shot_list-S{NNN} storyboard 节点有 shot_id/start_sec/end_sec/duration_sec/
  prompt_text，但缺 firstFrameUrl/lastFrameUrl/clipPath/audioStems → 画布时间轴只有
  一张缩略图、点不开视频、右侧无音轨。

  同项目已有 186 个 keyframe 节点（a-midframes-S{NNN}_first / _last，shot_id 形如
  `S001_first`），filePath 指向 /oss/pipeline/<hash>/S{NNN}_{first,last}_reverse.jpg。
  原片 mp4 与 Demucs 4-stem wav 在 /oss/<片名>/ 目录下（目录名=文件名，全角括号+空格，
  前端播放时自行 encodeURI）。

写键规则（对每个 storyboard 节点 data 追加，已有键不覆盖 → 幂等）：
  firstFrameUrl  ← keyframe 节点 shot_id={sid}_first 的 filePath（DB JOIN，不硬编码 hash）
  lastFrameUrl   ← keyframe 节点 shot_id={sid}_last  的 filePath
  clipPath       ← 原片 mp4 的 /oss/ 原样路径（不 URL-encode）
  audioStems     ← {"vocals":…,"drums":…,"bass":…,"other":…} 四条 /oss/…wav（同 clipPath 目录）

用法（仓库根目录）：
  python3 scripts/reverse-storyboard-media-links.py --dry-run   # 只打印将改的键数
  python3 scripts/reverse-storyboard-media-links.py             # 备份后写库

只写 canvas_nodes.data（UPDATE JSON 反序列化→追加→序列化），不动其他表。
"""

import argparse
import json
import shutil
import sqlite3
import sys
import time
from pathlib import Path

PROJECT_ID = 1786905537220
EPISODES_ID = 1
DB_PATH = Path(__file__).resolve().parent.parent / "data" / "db2.sqlite"

# 原片目录（data/oss 下）。目录名=文件名（全角括号+空格）。路径存原样、不 encode。
FILM_DIR_NAME = "虫虫武侠小故事《小江湖》第01话：爸爸去哪儿？（ 画面只是工具，情绪才是目的。"
FILM_BASE = FILM_DIR_NAME  # mp4 主名与目录名相同
STEM_NAMES = ("vocals", "drums", "bass", "other")

TARGET_KEYS = ("firstFrameUrl", "lastFrameUrl", "clipPath", "audioStems")


def build_source_paths() -> dict[str, str]:
    """构造 clipPath / audioStems 的 /oss/ 源路径（原样、不 URL-encode）。"""
    paths = {
        "clipPath": f"/oss/{FILM_DIR_NAME}/{FILM_BASE}.mp4",
        "audioStems": {
            stem: f"/oss/{FILM_DIR_NAME}/{FILM_BASE}_{stem}.wav" for stem in STEM_NAMES
        },
    }
    return paths


def load_keyframe_map(con: sqlite3.Connection) -> dict[str, str]:
    """shot_id（含 _first/_last 后缀）→ filePath，取自同项目 keyframe asset 节点。"""
    rows = con.execute(
        "SELECT data FROM canvas_nodes "
        "WHERE project_id = ? AND episodes_id = ? AND type = 'asset'",
        (PROJECT_ID, EPISODES_ID),
    ).fetchall()
    kf: dict[str, str] = {}
    for (raw,) in rows:
        try:
            d = json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            continue
        sid = d.get("shot_id")
        fp = d.get("filePath")
        if isinstance(sid, str) and isinstance(fp, str) and (sid.endswith("_first") or sid.endswith("_last")):
            # 首次写入优先（同 shot_id 多节点时保留最先注册的）
            kf.setdefault(sid, fp)
    return kf


def main() -> int:
    ap = argparse.ArgumentParser(description="storyboard 节点媒体键富化（幂等）")
    ap.add_argument("--dry-run", action="store_true", help="只打印将改的键数，不写库")
    args = ap.parse_args()

    if not DB_PATH.exists():
        print(f"[ERR] DB 不存在: {DB_PATH}", file=sys.stderr)
        return 1

    src = build_source_paths()
    # 源文件物理存在性检查（防目录改名后写入死链）
    oss_root = DB_PATH.parent / "oss"
    for p in [src["clipPath"], *src["audioStems"].values()]:
        fs = oss_root / p.removeprefix("/oss/")
        if not fs.exists():
            print(f"[ERR] 源文件不存在: {fs}", file=sys.stderr)
            return 1

    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    try:
        kf = load_keyframe_map(con)

        rows = con.execute(
            "SELECT id, data FROM canvas_nodes "
            "WHERE project_id = ? AND episodes_id = ? AND type = 'storyboard' ORDER BY id",
            (PROJECT_ID, EPISODES_ID),
        ).fetchall()

        plan: list[tuple[str, dict, dict]] = []  # (node_id, 原data, 追加后data)
        key_counts = {k: 0 for k in TARGET_KEYS}
        missing_first: list[str] = []
        missing_last: list[str] = []

        for r in rows:
            node_id = r["id"]
            try:
                data = json.loads(r["data"])
            except (json.JSONDecodeError, TypeError):
                print(f"[WARN] {node_id} data 非法 JSON，跳过", file=sys.stderr)
                continue
            if not isinstance(data, dict):
                print(f"[WARN] {node_id} data 非 object，跳过", file=sys.stderr)
                continue

            sid = data.get("shot_id")
            if not isinstance(sid, str) or not sid:
                print(f"[WARN] {node_id} 无 shot_id，跳过", file=sys.stderr)
                continue

            new = dict(data)
            changed = False

            if "firstFrameUrl" not in new:
                fp = kf.get(f"{sid}_first")
                if fp:
                    new["firstFrameUrl"] = fp
                    key_counts["firstFrameUrl"] += 1
                    changed = True
                else:
                    missing_first.append(node_id)
            if "lastFrameUrl" not in new:
                fp = kf.get(f"{sid}_last")
                if fp:
                    new["lastFrameUrl"] = fp
                    key_counts["lastFrameUrl"] += 1
                    changed = True
                else:
                    missing_last.append(node_id)
            if "clipPath" not in new:
                new["clipPath"] = src["clipPath"]
                key_counts["clipPath"] += 1
                changed = True
            if "audioStems" not in new:
                new["audioStems"] = dict(src["audioStems"])
                key_counts["audioStems"] += 1
                changed = True

            if changed:
                plan.append((node_id, data, new))

        print(f"storyboard 节点: {len(rows)}，待改: {len(plan)}")
        for k in TARGET_KEYS:
            print(f"  将写 {k}: {key_counts[k]}")
        if missing_first:
            print(f"  [WARN] keyframe first 缺失 {len(missing_first)}: {missing_first[:5]}")
        if missing_last:
            print(f"  [WARN] keyframe last 缺失 {len(missing_last)}: {missing_last[:5]}")

        if args.dry_run:
            print("[dry-run] 未写库")
            return 0

        if not plan:
            print("无需变更（幂等复跑）")
            return 0

        # 写前备份（.backup API，防中文 JSON 被 shell 损坏——全程 Python）
        ts = time.strftime("%Y%m%d-%H%M%S")
        bak = DB_PATH.with_name(f"db2.sqlite.bak-storyboard-media-{ts}")
        src_db = con  # sqlite3 在线 backup
        dst = sqlite3.connect(bak)
        with dst:
            src_db.backup(dst)
        dst.close()
        print(f"备份: {bak}")

        ts_ms = int(time.time() * 1000)
        with con:
            for node_id, _, new in plan:
                con.execute(
                    "UPDATE canvas_nodes SET data = ?, updated_at = ? WHERE id = ?",
                    (json.dumps(new, ensure_ascii=False), ts_ms, node_id),
                )
        print(f"已更新 {len(plan)} 节点")

        # 写后自查
        n_ok = con.execute(
            "SELECT count(*) FROM canvas_nodes "
            "WHERE project_id = ? AND episodes_id = ? AND type = 'storyboard' "
            "AND data LIKE '%\"firstFrameUrl\": \"%' "
            "AND data LIKE '%\"lastFrameUrl\": \"%' "
            "AND data LIKE '%\"clipPath\": \"%'",
            (PROJECT_ID, EPISODES_ID),
        ).fetchone()[0]
        total = con.execute(
            "SELECT count(*) FROM canvas_nodes "
            "WHERE project_id = ? AND episodes_id = ? AND type = 'storyboard'",
            (PROJECT_ID, EPISODES_ID),
        ).fetchone()[0]
        print(f"自查: {n_ok}/{total} storyboard 三键非空")
        if n_ok != total:
            print("[ERR] 自查未满额", file=sys.stderr)
            return 1
    finally:
        con.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
