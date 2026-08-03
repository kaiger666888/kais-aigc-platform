#!/bin/bash
# Start RTX VSR micro-service inside comfyui-primary container
# Called by systemd service kais-rtx-vsr.service
set -e

CONTAINER="comfyui-primary"
SCRIPT_PATH="/data/workspace/kais-aigc-platform/scripts/rtx_vsr_service.py"
CONTAINER_SCRIPT="/mnt/agents/output/gpu1/rtx_vsr_service.py"

# Wait for container to be running
echo "[rtx-vsr] Waiting for $CONTAINER to start..."
for i in $(seq 1 60); do
    STATE=$(docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null || echo "false")
    if [ "$STATE" = "true" ]; then
        break
    fi
    sleep 2
done

if [ "$STATE" != "true" ]; then
    echo "[rtx-vsr] ERROR: $CONTAINER not running after 120s"
    exit 1
fi

# Wait for ComfyUI to be ready (so CUDA is initialized)
echo "[rtx-vsr] Waiting for ComfyUI to be ready..."
for i in $(seq 1 90); do
    if docker exec "$CONTAINER" curl -sf http://localhost:8188/system_stats >/dev/null 2>&1; then
        echo "[rtx-vsr] ComfyUI is ready"
        break
    fi
    sleep 2
done

# Check if VSR service is already running
if docker exec "$CONTAINER" curl -sf http://localhost:10589/health >/dev/null 2>&1; then
    echo "[rtx-vsr] Service already running, skipping"
    exit 0
fi

# Copy the service script into the container shared volume (readable by container)
sudo cp "$SCRIPT_PATH" /mnt/agents/output/gpu1/rtx_vsr_service.py 2>/dev/null || true
sudo chmod 644 /mnt/agents/output/gpu1/rtx_vsr_service.py 2>/dev/null || true
# Ensure output dir exists with proper permissions
sudo mkdir -p /mnt/agents/output/gpu1/rtx-vsr
sudo chmod 777 /mnt/agents/output/gpu1/rtx-vsr 2>/dev/null || true

# Start VSR service inside container
echo "[rtx-vsr] Starting RTX VSR service on port 10589..."
docker exec -d "$CONTAINER" bash -c "
    export LD_LIBRARY_PATH=/usr/lib/x86_64-linux-gnu:\$LD_LIBRARY_PATH
    export PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True
    python3.13 '$CONTAINER_SCRIPT' > /tmp/rtx-vsr.log 2>&1
"

# Wait for VSR to be ready
echo "[rtx-vsr] Waiting for VSR service to be ready..."
for i in $(seq 1 30); do
    if docker exec "$CONTAINER" curl -sf http://localhost:10589/health >/dev/null 2>&1; then
        echo "[rtx-vsr] Service is ready!"
        docker exec "$CONTAINER" curl -s http://localhost:10589/health
        exit 0
    fi
    sleep 2
done

echo "[rtx-vsr] ERROR: VSR service failed to start"
docker exec "$CONTAINER" cat /tmp/rtx-vsr.log 2>/dev/null | tail -20
exit 1
