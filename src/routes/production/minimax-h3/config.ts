// MiniMax H3 视频生成引擎配置常量
// 参照 ltx/config.ts 模式。H3 已在 comfyui-primary (port 8188) 验证通过,模型文件已就位。
//
// 参数来源:MiniMax H3 官方文档(HuggingFace README、Prompt Writing Guide)、
// ComfyUI 源码 nodes_minimax_h3.py、官方 ComfyUI 工作流模板、SGLang cookbook。
//
// 参数分三类:
//   1. H3_CONSTANTS            —— 固化常量(官方源码硬编码,不可变更)
//   2. H3_DEFAULTS             —— 默认参数(可被 API 入参覆盖)
//   3. H3_RESOLUTION_TABLE /   —— 预设查找表(分辨率 / 时长)
//      H3_DURATION_TABLE

// ============================================================
// H3_CONFIG —— 运行时连接配置(环境变量可覆盖)
// ============================================================
export const H3_CONFIG = {
  comfyuiUrl: process.env.COMFYUI_URL || "http://localhost:8188",
  containerName: "comfyui-primary",
  outputDir: process.env.OUTPUT_DIR || "/mnt/agents/output",
  comfyuiInputDir: "/root/ComfyUI/input",
  comfyuiOutputDir: "/root/ComfyUI/output",
  pollIntervalMs: 2000,
  pollTimeoutMs: 900_000, // 15 min (H3 单次约 10-15 分钟)
};

// 模型文件名常量(避免在 H3_DEFAULTS 内重复字面量)
// T8 统一: fl2va_int8_convrot 非剪枝版 (34GB) 支持所有 task_type (t2va/i2va/fl2va/ref2va/hybrid)。
// ref2va 不再需要单独权重 —— pruned ref2va int8 无法完整应用 Turbo LoRA (见 T8 插件 README),
// 故 REF2VA_MODEL 保留为向后兼容别名, 指向同一 fl2va 文件。
const FL2VA_MODEL = "minimax_h3_fl2va_int8_convrot.safetensors";
const REF2VA_MODEL = FL2VA_MODEL;

// ============================================================
// H3_CONSTANTS —— 固化常量(官方源码 nodes_minimax_h3.py 硬编码)
// ============================================================
// ⚠️ 这些值来自官方源码/文档,任何修改都会破坏模型一致性,严禁变更。
export const H3_CONSTANTS = {
  CANVAS_MULTIPLE: 32,        // 宽高必须为 32 的倍数
  BASE_SHORT_EDGE: 768,       // 短边基准(适配画布)
  MAX_PIXELS: 768 * 1344,     // 最大面积 = 1,032,192
  FPS: 24,                    // 帧率固定 24fps
  AUDIO_SAMPLE_RATE: 32000,   // 音频采样率 32kHz
  AUDIO_LATENT_FPS: 40,       // 音频 latent 帧率
  REF_IMAGE_SHORT_EDGE: 2048, // ref_image_size="max" 时参考图短边
  // 帧数网格: n % 17 == 5
  FRAME_GRID: 17,
  FRAME_OFFSET: 5,
  // 训练范围(帧数 / 时长上下限)
  MIN_FRAMES: 5,     // ~0.2s
  MAX_FRAMES: 362,   // ~15s(训练范围上限)
  MIN_DURATION: 4,   // 秒
  MAX_DURATION: 15,  // 秒
  // 参考资产数量上限
  MAX_REF_IMAGES: 9,
  MAX_REF_VIDEOS: 3,
  MAX_REF_AUDIOS: 3,
  MAX_REF_FILES_TOTAL: 12,
  // CFG-distilled:cfg 必须 1.0
  CFG: 1.0,
} as const;

// ============================================================
// H3_DEFAULTS —— 默认参数(可被 API 入参覆盖)
// ============================================================
export const H3_DEFAULTS = {
  // 模型文件(FL2VA 用于 t2va/i2va;REF2VA 用于 ref2va)
  fl2vaModel: FL2VA_MODEL,
  ref2vaModel: REF2VA_MODEL,
  clipName: "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors",
  videoVaeName: "minimax_h3_video_vae_fp16.safetensors",
  audioVaeName: "minimax_h3_audio_vae_fp32.safetensors",

  // T8 Dual-Clock 采样参数(MiniMaxH3DualClockSamplerT8 内置 Dual-Clock Euler,
  // 修复原生 KSampler 低步数音频白噪声 bug;比原生更高效 —— 官方 50 步 T8 实测 15 步已清晰)
  // 预览档: 15 步; 生产档: 50 步 (或 Turbo 4 步, 见 H3_TURBO)
  t2vSteps: 15,              // T8 实测 15 步已足够 (旧原生 KSampler 需 50 步)
  // sampler/scheduler 在 T8 下不再使用 (Dual-Clock 内置 flow sigma 网格,不接外部 scheduler);
  // 保留常量仅为向后兼容别名, 实际不被工作流引用。
  t2vSamplerName: "euler",
  t2vScheduler: "simple",

  // R2V: T8 统一为 15 步 (旧原生 res_multistep 需 20 步)
  r2vSteps: 15,
  r2vSamplerName: "res_multistep",  // T8 下不再使用, 保留向后兼容
  r2vScheduler: "simple",

  // shift(官方硬推荐,允许 API 覆盖但不建议变更)
  shiftVideo: 12.0,          // ⚠️ 不建议变更
  shiftAudio: 3.0,           // ⚠️ 不建议变更

  // 输出
  fps: 24,
  codec: "vp9",
  crf: 20.0,
  denoise: 1.0,

  // 分辨率默认(16:9 横屏)
  defaultWidth: 1344,
  defaultHeight: 768,

  // 帧数默认(n % 17 == 5 网格,~5s)
  defaultLength: 124,

  // ── 过渡期向后兼容别名(t2va.ts / ref2va.ts 迁移完成后删除) ──
  // 旧代码直接读 H3_DEFAULTS.modelName / steps / samplerName / scheduler / cfg,
  // 在新结构(fl2vaModel / t2v* / r2v* / H3_CONSTANTS.CFG)被消费者全部接入前保留。
  modelName: FL2VA_MODEL,
  steps: 15,
  samplerName: "euler",
  scheduler: "simple",
  cfg: H3_CONSTANTS.CFG,
} as const;

