#!/usr/bin/env bash
# 构建 kais-story-map 并部署到 kais-aigc-platform 的静态目录,
# 使其作为独立 SPA 通过 http://localhost:10588/story-map/ 访问。
# 用法:在 platform 仓库任意位置执行 bash scripts/deploy-story-map.sh
set -euo pipefail

STORY_MAP_DIR="/data/workspace/kais-story-map"
DEPLOY_DIR="/data/workspace/kais-aigc-platform/data/web/story-map"

echo "[deploy-story-map] 构建 kais-story-map (npm run build)..."
cd "$STORY_MAP_DIR"
npm run build

echo "[deploy-story-map] 部署 dist → $DEPLOY_DIR ..."
rm -rf "$DEPLOY_DIR"
mkdir -p "$(dirname "$DEPLOY_DIR")"
cp -r dist "$DEPLOY_DIR"

echo "[deploy-story-map] 完成 → http://localhost:10588/story-map/"
