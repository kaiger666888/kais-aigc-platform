/**
 * MiniMax H3 — t2va (纯文本 → 视频 + 音频)
 *
 * POST /api/production/minimax-h3/t2va   (multipart/form-data 或 JSON)
 *   prompt         : string  (正面提示词, required)
 *   negativePrompt : string  (默认见 H3_DEFAULT_NEGATIVE)
 *   width/height   : number  (默认 1344×768, 必须 32 倍数)
 *   length         : number  (默认 124, 自动对齐到 n%17==5)
 *   seed/steps/shiftVideo/shiftAudio : number
 *   filenamePrefix : string
 *   projectId      : string
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
        unet_name: H3_DEFAULTS.modelName,
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

    // === 视频+音频保存 (webm 内嵌音频) ===
    "50": {
      class_type: "SaveWEBM",
      inputs: {
        images: ["40", 0],
        filename_prefix: filenamePrefix,
        codec,
        fps,
        crf,
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
    const width = Number(req.body.width) || H3_DEFAULTS.defaultWidth;
    const height = Number(req.body.height) || H3_DEFAULTS.defaultHeight;
    const seed = req.body.seed ? Number(req.body.seed) : Math.floor(Math.random() * 2147483647);
    const steps = Number(req.body.steps) || H3_DEFAULTS.steps;
    const shiftVideo = Number(req.body.shiftVideo) || H3_DEFAULTS.shiftVideo;
    const shiftAudio = Number(req.body.shiftAudio) || H3_DEFAULTS.shiftAudio;
    const filenamePrefix = (req.body.filenamePrefix as string) || `h3_t2va_${projectId}_${Date.now()}`;

    // 分辨率必须 32 倍数
    if (width % 32 !== 0 || height % 32 !== 0) {
      return res.status(400).send(error(`width/height must be multiples of 32 (got ${width}×${height})`));
    }

    // 帧数自动对齐到 n%17==5
    const rawLength = Number(req.body.length) || H3_DEFAULTS.defaultLength;
    const length = alignH3FrameCount(rawLength);

    const workflow = buildH3T2vaWorkflow({
      prompt,
      negativePrompt,
      width,
      height,
      length,
      seed,
      steps,
      cfg: H3_DEFAULTS.cfg,
      samplerName: H3_DEFAULTS.samplerName,
      scheduler: H3_DEFAULTS.scheduler,
      denoise: H3_DEFAULTS.denoise,
      shiftVideo,
      shiftAudio,
      filenamePrefix,
      fps: H3_DEFAULTS.fps,
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
          width, height, length, fps: H3_DEFAULTS.fps, seed, steps,
          shiftVideo, shiftAudio, cfg: H3_DEFAULTS.cfg,
        },
        message: "H3 t2va task submitted to ComfyUI",
      }));
    } catch (err: any) {
      const msg = err.response?.data?.error?.message || err.response?.data?.node_errors || err.message || String(err);
      res.status(502).send(error(`ComfyUI request failed: ${msg}`));
    }
  },
);