// ============================================================================
// H3 Token 预算 (2026-08-14 RTX 3090 三轮 9 次压力测试实测)
// 崩溃由 token 总数 (width × height × length) 决定, 不是单帧分辨率。
// 374M tokens (1344×768×362f) 时 comfy_kitchen CUDA/triton 双后端均崩溃
// (illegal memory access @ Model Initializing, 进程 abort)。
// 崩溃与是否 OOM 无关 (VRAM 23GB 未满也崩), 是 comfy_kitchen 量化算子
// 在高 token 数下的越界 bug。
// ============================================================================
export const H3_TOKEN_BUDGET_SAFE = 300_000_000;   // 安全线 (生产建议)
export const H3_TOKEN_BUDGET_CRASH = 340_000_000;  // 实测崩溃线 (326M✅/374M❌)

/** 实测成功边界样本 (tokens → 配置), 用于文档与自动降档参考 */
export const H3_TOKEN_FRONTIER: Array<{ w: number; h: number; f: number; tokens: number; ok: boolean; seconds: number }> = [
  { w: 1600, h: 896, f: 124, tokens: 177_766_400, ok: true,  seconds: 441 }, // 最高分辨率纪录
  { w: 1472, h: 832, f: 124, tokens: 151_863_296, ok: true,  seconds: 313 },
  { w: 1472, h: 832, f: 175, tokens: 214_323_200, ok: true,  seconds: 498 },
  { w: 1344, h: 768, f: 175, tokens: 180_633_600, ok: true,  seconds: 370 },
  { w: 1344, h: 768, f: 243, tokens: 250_822_656, ok: true,  seconds: 514 },
  { w: 1344, h: 768, f: 311, tokens: 321_011_712, ok: true,  seconds: 786 }, // 1344×768 时长上限 (13s)
  { w: 1280, h: 704, f: 362, tokens: 326_205_440, ok: true,  seconds: 838 }, // 满 15s 最高分辨率
  { w: 1216, h: 672, f: 362, tokens: 295_809_024, ok: true,  seconds: 625 },
  { w: 1344, h: 768, f: 362, tokens: 373_653_504, ok: false, seconds: 0 },   // ❌ 双后端崩溃
];

export type H3TokenBudgetLevel = "ok" | "warn" | "reject";

/**
 * token 预算校验。返回 { tokens, level: "ok" | "warn" | "reject", message }。
 * - ok:     ≤300M 安全线内
 * - warn:   300M~340M 之间 (1280×704×362f=326M 实测可过, 但接近崩溃线)
 * - reject: >340M (实测 374M 双后端崩溃, 拒绝提交)
 */
export function checkH3TokenBudget(
  width: number,
  height: number,
  length: number,
): { tokens: number; level: H3TokenBudgetLevel; message: string } {
  const tokens = width * height * length;
  if (tokens <= H3_TOKEN_BUDGET_SAFE) {
    return { tokens, level: "ok", message: "" };
  }
  if (tokens <= H3_TOKEN_BUDGET_CRASH) {
    return {
      tokens,
      level: "warn",
      message: `token budget ${tokens.toLocaleString()} between safe(300M) and crash(340M) line — 实测 326M (1280×704×362f) 可过但接近崩溃线, 建议降档`,
    };
  }
  return {
    tokens,
    level: "reject",
    message: `token budget ${tokens.toLocaleString()} exceeds crash line 340M — 实测 374M (1344×768×362f) 双后端崩溃 (illegal memory access)。满 15s 请用 ≤1280×704`,
  };
}

// ============================================================
// 帧数对齐(保留不变)
// ============================================================
// H3 帧数必须满足 n % 17 == 5。
export function alignH3FrameCount(n: number): number {
  while (n % 17 !== 5) n++;
  return n;
}

// ============================================================
// H3_TESPEED —— TESpeed 残差缓存加速配置 (全局 patch)
// ============================================================
// TESpeedMiniMaxH3 (ComfyUI-TE-Speed-MiniMaxH3-OSS) 通过 patch_model.py 向 ComfyUI 的
// MiniMax H3 model.py 注入 ("block_loop", 0) 钩子, 缓存尾部 75% transformer blocks 的
// 残差 —— 这是全局 patch, 不需要在每个工作流里插入 TESpeed 节点。
//
// T8 工作流里 MiniMaxH3DualClockSamplerT8 调用的是同一底层 model, 故 TESpeed 钩子
// 仍然生效 (实测 50 步从 20m40s → 12m01s, -42%)。
// ⚠️ 因此 T8 工作流不再插入 TESpeed 节点 (旧原生链路在 SigmaShift(21)→KSampler(30) 间
//    插 TESpeed(35); T8 无 SigmaShift/KSampler)。enabled=true 仅表示全局 patch 已就位。
//
// ⚠️ 前置条件（已在 comfyui-primary 容器完成）：
//   1. custom_nodes/ComfyUI-TE-Speed-MiniMaxH3-OSS 已安装
//   2. patch_model.py 已执行（model.py 注入 ("block_loop", 0) 钩子）
//   未满足时 model 用 stock speed 运行, 不报错。
export const H3_TESPEED = {
  // 2026-08-26: ComfyUI-TE-Speed-MiniMaxH3-OSS 已从 comfyui-primary 容器移除
  // (model.py 无 block_loop 钩子), 节点类 TESpeedMiniMaxH3 已不存在; 置 false 防止 native 链路注入不存在节点导致 400。
  enabled: false,         // 全局 patch 开关 (T8 工作流不再插入节点, 仅作就位标记)
  classType: "TESpeedMiniMaxH3",
  nodeId: "35",           // 历史: 旧原生链路插入节点 ID (T8 不再使用)
  // 参数（与基准测试一致，参考插件 README 默认值；T8 下仅作记录）
  processingControlValue: 0.12,  // sigma 差阈值：低于此值允许缓存步
  processingPercent1: 0.1,       // 缓存窗口起点：前 10% 步始终完整计算
  processingPercent2: 0.9,       // 缓存窗口终点：后 10% 步始终完整计算
  mcs: 2,                        // 最多连续缓存步数，防误差累积
  device: "auto",                // 缓存残差存放：auto/gpu 留设备，cpu 省显存
  cacheDepth: 0.75,              // 缓存尾部块占比：0.75 ≈ 45% 提速，调低更稳
} as const;

