/**
 * MiniMax H3 — ref2va (参考图 + 参考音频 → 视频 + 音频)
 *
 * POST /api/production/minimax-h3/ref2va   (multipart/form-data)
 *   refImages      : File[]  (1-10 张参考图, required)
 *   refAudios      : File[]  (0-4 个参考音频, optional)
 *   prompt         : string  (正面提示词, required)
 *   negativePrompt : string  (默认见 H3_DEFAULT_NEGATIVE)
 *   width/height   : number  (默认 1344×768, 必须 32 倍数)
 *   length         : number  (默认 124, 自动对齐到 n%17==5)
 *   refImageSize   : "match" | "max"  (默认 "match")
 *   seed/steps/shiftVideo/shiftAudio : number
 *   filenamePrefix : string
 *   projectId      : string
 *
 * 返回 promptId + pollUrl,客户端轮询:
 *   GET /api/production/minimax-h3/status/:promptId
 *
 * 架构参照 ltx/msr.ts (express router + zod + multer + copyToContainer),
 * 但 H3 工作流结构完全不同 —— 见 buildH3Ref2vaWorkflow。
 */

import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import axios from "axios";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import {
  H3_CONFIG,
  H3_CONSTANTS,
  H3_DEFAULTS,
  alignH3FrameCount,
  H3_DEFAULT_NEGATIVE,
} from "./config";

const router = express.Router();

const LOCAL_STAGING_DIR = "/tmp/comfyui-h3-input";
if (!fs.existsSync(LOCAL_STAGING_DIR)) {
  fs.mkdirSync(LOCAL_STAGING_DIR, { recursive: true });
}

const upload = multer({ dest: LOCAL_STAGING_DIR });

/** 把宿主文件拷进 ComfyUI 容器(先试 docker cp,失败回退 docker exec -i cat)。 */
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

// ============================================================
// Workflow builder
// ============================================================
//
// 节点拓扑(与 /home/kai/shared/h3_ref2va_s3_3.json 的 prompt 字段格式一致):
//   10: CLIPLoader          (qwen3vl_32b_minimax_h3_nvfp4_awq, type="minimax")
//   11: VAELoader           (minimax_h3_video_vae_fp16)
//   12: UNETLoader          (minimax_h3_fl2va_pruned_int8_convrot, weight_dtype="default")
//   13: VAELoader           (minimax_h3_audio_vae_fp32)
//   14: LoadImage           (第 1 张参考图;多参考时 141,142... 递增)
//   15: LoadAudio           (第 1 个参考音频;多参考时 151,152... 递增)
//   16: MiniMaxH3ImageToVideo      (负面条件生成器 —— 仅用于 KSampler 的 negative)
//   20: MiniMaxH3ReferenceToVideo  (正面条件生成器 —— 接 ref_images/ref_audios,输出 [0]=cond [1]=latent)
//   21: MiniMaxH3SigmaShift        (model 噪声调度:shift_video / shift_audio)
//   30: KSampler             (latent_image = ["20", 1] —— ref2va 第二输出是 latent)
//   40: VAEDecode            (视频解码)
//   50: SaveWEBM             (webm 内嵌音频,codec=vp9)
//   (可选) 41: VAEDecodeAudio + 51: SaveAudio —— 输出分离的音频文件
//
// ⚠️ 关键差异 vs LTX:
//   1. H3 是 CFG-distilled,cfg=1.0,负面提示词实际不生效(但节点结构上仍需 negative conditioning)。
//   2. H3 不需要音频冻结 mask —— TTS 参考音频通过 ref_audios 直接传入,模型自动处理。
//   3. SaveWEBM 输出 webm 已内嵌音频;仅当需要分离音频文件时才加 41/51 节点。

interface H3Ref2vaWorkflowOpts {
  refImageFilenames: string[];      // 1-9 参考图(已在容器内)
  refAudioFilenames: string[];      // 0-3 参考音频(已在容器内)
  refVideoFilenames: string[];      // 0-3 参考视频帧序列(已在容器内)
  refVideoAudioFilenames: string[]; // 0-3 视频配对音轨(已在容器内)
  prompt: string;                // 正面提示词(可含 <Picture N>/<Video N>/<Audio N> 标签)
  negativePrompt: string;        // 负面提示词(cfg=1.0 实际不生效,节点结构需要)
  width: number;
  height: number;
  length: number;                // 帧数(调用方应先 alignH3FrameCount)
  seed: number;
  steps: number;
  cfg: number;                   // 必须 1.0
  samplerName: string;           // R2V 官方推荐: res_multistep
  scheduler: string;             // R2V 官方推荐: simple
  denoise: number;
  shiftVideo: number;
  shiftAudio: number;
  refImageSize: "match" | "max"; // match=等比缩(快), max=2048px(最佳保真度)
  filenamePrefix: string;
  fps: number;
  codec: string;
  crf: number;
  saveSeparateAudio?: boolean;   // 可选:额外输出分离音频(VAEDecodeAudio + SaveAudio)
}

