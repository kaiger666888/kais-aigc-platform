#!/usr/bin/env python3
"""
register_turnaround_costume.py — 把 13 张服化道 Turnaround 注册/晋升为画布「选定」资产。

策略（与"覆盖同名旧文件"语义一致）：
  - 同名旧 o_assets 行（674-684，state=eliminated）→ UPDATE in place：isPrimaryView=1,
    state=active，刷新 prompt/model/meta；其关联 o_image 刷新 filePath/model/state。
    复用 id，避免重名污染。
  - 全新服装（shenmiren/shenmu 正装，旧为"场景换装"已淘汰）→ INSERT 新 o_image+o_assets（仿 b2）。
  - canvas_nodes id=a-turnaround-{cid}-{costume} → UPSERT，curationState=approved。

幂等：按 (name, projectId) 判定存在即 UPDATE，再跑也不重复插入。

输入：manifest_costume.json（gen_costume_tr.py 产出），只注册 status=ok 且 PNG>20KB 的项。
"""
import json, os, sqlite3, sys, time
from PIL import Image

DB = "/data/workspace/kais-aigc-platform/data/db2.sqlite"
PROJ_ID = 1785508691757
EPS_ID = 1
OSS_DIR = f"/oss/{PROJ_ID}/p04/turnaround_sheets"
FS_DIR = f"/data/workspace/kais-aigc-platform/data/oss/{PROJ_ID}/p04/turnaround_sheets"
MANIFEST = f"{FS_DIR}/manifest_costume.json"

CID_NAME = {
    "shenzhiyi": "沈知意", "luyanzhou": "陆衍舟", "shenzhiyao": "沈知瑶",
    "chengyu": "程屿", "shenzhengbang": "沈正邦", "guhongyuan": "顾鸿远",
    "wangjianmin": "王建民", "zhoulin": "周琳", "shenmiren": "神秘人", "shenmu": "沈母",
}

# key -> (cid, costume_cn, costume_en)  —— 与 gen_costume_tr.py 一致
TASKS = [
    ("shenzhiyi_banquet",     "shenzhiyi",     "宴会",  "silver-white mermaid gown, silver high heels, pearl earrings"),
    ("shenzhiyi_daily",       "shenzhiyi",     "日常",  "simple white blouse with black wide-leg trousers, light natural makeup"),
    ("luyanzhou_formal",      "luyanzhou",     "正装",  "dark navy custom three-piece suit, white dress shirt, dark patterned tie"),
    ("shenzhiyao_casual",     "shenzhiyao",    "休闲",  "light pink lace dress, nude 10cm stiletto heels"),
    ("shenzhengbang_formal",  "shenzhengbang", "正装",  "dark navy Zhongshan suit (Mao suit)"),
    ("chengyu_work",          "chengyu",       "职场",  "dark cotton shirt with khaki trousers"),
    ("chengyu_home_a",        "chengyu",       "居家A", "simple gray cotton loungewear"),
    ("chengyu_home_b",        "chengyu",       "居家B", "white T-shirt with dark blue sweatpants"),
    ("guhongyuan_formal",     "guhongyuan",    "正装",  "black custom suit, silver-gray tie"),
    ("wangjianmin_formal",    "wangjianmin",   "正装",  "dark gray business suit, white shirt"),
    ("zhoulin_formal",        "zhoulin",       "正装",  "dark blue professional suit dress"),
    ("shenmiren_formal",      "shenmiren",     "正装",  "black turtleneck sweater, black long trench coat, black leather gloves"),
    ("shenmu_formal",         "shenmu",        "正装",  "elegant dark gray qipao (cheongsam), pearl earrings, jade bracelet"),
]
# 选定的 b2 灰底参考文件（同 gen 脚本）
REF_FILE = {
    "shenzhiyi":     "base_turnaround_shenzhiyi_b2_3.png",
    "luyanzhou":     "base_turnaround_luyanzhou_b2_3.png",
    "shenzhiyao":    "base_turnaround_shenzhiyao_b2_3.png",
    "chengyu":       "base_turnaround_chengyu_b2_1.png",
    "shenzhengbang": "base_turnaround_shenzhengbang_b2_2.png",
    "guhongyuan":    "base_turnaround_guhongyuan_b2_3.png",
    "wangjianmin":   "base_turnaround_wangjianmin_b2_2.png",
    "zhoulin":       "base_turnaround_zhoulin_b2_3.png",
    "shenmiren":     "base_turnaround_shenmiren_b2_1.png",
    "shenmu":        "base_turnaround_shenmu_b2_1.png",
}


