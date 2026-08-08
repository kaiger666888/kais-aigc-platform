/**
 * MiniMax H3 — t2va (纯文本 → 视频 + 音频)  —— T8 插件工作流
 *
 * POST /api/production/minimax-h3/t2va   (multipart/form-data 或 JSON)
 *   prompt         : string  (正面提示词, required)
 *   projectId      : number  (required)
 *   aspectRatio    : string  ("16:9"/"9:16"/"1:1"/"4:3"/"3:4"/"21:9",默认 "16:9")
 *   duration       : number  (秒 4-15,自动 snap 到帧数网格;默认 5)
 *   width/height   : number  (直接指定,覆盖 aspectRatio,必须 32 倍数)
 *   length         : number  (帧数,覆盖 duration)
 *   seed           : number  (默认 random —— 接 RandomNoise.noise_seed)
 *   steps          : number  (默认 15,T8 Dual-Clock 实测已足够)
 *   shiftVideo     : number  (默认 12.0)
 *   shiftAudio     : number  (默认 3.0)
 *   turbo          : boolean (true=启用 Turbo LoRA 加速;步数由 motion 决定;默认 false)
 *   motion         : string  ("low" | "medium" | "high", turbo 模式下决定步数,默认 medium)
 *   refImageSize   : "match" | "max"  (默认 "match")
 *   negativePrompt : string  (T8 不需要负面条件, 接受但忽略 —— 向后兼容)
 *   filenamePrefix : string
 *
 * 返回 promptId + pollUrl,客户端轮询:
 *   GET /api/production/minimax-h3/status/:promptId
 *
 * T8 工作流节点拓扑 (MiniMaxH3AudioConditioningT8 统一条件, 见 config.H3_T8):
 *   10: CLIPLoader                        (qwen3vl_32b, type="minimax")
 *   11: VAELoader                         (video vae)
 *   12: UNETLoader                        (fl2va_int8_convrot, 统一所有 task_type)
 *   13: VAELoader                         (audio vae)
 *   [14_lora]: LoraLoaderBypassModelOnly  (可选, turbo 模式)
 *   20: MiniMaxH3AudioConditioningT8      (→[0]=COND, [1]=LATENT)
 *   30: MiniMaxH3DualClockSamplerT8       (→[0]=MODEL, [1]=SAMPLER, [2]=SIGMAS)
 *   31: RandomNoise                       (noise_seed = API seed)
 *   32: BasicGuider                       (model=[30,0], conditioning=[20,0])
 *   33: SamplerCustomAdvanced             (→[0]=LATENT)
 *   40: MiniMaxH3AVDecodeT8               (→[0]=IMAGE, [1]=AUDIO)
 *   42: CreateVideo                       (IMAGE+AUDIO → VIDEO)
 *   50: SaveVideo                         (mp4 内嵌音频)
 */

import express from "express";
import multer from "multer";
import fs from "fs";
import axios from "axios";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import {
  H3_CONFIG,
  H3_DEFAULTS,
  H3_CONSTANTS,
  H3_T8,
  H3_TURBO,
  H3_TESPEED,
  H3_NATIVE,
  H3_DEFAULT_NEGATIVE,
  H3_PROFILES,
  H3_RESOLUTION_TABLE,
  H3_DURATION_TABLE,
  alignH3FrameCount,
  getTurboSteps,
} from "./config";

const router = express.Router();

// t2va 不接文件上传,但保留 multer 以兼容 multipart/form-data 提交(仅文本字段)。
const LOCAL_STAGING_DIR = "/tmp/comfyui-h3-input";
if (!fs.existsSync(LOCAL_STAGING_DIR)) {
  fs.mkdirSync(LOCAL_STAGING_DIR, { recursive: true });
}
const upload = multer({ dest: LOCAL_STAGING_DIR });

