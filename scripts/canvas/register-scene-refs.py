#!/usr/bin/env python3
"""
注册场景角度图（⑥ scene_angle_shot）到 o_assets / o_image。

扫描 `<oss_root>/<project_id>/<phase>/scene_refs/` 目录下的场景多视角图
（文件名形如 S01_front.png / S01_angle_left.png / S01_angle_right.png），
为每个文件：
  - 写入 o_image（filePath 用 OSS 虚拟路径 `/oss/<project_id>/<phase>/scene_refs/<file>`）
  - 写入 o_assets（type='scene', viewAngle=front/angle_left/angle_right, characterId=null）
  - 从文件名提取 sceneId（S01, S02 …）
  - 从 p07/manifest.json（可选）拉取该 sceneId 的描述回填 describe

幂等：以 o_image.filePath 为唯一键——
  - 已存在 → 找到关联 o_assets 并 UPDATE（修正 viewAngle / name / describe / tags）
  - 不存在 → INSERT o_image + o_assets
重复运行不会产生重复记录，也不会改动已正确字段的值（UPDATE 写入的是确定值）。

约束：只做 INSERT/UPDATE，不改 schema；单事务 BEGIN…COMMIT，异常 ROLLBACK。

USAGE:
  python3 scripts/canvas/register-scene-refs.py                         # dry-run（默认）
  python3 scripts/canvas/register-scene-refs.py --apply                 # 单事务写库
  python3 scripts/canvas/register-scene-refs.py --project-id 1785508691757 --apply
  python3 scripts/canvas/register-scene-refs.py --db /path/to/db2.sqlite --apply
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sqlite3
import sys
import time

# 引入共享配置（scripts/canvas/lib/canvas_config.py）——DB 路径解析与 backfill-assets.py 对齐
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib"))
from canvas_config import config_from_env  # noqa: E402

# 线上默认 OSS 根目录（物理磁盘路径）
DEFAULT_OSS_ROOT = "/data/workspace/kais-aigc-platform/data/oss"
# 默认项目（任务文档指定的当前项目）
DEFAULT_PROJECT_ID = 1785508691757
# 场景角度图所在管线阶段目录
DEFAULT_PHASE = "p07"
# 场景角度图子目录名
SCENE_REFS_SUBDIR = "scene_refs"

# 文件名 → (sceneId, angle) 解析正则
# 匹配 S01_front.png / S12_angle_left.png / S03_angle_right.png
FILENAME_RE = re.compile(r"^(S\d+)_(front|angle_left|angle_right)\.png$", re.IGNORECASE)

# 视角 → 中文（用于 describe / 展示）
ANGLE_ZH = {
    "front": "正面",
    "angle_left": "左侧",
    "angle_right": "右侧",
}

# 仅图片扩展名入 o_image
IMAGE_EXTS = (".png", ".jpg", ".jpeg", ".webp")


def resolve_oss_root() -> str:
    """解析 OSS 物理根目录：env OSS_ROOT > KAIS_PLATFORM_ROOT/data/oss > 线上默认。"""
    root = os.environ.get("OSS_ROOT")
    if root:
        return root
    plat = os.environ.get("KAIS_PLATFORM_ROOT")
    if plat:
        return os.path.join(plat, "data", "oss")
    return DEFAULT_OSS_ROOT


def load_manifest_descriptions(oss_root: str, project_id: int, phase: str) -> dict[str, str]:
    """
    从 `<phase>/manifest.json` 读取 scene_id → description 映射（可选）。

    manifest.json 的 nodes[].params 里有 scene_id（如 "S01_front"）与 description。
    失败时返回空 dict（不影响注册主流程）。
    """
    path = os.path.join(oss_root, str(project_id), phase, "manifest.json")
    if not os.path.isfile(path):
        return {}
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError, UnicodeDecodeError):
        return {}
    out: dict[str, str] = {}
    for node in data.get("nodes", []):
        params = node.get("params", {}) or {}
        sid = params.get("scene_id")
        desc = params.get("description")
        # 只收有实质描述的（manifest 里部分是占位 "P07 场景 · … · 场景生成与设定描述"）
        if sid and desc and not desc.startswith("P07 场景"):
            out[str(sid)] = str(desc)
    return out


class SceneRefRegistrar:
    """单事务注册器。apply=False 时只统计不写库。"""

    def __init__(self, cur: sqlite3.Cursor, apply: bool, descriptions: dict[str, str]) -> None:
        self.cur = cur
        self.apply = apply
        self.descriptions = descriptions
        # ID 分配：max(id)+1，事务内自增（脚本单并发）——与 backfill-assets.py 一致
        self.cur.execute("SELECT max(id) AS m FROM o_assets")
        self.max_id = self.cur.fetchone()["m"] or 0
        self.cur.execute("SELECT max(id) AS m FROM o_image")
        self.max_img = self.cur.fetchone()["m"] or 0
        # 统计
        self.inserted_assets = 0   # 新建（或 would create）的 o_assets 数
        self.inserted_images = 0
        self.updated_assets = 0    # 修正（或 would update）的 o_assets 数
        self.skipped = 0           # 无法解析文件名的跳过数

    def _next_ids(self) -> tuple[int, int, str]:
        """分配下一个 asset id 与 uuid。"""
        self.max_id += 1
        aid = self.max_id
        now = int(time.time() * 1000)
        return aid, now, f"ast-{now:x}-{aid}"

    def _insert_image(self, oss_path: str) -> int:
        """插入 o_image 并返回 img_id。"""
        self.max_img += 1
        img_id = self.max_img
        if self.apply:
            self.cur.execute(
                "INSERT INTO o_image (id, filePath, type, state) VALUES (?,?,?,?)",
                (img_id, oss_path, "scene", "已完成"),
            )
        self.inserted_images += 1
        return img_id

    def register_file(self, filename: str, oss_virtual_dir: str, project_id: int,
                      phase: str) -> str:
        """
        处理单个场景角度图文件。返回 'inserted' / 'updated' / 'skipped'。

        oss_virtual_dir: OSS 虚拟路径目录前缀，如 '/oss/1785508691757/p07/scene_refs'
        """
        m = FILENAME_RE.match(filename)
        if not m:
            self.skipped += 1
            print(f"  ? 跳过（文件名无法解析）: {filename}")
            return "skipped"

        scene_id = m.group(1)                       # S01
        angle = m.group(2).lower()                  # front / angle_left / angle_right
        angle_zh = ANGLE_ZH.get(angle, angle)

        # OSS 虚拟路径（前端 resolveMediaUrl 直接消费 /oss/ 前缀）
        oss_path = f"{oss_virtual_dir}/{filename}"
        # 资产名：场景角度图 + sceneId + 视角（区别于全剧级场景设定图「宴会厅 v1」）
        name = f"场景角度图 {scene_id}_{angle}"
        describe = self.descriptions.get(
            f"{scene_id}_{angle}",
            f"场景角度图 · {scene_id} · {angle_zh}（P07 场景多视角生成）",
        )
        tags = f"场景角度图,{scene_id},{phase}"
        meta = {
            "phase": phase,
            "sceneId": scene_id,
            "angle": angle,
            "registered_by": "register-scene-refs",
        }

        # ── 幂等检查：按 o_image.filePath 定位 ──
        self.cur.execute("SELECT id FROM o_image WHERE filePath = ?", (oss_path,))
        img_row = self.cur.fetchone()

        if img_row:
            # 已注册：UPDATE 关联的 o_assets（修正历史脏数据 viewAngle=NULL / 通用名）
            img_id = img_row["id"]
            self.cur.execute(
                "SELECT id FROM o_assets WHERE imageId = ? AND projectId = ?",
                (img_id, project_id),
            )
            asset_row = self.cur.fetchone()
            if asset_row:
                aid = asset_row["id"]
                if self.apply:
                    self.cur.execute(
                        """UPDATE o_assets
                           SET name=?, type='scene', viewAngle=?, characterId=NULL,
                               describe=?, tags=?, meta=?, workflow_phase=?
                           WHERE id=?""",
                        (name, angle, describe, tags,
                         json.dumps(meta, ensure_ascii=False), phase, aid),
                    )
                self.updated_assets += 1
                print(f"  ~ 修正 asset {aid}: {name} (viewAngle={angle})")
                return "updated"
            # o_image 存在但无关联 o_assets：补建 o_assets（罕见，旧数据残留）
            aid, now, uid = self._next_ids()
            self._insert_asset(aid, now, uid, name, angle, describe, tags, meta,
                               img_id, project_id, phase)
            print(f"  + 补建 asset {aid}: {name} (imageId={img_id} 已存在)")
            return "inserted"

        # 未注册：INSERT o_image + o_assets
        img_id = self._insert_image(oss_path)
        aid, now, uid = self._next_ids()
        self._insert_asset(aid, now, uid, name, angle, describe, tags, meta,
                           img_id, project_id, phase)
        print(f"  + 新建 asset {aid}: {name} → imageId={img_id}")
        return "inserted"

    def _insert_asset(self, aid: int, now: int, uid: str, name: str, angle: str,
                      describe: str, tags: str, meta: dict, img_id: int,
                      project_id: int, phase: str) -> None:
        """写入 o_assets（apply=False 时仅统计）。"""
        if self.apply:
            self.cur.execute(
                """INSERT INTO o_assets
                   (id, uuid, name, type, describe, projectId, imageId,
                    characterId, viewAngle, isPrimaryView, state, tags, meta,
                    workflow_phase, createdAt, createdBy)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (aid, uid, name, "scene", describe, project_id, img_id,
                 None, angle, 0, "active", tags,
                 json.dumps(meta, ensure_ascii=False), phase, now, "register-scene-refs"),
            )
        self.inserted_assets += 1


