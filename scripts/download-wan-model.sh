#!/bin/bash
# Resume Wan2.1-T2V-1.3B model download
# Run this when HuggingFace is accessible (or via mirror)
#
# Usage:
#   ./download-wan-model.sh              # Direct HuggingFace
#   HF_ENDPOINT=https://hf-mirror.com ./download-wan-model.sh  # Via mirror

set -e

MODEL="Wan-AI/Wan2.1-T2V-1.3B-Diffusers"
TARGET="/home/kai/ComfyUI/models/diffusers/Wan2.1-T2V-1.3B"

echo "Downloading Wan2.1-T2V-1.3B to ${TARGET}..."
echo "HF_ENDPOINT: ${HF_ENDPOINT:-default (huggingface.co)}"

python3 -c "
from huggingface_hub import snapshot_download
snapshot_download(
    '${MODEL}',
    local_dir='${TARGET}',
)
print('✅ Download complete!')
"

echo ""
echo "Model size:"
du -sh "${TARGET}"
echo ""
echo "Verify: restart gold-team and submit a video task"