export function buildH3Ref2vaWorkflow(opts: H3Ref2vaWorkflowOpts): Record<string, any> {
  const {
    refImageFilenames, refAudioFilenames,
    refVideoFilenames, refVideoAudioFilenames,
    prompt, negativePrompt,
    width, height, length,
    seed, steps, cfg, samplerName, scheduler, denoise,
    shiftVideo, shiftAudio, refImageSize,
    filenamePrefix, fps, codec, crf,
    saveSeparateAudio,
  } = opts;

  // 参考图 LoadImage 节点:首张 = "14"(与已验证 JSON 对齐),其余 141,142...
  const imageNodes: Record<string, any> = {};
  const refImageSlots: Record<string, any> = {};
  refImageFilenames.forEach((filename, i) => {
    const nodeId = i === 0 ? "14" : `14${i}`;   // "14","141","142"...
    imageNodes[nodeId] = {
      class_type: "LoadImage",
      inputs: { image: filename },
    };
    refImageSlots[`ref_images.ref_image_${i}`] = [nodeId, 0];
  });

  // 参考音频 LoadAudio 节点:首个 = "15",其余 151,152...
  const audioNodes: Record<string, any> = {};
  const refAudioSlots: Record<string, any> = {};
  refAudioFilenames.forEach((filename, i) => {
    const nodeId = i === 0 ? "15" : `15${i}`;   // "15","151","152"...
    audioNodes[nodeId] = {
      class_type: "LoadAudio",
      inputs: { audio: filename },
    };
    refAudioSlots[`ref_audios.ref_audio_${i}`] = [nodeId, 0];
  });

  // 参考视频 LoadImage 节点(帧序列):节点 ID 170,171,172...
  const videoNodes: Record<string, any> = {};
  const refVideoSlots: Record<string, any> = {};
  refVideoFilenames.forEach((filename, i) => {
    const nodeId = `17${i}`;   // "170","171","172"
    videoNodes[nodeId] = {
      class_type: "LoadImage",
      inputs: { image: filename },
    };
    refVideoSlots[`ref_videos.ref_video_${i}`] = [nodeId, 0];
  });

  // 视频配对音轨 LoadAudio 节点:节点 ID 180,181,182...
  const videoAudioNodes: Record<string, any> = {};
  const refVideoAudioSlots: Record<string, any> = {};
  refVideoAudioFilenames.forEach((filename, i) => {
    const nodeId = `18${i}`;   // "180","181","182"
    videoAudioNodes[nodeId] = {
      class_type: "LoadAudio",
      inputs: { audio: filename },
    };
    refVideoAudioSlots[`ref_video_audios.ref_video_audio_${i}`] = [nodeId, 0];
  });

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
        unet_name: H3_DEFAULTS.ref2vaModel,
        weight_dtype: "default",
      },
    },
    "13": {
      class_type: "VAELoader",
      inputs: { vae_name: H3_DEFAULTS.audioVaeName },
    },

    // === 参考资产加载 (动态) ===
    ...imageNodes,
    ...audioNodes,
    ...videoNodes,
    ...videoAudioNodes,

    // === 负面条件 (MiniMaxH3ImageToVideo) ===
    // H3 CFG-distilled → cfg=1.0,负面提示词实际不生效,但 KSampler 需要一个 negative conditioning 占位。
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

    // === 正面条件 (MiniMaxH3ReferenceToVideo) ===
    // 输出:[0]=conditioning, [1]=latent(喂给 KSampler latent_image)。
    // ref_images / ref_audios 通过结构化槽位注入(与 prompt 标签独立)。
    "20": {
      class_type: "MiniMaxH3ReferenceToVideo",
      inputs: {
        clip: ["10", 0],
        vae: ["11", 0],
        audio_vae: ["13", 0],
        prompt,
        width,
        height,
        length,
        ref_image_size: refImageSize,
        ...refImageSlots,
        ...refVideoSlots,
        ...refVideoAudioSlots,
        ...refAudioSlots,
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
        latent_image: ["20", 1],   // ref2va 第二输出 = latent
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

    // === (可选) 分离音频文件 ===
    ...(saveSeparateAudio ? {
      "41": {
        class_type: "VAEDecodeAudio",
        inputs: {
          samples: ["30", 0],
          vae: ["13", 0],
        },
      },
      "51": {
        class_type: "SaveAudio",
        inputs: {
          audio: ["41", 0],
          filename_prefix: `${filenamePrefix}_audio`,
        },
      },
    } : {}),
  };
}

