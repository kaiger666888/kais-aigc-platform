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
  /** 轮询超时（首次加载模型约 30-60s，推理约 5-15s） */
  pollTimeoutMs: 180_000, // 3 min
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

// NOTE: 不导出 default，避免被 router 注册为空 middleware 阻塞后续路由

import express from "express";
const router = express.Router();
export default router;
