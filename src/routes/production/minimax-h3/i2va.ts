/**
 * MiniMax H3 — i2va / fl2va / l2va (首帧/尾帧 → 视频 + 音频)  —— T8 插件工作流
 *
 * POST /api/production/minimax-h3/i2va   (multipart/form-data)
 *   firstFrame      : File    (首帧图, 与 lastFrame 至少有一个)
 *   lastFrame       : File    (尾帧图, 可选)
 *   prompt          : string  (FL2VA/L2VA/I2VA 格式 prompt, required)
 *   projectId       : number  (required)
 *   aspectRatio     : string  ("auto"=跟随首帧比例 | "16:9"/"9:16"/... 默认 "auto")
 *   duration        : number  (秒, 4-15, 默认 5)
 *   width/height    : number  (直接指定, 覆盖 aspectRatio)
 *   length          : number  (帧数, 覆盖 duration)
 *   seed            : number  (默认 random)
 *   steps           : number  (默认 15)
 *   shiftVideo      : number  (默认 12.0)
 *   shiftAudio      : number  (默认 3.0)
 *   turbo           : boolean (true=Turbo LoRA 4 步加速;默认 false)
 *   refImageSize    : "match" | "max"  (默认 "match")
 *   negativePrompt  : string  (T8 不需要, 接受但忽略)
 *   filenamePrefix  : string
 *
 * 模式自动判定 (T8 task_type="auto" 自动识别, 无需手动指定):
 *   - 仅 firstFrame  → I2VA (首帧→视频)
 *   - 仅 lastFrame   → L2VA (尾帧→视频)
 *   - 两者都有       → FL2VA (首尾帧→视频)
 *   - 都没有         → 400 (引导使用 /t2va)
 *
 * T8 工作流节点拓扑 (同 t2va, node 20 增加可选 first_frame/last_frame):
 *   10: CLIPLoader / 11: VAELoader(video) / 12: UNETLoader / 13: VAELoader(audio)
 *   14: LoadImage (首帧, 可选) / 15: LoadImage (尾帧, 可选)
 *   [14_lora]: LoraLoaderBypassModelOnly (可选, turbo)
 *   20: MiniMaxH3AudioConditioningT8 (接 first_frame=[14,0] / last_frame=[15,0])
 *   30: MiniMaxH3DualClockSamplerT8 / 31: RandomNoise / 32: BasicGuider / 33: SamplerCustomAdvanced
 *   40: MiniMaxH3AVDecodeT8 / 42: CreateVideo / 50: SaveVideo
 *
 * 返回 promptId + pollUrl, 客户端轮询:
 *   GET /api/production/minimax-h3/status/:promptId
 */

import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import axios from "axios";
import sharp from "sharp";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import {
  H3_CONFIG,
  H3_CONSTANTS,
  H3_DEFAULTS,
  H3_T8,
  H3_TURBO,
  H3_RESOLUTION_TABLE,
  alignH3FrameCount,
  adaptH3Canvas,
} from "./config";

const router = express.Router();

const LOCAL_STAGING_DIR = "/tmp/comfyui-h3-input";
if (!fs.existsSync(LOCAL_STAGING_DIR)) {
  fs.mkdirSync(LOCAL_STAGING_DIR, { recursive: true });
}
const upload = multer({ dest: LOCAL_STAGING_DIR });

/** 把宿主文件拷进 ComfyUI 容器(先试 docker cp, 失败回退 docker exec -i cat)。 */
function copyToContainer(localPath: string, containerPath: string) {
  const { execSync, spawnSync } = require("child_process");
  try {
    execSync(`docker cp "${localPath}" ${H3_CONFIG.containerName}:"${containerPath}"`, { timeout: 30_000 });
  } catch {
    const fileContent = fs.readFileSync(localPath);
    const child = spawnSync("docker", ["exec", "-i", H3_CONFIG.containerName, "bash", "-c", `cat > "${containerPath}"`], {
      input: fileContent,
      timeout: 30_000,
    });
    if (child.status !== 0) throw new Error(child.stderr?.toString() || "docker exec failed");
  }
}

/** 读取图片宽高(用于 aspectRatio="auto") */
async function getImageDimensions(filePath: string): Promise<{ width: number; height: number }> {
  const metadata = await sharp(filePath).metadata();
  return { width: metadata.width || 1344, height: metadata.height || 768 };
}

// ============================================================
// Workflow builder (T8)
// ============================================================
interface H3I2vaWorkflowOpts {
  firstFrameFilename: string | null;   // 容器内文件名(null = 不接)
  lastFrameFilename: string | null;
  prompt: string;
  width: number;
  height: number;
  length: number;
  seed: number;
  steps: number;
  shiftVideo: number;
  shiftAudio: number;
  refImageSize: "match" | "max";
  filenamePrefix: string;
  turbo?: boolean;
}

