#!/bin/bash
# RTX VSR socat port-forwarder: localhost:10589 -> comfyui-primary container:10589
# Called by systemd service kais-rtx-vsr-forward.service
set -e

CONTAINER="comfyui-primary"
PORT=10589

echo "[rtx-vsr-fwd] Setting up port forward for $CONTAINER:$PORT"

# Kill any existing socat on this port
pkill -f "socat.*TCP-LISTEN:$PORT" 2>/dev/null || true
sleep 1

# Get container IP dynamically
get_container_ip() {
    docker inspect "$CONTAINER" --format='{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' 2>/dev/null
}

CONTAINER_IP=$(get_container_ip)
if [ -z "$CONTAINER_IP" ]; then
    echo "[rtx-vsr-fwd] ERROR: Cannot get IP for $CONTAINER"
    exit 1
fi

echo "[rtx-vsr-fwd] Forwarding localhost:$PORT -> $CONTAINER_IP:$PORT"

# Start socat in foreground (systemd will manage restarts)
exec socat TCP-LISTEN:$PORT,fork,reuseaddr TCP:$CONTAINER_IP:$PORT