// ============================================================
// H3_T8 —— T8 插件 (comfyui-minimax-h3-audio-T8) 工作流常量
// ============================================================
// T8 插件在 comfyui-primary 容器注册 14 个节点。核心三节点替代原生链路:
//   MiniMaxH3AudioConditioningT8 —— 统一条件节点 (替代 ImageToVideo + ReferenceToVideo),
//                                     一个节点覆盖 t2va/i2va/fl2va/l2va/ref2va/hybrid
//   MiniMaxH3DualClockSamplerT8  —— Dual-Clock 采样器配置 (内置 12/3 shift + flow sigma 网格
//                                     + 双时钟 Euler; 修复原生 KSampler 低步数音频白噪声 bug;
//                                     代替 SigmaShift + KSamplerSelect + scheduler)
//   MiniMaxH3AVDecodeT8          —— 联合 AV latent 解码 (输出 IMAGE + AUDIO, 一次解码)
//
// ⚠️ T8 采样链路 (经 ComfyUI /prompt 校验 + 插件 examples/dual_clock_4step_api.json 确认):
//   DualClockSamplerT8 输出 (MODEL, SAMPLER, SIGMAS) 三元组, 不是 LATENT。
//   需配 RandomNoise + BasicGuider + SamplerCustomAdvanced 才完成采样产出 LATENT:
//     Conditioning[1]=LATENT ──┬─► DualClockSamplerT8.av_latent
//                              └─► SamplerCustomAdvanced.latent_image
//     DualClockSampler[0]=MODEL ─► BasicGuider.model
//     Conditioning[0]=COND    ──► BasicGuider.conditioning
//     RandomNoise[0]=NOISE    ─► SamplerCustomAdvanced.noise  (noise_seed 接 API seed)
//     BasicGuider[0]=GUIDER   ─► SamplerCustomAdvanced.guider
//     DualClock[1]=SAMPLER    ─► SamplerCustomAdvanced.sampler
//     DualClock[2]=SIGMAS     ─► SamplerCustomAdvanced.sigmas
//     SamplerCustomAdvanced[0]=LATENT ─► AVDecodeT8.av_latent
//     AVDecodeT8[0]=IMAGE / [1]=AUDIO ─► CreateVideo → SaveVideo
//
// 这里的常量是已验证工作流的固定/默认输入值 (见 task gsd-task-h3-t8-integration)。
export const H3_T8 = {
  // ── MiniMaxH3AudioConditioningT8 默认输入 ──
  taskType: "auto",                    // 自动判定 t2va/i2va/fl2va/ref2va/hybrid (按连接的可选输入)
  audioMode: "native",                 // native=从零生成目标音频 (本管线不接 drive_audio)
  audioDenoiseStrength: 0.35,          // 音频去噪强度 (native 模式下不生效, 保留兼容)
  addSourceAsReference: false,         // 源音频是否同时作为参考 (无 drive_audio 故 false)
  promptPrimaryAudioOrdinal: 0,        // 0=禁用 (无驱动音频源; 否则指定主音频序号 1-9)
  strictPromptTags: true,              // 严格解析 prompt 多模态 <Picture N>/<Audio N> 标签
  referenceVideoPolicy: "official_2_to_15s", // 参考视频时长策略
} as const;

// ============================================================
// H3_TURBO —— T8 + Turbo LoRA 动态加速配置 (motion-adaptive)
// ============================================================
// Turbo LoRA (ComfyUI 格式, 容器内 minimax_h3_turbo_4step_*_comfyui.safetensors) 已就位。
// 在 UNETLoader(12) 与 DualClockSamplerT8(30) 之间插入 LoraLoaderBypassModelOnly,
// steps 按动态级别 4~8 步 (vs 标准 15 步 / 生产 50 步), 实测 4 步 ~3.1x 加速。
//
// ⚠️ INT8/量化模型必须用 LoraLoader*Bypass* 而非普通合并型 (T8 README: 不要假设等价)。
// ⚠️ Turbo 需非剪枝 fl2va 模型 —— pruned 模型无法完整应用 Turbo LoRA。
//
// 默认关闭 —— API 参数 turbo=true 或 profile="turbo" 时启用。
// 步数由 motion 参数决定 (low/medium=4, high=8), 见 getTurboSteps()。
export const H3_TURBO = {
  enabled: false,             // 默认关闭
  loraName: "minimax_h3_turbo_4step_original_comfyui.safetensors",
  loraNameEma: "minimax_h3_turbo_4step_ema_original_comfyui.safetensors",
  useEma: true,               // EMA 版画质略好 (作者推荐)
  strengthModel: 1.0,         // 必须 1.0
  nodeId: "14_lora",          // LoraLoaderBypassModelOnly 节点 ID
  loaderClassType: "LoraLoaderBypassModelOnly", // INT8 模型用 bypass (非合并)
  // 动态分级步数策略 (2026-08-08 实测: 高动态4步画面崩坏严重,8步显著改善)
  // 2026-08-17 分档调整: 中动态 4→8 步 (4 步中动态画面偏软); 高动态在 preview-lock
  // 路由下已跳拓扑到 native-sage 15 步 (见 H3_PREVIEW_MOTION_ROUTES), 此表仅服务
  // 显式 turbo=true 的直调 (thin routes / generate 平铺参数)。
  motionSteps: {
    low: 6,       // 站立/对白/慢速移动
    medium: 8,    // 拥抱/行走/轻微动作 (2026-08-17: 4→8)
    high: 8,      // 追逐/赛车/打斗/快速运动
  },
  defaultMotion: "medium" as const,
} as const;

export type H3MotionLevel = "low" | "medium" | "high";

/** 根据 motion 级别获取 turbo 步数 (未传 motion 时用 defaultMotion) */
export function getTurboSteps(motion?: string): number {
  const m = (motion || H3_TURBO.defaultMotion) as H3MotionLevel;
  return H3_TURBO.motionSteps[m] ?? H3_TURBO.motionSteps.medium;
}

