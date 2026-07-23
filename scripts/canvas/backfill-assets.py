#!/usr/bin/env python3
"""
统一回填脚本：扫描画布 JSON（o_agentWorkData key='canvasGraph'），为缺 assetId
的节点创建 o_assets / o_image 记录并回写图。合并原 Phase 1（backfill-assets.py，
asset 节点模式）与 Phase 2（backfill-all-assets.py，四类型扩展模式）。

模式说明：
  asset      → asset 节点模式（原 Phase 1）：类型推断 character/scene/prop，
               关联 o_scriptAssets，写 characterId/viewAngle/isPrimaryView 列。
  script     → type = script_phase (选题/大纲/剧本/时空剧本/审计报告)
  storyboard → type = storyboard (场景图/分镜构图)
  video      → type = video (预览视频/合成视频/交付物)
  audio      → type = audio (语音/BGM/音效)
  all        → asset 模式 + 四种扩展模式（默认）

USAGE:
  python3 scripts/backfill-assets.py                          # dry-run（默认，不写库）
  python3 scripts/backfill-assets.py --apply                  # 单事务写库
  python3 scripts/backfill-assets.py --types asset --apply    # 只跑 asset 模式
  python3 scripts/backfill-assets.py --types storyboard,video --apply
  python3 scripts/backfill-assets.py --db /path/to/db2.sqlite --path-filter pipeline-runs

工程化说明（相对原脚本的改动，--apply 后逐字段语义与原两脚本等价；
ID 分配按图内节点顺序交错进行，与原两脚本顺序执行的全局分配顺序不同，
但均满足 max(id)+1 唯一约束，无功能影响）：
  - 默认 dry-run；--apply 才写库。
  - 单事务 BEGIN…COMMIT，异常 ROLLBACK 并以非零码退出。
  - 消灭裸 except：JSON 解析失败计入 skipped_bad_json 并继续。
  - ID 分配保持 max(id)+1（事务内，脚本单并发）。
  - 扩展模式对不在 TYPE_MAP 中的节点类型保留原 Phase 2 的 "other" 兜底
    （只要启用了任一扩展类型即生效，与原 Phase 2 全量行为一致）。
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sqlite3
import sys
import time

# 引入共享配置（scripts/lib/canvas_config.py）
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib"))
from canvas_config import config_from_env  # noqa: E402

# 节点类型 → 资产类型映射（扩展模式，原 Phase 2）
TYPE_MAP = {
    "script": "script_phase",
    "storyboard": "storyboard",
    "video": "video",
    "audio": "audio",
}
EXT_TYPES = tuple(TYPE_MAP.keys())  # 可选的扩展类型

# 原 Phase 2 中用于提取 o_image 相对路径的本地前缀（模式常量）
MOVIE_AGENT_PREFIX = "/home/kai/workspace/kais-movie-agent/"

# 媒体扩展名（原 Phase 2）：仅图片入 o_image
IMAGE_EXTS = (".png", ".jpg", ".jpeg", ".webp", ".gif")
VIDEO_EXTS = (".mp4", ".webm", ".mov", ".avi")
AUDIO_EXTS = (".mp3", ".wav", ".ogg", ".flac", ".m4a")

# asset 模式：label 清洗正则（原 Phase 1）
LABEL_RE_ASSET = re.compile(r"[^\w一-鿿\s\-]")
# 扩展模式：label 清洗正则（原 Phase 2，额外保留 : 和 .）
LABEL_RE_EXT = re.compile(r"[^\w一-鿿\s\-:.]")


def infer_asset_type(raw_type: str) -> str:
    """asset 模式类型推断（原 Phase 1 关键词逻辑，默认 character）。"""
    if any(k in raw_type for k in ["character", "role", "角色"]):
        return "character"
    if any(k in raw_type for k in ["scene", "场景"]):
        return "scene"
    if any(k in raw_type for k in ["prop", "tool", "道具"]):
        return "prop"
    return "character"


class Backfiller:
    """单事务回填器。apply=False 时不执行任何写 SQL，仅统计。"""

    def __init__(self, cur: sqlite3.Cursor, apply: bool, path_filter: str) -> None:
        self.cur = cur
        self.apply = apply
        self.path_filter = path_filter
        # ID 分配：max(id)+1，事务内自增（脚本单并发）
        self.cur.execute("SELECT max(id) as m FROM o_assets")
        self.max_id = self.cur.fetchone()["m"] or 0
        self.cur.execute("SELECT max(id) as m FROM o_image")
        self.max_img = self.cur.fetchone()["m"] or 0
        # 统计
        self.created = 0               # 新建（或 would create）的 o_assets 数
        self.created_images = 0
        self.updated_graphs = 0        # 回写（或 would update）的画布图数
        self.action_counts: dict[str, int] = {}  # 按资产类型分解

    def _next_ids(self) -> tuple[int, int, str]:
        """分配下一个 asset id 与 uuid。"""
        self.max_id += 1
        aid = self.max_id
        now = int(time.time() * 1000)
        return aid, now, f"ast-{now:x}-{aid}"

    def _insert_image(self, file_path: str, asset_type: str) -> int:
        """插入 o_image 并返回 img_id。"""
        self.max_img += 1
        img_id = self.max_img
        if self.apply:
            self.cur.execute(
                "INSERT INTO o_image (id, filePath, type, state) VALUES (?,?,?,?)",
                (img_id, file_path, asset_type, "已完成"),
            )
        self.created_images += 1
        return img_id

    def _record(self, asset_type: str) -> None:
        self.created += 1
        self.action_counts[asset_type] = self.action_counts.get(asset_type, 0) + 1

    # ---- asset 模式（原 Phase 1，backfill-assets.py） ----
    def process_asset_node(self, node: dict, row: sqlite3.Row) -> bool:
        d = node.get("data", {})
        if d.get("assetId"):
            return False

        label = d.get("label", "未命名资产")
        clean = LABEL_RE_ASSET.sub("", str(label)).strip() or "未命名"
        raw_type = str(d.get("assetType") or d.get("type") or "")
        atype = infer_asset_type(raw_type)

        prompt = d.get("prompt", "")
        fp = d.get("filePath", "")
        if fp and fp.startswith("/oss/"):
            fp = fp[5:]  # 剥离 /oss/ 前缀

        aid, now, uid = self._next_ids()

        img_id = None
        if fp:
            img_id = self._insert_image(fp, atype)

        if self.apply:
            self.cur.execute(
                """INSERT INTO o_assets
                (id, uuid, name, type, prompt, describe, projectId, imageId,
                 characterId, viewAngle, isPrimaryView, state, createdAt, createdBy)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (aid, uid, clean, atype, prompt, clean, row["projectId"], img_id,
                 clean if atype == "character" else None,
                 "front" if atype == "character" else None,
                 0, "active", now, "backfill"),
            )

            if row["episodesId"]:
                try:
                    self.cur.execute(
                        "INSERT OR IGNORE INTO o_scriptAssets (scriptId, assetId) VALUES (?,?)",
                        (row["episodesId"], aid),
                    )
                except sqlite3.Error:
                    # 原脚本此处吞掉异常（关联表可能缺约束/缺行），保留语义但不再裸 except
                    pass

        d["assetId"] = aid
        d["uuid"] = uid
        if "assetType" not in d:
            d["assetType"] = atype
        node["data"] = d
        self._record(atype)
        print(f"  + asset {aid}: {clean} ({atype}) proj={row['projectId']}")
        return True

    # ---- 扩展模式（原 Phase 2，backfill-all-assets.py） ----
    def process_ext_node(self, node: dict, row: sqlite3.Row, enabled: set[str]) -> bool:
        ntype = node.get("type", "")
        d = node.get("data", {})

        # asset 类型已由 asset 模式处理
        if ntype == "asset":
            return False

        # 未映射的节点类型：原 Phase 2 以 "other" 兜底；只要启用了任一扩展类型即保留该行为
        if ntype in TYPE_MAP and ntype not in enabled:
            return False
        if ntype not in TYPE_MAP and not enabled:
            return False

        # 只处理有产出物（filePath/imageUrl 含 path-filter）的节点
        file_path = d.get("filePath") or d.get("imageUrl") or ""
        if not file_path or self.path_filter not in str(file_path):
            return False

        # 已有 assetId 的跳过
        if d.get("assetId"):
            return False

        asset_type = TYPE_MAP.get(ntype, "other")
        label = LABEL_RE_EXT.sub("", str(d.get("label", "未命名"))).strip() or "未命名"
        phase = d.get("phase") or d.get("tags") or ""

        aid, now, uid = self._next_ids()

        # 判断是否为媒体文件（仅图片入 o_image）
        ext = os.path.splitext(file_path)[1].lower()
        is_image = ext in IMAGE_EXTS

        img_id = None
        if is_image:
            # 提取相对路径用于 oss 服务（剥离 movie-agent 本地前缀）
            rel_path = file_path.replace(MOVIE_AGENT_PREFIX, "")
            img_id = self._insert_image(rel_path, asset_type)

        # 构建描述（截断 200）
        desc = str(d.get("description", ""))[:200] or label

        # 构建元数据
        meta: dict = {}
        if phase:
            meta["phase"] = phase
        for k in ["score", "reviewStatus", "state", "tags", "duration"]:
            v = d.get(k)
            if v is not None:
                meta[k] = v

        if self.apply:
            self.cur.execute(
                """INSERT INTO o_assets
                (id, uuid, name, type, prompt, describe, projectId, imageId,
                 state, meta, createdAt, createdBy, tags)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (aid, uid, label, asset_type, "", desc, row["projectId"], img_id,
                 "active", json.dumps(meta, ensure_ascii=False) if meta else None,
                 now, "backfill", str(phase) if phase else None),
            )

        d["assetId"] = aid
        d["uuid"] = uid
        node["data"] = d
        self._record(asset_type)
        print(f"  + {asset_type:14s} {aid}: {label[:40]} ({os.path.basename(file_path)[:30]})")
        return True

    def process_graph(self, row: sqlite3.Row, do_asset: bool, ext_enabled: set[str]) -> str:
        """处理单个画布图。返回 'ok' / 'empty' / 'bad_json'。"""
        raw = row["data"]
        if not raw:
            return "empty"
        try:
            graph = json.loads(raw)
        except (json.JSONDecodeError, UnicodeDecodeError, TypeError):
            # 向原裸 except 的「跳过该行」语义对齐：非法 JSON、非法 UTF-8（BLOB）、
            # 非 str/bytes 类型均计入 skipped_bad_json 并继续；
            # 但仍拒绝吞掉 sqlite3.Error 等其他异常（交由外层回滚）。
            return "bad_json"

        nodes = graph.get("nodes", [])
        changed = False
        for node in nodes:
            ntype = node.get("type", "")
            if do_asset and ntype == "asset":
                changed = self.process_asset_node(node, row) or changed
            elif ext_enabled and ntype != "asset":
                changed = self.process_ext_node(node, row, ext_enabled) or changed

        if changed:
            if self.apply:
                self.cur.execute(
                    "UPDATE o_agentWorkData SET data = ? WHERE id = ?",
                    (json.dumps(graph, ensure_ascii=False), row["id"]),
                )
            self.updated_graphs += 1
        return "ok"


def parse_types(spec: str) -> tuple[bool, set[str]]:
    """解析 --types：返回 (是否启用 asset 模式, 启用的扩展类型集合)。"""
    spec = spec.strip().lower()
    if spec == "all":
        return True, set(EXT_TYPES)
    do_asset = False
    ext: set[str] = set()
    for part in spec.split(","):
        part = part.strip()
        if not part:
            continue
        if part == "asset":
            do_asset = True
        elif part in TYPE_MAP:
            ext.add(part)
        else:
            raise ValueError(
                f"未知类型: {part!r}（可选: asset, {', '.join(EXT_TYPES)}, all）"
            )
    if not do_asset and not ext:
        raise ValueError("--types 至少需要一个有效类型")
    return do_asset, ext


def main() -> int:
    cfg = config_from_env()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", default=cfg.db_path,
                        help="SQLite DB 路径（默认取 canvas_config：env DB_PATH / KAIS_PLATFORM_ROOT / 线上默认）")
    parser.add_argument("--types", default="all",
                        help="回填类型：asset | script,storyboard,video,audio 逗号组合 | all（默认）")
    parser.add_argument("--path-filter", default="pipeline-runs",
                        help="扩展模式只处理 filePath/imageUrl 含此字符串的节点（默认 pipeline-runs）")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", dest="apply", action="store_false",
                      help="只统计不写库（默认）")
    mode.add_argument("--apply", dest="apply", action="store_true",
                      help="实际写库（单事务）")
    parser.set_defaults(apply=False)
    args = parser.parse_args()

    try:
        do_asset, ext_enabled = parse_types(args.types)
    except ValueError as e:
        print(f"error: {e}", file=sys.stderr)
        return 2

    conn = sqlite3.connect(args.db)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    stats = {"total_graphs": 0, "skipped_empty": 0, "skipped_bad_json": 0}

    try:
        cur.execute("BEGIN")
        bf = Backfiller(cur, apply=args.apply, path_filter=args.path_filter)

        cur.execute(
            "SELECT id, projectId, episodesId, data FROM o_agentWorkData WHERE key = 'canvasGraph'"
        )
        rows = cur.fetchall()

        for row in rows:
            stats["total_graphs"] += 1
            result = bf.process_graph(row, do_asset, ext_enabled)
            if result == "empty":
                stats["skipped_empty"] += 1
            elif result == "bad_json":
                stats["skipped_bad_json"] += 1

        if args.apply:
            conn.commit()
        else:
            conn.rollback()  # dry-run：确保零写入
    except Exception as e:
        conn.rollback()
        print(f"error: 回填失败，已回滚事务: {e}", file=sys.stderr)
        conn.close()
        return 1

    # 统计输出（风格对齐 oneoffs/backfill-asset-descriptions.py）
    types_desc = ("asset" if do_asset else "") + (
        ("+" if do_asset and ext_enabled else "") + ",".join(sorted(ext_enabled))
        if ext_enabled else ""
    )
    print(f"\nMode: {'APPLY' if args.apply else 'DRY-RUN'}")
    print(f"DB: {args.db}")
    print(f"Types: {types_desc}")
    print(f"Total graphs scanned: {stats['total_graphs']}")
    print(f"  Skipped (empty data): {stats['skipped_empty']}")
    print(f"  Skipped (bad JSON): {stats['skipped_bad_json']}")
    verb = "created" if args.apply else "would create"
    print(f"  Assets {verb}: {bf.created}")
    print(f"  Images {verb}: {bf.created_images}")
    print(f"  Graphs {'updated' if args.apply else 'would update'}: {bf.updated_graphs}")
    print("\nAction breakdown (by asset type):")
    for atype, count in sorted(bf.action_counts.items()):
        print(f"  {atype}: {count}")

    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
