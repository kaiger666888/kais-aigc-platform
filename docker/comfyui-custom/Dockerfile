# =============================================================================
# kais-comfyui:custom — MEGAPAK + 平台增量节点
# =============================================================================
# 基于 yanwk/comfyui-boot:cu130-megapak-pt211，追加平台特有节点及其 pip 依赖
# 仅 primary 引擎需要（TRELLIS2 3D 生成）
# auxiliary 引擎用基础 MEGAPAK 镜像即可
#
# Build:
#   docker build -t kais-comfyui:custom -f docker/comfyui-custom/Dockerfile .
#
# 注意: 首次构建需确保 MEGAPAK 基线镜像已拉取
# =============================================================================

ARG BASE_IMAGE=yanwk/comfyui-boot:cu130-megapak-pt211
FROM ${BASE_IMAGE}

# --- RMBG pip 依赖 (background removal) ---
RUN pip install --no-cache-dir \
    huggingface-hub>=0.19.0 \
    transparent-background>=1.1.2 \
    segment-anything>=1.0 \
    groundingdino-py>=0.4.0 \
    opencv-python>=4.7.0 \
    onnxruntime>=1.15.0 \
    protobuf>=3.20.2,<6.0.0 \
    hydra-core>=1.3.0 \
    omegaconf>=2.3.0 \
    iopath>=0.1.9

# --- TRELLIS2 依赖 (3D 生成) ---
# comfy-env 会自动管理，但需要 pixi
RUN pip install --no-cache-dir comfy-env

# 复制增量节点
COPY /data/workspace/comfyui-incremental-nodes/ /app/ComfyUI/custom_nodes/kais-incremental/

WORKDIR /app/ComfyUI

# 验证节点加载
RUN python -c "
import sys
sys.path.insert(0, 'custom_nodes/kais-incremental')
print('Incremental nodes ready')
"
