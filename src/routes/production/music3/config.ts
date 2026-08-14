/**
 * MiniMax Music3 — 文本到音乐生成配置
 *
 * 引擎: MiniMax-Music3 (Global LLM 8B [Qwen3-8B] + Local LLM 0.6B + Flow Matching 2.4B + Flow-VAE 123M)
 * 服务: 独立 diffusers HTTP server (/opt/music3-server.py) on :5112
 *        仿 IndexTTS2.5 (/opt/indextts25-server.py :5110) 模式 —— 不走 ComfyUI,
 *        不污染 comfyui-primary 容器 (容器 ComfyUI 0.30.0 无 Music3 节点; 且 diffusers PR 版本
 *        与容器内 H3/FLUX/LightX2V 管线依赖冲突风险高)。
 * 输出: 44.1kHz / 16-bit / stereo WAV (diffusers 0.40 实测; 模型卡 32kHz 系 SGLang 路径),
 *        最长 ~360s (9000 frames / 25fps)。
 *
 * 参数来源: HF README MiniMaxAI/MiniMax-Music3 + diffusers PR #14456。
 * 调研结论见 /shared/minimax-music3-research.md。
 */

// ============================================================
// MUSIC3_CONFIG —— 运行时连接配置 (环境变量可覆盖)
// ============================================================
export const MUSIC3_CONFIG = {
  /** Music3 diffusers HTTP server URL (KAP → server, 同主机) */
  serverUrl: process.env.MUSIC3_SERVER_URL || "http://localhost:5112",
  /** server 对外可访问 URL (写入 audioUrl, 浏览器/客户端用) */
  publicServerUrl: process.env.MUSIC3_PUBLIC_SERVER_URL || "http://localhost:5112",
  /** 输出目录 (server 写盘基址, 也是 audioPath 前缀) */
  outputDir: process.env.MUSIC3_OUTPUT_DIR || "/home/kai/music3-outputs",
  /** 轮询间隔 (音乐生成数分钟) */
  pollIntervalMs: 3000,
  /** 轮询超时 (30 min —— 长歌曲生成兜底) */
  pollTimeoutMs: 1_800_000,
} as const;

// ============================================================
// MUSIC3_CONSTANTS —— 固化常量 (HF README / 模型架构硬编码)
// ============================================================
// ⚠️ 来自官方 README, 修改会破坏模型一致性。
export const MUSIC3_CONSTANTS = {
  // ⚠️ diffusers 0.40.0.dev0 实测 pipe.sampling_rate=44100 (请求 N 秒→输出精确 N 秒)。
  //    模型卡宣称 32kHz 系 SGLang 路径; server 以 pipe.sampling_rate 动态写盘, 此常量仅供文档。
  SAMPLE_RATE: 44100,       // 44.1kHz 立体声 (diffusers 实测)
  ACOUSTIC_FPS: 25,         // 25 acoustic frames / 秒
  MAX_FRAMES: 9000,         // 最长 9000 acoustic frames
  MAX_DURATION: 360,        // 秒 = 9000 / 25
  MAX_PROMPT_TOKENS: 5000,  // 文本 prompt token 上限
  BIT_DEPTH: 16,            // 16-bit
  CHANNELS: 2,              // stereo
} as const;

// ============================================================
// MUSIC3_DEFAULTS —— 默认参数 (可被 API 入参覆盖)
// ============================================================
export const MUSIC3_DEFAULTS = {
  /** 生成时长 (秒) */
  duration: 30,
  /** 随机种子 (-1 = 随机) */
  seed: 7,
  /** 输出格式 (当前仅 wav; server 始终输出 PCM_16 WAV) */
  format: "wav" as "wav",
} as const;

/**
 * 推荐结构标签 (lyrics 内各占一行, 模型据此安排歌曲结构)。
 * 来自 README: [Intro] [Verse] [Pre-Chorus] [Chorus] [Post-Chorus]
 *              [Bridge] [Instrumental] [Solo] [Outro]
 */
export const MUSIC3_SECTION_TAGS = [
  "Intro", "Verse", "Pre-Chorus", "Chorus", "Post-Chorus",
  "Bridge", "Instrumental", "Solo", "Outro",
] as const;