// ============================================================
// H3_LIGHTX2V —— LightX2V Turbo LoRA v1.0 配置 (4步 / 8步 / 8步768p 三版本, 非 T8 / 非 Turbo)
// ============================================================
// LightX2V Turbo LoRA v1.0 正式版 (ComfyUI bf16 格式, 容器内):
//   - minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors (768p/1344×768 训练, 4步)
//   - minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors       (544p mixed 训练, 8步)
//   - minimax_h3_fl2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors  (768p/1344×768 训练, 8步, 2026-08-27 发布)
// 链路: UNETLoader(12) → SigmaShift(14_shift) → LoraLoaderModelOnly(15) → 采样链路。
//
// ⚠️ v1.0 正式版必须使用 SigmaShift (与 v0.1 预览版相反):
//   - v0.1 旧版不带 SigmaShift 导致极暗画面 —— 真因正是缺少 shift, 不是 shift 过大。
//   - v1.0 shift 值因版本而异 (官方 Minimax-H3-Turbo 规格):
//       4步正式版: shift_video=6  (768p 训练优化), 推荐 4 步, lora-alpha=128 (strength_model=1.0)
//       8步正式版: shift_video=12 (544p mixed 训练), 推荐 8 步 (亦可 4 步)
//       8步768p版: shift_video=6  (768p 训练, 非 544p 版的 12!), 推荐 8 步 (2026-08-27 发布)
//   - shift_audio 始终 3.0 (各版一致)。
//
// ⚠️ 关键区别 (与 native / T8 / Turbo):
//   1. 使用 SigmaShift —— shift_video 按 variant 取值 (4步=6, 8步544p=12, 8步768p=6)。
//   2. 不使用 T8 节点 (MiniMaxH3AudioConditioningT8 / DualClockSamplerT8 / AVDecodeT8)。
//   3. 不使用 T8 Turbo LoRA (用独立 LightX2V LoRA, strength=1.0)。
//   4. 用 SamplerCustomAdvanced + BasicScheduler(simple) + KSamplerSelect(res_multistep) + BasicGuider。
//
// 默认关闭 —— profile="lightx2v-4" / "lightx2v-8" / "lightx2v-8-768p" 时启用 (见 H3_PROFILES)。
// 旧的 v0.1 预览版权重文件保留在容器内, 未删除 (向后兼容)。
export const H3_LIGHTX2V_VARIANTS = {
  // 4步正式版: 768p 训练分辨率, shift_video=6, 4 步推理
  "lightx2v-4": {
    loraName: "minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors",
    strengthModel: 1.0,
    steps: 5,            // 官方 infer_steps=5 (4步去噪+1终步sigma=0)
    shiftVideo: 6.0,    // ⚠️ 4步正式版用 shift=6 (非 12!)
    shiftAudio: 3.0,
    samplerName: "euler",  // 官方 training_euler = FlowMatch Euler, ComfyUI 最近接是 euler
    scheduler: "simple",
    denoise: 1.0,
    nodeId: "15",                            // LoraLoaderModelOnly 节点 ID
    loaderClassType: "LoraLoaderModelOnly",  // 完整 bf16 权重用合并型 loader (非 INT8 bypass)
  },
  // 8步正式版: 544p 训练分辨率 (mixed aspect ratio), shift_video=12, 推荐 8 步 (亦可 4 步)
  "lightx2v-8": {
    loraName: "minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors",
    strengthModel: 1.0,   // alpha=8/rank=128=0.0625 是训练时的正确缩放, B@A已含全部幅度, 无需补偿
    steps: 9,             // 官方 8步推荐, +1终步sigma=0
    shiftVideo: 12.0,
    shiftAudio: 3.0,
    samplerName: "euler",   // 官方 training_euler = FlowMatch Euler
    scheduler: "simple",
    denoise: 1.0,
    nodeId: "15",
    loaderClassType: "LoraLoaderModelOnly",
  },
  // 8步 768p 正式版 (2026-08-27 发布): 768p (1344×768) 训练分辨率, shift_video=6 (非 544p 版的 12!), 推荐 8 步
  "lightx2v-8-768p": {
    loraName: "minimax_h3_fl2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors",
    strengthModel: 1.0,   // alpha=8/rank=128=0.0625 是训练时的正确缩放, B@A已含全部幅度, 无需补偿
    steps: 9,             // 官方 8步推荐, +1终步sigma=0 (同 lightx2v-8 惯例)
    shiftVideo: 6.0,      // ⚠️ 768p 版官方 shift=6 (544p 版才是 12)
    shiftAudio: 3.0,
    samplerName: "euler",   // 官方 training_euler = FlowMatch Euler
    scheduler: "simple",
    denoise: 1.0,
    nodeId: "15",
    loaderClassType: "LoraLoaderModelOnly",
  },
} as const;

// 向后兼容别名 (默认指向 4 步版; 字段超集兼容旧 H3_LIGHTX2V 消费者)
export const H3_LIGHTX2V = H3_LIGHTX2V_VARIANTS["lightx2v-4"];

export type H3LightX2VVariant = keyof typeof H3_LIGHTX2V_VARIANTS;

// ============================================================
// H3_LINEART_ANIME —— LineartAnime LoRA (DiffSynth-Studio) 配置
// ============================================================
// LineartAnime LoRA: 将线稿视频(line art)上色为彩色动漫视频。
// 基于 Ref2VA 模式训练, rank=32, 仅训练 attention + MLP 层 (qkv_proj/out_proj/fc1/fc2)。
// ComfyUI 格式: 已从 DiffSynth-Studio 格式转换 (添加 diffusion_model. 前缀, 跳过 pruned 不兼容的 adaln)。
//
// ⚠️ 仅兼容 ref2va 模式 (基于 Ref2VA 训练)。
// ⚠️ 使用标准 SigmaShift + KSampler 链路 (非 T8), 与 LightX2V 链路结构一致。
// ⚠️ strength_model=1.0 (rank=32, 无 alpha 补偿需求)。
// ⚠️ 需要配合 ref_video (线稿视频) 作为参考输入实现上色功能。
export const H3_LINEART_ANIME = {
  loraName: "minimax_h3_lineart_anime_ref2va_comfyui.safetensors",
  strengthModel: 1.0,
  steps: 20,              // DiffSynth-Studio 官方示例用 20 步
  shiftVideo: 12.0,       // 标准 H3 shift (非 Turbo, 不需要降低)
  shiftAudio: 3.0,
  samplerName: "euler",
  scheduler: "simple",
  denoise: 1.0,
  nodeId: "15",                            // LoraLoaderModelOnly 节点 ID (同 LightX2V)
  loaderClassType: "LoraLoaderModelOnly",  // 完整权重用合并型 loader
} as const;

