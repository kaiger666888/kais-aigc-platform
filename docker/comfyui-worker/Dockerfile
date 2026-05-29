# =============================================================================
# comfyui-worker (ComfyUI 推理引擎)
# =============================================================================
# 基于 PyTorch 官方镜像，升级到 2.5.1 以支持 torch.library.custom_op
# 需要 NVIDIA GPU (RTX 3090, 24GB VRAM)
# 模型挂载自 /opt/kais/models
# =============================================================================

FROM pytorch/pytorch:2.1.2-cuda12.1-cudnn8-runtime

# -------------------------------------------------------------------------
# 1. 系统依赖
# -------------------------------------------------------------------------
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        git curl wget \
        libgl1-mesa-glx libglib2.0-0 libsm6 libxext6 libxrender-dev \
    && rm -rf /var/lib/apt/lists/*

# -------------------------------------------------------------------------
# 2. 升级 PyTorch 到 2.5.1 + CUDA 12.1 + nvidia-cudnn-cu12
#    - torch.library.custom_op 在 2.5+ 才有
#    - nvidia-cudnn-cu12 提供 cuDNN 9，部分 custom node 需要
# -------------------------------------------------------------------------
RUN pip install --no-cache-dir --extra-index-url https://download.pytorch.org/whl/cu121 \
    torch==2.5.1 \
    torchvision==0.20.1 \
    torchaudio==2.5.1 \
    && pip install --no-cache-dir \
    nvidia-cudnn-cu12==9.*

# 验证 PyTorch 版本
RUN python -c "import torch; assert torch.__version__.startswith('2.5'), f'Expected 2.5.x, got {torch.__version__}'; print(f'PyTorch {torch.__version__} OK')"

# -------------------------------------------------------------------------
# 3. 克隆 ComfyUI
# -------------------------------------------------------------------------
WORKDIR /app
RUN git clone https://github.com/comfyanonymous/ComfyUI.git /app/ComfyUI --depth 1

WORKDIR /app/ComfyUI

# -------------------------------------------------------------------------
# 4. Python 依赖
# -------------------------------------------------------------------------
RUN pip install --no-cache-dir -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple

# -------------------------------------------------------------------------
# 5. 常用 custom nodes
# -------------------------------------------------------------------------
RUN cd custom_nodes && \
    git clone https://github.com/ltdrdata/ComfyUI-Manager.git --depth 1 && \
    git clone https://github.com/comfyanonymous/ComfyUI_IPAdapter_plus.git --depth 1 2>/dev/null || true && \
    git clone https://github.com/cubiq/ComfyUI_essentials.git --depth 1 2>/dev/null || true

# -------------------------------------------------------------------------
# 6. 运行时配置
# -------------------------------------------------------------------------
RUN mkdir -p /mnt/agents/output

ENV PYTHONPATH="/app/ComfyUI:${PYTHONPATH}"

EXPOSE 8188

# ComfyUI 自带健康端点: /system_stats
CMD ["python", "main.py", "--listen", "0.0.0.0", "--port", "8188", "--output-directory", "/mnt/agents/output"]
