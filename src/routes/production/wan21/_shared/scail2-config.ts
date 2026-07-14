export const SCAIL2_CONFIG = {
  comfyuiUrl: process.env.SCAIL2_COMFYUI_URL || process.env.COMFYUI_URL || "http://localhost:8188",
  containerName: process.env.SCAIL2_CONTAINER_NAME || process.env.WAN22_CONTAINER_NAME || "comfyui-primary",
  outputDir: process.env.OUTPUT_DIR || "/mnt/agents/output/gpu1",
  comfyuiInputDir: "/root/ComfyUI/input",
  comfyuiOutputDir: "/root/ComfyUI/output",
  pollIntervalMs: 2000,
  pollTimeoutMs: 600_000,
};

export const SCAIL2_DEFAULTS = {
  // 主模型: Wan2.1 14B SCAIL2 (diffusion_models)
  scailModel: "wan2.1_14B_SCAIL_2_fp8_scaled.safetensors",
  // 加速 LoRA: lightx2v (loras/wan2.2), strength=1.1
  lightx2vLora: "wan2.2/lightx2v_I2V_14B_480p_cfg_step_distill_rank64_bf16.safetensors",
  lightx2vStrength: 1.1,
  // 重光 LoRA: WanAnimate Relight — TODO: 需要下载或去掉
  relightLora: "",  // empty = skip relight LoRA
  relightStrength: 0.5,
  // SAM3.1 模型 (checkpoints) - 当前核心 WanSCAILToVideo 不需要 mask 分割
  samModel: "sam3.1_multiplex_fp16.safetensors",
  // 文本编码器 (text_encoders)
  textEncoder: "umt5_xxl_fp8_e4m3fn_scaled.safetensors",
  textEncoderType: "wan",
  // CLIP Vision 模型 (clip_vision)
  clipVision: "clip_vision_h.safetensors",
  // VAE 模型 (vae)
  vae: "wan_2.1_vae.safetensors",
  // 采样器参数
  samplerName: "dpmpp_2m",
  scheduler: "simple",
  steps: 8,
  shift: 5.0,
  // 视频参数
  width: 512,
  height: 512,
  pass2Height: 896,
  numFrames: 81,
  fps: 24,
  crf: 19,
  // 负面提示词
  negativePrompt: "bad video",
};
