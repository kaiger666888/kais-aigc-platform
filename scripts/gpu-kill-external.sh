#!/bin/bash
# gpu-kill-external.sh — Kill non-docker GPU processes on a specific GPU
# Usage: gpu-kill-external.sh <gpu_id> [<needed_free_mb>]

GPU_ID="${1:?Usage: $0 <gpu_id> [needed_free_mb]}"
NEEDED_MB="${2:-0}"

CURRENT_FREE=$(nvidia-smi --query-gpu=memory.free --format=csv,noheader,nounits --id="$GPU_ID" | tr -d ' ')

if [ "$CURRENT_FREE" -ge "$NEEDED_MB" ] 2>/dev/null; then
  echo "OK $CURRENT_FREE"
  exit 0
fi

PIDS=$(nvidia-smi --query-compute-apps=pid,gpu_uuid --format=csv,noheader --id="$GPU_ID" | \
  awk -F', ' '{print $1}' | tr -d ' ')

for PID in $PIDS; do
  [ "$PID" -lt 100 ] 2>/dev/null && continue
  cat /proc/$PID/cgroup 2>/dev/null | grep -q docker && continue
  kill -TERM "$PID" 2>/dev/null
  echo "KILLED $PID"
done

for i in $(seq 1 15); do
  sleep 2
  CURRENT_FREE=$(nvidia-smi --query-gpu=memory.free --format=csv,noheader,nounits --id="$GPU_ID" | tr -d ' ')
  [ "$CURRENT_FREE" -ge "$NEEDED_MB" ] 2>/dev/null && echo "OK $CURRENT_FREE" && exit 0
done

for PID in $PIDS; do kill -KILL "$PID" 2>/dev/null; done
sleep 3
CURRENT_FREE=$(nvidia-smi --query-gpu=memory.free --format=csv,noheader,nounits --id="$GPU_ID" | tr -d ' ')
[ "$CURRENT_FREE" -ge "$NEEDED_MB" ] 2>/dev/null && echo "OK $CURRENT_FREE" && exit 0
echo "INSUFFICIENT $CURRENT_FREE"
exit 1
