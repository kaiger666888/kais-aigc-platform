import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import axios from "axios";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import sharp from "sharp";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { LTX_CONFIG } from "./config";

const router = express.Router();

const LOCAL_STAGING_DIR = "/tmp/comfyui-ltx-input";
if (!fs.existsSync(LOCAL_STAGING_DIR)) {
  fs.mkdirSync(LOCAL_STAGING_DIR, { recursive: true });
}

const upload = multer({ dest: LOCAL_STAGING_DIR });

function copyToContainer(localPath: string, containerPath: string) {
  const { execSync, spawnSync } = require("child_process");
  try {
    execSync(`docker cp "${localPath}" ${LTX_CONFIG.containerName}:"${containerPath}"`, { timeout: 30_000 });
  } catch {
    const fileContent = fs.readFileSync(localPath);
    const child = spawnSync("docker", ["exec", "-i", LTX_CONFIG.containerName, "bash", "-c", `cat > "${containerPath}"`], {
      input: fileContent,
      timeout: 30_000,
    });
    if (child.status !== 0) throw new Error(child.stderr?.toString() || "docker exec failed");
  }
}

/** Compute low-res latent dims from image aspect ratio */
async function computeLatentDims(
  imagePath: string,
  longestEdge: number = 1280,
  scaleFactor: number = 0.67,
): Promise<{ width: number; height: number }> {
  const meta = await sharp(imagePath).metadata();
  const origWidth = meta.width!;
  const origHeight = meta.height!;

  const isLandscape = origWidth >= origHeight;
  const scaledLong = longestEdge;
  const scaledShort = Math.round((longestEdge / Math.max(origWidth, origHeight)) * Math.min(origWidth, origHeight));

  let w = Math.round((isLandscape ? scaledLong : scaledShort) * scaleFactor);
  let h = Math.round((isLandscape ? scaledShort : scaledLong) * scaleFactor);

  w = Math.max(32, Math.round(w / 32) * 32);
  h = Math.max(32, Math.round(h / 32) * 32);

  return { width: w, height: h };
}

/**
 * LTX-2.3 Singularity — 图生视频 API (matches original active workflow)
 *
 * Pipeline:
 *   Model: UNETLoader → LoraLoaderModelOnly → PathchSageAttentionKJ
 *   Text:  DualCLIPLoader → CLIPTextEncode (pos/neg) → LTXVConditioning
 *
 *   Stage 1 (base, 9-step, low-res):
 *     EmptyLTXVLatentVideo → LTXVImgToVideoInplace (first frame)
 *     → LTXVConcatAVLatent (+audio) → SamplerCustomAdvanced
 *
 *   Upscale: LTXVSeparateAVLatent → LTXVCropGuides
 *     → LTXVLatentUpsampler → LTXVImgToVideoInplace (re-inject first frame)
 *     → LTXVConcatAVLatent (+audio)
 *
 *   Stage 2 (refine, high-res):
 *     SamplerCustomAdvanced (low sigma for detail enhancement)
 *
 *   Output: VAEDecode + LTXVAudioVAEDecode → VHS_VideoCombine
 */
