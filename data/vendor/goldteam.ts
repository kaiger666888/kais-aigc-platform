/**
 * Gold Team GPU Engine 供应商适配
 * @version 1.0
 * 
 * 桥接 core-backend 到 kais-gold-team GPU 引擎
 * 支持: TTS (CosyVoice), 图片生成, 视频生成
 */

// ============================================================
// 类型定义
// ============================================================

type VideoMode =
  | "singleImage"
  | "startEndRequired"
  | "endFrameOptional"
  | "startFrameOptional"
  | "text"
  | (`videoReference:${number}` | `imageReference:${number}` | `audioReference:${number}`)[];

interface TextModel {
  name: string;
  modelName: string;
  type: "text";
  think: boolean;
}

interface ImageModel {
  name: string;
  modelName: string;
  type: "image";
  mode: ("text" | "singleImage" | "multiReference")[];
}

interface VideoModel {
  name: string;
  modelName: string;
  type: "video";
  mode: VideoMode[];
  duration: number;
}

interface TTSModel {
  name: string;
  modelName: string;
  type: "tts";
  voices: { title: string; voice: string }[];
}

interface VendorConfig {
  id: string;
  version: string;
  author: string;
  name: string;
  description: string;
  icon: string;
  inputs: { key: string; label: string; type: string; required: boolean }[];
  inputValues: Record<string, any>;
  models: (TextModel | ImageModel | VideoModel | TTSModel)[];
}

type ReferenceList =
  | { type: "image"; sourceType: "base64"; base64: string }
  | { type: "audio"; sourceType: "base64"; base64: string }
  | { type: "video"; sourceType: "base64"; base64: string };

interface ImageConfig {
  prompt: string;
  negativePrompt?: string;
  width: number;
  height: number;
  steps?: number;
  cfgScale?: number;
  seed?: number;
  batchSize?: number;
  referenceList?: ReferenceList[];
}

interface VideoConfig {
  prompt: string;
  negativePrompt?: string;
  imageUrl?: string;
  startImageUrl?: string;
  endImageUrl?: string;
  duration?: number;
  referenceList?: ReferenceList[];
}

interface TTSConfig {
  text: string;
  voice: string;
  speechRate: number;
  pitchRate: number;
  volume: number;
  referenceList?: Extract<ReferenceList, { type: "audio" }>[];
}

// ============================================================
// Gold Team API Client
// ============================================================

const GOLD_TEAM_URL = "http://kais-gold-team:8002";

async function submitTask(type: string, params: Record<string, any>): Promise<string> {
  const taskId = `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const res = await fetch(`${GOLD_TEAM_URL}/api/v1/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      task_id: taskId,
      type,
      params,
      priority: "normal",
    }),
  });
  if (res.status !== 202) {
    const text = await res.text();
    throw new Error(`Gold team rejected task: ${res.status} ${text}`);
  }
  return taskId;
}

async function pollTaskResult(taskId: string, maxWaitMs = 120_000): Promise<any> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const res = await fetch(`${GOLD_TEAM_URL}/api/v1/tasks/${encodeURIComponent(taskId)}`);
    if (!res.ok) throw new Error(`Task status check failed: ${res.status}`);
    const data = await res.json();
    if (data.status === "completed") return data;
    if (data.status === "failed") throw new Error(`Task failed: ${data.error || "unknown"}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Task ${taskId} timed out after ${maxWaitMs}ms`);
}

// ============================================================
// 供应商配置
// ============================================================

const vendor: VendorConfig = {
  id: "goldteam",
  version: "1.0",
  author: "KAIS",
  name: "Gold Team GPU Engine",
  description:
    "## Gold Team 本地 GPU 引擎\n\n基于 RTX 3090 的本地 GPU 推理引擎，支持 CosyVoice TTS、ComfyUI 图片生成等。\n\n⚡ **低延迟** — 本地推理，无需等待云端队列\n🎨 **高质量** — CosyVoice 中文语音合成",
  icon: "",
  inputs: [{ key: "baseUrl", label: "Gold Team URL", type: "text", required: false }],
  inputValues: {
    baseUrl: GOLD_TEAM_URL,
  },
  models: [
    {
      name: "CosyVoice 中文女声",
      modelName: "cosyvoice-zh-female",
      type: "tts",
      voices: [
        { title: "温柔女声", voice: "zh_female_gentle" },
        { title: "知性女声", voice: "zh_female_wise" },
        { title: "活泼女声", voice: "zh_female_lively" },
      ],
    },
    {
      name: "CosyVoice 中文男声",
      modelName: "cosyvoice-zh-male",
      type: "tts",
      voices: [
        { title: "沉稳男声", voice: "zh_male_calm" },
        { title: "磁性男声", voice: "zh_male_magnetic" },
        { title: "少年音", voice: "zh_male_youth" },
      ],
    },
    {
      name: "CosyVoice 克隆",
      modelName: "cosyvoice-clone",
      type: "tts",
      voices: [
        { title: "音频克隆", voice: "clone" },
      ],
    },
  ],
};

// ============================================================
// TTS — 桥接 CosyVoice
// ============================================================

const ttsRequest = async (config: TTSConfig, model: TTSModel): Promise<string> => {
  const baseUrl = vendor.inputValues.baseUrl || GOLD_TEAM_URL;
  
  const params: Record<string, any> = {
    text: config.text,
    voice: config.voice,
    model_id: model.modelName,
  };
  
  // 语音克隆：附带参考音频
  if (config.referenceList && config.referenceList.length > 0) {
    params.reference_audio = config.referenceList[0].base64;
  }
  
  if (config.speechRate) params.speed = config.speechRate;
  
  const taskId = await submitTask("tts", params);
  const result = await pollTaskResult(taskId, 60_000);
  
  // 返回音频文件路径或 base64
  if (result.outputs?.audio) {
    return result.outputs.audio;
  }
  throw new Error("TTS completed but no audio output");
};

// ============================================================
// 占位实现 (未来扩展)
// ============================================================

const textRequest = (model: TextModel, think: boolean, thinkLevel: number) => {
  throw new Error("Gold Team does not provide text generation");
};

const imageRequest = async (config: ImageConfig, model: ImageModel): Promise<string> => {
  const params: Record<string, any> = {
    prompt: config.prompt,
    negative_prompt: config.negativePrompt || "",
    width: config.width,
    height: config.height,
  };
  if (config.steps) params.steps = config.steps;
  if (config.cfgScale) params.cfg_scale = config.cfgScale;
  if (config.seed) params.seed = config.seed;
  
  const taskId = await submitTask("image_draw", params);
  const result = await pollTaskResult(taskId, 120_000);
  
  if (result.outputs?.image) return result.outputs.image;
  throw new Error("Image generation completed but no output");
};

const videoRequest = async (config: VideoConfig, model: VideoModel): Promise<string> => {
  const params: Record<string, any> = {
    prompt: config.prompt,
    negative_prompt: config.negativePrompt || "",
  };
  if (config.imageUrl) params.reference_image = config.imageUrl;
  if (config.duration) params.duration = config.duration;
  
  const taskId = await submitTask("video_final", params);
  const result = await pollTaskResult(taskId, 300_000);
  
  if (result.outputs?.video) return result.outputs.video;
  throw new Error("Video generation completed but no output");
};

// ============================================================
// 导出
// ============================================================

exports.vendor = vendor;
exports.textRequest = textRequest;
exports.imageRequest = imageRequest;
exports.videoRequest = videoRequest;
exports.ttsRequest = ttsRequest;

export {};
