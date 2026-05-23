#!/bin/bash
# build.sh — Build all V6 Docker images from workspace repos
set -e

WORKSPACE="/home/kai/.openclaw/workspace"
PLATFORM="$WORKSPACE/kais-aigc-platform"

echo "=== Phase 5: Building Docker images ==="

# 1. core-backend (Toonflow Express — built from kais-aigc-platform itself)
echo "[1/4] core-backend..."
cd "$PLATFORM"
docker build -t kais-core-backend:latest -f docker/core-backend/Dockerfile . || echo "⚠️ core-backend build needs 'yarn build' first — skipping"

# 2. movie-agent (copy server/ code into docker context)
echo "[2/4] movie-agent..."
rm -rf "$PLATFORM/docker/movie-agent/src"
cp -r "$WORKSPACE/skills/kais-movie-agent/server" "$PLATFORM/docker/movie-agent/src"
cd "$PLATFORM"
docker build -t kais-movie-agent:latest -f docker/movie-agent/Dockerfile docker/movie-agent/

# 3. gold-team (copy v6 code into docker context)
echo "[3/4] gold-team..."
rm -rf "$PLATFORM/docker/gold-team/src"
mkdir -p "$PLATFORM/docker/gold-team/src"
cp -r "$WORKSPACE/kais-gold-team/src/v6" "$PLATFORM/docker/gold-team/src/v6"
cp "$WORKSPACE/kais-gold-team/requirements-v6.txt" "$PLATFORM/docker/gold-team/requirements.txt"
cd "$PLATFORM"
docker build -t kais-gold-team:latest -f docker/gold-team/Dockerfile docker/gold-team/

# 4. review-platform (copy app code into docker context)
echo "[4/4] review-platform..."
rm -rf "$PLATFORM/docker/review-platform/src"
mkdir -p "$PLATFORM/docker/review-platform/src"
cp -r "$WORKSPACE/kais-review-platform/app" "$PLATFORM/docker/review-platform/src/app"
cp -r "$WORKSPACE/kais-review-platform/alembic" "$PLATFORM/docker/review-platform/src/alembic" 2>/dev/null || true
cp "$WORKSPACE/kais-review-platform/requirements-review.txt" "$PLATFORM/docker/review-platform/requirements.txt" 2>/dev/null || \
  echo "fastapi>=0.104.0
uvicorn>=0.24.0
sqlalchemy>=2.0
pydantic>=2.0
pydantic-settings>=2.0
aiosqlite>=0.19" > "$PLATFORM/docker/review-platform/requirements.txt"
cd "$PLATFORM"
docker build -t kais-review-platform:latest -f docker/review-platform/Dockerfile docker/review-platform/

echo ""
echo "=== Build complete ==="
docker images | grep kais- | head -5