function buildWorkflow(opts: {
  firstFrameFilename: string;
  prompt: string;
  negativePrompt: string;
  width: number;
  height: number;
  numFrames: number;
  fps: number;
  cfg: number;
  seed: number;
  stage1Sigmas: string;
  stage2Sigmas: string;
  transformerName: string;
  clipName1: string;
  clipName2: string;
  loraName: string;
  loraStrength: number;
  videoVaeName: string;
  audioVaeName: string;
  upscalerName: string;
  imgCompression: number;
  sageAttention: string;
  allowCompile: boolean;
  filenamePrefix: string;
  crf: number;
}) {
  const {
    firstFrameFilename, prompt, negativePrompt,
    width, height, numFrames, fps, cfg, seed,
    stage1Sigmas, stage2Sigmas,
    transformerName, clipName1, clipName2,
    loraName, loraStrength,
    videoVaeName, audioVaeName, upscalerName,
    imgCompression, sageAttention, allowCompile,
    filenamePrefix, crf,
  } = opts;

  return {
    // ===== MODEL LOADING =====
    "10": {
      class_type: "UNETLoader",
      inputs: { unet_name: transformerName, weight_dtype: "default" },
    },
    "11": {
      class_type: "LoraLoaderModelOnly",
      inputs: { model: ["10", 0], lora_name: loraName, strength_model: loraStrength },
    },
    "12": {
      class_type: "PathchSageAttentionKJ",
      inputs: { model: ["11", 0], sage_attention: sageAttention, allow_compile: allowCompile },
    },
    "13": {
      class_type: "DualCLIPLoader",
      inputs: { clip_name1: clipName1, clip_name2: clipName2, type: "ltxv", device: "default" },
    },

    // ===== VAE LOADING =====
    "14": {
      class_type: "VAELoaderKJ",
      inputs: { vae_name: videoVaeName, device: "main_device", weight_dtype: "bf16" },
    },
    "15": {
      class_type: "VAELoaderKJ",
      inputs: { vae_name: audioVaeName, device: "main_device", weight_dtype: "bf16" },
    },

    // ===== TEXT ENCODING =====
    "16": {
      class_type: "CLIPTextEncode",
      inputs: { clip: ["13", 0], text: prompt },
    },
    "17": {
      class_type: "CLIPTextEncode",
      inputs: { clip: ["13", 0], text: negativePrompt },
    },
    "23": {
      class_type: "LTXVConditioning",
      inputs: { positive: ["16", 0], negative: ["17", 0], frame_rate: fps },
    },

    // ===== IMAGE LOADING & PREPROCESSING =====
    "18": {
      class_type: "LoadImage",
      inputs: { image: firstFrameFilename, upload: "image" },
    },
    "20": {
      class_type: "ResizeImagesByLongerEdge",
      inputs: { images: ["18", 0], longer_edge: 1536 },
    },
    "21": {
      class_type: "LTXVPreprocess",
      inputs: { image: ["20", 0], img_compression: imgCompression },
    },

    // ===== LATENT SETUP =====
    "30": {
      class_type: "EmptyLTXVLatentVideo",
      inputs: { width, height, length: numFrames, batch_size: 1 },
    },
    "31": {
      class_type: "LTXVEmptyLatentAudio",
      inputs: { audio_vae: ["15", 0], frames_number: numFrames, frame_rate: fps, batch_size: 1 },
    },

    // ===== STAGE 1: BASE GENERATION (low-res, 9 steps) =====
    "40": {
      class_type: "LTXVImgToVideoInplace",
      inputs: { vae: ["14", 0], image: ["21", 0], latent: ["30", 0], strength: 1.0, bypass: false },
    },
    "42": {
      class_type: "LTXVConcatAVLatent",
      inputs: { video_latent: ["40", 0], audio_latent: ["31", 0] },
    },
    "43": {
      class_type: "RandomNoise",
      inputs: { noise_seed: seed },
    },
    "44": {
      class_type: "CFGGuider",
      inputs: { model: ["12", 0], positive: ["23", 0], negative: ["23", 1], cfg },
    },
    "45": {
      class_type: "KSamplerSelect",
      inputs: { sampler_name: "euler_ancestral_cfg_pp" },
    },
    "46": {
      class_type: "ManualSigmas",
      inputs: { sigmas: stage1Sigmas },
    },
    "47": {
      class_type: "SamplerCustomAdvanced",
      inputs: {
        noise: ["43", 0], guider: ["44", 0],
        sampler: ["45", 0], sigmas: ["46", 0],
        latent_image: ["42", 0],
      },
    },

    // ===== POST-STAGE-1: SEPARATE, CROP GUIDES, UPSCALE =====
    "50": {
      class_type: "LTXVSeparateAVLatent",
      inputs: { av_latent: ["47", 1] },
    },
    "51": {
      class_type: "LTXVCropGuides",
      inputs: { positive: ["23", 0], negative: ["23", 1], latent: ["50", 0] },
    },
    "52": {
      class_type: "LatentUpscaleModelLoader",
      inputs: { model_name: upscalerName },
    },
    "53": {
      class_type: "LTXVLatentUpsampler",
      inputs: { samples: ["51", 2], upscale_model: ["52", 0], vae: ["14", 0] },
    },
    "54": {
      class_type: "LTXVImgToVideoInplace",
      inputs: { vae: ["14", 0], image: ["21", 0], latent: ["53", 0], strength: 1.0, bypass: false },
    },
    "55": {
      class_type: "LTXVConcatAVLatent",
      inputs: { video_latent: ["54", 0], audio_latent: ["50", 1] },
    },

    // ===== STAGE 2: REFINEMENT (high-res, gentle) =====
    "60": {
      class_type: "RandomNoise",
      inputs: { noise_seed: seed + 1 },
    },
    "61": {
      class_type: "CFGGuider",
      inputs: { model: ["12", 0], positive: ["51", 0], negative: ["51", 1], cfg },
    },
    "62": {
      class_type: "KSamplerSelect",
      inputs: { sampler_name: "euler_cfg_pp" },
    },
    "63": {
      class_type: "ManualSigmas",
      inputs: { sigmas: stage2Sigmas },
    },
    "64": {
      class_type: "SamplerCustomAdvanced",
      inputs: {
        noise: ["60", 0], guider: ["61", 0],
        sampler: ["62", 0], sigmas: ["63", 0],
        latent_image: ["55", 0],
      },
    },

    // ===== OUTPUT =====
    "70": {
      class_type: "LTXVSeparateAVLatent",
      inputs: { av_latent: ["64", 1] },
    },
    "71": {
      class_type: "VAEDecode",
      inputs: { samples: ["70", 0], vae: ["14", 0] },
    },
    "72": {
      class_type: "LTXVAudioVAEDecode",
      inputs: { samples: ["70", 1], audio_vae: ["15", 0] },
    },
    "73": {
      class_type: "VHS_VideoCombine",
      inputs: {
        images: ["71", 0],
        audio: ["72", 0],
        frame_rate: fps,
        loop_count: 0,
        filename_prefix: filenamePrefix,
        format: "video/h264-mp4",
        pix_fmt: "yuv420p",
        crf,
        save_metadata: true,
        trim_to_audio: false,
        pingpong: false,
        save_output: true,
      },
    },
  };
}

