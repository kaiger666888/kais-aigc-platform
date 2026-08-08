/**
 * MiniMax H3 — ref2va / hybrid (参考图(+参考音频/视频) [+首尾帧] → 视频 + 音频)  —— T8 插件工作流
 *
 * POST /api/production/minimax-h3/ref2va   (multipart/form-data)
 *   refImages      : File[]  (1-9 张参考图, required)
 *   refAudios      : File[]  (0-3 个参考音频, optional)
 *   refVideos      : File[]  (0-3 个参考视频帧序列, optional)
 *   refVideoAudios : File[]  (0-3 个视频配对音轨, optional)
 *   firstFrame     : File    (可选 —— 与 refImages 同时提供时 T8 自动进入 hybrid 模式)
 *   lastFrame      : File    (可选 —— 同上)
 *   prompt         : string  (正面提示词, 可含 <Picture N>/<Video N>/<Audio N> 标签)
 *   projectId      : number  (required)
 *   negativePrompt : string  (T8 不需要, 接受但忽略)
 *   width/height   : number  (默认 1344×768, 必须 32 倍数)
 *   length         : number  (默认 124, 自动对齐 n%17==5)
 *   refImageSize   : "match" | "max"  (默认 "match")
 *   seed/steps/shiftVideo/shiftAudio : number
 *   turbo          : boolean (true=Turbo LoRA 加速;步数由 motion 决定)
 *   motion         : string  ("low" | "medium" | "high", turbo 模式下决定步数,默认 medium)
 *   saveSeparateAudio : boolean (可选:额外输出分离音频文件)
 *   filenamePrefix : string
 *
 * 模式自动判定 (T8 task_type="auto"):
 *   - 仅 refImages/refAudios/refVideos        → Ref2VA
 *   - refImages + firstFrame/lastFrame         → Hybrid (参考图 + 关键帧共存)
 *
 * T8 工作流节点拓扑 (node 20 接 ref_images 数组, 直接传 [[nodeId,0],...] 列表):
 *   10-13: loaders (同 t2va)
 *   14/141/142...: LoadImage (参考图)
 *   15/151/152...: LoadAudio (参考音频)
 *   170/171...   : LoadImage (参考视频帧序列)
 *   180/181...   : LoadAudio (视频配对音轨)
 *   90           : LoadImage (hybrid 首帧, 可选) / 91: LoadImage (hybrid 尾帧, 可选)
 *   [14_lora]    : LoraLoaderBypassModelOnly (可选, turbo)
 *   20: MiniMaxH3AudioConditioningT8 (ref_images/ref_audios/ref_videos/ref_video_audios + first_frame/last_frame)
 *   30-33/40/42/50: 同 t2va 采样→解码→保存链路
 *
 * 返回 promptId + pollUrl,客户端轮询:
 *   GET /api/production/minimax-h3/status/:promptId
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
  H3_T8,
  H3_TURBO,
  H3_TESPEED,
  H3_NATIVE,
  H3_DEFAULT_NEGATIVE,
  alignH3FrameCount,
  getTurboSteps,
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

// 参考资产节点 ID 分配 (避开 loaders 的 10-13、turbo 14_lora、采样 30-33、解码 40/42/50)
const imageNodeId = (i: number) => (i === 0 ? "14" : `14${i}`);   // "14","141","142"...
const audioNodeId = (i: number) => (i === 0 ? "15" : `15${i}`);   // "15","151","152"...
const videoNodeId = (i: number) => `17${i}`;                      // "170","171","172"
const videoAudioNodeId = (i: number) => `18${i}`;                 // "180","181","182"
// hybrid 首尾帧 (与参考图节点 14* 区分)
const FIRST_FRAME_NODE = "90";
const LAST_FRAME_NODE = "91";

// ============================================================
// Workflow builder (T8)
// ============================================================
interface H3Ref2vaWorkflowOpts {
  refImageFilenames: string[];        // 1-9 参考图(容器内)
  refAudioFilenames: string[];        // 0-3 参考音频(容器内)
  refVideoFilenames: string[];        // 0-3 参考视频帧序列(容器内)
  refVideoAudioFilenames: string[];   // 0-3 视频配对音轨(容器内)
  prompt: string;                     // 可含 <Picture N>/<Video N>/<Audio N> 标签
  width: number;
  height: number;
  length: number;                     // 调用方应先 alignH3FrameCount
  seed: number;
  steps: number;
  shiftVideo: number;
  shiftAudio: number;
  refImageSize: "match" | "max";      // match=等比缩(快), max=2048px(最佳保真度)
  filenamePrefix: string;
  firstFrameFilename?: string | null; // hybrid: 首帧图(容器内)
  lastFrameFilename?: string | null;  // hybrid: 尾帧图(容器内)
  turbo?: boolean;
  saveSeparateAudio?: boolean;        // 额外输出分离音频 (SaveAudio 取 AVDecodeT8[1])
  native?: boolean;                   // true=走原生 KSampler + SigmaShift 链路
  // ── 原生链路专用 (native=true 时生效, T8 忽略) ──
  negativePrompt?: string;
  cfg?: number;
  samplerName?: string;
  scheduler?: string;
  denoise?: number;
}

export function buildH3Ref2vaWorkflowT8(opts: H3Ref2vaWorkflowOpts): Record<string, any> {
  const {
    refImageFilenames, refAudioFilenames,
    refVideoFilenames, refVideoAudioFilenames,
    prompt, width, height, length,
    seed, steps, shiftVideo, shiftAudio, refImageSize,
    filenamePrefix,
    firstFrameFilename, lastFrameFilename,
    turbo, saveSeparateAudio,
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

    // === 统一条件 (ref_images 等为数组, 直接传 [[nodeId,0],...] 列表) ===
    // task_type="auto" 自动判 ref2va (有 ref_images) 或 hybrid (ref_images + 首尾帧)。
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
        ...(refImageFilenames.length ? { ref_images: refImageFilenames.map((_, i) => [imageNodeId(i), 0]) } : {}),
        ...(refAudioFilenames.length ? { ref_audios: refAudioFilenames.map((_, i) => [audioNodeId(i), 0]) } : {}),
        ...(refVideoFilenames.length ? { ref_videos: refVideoFilenames.map((_, i) => [videoNodeId(i), 0]) } : {}),
        ...(refVideoAudioFilenames.length ? { ref_video_audios: refVideoAudioFilenames.map((_, i) => [videoAudioNodeId(i), 0]) } : {}),
        ...(firstFrameFilename ? { first_frame: [FIRST_FRAME_NODE, 0] } : {}),
        ...(lastFrameFilename ? { last_frame: [LAST_FRAME_NODE, 0] } : {}),
      },
    },

    // === Dual-Clock 采样器配置 ===
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

    // === (可选) 分离音频文件 (AVDecodeT8[1]=AUDIO) ===
    ...(saveSeparateAudio ? {
      "51": {
        class_type: "SaveAudio",
        inputs: { audio: ["40", 1], filename_prefix: `${filenamePrefix}_audio` },
      },
    } : {}),
  };

  // === 动态添加参考资产 LoadImage / LoadAudio 节点 ===
  refImageFilenames.forEach((filename, i) => {
    nodes[imageNodeId(i)] = { class_type: "LoadImage", inputs: { image: filename } };
  });
  refAudioFilenames.forEach((filename, i) => {
    nodes[audioNodeId(i)] = { class_type: "LoadAudio", inputs: { audio: filename } };
  });
  refVideoFilenames.forEach((filename, i) => {
    nodes[videoNodeId(i)] = { class_type: "LoadImage", inputs: { image: filename } };
  });
  refVideoAudioFilenames.forEach((filename, i) => {
    nodes[videoAudioNodeId(i)] = { class_type: "LoadAudio", inputs: { audio: filename } };
  });
  if (firstFrameFilename) {
    nodes[FIRST_FRAME_NODE] = { class_type: "LoadImage", inputs: { image: firstFrameFilename } };
  }
  if (lastFrameFilename) {
    nodes[LAST_FRAME_NODE] = { class_type: "LoadImage", inputs: { image: lastFrameFilename } };
  }

  return nodes;
}

// ============================================================
// Workflow builder (Native — KSampler + SigmaShift, pre-T8 拓扑)
// ============================================================
// 节点拓扑 (从 commit c2ad955a~1 恢复):
//   10: CLIPLoader / 11: VAELoader(video) / 12: UNETLoader(ref2vaModel) / 13: VAELoader(audio)
//   14/141/142: LoadImage (参考图)
//   15/151/152: LoadAudio (参考音频)
//   170/171...: LoadImage (参考视频帧序列)
//   180/181...: LoadAudio (视频配对音轨)
//   16: MiniMaxH3ImageToVideo (负面条件占位)
//   20: MiniMaxH3ReferenceToVideo (正面条件, ref_images 通过结构化槽位 ref_images.ref_image_N 注入)
//   21: MiniMaxH3SigmaShift
//   [可选 35]: TESpeed (H3_TESPEED.enabled —— native 模式默认不启用)
//   30: KSampler (latent_image = ["20", 1] —— ReferenceToVideo 第二输出 = latent)
//   40: VAEDecode / 43: VAEDecodeAudio / 44: CreateVideo / 50: SaveVideo
//   (可选) 41/51: VAEDecodeAudio + SaveAudio —— 分离音频文件
// ⚠️ 原生 ref2va 用 ref2vaModel (pruned int8), 而非 T8 的统一 fl2va_int8_convrot。
export function buildH3Ref2vaWorkflowNative(opts: H3Ref2vaWorkflowOpts): Record<string, any> {
  const {
    refImageFilenames, refAudioFilenames,
    refVideoFilenames, refVideoAudioFilenames,
    prompt, width, height, length,
    seed, steps, shiftVideo, shiftAudio, refImageSize,
    filenamePrefix,
    negativePrompt = H3_DEFAULT_NEGATIVE,
    cfg = H3_CONSTANTS.CFG,
    samplerName = H3_NATIVE.r2vSamplerName,
    scheduler = H3_NATIVE.r2vScheduler,
    denoise = H3_DEFAULTS.denoise,
    saveSeparateAudio,
  } = opts;

  // 参考图 LoadImage 节点: 首张 = "14", 其余 141,142...
  const imageNodes: Record<string, any> = {};
  const refImageSlots: Record<string, any> = {};
  refImageFilenames.forEach((filename, i) => {
    const nodeId = i === 0 ? "14" : `14${i}`;
    imageNodes[nodeId] = { class_type: "LoadImage", inputs: { image: filename } };
    refImageSlots[`ref_images.ref_image_${i}`] = [nodeId, 0];
  });

  // 参考音频 LoadAudio 节点: 首个 = "15", 其余 151,152...
  const audioNodes: Record<string, any> = {};
  const refAudioSlots: Record<string, any> = {};
  refAudioFilenames.forEach((filename, i) => {
    const nodeId = i === 0 ? "15" : `15${i}`;
    audioNodes[nodeId] = { class_type: "LoadAudio", inputs: { audio: filename } };
    refAudioSlots[`ref_audios.ref_audio_${i}`] = [nodeId, 0];
  });

  // 参考视频帧序列: 节点 ID 170,171,172...
  const videoNodes: Record<string, any> = {};
  const refVideoSlots: Record<string, any> = {};
  refVideoFilenames.forEach((filename, i) => {
    const nodeId = `17${i}`;
    videoNodes[nodeId] = { class_type: "LoadImage", inputs: { image: filename } };
    refVideoSlots[`ref_videos.ref_video_${i}`] = [nodeId, 0];
  });

  // 视频配对音轨: 节点 ID 180,181,182...
  const videoAudioNodes: Record<string, any> = {};
  const refVideoAudioSlots: Record<string, any> = {};
  refVideoAudioFilenames.forEach((filename, i) => {
    const nodeId = `18${i}`;
    videoAudioNodes[nodeId] = { class_type: "LoadAudio", inputs: { audio: filename } };
    refVideoAudioSlots[`ref_video_audios.ref_video_audio_${i}`] = [nodeId, 0];
  });

  return {
    // === 模型 / 文本编码器 / VAE ===
    "10": { class_type: "CLIPLoader", inputs: { clip_name: H3_DEFAULTS.clipName, type: "minimax" } },
    "11": { class_type: "VAELoader", inputs: { vae_name: H3_DEFAULTS.videoVaeName } },
    // 原生 ref2va 用 ref2vaModel (pruned int8), 非 T8 统一 fl2va
    "12": { class_type: "UNETLoader", inputs: { unet_name: H3_DEFAULTS.ref2vaModel, weight_dtype: "default" } },
    "13": { class_type: "VAELoader", inputs: { vae_name: H3_DEFAULTS.audioVaeName } },

    // === 参考资产加载 (动态) ===
    ...imageNodes,
    ...audioNodes,
    ...videoNodes,
    ...videoAudioNodes,

    // === 负面条件 (MiniMaxH3ImageToVideo) ===
    // H3 CFG-distilled → cfg=1.0, 负面提示词实际不生效, 但 KSampler 需要 negative conditioning 占位。
    "16": {
      class_type: "MiniMaxH3ImageToVideo",
      inputs: { clip: ["10", 0], vae: ["11", 0], prompt: negativePrompt, width, height, length },
    },

    // === 正面条件 (MiniMaxH3ReferenceToVideo) ===
    // 输出: [0]=conditioning, [1]=latent (喂给 KSampler latent_image)。
    // ref_images / ref_audios 通过结构化槽位注入 (与 prompt 标签独立)。
    "20": {
      class_type: "MiniMaxH3ReferenceToVideo",
      inputs: {
        clip: ["10", 0],
        vae: ["11", 0],
        audio_vae: ["13", 0],
        prompt,
        width, height, length,
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
      inputs: { model: ["12", 0], shift_video: shiftVideo, shift_audio: shiftAudio },
    },

    // === 采样 ===
    // TESpeed 加速: SigmaShift(21) → TESpeed(35) → KSampler(30)
    ...(H3_TESPEED.enabled ? {
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
        model: H3_TESPEED.enabled ? [H3_TESPEED.nodeId, 0] : ["21", 0],
        positive: ["20", 0],
        negative: ["16", 0],
        latent_image: ["20", 1],   // ReferenceToVideo 第二输出 = latent
        seed, steps, cfg,
        sampler_name: samplerName,
        scheduler, denoise,
      },
    },

    // === 视频解码 ===
    "40": { class_type: "VAEDecode", inputs: { samples: ["30", 0], vae: ["11", 0] } },

    // === 音频解码 (合并到视频) ===
    "43": { class_type: "VAEDecodeAudio", inputs: { samples: ["30", 0], vae: ["13", 0] } },

    // === 合并视频+音频 ===
    "44": {
      class_type: "CreateVideo",
      inputs: { images: ["40", 0], fps: H3_CONSTANTS.FPS, audio: ["43", 0] },
    },

    // === 保存 (mp4 内嵌音频) ===
    "50": {
      class_type: "SaveVideo",
      inputs: { video: ["44", 0], filename_prefix: filenamePrefix, format: "mp4", codec: "auto" },
    },

    // === (可选) 分离音频文件 ===
    ...(saveSeparateAudio ? {
      "41": { class_type: "VAEDecodeAudio", inputs: { samples: ["30", 0], vae: ["13", 0] } },
      "51": {
        class_type: "SaveAudio",
        inputs: { audio: ["41", 0], filename_prefix: `${filenamePrefix}_audio` },
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
    { name: "firstFrame", maxCount: 1 },                                // hybrid: 首帧
    { name: "lastFrame", maxCount: 1 },                                 // hybrid: 尾帧
  ]),
  validateFields({
    projectId: z.coerce.number(),
    prompt: z.string().min(1),
  }),
  async (req, res) => {
    const projectId = req.body.projectId;
    const prompt = req.body.prompt as string;
    const width = Number(req.body.width) || H3_DEFAULTS.defaultWidth;
    const height = Number(req.body.height) || H3_DEFAULTS.defaultHeight;
    const refImageSize = (req.body.refImageSize === "max" ? "max" : "match");
    const seed = req.body.seed ? Number(req.body.seed) : Math.floor(Math.random() * 2147483647);
    const turbo = req.body.turbo === "true" || req.body.turbo === true;
    const motion = (req.body.motion as string) || undefined; // low | medium | high
    // native: profile=native 或显式 native=true
    const nativeParam = req.body.native === "true" || req.body.native === true;
    const shiftVideo = Number(req.body.shiftVideo) || H3_DEFAULTS.shiftVideo;
    const shiftAudio = Number(req.body.shiftAudio) || H3_DEFAULTS.shiftAudio;
    const filenamePrefix = (req.body.filenamePrefix as string) || `h3_ref2va_${projectId}_${Date.now()}`;
    const saveSeparateAudio = req.body.saveSeparateAudio === "true" || req.body.saveSeparateAudio === true;
    // native 模式需要负面提示词占位 (KSampler 的 negative conditioning); T8 忽略该字段。
    const negativePrompt = (req.body.negativePrompt as string) || H3_DEFAULT_NEGATIVE;
    // 步数优先级: 显式 steps > motion-based (turbo时) > native 默认 20 > T8 默认 15
    const defaultSteps = nativeParam ? H3_NATIVE.r2vSteps : H3_DEFAULTS.r2vSteps;
    const steps = turbo
      ? (Number(req.body.steps) || getTurboSteps(motion))
      : (Number(req.body.steps) || defaultSteps);
    const native = nativeParam; // profile=native ⇒ 走原生 KSampler 链路

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
    const firstFrameFile = files?.firstFrame?.[0];
    const lastFrameFile = files?.lastFrame?.[0];

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

    // 模式标记 (T8 task_type="auto" 自动判; 此处仅用于响应)
    const isHybrid = !!(firstFrameFile || lastFrameFile);
    const mode = isHybrid ? "hybrid" : "ref2va";

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

    // --- 上传 hybrid 首尾帧到 ComfyUI 容器 ---
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
      if (firstFrameFile) { try { fs.unlinkSync(firstFrameFile.path); } catch {} }
      if (lastFrameFile) { try { fs.unlinkSync(lastFrameFile.path); } catch {} }
      return res.status(502).send(error(`Failed to upload hybrid frame(s) to ComfyUI: ${err.message}`));
    }
    if (firstFrameFile) { try { fs.unlinkSync(firstFrameFile.path); } catch {} }
    if (lastFrameFile) { try { fs.unlinkSync(lastFrameFile.path); } catch {} }

    // --- 构建 + 提交 ---
    const workflow = native
      ? buildH3Ref2vaWorkflowNative({
          refImageFilenames,
          refAudioFilenames,
          refVideoFilenames,
          refVideoAudioFilenames,
          prompt, negativePrompt,
          width, height, length,
          seed, steps,
          shiftVideo, shiftAudio, refImageSize,
          filenamePrefix,
          firstFrameFilename,
          lastFrameFilename,
          turbo,
          saveSeparateAudio,
          native,
          cfg: H3_CONSTANTS.CFG,
          samplerName: H3_NATIVE.r2vSamplerName,
          scheduler: H3_NATIVE.r2vScheduler,
          denoise: H3_DEFAULTS.denoise,
        })
      : buildH3Ref2vaWorkflowT8({
          refImageFilenames,
          refAudioFilenames,
          refVideoFilenames,
          refVideoAudioFilenames,
          prompt,
          width, height, length,
          seed, steps,
          shiftVideo, shiftAudio, refImageSize,
          filenamePrefix,
          firstFrameFilename,
          lastFrameFilename,
          turbo,
          saveSeparateAudio,
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
        mode,
        estimatedTime: turbo ? "3-7 min" : (native ? "10-15 min" : "6-12 min"),
        pollUrl: `/api/production/minimax-h3/status/${promptId}`,
        params: {
          engine: native ? "native" : "t8",
          native,
          width, height, length, fps: H3_CONSTANTS.FPS, seed, steps,
          shiftVideo, shiftAudio, refImageSize,
          refImageCount: refImageFilenames.length,
          refAudioCount: refAudioFilenames.length,
          refVideoCount: refVideoFilenames.length,
          refVideoAudioCount: refVideoAudioFilenames.length,
          hasFirstFrame: !!firstFrameFilename,
          hasLastFrame: !!lastFrameFilename,
          turbo,
          cfg: H3_CONSTANTS.CFG,
        },
        message: native
          ? `H3 ${mode} task submitted to ComfyUI (native KSampler + SigmaShift)`
          : `H3 ${mode} task submitted to ComfyUI (T8 Dual-Clock)`,
      }));
    } catch (err: any) {
      const msg = err.response?.data?.error?.message || err.response?.data?.node_errors || err.message || String(err);
      res.status(502).send(error(`ComfyUI request failed: ${msg}`));
    }
  },
);
