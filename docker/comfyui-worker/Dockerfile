# =============================================================================
# comfyui-worker (ComfyUI 推理引擎)
# =============================================================================
# 基于 ComfyUI 官方镜像或自定义构建
# 需要 NVIDIA GPU (RTX 3090, 24GB VRAM)
# 模型挂载自 /opt/kais/models
# =============================================================================
# 多阶段构建: 先克隆 ComfyUI，再打包到运行镜像

FROM pytorch/pytorch:2.1.2-cuda12.1-cudnn8-runtime AS base

# 升级 PyTorch 到 2.5.1（需要 torch.library.custom_op 支持）
RUN pip install --no-cache-dir \
    torch==2.5.1 \
    --index-url https://download.pytorch.org/whl/cu121 \
    || pip install --no-cache-dir torch==2.5.1

WORKDIR /app

# 系统依赖
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        git \
        curl \
        libgl1-mesa-glx \
        libglib2.0-0 \
        libsm6 \
        libxext6 \
        libxrender-dev \
    && rm -rf /var/lib/apt/lists/*

# 克隆 ComfyUI
RUN git clone https://github.com/comfyanonymous/ComfyUI.git /app/ComfyUI --depth 1

WORKDIR /app/ComfyUI

# Python 依赖
RUN pip install --no-cache-dir -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple

# 安装常用 custom nodes
RUN cd custom_nodes && \
    git clone https://github.com/ltdrdata/ComfyUI-Manager.git --depth 1 && \
    git clone https://github.com/comfyanonymous/ComfyUI_IPAdapter_plus.git --depth 1 2>/dev/null || true && \
    git clone https://github.com/cubiq/ComfyUI_essentials.git --depth 1 2>/dev/null || true

# 预创建输出目录
RUN mkdir -p /mnt/agents/output

ENV PYTHONPATH="/app/ComfyUI:${PYTHONPATH}"

EXPOSE 8188

# ComfyUI 自带健康端点: /system_stats
CMD ["python", "main.py", "--listen", "0.0.0.0", "--port", "8188", "--output-directory", "/mnt/agents/output"]
