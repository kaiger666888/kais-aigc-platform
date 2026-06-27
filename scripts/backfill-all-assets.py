#!/usr/bin/env python3
"""
回填脚本 Phase 2：将画布上所有节点（不限 type=asset）的产出物注册为资产。

资产类型映射：
  script     → type = script_phase (选题/大纲/剧本/时空剧本/审计报告)
  asset      → type = character/scene/prop (已在 Phase 1 回填)
  storyboard → type = storyboard (场景图/分镜构图)
  video      → type = video (预览视频/合成视频/交付物)
  audio      → type = audio (语音/BGM/音效)
"""
import sqlite3, json, re, time, os

DB = "/home/kai/workspace/kais-aigc-platform/data/db2.sqlite"
conn = sqlite3.connect(DB)
conn.row_factory = sqlite3.Row
cur = conn.cursor()

# 已有的 max id
cur.execute("SELECT max(id) as m FROM o_assets")
max_id = cur.fetchone()["m"] or 0
cur.execute("SELECT max(id) as m FROM o_image")
max_img = cur.fetchone()["m"] or 0

# 节点类型 → 资产类型映射
TYPE_MAP = {
    "script": "script_phase",
    "storyboard": "storyboard",
    "video": "video",
    "audio": "audio",
}

# 已经有 assetId 的 asset 类型节点跳过（Phase 1 处理了）
cur.execute("SELECT id, projectId, episodesId, data FROM o_agentWorkData WHERE key = 'canvasGraph'")
rows = cur.fetchall()

created = 0
updated_graphs = 0

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
        ntype = node.get("type", "")
        d = node.get("data", {})

        # asset 类型已在 Phase 1 处理
        if ntype == "asset":
            continue

        # 只处理有产出物的节点（有 filePath 或 imageUrl）
        file_path = d.get("filePath") or d.get("imageUrl") or ""
        if not file_path or "pipeline-runs" not in str(file_path):
            continue

        # 已经有 assetId 的跳过
        if d.get("assetId"):
            continue

        asset_type = TYPE_MAP.get(ntype, "other")
        label = re.sub(r'[^\w\u4e00-\u9fff\s\-:.]', '', str(d.get("label", "未命名"))).strip() or "未命名"
        phase = d.get("phase") or d.get("tags") or ""

        max_id += 1
        aid = max_id
        now = int(time.time() * 1000)
        uid = f"ast-{now:x}-{aid}"

        # 判断是否为媒体文件
        ext = os.path.splitext(file_path)[1].lower()
        is_image = ext in ('.png', '.jpg', '.jpeg', '.webp', '.gif')
        is_video = ext in ('.mp4', '.webm', '.mov', '.avi')
        is_audio = ext in ('.mp3', '.wav', '.ogg', '.flac', '.m4a')

        img_id = None
        if is_image:
            max_img += 1
            img_id = max_img
            # 提取相对路径用于 oss 服务
            rel_path = file_path.replace("/home/kai/workspace/kais-movie-agent/", "")
            cur.execute("INSERT INTO o_image (id, filePath, type, state) VALUES (?,?,?,?)",
                        (img_id, rel_path, asset_type, "已完成"))

        # 构建描述
        desc = str(d.get("description", ""))[:200] or label

        # 构建元数据
        meta = {}
        if phase:
            meta["phase"] = phase
        for k in ["score", "reviewStatus", "state", "tags", "duration"]:
            v = d.get(k)
            if v is not None:
                meta[k] = v

        cur.execute("""INSERT INTO o_assets
            (id, uuid, name, type, prompt, describe, projectId, imageId,
             state, meta, createdAt, createdBy, tags)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (aid, uid, label, asset_type, "", desc, row["projectId"], img_id,
             "active", json.dumps(meta, ensure_ascii=False) if meta else None,
             now, "backfill", str(phase) if phase else None))

        d["assetId"] = aid
        d["uuid"] = uid
        node["data"] = d
        changed = True
        created += 1
        print(f"  + {asset_type:14s} {aid}: {label[:40]} ({os.path.basename(file_path)[:30]})")

    if changed:
        cur.execute("UPDATE o_agentWorkData SET data = ? WHERE id = ?",
                    (json.dumps(graph, ensure_ascii=False), row["id"]))
        updated_graphs += 1

conn.commit()
conn.close()
print(f"\nDone: {created} assets created, {updated_graphs} graphs updated")
