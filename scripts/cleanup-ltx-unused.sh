#!/bin/bash
# cleanup-ltx-unused.sh
# 清理 /data/models 中三个 Kijai LTX-2.3 工作流不会用到的模型文件
#
# ⚠️ 安全策略：
#   1. 先 mv 到 /data/models/_trash/ltx-cleanup-$(date +%Y%m%d)/ 而不是直接 rm
#   2. 只处理 /data/models/ 下的顶层目录和文件，不动 comfyui/ 子目录内的
#   3. comfyui/ 内的清理单独列出，需要手动确认（因为有 symlink 依赖）
#
# 保留文件（工作流必需）：
#   /data/models/comfyui/diffusion_models/ltx-2.3-22b-distilled-mxfp8.safetensors  (23G)
#   /data/models/comfyui/text_encoders/gemma_3_12B_it_fp8_scaled.safetensors    (13G)
#   /data/models/comfyui/text_encoders/ltx-2.3_text_projection_bf16.safetensors   (2.2G)
#   /data/models/comfyui/vae/ltx2_vae/LTX23_video_vae_bf16.safetensors            (1.4G)
#   /data/models/comfyui/loras/ltx-2.3-22b-distilled-lora-384-1.1.safetensors      (7.1G)

set -euo pipefail

TRASH_DIR="/data/models/_trash/ltx-cleanup-$(date +%Y%m%d)"
mkdir -p "$TRASH_DIR"

echo "========================================="
echo " LTX 无用模型清理脚本"
echo " 回收站: $TRASH_DIR"
echo "========================================="
echo ""

# ─── Part 1: /data/models/ 顶层 LTX 文件和目录 ───
echo "📦 Part 1: /data/models/ 顶层清理"
echo ""

freed=0

# 1. ltx-2.3-fp8/ — 空目录(只有aria2残留文件)，工作流用 mxfp8 不是 fp8
if [ -d "/data/models/ltx-2.3-fp8" ]; then
    size=$(du -sh /data/models/ltx-2.3-fp8 2>/dev/null | cut -f1)
    mv /data/models/ltx-2.3-fp8 "$TRASH_DIR/"
    echo "  ✅ ltx-2.3-fp8/ ($size) → 已移走"
fi

# 2. ltx-2.3-gguf/ — 25G GGUF 量化版，我们用 mxfp8 block32
if [ -d "/data/models/ltx-2.3-gguf" ]; then
    size=$(du -sh /data/models/ltx-2.3-gguf 2>/dev/null | cut -f1)
    mv /data/models/ltx-2.3-gguf "$TRASH_DIR/"
    echo "  ✅ ltx-2.3-gguf/ ($size) → 已移走"
fi

# 3. ltx-te/ — fp4 CLIP + 旧版 split_files，工作流用 fp8 版
if [ -d "/data/models/ltx-te" ]; then
    size=$(du -sh /data/models/ltx-te 2>/dev/null | cut -f1)
    mv /data/models/ltx-te "$TRASH_DIR/"
    echo "  ✅ ltx-te/ ($size) → 已移走"
fi

# 4. ltx-mxfp8/ — 重复：根文件和 diffusion_models/ 下的同一文件
#    保留 ltx-mxfp8/diffusion_models/ 子目录(symlink源)，只移走根文件
if [ -f "/data/models/ltx-mxfp8/ltx-2.3-22b-distilled-1.1_transformer_only_mxfp8_block32.safetensors" ]; then
    size=$(du -sh /data/models/ltx-mxfp8/ltx-2.3-22b-distilled-1.1_transformer_only_mxfp8_block32.safetensors 2>/dev/null | cut -f1)
    mv /data/models/ltx-mxfp8/ltx-2.3-22b-distilled-1.1_transformer_only_mxfp8_block32.safetensors "$TRASH_DIR/"
    echo "  ✅ ltx-mxfp8/ 根文件 ($size 重复) → 已移走"
fi
# 移走空目录结构（如果 diffusion_models 子目录是空的就一起移）
if [ -d "/data/models/ltx-mxfp8/diffusion_models" ] && [ -z "$(ls -A /data/models/ltx-mxfp8/diffusion_models 2>/dev/null)" ]; then
    rmdir /data/models/ltx-mxfp8/diffusion_models
    rmdir /data/models/ltx-mxfp8 2>/dev/null && echo "  ✅ ltx-mxfp8/ 空目录已清理"
