#!/usr/bin/env python3
"""
回填脚本：扫描画布 JSON 里的 asset 节点，为缺 assetId 的创建 o_assets 记录。
"""
import sqlite3, json, re, time

DB = "/home/kai/workspace/kais-aigc-platform/data/db2.sqlite"
conn = sqlite3.connect(DB)
conn.row_factory = sqlite3.Row
cur = conn.cursor()

cur.execute("SELECT max(id) as m FROM o_assets")
max_id = cur.fetchone()["m"] or 0

cur.execute("SELECT max(id) as m FROM o_image")
max_img = cur.fetchone()["m"] or 0

cur.execute("SELECT id, projectId, episodesId, data FROM o_agentWorkData WHERE key = 'canvasGraph'")
rows = cur.fetchall()

created = 0
updated = 0

for row in rows:
    raw = row["data"]
    if not raw:
        continue
    try:
        graph = json.loads(raw)
    except:
        continue

    nodes = graph.get("nodes", [])
    changed = False

    for node in nodes:
        if node.get("type") != "asset":
            continue
        d = node.get("data", {})
        if d.get("assetId"):
            continue

        label = d.get("label", "未命名资产")
        clean = re.sub(r'[^\w\u4e00-\u9fff\s\-]', '', str(label)).strip() or "未命名"
        raw_type = str(d.get("assetType") or d.get("type") or "")
        if any(k in raw_type for k in ["character", "role", "角色"]):
            atype = "character"
        elif any(k in raw_type for k in ["scene", "场景"]):
            atype = "scene"
        elif any(k in raw_type for k in ["prop", "tool", "道具"]):
            atype = "prop"
        else:
            atype = "character"

        prompt = d.get("prompt", "")
        fp = d.get("filePath", "")
        if fp and fp.startswith("/oss/"):
            fp = fp[5:]

        max_id += 1
        aid = max_id
        now = int(time.time() * 1000)
        uid = f"ast-{now:x}-{aid}"

        img_id = None
        if fp:
            max_img += 1
            img_id = max_img
            cur.execute("INSERT INTO o_image (id, filePath, type, state) VALUES (?,?,?,?)",
                        (img_id, fp, atype, "已完成"))

        cur.execute("""INSERT INTO o_assets
            (id, uuid, name, type, prompt, describe, projectId, imageId,
             characterId, viewAngle, isPrimaryView, state, createdAt, createdBy)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (aid, uid, clean, atype, prompt, clean, row["projectId"], img_id,
             clean if atype == "character" else None,
             "front" if atype == "character" else None,
             0, "active", now, "backfill"))

        if row["episodesId"]:
            try:
                cur.execute("INSERT OR IGNORE INTO o_scriptAssets (scriptId, assetId) VALUES (?,?)",
                            (row["episodesId"], aid))
            except:
                pass

        d["assetId"] = aid
        d["uuid"] = uid
        if "assetType" not in d:
            d["assetType"] = atype
        node["data"] = d
        changed = True
        created += 1
        print(f"  + asset {aid}: {clean} ({atype}) proj={row['projectId']}")

    if changed:
        cur.execute("UPDATE o_agentWorkData SET data = ? WHERE id = ?",
                    (json.dumps(graph, ensure_ascii=False), row["id"]))
        updated += 1

conn.commit()
conn.close()
print(f"\nDone: {created} assets created, {updated} graphs updated")
