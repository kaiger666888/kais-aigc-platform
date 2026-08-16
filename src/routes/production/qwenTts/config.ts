/**
 * Qwen3-TTS — 阿里通义千问 TTS 引擎配置
 *
 * 容器: comfyui-primary (与 Flux/IndexTTS2 共享)
 * 引擎: Qwen3-TTS-12Hz (0.6B / 1.7B)
 * 模型路径: /data/models/comfyui/qwen-tts → 容器内 models/qwen-tts
 * 插件: ComfyUI-Qwen-TTS (FB_Qwen3TTS*)
 *
 * 三种模式:
 *   1. VoiceDesign — 文字描述创建声音（仅 1.7B）
 *   2. VoiceClone  — 参考音频克隆音色（0.6B 快速 / 1.7B 高质量）
 *   3. CustomVoice — 预设说话人 TTS（0.6B / 1.7B）
 *
 * 多语言: Auto/Chinese/English/Japanese/Korean/French/German/Spanish/Portuguese/Russian/Italian
 */

export const QWEN_TTS_CONFIG = {
  /** ComfyUI API URL（容器内） */
  comfyuiUrl: process.env.QWEN_TTS_COMFYUI_URL || "http://172.17.0.1:8188",
  /** 宿主机 URL（外部下载） */
  comfyuiHostUrl: process.env.QWEN_TTS_COMFYUI_HOST_URL || "http://172.17.0.1:8188",
  /** 容器名 */
  containerName: process.env.QWEN_TTS_CONTAINER_NAME || "comfyui-primary",
  /** 输出目录（ComfyUI output mount） */
  outputDir: process.env.QWEN_TTS_OUTPUT_DIR || "/mnt/agents/output/gpu1",
  /** 轮询间隔 */
  pollIntervalMs: 1500,
  /**
   * 轮询超时（env: QWEN_TTS_POLL_TIMEOUT_MS，默认 600s）。
   * 2026-08-16 实测: 冷模型加载 + GPU1 多进程分占下 ComfyUI dynamic VRAM
   * 频繁 offload/重载, 单次合成实际 ~361-374s, 旧默认 300s 必超时误判。
   */
  pollTimeoutMs: process.env.QWEN_TTS_POLL_TIMEOUT_MS
    ? parseInt(process.env.QWEN_TTS_POLL_TIMEOUT_MS, 10)
    : 600_000,
};

export const QWEN_TTS_DEFAULTS = {
  /** 模型规模 */
  modelChoice: "1.7B" as "0.6B" | "1.7B",
  /** 设备 */
  device: "auto" as "auto" | "cuda" | "xpu" | "mps" | "cpu",
  /** 精度 */
  precision: "bf16" as "bf16" | "fp32",
  /** 语言 */
  language: "Auto" as string,
  /** 注意力机制 */
  attention: "auto" as "auto" | "sage_attn" | "flash_attn" | "sdpa" | "eager",

  // 采样参数
  topP: 0.8,
  topK: 20,
  temperature: 1.0,
  repetitionPenalty: 1.05,
  maxNewTokens: 2048,
  seed: 0,
};

/**
 * TTS 模式
 */
export enum QwenTtsMode {
  /** 声音设计 — 从文字描述创建独特声音（仅 1.7B） */
  VOICE_DESIGN = "voice_design",

  /** 声音克隆 — 从参考音频克隆音色 */
  VOICE_CLONE = "voice_clone",

  /** 预设声音 — 使用内置说话人 */
  CUSTOM_VOICE = "custom_voice",
}

/**
 * Qwen3-TTS ComfyUI 节点类型映射
 * 对应 ComfyUI-Qwen-TTS/__init__.py NODE_CLASS_MAPPINGS
 */
export const NODE_TYPES = {
  VOICE_DESIGN: "AILab_Qwen3TTSVoiceDesign",
  VOICE_CLONE: "AILab_Qwen3TTSVoiceClone",
  CUSTOM_VOICE: "AILab_Qwen3TTSCustomVoice",
  LOAD_AUDIO: "LoadAudio",
  SAVE_AUDIO: "SaveAudio",
} as const;

/**
 * 预设说话人列表（CustomVoice 模式可用）
 */
export const PRESET_SPEAKERS = [
  "Aiden", "Eric", "Serena",
  // 其他可用 speaker 可通过 model.get_supported_speakers() 查询
] as const;

/**
 * 支持的语言
 */
export const SUPPORTED_LANGUAGES = [
  "Auto", "Chinese", "English", "Japanese", "Korean",
  "French", "German", "Spanish", "Portuguese", "Russian", "Italian",
] as const;
