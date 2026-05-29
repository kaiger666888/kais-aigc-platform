# =============================================================================
# comfyui-worker (ComfyUI 推理引擎) — PyTorch 2.5.1 固化版本
# =============================================================================
# 在已构建的 ComfyUI 镜像基础上，升级 PyTorch 到 2.5.1
# 需要 NVIDIA GPU (RTX 3090, 24GB VRAM)
# 模型挂载自 /opt/kais/models
# =============================================================================

FROM kais-aigc-platform-comfyui-worker:latest

# -------------------------------------------------------------------------
# 升级 PyTorch 到 2.5.1 + CUDA 12.1
#   - torch.library.custom_op 在 2.5+ 才有
#   - nvidia-cudnn-cu12 提供 cuDNN 9，部分 custom node 需要
# -------------------------------------------------------------------------
RUN pip install --no-cache-dir \
    torch==2.5.1 \
    torchvision==0.20.1 \
    torchaudio==2.5.1 \
    --index-url https://download.pytorch.org/whl/cu121 \
    && pip install --no-cache-dir nvidia-cudnn-cu12==9.*

# 验证版本
RUN python -c "import torch; assert torch.__version__.startswith('2.5'), f'Expected 2.5.x, got {torch.__version__}'; print(f'PyTorch {torch.__version__} OK')"
