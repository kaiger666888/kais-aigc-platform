#!/usr/bin/env bash
# 构建无限画布并部署到 kais-aigc-platform 的静态目录,
# 使其作为独立 SPA 通过 http://localhost:10588/infinite-canvas/ 访问。
# 用法: bash scripts/deploy-canvas.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CANVAS_DIR="/data/workspace/kais-aigc-platform/packages/infinite-canvas"
DEPLOY_DIR="/data/workspace/kais-aigc-platform/data/web/infinite-canvas"

# ─── API 契约审计（非阻断：仅 warning）─────────────────────
echo "📋 Running API contract audit..."
set +e
python3 "$SCRIPT_DIR/audit-api-contract.py"
AUDIT_EXIT=$?
set -e
if [ $AUDIT_EXIT -ne 0 ]; then
    echo "⚠️  API contract audit found mismatches (see above)."
    echo "   These won't block deploy, but should be fixed."
fi

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