// ============================================================
// H3_NATIVE —— 原生 (non-T8) 链路采样器/调度器配置
// ============================================================
// T8 迁移前的原生 KSampler + SigmaShift 链路配置 (pre-T8, commit c2ad955a~1)。
// 与 H3_DEFAULTS 的 t2v*/r2v* 字段并行 —— H3_DEFAULTS 现面向 T8 (steps=15, scheduler=simple),
// 而 H3_NATIVE 面向原生 KSampler 链路 (steps=50, scheduler=normal)。
// 通过 profile="native" 或 "native-sage" 选择 (见 H3_PROFILES; 两者区别仅在 tespeed 节点)。
// 注意: 原生链路用 res_multistep 做 R2V, T8 用统一的 Dual-Clock Euler。
export const H3_NATIVE = {
  // t2va/i2va/fl2va 原生采样参数 (官方 lossless 推荐)
  t2vSamplerName: "euler",
  t2vScheduler: "normal",
  t2vSteps: 50,
  // ref2va 原生采样参数 (官方 R2V 推荐)
  r2vSamplerName: "res_multistep",
  r2vScheduler: "normal",
  r2vSteps: 20,
} as const;

// ============================================================
// H3_SIGMA_INTERP —— 官方 ExtendIntermediateSigmas 低噪段加密 (2026-08-16 Kai 批准)
// ============================================================
// 根因: 15步 simple+shift12 的 σ≤0.65 低噪精修段只有 2 步, 末步 0.463→0 直接跳零,
// 高动态镜头末段噪点/边缘毛刺。插值后 15→17 步, 末段最大跳变减半 (0.463→0.231)。
// 实验记录: Case08 A/B/C 三组, B(插值)视觉胜出, 代价 +10% 时长。
// skill: h3-sigma-interpolation-extendintermediate
// ⚠ 仅 Native 链路可用 (KSampler→SamplerCustomAdvanced 改造)。T8 DualClock 自产
//   sigma 不可外挂; turbo/lightx2v LoRA 低步数训练不可用; production(T8) 不适用。
export const H3_SIGMA_INTERP = {
  enabled: true,            // 总开关 (false = 完全不注入, 行为与改动前一致)
  steps: 2,                 // 每对相邻 sigma 间插 steps-1 个中点 (2 = 插 1 个)
  startAtSigma: 0.65,       // 只加密 σ≤0.65 的低噪段
  endAtSigma: 0,
  spacing: "linear" as const,
} as const;

// 每条 Native 链路的插值节点 ID (不与现有节点冲突; ref2va 的 35 是 TESpeed 可选槽, 见下)
export const H3_SIGMA_INTERP_NODES = {
  generate: "36",   // generate.ts buildH3WorkflowNative
  ref2va: "36",     // ref2va.ts buildH3Ref2vaWorkflowNative (35 已被 TESpeed 占用)
  i2va: "36",       // i2va.ts buildH3I2vaWorkflowNative
  t2va: "36",       // t2va.ts buildH3T2vaWorkflowNative
} as const;

// ============================================================
// H3_BLOCK_CACHE —— MiniMaxH3BlockCacheT8 (block-cache 模型补丁) 配置 (2026-08-27)
// ============================================================
// ComfyUI 容器插件节点, 三工况实测 (静态对白镜 36步 -52.6% / 高动态15步 -28.7% /
// 高动态36步 -45.4%), 与 kitchen INT8 CUDA / SageAttention 共存无冲突。
//
// 注入拓扑 (唯一合法形状, 已实测): 在 native-sage 原生链路的 UNETLoader(12) 之后
// 串接, 原 [12,0] 的全部消费者 (SigmaShift 21 等) 改接 [BC,0]:
//   12: UNETLoader ──model──> 12_blockcache: MiniMaxH3BlockCacheT8 ──MODEL──> 21 (SigmaShift)
// ⚠️ 仅 Native 链路可用 (KSamplerSelect+BasicScheduler+SigmaShift+SamplerCustomAdvanced 那套)。
//   T8/DualClock 拓扑 (turbo profile) 未验证 —— 传 blockCache=on 直接忽略, 不报错。
//
// 默认关闭 —— API 参数 blockCache=on 开启 (灰度); threshold 可用 blockCacheThreshold 覆盖。
// verbose 硬编码 true (从 ComfyUI 日志核对命中率)。
export const H3_BLOCK_CACHE = {
  classType: "MiniMaxH3BlockCacheT8",
  nodeId: "12_blockcache",     // 紧跟 UNETLoader(12) 之后, 命名仿 14_lora/14_shift 槽位约定
  residualDiffThreshold: 0.4,  // 残差差阈值: 低于此值复用缓存块 (实测生产参数)
  startPercent: 0.08,          // 缓存窗口起点: 前 8% 步始终完整计算
  endPercent: 0.95,            // 缓存窗口终点: 后 5% 步始终完整计算
  maxConsecutiveHits: 2,       // 最多连续命中步数, 防误差累积
  cacheDevice: "cpu",          // 缓存块存放: cpu 省显存
  metricStride: 8,             // 残差度量采样步距
  verbose: true,               // 硬编码 true — ComfyUI 日志核对命中率
} as const;

/**
 * 解析 blockCache 开关 (multipart 字段值可能是任意字符串/布尔/数字)。
 * 仅 "on"/"true"/"1" (大小写不敏感) 视为开启; 其余值一律关闭 (不报错)。
 */
export function parseH3BlockCacheFlag(raw: unknown): boolean {
  const v = typeof raw === "string" ? raw.trim().toLowerCase() : raw;
  return v === "on" || v === "true" || v === "1" || v === 1 || v === true;
}

/**
 * 解析 blockCacheThreshold: 仅 [0,1] 合法浮点生效, 否则回落默认值并 WARN。
 * 返回实际生效的 residual_diff_threshold。
 */
export function resolveH3BlockCacheThreshold(raw: unknown): number {
  const v = typeof raw === "string" ? raw.trim() : raw;
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  const missing = v === undefined || v === null || v === "";
  if (!missing && Number.isFinite(n) && n >= 0 && n <= 1) {
    return n;
  }
  if (!missing) {
    console.warn(
      `[h3] invalid blockCacheThreshold "${String(raw)}" (must be a float in [0,1]) — ` +
      `falling back to default ${H3_BLOCK_CACHE.residualDiffThreshold}`,
    );
  }
  return H3_BLOCK_CACHE.residualDiffThreshold;
}

