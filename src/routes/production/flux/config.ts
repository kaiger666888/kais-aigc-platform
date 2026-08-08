/**
 * Flux Dev FP8 场景一致性配置
 *
 * 容器: comfyui-flux (comfyui-worker:pytorch251-v6-gcc, PyTorch 2.5.1+cu121)
 * 模型: Flux.1-dev FP8 + film-storyboard LoRA + IPAdapter (style lock)
 */

export const FLUX_CONFIG = {
  comfyuiUrl: process.env.FLUX_COMFYUI_URL || "http://localhost:8188",
  containerName: process.env.FLUX_CONTAINER_NAME || "comfyui-primary",
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

  // Flux Kontext Dev FP8
  kontextModelName: "flux1-kontext-dev-fp8.safetensors",
  kontextDefaults: {
    steps: 28,
    guidance: 3.5,
    defaultWidth: 1024,
    defaultHeight: 1024, // Kontext 更适合正方形
  },

  // INT8 ConvRot 配置（对应 ComfyUI-INT8-Fast-Fork 的 INT8ModelAdapter 节点）
  // 字段名与节点的 required INPUT_TYPES 一一对应（已通过容器内源码核验）
  int8Config: {
    // INT8 路径必须加载原生 bf16 模型（非 fp8）+ default dtype。
    // 原因：若加载 fp8 模型，INT8 ConvRot 反量化 kernel 会以 fp8e4nv 为目标 dtype，
    // 而 Ampere(RTX 3090) 不支持 fp8e4nv（Triton 仅支持 fp8e4b15/fp8e5），采样阶段报
    // "type fp8e4nv not supported in this architecture"。
    // bf16 源模型 → INT8 ConvRot（Ampere 原生 INT8 Tensor Core）才是正确链路。
    unetName: "flux1-dev.safetensors",
    unetWeightDtype: "default",
    // ConvRot 量化模式：先做 Hadamard 旋转消除异常值再量化，质量最好。
    // 等价于旧文档里的 outlierMethod:"convrot"；节点改用 quantization_mode 表达。
    quantizationMode: "int8_convrot",
    modelType: "auto", // 自动识别架构（flux 等），跳过不适配/质量敏感层
    enableQuantization: "as_needed", // 转换 FP8/浮点输入（FLUX FP8 模型会被转换）
    runtimeBackend: "torch_int_mm", // 非 ConvRot 层的后端；ConvRot 层固定走 fused runtime
    bakeLoadedLoras: true, // 把 LoRA 在 float 空间合并后再量化（须在 INT8 之前加载 LoRA）
    // 以下为 INT8ModelAdapter 的其余 required widget 输入（显式给出，避免依赖 ComfyUI 默认值）
    int4MixedRatio: 0.0, // 仅 int4_mixed 生效，int8 模式下无影响
    smallBatchFallback: "only_small_layers", // 小 batch 回退 fp16/bf16，限小层（默认）
    prepackWeights: false, // 实验性权重预打包，仅 Triton 层受益
    logProgress: true, // 控制台打印量化进度与层计数
  },
};

/**
 * FLUX.2-dev 配置（平行于 FLUX.1，不替换）
 *
 * FLUX.2 是全新架构（comfy/supported_models.py class Flux2，shift=2.02），与 FLUX.1 关键差异：
 *   - 文本编码器：单文件 CLIPLoader(mistral_3_small_flux2) type="flux2"，非 DualCLIP(T5XXL+CLIP-L)
 *   - VAE：flux2-vae（独立 VAE，非 flux1-dev-ae）
 *   - 采样链：EmptyFlux2LatentImage + Flux2Scheduler（shift 内置于 Flux2 模型类，无 ModelSamplingFlux）
 *   - 无 LoRA / 无 IPAdapter（FLUX.2 暂不支持）
 *   - guidance-distilled：BasicGuider 单条件（无负向提示词）
 *
 * 模型已就位于容器 comfyui-primary 的 /root/ComfyUI/models/（object_info 已识别全部文件名）。
 */
export const FLUX2_DEFAULTS = {
  // 模型文件名（容器 /root/ComfyUI/models/{diffusion_models,text_encoders,vae}/）
  // flux2_dev_fp8mixed 是 FLUX.2 dev 唯一可用权重（fp8 混合精度，无 bf16 源模型）。
  unetName: "flux2_dev_fp8mixed.safetensors",
  unetWeightDtype: "default",
  // FLUX.2 单文件 CLIP loader（非 DualCLIP）：mistral_3_small 文本编码器
  clipName: "mistral_3_small_flux2_fp8.safetensors",
  clipType: "flux2",
  // 17GB 编码器卸载到 CPU（34G DiT + 17G 编码器无法同时驻留 24G VRAM）
  clipDevice: "cpu",
  vaeName: "flux2-vae.safetensors",

  // 采样默认参数（FLUX.2 模型类 shift=2.02，由 Flux2Scheduler 内部计算）
  samplerName: "euler",
  scheduler: "simple",
  steps: 24,
  guidance: 3.5,
  denoise: 1.0,

  // 默认分辨率（正方形）
  defaultWidth: 1024,
  defaultHeight: 1024,

  // INT8 ConvRot 配置（与 FLUX.1 相同的 INT8ModelAdapter 节点路径）
  // 字段名与节点的 required INPUT_TYPES 一一对应（object_info 核验）。
  // 注意：flux2_dev_fp8mixed 是 fp8 混合源；Ampere(RTX 3090) 上 INT8 反量化 kernel
  // 若以 fp8e4nv 为目标 dtype 会报错（见 FLUX.1 的同类坑）——能否采样取决于运行时，
  // 此处按 spec 提供 int8 路径，实测结果见 README/任务报告。
  int8Config: {
    unetName: "flux2_dev_fp8mixed.safetensors",
    unetWeightDtype: "default",
    quantizationMode: "int8_convrot", // 先 Hadamard 旋转消异常值再量化（质量最佳）
    modelType: "auto", // 自动识别架构
    enableQuantization: "always", // FLUX.2 源即 fp8mixed，始终转换浮点输入
    runtimeBackend: "torch_int_mm", // 非 ConvRot 层后端；ConvRot 层固定走 fused runtime
    bakeLoadedLoras: true, // 无 LoRA，字段保留以对齐节点契约
    int4MixedRatio: 0.0, // 仅 int4_mixed 生效
    smallBatchFallback: "only_small_layers", // 小 batch 回退 fp16/bf16
    prepackWeights: false, // 实验性权重预打包
    logProgress: true, // 控制台打印量化进度
  },
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

  /** Flux Kontext Dev（参考图角色一致性，最佳效果） */
  KONTEXT = "kontext",
}

/**
 * 量化模式
 *
 * RTX 3090 (Ampere) 无原生 FP8 Tensor Core，FP8 会 fallback 到 BF16 模拟；
 * 而 INT8 ConvRot 走 Ampere 原生 INT8 Tensor Core，比 FP8 快约 1.5-1.7x。
 * 转换通过 ComfyUI-INT8-Fast-Fork 的 INT8ModelAdapter 节点在内存中实时完成
 * （同时保留原始 + INT8 两份，主机 128GB 内存充足；首次转换有数秒旋转开销）。
 */
export enum QuantizationMode {
  /** FP8 E4M3（现有默认，Ampere 上会 fallback 到 BF16 模拟） */
  FP8 = "fp8",
  /** INT8 ConvRot（Ampere 原生 INT8 Tensor Core，比 FP8 快 1.5-1.7x） */
  INT8 = "int8",
}