export function buildH3I2vaWorkflow(opts: H3I2vaWorkflowOpts): Record<string, any> {
  const {
    firstFrameFilename, lastFrameFilename,
    prompt, width, height, length,
    seed, steps, shiftVideo, shiftAudio,
    refImageSize, filenamePrefix, turbo,
  } = opts;

  const nodes: Record<string, any> = {
    // === 模型 / 文本编码器 / VAE ===
    "10": { class_type: "CLIPLoader", inputs: { clip_name: H3_DEFAULTS.clipName, type: "minimax" } },
    "11": { class_type: "VAELoader", inputs: { vae_name: H3_DEFAULTS.videoVaeName } },
    "12": { class_type: "UNETLoader", inputs: { unet_name: H3_DEFAULTS.fl2vaModel, weight_dtype: "default" } },
    "13": { class_type: "VAELoader", inputs: { vae_name: H3_DEFAULTS.audioVaeName } },

    // === Turbo LoRA (可选; INT8 用 bypass) ===
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

    // === 统一条件 (接 first_frame / last_frame 可选输入; task_type="auto" 自动判 i2va/fl2va/l2va) ===
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
        ...(firstFrameFilename ? { first_frame: ["14", 0] } : {}),
        ...(lastFrameFilename ? { last_frame: ["15", 0] } : {}),
      },
    },

    // === Dual-Clock 采样器配置 ===
    "30": {
      class_type: "MiniMaxH3DualClockSamplerT8",
      inputs: {
        model: turbo ? [H3_TURBO.nodeId, 0] : ["12", 0],
        av_latent: ["20", 1],
        steps: turbo ? H3_TURBO.turboSteps : steps,
        shift_video: shiftVideo,
        shift_audio: shiftAudio,
      },
    },

    "31": { class_type: "RandomNoise", inputs: { noise_seed: seed } },
    "32": { class_type: "BasicGuider", inputs: { model: ["30", 0], conditioning: ["20", 0] } },
    "33": {
      class_type: "SamplerCustomAdvanced",
      inputs: { noise: ["31", 0], guider: ["32", 0], sampler: ["30", 1], sigmas: ["30", 2], latent_image: ["20", 1] },
    },

    "40": {
      class_type: "MiniMaxH3AVDecodeT8",
      inputs: { av_latent: ["33", 0], video_vae: ["11", 0], audio_vae: ["13", 0] },
    },
    "42": {
      class_type: "CreateVideo",
      inputs: { images: ["40", 0], fps: H3_CONSTANTS.FPS, audio: ["40", 1] },
    },
    "50": {
      class_type: "SaveVideo",
      inputs: { video: ["42", 0], filename_prefix: filenamePrefix, format: "mp4", codec: "auto" },
    },
  };

  // 动态添加 LoadImage 节点
  if (firstFrameFilename) {
    nodes["14"] = { class_type: "LoadImage", inputs: { image: firstFrameFilename } };
  }
  if (lastFrameFilename) {
    nodes["15"] = { class_type: "LoadImage", inputs: { image: lastFrameFilename } };
  }

  return nodes;
}

// ============================================================
// Handler
// ============================================================