// ============================================================
// H3_PROFILES —— 质量/速度 profile 预设 (T8 + native + KMC 搭配方案)
// ============================================================
// 配合 KMC 管线的八种生成档位 (调用方也可改用 useCase 分用途入口, 见 H3_USE_CASES):
//   preview      —— 最快速但保证质量: T8 15 步 + TESpeed 全局 patch, 跳过 Foley
//                   (H3 原生音频直出), ~6 min/条
//   turbo        —— 极速: T8 4 步 + Turbo LoRA (~3.1x 加速), 跳过 Foley, ~3 min/条
//   production   —— 最高质量: T8 50 步 lossless + 完整 Foley 管线 (LTX+BGM检测+TTS混音), ~20 min/条
//   native       —— 原生 (non-T8) KSampler + SigmaShift + TESpeed 节点: t2v/i2va 50 步 / ref2va 20 步,
//                   不使用 T8 节点也不使用 Turbo LoRA。TESpeed 节点(35)额外缓存残差 (可能有质量损失)。
//   native-sage  —— 原生 (non-T8) KSampler + SigmaShift, 不插入 TESpeed 节点。
//                   ComfyUI 已全局启用 --use-sage-attention, SageAttention 自动生效 (无质量损失)。
//                   与 native 的唯一区别: tespeed=false → 不插入 TESpeed 节点(35)。
//   lightx2v-4   —— LightX2V Turbo LoRA v1.0 正式版 (4 步, 768p 训练, shift_video=6 + res_multistep +
//                   simple scheduler)。不使用 T8 节点也不使用 T8 Turbo LoRA; ~72s 渲染。跳过 Foley。
//   lightx2v-8   —— LightX2V Turbo LoRA v1.0 正式版 (8 步, 544p 训练, shift_video=12)。画质更高,
//                   ~120s 渲染。跳过 Foley (直出 H3 原生音频)。
//   lightx2v-8-768p —— LightX2V Turbo LoRA v1.0 正式版 (8 步, 768p 训练, shift_video=6 非 12,
//                   2026-08-27 发布)。768p 原生训练, 跳过 Foley (直出 H3 原生音频)。
//   lineart-anime —— LineartAnime LoRA (DiffSynth-Studio, rank=32)。将线稿视频上色为彩色动漫视频,
//                    20 步 + 标准 shift_video=12, 仅 ref2va 模式。复用 LightX2V 的 SigmaShift + LoRA
//                    拓扑 (非 T8)。跳过 Foley (直出 H3 原生音频)。
// 调用方通过 generate 的 `profile` 入参选择; 显式传 steps 时以 steps 为准 (但 turbo 仍由
// profile.turbo / turbo 入参决定是否启用 LoRA)。
// nativeInterp 仅 native / native-sage 显式为 true, 其余档位保持 undefined (不插值)。
export interface H3ProfilePreset {
  label: string;
  /** null = 按模式默认 (t2v/i2va=H3_NATIVE.t2vSteps, ref2va=H3_NATIVE.r2vSteps) */
  steps: number | null;
  skipFoley: boolean;
  turbo: boolean;
  native: boolean;
  tespeed: boolean;
  /** sigma 低噪段插值 (ExtendIntermediateSigmas); undefined = 不插值 (preview/turbo/production/lightx2v/lineart) */
  nativeInterp?: boolean;
}

// profile 名联合 (显式列出, 使 H3_PROFILES 值类型统一为 H3ProfilePreset 的同时保留字面量键)
export type H3ProfileName =
  | "preview"
  | "turbo"
  | "production"
  | "native"
  | "native-sage"
  | "lightx2v-4"
  | "lightx2v-8"
  | "lightx2v-8-768p"
  | "lineart-anime";

export const H3_PROFILES: Record<H3ProfileName, H3ProfilePreset> = {
  preview: {
    label: "Preview (15-step T8 Dual-Clock, skip Foley)",
    steps: 15,            // T8 实测 15 步已清晰 (旧原生 KSampler 需 50 步)
    skipFoley: true,      // 跳过 Step 2 Foley / Step 3 合并, 直出 H3 原生视频
    turbo: false,
    native: false,
    tespeed: false,       // T8 工作流不插入 TESpeed 节点 (全局 patch 仍生效)
  },
  turbo: {
    label: "Turbo (4~8-step + Turbo LoRA, motion-adaptive)",
    steps: 4,             // 默认值, 实际由 motion 参数决定 (low/medium=4, high=8)
    skipFoley: true,      // 预览档同样跳过 Foley
    turbo: true,          // 启用 Turbo LoRA (LoraLoaderBypassModelOnly)
    native: false,
    tespeed: false,       // T8 工作流不插入 TESpeed 节点
  },
  production: {
    label: "Production (50-step lossless T8, full Foley)",
    steps: 50,            // lossless (T8 下 50 步)
    skipFoley: false,     // 完整 Foley 环境音替换 + BGM 检测重试 + TTS 混音
    turbo: false,
    native: false,
    tespeed: false,       // T8 工作流不插入 TESpeed 节点
  },
  native: {
    label: "Native (KSampler + SigmaShift + TESpeed node, non-T8)",
    steps: null,          // null = 按模式默认 (t2v/i2va=50, ref2va=20, 见 H3_NATIVE)
    skipFoley: false,     // 默认走完整 Foley 管线 (可由调用方覆盖)
    turbo: false,
    native: true,
    tespeed: true,        // 原生链路插入 TESpeed 节点(35)做额外缓存控制 (可能有质量损失)
    nativeInterp: true,   // sigma 低噪段插值 (ExtendIntermediateSigmas, 2026-08-16)
  },
  "native-sage": {
    label: "Native-Sage (KSampler + SigmaShift, no TESpeed node; SageAttention global)",
    steps: null,          // null = 按模式默认 (t2v/i2va=50, ref2va=20, 见 H3_NATIVE)
    skipFoley: true,
    turbo: false,
    native: true,
    tespeed: false,       // 纯原生链路, 不插入 TESpeed 节点 (SageAttention 全局生效, 无质量损失)
    nativeInterp: true,   // sigma 低噪段插值 (ExtendIntermediateSigmas, 2026-08-16)
  },
  "lightx2v-4": {
    label: "LightX2V v1.0 5-step (768p, shift=6, euler, ~72s render)",
    steps: 5,             // 官方 infer_steps=5 (4步去噪+1终步sigma=0)
    skipFoley: true,      // 直出 H3 原生音频, 跳过 Foley
    turbo: false,         // 不使用 T8 Turbo LoRA (用独立的 LightX2V LoRA)
    native: false,        // 不使用原生 KSampler 链路 (LightX2V 自有 SigmaShift + 采样链路)
    tespeed: false,       // LightX2V 链路不插入 TESpeed 节点
  },
  "lightx2v-8": {
    label: "LightX2V v1.0 9-step (544p, shift=12, euler, ~120s render, higher quality)",
    steps: 9,             // 官方 8步推荐+1终步
    skipFoley: true,      // 直出 H3 原生音频, 跳过 Foley
    turbo: false,         // 不使用 T8 Turbo LoRA (用独立的 LightX2V LoRA)
    native: false,        // 不使用原生 KSampler 链路 (LightX2V 自有 SigmaShift + 采样链路)
    tespeed: false,       // LightX2V 链路不插入 TESpeed 节点
  },
  "lightx2v-8-768p": {
    label: "LightX2V v1.0 9-step (768p, shift=6, euler, 2026-08-27 release)",
    steps: 9,             // 官方 8步推荐+1终步
    skipFoley: true,      // 直出 H3 原生音频, 跳过 Foley
    turbo: false,         // 不使用 T8 Turbo LoRA (用独立的 LightX2V LoRA)
    native: false,        // 不使用原生 KSampler 链路 (LightX2V 自有 SigmaShift + 采样链路)
    tespeed: false,       // LightX2V 链路不插入 TESpeed 节点
  },
  "lineart-anime": {
    label: "LineartAnime (20-step + LineartAnime LoRA, line art → anime colorization, ref2va only)",
    steps: 20,             // DiffSynth 官方示例步数
    skipFoley: true,       // 直出 H3 原生音频
    turbo: false,          // 不使用 T8 Turbo LoRA
    native: false,         // 不使用原生 KSampler 链路 (用 SigmaShift + LoRA, 同 LightX2V)
    tespeed: false,        // 不插入 TESpeed 节点
  },
} as const;