// ============================================================
// Workflow builder (T8)
// ============================================================
interface H3T2vaWorkflowOpts {
  prompt: string;
  width: number;
  height: number;
  length: number;
  seed: number;          // 接 RandomNoise.noise_seed (保留可复现性)
  steps: number;         // turbo 时由 handler 传入 motion-based 步数 (getTurboSteps)
  shiftVideo: number;
  shiftAudio: number;
  refImageSize: "match" | "max";
  filenamePrefix: string;
  turbo?: boolean;       // true=插入 LoraLoaderBypassModelOnly, 4~8 步加速 (步数由 motion 决定)
  native?: boolean;      // true=走原生 KSampler + SigmaShift 链路 (仅 buildH3T2vaWorkflowNative 使用)
  /**
   * 原生链路是否插入 TESpeed 节点(35)。
   * 默认 (不传或 true): 插入 (仅当 H3_TESPEED.enabled=true)。
   * 显式 false: 不插入 —— 用于 native-sage (SageAttention 全局生效, 无质量损失)。
   */
  tespeed?: boolean;
  // ── 原生链路专用 (native=true 时生效, T8 忽略) ──
  negativePrompt?: string;
  cfg?: number;
  samplerName?: string;
  scheduler?: string;
  denoise?: number;
}

export function buildH3T2vaWorkflowT8(opts: H3T2vaWorkflowOpts): Record<string, any> {
  const {
    prompt, width, height, length,
    seed, steps, shiftVideo, shiftAudio,
    refImageSize, filenamePrefix, turbo,
  } = opts;

  return {
    // === 模型 / 文本编码器 / VAE ===
    "10": { class_type: "CLIPLoader", inputs: { clip_name: H3_DEFAULTS.clipName, type: "minimax" } },
    "11": { class_type: "VAELoader", inputs: { vae_name: H3_DEFAULTS.videoVaeName } },
    "12": { class_type: "UNETLoader", inputs: { unet_name: H3_DEFAULTS.fl2vaModel, weight_dtype: "default" } },
    "13": { class_type: "VAELoader", inputs: { vae_name: H3_DEFAULTS.audioVaeName } },

    // === Turbo LoRA (可选; INT8 模型用 bypass 非合并型, 见 T8 README) ===
    ...(turbo ? {
      [H3_TURBO.nodeId]: {
        class_type: H3_TURBO.loaderClassType,
        inputs: {
          model: ["12", 0],
          lora_name: H3_TURBO.useEma ? H3_TURBO.loraNameEma : H3_TURBO.loraName,
          strength_model: H3_TURBO.strengthModel,
        },
      },
    } : {}),

    // === 统一条件 (MiniMaxH3AudioConditioningT8) ===
    // T2VA: 纯文本, 无 first_frame/last_frame/ref_images。task_type="auto" 自动判 t2va。
    // 输出 [0]=CONDITIONING, [1]=LATENT —— LATENT 同时喂 DualClock.av_latent 与
    // SamplerCustomAdvanced.latent_image (见 config.H3_T8 注释里的采样链路契约)。
    "20": {
      class_type: "MiniMaxH3AudioConditioningT8",
      inputs: {
        clip: ["10", 0],
        video_vae: ["11", 0],
        audio_vae: ["13", 0],
        prompt,
        width, height, length,
        task_type: H3_T8.taskType,
        audio_mode: H3_T8.audioMode,
        audio_denoise_strength: H3_T8.audioDenoiseStrength,
        add_source_as_reference: H3_T8.addSourceAsReference,
        prompt_primary_audio_ordinal: H3_T8.promptPrimaryAudioOrdinal,
        strict_prompt_tags: H3_T8.strictPromptTags,
        ref_image_size: refImageSize,
        reference_video_policy: H3_T8.referenceVideoPolicy,
      },
    },

    // === Dual-Clock 采样器配置 (内置 12/3 shift + flow sigma 网格 + 双时钟 Euler) ===
    // 输出 [0]=MODEL(双时钟已配), [1]=SAMPLER, [2]=SIGMAS —— 不是 LATENT。
    "30": {
      class_type: "MiniMaxH3DualClockSamplerT8",
      inputs: {
        model: turbo ? [H3_TURBO.nodeId, 0] : ["12", 0],
        av_latent: ["20", 1],
        steps,
        shift_video: shiftVideo,
        shift_audio: shiftAudio,
      },
    },

    // === RandomNoise (noise_seed 接 API seed, 保留可复现性) ===
    "31": { class_type: "RandomNoise", inputs: { noise_seed: seed } },

    // === BasicGuider (H3 CFG-distilled, 单 conditioning 即可, 无需负面条件) ===
    "32": {
      class_type: "BasicGuider",
      inputs: { model: ["30", 0], conditioning: ["20", 0] },
    },

    // === SamplerCustomAdvanced (执行采样, 产出 LATENT) ===
    "33": {
      class_type: "SamplerCustomAdvanced",
      inputs: {
        noise: ["31", 0],
        guider: ["32", 0],
        sampler: ["30", 1],
        sigmas: ["30", 2],
        latent_image: ["20", 1],
      },
    },

    // === 联合 AV 解码 (一次解码出 IMAGE + AUDIO) ===
    "40": {
      class_type: "MiniMaxH3AVDecodeT8",
      inputs: { av_latent: ["33", 0], video_vae: ["11", 0], audio_vae: ["13", 0] },
    },

    // === 合并视频 + 音频 → VIDEO ===
    "42": {
      class_type: "CreateVideo",
      inputs: { images: ["40", 0], fps: H3_CONSTANTS.FPS, audio: ["40", 1] },
    },

    // === 保存 (mp4 内嵌音频) ===
    "50": {
      class_type: "SaveVideo",
      inputs: { video: ["42", 0], filename_prefix: filenamePrefix, format: "mp4", codec: "auto" },
    },
  };
}