// ============================================================
// Handler
// ============================================================

export default router.post(
  "/",
  upload.fields([
    { name: "refImages", maxCount: H3_CONSTANTS.MAX_REF_IMAGES },       // ≤9 张参考图
    { name: "refVideos", maxCount: H3_CONSTANTS.MAX_REF_VIDEOS },       // ≤3 个参考视频(帧序列)
    { name: "refVideoAudios", maxCount: H3_CONSTANTS.MAX_REF_VIDEOS },  // 视频配对音轨
    { name: "refAudios", maxCount: H3_CONSTANTS.MAX_REF_AUDIOS },       // ≤3 个独立参考音频
  ]),
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
    const refImageSize = (req.body.refImageSize === "max" ? "max" : "match");
    const seed = req.body.seed ? Number(req.body.seed) : Math.floor(Math.random() * 2147483647);
    const steps = Number(req.body.steps) || H3_DEFAULTS.r2vSteps;
    const shiftVideo = Number(req.body.shiftVideo) || H3_DEFAULTS.shiftVideo;
    const shiftAudio = Number(req.body.shiftAudio) || H3_DEFAULTS.shiftAudio;
    const filenamePrefix = (req.body.filenamePrefix as string) || `h3_ref2va_${projectId}_${Date.now()}`;
    const saveSeparateAudio = req.body.saveSeparateAudio === "true" || req.body.saveSeparateAudio === true;

    // 分辨率必须 32 倍数
    if (width % 32 !== 0 || height % 32 !== 0) {
      return res.status(400).send(error(`width/height must be multiples of 32 (got ${width}×${height})`));
    }

    // 帧数自动对齐到 n%17==5
    const rawLength = Number(req.body.length) || H3_DEFAULTS.defaultLength;
    const length = alignH3FrameCount(rawLength);

    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    const refImageFiles = files?.refImages || [];
    const refVideoFiles = files?.refVideos || [];
    const refVideoAudioFiles = files?.refVideoAudios || [];
    const refAudioFiles = files?.refAudios || [];

    if (refImageFiles.length < 1) {
      return res.status(400).send(error(`At least 1 reference image required (refImages). Up to ${H3_CONSTANTS.MAX_REF_IMAGES} supported.`));
    }
    if (refImageFiles.length > H3_CONSTANTS.MAX_REF_IMAGES) {
      return res.status(400).send(error(`Too many reference images: ${refImageFiles.length} (max ${H3_CONSTANTS.MAX_REF_IMAGES}).`));
    }
    if (refVideoFiles.length > H3_CONSTANTS.MAX_REF_VIDEOS) {
      return res.status(400).send(error(`Too many reference videos: ${refVideoFiles.length} (max ${H3_CONSTANTS.MAX_REF_VIDEOS}).`));
    }
    if (refAudioFiles.length > H3_CONSTANTS.MAX_REF_AUDIOS) {
      return res.status(400).send(error(`Too many reference audios: ${refAudioFiles.length} (max ${H3_CONSTANTS.MAX_REF_AUDIOS}).`));
    }
    // 总文件数限制
    const totalRefFiles = refImageFiles.length + refVideoFiles.length + refVideoAudioFiles.length + refAudioFiles.length;
    if (totalRefFiles > H3_CONSTANTS.MAX_REF_FILES_TOTAL) {
      return res.status(400).send(error(`Too many reference files total: ${totalRefFiles} (max ${H3_CONSTANTS.MAX_REF_FILES_TOTAL}).`));
    }

    // --- 上传参考图到 ComfyUI 容器 ---
    const refImageFilenames: string[] = [];
    try {
      for (const file of refImageFiles) {
        const ext = path.extname(file.originalname || ".png") || ".png";
        const filename = `${uuidv4()}${ext}`;
        copyToContainer(file.path, `${H3_CONFIG.comfyuiInputDir}/${filename}`);
        refImageFilenames.push(filename);
      }
    } catch (err: any) {
      for (const file of refImageFiles) { try { fs.unlinkSync(file.path); } catch {} }
      return res.status(502).send(error(`Failed to upload images to ComfyUI: ${err.message}`));
    }
    for (const file of refImageFiles) { try { fs.unlinkSync(file.path); } catch {} }

    // --- 上传参考音频到 ComfyUI 容器 ---
    const refAudioFilenames: string[] = [];
    try {
      for (const file of refAudioFiles) {
        const ext = path.extname(file.originalname || ".wav") || ".wav";
        const filename = `${uuidv4()}${ext}`;
        copyToContainer(file.path, `${H3_CONFIG.comfyuiInputDir}/${filename}`);
        refAudioFilenames.push(filename);
      }
    } catch (err: any) {
      for (const file of refAudioFiles) { try { fs.unlinkSync(file.path); } catch {} }
      return res.status(502).send(error(`Failed to upload audios to ComfyUI: ${err.message}`));
    }
    for (const file of refAudioFiles) { try { fs.unlinkSync(file.path); } catch {} }

    // --- 上传参考视频(帧序列)到 ComfyUI 容器 ---
    // 注意: ComfyUI LoadImage 节点接收 IMAGE 类型。参考视频以帧序列形式传入。
    // 实际使用时调用方应预先提取视频帧为图片序列。此处接收单个帧打包文件(如 GIF/APNG/多帧 PNG)。
    // 简化处理: refVideos 作为额外参考图传入(ref_video_N 槽位)。
    const refVideoFilenames: string[] = [];
    try {
      for (const file of refVideoFiles) {
        const ext = path.extname(file.originalname || ".png") || ".png";
        const filename = `${uuidv4()}${ext}`;
        copyToContainer(file.path, `${H3_CONFIG.comfyuiInputDir}/${filename}`);
        refVideoFilenames.push(filename);
      }
    } catch (err: any) {
      for (const file of refVideoFiles) { try { fs.unlinkSync(file.path); } catch {} }
      return res.status(502).send(error(`Failed to upload videos to ComfyUI: ${err.message}`));
    }
    for (const file of refVideoFiles) { try { fs.unlinkSync(file.path); } catch {} }

    // --- 上传视频配对音轨到 ComfyUI 容器 ---
    const refVideoAudioFilenames: string[] = [];
    try {
      for (const file of refVideoAudioFiles) {
        const ext = path.extname(file.originalname || ".wav") || ".wav";
        const filename = `${uuidv4()}${ext}`;
        copyToContainer(file.path, `${H3_CONFIG.comfyuiInputDir}/${filename}`);
        refVideoAudioFilenames.push(filename);
      }
    } catch (err: any) {
      for (const file of refVideoAudioFiles) { try { fs.unlinkSync(file.path); } catch {} }
      return res.status(502).send(error(`Failed to upload video audios to ComfyUI: ${err.message}`));
    }
    for (const file of refVideoAudioFiles) { try { fs.unlinkSync(file.path); } catch {} }

    // --- 构建 + 提交 ---
    const workflow = buildH3Ref2vaWorkflow({
      refImageFilenames,
      refAudioFilenames,
      refVideoFilenames,
      refVideoAudioFilenames,
      prompt,
      negativePrompt,
      width,
      height,
      length,
      seed,
      steps,
      cfg: H3_CONSTANTS.CFG,           // H3 CFG-distilled, 固定 1.0
      samplerName: H3_DEFAULTS.r2vSamplerName,  // R2V 官方: res_multistep
      scheduler: H3_DEFAULTS.r2vScheduler,      // R2V 官方: simple
      denoise: H3_DEFAULTS.denoise,
      shiftVideo,
      shiftAudio,
      refImageSize,
      filenamePrefix,
      fps: H3_CONSTANTS.FPS,
      codec: H3_DEFAULTS.codec,
      crf: H3_DEFAULTS.crf,
      saveSeparateAudio,
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
          shiftVideo, shiftAudio, refImageSize,
          refImageCount: refImageFilenames.length,
          refAudioCount: refAudioFilenames.length,
          refVideoCount: refVideoFilenames.length,
          refVideoAudioCount: refVideoAudioFilenames.length,
          cfg: H3_CONSTANTS.CFG,
        },
        message: "H3 ref2va task submitted to ComfyUI",
      }));
    } catch (err: any) {
      const msg = err.response?.data?.error?.message || err.response?.data?.node_errors || err.message || String(err);
      res.status(502).send(error(`ComfyUI request failed: ${msg}`));
    }
  },
);