def main():
    if not os.path.exists(MANIFEST):
        print(f"[ERROR] manifest not found: {MANIFEST}（先跑 gen_costume_tr.py）")
        sys.exit(1)
    manifest = {m["key"]: m for m in json.load(open(MANIFEST, encoding="utf-8"))
                if m.get("status") == "ok"}

    ts = int(time.time())
    bak = f"{DB}.bak.{ts}"
    os.system(f"cp {DB} {bak}")
    print(f"[backup] {bak}")

    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    max_asset = cur.execute("SELECT COALESCE(MAX(id),0) FROM o_assets").fetchone()[0]
    max_img = cur.execute("SELECT COALESCE(MAX(id),0) FROM o_image").fetchone()[0]
    now_ms = int(time.time() * 1000)

    stats = {"updated": 0, "inserted": 0, "nodes": 0, "skipped": 0}

    conn.execute("BEGIN")
    try:
        for key, cid, costume_cn, costume_en in TASKS:
            m = manifest.get(key)
            fname = f"turnaround_{key}.png"
            fs_path = os.path.join(FS_DIR, fname)
            if not m or not os.path.exists(fs_path) or os.path.getsize(fs_path) < 20480:
                print(f"  [skip] {key}  (manifest_ok={bool(m)}, file={'ok' if os.path.exists(fs_path) else 'MISSING'})")
                stats["skipped"] += 1
                continue

            with Image.open(fs_path) as im:
                w, h = im.size
            zh = CID_NAME[cid]
            name = f"{zh} {costume_cn}换装Turnaround"
            prompt = m.get("prompt", "")
            oss_path = f"{OSS_DIR}/{fname}?v={now_ms}"
            node_id = f"a-turnaround-{cid}-{key.replace(cid + '_', '')}"
            meta = {
                "subtype": "costume_turnaround",
                "characterId": cid,
                "costume_type": key.replace(cid + '_', ''),
                "costume_label": costume_cn,
                "costumeDesc": costume_en,
                "generation_prompt": prompt,
                "model_version": "5.0Pro",
                "base_ref": REF_FILE[cid],
                "isPrimaryView": 1,
            }

            # ---- 查同名行 ----
            row = cur.execute(
                "SELECT id, imageId FROM o_assets WHERE projectId=? AND characterId=? AND name=?",
                (PROJ_ID, cid, name)).fetchone()

            if row:
                # UPDATE in place
                asset_id = row["id"]
                img_id = row["imageId"]
                if img_id:
                    cur.execute(
                        "UPDATE o_image SET filePath=?, type='character', model='dreamina-5.0Pro', "
                        "resolution='2k', state='success' WHERE id=?",
                        (oss_path, img_id))
                else:
                    max_img += 1; img_id = max_img
                    cur.execute(
                        "INSERT INTO o_image (id, filePath, type, assetsId, model, resolution, state) "
                        "VALUES (?,?,?,?,?,?,?)",
                        (img_id, oss_path, "character", asset_id, "dreamina-5.0Pro", "2k", "success"))
                # o_assets 无 updatedAt 列，刷新内容字段即可
                cur.execute(
                    "UPDATE o_assets SET prompt=?, model='dreamina-5.0Pro', isPrimaryView=1, state='active', "
                    "imageId=?, meta=?, workflow_phase='p04_turnaround' WHERE id=?",
                    (prompt, img_id, json.dumps(meta, ensure_ascii=False), asset_id))
                stats["updated"] += 1
                mode = "update"
            else:
                # INSERT new
                max_img += 1; img_id = max_img
                max_asset += 1; asset_id = max_asset
                cur.execute(
                    "INSERT INTO o_image (id, filePath, type, assetsId, model, resolution, state) "
                    "VALUES (?,?,?,?,?,?,?)",
                    (img_id, oss_path, "character", asset_id, "dreamina-5.0Pro", "2k", "success"))
                cur.execute(
                    "INSERT INTO o_assets (id, name, prompt, type, projectId, imageId, characterId, "
                    "isPrimaryView, model, state, meta, skill_id, workflow_phase, createdAt, createdBy, episodesId) "
                    "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (asset_id, name, prompt, "character", PROJ_ID, img_id, cid,
                     1, "dreamina-5.0Pro", "active", json.dumps(meta, ensure_ascii=False),
                     "movie-v1", "p04_turnaround", now_ms, "register_turnaround_costume.py", EPS_ID))
                stats["inserted"] += 1
                mode = "insert"

            # ---- canvas_nodes upsert ----
            node_data = {
                "label": f"{zh} · {costume_cn}换装Turnaround",
                "type": "asset",
                "assetType": "character",
                "characterId": cid,
                "name": name,
                "isTurnaroundSheet": True,
                "turnaroundSheet": f"assets/P04/{fname}",
                "filePath": oss_path,
                "thumbnailUrl": oss_path,
                "imageUrl": oss_path,
                "image": oss_path,
                "src": oss_path,
                "sheetWidth": w, "sheetHeight": h,
                "columns": 2,
                "viewLayout": ["front", "three_quarter", "side", "back"],
                "layoutType": "grid_2x2",
                "turnaroundType": "costume",
                "costumeLabel": costume_cn,
                "costumeSet": costume_cn,
                "costumeDesc": costume_en,
                "costume_type": key.replace(cid + '_', ''),
                "isPrimaryView": 1,
                "state": "success",
                "curationState": "approved",
                "curation": "approved",
                "description": f"{zh} {costume_cn}换装 Turnaround（5.0Pro i2i，灰底b2参考）",
                "generation_prompt": prompt,
                "model_version": "5.0Pro",
                "base_ref": REF_FILE[cid],
            }
            cur.execute(
                "INSERT INTO canvas_nodes (id, project_id, episodes_id, type, branch_id, phase_index, "
                "phase_name, position_x, position_y, size_width, size_height, data, state, review_status, "
                "is_winner, variant_of, variant_group_id, created_at, updated_at) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) "
                "ON CONFLICT(id, project_id, episodes_id) DO UPDATE SET "
                "data=excluded.data, type=excluded.type, phase_index=excluded.phase_index, "
                "phase_name=excluded.phase_name, review_status=excluded.review_status, updated_at=excluded.updated_at",
                (node_id, PROJ_ID, EPS_ID, "asset", "main", 4, "p04_character_design",
                 0, 0, 260, 180, json.dumps(node_data, ensure_ascii=False),
                 "success", "approved", 0, None, None, now_ms, now_ms))
            stats["nodes"] += 1
            print(f"  [{mode}] {name}  asset={asset_id} img={img_id} node={node_id}  {w}x{h}")

        conn.commit()
    except Exception as e:
        conn.rollback()
        print(f"[ERROR] rolled back: {e}")
        raise

    cur.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    conn.close()

    print(f"\n=== summary ===")
    print(f"assets updated  : {stats['updated']}")
    print(f"assets inserted : {stats['inserted']}")
    print(f"canvas_nodes    : {stats['nodes']}")
    print(f"skipped         : {stats['skipped']}")
    print(f"backup          : {bak}")


if __name__ == "__main__":
    main()