fi

# 5. ltx-lora/ — fro09 动态 LoRA，工作流用 384 freeze-frame LoRA
if [ -d "/data/models/ltx-lora" ]; then
    size=$(du -sh /data/models/ltx-lora 2>/dev/null | cut -f1)
    mv /data/models/ltx-lora "$TRASH_DIR/"
    echo "  ✅ ltx-lora/ ($size, fro09动态LoRA) → 已移走"
fi

# 6. ltxv-spatial-upscaler-0.9.8.safetensors — 超分辨率，三个工作流都不用
if [ -f "/data/models/ltxv-spatial-upscaler-0.9.8.safetensors" ]; then
    size=$(du -sh /data/models/ltxv-spatial-upscaler-0.9.8.safetensors 2>/dev/null | cut -f1)
    mv /data/models/ltxv-spatial-upscaler-0.9.8.safetensors "$TRASH_DIR/"
    echo "  ✅ ltxv-spatial-upscaler-0.9.8.safetensors ($size) → 已移走"
fi

echo ""
echo "📦 Part 2: comfyui/ 内的清理建议"
echo ""

# comfyui/ 内的文件需要更谨慎，因为 ComfyUI 可能通过不同路径扫描
# 列出所有不会用到的文件，但默认不自动移动，需要手动确认

echo "  ⚠️ 以下文件不会被自动清理，需要手动确认："
echo ""
echo "  comfyui/unet/ 下的 GGUF（3个，~37G）："
[ -f "/data/models/comfyui/unet/ltx-2.3-22b-dev-Q4_K_M.gguf" ] && echo "    - unet/ltx-2.3-22b-dev-Q4_K_M.gguf (3.2G)"
[ -f "/data/models/comfyui/unet/ltx-2.3-22b-distilled-1.1-Q4_K_M.gguf" ] && echo "    - unet/ltx-2.3-22b-distilled-1.1-Q4_K_M.gguf (17G)"
[ -f "/data/models/comfyui/unet/LTX-2.3-22B-distilled-1.1-Q4_K_M.gguf" ] && echo "    - unet/LTX-2.3-22B-distilled-1.1-Q4_K_M.gguf (17G, 上面的大写重复)"
echo ""
echo "  comfyui/unet/ 下的旧版 symlink："
[ -L "/data/models/comfyui/unet/ltx-2.3-22b-distilled-fp8.safetensors" ] && echo "    - unet/ltx-2.3-22b-distilled-fp8.safetensors (symlink→空目标)"
[ -L "/data/models/comfyui/unet/ltxv-13b-0.9.8-distilled.safetensors" ] && echo "    - unet/ltxv-13b-0.9.8-distilled.safetensors (symlink→旧版0.9)"
[ -L "/data/models/comfyui/unet/LTX-2.3-22B-distilled-1.1-Q5_K_M.gguf" ] && echo "    - unet/LTX-2.3-22B-distilled-1.1-Q5_K_M.gguf (symlink→GGUF)"
[ -L "/data/models/comfyui/unet/LTX-2.3-22B-distilled-1.1-Q6_K.gguf" ] && echo "    - unet/LTX-2.3-22B-distilled-1.1-Q6_K.gguf (symlink→GGUF)"
echo ""
echo "  comfyui/checkpoints/ 下的旧版/无用文件："
[ -f "/data/models/comfyui/checkpoints/ltx-2.3-22b-dev-nvfp4.safetensors" ] && echo "    - checkpoints/ltx-2.3-22b-dev-nvfp4.safetensors"
[ -L "/data/models/comfyui/checkpoints/ltx-2.3-spatial-upscaler.safetensors" ] && echo "    - checkpoints/ltx-2.3-spatial-upscaler.safetensors (symlink→超分)"
echo ""
echo "  comfyui/text_encoders/ 下的 GGUF/旧版："
[ -f "/data/models/comfyui/text_encoders/gemma-3-12b-it-qat-UD-Q4_K_XL.gguf" ] && echo "    - text_encoders/gemma-3-12b-it-qat-UD-Q4_K_XL.gguf (3.8G)"
[ -L "/data/models/comfyui/text_encoders/gemma-3-12b-it.safetensors" ] && echo "    - text_encoders/gemma_3_12B_it.safetensors (symlink→fp8, 冗余)"
echo ""
echo "  comfyui/loras/ 下的动态 LoRA："
[ -f "/data/models/comfyui/loras/ltxv/ltx2/ltx-2.3-22b-distilled-1.1_lora-dynamic_fro09_avg_rank_111_bf16.safetensors" ] && echo "    - loras/ltxv/ltx2/...fro09... (2.6G, 非384版)"
echo ""
echo "  comfyui/checkpoints/ltxvideo/v2/ symlink："
[ -L "/data/models/comfyui/checkpoints/ltxvideo/v2/ltx-2.3-22b-distilled-1.1_transformer_only_mxfp8_block32.safetensors" ] && echo "    - checkpoints/ltxvideo/v2/... (symlink→已移走的ltx-mxfp8，已失效)"
echo ""
echo "  comfyui/clip/ 下的 LTX 0.9.x 旧版："
[ -L "/data/models/comfyui/clip/ltx_text_encoder" ] && echo "    - clip/ltx_text_encoder (symlink→旧版)"
[ -L "/data/models/comfyui/clip/ltx_tokenizer" ] && echo "    - clip/ltx_tokenizer (symlink→旧版)"

