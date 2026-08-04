/**
 * MiniMax H3 — t2va (纯文本 → 视频 + 音频)
 *
 * POST /api/production/minimax-h3/t2va   (multipart/form-data 或 JSON)
 *   prompt         : string  (正面提示词, required)
 *   projectId      : number  (required)
 *   aspectRatio    : string  ("16:9"/"9:16"/"1:1"/"4:3"/"3:4"/"21:9",默认 "16:9")
 *   duration       : number  (秒 4-15,自动 snap 到帧数网格;默认 5)
 *   width/height   : number  (直接指定,覆盖 aspectRatio,必须 32 倍数)
 *   length         : number  (帧数,覆盖 duration)
 *   seed           : number  (默认 random)
 *   steps          : number  (默认 50,官方 lossless 推荐)
 *   shiftVideo     : number  (默认 12.0,⚠️ 不建议变更)
 *   shiftAudio     : number  (默认 3.0,⚠️ 不建议变更)
 *   negativePrompt : string  (默认见 H3_DEFAULT_NEGATIVE;cfg=1.0 实际不生效)
 *   filenamePrefix : string
 *
 * 与 ref2va 的区别:去掉 LoadImage / LoadAudio / ReferenceToVideo 节点,
 * 用 MiniMaxH3ImageToVideo 同时做正面 (node 20) 和负面 (node 16) 条件。
 * 采样器 / 解码 / 保存链路与 ref2va 完全一致。
 *
 * 返回 promptId + pollUrl,客户端轮询:
 *   GET /api/production/minimax-h3/status/:promptId
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
  H3_RESOLUTION_TABLE,
  H3_DURATION_TABLE,
  alignH3FrameCount,
  H3_DEFAULT_NEGATIVE,
} from "./config";

const router = express.Router();

// t2va 不接文件上传,但保留 multer 以兼容 multipart/form-data 提交(仅文本字段)。
const LOCAL_STAGING_DIR = "/tmp/comfyui-h3-input";
if (!fs.existsSync(LOCAL_STAGING_DIR)) {
  fs.mkdirSync(LOCAL_STAGING_DIR, { recursive: true });
}
const upload = multer({ dest: LOCAL_STAGING_DIR });

// ============================================================
// Workflow builder
// ============================================================
//
// 节点拓扑(基于 ref2va 删去参考资产链):
//   10: CLIPLoader          (qwen3vl_32b_minimax_h3_nvfp4_awq, type="minimax")
//   11: VAELoader           (minimax_h3_video_vae_fp16)
//   12: UNETLoader          (minimax_h3_fl2va_pruned_int8_convrot)
//   13: VAELoader           (minimax_h3_audio_vae_fp32 —— 音频流 VAE,链路保持一致)
//   16: MiniMaxH3ImageToVideo (负面条件)
//   20: MiniMaxH3ImageToVideo (正面条件 —— 输出 [0]=cond [1]=latent)
//   21: MiniMaxH3SigmaShift
//   30: KSampler             (latent_image = ["20", 1])
//   40: VAEDecode
//   50: SaveWEBM             (webm 内嵌音频)
//
// ⚠️ MiniMaxH3ImageToVideo 与 MiniMaxH3ReferenceToVideo 同为 "ToVideo" 条件生成器,
//    输出拓扑一致:[0]=conditioning, [1]=latent。故 t2va 的 latent_image 取 ["20", 1]。

interface H3T2vaWorkflowOpts {
  prompt: string;
  negativePrompt: string;
  width: number;
  height: number;
  length: number;
  seed: number;
  steps: number;
  cfg: number;
  samplerName: string;
  scheduler: string;
  denoise: number;
  shiftVideo: number;
  shiftAudio: number;
  filenamePrefix: string;
  fps: number;
  codec: string;
  crf: number;
}

export function buildH3T2vaWorkflow(opts: H3T2vaWorkflowOpts): Record<string, any> {
  const {
    prompt, negativePrompt,
    width, height, length,
    seed, steps, cfg, samplerName, scheduler, denoise,
    shiftVideo, shiftAudio,
    filenamePrefix, fps, codec, crf,
  } = opts;

  return {
    // === 模型 / 文本编码器 / VAE ===
    "10": {
      class_type: "CLIPLoader",
      inputs: {
        clip_name: H3_DEFAULTS.clipName,
        type: "minimax",
      },
    },
    "11": {
      class_type: "VAELoader",
      inputs: { vae_name: H3_DEFAULTS.videoVaeName },
    },
    "12": {
      class_type: "UNETLoader",
      inputs: {
        unet_name: H3_DEFAULTS.fl2vaModel,
        weight_dtype: "default",
      },
    },
    "13": {
      class_type: "VAELoader",
      inputs: { vae_name: H3_DEFAULTS.audioVaeName },
    },

    // === 负面条件 (MiniMaxH3ImageToVideo) ===
    // cfg=1.0 时实际不生效,但 KSampler 需要 negative conditioning 占位。
    "16": {
      class_type: "MiniMaxH3ImageToVideo",
      inputs: {
        clip: ["10", 0],
        vae: ["11", 0],
        prompt: negativePrompt,
        width,
        height,
        length,
      },
    },

    // === 正面条件 (MiniMaxH3ImageToVideo,纯文本) ===
    // 输出:[0]=conditioning, [1]=latent(喂给 KSampler latent_image)。
    "20": {
      class_type: "MiniMaxH3ImageToVideo",
      inputs: {
        clip: ["10", 0],
        vae: ["11", 0],
        prompt,
        width,
        height,
        length,
      },
    },

    // === 噪声调度 (SigmaShift) ===
    "21": {
      class_type: "MiniMaxH3SigmaShift",
      inputs: {
        model: ["12", 0],
        shift_video: shiftVideo,
        shift_audio: shiftAudio,
      },
    },

    // === 采样 ===
    "30": {
      class_type: "KSampler",
      inputs: {
        model: ["21", 0],
        positive: ["20", 0],
        negative: ["16", 0],
        latent_image: ["20", 1],
        seed,
        steps,
        cfg,
        sampler_name: samplerName,
        scheduler,
        denoise,
      },
    },

    // === 视频解码 ===
    "40": {
      class_type: "VAEDecode",
      inputs: {
        samples: ["30", 0],
        vae: ["11", 0],
      },
    },

    // === 音频解码 ===
    "41": {
      class_type: "VAEDecodeAudio",
      inputs: {
        samples: ["30", 0],
        vae: ["13", 0],
      },
    },

    // === 合并视频+音频 ===
    "42": {
      class_type: "CreateVideo",
      inputs: {
        images: ["40", 0],
        fps,
        audio: ["41", 0],
      },
    },

    // === 保存 (mp4 内嵌音频) ===
    "50": {
      class_type: "SaveVideo",
      inputs: {
        video: ["42", 0],
        filename_prefix: filenamePrefix,
        format: "mp4",
        codec: "auto",
      },
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
    const negativePrompt = (req.body.negativePrompt as string) || H3_DEFAULT_NEGATIVE;
    const seed = req.body.seed ? Number(req.body.seed) : Math.floor(Math.random() * 2147483647);
    const steps = Number(req.body.steps) || H3_DEFAULTS.t2vSteps;            // 官方 lossless 推荐 50 步
    const shiftVideo = Number(req.body.shiftVideo) || H3_DEFAULTS.shiftVideo; // ⚠️ 官方推荐 12.0,不建议变更
    const shiftAudio = Number(req.body.shiftAudio) || H3_DEFAULTS.shiftAudio; // ⚠️ 官方推荐 3.0,不建议变更
    const filenamePrefix = (req.body.filenamePrefix as string) || `h3_t2va_${projectId}_${Date.now()}`;

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

    const workflow = buildH3T2vaWorkflow({
      prompt,
      negativePrompt,
      width,
      height,
      length,
      seed,
      steps,
      cfg: H3_CONSTANTS.CFG,
      samplerName: H3_DEFAULTS.t2vSamplerName,
      scheduler: H3_DEFAULTS.t2vScheduler,
      denoise: H3_DEFAULTS.denoise,
      shiftVideo,
      shiftAudio,
      filenamePrefix,
      fps: H3_CONSTANTS.FPS,
      codec: H3_DEFAULTS.codec,
      crf: H3_DEFAULTS.crf,
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
        estimatedTime: "10-15 min",
        pollUrl: `/api/production/minimax-h3/status/${promptId}`,
        params: {
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
        },
        message: "H3 t2va task submitted to ComfyUI",
      }));
    } catch (err: any) {
      const msg = err.response?.data?.error?.message || err.response?.data?.node_errors || err.message || String(err);
      res.status(502).send(error(`ComfyUI request failed: ${msg}`));
    }
  },
);
