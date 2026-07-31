#!/usr/bin/env bash
# 构建无限画布并部署到 kais-aigc-platform 的静态目录,
# 使其作为独立 SPA 通过 http://localhost:10588/infinite-canvas/ 访问。
# 用法: bash scripts/deploy-canvas.sh
set -euo pipefail

CANVAS_DIR="/data/workspace/kais-aigc-platform/packages/infinite-canvas"
DEPLOY_DIR="/data/workspace/kais-aigc-platform/data/web/infinite-canvas"

echo "[deploy-canvas] 构建 infinite-canvas (npm run build)..."
cd "$CANVAS_DIR"
npm run build

echo "[deploy-canvas] 备份旧版本..."
if [ -d "$DEPLOY_DIR" ]; then
  BACKUP_DIR="${DEPLOY_DIR}.bak.$(date +%s)"
  mv "$DEPLOY_DIR" "$BACKUP_DIR"
  echo "[deploy-canvas] 旧版本备份到 $BACKUP_DIR"
fi

echo "[deploy-canvas] 部署 dist → $DEPLOY_DIR ..."
mkdir -p "$(dirname "$DEPLOY_DIR")"
cp -r dist "$DEPLOY_DIR"

echo "[deploy-canvas] 完成 → http://localhost:10588/infinite-canvas/"