// ============================================================
// H3_USE_CASES —— 面向 KMC 的"分用途"入口 (useCase → profile/mode/motion/audioMix)
// ============================================================
// KMC 调 POST /generate 时传 useCase 即可, 无需在 Python 侧自行解析 profile/mode/motion。
// 语义: useCase 只提供默认值; 调用方显式传 mode/profile/motion/steps/audioMix 仍可覆盖 (显式优先)。
//
// 2026-08-17 档位重构 (API 精简): 只暴露主链路两档 (见 H3_EXPOSED_USE_CASES 白名单):
//   preview-lock —— P11a 创意锁定预览, motion 跨拓扑路由 (见 H3_PREVIEW_MOTION_ROUTES):
//                   low→turbo 6步 / medium→turbo 8步 / high→native-sage 15步;
//                   音频 tts-only: 跳 LTX Foley, TTS 对白与 H3 原生环境音混音
//                   (修复旧 skipFoley 路径静默丢弃 ttsAudio 的 bug)。
//   final-shot   —— P11b 成片: native-sage 36 步 @1344×768 (默认分辨率), 完整
//                   LTX Foley 环境音 + TTS 混音管线 (audioMix 默认 balanced)。
//   final-motion —— (预留, 未暴露) 连续 motion 专用工作流; P09 分镜 schema 已有
//                   camera_continuity/transition_method/首尾帧链 结构, 待设计。
// 旧 5 档 (broll/keyframe-interp/portrait-dialogue/motion-board/lineart-color) 定义
// 保留但不在白名单 —— POST 传它们会 400 (重新开放 = 改 H3_EXPOSED_USE_CASES)。
export interface H3UseCasePreset {
  label: string;
  profile: H3ProfileName;
  /** 该用途的默认输入模式 (调用方显式传 mode 则覆盖) */
  mode: "t2va" | "i2va" | "ref2va";
  /** motion 仅 turbo 档有意义 (low/medium/high → 步数/拓扑路由) */
  motion?: "low" | "medium" | "high";
  /** 音频混音策略 (full 管线 Step3 / tts-only 混音时生效) */
  audioMix?: "balanced" | "dialogue-priority";
  /** useCase 固化步数 (显式 steps 仍可覆盖); undefined = 沿用 profile/motion 默认 */
  steps?: number;
  /**
   * 音频管线模式 (2026-08-17 新增, 覆盖 profile.skipFoley 语义):
   *   full     —— Step2 LTX Foley 环境音 + Step3 TTS 混音 (完整管线)
   *   tts-only —— 跳 LTX Foley, TTS 与 H3 原生音频混音 (预览档: 快且对白不丢)
   *   native   —— H3 原生音轨直出, 不混音 (旧预览行为, ttsAudio 会被忽略)
   * undefined = 沿用 profile.skipFoley (legacy 兼容)
   */
  audio?: "full" | "tts-only" | "native";
}

export const H3_USE_CASES = {
  "preview-lock": {
    label: "P11a 创意锁定预览 (motion 路由: low→turbo6 / medium→turbo8 / high→native-sage15; TTS-only 混音)",
    profile: "turbo",
    mode: "ref2va",
    motion: "medium",
    audio: "tts-only",
  },
  "final-shot": {
    label: "P11b 成片 (native-sage 36 步 @1344×768, 完整 Foley + TTS 混音)",
    profile: "native-sage",
    mode: "ref2va",
    audioMix: "balanced",
    steps: 36,
    audio: "full",
  },
  broll: {
    label: "纯文本空镜 / B-roll (t2va, 无参考图, full Foley)",
    profile: "production",
    mode: "t2va",
    audioMix: "balanced",
  },
  "keyframe-interp": {
    label: "首尾帧驱动插值镜头 (i2va, full Foley)",
    profile: "production",
    mode: "i2va",
    audioMix: "balanced",
  },
  "portrait-dialogue": {
    label: "竖屏短剧对白 (ref2va, TTS 优先混音: 对白压低环境音)",
    profile: "production",
    mode: "ref2va",
    audioMix: "dialogue-priority",
  },
  "motion-board": {
    label: "极速运动分镜草稿 (lightx2v-4, ~72s, skip Foley)",
    profile: "lightx2v-4",
    mode: "ref2va",
  },
  "lineart-color": {
    label: "线稿视频 → 彩色动漫上色 (lineart-anime, 仅 ref2va, skip Foley)",
    profile: "lineart-anime",
    mode: "ref2va",
  },
} as const satisfies Record<string, H3UseCasePreset>;

export type H3UseCaseName = keyof typeof H3_USE_CASES;

