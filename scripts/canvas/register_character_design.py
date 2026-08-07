#!/usr/bin/env python3
"""
register_character_design.py — 把 24 张角色设定图（概念设计图 v1/v2/v3）同步到 canvas_nodes。

这些图是 o_assets 中 type='character'、workflow_phase IS NULL、name 含 v1/v2/v3 的角色
概念设计图，是**生成灰底 turnaround 的参考图**（独立于灰底/换装 turnaround 实物，也独立于
Notion character_bible 纯文字描述）。它们在 o_assets 已有完整记录（含 o_image 双向链接），
但 canvas_nodes 中缺对应展示节点 → 本脚本补齐，供管线 DAG 的「角色设定图」步骤匹配。

幂等：按 node id UPSERT（ON CONFLICT(id, project_id, episodes_id)），再跑只刷新 data。
只写 canvas_nodes，**不**改 o_assets / o_image（资产本体已存在）。

id 格式：a-character_design-{characterId}-v{N}（N 从 name 提取，如 v1/v2/v3）。
"""
import json
import os
import re
import sqlite3
import sys
import time

DB = "/data/workspace/kais-aigc-platform/data/db2.sqlite"
PROJ_ID = 1785508691757
EPS_ID = 1

# name 形如「程屿 v1」「陆衍舟 v2」→ 提取版本号
VERSION_RE = re.compile(r"\bv(\d+)\b", re.IGNORECASE)


def main():
    if not os.path.exists(DB):
        sys.exit(f"[ERROR] DB not found: {DB}")

    ts = int(time.time())
    bak = f"{DB}.bak.{ts}"
    os.system(f"cp {DB} {bak}")
    print(f"[backup] {bak}")

    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    # 角色概念设计图：type=character 且无 workflow_phase，排除 turnaround/character_bible/服化道
    rows = cur.execute(
        "SELECT a.id AS asset_id, a.name, a.characterId AS cid, a.imageId, "
        "a.prompt, a.model, i.filePath "
        "FROM o_assets a LEFT JOIN o_image i ON a.imageId = i.id "
        "WHERE a.projectId=? AND a.type='character' AND a.workflow_phase IS NULL "
        "AND a.name NOT LIKE '%Turnaround%' AND a.name NOT LIKE '%character_bible%' "
        "AND a.name NOT LIKE '%服化道%' "
        "ORDER BY a.characterId, a.name",
        (PROJ_ID,)).fetchall()
    print(f"[query] matched o_assets = {len(rows)}")

    now_ms = int(time.time() * 1000)
    stats = {"nodes": 0, "skipped": 0}

    conn.execute("BEGIN")
    try:
        for r in rows:
            name = r["name"]
            cid = r["cid"]
            m = VERSION_RE.search(name)
            if not m:
                stats["skipped"] += 1
                print(f"  [skip] {name} (无 vN 版本号)")
                continue
            vN = m.group(1)
            file_path = r["filePath"] or ""

            node_id = f"a-character_design-{cid}-v{vN}"
            # 不设 curationState / isPrimaryView → curation=neutral → DAG 显示 completed（绿），
            # 且不污染资产管理中心衣柜（isPrimaryView 缺省=0，不会进 selected/待选 过滤）。
            node_data = {
                "label": name,
                "type": "asset",
                "assetType": "character",
                "characterId": cid,
                "name": name,
                "version": f"v{vN}",
                "filePath": file_path,
                "thumbnailUrl": file_path,
                "imageUrl": file_path,
                "image": file_path,
                "src": file_path,
                "prompt": r["prompt"] or "",
                "model": r["model"] or "",
                "phaseIndex": 4,
                "phaseName": "P04 角色设计",
                "modality": "image",
                "state": "success",
                "designRole": "turnaround_reference",
                "description": f"{name} 角色概念设计图（灰底 turnaround 参考图）",
            }
            cur.execute(
                "INSERT INTO canvas_nodes (id, project_id, episodes_id, type, branch_id, "
                "phase_index, phase_name, position_x, position_y, size_width, size_height, "
                "data, state, review_status, is_winner, variant_of, variant_group_id, "
                "created_at, updated_at) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) "
                "ON CONFLICT(id, project_id, episodes_id) DO UPDATE SET "
                "data=excluded.data, type=excluded.type, phase_index=excluded.phase_index, "
                "phase_name=excluded.phase_name, updated_at=excluded.updated_at",
                (node_id, PROJ_ID, EPS_ID, "asset", "main", 4, "p04_character_design",
                 0, 0, 260, 180, json.dumps(node_data, ensure_ascii=False),
                 "success", None, 0, None, None, now_ms, now_ms))
            stats["nodes"] += 1
            print(f"  [node] {node_id}  <- {name}  ({file_path})")

        conn.commit()
    except Exception as e:
        conn.rollback()
        print(f"[ERROR] rolled back: {e}")
        raise

    cur.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    conn.close()

    print("\n=== summary ===")
    print(f"canvas_nodes upserted : {stats['nodes']}")
    print(f"skipped (no vN)       : {stats['skipped']}")
    print(f"backup                : {bak}")


if __name__ == "__main__":
    main()
