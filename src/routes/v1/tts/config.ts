/**
 * TTS Configuration — Unified Qwen3-TTS single engine (v2.0).
 *
 * 所有 TTS 请求统一走 Qwen3-TTS 1.7B via ComfyUI 工作流。
 * CosyVoice / Chatterbox / GPT-SoVITS 已退役 (2026-07-12)。
 *
 * 引擎: Qwen3-TTS-12Hz-1.7B (Base + VoiceDesign + CustomVoice)
 * 模型路径: /data/models/comfyui/qwen-tts/
 * ComfyUI 节点: FB_Qwen3TTS*
 *
 * 三种模式:
 *   voice_design  — 从文字描述创建声音（角色声音身份证）
 *   voice_clone   — 参考音频克隆音色（跨 shot 一致性）
 *   custom_voice  — 预设说话人 TTS
 */
export const TTS_CONFIG = {
  /** ComfyUI API URL */
  comfyuiUrl: process.env.QWEN_TTS_COMFYUI_URL || process.env.TTS_COMFYUI_URL || "http://172.17.0.1:8188",
  /** 宿主机 URL（外部下载音频） */
  comfyuiHostUrl: process.env.QWEN_TTS_COMFYUI_HOST_URL || process.env.TTS_COMFYUI_HOST_URL || "http://172.17.0.1:8188",
  /** 输出目录 */
  outputDir: process.env.QWEN_TTS_OUTPUT_DIR || "/mnt/agents/output/gpu1",
  /** 轮询间隔 */
  pollIntervalMs: 1500,
  /** 轮询超时（1.7B 首次加载 ~60-90s, 推理 ~5-20s） */
  pollTimeoutMs: 300_000, // 5 min

  /** 引擎元数据 */
  engine: {
    name: "Qwen3-TTS-12Hz-1.7B",
    model_choice: "1.7B" as const,
    gpu: "3090",
    vram: "~5GB (bf16)",
    languages: ["Auto", "Chinese", "English", "Japanese", "Korean", "French", "German", "Spanish", "Portuguese", "Russian", "Italian"],
    modes: ["voice_design", "voice_clone", "custom_voice"],
  },

  /** ComfyUI 节点类型 */
  NODE_TYPES: {
    VOICE_DESIGN: "AILab_Qwen3TTSVoiceDesign",
    VOICE_CLONE: "AILab_Qwen3TTSVoiceClone",
    CUSTOM_VOICE: "AILab_Qwen3TTSCustomVoice",
    LOAD_AUDIO: "LoadAudio",
    SAVE_AUDIO: "SaveAudio",
  },

  /** 默认采样参数 */
  defaults: {
    model_choice: "1.7B" as "0.6B" | "1.7B",
    device: "auto" as "auto" | "cuda" | "xpu" | "mps" | "cpu",
    precision: "bf16" as "bf16" | "fp32",
    language: "Auto",
    attention: "auto" as "auto" | "sage_attn" | "flash_attn" | "sdpa" | "eager",
    top_p: 0.8,
    top_k: 20,
    temperature: 1.0,
    repetition_penalty: 1.05,
    max_new_tokens: 2048,
    seed: 0,
  },
};

/** 预设说话人（CustomVoice 模式） */
export const PRESET_SPEAKERS = [
  "Aiden", "Eric", "Serena",
] as const;

/** TTS 模式 */
export type TtsMode = "voice_design" | "voice_clone" | "custom_voice";

/** 兼容旧 TtsTrack 类型 — 映射到新模式 */
export type TtsTrack = TtsMode;
