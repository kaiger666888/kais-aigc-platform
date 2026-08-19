#!/usr/bin/env python3
# [DEPRECATED — Phase 50, 2026-08-19]
# Manual historical registration tool — kept as historical evidence per
# decision D-12 (never deleted). Do NOT use for new registrations; do NOT
# cron. New assets flow through the Phase 48 candidate-aware ingest route
# POST /api/v1/pipeline/ingest/images (src/routes/v1/pipeline/ingest/images.ts),
# which lands candidate groups (member assetsId -> primary, exactly-one
# isPrimaryView) + workflow_phase automatically.
"""
register_turnaround_b2.py — 把 batch2 的 24 张灰底 turnaround 注册到画布「待选」。

三层写入（仿现有选定 turnaround 结构）：
  1. o_image   — 缩略图文件指针（缩略图显示依赖此层 + o_assets.imageId 双向链接）
  2. o_assets  — type=character, isPrimaryView=0(待选), state=active, characterId, prompt, meta
  3. canvas_nodes — type=asset, phase_index=4(p04), curationState=candidate, episodes_id=1

待选语义（AssetLibrary 三态模型）：
  待选 = isPrimaryView=false(0) && state='active'  → 显示在资产库「待选」tab，按 char:{cid} 分组。

幂等：按 name 跳过已注册条目。只处理磁盘上真实存在且 >20KB 的 PNG。
"""
import json, os, sqlite3, sys, time
from PIL import Image

DB = "/data/workspace/kais-aigc-platform/data/db2.sqlite"
PROJ_ID = 1785508691757
EPS_ID = 1
OSS_BASE = f"/oss/{PROJ_ID}/p04/turnaround_sheets/batch2"
FS_BASE = f"/data/workspace/kais-aigc-platform/data/oss/{PROJ_ID}/p04/turnaround_sheets/batch2"
PROMPT_SRC = f"/data/workspace/kais-aigc-platform/data/oss/{PROJ_ID}/p04/turnaround_sheets/batch_portrait_2x2.json"

# cid -> 中文名
CID_NAME = {
    "shenzhiyi": "沈知意", "luyanzhou": "陆衍舟", "shenzhiyao": "沈知瑶",
    "chengyu": "程屿", "shenzhengbang": "沈正邦", "guhongyuan": "顾鸿远",
    "wangjianmin": "王建民", "zhoulin": "周琳",
}

