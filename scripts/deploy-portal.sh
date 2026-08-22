#!/usr/bin/env bash
# 构建制片门户(packages/portal)并部署到 kais-aigc-platform 静态目录,
# 使其通过 http://localhost:10588/portal/ 访问(/deliver/:ep、/toonflow 同壳)。
# 前置: 先构建 kap-nav 产物(data/assets/kap-nav.*),dist/index.html 的
# 稳定名引用在部署前改写为 hash 名(破 /assets maxAge 1d 缓存)。
# 用法: bash scripts/deploy-portal.sh
set -euo pipefail

ROOT="/data/workspace/kais-aigc-platform"
PKG_DIR="$ROOT/packages/portal"
DEPLOY_DIR="$ROOT/data/web/portal"
ASSETS_DIR="$ROOT/data/assets"

# ─── kap-nav 产物（tokens concat css + IIFE js；Task 2 起存在）─────────
if [ -f "$ROOT/scripts/build-kap-nav.mjs" ]; then
  echo "[deploy-portal] 构建 kap-nav 产物 (build-kap-nav.mjs)..."
  node "$ROOT/scripts/build-kap-nav.mjs"
else
  echo "[deploy-portal] 跳过 kap-nav 构建(scripts/build-kap-nav.mjs 尚未就位)"
fi

echo "[deploy-portal] 构建 portal (npm run build)..."
cd "$PKG_DIR"
npm run build

# ─── dist/index.html 资产引用 hash 化（稳定名 → hash 名）────────────────
if [ -f "$ASSETS_DIR/kap-nav.latest.json" ]; then
  NAV_CSS=$(node -p "require('$ASSETS_DIR/kap-nav.latest.json').css")
  sed -i "s#/assets/kap-nav\\.css#/assets/$NAV_CSS#g" "$PKG_DIR/dist/index.html"
  echo "[deploy-portal] kap-nav.css 引用 → /assets/$NAV_CSS"
fi

echo "[deploy-portal] 备份旧版本..."
if [ -d "$DEPLOY_DIR" ]; then
  BACKUP_DIR="${DEPLOY_DIR}.bak.$(date +%s)"
  mv "$DEPLOY_DIR" "$BACKUP_DIR"
  echo "[deploy-portal] 旧版本备份到 $BACKUP_DIR"
fi

echo "[deploy-portal] 部署 dist → $DEPLOY_DIR ..."
mkdir -p "$(dirname "$DEPLOY_DIR")"
cp -r dist "$DEPLOY_DIR"

echo "[deploy-portal] 完成 → http://localhost:10588/portal/"