echo ""
echo "========================================="
echo " 上述 comfyui/ 内文件可手动执行以下命令清理："
echo "========================================="
echo ""
echo "  # 移走 comfyui/ 内无用文件"
echo "  mkdir -p $TRASH_DIR/comfyui-unet $TRASH_DIR/comfyui-checkpoints $TRASH_DIR/comfyui-te $TRASH_DIR/comfyui-loras $TRASH_DIR/comfyui-clip"
echo ""
echo '  # unet 下的 GGUF (~37G)'
echo '  mv /data/models/comfyui/unet/ltx-2.3-22b-dev-Q4_K_M.gguf $TRASH_DIR/comfyui-unet/'
echo '  mv /data/models/comfyui/unet/ltx-2.3-22b-distilled-1.1-Q4_K_M.gguf $TRASH_DIR/comfyui-unet/'
echo '  mv /data/models/comfyui/unet/LTX-2.3-22B-distilled-1.1-Q4_K_M.gguf $TRASH_DIR/comfyui-unet/'
echo '  rm /data/models/comfyui/unet/ltx-2.3-22b-distilled-fp8.safetensors  # broken symlink'
echo '  rm /data/models/comfyui/unet/ltxv-13b-0.9.8-distilled.safetensors   # old 0.9.x'
echo '  rm /data/models/comfyui/unet/LTX-2.3-22B-distilled-1.1-Q5_K_M.gguf  # GGUF symlink'
echo '  rm /data/models/comfyui/unet/LTX-2.3-22B-distilled-1.1-Q6_K.gguf    # GGUF symlink'
echo ""
echo '  # checkpoints 旧版'
echo '  mv /data/models/comfyui/checkpoints/ltx-2.3-22b-dev-nvfp4.safetensors $TRASH_DIR/comfyui-checkpoints/ 2>/dev/null'
echo '  rm /data/models/comfyui/checkpoints/ltx-2.3-spatial-upscaler.safetensors  # broken symlink'
echo ""
echo '  # text_encoders GGUF'
echo '  mv /data/models/comfyui/text_encoders/gemma-3-12b-it-qat-UD-Q4_K_XL.gguf $TRASH_DIR/comfyui-te/'
echo '  rm /data/models/comfyui/text_encoders/gemma_3_12B_it.safetensors  # redundant symlink'
echo ""
echo '  # loras 动态 LoRA'
echo '  mv /data/models/comfyui/loras/ltxv/ltx2/ltx-2.3-22b-distilled-1.1_lora-dynamic_fro09_avg_rank_111_bf16.safetensors $TRASH_DIR/comfyui-loras/'
echo ""
echo '  # clip 旧版'
echo '  rm /data/models/comfyui/clip/ltx_text_encoder  # old 0.9.x symlink'
echo '  rm /data/models/comfyui/clip/ltx_tokenizer       # old 0.9.x symlink'
echo ""
echo '  # 失效的 ltxvideo v2 symlink'
echo '  rm /data/models/comfyui/checkpoints/ltxvideo/v2/ltx-2.3-22b-distilled-1.1_transformer_only_mxfp8_block32.safetensors'

echo ""
echo "========================================="
echo " ✅ Part 1 自动清理完成"
echo " 回收站: $TRASH_DIR"
echo ""
echo " 确认工作流正常后再执行："
echo "   rm -rf $TRASH_DIR"
echo "========================================="
