#!/usr/bin/env python3
# [DEPRECATED — Phase 50, 2026-08-19]
# Manual historical registration tool — kept as historical evidence per
# decision D-12 (never deleted). Do NOT use for new registrations; do NOT
# cron. New assets flow through the Phase 48 candidate-aware ingest route
# POST /api/v1/pipeline/ingest/images (src/routes/v1/pipeline/ingest/images.ts),
# which lands candidate groups (member assetsId -> primary, exactly-one
# isPrimaryView) + workflow_phase automatically.
"""
register_storyboard_sheets.py — 把白模分镜板整图注册为画布资产（a-storyboard_sheet-*）。

消费 gen_storyboard_sheets.py 产出的 manifest_storyboard.json，把每张 status=ok 且
PNG>20KB 的 sheet 幂等 UPSERT 成 canvas_nodes（id=a-storyboard_sheet-{tag}），并汇总成
一条 o_assets（type='storyboard_board'）记录，其 meta 存全板概要供快照 tier 消费。

幂等：按 (id, project_id, episodes_id) ON CONFLICT DO UPDATE；o_assets 按
(projectId, episodesId, type) 判定存在即刷新 meta。

DAG 节点 storyboard-board（match idPrefix='a-storyboard_sheet-'）由此注册点亮；
storyboard API 的 storyboard-board sheet 缩略图 tier（sheetByScene）由此读取
data.thumbnailUrl；API 用 data.shot_id（首个 shot）反推 scene 前缀。

用法:
    python3 register_storyboard_sheets.py --project-id 1785508691757
    python3 register_storyboard_sheets.py --project-id 1785508691757 \\
        --out-dir /data/workspace/kais-aigc-platform/data/oss/1785508691757/p09/storyboard_sheets
"""
import argparse, json, os, sqlite3, sys, time

