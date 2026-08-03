// MiniMax H3 视频生成引擎配置常量
// 参照 ltx/config.ts 模式。H3 已在 comfyui-primary (port 8188) 验证通过,模型文件已就位。

export const H3_CONFIG = {
  comfyuiUrl: process.env.COMFYUI_URL || "http://localhost:8188",
  containerName: "comfyui-primary",
  outputDir: process.env.OUTPUT_DIR || "/mnt/agents/output",
  comfyuiInputDir: "/root/ComfyUI/input",
  comfyuiOutputDir: "/root/ComfyUI/output",
  pollIntervalMs: 2000,
  pollTimeoutMs: 900_000, // 15 min (H3 单次约 10-15 分钟)
};

export const H3_DEFAULTS = {
  // 模型文件名(已验证)
  modelName: "minimax_h3_fl2va_pruned_int8_convrot.safetensors",
  clipName: "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors",
  videoVaeName: "minimax_h3_video_vae_fp16.safetensors",
  audioVaeName: "minimax_h3_audio_vae_fp32.safetensors",
  // 采样参数
  shiftVideo: 12.0,   // 官方推荐:视频流噪声调度
  shiftAudio: 3.0,    // 官方推荐:音频流噪声调度
  steps: 15,          // 蒸馏模型 15 步足够
  cfg: 1.0,           // H3 是 CFG-distilled,cfg 必须为 1.0
  samplerName: "euler",
  scheduler: "normal",
  denoise: 1.0,
  // 视频参数
  fps: 24,
  // 分辨率默认值 (16:9 横屏)
  defaultWidth: 1344,
  defaultHeight: 768,
  // 帧数默认值 (n % 17 == 5 网格)
  defaultLength: 124,  // ~5.2s
  // SaveWEBM
  codec: "vp9",
  crf: 20.0,
};

// H3 帧数必须满足 n % 17 == 5
export function alignH3FrameCount(n: number): number {
  while (n % 17 !== 5) n++;
  return n;
}

// 常用帧数预设 (已对齐)
export const H3_LENGTH_PRESETS: Record<string, number> = {
  "3s": 73,    // ~3.0s
  "5s": 124,   // ~5.2s
  "6s": 141,   // ~5.875s
  "10s": 245,  // ~10.2s
  "15s": 362,  // ~15.1s
};

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
//   - 标签必须按排列顺序:images → audios
//   - 多参考时标签递增:<Picture 1>, <Picture 2>, <Audio 1>, <Audio 2>
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