// ============================================================
// H3_EXPOSED_* —— API 暴露白名单 (2026-08-17 精简决策)
// ============================================================
// 只暴露 KMC 主链路两拓扑: turbo (T8+Turbo LoRA) / native-sage (Native KSampler)。
// 所有 POST 路由 (generate/t2va/i2va/ref2va) 校验 profile 必须在白名单内,
// 不在则 400 且错误信息只列白名单项; GET /workflows 能力清单也只返回白名单内容。
// H3_PROFILES / H3_USE_CASES 里的其余档位定义保留不删 —— 重新开放 = 改这两个数组。
export const H3_EXPOSED_PROFILES: readonly H3ProfileName[] = ["turbo", "native-sage", "lightx2v-8-768p"];
export const H3_EXPOSED_USE_CASES: readonly H3UseCaseName[] = ["preview-lock", "final-shot"];

// ============================================================
// H3_PREVIEW_MOTION_ROUTES —— 预览档动态路由 (2026-08-17 新分档)
// ============================================================
// preview-lock 按 motion 跨拓扑解析 profile+steps (取代旧 getTurboSteps 4/4/8 全 T8):
//   low    → turbo      6 步 (T8 Turbo LoRA, 站立/对白/慢速, ~140s)
//   medium → turbo      8 步 (T8 Turbo LoRA, 行走/轻微动作; 4 步中动态偏软)
//   high   → native-sage 15 步 (Native KSampler, 追逐/打斗; T8 低步数高动态崩坏, 跳拓扑)
// 音频统一走 useCase.audio="tts-only"。调用方显式传 profile/steps 仍可覆盖 (显式优先)。
export const H3_PREVIEW_MOTION_ROUTES: Record<H3MotionLevel, { profile: H3ProfileName; steps: number }> = {
  low: { profile: "turbo", steps: 6 },
  medium: { profile: "turbo", steps: 8 },
  high: { profile: "native-sage", steps: 15 },
} as const;

// ============================================================
// H3_RESOLUTION_TABLE —— 分辨率预设表
// ============================================================
// 所有预设均满足 32 倍数约束,且面积 ≤ MAX_PIXELS。
export const H3_RESOLUTION_TABLE: Record<string, { width: number; height: number; label: string }> = {
  "16:9": { width: 1344, height: 768, label: "Widescreen" },
  "9:16": { width: 768, height: 1344, label: "Portrait" },
  "1:1": { width: 768, height: 768, label: "Square" },
  "4:3": { width: 1024, height: 768, label: "Standard" },
  "3:4": { width: 768, height: 1024, label: "Portrait 4:3" },
  "21:9": { width: 1344, height: 576, label: "Ultrawide" },
};

// ============================================================
// H3_DURATION_TABLE —— 时长 → 帧数预设表
// ============================================================
// 官方推荐档位,已按帧数网格预对齐;调用方传入 duration(秒)时优先查表。
export const H3_DURATION_TABLE: Record<string, number> = {
  "4s": 101,   // (round(4*24)=96) → snap → 101
  "5s": 124,
  "6s": 141,
  "8s": 175,
  "10s": 229,
  "12s": 292,
  "15s": 362,
};

/**
 * 按比例自动适配分辨率(源码 adapt_canvas 逻辑)。
 *
 * 给定任意 width×height,按短边=BASE_SHORT_EDGE 归一化,
 * 再裁剪到面积上限(MAX_PIXELS),最后对齐到 CANVAS_MULTIPLE(32)倍数。
 * 用于 i2va 的 aspectRatio="auto"(跟随首帧比例)等场景。
 */
export function adaptH3Canvas(width: number, height: number): { width: number; height: number } {
  const { CANVAS_MULTIPLE, BASE_SHORT_EDGE, MAX_PIXELS } = H3_CONSTANTS;
  const ratio = width / height;
  let nomW: number, nomH: number;
  if (ratio >= 1.0) {
    nomW = BASE_SHORT_EDGE * ratio;
    nomH = BASE_SHORT_EDGE;
  } else {
    nomW = BASE_SHORT_EDGE;
    nomH = BASE_SHORT_EDGE / ratio;
  }
  if (nomW * nomH > MAX_PIXELS) {
    const s = Math.sqrt(MAX_PIXELS / (nomW * nomH));
    nomW *= s;
    nomH *= s;
  }
  const w = Math.max(CANVAS_MULTIPLE, Math.round(nomW / CANVAS_MULTIPLE) * CANVAS_MULTIPLE);
  const h = Math.max(CANVAS_MULTIPLE, Math.round(nomH / CANVAS_MULTIPLE) * CANVAS_MULTIPLE);
  return { width: w, height: h };
}

// ============================================================
// 提示词约定 (prompt 标签)
// ============================================================
//
// H3 ref2va 多模态条件通过两条路径注入,二者独立:
//   1. 参考媒体连接 (T8: ref_images / ref_audios / ref_videos / ref_video_audios 直接传
//      [[nodeId,0],...] 数组到 MiniMaxH3AudioConditioningT8; 旧原生链路用 ref_image_N 槽位)
//      — 决定哪些参考图/音频参与条件(与 prompt 文本无关)。
//   2. 文本标签 — 在 prompt 中用占位符锚定参考的位置(可选增强,模型据此对齐多模态时序)。
//      T8 的 strict_prompt_tags 会严格校验标签编号与连接的参考数量一致。
//
// 标签约定 (ref2va):
//   - 参考图标签:<Picture 1>(源码 docstring 标准)或 <Image 1>(也能工作)
//   - 参考音频标签:<Audio 1>
//   - 参考视频标签:<Video 1>
//   - 标签必须按排列顺序:images → videos → audios
//   - 多参考时标签递增:<Picture 1>, <Picture 2>, <Video 1>, <Audio 1>, <Audio 2>
//
// ⚠️ BGM ban 策略 (H3 特殊处理,与 LTX 不同):
//   - H3 是 CFG-distilled (cfg=1.0),负面提示词实际上不起作用 —— 无法靠负面词 ban BGM。
//   - 正面提示词必须用 diegetic 锚定语言:"strictly diegetic in-world sound, unscored scene, no scored music"
//   - 绝不能在正面提示词中出现 "no music" —— 实验证实会把所有音频(含环境音和对白)压到 -57dB。

export const H3_AUDIO_POSITIVE_GUIDE =
  "strictly diegetic in-world sound, unscored scene, no scored music";

// 负面提示词默认值 (H3 cfg=1.0 时实际不生效,但节点结构上仍需提供 negative conditioning)
export const H3_DEFAULT_NEGATIVE =
  "worst quality, blurry, jittery, distorted, inconsistent appearance, text, watermark, deformed, low quality";