// ============================================================
// Workflow builder (Native — KSampler + SigmaShift, pre-T8 拓扑)
// ============================================================
// 节点拓扑 (从 commit c2ad955a~1 恢复, 适配当前 config 常量):
//   10: CLIPLoader (clip_name, type="minimax")
//   11: VAELoader (video vae)
//   12: UNETLoader (fl2vaModel —— 原生链路也用统一 fl2va 模型)
//   13: VAELoader (audio vae)
//   16: MiniMaxH3ImageToVideo (负面条件占位, 无图)
//   20: MiniMaxH3ImageToVideo (正面条件 —— 输出 [0]=cond [1]=latent)
//   21: MiniMaxH3SigmaShift (shift_video / shift_audio)
//   [可选 35]: TESpeed (如果 H3_TESPEED.enabled —— native 模式默认不启用)
//   30: KSampler (model→21或35, positive→20, negative→16, latent_image→20[1])
//   40: VAEDecode (samples→30, vae→11)
//   41: VAEDecodeAudio (samples→30, vae→13)
//   42: CreateVideo (images→40, fps, audio→41)
//   50: SaveVideo
// ⚠️ native 模式默认不插入 TESpeed 节点 (与 pre-T8 代码一致的行为)。
//    TESpeed 是全局 patch, enabled=true 仅表示 patch 就位。
export function buildH3T2vaWorkflowNative(opts: H3T2vaWorkflowOpts): Record<string, any> {
  const {
    prompt, width, height, length,
    seed, steps, shiftVideo, shiftAudio,
    filenamePrefix,
    negativePrompt = H3_DEFAULT_NEGATIVE,
    cfg = H3_CONSTANTS.CFG,
    samplerName = H3_NATIVE.t2vSamplerName,
    scheduler = H3_NATIVE.t2vScheduler,
    denoise = H3_DEFAULTS.denoise,
    tespeed,
  } = opts;
  // TESpeed 节点(35) 仅当 H3_TESPEED.enabled=true 且 tespeed !== false 时插入。
  // native-sage (tespeed=false) → 不插入 (SageAttention 全局生效, 无质量损失)。
  const useTespeed = H3_TESPEED.enabled && tespeed !== false;

  return {
    // === 模型 / 文本编码器 / VAE ===
    "10": { class_type: "CLIPLoader", inputs: { clip_name: H3_DEFAULTS.clipName, type: "minimax" } },
    "11": { class_type: "VAELoader", inputs: { vae_name: H3_DEFAULTS.videoVaeName } },
    "12": { class_type: "UNETLoader", inputs: { unet_name: H3_DEFAULTS.fl2vaModel, weight_dtype: "default" } },
    "13": { class_type: "VAELoader", inputs: { vae_name: H3_DEFAULTS.audioVaeName } },

    // === 负面条件 (MiniMaxH3ImageToVideo, 无图) ===
    // cfg=1.0 时实际不生效, 但 KSampler 需要 negative conditioning 占位。
    "16": {
      class_type: "MiniMaxH3ImageToVideo",
      inputs: { clip: ["10", 0], vae: ["11", 0], prompt: negativePrompt, width, height, length },
    },

    // === 正面条件 (MiniMaxH3ImageToVideo, 纯文本) ===
    // 输出: [0]=conditioning, [1]=latent (喂给 KSampler latent_image)。
    "20": {
      class_type: "MiniMaxH3ImageToVideo",
      inputs: { clip: ["10", 0], vae: ["11", 0], prompt, width, height, length },
    },

    // === 噪声调度 (SigmaShift) ===
    "21": {
      class_type: "MiniMaxH3SigmaShift",
      inputs: { model: ["12", 0], shift_video: shiftVideo, shift_audio: shiftAudio },
    },

    // === 采样 ===
    // TESpeed 加速: SigmaShift(21) → TESpeed(35) → KSampler(30)
    // 仅当 H3_TESPEED.enabled=true 且 tespeed !== false 时插入 (native-sage=false 不插入)。
    ...(useTespeed ? {
      [H3_TESPEED.nodeId]: {
        class_type: H3_TESPEED.classType,
        inputs: {
          model: ["21", 0],
          processing_control_value: H3_TESPEED.processingControlValue,
          processing_percent_1: H3_TESPEED.processingPercent1,
          processing_percent_2: H3_TESPEED.processingPercent2,
          mcs: H3_TESPEED.mcs,
          device: H3_TESPEED.device,
          cache_depth: H3_TESPEED.cacheDepth,
        },
      },
    } : {}),
    "30": {
      class_type: "KSampler",
      inputs: {
        model: useTespeed ? [H3_TESPEED.nodeId, 0] : ["21", 0],
        positive: ["20", 0],
        negative: ["16", 0],
        latent_image: ["20", 1],
        seed, steps, cfg,
        sampler_name: samplerName,
        scheduler, denoise,
      },
    },

    // === 视频解码 ===
    "40": { class_type: "VAEDecode", inputs: { samples: ["30", 0], vae: ["11", 0] } },

    // === 音频解码 ===
    "41": { class_type: "VAEDecodeAudio", inputs: { samples: ["30", 0], vae: ["13", 0] } },

    // === 合并视频+音频 ===
    "42": {
      class_type: "CreateVideo",
      inputs: { images: ["40", 0], fps: H3_CONSTANTS.FPS, audio: ["41", 0] },
    },

    // === 保存 (mp4 内嵌音频) ===
    "50": {
      class_type: "SaveVideo",
      inputs: { video: ["42", 0], filename_prefix: filenamePrefix, format: "mp4", codec: "auto" },
    },
  };
}

