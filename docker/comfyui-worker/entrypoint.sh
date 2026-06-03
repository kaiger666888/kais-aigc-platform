#!/bin/bash
set -e

echo "=== ComfyUI Worker Entrypoint ==="
echo "PyTorch: $(python3 -c 'import torch; print(f"{torch.__version__}, CUDA {torch.version.cuda}")')"
echo ""

# -------------------------------------------------------------------------
# TRELLIS 2: 通过 comfy-env 安装预编译 CUDA 扩展
# -------------------------------------------------------------------------
# cumesh_vb, flex_gemm_ap, o_voxel_vb_ap — 仅 cp312+ wheel
# 需要网络访问 (pixi 从 GitHub 下载 wheel)
echo "=== Installing TRELLIS 2 CUDA extensions via comfy-env ==="

# 检查是否已安装
if python3 -c "import cumesh_vb" 2>/dev/null; then
    echo "cumesh_vb already installed, skipping comfy-env install"
else
    echo "Running comfy-env install for TRELLIS2 node requirements..."
    # 遍历 custom_nodes, 找到 comfy-3d-viewers 并执行 install.py
    for node_dir in /app/ComfyUI/custom_nodes/comfy-3d-viewers; do
        if [ -f "$node_dir/install.py" ]; then
            echo "Found install.py in $node_dir"
            cd "$node_dir"
            # 设置代理和网络
            export http_proxy=${http_proxy:-http://172.18.0.1:7890}
            export https_proxy=${https_proxy:-http://172.18.0.1:7890}
            # pixi 可能需要无代理访问 GitHub, 先尝试有代理
            python3 install.py || echo "WARNING: install.py failed, will try without proxy"
            cd /app/ComfyUI
        fi
    done

    # 也尝试 comfy-sparse-attn
    for node_dir in /app/ComfyUI/custom_nodes/comfy-sparse-attn; do
        if [ -f "$node_dir/install.py" ]; then
            echo "Found install.py in $node_dir"
            cd "$node_dir"
            export http_proxy=${http_proxy:-http://172.18.0.1:7890}
            export https_proxy=${https_proxy:-http://172.18.0.1:7890}
            python3 install.py || echo "WARNING: install.py failed"
            cd /app/ComfyUI
        fi
    done
fi

# 验证
echo ""
echo "=== Verifying TRELLIS 2 dependencies ==="
python3 -c "
try:
    import cumesh_vb; print('cumesh_vb OK')
except ImportError:
    print('WARNING: cumesh_vb not available')
try:
    import flex_gemm_ap; print('flex_gemm_ap OK')
except ImportError:
    print('WARNING: flex_gemm_ap not available')
try:
    import o_voxel_vb_ap; print('o_voxel_vb_ap OK')
except ImportError:
    print('WARNING: o_voxel_vb_ap not available')
try:
    import spconv; print('spconv OK')
except ImportError:
    print('ERROR: spconv missing')
try:
    import flash_attn; print('flash_attn OK')
except ImportError:
    print('WARNING: flash_attn not available')
"

echo ""
echo "=== Starting ComfyUI ==="
exec python3 main.py --listen 0.0.0.0 --port 8188
