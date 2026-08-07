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
  enabled: true,          // 全局 patch 开关 (T8 工作流不再插入节点, 仅作就位标记)
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
// H3_TURBO —— T8 + Turbo LoRA 4 步加速配置
// ============================================================
// Turbo LoRA (ComfyUI 格式, 容器内 minimax_h3_turbo_4step_*_comfyui.safetensors) 已就位。
// 在 UNETLoader(12) 与 DualClockSamplerT8(30) 之间插入 LoraLoaderBypassModelOnly,
// steps 固定 4 步 (vs 标准 15 步 / 生产 50 步), 实测 ~3.1x 加速 (136s vs 420s)。
//
// ⚠️ INT8/量化模型必须用 LoraLoader*Bypass* 而非普通合并型 (T8 README: 不要假设等价)。
// ⚠️ Turbo 需非剪枝 fl2va 模型 —— pruned 模型无法完整应用 Turbo LoRA。
//
// 默认关闭 —— API 参数 turbo=true 或 profile="turbo" 时启用。
export const H3_TURBO = {
  enabled: false,             // 默认关闭
  loraName: "minimax_h3_turbo_4step_original_comfyui.safetensors",
  loraNameEma: "minimax_h3_turbo_4step_ema_original_comfyui.safetensors",
  useEma: true,               // EMA 版画质略好 (作者推荐)
  strengthModel: 1.0,         // 必须 1.0
  turboSteps: 4,              // Turbo 模式固定 4 步
  nodeId: "14_lora",          // LoraLoaderBypassModelOnly 节点 ID
  loaderClassType: "LoraLoaderBypassModelOnly", // INT8 模型用 bypass (非合并)
} as const;

// ============================================================
// H3_PROFILES —— 质量/速度 profile 预设 (T8 + KMC 搭配方案, 2026-08-07)
// ============================================================
// 配合 KMC 管线的三种生成档位 (T8 Dual-Clock 采样器):
//   preview    —— 最快速但保证质量: T8 15 步 + TESpeed 全局 patch, 跳过 Foley
//                  (H3 原生音频直出), ~6 min/条
//   turbo      —— 极速: T8 4 步 + Turbo LoRA (~3.1x 加速), 跳过 Foley, ~3 min/条
//   production —— 最高质量: T8 50 步 lossless + 完整 Foley 管线 (LTX+BGM检测+TTS混音), ~20 min/条
// 调用方通过 generate 的 `profile` 入参选择; 显式传 steps 时以 steps 为准 (但 turbo 仍由
// profile.turbo / turbo 入参决定是否启用 LoRA)。
export const H3_PROFILES = {
  preview: {
    label: "Preview (15-step T8 Dual-Clock, skip Foley)",
    steps: 15,            // T8 实测 15 步已清晰 (旧原生 KSampler 需 50 步)
    skipFoley: true,      // 跳过 Step 2 Foley / Step 3 合并, 直出 H3 原生视频
    turbo: false,
  },
  turbo: {
    label: "Turbo (4-step + Turbo LoRA, ~3x faster)",
    steps: 4,             // H3_TURBO.turboSteps
    skipFoley: true,      // 预览档同样跳过 Foley
    turbo: true,          // 启用 Turbo LoRA (LoraLoaderBypassModelOnly)
  },
  production: {
    label: "Production (50-step lossless T8, full Foley)",
    steps: 50,            // lossless (T8 下 50 步)
    skipFoley: false,     // 完整 Foley 环境音替换 + BGM 检测重试 + TTS 混音
    turbo: false,
  },
} as const;

export type H3ProfileName = keyof typeof H3_PROFILES;

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