def main() -> int:
    cfg = config_from_env()
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--db", default=cfg.db_path,
                        help="SQLite DB 路径（默认取 canvas_config）")
    parser.add_argument("--project-id", type=int, default=DEFAULT_PROJECT_ID,
                        help=f"项目 ID（默认 {DEFAULT_PROJECT_ID}）")
    parser.add_argument("--oss-root", default=resolve_oss_root(),
                        help="OSS 物理根目录（默认 env OSS_ROOT / KAIS_PLATFORM_ROOT/data/oss / 线上默认）")
    parser.add_argument("--phase", default=DEFAULT_PHASE,
                        help=f"管线阶段目录（默认 {DEFAULT_PHASE}）")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", dest="apply", action="store_false",
                      help="只统计不写库（默认）")
    mode.add_argument("--apply", dest="apply", action="store_true",
                      help="实际写库（单事务）")
    parser.set_defaults(apply=False)
    args = parser.parse_args()

    # 物理扫描目录 + OSS 虚拟目录
    scan_dir = os.path.join(args.oss_root, str(args.project_id), args.phase, SCENE_REFS_SUBDIR)
    oss_virtual_dir = f"/oss/{args.project_id}/{args.phase}/{SCENE_REFS_SUBDIR}"

    if not os.path.isdir(scan_dir):
        print(f"error: 扫描目录不存在: {scan_dir}", file=sys.stderr)
        return 2

    files = sorted(
        f for f in os.listdir(scan_dir)
        if f.lower().endswith(IMAGE_EXTS)
    )
    if not files:
        print(f"warning: 目录无可注册的图片文件: {scan_dir}", file=sys.stderr)
        return 0

    descriptions = load_manifest_descriptions(args.oss_root, args.project_id, args.phase)
    if descriptions:
        print(f"已加载 manifest 描述 {len(descriptions)} 条")

    conn = sqlite3.connect(args.db)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    try:
        cur.execute("BEGIN")
        reg = SceneRefRegistrar(cur, apply=args.apply, descriptions=descriptions)

        results = {"inserted": 0, "updated": 0, "skipped": 0}
        for fn in files:
            r = reg.register_file(fn, oss_virtual_dir, args.project_id, args.phase)
            results[r] += 1

        if args.apply:
            conn.commit()
        else:
            conn.rollback()  # dry-run：确保零写入
    except Exception as e:
        conn.rollback()
        print(f"error: 注册失败，已回滚事务: {e}", file=sys.stderr)
        conn.close()
        return 1

    # 统计输出（风格对齐 backfill-assets.py）
    print(f"\nMode: {'APPLY' if args.apply else 'DRY-RUN'}")
    print(f"DB: {args.db}")
    print(f"扫描目录: {scan_dir}")
    print(f"OSS 虚拟目录: {oss_virtual_dir}")
    print(f"发现图片: {len(files)}")
    verb = "" if args.apply else "(would) "
    print(f"  新建资产 {verb}{reg.inserted_assets}（o_image {verb}{reg.inserted_images}）")
    print(f"  修正资产 {verb}{reg.updated_assets}")
    print(f"  跳过: {reg.skipped}")
    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