export default router.post(
  "/",
  upload.fields([
    { name: "firstFrame", maxCount: 1 },
    { name: "lastFrame", maxCount: 1 },
  ]),
  validateFields({
    projectId: z.coerce.number(),
    prompt: z.string().min(1),
  }),
  async (req, res) => {
    const projectId = req.body.projectId;
    const prompt = req.body.prompt as string;
    const seed = req.body.seed ? Number(req.body.seed) : Math.floor(Math.random() * 2147483647);
    const turbo = req.body.turbo === "true" || req.body.turbo === true;
    const steps = turbo ? H3_TURBO.turboSteps : (Number(req.body.steps) || H3_DEFAULTS.t2vSteps);
    const shiftVideo = Number(req.body.shiftVideo) || H3_DEFAULTS.shiftVideo;
    const shiftAudio = Number(req.body.shiftAudio) || H3_DEFAULTS.shiftAudio;
    const refImageSize = req.body.refImageSize === "max" ? "max" : "match";
    const filenamePrefix = (req.body.filenamePrefix as string) || `h3_i2va_${projectId}_${Date.now()}`;
    // negativePrompt 在 T8 下不再使用; 接受该字段以保持 API 向后兼容。

    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    const firstFrameFile = files?.firstFrame?.[0];
    const lastFrameFile = files?.lastFrame?.[0];

    // 至少需要一个帧
    if (!firstFrameFile && !lastFrameFile) {
      return res.status(400).send(error(
        "At least one of firstFrame or lastFrame is required. For pure text-to-video, use /api/production/minimax-h3/t2va instead."
      ));
    }

    // 判定模式 (T8 task_type="auto" 会自动识别, 此处仅用于响应)
    let mode: string;
    if (firstFrameFile && lastFrameFile) mode = "fl2va";
    else if (firstFrameFile) mode = "i2va";
    else mode = "l2va";

    // ── 分辨率计算 ──
    let width: number, height: number;
    const explicitW = req.body.width ? Number(req.body.width) : 0;
    const explicitH = req.body.height ? Number(req.body.height) : 0;

    if (explicitW && explicitH) {
      width = explicitW;
      height = explicitH;
    } else {
      const aspectRatio = (req.body.aspectRatio as string) || "auto";
      if (aspectRatio === "auto" && firstFrameFile) {
        // 跟随首帧比例
        const dims = await getImageDimensions(firstFrameFile.path);
        const adapted = adaptH3Canvas(dims.width, dims.height);
        width = adapted.width;
        height = adapted.height;
      } else if (aspectRatio === "auto" && lastFrameFile && !firstFrameFile) {
        // 仅尾帧时跟随尾帧比例
        const dims = await getImageDimensions(lastFrameFile.path);
        const adapted = adaptH3Canvas(dims.width, dims.height);
        width = adapted.width;
        height = adapted.height;
      } else {
        const preset = H3_RESOLUTION_TABLE[aspectRatio] || H3_RESOLUTION_TABLE["16:9"];
        width = preset.width;
        height = preset.height;
      }
    }

    if (width % H3_CONSTANTS.CANVAS_MULTIPLE !== 0 || height % H3_CONSTANTS.CANVAS_MULTIPLE !== 0) {
      return res.status(400).send(error(
        `width/height must be multiples of ${H3_CONSTANTS.CANVAS_MULTIPLE} (got ${width}×${height})`
      ));
    }

    // ── 帧数 / 时长 ──
    const rawLength = Number(req.body.length) || H3_DEFAULTS.defaultLength;
    const length = alignH3FrameCount(rawLength);
    const durationSeconds = length / H3_CONSTANTS.FPS;

    // ── 上传帧图到 ComfyUI 容器 ──
    let firstFrameFilename: string | null = null;
    let lastFrameFilename: string | null = null;

    try {
      if (firstFrameFile) {
        const ext = path.extname(firstFrameFile.originalname || ".png") || ".png";
        firstFrameFilename = `${uuidv4()}${ext}`;
        copyToContainer(firstFrameFile.path, `${H3_CONFIG.comfyuiInputDir}/${firstFrameFilename}`);
      }
      if (lastFrameFile) {
        const ext = path.extname(lastFrameFile.originalname || ".png") || ".png";
        lastFrameFilename = `${uuidv4()}${ext}`;
        copyToContainer(lastFrameFile.path, `${H3_CONFIG.comfyuiInputDir}/${lastFrameFilename}`);
      }
    } catch (err: any) {
      // 清理本地暂存
      if (firstFrameFile) { try { fs.unlinkSync(firstFrameFile.path); } catch {} }
      if (lastFrameFile) { try { fs.unlinkSync(lastFrameFile.path); } catch {} }
      return res.status(502).send(error(`Failed to upload frame(s) to ComfyUI: ${err.message}`));
    }
    // 清理本地暂存
    if (firstFrameFile) { try { fs.unlinkSync(firstFrameFile.path); } catch {} }
    if (lastFrameFile) { try { fs.unlinkSync(lastFrameFile.path); } catch {} }

    // ── 构建 + 提交 ──
    const workflow = buildH3I2vaWorkflow({
      firstFrameFilename,
      lastFrameFilename,
      prompt,
      width, height, length,
      seed, steps,
      shiftVideo, shiftAudio,
      refImageSize,
      filenamePrefix,
      turbo,
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
        mode,
        estimatedTime: turbo ? "3-5 min" : "10-15 min",
        pollUrl: `/api/production/minimax-h3/status/${promptId}`,
        params: {
          engine: "t8",
          width, height,
          resolution: `${width}x${height}`,
          length,
          durationSeconds: Number(durationSeconds.toFixed(2)),
          fps: H3_CONSTANTS.FPS,
          seed, steps,
          shiftVideo, shiftAudio,
          cfg: H3_CONSTANTS.CFG,
          turbo,
          hasFirstFrame: !!firstFrameFilename,
          hasLastFrame: !!lastFrameFilename,
        },
        message: `H3 ${mode} task submitted to ComfyUI (T8 Dual-Clock)`,
      }));
    } catch (err: any) {
      const msg = err.response?.data?.error?.message || err.response?.data?.node_errors || err.message || String(err);
      res.status(502).send(error(`ComfyUI request failed: ${msg}`));
    }
  },
);
