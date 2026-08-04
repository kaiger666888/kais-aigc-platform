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
const FL2VA_MODEL = "minimax_h3_fl2va_pruned_int8_convrot.safetensors";
const REF2VA_MODEL = "minimax_h3_ref2va_pruned_int8_convrot.safetensors";

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

  // T2V/I2V 采样参数(官方 quality=lossless 推荐)
  t2vSteps: 50,              // 官方 lossless 推荐 50 步
  t2vSamplerName: "euler",
  t2vScheduler: "simple",

  // R2V 采样参数(官方模板验证)
  r2vSteps: 20,              // 官方 R2V 模板用 20 步
  r2vSamplerName: "res_multistep",  // ⚠️ R2V 官方用 res_multistep(非 euler)
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
  steps: 50,
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
//   1. 结构化槽位 (ref_images.ref_image_N / ref_audios.ref_audio_N) — 必须连接,
//      决定哪些参考图/音频参与条件(与 prompt 文本无关)。
//   2. 文本标签 — 在 prompt 中用占位符锚定参考的位置(可选增强,模型据此对齐多模态时序)。
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
