#!/bin/sh
# =============================================================================
# Entrypoint for kais-core-backend
# =============================================================================
# Syncs static assets from the image (/app/image-assets/) to the data volume
# (/app/data/) on every start. This ensures web/, vendor/, and version.txt
# are always up-to-date with the image, while preserving user-generated data
# (db/, oss/, skills/, assets/) in the volume.
# =============================================================================

set -e

DATA_DIR="/app/data"
IMAGE_DIR="/app/image-assets"

# Create data directory if it doesn't exist (fresh volume)
mkdir -p "$DATA_DIR"

# Copy static assets from image to data volume on every start.
# Using cp -a to preserve attributes; overwrites existing files with image versions.
if [ -d "$IMAGE_DIR" ]; then
  echo "[entrypoint] Syncing static assets from image to data volume..."
  
  # Sync web/ (frontend static files)
  if [ -d "$IMAGE_DIR/web" ]; then
    rm -rf "$DATA_DIR/web"
    cp -a "$IMAGE_DIR/web" "$DATA_DIR/web"
  fi
  
  # Sync vendor/ (TTS, image, video provider adapters)
  if [ -d "$IMAGE_DIR/vendor" ]; then
    rm -rf "$DATA_DIR/vendor"
    cp -a "$IMAGE_DIR/vendor" "$DATA_DIR/vendor"
  fi
  
  # Sync version.txt
  if [ -f "$IMAGE_DIR/version.txt" ]; then
    cp -a "$IMAGE_DIR/version.txt" "$DATA_DIR/version.txt"
  fi
  
  echo "[entrypoint] Sync complete."
else
  echo "[entrypoint] No image-assets directory found, skipping sync."
fi

echo "[entrypoint] Starting core-backend..."
exec "$@"