// ============================================================
// Handler
// ============================================================

export default router.post(
  "/",
  upload.none(),
  validateFields({
    projectId: z.coerce.number(),
    prompt: z.string().min(1),
  }),
  async (req, res) => {
    const projectId = req.body.projectId;
    const prompt = req.body.prompt as string;
    const seed = req.body.seed ? Number(req.body.seed) : Math.floor(Math.random() * 2147483647);
    const turbo = req.body.turbo === "true" || req.body.turbo === true;
    const motion = (req.body.motion as string) || undefined; // low | medium | high
    // native: profile=native/native-sage 或显式 native=true
    const rawProfile = ((req.body.profile as string) || "").toLowerCase();
    const profile = H3_PROFILES[rawProfile as keyof typeof H3_PROFILES];
    const nativeParam = req.body.native === "true" || req.body.native === true || profile?.native === true;
    // tespeed: 原生链路是否插入 TESpeed 节点(35)。native-sage profile 的 tespeed=false → 不插入。
    const tespeed = profile?.tespeed !== false;
    const shiftVideo = Number(req.body.shiftVideo) || H3_DEFAULTS.shiftVideo;
    const shiftAudio = Number(req.body.shiftAudio) || H3_DEFAULTS.shiftAudio;
    const refImageSize = req.body.refImageSize === "max" ? "max" : "match";
    const filenamePrefix = (req.body.filenamePrefix as string) || `h3_t2va_${projectId}_${Date.now()}`;
    // native 模式需要负面提示词占位 (KSampler 的 negative conditioning); T8 忽略该字段。
    const negativePrompt = (req.body.negativePrompt as string) || H3_DEFAULT_NEGATIVE;
    // 步数优先级: 显式 steps > motion-based (turbo时) > native 默认 50 > T8 默认 15
    const defaultSteps = nativeParam ? H3_NATIVE.t2vSteps : H3_DEFAULTS.t2vSteps;
    const steps = turbo
      ? (Number(req.body.steps) || getTurboSteps(motion))
      : (Number(req.body.steps) || defaultSteps);
    const native = nativeParam; // profile=native ⇒ 走原生 KSampler 链路

    // ── 分辨率解析:width/height 直接指定(最高优先)> aspectRatio 预设 > 默认 ──
    const explicitW = req.body.width ? Number(req.body.width) : 0;
    const explicitH = req.body.height ? Number(req.body.height) : 0;
    const aspectRatio = (req.body.aspectRatio as string) || "16:9";
    let width: number;
    let height: number;
    if (explicitW && explicitH) {
      width = explicitW;
      height = explicitH;
    } else if (H3_RESOLUTION_TABLE[aspectRatio]) {
      width = H3_RESOLUTION_TABLE[aspectRatio].width;
      height = H3_RESOLUTION_TABLE[aspectRatio].height;
    } else {
      width = H3_DEFAULTS.defaultWidth;
      height = H3_DEFAULTS.defaultHeight;
    }

    // 分辨率必须 32 倍数
    if (width % 32 !== 0 || height % 32 !== 0) {
      return res.status(400).send(error(`width/height must be multiples of 32 (got ${width}×${height})`));
    }

    // ── 帧数解析:length 直接指定(覆盖 duration)> duration 查表/计算 > 默认 ──
    const explicitLength = req.body.length ? Number(req.body.length) : 0;
    const explicitDuration = req.body.duration ? Number(req.body.duration) : 0;
    let length: number;
    let durationSeconds: number;
    if (explicitLength) {
      length = alignH3FrameCount(explicitLength);
      durationSeconds = length / H3_CONSTANTS.FPS;
    } else if (explicitDuration) {
      if (
        explicitDuration < H3_CONSTANTS.MIN_DURATION ||
        explicitDuration > H3_CONSTANTS.MAX_DURATION
      ) {
        return res
          .status(400)
          .send(error(`duration must be ${H3_CONSTANTS.MIN_DURATION}-${H3_CONSTANTS.MAX_DURATION}s (got ${explicitDuration})`));
      }
      const durKey = `${Math.round(explicitDuration)}s`;
      length =
        H3_DURATION_TABLE[durKey] !== undefined
          ? H3_DURATION_TABLE[durKey]
          : alignH3FrameCount(Math.round(explicitDuration * H3_CONSTANTS.FPS));
      durationSeconds = explicitDuration;
    } else {
      length = alignH3FrameCount(H3_DEFAULTS.defaultLength);
      durationSeconds = length / H3_CONSTANTS.FPS;
    }

    const workflow = native
      ? buildH3T2vaWorkflowNative({
          prompt, negativePrompt,
          width, height, length,
          seed, steps,
          shiftVideo, shiftAudio,
          refImageSize,
          filenamePrefix,
          turbo,
          native,
          tespeed,
          cfg: H3_CONSTANTS.CFG,
          samplerName: H3_NATIVE.t2vSamplerName,
          scheduler: H3_NATIVE.t2vScheduler,
          denoise: H3_DEFAULTS.denoise,
        })
      : buildH3T2vaWorkflowT8({
          prompt,
          width, height, length,
          seed, steps,
          shiftVideo, shiftAudio,
          refImageSize,
          filenamePrefix,
          turbo,
          native,
        });

    try {
      const comfyRes = await axios.post(
        `${H3_CONFIG.comfyuiUrl}/prompt`,
        { prompt: workflow },
        { timeout: 30_000, validateStatus: (s: number) => s < 500 },
      );

      if (comfyRes.status !== 200) {
        return res.status(502).send(error(`ComfyUI rejected prompt: ${JSON.stringify(comfyRes.data)}`));
      }

      const promptId = comfyRes.data.prompt_id as string;
      res.status(200).send(success({
        promptId,
        status: "submitted",
        estimatedTime: turbo ? "3-5 min" : (native ? "10-15 min" : "6-12 min"),
        pollUrl: `/api/production/minimax-h3/status/${promptId}`,
        params: {
          engine: native ? "native" : "t8",
          native,
          width,
          height,
          resolution: `${width}x${height}`,
          aspectRatio,
          length,
          durationSeconds: Number(durationSeconds.toFixed(2)),
          fps: H3_CONSTANTS.FPS,
          seed,
          steps,
          shiftVideo,
          shiftAudio,
          cfg: H3_CONSTANTS.CFG,
          turbo,
        },
        message: native
          ? "H3 t2va task submitted to ComfyUI (native KSampler + SigmaShift)"
          : "H3 t2va task submitted to ComfyUI (T8 Dual-Clock)",
      }));
    } catch (err: any) {
      const msg = err.response?.data?.error?.message || err.response?.data?.node_errors || err.message || String(err);
      res.status(502).send(error(`ComfyUI request failed: ${msg}`));
    }
  },
);
