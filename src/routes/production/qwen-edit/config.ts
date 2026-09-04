/**
 * Qwen-Image-Edit-2511 (GGUF) — 指令式图像编辑配置
 *
 * 容器: comfyui-primary (与 FLUX.1/Kontext/FLUX.2 共用同一 ComfyUI 实例)
 * 模型: Qwen-Image-Edit-2511 Q4_K_M GGUF + Qwen2.5-VL 7B 文本编码器
 *       + qwen_image_vae + Lightning 4-step 蒸馏 LoRA
 *
 * 工作流已于 2026-09-04 端到端实测验证 (4/4 编辑成功) — 节点接线勿改。
 */

export const QWEN_EDIT_CONFIG = {
  comfyuiUrl: process.env.QWEN_EDIT_COMFYUI_URL || "http://localhost:8188",
  containerName: process.env.QWEN_EDIT_CONTAINER_NAME || "comfyui-primary",
  pollIntervalMs: 2000,
  pollTimeoutMs: 600_000, // 首次调用含模型冷加载 ~40-60s
};

export const QWEN_EDIT_DEFAULTS = {
  // 模型文件名（容器 /root/ComfyUI/models/{diffusion_models,text_encoders,vae,loras}/）
  unetName: "qwen_image_edit_2511_Q4_KM.gguf", // GGUF 量化 transformer
  clipName: "qwen_2.5_vl_7b_fp8_scaled.safetensors", // Qwen2.5-VL 7B 文本编码器
  vaeName: "qwen_image_vae.safetensors",
  loraName: "qwen_image_edit_2511_lightning_4steps_bf16.safetensors",
  loraStrength: 1.0,

  // 采样默认参数（Lightning 蒸馏 4 步 → cfg 必须为 1.0，调高会过曝/崩坏）
  steps: 4,
  cfg: 1.0,
  samplerName: "euler",
  scheduler: "simple",
  denoise: 1.0,

  // 输入图统一缩放到 1.0 百万像素（ImageScaleToTotalPixels）
  megapixels: 1.0,
};