const MODEL_MAP = {
  transformerName: "ltx-2.3-22b-distilled_transformer_only_fp8_input_scaled_v3.safetensors",
  clipName1: "gemma_3_12B_it_fp8_scaled.safetensors",
  clipName2: "ltx-2.3_text_projection_bf16.safetensors",
  loraName: "Singularity-LTX-2.3_OmniCine_V1.safetensors",
  videoVaeName: "ltx2_vae/LTX23_video_vae_bf16.safetensors",
  audioVaeName: "LTX23_audio_vae_bf16.safetensors",
  upscalerName: "ltx-2.3-spatial-upscaler-x2-1.1.safetensors",
};

const DEFAULTS = {
  loraStrength: 1.0,
  cfg: 1.0,
  fps: 24,
  durationSec: 5,
  imgCompression: 18,
  sageAttention: "auto",
  allowCompile: false,
  longestEdge: 1280,
  scaleFactor: 0.67,
  stage1Sigmas: "1.0, 0.99375, 0.9875, 0.98125, 0.975, 0.909375, 0.725, 0.421875, 0.0",
  stage2Sigmas: "0.3, 0.15, 0.0",
  negativePrompt: "字幕，文字，水印，色调艳丽，过曝，细节模糊不清，字幕，风格，作品，画作，画面，整体发灰，最差质量，低质量，JPEG压缩残留，丑陋的，残缺的，多余的手指，画得不好的手部，画得不好的脸部，畸形的，毁容的，形态畸形的肢体，手指融合，静止不动的画面，杂乱的背景，三条腿，背景人很多，倒着走。",
  crf: 19,
};

