#!/usr/bin/env python3
"""
画布脚本共享配置（Python 侧）：DB 路径与 API 地址，全部由环境变量驱动。

解析优先级（与 JS 侧 lib/canvas-client.js 对齐）：
  db_path  : env DB_PATH
             > env KAIS_PLATFORM_ROOT + /data/db2.sqlite
             > /data/workspace/kais-aigc-platform/data/db2.sqlite（线上默认）
  api_host : env CANVAS_API_HOST，默认 127.0.0.1
  api_port : env CANVAS_API_PORT，默认 10588

纯 stdlib，Python 3.10+。
"""
from __future__ import annotations

import os
from dataclasses import dataclass

# 线上默认 DB 路径（原 backfill-asset-descriptions.py 中使用的路径）
DEFAULT_DB_PATH = "/data/workspace/kais-aigc-platform/data/db2.sqlite"
DEFAULT_API_HOST = "127.0.0.1"
DEFAULT_API_PORT = 10588


@dataclass(frozen=True)
class CanvasConfig:
    """画布脚本运行配置。"""

    db_path: str   # SQLite 数据库文件路径
    api_host: str  # 画布 API 主机
    api_port: int  # 画布 API 端口


def _resolve_db_path() -> str:
    """按优先级解析 DB 路径：DB_PATH > KAIS_PLATFORM_ROOT > 线上默认。"""
    db = os.environ.get("DB_PATH")
    if db:
        return db
    root = os.environ.get("KAIS_PLATFORM_ROOT")
    if root:
        return os.path.join(root, "data", "db2.sqlite")
    return DEFAULT_DB_PATH


def config_from_env() -> CanvasConfig:
    """从环境变量构建配置。"""
    return CanvasConfig(
        db_path=_resolve_db_path(),
        api_host=os.environ.get("CANVAS_API_HOST", DEFAULT_API_HOST),
        api_port=int(os.environ.get("CANVAS_API_PORT", str(DEFAULT_API_PORT))),
    )
