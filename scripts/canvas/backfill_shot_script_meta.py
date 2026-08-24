#!/usr/bin/env python3
"""backfill_shot_script_meta.py — 存量分镜板 o_assets.meta 的正文回填。

canvas_sync._persist_storyboard_board 自 2026-08-23 起会把 P09 shot-list
正文（video_prompt / dialogue_text / pacing …）并入 board.scenes[].shots[].script
（新跑的管线自动获得）。本脚本给【已存在】的 storyboard_board 行做同样的合并：
按 meta.episode_id 定位 {EPISODES_DIR}/{episode_id}/.pipeline-assets/shot-list.json，
_merge_shot_script 后 UPDATE meta。幂等：已并入的 script 字段会被同值覆盖。

用法：
    PYTHONPATH=/data/workspace/kais-hermes-skills \
      python3 backfill_shot_script_meta.py [--episodes-dir DIR] [--episode ID]
"""
import argparse
import json
import os
import shutil
import sqlite3
import time

DB = "/data/workspace/kais-aigc-platform/data/db2.sqlite"
DEFAULT_EPISODES_DIR = (
    "/data/workspace/kais-hermes-skills/skills/kais-movie-pipeline/episodes"
)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--episodes-dir", default=DEFAULT_EPISODES_DIR)
    ap.add_argument("--episode", default="", help="只处理该 episode_id（默认全部）")
    ap.add_argument("--db", default=DB)
    args = ap.parse_args()

    from plugins.kais_aigc.canvas_sync import _merge_shot_script

    bak = f"{args.db}.bak.{int(time.time())}"
    shutil.copy(args.db, bak)
    print(f"[backup] {bak}")

    conn = sqlite3.connect(args.db)
    conn.execute("PRAGMA busy_timeout=10000")
    rows = conn.execute(
        "SELECT id, projectId, episodesId, meta FROM o_assets "
        "WHERE type='storyboard_board'"
    ).fetchall()
    updated = 0
    for asset_id, proj, eps, meta_str in rows:
        try:
            board = json.loads(meta_str or "")
        except ValueError:
            print(f"  [skip] id={asset_id}: meta 非 JSON")
            continue
        episode_id = board.get("episode_id") or ""
        if args.episode and episode_id != args.episode:
            continue
        workdir = os.path.join(args.episodes_dir, episode_id)
        if not os.path.isdir(workdir):
            print(f"  [skip] id={asset_id}: workdir 不存在 {workdir}")
            continue
        before = sum(
            1 for sc in board.get("scenes") or []
            for sh in sc.get("shots") or [] if sh.get("script")
        )
        merged = _merge_shot_script(board, workdir)
        after = sum(
            1 for sc in merged.get("scenes") or []
            for sh in sc.get("shots") or [] if sh.get("script")
        )
        if after == before:
            print(f"  [noop] id={asset_id} {episode_id}: 无新正文（{after} 已并入）")
            continue
        conn.execute(
            "UPDATE o_assets SET meta=? WHERE id=?",
            (json.dumps(merged, ensure_ascii=False), asset_id),
        )
        updated += 1
        print(f"  [update] id={asset_id} {episode_id}: script {before}→{after} 镜")
    conn.commit()
    conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    conn.close()
    print(f"=== done: {updated} row(s) updated ===")


if __name__ == "__main__":
    main()
