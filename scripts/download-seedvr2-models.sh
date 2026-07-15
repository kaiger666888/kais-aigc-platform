#!/bin/bash
# SeedVR2 模型下载脚本
#
# 用途：将 numz/SeedVR2_comfyUI 仓库中的 7B FP16 DiT 和 VAE 拉取到
#       /data/models/comfyui/SEEDVR2/，供 ComfyUI-SeedVR2_VideoUpscaler 节点使用
#
# Usage:
#   ./scripts/download-seedvr2-models.sh                 # 下载 7B FP16 (默认，~15GB)
#   ./scripts/download-seedvr2-models.sh --sharp         # 下载 7B sharp 变体（更锐利）
#   ./scripts/download-seedvr2-models.sh --fp8           # 下载 FP8 量化版（~7GB，省显存）
#   ./scripts/download-seedvr2-models.sh --3b            # 下载 3B 轻量版（~6GB）
#   HF_ENDPOINT=https://hf-mirror.com ./scripts/download-seedvr2-models.sh  # 通过国内镜像
#
# 模型放置路径：/data/models/comfyui/SEEDVR2/
# 容器内对应路径：/root/ComfyUI/models/SEEDVR2/（已通过 docker-compose.v9.yml 挂载）

set -e

TARGET_DIR="/data/models/comfyui/SEEDVR2"
REPO_MAIN="numz/SeedVR2_comfyUI"
REPO_ALT="AInVFX/SeedVR2_comfyUI"

VARIANT=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --sharp) VARIANT="sharp"; shift ;;
    --fp8)   VARIANT="fp8"; shift ;;
    --3b)    VARIANT="3b"; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

mkdir -p "${TARGET_DIR}"

# 选择 DiT 模型
case "${VARIANT}" in
  "")
    DIT_FILE="seedvr2_ema_7b_fp16.safetensors"
    DIT_REPO="${REPO_MAIN}"
    DIT_SIZE_HINT="~14GB"
    ;;
  sharp)
    DIT_FILE="seedvr2_ema_7b_sharp_fp16.safetensors"
    DIT_REPO="${REPO_MAIN}"
    DIT_SIZE_HINT="~14GB"
    ;;
  fp8)
    DIT_FILE="seedvr2_ema_7b_fp8_e4m3fn_mixed_block35_fp16.safetensors"
    DIT_REPO="${REPO_ALT}"
    DIT_SIZE_HINT="~7GB"
    ;;
  3b)
    DIT_FILE="seedvr2_ema_3b_fp16.safetensors"
    DIT_REPO="${REPO_MAIN}"
    DIT_SIZE_HINT="~6GB"
    ;;
esac

VAE_FILE="ema_vae_fp16.safetensors"

echo "================================================"
echo " SeedVR2 Model Downloader"
echo "================================================"
echo " Endpoint:    ${HF_ENDPOINT:-https://huggingface.co}"
echo " Target:      ${TARGET_DIR}"
echo " DiT:         ${DIT_FILE} (${DIT_SIZE_HINT}) from ${DIT_REPO}"
echo " VAE:         ${VAE_FILE} (~300MB-1GB) from ${REPO_MAIN}"
echo "================================================"
echo ""

# 检查 huggingface_hub 是否可用
if ! python3 -c "import huggingface_hub" 2>/dev/null; then
  echo "Installing huggingface_hub..."
  pip install -q huggingface_hub
fi

python3 <<PYEOF
from huggingface_hub import hf_hub_download
import os, shutil

target = "${TARGET_DIR}"
dit_file = "${DIT_FILE}"
dit_repo = "${DIT_REPO}"
vae_file = "${VAE_FILE}"
vae_repo = "${REPO_MAIN}"

def fetch(repo, filename, hint=""):
    dst = os.path.join(target, filename)
    if os.path.exists(dst) and os.path.getsize(dst) > 0:
        print(f"[SKIP] {filename} already exists ({os.path.getsize(dst)/1e9:.2f} GB)")
        return
    print(f"[DOWNLOAD] {filename} {hint} from {repo}...")
    tmp = hf_hub_download(repo_id=repo, filename=filename, local_dir=target)
    # hf_hub_download with local_dir places file at target/filename directly
    print(f"[OK] {filename} ({os.path.getsize(dst)/1e9:.2f} GB)")

fetch(dit_repo, dit_file, "(DiT)")
fetch(vae_repo, vae_file, "(VAE)")
PYEOF

echo ""
echo "================================================"
echo " ✅ Download complete!"
echo "================================================"
echo ""
echo "Files in ${TARGET_DIR}:"
ls -lh "${TARGET_DIR}"
echo ""
echo "Verify inside container:"
echo "  docker exec comfyui-primary ls /root/ComfyUI/models/SEEDVR2/"
echo ""
echo "Next: restart gold-team if route not loaded, then POST /api/production/postprocess/seedvr2"