def main():
    # ---- load prompts (cid -> prompt) ----
    src = json.load(open(PROMPT_SRC, encoding="utf-8"))
    prompt_by_cid = {e["id"].replace("turnaround_", ""): e["prompt"] for e in src}

    # ---- backup ----
    ts = int(time.time())
    bak = f"{DB}.bak.{ts}"
    os.system(f"cp {DB} {bak}")
    print(f"[backup] {bak}")

    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    # idempotency: existing batch2 asset names
    existing = {r[0] for r in cur.execute(
        "SELECT name FROM o_assets WHERE projectId=? AND name LIKE '%灰底Turnaround b2-%'", (PROJ_ID,))}

    # next ids
    max_asset = cur.execute("SELECT COALESCE(MAX(id),0) FROM o_assets").fetchone()[0]
    max_img = cur.execute("SELECT COALESCE(MAX(id),0) FROM o_image").fetchone()[0]
    now_ms = int(time.time() * 1000)

    inserted_assets, inserted_imgs, inserted_nodes, skipped = 0, 0, 0, 0

    conn.execute("BEGIN")
    try:
        for cid, zh in CID_NAME.items():
            prompt = prompt_by_cid.get(cid, "")
            for n in (1, 2, 3):
                fname = f"base_turnaround_{cid}_b2_{n}.png"
                fs_path = os.path.join(FS_BASE, fname)
                if not os.path.exists(fs_path) or os.path.getsize(fs_path) < 20480:
                    print(f"  [skip-missing] {fname}")
                    continue
                name = f"{zh} 灰底Turnaround b2-{n}"
                if name in existing:
                    print(f"  [skip-exists] {name}")
                    skipped += 1
                    continue

                # image dimensions
                try:
                    with Image.open(fs_path) as im:
                        w, h = im.size
                except Exception as e:
                    print(f"  [skip-pilerr] {fname}: {e}")
                    continue

                oss_path = f"{OSS_BASE}/{fname}?v={now_ms}"
                max_img += 1; img_id = max_img
                max_asset += 1; asset_id = max_asset
                node_id = f"a-turnaround-{cid}-b2-{n}"
                meta = {
                    "subtype": "turnaround_sheet",
                    "characterId": cid,
                    "generation_prompt": prompt,
                    "model_version": "5.0Pro",
                    "batch": "b2",
                    "batch_idx": n,
                }

                # 1) o_image
                cur.execute(
                    "INSERT INTO o_image (id, filePath, type, assetsId, model, resolution, state) "
                    "VALUES (?,?,?,?,?,?,?)",
                    (img_id, oss_path, "character", asset_id, "dreamina-5.0Pro", "2k", "success"))
                inserted_imgs += 1

                # 2) o_assets (isPrimaryView=0 待选, state=active)
                cur.execute(
                    "INSERT INTO o_assets (id, name, prompt, type, projectId, imageId, characterId, "
                    "isPrimaryView, model, state, meta, skill_id, workflow_phase, createdAt, createdBy, episodesId) "
                    "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (asset_id, name, prompt, "character", PROJ_ID, img_id, cid,
                     0, "dreamina-5.0Pro", "active", json.dumps(meta, ensure_ascii=False),
                     "movie-v1", "p04_turnaround", now_ms, "register_turnaround_b2.py", EPS_ID))
                inserted_assets += 1

                # 3) canvas_nodes (待选候选节点，仿 winner 结构 + curationState=candidate)
                node_data = {
                    "label": f"{zh} · 灰底Turnaround b2-{n}",
                    "type": "asset",
                    "assetType": "character",
                    "characterId": cid,
                    "name": f"{zh} 灰底Turnaround b2-{n}",
                    "isTurnaroundSheet": True,
                    "turnaroundSheet": f"assets/P04/batch2/{fname}",
                    "filePath": oss_path,
                    "thumbnailUrl": oss_path,
                    "imageUrl": oss_path,
                    "image": oss_path,
                    "src": oss_path,
                    "sheetWidth": w, "sheetHeight": h,
                    "columns": 2,
                    "viewLayout": ["front", "three_quarter", "side", "back"],
                    "layoutType": "grid_2x2",
                    "turnaroundType": "gray_base",
                    "state": "success",
                    "curationState": "candidate",
                    "curation": "candidate",
                    "description": f"{zh} 灰底紧身衣 Turnaround（待选 b2-{n}）",
                    "generation_prompt": prompt,
                    "model_version": "5.0Pro",
                    "batch": "b2",
                }
                cur.execute(
                    "INSERT INTO canvas_nodes (id, project_id, episodes_id, type, branch_id, phase_index, "
                    "phase_name, position_x, position_y, size_width, size_height, data, state, review_status, "
                    "is_winner, variant_of, variant_group_id, created_at, updated_at) "
                    "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) "
                    "ON CONFLICT(id, project_id, episodes_id) DO UPDATE SET "
                    "data=excluded.data, type=excluded.type, phase_index=excluded.phase_index, "
                    "phase_name=excluded.phase_name, updated_at=excluded.updated_at",
                    (node_id, PROJ_ID, EPS_ID, "asset", "main", 4, "p04_character_design",
                     0, 0, 260, 180, json.dumps(node_data, ensure_ascii=False),
                     "success", None, 0, None, None, now_ms, now_ms))
                inserted_nodes += 1
                print(f"  [ok] {name}  asset={asset_id} img={img_id} node={node_id}  {w}x{h}")

        conn.commit()
    except Exception as e:
        conn.rollback()
        print(f"[ERROR] rolled back: {e}")
        sys.exit(1)

    # checkpoint to flush WAL
    cur.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    conn.close()

    print(f"\n=== summary ===")
    print(f"o_assets inserted : {inserted_assets}")
    print(f"o_image  inserted : {inserted_imgs}")
    print(f"canvas_nodes       : {inserted_nodes}")
    print(f"skipped (exists)   : {skipped}")
    print(f"backup             : {bak}")

if __name__ == "__main__":
    main()
