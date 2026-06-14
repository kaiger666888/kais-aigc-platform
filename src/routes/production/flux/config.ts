/**
 * Flux Dev FP8 场景一致性配置
 *
 * 容器: comfyui-flux (comfyui-worker:pytorch251-v6-gcc, PyTorch 2.5.1+cu121)
 * 模型: Flux.1-dev FP8 + film-storyboard LoRA + IPAdapter (style lock)
 */

export const FLUX_CONFIG = {
  comfyuiUrl: process.env.FLUX_COMFYUI_URL || "http://localhost:8188",
  containerName: process.env.FLUX_CONTAINER_NAME || "comfyui-flux",
  outputDir: process.env.FLUX_OUTPUT_DIR || "/mnt/agents/output",
  pollIntervalMs: 2000,
  pollTimeoutMs: 300_000, // 5 min (Flux 图像生成通常 < 2 min)
};

export const FLUX_DEFAULTS = {
  // 模型文件名（在 comfyui-flux 容器的 models/ 目录中）
  unetName: "flux1-dev-fp8.safetensors",
  unetWeightDtype: "fp8_e4m3fn",
  clipName1: "t5xxl_fp16.safetensors",
  clipName2: "clip_l.safetensors",
  clipType: "flux",
  vaeName: "flux1-dev-ae.safetensors",

  // film-storyboard LoRA（In-Context LoRA，角色+场景一致性）
  storyboardLoraName: "film-storyboard.safetensors",
  storyboardLoraStrength: 1.0,

  // 采样默认参数
  samplerName: "euler",
  scheduler: "simple",
  steps: 20,
  guidance: 3.5,
  denoise: 1.0,

  // ModelSamplingFlux 默认参数
  shift: 1.15,
  maxShift: 0.5,
  baseShift: 0.5,

  // 默认分辨率（16:9）
  defaultWidth: 1024,
  defaultHeight: 576,
};

/**
 * 场景一致性模式
 */
export enum ConsistencyMode {
  /** 仅用 film-storyboard LoRA（角色一致性 + 场景风格统一） */
  STORYBOARD_LORA = "storyboard_lora",

  /** 仅用 IPAdapter style lock（风格一致性，无角色锁） */
  IPADAPTER_STYLE = "ipadapter_style",

  /** LoRA + IPAdapter 组合（最强一致性） */
  COMBINED = "combined",

  /** 纯 Flux 无 LoRA（最高多样性，无一致性保证） */
  NONE = "none",
}

// NOTE: exported as route handler (no-op) because auto-router scans all .ts in routes/
// NOTE: 不导出 default，避免被 router 注册为空 middleware 阻塞后续路由