export default router.post(
  "/",
  upload.fields([
    { name: "firstFrame", maxCount: 1 },
  ]),
  validateFields({
    projectId: z.coerce.number(),
    prompt: z.string().min(1),
  }),
  async (req, res) => {
    const { projectId, prompt } = req.body;

    const negativePrompt = req.body.negativePrompt || DEFAULTS.negativePrompt;
    const fps = Number(req.body.fps) || DEFAULTS.fps;
    const durationSec = Number(req.body.durationSec) || DEFAULTS.durationSec;
    const numFrames = durationSec * fps + 1;
    const cfg = Number(req.body.cfg) || DEFAULTS.cfg;
    const seed = req.body.seed ? Number(req.body.seed) : Math.floor(Math.random() * 2147483647);
    const stage1Sigmas = req.body.stage1Sigmas || DEFAULTS.stage1Sigmas;
    const stage2Sigmas = req.body.stage2Sigmas || DEFAULTS.stage2Sigmas;
    const loraStrength = Number(req.body.loraStrength) || DEFAULTS.loraStrength;
    const imgCompression = Number(req.body.imgCompression) || DEFAULTS.imgCompression;
    const sageAttention = req.body.sageAttention || DEFAULTS.sageAttention;
    const allowCompile = req.body.allowCompile === "true" || req.body.allowCompile === true;
    const longestEdge = Number(req.body.longestEdge) || DEFAULTS.longestEdge;
    const scaleFactor = Number(req.body.scaleFactor) || DEFAULTS.scaleFactor;
    const crf = Number(req.body.crf) || DEFAULTS.crf;
    const filenamePrefix = req.body.filenamePrefix || `ltx_singularity_${projectId}_${Date.now()}`;

    const transformerName = req.body.transformerName || MODEL_MAP.transformerName;
    const clipName1 = req.body.clipName1 || MODEL_MAP.clipName1;
    const clipName2 = req.body.clipName2 || MODEL_MAP.clipName2;
    const loraName = req.body.loraName || MODEL_MAP.loraName;
    const videoVaeName = req.body.videoVaeName || MODEL_MAP.videoVaeName;
    const audioVaeName = req.body.audioVaeName || MODEL_MAP.audioVaeName;
    const upscalerName = req.body.upscalerName || MODEL_MAP.upscalerName;

    const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
    if (!files?.firstFrame?.[0]) {
      return res.status(400).send(error("firstFrame file is required"));
    }

    const firstFile = files.firstFrame[0];

    let width: number, height: number;
    try {
      const dims = await computeLatentDims(firstFile.path, longestEdge, scaleFactor);
      width = dims.width;
      height = dims.height;
    } catch (err: any) {
      try { fs.unlinkSync(firstFile.path); } catch {}
      return res.status(400).send(error(`Failed to read image: ${err.message}`));
    }

    const firstExt = path.extname(firstFile.originalname || ".png") || ".png";
    const firstFrameFilename = `${uuidv4()}${firstExt}`;

    try {
      copyToContainer(firstFile.path, `${LTX_CONFIG.comfyuiInputDir}/${firstFrameFilename}`);
    } catch (err: any) {
      try { fs.unlinkSync(firstFile.path); } catch {}
      return res.status(502).send(error(`Failed to upload image to ComfyUI: ${err.message}`));
    }
    try { fs.unlinkSync(firstFile.path); } catch {}

    const workflow = buildWorkflow({
      firstFrameFilename, prompt, negativePrompt,
      width, height, numFrames, fps, cfg, seed,
      stage1Sigmas, stage2Sigmas,
      transformerName, clipName1, clipName2,
      loraName, loraStrength,
      videoVaeName, audioVaeName, upscalerName,
      imgCompression, sageAttention, allowCompile,
      filenamePrefix, crf,
    });

    try {
      const comfyRes = await axios.post(
        `${LTX_CONFIG.comfyuiUrl}/prompt`,
        { prompt: workflow },
        { timeout: 30_000, validateStatus: (s: number) => s < 500 },
      );

      if (comfyRes.status !== 200) {
        return res.status(502).send(error(`ComfyUI rejected prompt: ${JSON.stringify(comfyRes.data)}`));
      }

      const promptId = comfyRes.data.prompt_id;
      res.status(200).send(success({
        promptId,
        status: "pending",
        message: "LTX Singularity i2v task submitted",
        firstFrameFilename,
        params: { width, height, numFrames, fps, durationSec, cfg, seed, stage1Sigmas, stage2Sigmas },
      }));
    } catch (err: any) {
      const msg = err.response?.data?.error?.message || err.response?.data?.node_errors || err.message || String(err);
      res.status(502).send(error(`ComfyUI request failed: ${msg}`));
    }
  },
);