DB = "/data/workspace/kais-aigc-platform/data/db2.sqlite"
DEFAULT_OSS_BASE = "/data/workspace/kais-aigc-platform/data/oss"
MANIFEST_NAME = "manifest_storyboard.json"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--project-id", required=True, type=int)
    ap.add_argument("--episodes-id", type=int, default=1)
    ap.add_argument("--out-dir", default="",
                    help="sheet PNG + manifest 目录（默认 {OSS_BASE}/{project-id}/p09/storyboard_sheets）")
    ap.add_argument("--manifest", default="", help="覆盖 manifest 路径")
    args = ap.parse_args()

    proj, eps = args.project_id, args.episodes_id
    out_dir = args.out_dir or os.path.join(DEFAULT_OSS_BASE, str(proj), "p09", "storyboard_sheets")
    manifest_path = args.manifest or os.path.join(out_dir, MANIFEST_NAME)
    oss_subdir = f"/oss/{proj}/p09/storyboard_sheets"

    if not os.path.isfile(manifest_path):
        print(f"[ERROR] manifest not found: {manifest_path}（先跑 gen_storyboard_sheets.py）")
        sys.exit(1)
    manifest = [m for m in json.load(open(manifest_path, encoding="utf-8"))
                if isinstance(m, dict) and m.get("status") == "ok" and m.get("path")]
    if not manifest:
        print(f"[WARN] no status=ok sheets in manifest — nothing to register")
        sys.exit(0)

    ts = int(time.time())
    bak = f"{DB}.bak.{ts}"
    os.system(f"cp {DB} {bak}")
    print(f"[backup] {bak}")

    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    now_ms = int(time.time() * 1000)
    stats = {"nodes": 0, "skipped": 0}

    sheets_summary = []  # for the o_assets board meta

    conn.execute("BEGIN")
    try:
        for m in manifest:
            fname = os.path.basename(m["path"])
            fs_path = os.path.join(out_dir, fname)
            if not os.path.exists(fs_path) or os.path.getsize(fs_path) < 20480:
                print(f"  [skip] {m.get('sheet')} (file missing/too small)")
                stats["skipped"] += 1
                continue

            try:
                from PIL import Image
                with Image.open(fs_path) as im:
                    w, h = im.size
            except Exception:
                w, h = 1440, 2560

            tag = m.get("sheet") or f"sheet_{stats['nodes']}"
            oss_path = f"{oss_subdir}/{fname}?v={now_ms}"
            node_id = f"a-storyboard_sheet-{tag.lower()}"
            shot_ids = m.get("shot_ids") or []
            first_shot = shot_ids[0] if shot_ids else tag
            scene_key = m.get("scene_key")
            scene_label = m.get("scene_label") or (f"{scene_key:02d}" if isinstance(scene_key, int) else tag)

            node_data = {
                "label": f"白模分镜板 · {tag}",
                "type": "asset",
                "assetType": "storyboard_sheet",
                # API 用 shot_id 反推 scene 前缀（^(S\d+)）—— 必须是真实 shot_id
                "shot_id": first_shot,
                "scene_key": scene_key,
                "scene_label": scene_label,
                "page": m.get("page", 1),
                "panel_count": m.get("panel_count", len(shot_ids)),
                "shot_ids": shot_ids,
                "source_hash": m.get("source_hash"),
                "filePath": oss_path,
                "thumbnailUrl": oss_path,
                "imageUrl": oss_path,
                "src": oss_path,
                "sheetWidth": w, "sheetHeight": h,
                "ratio": "9:16",
                "layoutType": "clay_storyboard_grid",
                "turnaroundType": None,
                "curationState": "approved",
                "curation": "approved",
                "state": "success",
                "isPrimaryView": 1,
                "description": f"白模分镜板（clay-render maquette）{tag}，{m.get('panel_count', len(shot_ids))} 格",
                "model_version": m.get("model", "5.0Pro"),
                "generation_prompt": m.get("prompt", ""),
                "workflow_phase": "p09c_storyboard_board",
            }
            cur.execute(
                "INSERT INTO canvas_nodes (id, project_id, episodes_id, type, branch_id, phase_index, "
                "phase_name, position_x, position_y, size_width, size_height, data, state, review_status, "
                "is_winner, variant_of, variant_group_id, created_at, updated_at) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) "
                "ON CONFLICT(id, project_id, episodes_id) DO UPDATE SET "
                "data=excluded.data, type=excluded.type, phase_index=excluded.phase_index, "
                "phase_name=excluded.phase_name, review_status=excluded.review_status, updated_at=excluded.updated_at",
                (node_id, proj, eps, "asset", "main", 9, "p09c_storyboard_board",
                 0, 0, 260, 180, json.dumps(node_data, ensure_ascii=False),
                 "success", "approved", 0, None, None, now_ms, now_ms))
            stats["nodes"] += 1
            sheets_summary.append({
                "tag": tag, "scene_key": scene_key, "scene_label": scene_label,
                "page": m.get("page", 1), "panel_count": m.get("panel_count", len(shot_ids)),
                "shot_ids": shot_ids, "thumbnail": oss_path, "node_id": node_id,
            })
            print(f"  [node] {node_id}  {w}x{h}  panels={m.get('panel_count', len(shot_ids))}  {first_shot}")

        # ── 汇总成单条 o_assets（storyboard_board），meta 存全板概要 ───────────
        # 按 scene 分组（保序），供 storyboard API 快照 tier + AssetLibrary 消费
        scenes_map, order = {}, []
        for s in sheets_summary:
            k = s["scene_key"]
            if k not in scenes_map:
                scenes_map[k] = {"scene_key": k, "scene_label": s["scene_label"], "sheets": []}
                order.append(k)
            scenes_map[k]["sheets"].append({"tag": s["tag"], "page": s["page"],
                                            "panel_count": s["panel_count"], "shot_ids": s["shot_ids"],
                                            "thumbnail": s["thumbnail"]})
        board_meta = {
            "type": "storyboard_board",
            "episode_id": str(eps),
            "generated_at": None,
            "source": "p09c_storyboard_board",
            "degraded": False,
            "scenes": [scenes_map[k] for k in order],
            "stats": {"total_sheets": len(sheets_summary),
                      "ok_sheets": len(sheets_summary),
                      "total_scenes": len(scenes_map)},
        }
        meta_json = json.dumps(board_meta, ensure_ascii=False)
        name = f"白模分镜板 storyboard board"
        existing = cur.execute(
            "SELECT id FROM o_assets WHERE projectId=? AND episodesId=? AND type='storyboard_board'",
            (proj, eps)).fetchone()
        if existing:
            cur.execute(
                "UPDATE o_assets SET meta=?, state='active', model='dreamina-5.0Pro', "
                "workflow_phase='p09c_storyboard_board' WHERE id=?",
                (meta_json, existing["id"]))
            asset_id = existing["id"]
            mode = "update"
        else:
            max_asset = cur.execute("SELECT COALESCE(MAX(id),0) FROM o_assets").fetchone()[0]
            asset_id = max_asset + 1
            cur.execute(
                "INSERT INTO o_assets (id, name, prompt, type, projectId, imageId, characterId, "
                "isPrimaryView, model, state, meta, skill_id, workflow_phase, createdAt, createdBy, episodesId) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (asset_id, name, "", "storyboard_board", proj, None, None,
                 0, "dreamina-5.0Pro", "active", meta_json, "movie-v1",
                 "p09c_storyboard_board", now_ms, "register_storyboard_sheets.py", eps))
            mode = "insert"
        print(f"\n  [o_assets:{mode}] id={asset_id}  scenes={len(scenes_map)} sheets={len(sheets_summary)}")

        conn.commit()
    except Exception as e:
        conn.rollback()
        print(f"[ERROR] rolled back: {e}")
        raise

    cur.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    conn.close()

    print(f"\n=== summary ===")
    print(f"canvas_nodes (a-storyboard_sheet-*): {stats['nodes']}")
    print(f"o_assets (storyboard_board)         : 1")
    print(f"skipped                              : {stats['skipped']}")
    print(f"backup                               : {bak}")


if __name__ == "__main__":
    main()
