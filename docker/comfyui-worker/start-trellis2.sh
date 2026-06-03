#!/bin/bash
set -e

# =============================================================================
# start-trellis2.sh — Launch TRELLIS2 ComfyUI container on GPU 1 (RTX 3090)
# =============================================================================
# GPU 1 = RTX 3090 24GB — TRELLIS2 needs large VRAM
# CUDA_VISIBLE_DEVICES=0 makes PyTorch inside the container see physical GPU 1 as cuda:0
#
# NOTE: No input volume mount! This allows `docker cp` to work correctly.
#       The API route uses docker cp to upload files into the container.
# =============================================================================

GPU_DEVICE=${TRELLIS2_GPU_DEVICE:-1}
PORT=${TRELLIS2_PORT:-8189}
IMAGE=${TRELLIS2_IMAGE:-comfyui-worker:trellis2}
CONTAINER_NAME=${TRELLIS2_CONTAINER_NAME:-comfyui-trellis}

# Remove existing container if present
if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo "Removing existing container: ${CONTAINER_NAME}"
    docker rm -f "${CONTAINER_NAME}" >/dev/null
fi

echo "Starting TRELLIS2 ComfyUI on GPU ${GPU_DEVICE} → port ${PORT}"
echo "  Image:  ${IMAGE}"
echo "  Models: /data/models (read-only)"
echo ""

docker run -d --name "${CONTAINER_NAME}" \
    --gpus "device=${GPU_DEVICE}" \
    -e CUDA_VISIBLE_DEVICES=0 \
    -p "${PORT}":8189 \
    -v /data/models:/data/models:ro \
    -v /mnt/agents/output:/mnt/agents/output \
    -e HF_ENDPOINT=https://hf-mirror.com \
    --restart unless-stopped \
    "${IMAGE}"

echo ""
echo "Container ${CONTAINER_NAME} started."
echo "  ComfyUI: http://localhost:${PORT}"
echo "  Logs:    docker logs -f ${CONTAINER_NAME}"
