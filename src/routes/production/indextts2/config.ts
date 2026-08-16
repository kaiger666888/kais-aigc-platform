/**
 * IndexTTS 2.0 — 零样本语音克隆配置
 *
 * 容器: comfyui-primary (comfyui-megapak-indextts2:latest)
 * 引擎: IndexTTS-2 (GPT + S2Mel + BigVGAN + Qwen Emotion)
 * 模型路径: /data/models/IndexTTS-2 → 容器内 /root/ComfyUI/models/IndexTTS-2
 *
 * 特点: 零样本语音克隆（只需一段参考音频）、情感控制、多语言（中英日韩）
 */

export const INDEXTTS2_CONFIG = {
  /** ComfyUI API URL (从容器内访问，用 docker 网络地址) */
  comfyuiUrl: process.env.INDEXTTS2_COMFYUI_URL || "http://comfyui-primary:8188",
  /** 宿主机 URL（用于外部下载音频） */
  comfyuiHostUrl: process.env.INDEXTTS2_COMFYUI_HOST_URL || "http://172.17.0.1:8188",
  /** 容器名（与 Flux/视频生成共享 comfyui-primary） */
  containerName: process.env.INDEXTTS2_CONTAINER_NAME || "comfyui-primary",
  /** 输出目录（ComfyUI output mount） */
  outputDir: process.env.INDEXTTS2_OUTPUT_DIR || "/mnt/agents/output/gpu1",
  /** 轮询间隔 */
  pollIntervalMs: 1500,
  /**
   * 轮询超时（env: INDEXTTS2_POLL_TIMEOUT_MS，默认 300s）。
   * 与 ComfyUI 共享 GPU1 时同样存在 dynamic VRAM offload 拖慢问题
   * (参照 qwenTts 2026-08-16 实测 ~6min), 旧默认 180s 偏紧。
   */
  pollTimeoutMs: process.env.INDEXTTS2_POLL_TIMEOUT_MS
    ? parseInt(process.env.INDEXTTS2_POLL_TIMEOUT_MS, 10)
    : 300_000,
  /**
   * IndexTTS 2.5 standalone server (容器内 venv 隔离, transformers 4.52.1)。
   * 宿主 /etc/hosts 已配 172.18.0.7 indextts25-server; KAP 跑在宿主机。
   */
  v25ServerUrl: process.env.INDEXTTS25_SERVER_URL || "http://indextts25-server:5110",
  /** Qwen3-TTS VoiceDesign server (容器内 /opt/voicedesign-env) */
  voiceDesignUrl: process.env.VOICEDESIGN_SERVER_URL || "http://voicedesign-server:5111",
  /**
   * IndexTTS 2.5 链路合成产物落盘目录 (映射 /oss/tts 静态服务)。
   * voice-design 链式合成 + speak v2.5 proxy 都写这里。
   */
  v25OutputDir: process.env.INDEXTTS25_OUTPUT_DIR || "/data/workspace/kais-aigc-platform/data/oss/tts",
};

export const INDEXTTS2_DEFAULTS = {
  /** 模型目录名（在 ComfyUI models/ 下） */
  modelDir: "IndexTTS-2",
  /** 设备 */
  device: "auto" as "auto" | "cuda" | "mps" | "cpu",
  /** 使用 fp16（降低显存从 ~19GB 到 ~6GB） */
  useFp16: true,
  /** CUDA kernel（需编译，默认关闭） */
  useCudaKernel: false,
  /** DeepSpeed（需编译，默认关闭） */
  useDeepspeed: false,

  // 采样参数
  temperature: 1.0,
  topK: 0, // 0 = 不启用
  topP: 1.0,
  useRandom: false,

  // IndexTTS 2.5 链路默认值 (voice-design.ts / speak.ts v2.5 分支)
  /** 2.5 语言: ZH|EN|JA|ES|AR */
  defaultLang: "ZH",
  /** 2.5 语速因子 0.5-2.0 */
  durationFactor: 1.0,
};

/**
 * 合成模式
 */
export enum SynthMode {
  /** 语音克隆 — 从参考音频克隆音色 */
  VOICE_CLONE = "voice_clone",

  /** 情感音频 — 从参考音频提取情感特征 */
  EMOTION_AUDIO = "emotion_audio",

  /** 情感向量 — 直接指定情感向量 */
  EMOTION_VECTOR = "emotion_vector",

  /** 情感文本 — 从文本描述生成情感 */
  EMOTION_TEXT = "emotion_text",
}

/**
 * IndexTTS2 ComfyUI 节点类型映射
 */
export const NODE_TYPES = {
  MODEL_LOADER: "IndexTTS2ModelLoader",
  VOICE_CLONE: "IndexTTS2VoiceClone",
  EMOTION_AUDIO: "IndexTTS2EmotionAudio",
  EMOTION_VECTOR: "IndexTTS2EmotionVector",
  EMOTION_TEXT: "IndexTTS2EmotionText",
  SCRIPT_DUBBING: "IndexTTS2ScriptDubbing",
  LOAD_AUDIO: "LoadAudio",
  SAVE_AUDIO: "SaveAudio",
} as const;
