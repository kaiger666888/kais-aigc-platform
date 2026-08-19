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
import { VramInsufficientError, withGpuQueue } from "@/lib/gpuVramManager";
import { LTX_CONFIG } from "./config";

const router = express.Router();
const LOCAL_STAGING_DIR = "/tmp/comfyui-ltx-input";
if (!fs.existsSync(LOCAL_STAGING_DIR)) fs.mkdirSync(LOCAL_STAGING_DIR, { recursive: true });
const upload = multer({ dest: LOCAL_STAGING_DIR });

function copyToContainer(localPath: string, containerPath: string) {
  const { execSync, spawnSync } = require("child_process");
  try {
    execSync(`docker cp "${localPath}" ${LTX_CONFIG.containerName}:"${containerPath}"`, { timeout: 30_000 });
  } catch {
    const fileContent = fs.readFileSync(localPath);
    const child = spawnSync("docker", ["exec", "-i", LTX_CONFIG.containerName, "bash", "-c", `cat > "${containerPath}"`], { input: fileContent, timeout: 30_000 });
    if (child.status !== 0) throw new Error(child.stderr?.toString() || "docker exec failed");
  }
}

async function computeLatentDims(imagePath: string, longestEdge = 1280, scaleFactor = 0.67) {
  const meta = await sharp(imagePath).metadata();
  const ow = meta.width!, oh = meta.height!;
  const isLand = ow >= oh;
  const sl = longestEdge;
  const ss = Math.round((longestEdge / Math.max(ow, oh)) * Math.min(ow, oh));
  let w = Math.round((isLand ? sl : ss) * scaleFactor);
  let h = Math.round((isLand ? ss : sl) * scaleFactor);
  w = Math.max(32, Math.round(w / 32) * 32);
  h = Math.max(32, Math.round(h / 32) * 32);
  return { width: w, height: h };
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
  loraStrength: 1.0, cfg: 1.0, fps: 24, durationSec: 5,
  imgCompression: 18, sageAttention: "auto", allowCompile: false,
  longestEdge: 1280, scaleFactor: 0.67,
  stage1Sigmas: "1.0, 0.99375, 0.9875, 0.98125, 0.975, 0.909375, 0.725, 0.421875, 0.0",
  stage2Sigmas: "0.3, 0.15, 0.0",
  negativePrompt: "字幕，文字，水印，色调艳丽，过曝，细节模糊不清，字幕，风格，作品，画作，画面，整体发灰，最差质量，低质量，JPEG压缩残留，丑陋的，残缺的，多余的手指，画得不好的手部，画得不好的脸部，畸形的，毁容的，形态畸形的肢体，手指融合，静止不动的画面，杂乱的背景，三条腿，背景人很多，倒着走。",
  crf: 19,
};

/**
 * FFLF Workflow: 首尾帧图生视频
 * Uses LTXVImgToVideoInplace (first frame) + LTXVAddGuide (last frame, strength=0.6)
 * API-compatible V1 nodes only.
 */
function buildFFLFWorkflow(opts: any) {
  const o = opts;
  return {
    // Model
    "10": { class_type: "UNETLoader", inputs: { unet_name: o.transformerName, weight_dtype: "default" } },
    "11": { class_type: "LoraLoaderModelOnly", inputs: { model: ["10", 0], lora_name: o.loraName, strength_model: o.loraStrength } },
    "12": { class_type: "PathchSageAttentionKJ", inputs: { model: ["11", 0], sage_attention: o.sageAttention, allow_compile: o.allowCompile } },
    "13": { class_type: "DualCLIPLoader", inputs: { clip_name1: o.clipName1, clip_name2: o.clipName2, type: "ltxv", device: "default" } },
    // VAE
    "14": { class_type: "VAELoaderKJ", inputs: { vae_name: o.videoVaeName, device: "main_device", weight_dtype: "bf16" } },
    "15": { class_type: "VAELoaderKJ", inputs: { vae_name: o.audioVaeName, device: "main_device", weight_dtype: "bf16" } },
    // Text
    "16": { class_type: "CLIPTextEncode", inputs: { clip: ["13", 0], text: o.prompt } },
    "17": { class_type: "CLIPTextEncode", inputs: { clip: ["13", 0], text: o.negativePrompt } },
    "23": { class_type: "LTXVConditioning", inputs: { positive: ["16", 0], negative: ["17", 0], frame_rate: o.fps } },
    // Images
    "18": { class_type: "LoadImage", inputs: { image: o.firstFrameFilename, upload: "image" } },
    "19": { class_type: "LoadImage", inputs: { image: o.lastFrameFilename, upload: "image" } },
    "20": { class_type: "ResizeImagesByLongerEdge", inputs: { images: ["18", 0], longer_edge: 1536 } },
    "21": { class_type: "LTXVPreprocess", inputs: { image: ["20", 0], img_compression: o.imgCompression } },
    "22": { class_type: "ResizeImagesByLongerEdge", inputs: { images: ["19", 0], longer_edge: 1536 } },
    "25": { class_type: "LTXVPreprocess", inputs: { image: ["22", 0], img_compression: o.imgCompression } },
    // Latent
    "30": { class_type: "EmptyLTXVLatentVideo", inputs: { width: o.width, height: o.height, length: o.numFrames, batch_size: 1 } },
    "31": { class_type: "LTXVEmptyLatentAudio", inputs: { audio_vae: ["15", 0], frames_number: o.numFrames, frame_rate: o.fps, batch_size: 1 } },

    // STAGE 1: Inject first frame → Add last frame guide (strength=0.6)
    "40": { class_type: "LTXVImgToVideoInplace", inputs: { vae: ["14", 0], image: ["21", 0], latent: ["30", 0], strength: 1.0, bypass: false } },
    // LTXVAddGuide: V1 API compatible. outputs [0]=pos COND, [1]=neg COND, [2]=LATENT
    "41": {
      class_type: "LTXVAddGuide",
      inputs: { positive: ["23", 0], negative: ["23", 1], vae: ["14", 0], latent: ["40", 0], image: ["25", 0], frame_idx: -1, strength: 0.6 },
    },
    "42": { class_type: "LTXVConcatAVLatent", inputs: { video_latent: ["41", 2], audio_latent: ["31", 0] } },
    "43": { class_type: "RandomNoise", inputs: { noise_seed: o.seed } },
    "44": { class_type: "CFGGuider", inputs: { model: ["12", 0], positive: ["41", 0], negative: ["41", 1], cfg: o.cfg } },
    "45": { class_type: "KSamplerSelect", inputs: { sampler_name: "euler_ancestral_cfg_pp" } },
    "46": { class_type: "ManualSigmas", inputs: { sigmas: o.stage1Sigmas } },
    "47": { class_type: "SamplerCustomAdvanced", inputs: { noise: ["43", 0], guider: ["44", 0], sampler: ["45", 0], sigmas: ["46", 0], latent_image: ["42", 0] } },

    // UPSCALE
    "50": { class_type: "LTXVSeparateAVLatent", inputs: { av_latent: ["47", 1] } },
    "51": { class_type: "LTXVCropGuides", inputs: { positive: ["23", 0], negative: ["23", 1], latent: ["50", 0] } },
    "52": { class_type: "LatentUpscaleModelLoader", inputs: { model_name: o.upscalerName } },
    "53": { class_type: "LTXVLatentUpsampler", inputs: { samples: ["51", 2], upscale_model: ["52", 0], vae: ["14", 0] } },
    "54": { class_type: "LTXVImgToVideoInplace", inputs: { vae: ["14", 0], image: ["21", 0], latent: ["53", 0], strength: 1.0, bypass: false } },
    "55": { class_type: "LTXVConcatAVLatent", inputs: { video_latent: ["54", 0], audio_latent: ["50", 1] } },

    // STAGE 2: Refine
    "60": { class_type: "RandomNoise", inputs: { noise_seed: o.seed + 1 } },
    "61": { class_type: "CFGGuider", inputs: { model: ["12", 0], positive: ["51", 0], negative: ["51", 1], cfg: o.cfg } },
    "62": { class_type: "KSamplerSelect", inputs: { sampler_name: "euler_cfg_pp" } },
    "63": { class_type: "ManualSigmas", inputs: { sigmas: o.stage2Sigmas } },
    "64": { class_type: "SamplerCustomAdvanced", inputs: { noise: ["60", 0], guider: ["61", 0], sampler: ["62", 0], sigmas: ["63", 0], latent_image: ["55", 0] } },

    // OUTPUT
    "70": { class_type: "LTXVSeparateAVLatent", inputs: { av_latent: ["64", 1] } },
    "71": { class_type: "VAEDecode", inputs: { samples: ["70", 0], vae: ["14", 0] } },
    "72": { class_type: "LTXVAudioVAEDecode", inputs: { samples: ["70", 1], audio_vae: ["15", 0] } },
    "73": { class_type: "VHS_VideoCombine", inputs: { images: ["71", 0], audio: ["72", 0], frame_rate: o.fps, loop_count: 0, filename_prefix: o.filenamePrefix, format: "video/h264-mp4", pix_fmt: "yuv420p", crf: o.crf, save_metadata: true, trim_to_audio: false, pingpong: false, save_output: true } },
  };
}

/** Single-image i2v (no last frame) */
function buildSingleWorkflow(opts: any) {
  const o = opts;
  return {
    "10": { class_type: "UNETLoader", inputs: { unet_name: o.transformerName, weight_dtype: "default" } },
    "11": { class_type: "LoraLoaderModelOnly", inputs: { model: ["10", 0], lora_name: o.loraName, strength_model: o.loraStrength } },
    "12": { class_type: "PathchSageAttentionKJ", inputs: { model: ["11", 0], sage_attention: o.sageAttention, allow_compile: o.allowCompile } },
    "13": { class_type: "DualCLIPLoader", inputs: { clip_name1: o.clipName1, clip_name2: o.clipName2, type: "ltxv", device: "default" } },
    "14": { class_type: "VAELoaderKJ", inputs: { vae_name: o.videoVaeName, device: "main_device", weight_dtype: "bf16" } },
    "15": { class_type: "VAELoaderKJ", inputs: { vae_name: o.audioVaeName, device: "main_device", weight_dtype: "bf16" } },
    "16": { class_type: "CLIPTextEncode", inputs: { clip: ["13", 0], text: o.prompt } },
    "17": { class_type: "CLIPTextEncode", inputs: { clip: ["13", 0], text: o.negativePrompt } },
    "23": { class_type: "LTXVConditioning", inputs: { positive: ["16", 0], negative: ["17", 0], frame_rate: o.fps } },
    "18": { class_type: "LoadImage", inputs: { image: o.firstFrameFilename, upload: "image" } },
    "20": { class_type: "ResizeImagesByLongerEdge", inputs: { images: ["18", 0], longer_edge: 1536 } },
    "21": { class_type: "LTXVPreprocess", inputs: { image: ["20", 0], img_compression: o.imgCompression } },
    "30": { class_type: "EmptyLTXVLatentVideo", inputs: { width: o.width, height: o.height, length: o.numFrames, batch_size: 1 } },
    "31": { class_type: "LTXVEmptyLatentAudio", inputs: { audio_vae: ["15", 0], frames_number: o.numFrames, frame_rate: o.fps, batch_size: 1 } },
    "40": { class_type: "LTXVImgToVideoInplace", inputs: { vae: ["14", 0], image: ["21", 0], latent: ["30", 0], strength: 1.0, bypass: false } },
    "42": { class_type: "LTXVConcatAVLatent", inputs: { video_latent: ["40", 0], audio_latent: ["31", 0] } },
    "43": { class_type: "RandomNoise", inputs: { noise_seed: o.seed } },
    "44": { class_type: "CFGGuider", inputs: { model: ["12", 0], positive: ["23", 0], negative: ["23", 1], cfg: o.cfg } },
    "45": { class_type: "KSamplerSelect", inputs: { sampler_name: "euler_ancestral_cfg_pp" } },
    "46": { class_type: "ManualSigmas", inputs: { sigmas: o.stage1Sigmas } },
    "47": { class_type: "SamplerCustomAdvanced", inputs: { noise: ["43", 0], guider: ["44", 0], sampler: ["45", 0], sigmas: ["46", 0], latent_image: ["42", 0] } },
    "50": { class_type: "LTXVSeparateAVLatent", inputs: { av_latent: ["47", 1] } },
    "51": { class_type: "LTXVCropGuides", inputs: { positive: ["23", 0], negative: ["23", 1], latent: ["50", 0] } },
    "52": { class_type: "LatentUpscaleModelLoader", inputs: { model_name: o.upscalerName } },
    "53": { class_type: "LTXVLatentUpsampler", inputs: { samples: ["51", 2], upscale_model: ["52", 0], vae: ["14", 0] } },
    "54": { class_type: "LTXVImgToVideoInplace", inputs: { vae: ["14", 0], image: ["21", 0], latent: ["53", 0], strength: 1.0, bypass: false } },
    "55": { class_type: "LTXVConcatAVLatent", inputs: { video_latent: ["54", 0], audio_latent: ["50", 1] } },
    "60": { class_type: "RandomNoise", inputs: { noise_seed: o.seed + 1 } },
    "61": { class_type: "CFGGuider", inputs: { model: ["12", 0], positive: ["51", 0], negative: ["51", 1], cfg: o.cfg } },
    "62": { class_type: "KSamplerSelect", inputs: { sampler_name: "euler_cfg_pp" } },
    "63": { class_type: "ManualSigmas", inputs: { sigmas: o.stage2Sigmas } },
    "64": { class_type: "SamplerCustomAdvanced", inputs: { noise: ["60", 0], guider: ["61", 0], sampler: ["62", 0], sigmas: ["63", 0], latent_image: ["55", 0] } },
    "70": { class_type: "LTXVSeparateAVLatent", inputs: { av_latent: ["64", 1] } },
    "71": { class_type: "VAEDecode", inputs: { samples: ["70", 0], vae: ["14", 0] } },
    "72": { class_type: "LTXVAudioVAEDecode", inputs: { samples: ["70", 1], audio_vae: ["15", 0] } },
    "73": { class_type: "VHS_VideoCombine", inputs: { images: ["71", 0], audio: ["72", 0], frame_rate: o.fps, loop_count: 0, filename_prefix: o.filenamePrefix, format: "video/h264-mp4", pix_fmt: "yuv420p", crf: o.crf, save_metadata: true, trim_to_audio: false, pingpong: false, save_output: true } },
  };
}

export default router.post(
  "/",
  upload.fields([{ name: "firstFrame", maxCount: 1 }, { name: "lastFrame", maxCount: 1 }]),
  validateFields({ projectId: z.coerce.number(), prompt: z.string().min(1) }),
  async (req: any, res: any) => {
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

    const files = req.files as any;
    if (!files?.firstFrame?.[0]) return res.status(400).send(error("firstFrame file is required"));
    const firstFile = files.firstFrame[0];
    const hasLastFrame = !!files?.lastFrame?.[0];
    const lastFile = hasLastFrame ? files.lastFrame[0] : null;

    let width: number, height: number;
    try {
      const dims = await computeLatentDims(firstFile.path, longestEdge, scaleFactor);
      width = dims.width; height = dims.height;
    } catch (err: any) {
      try { fs.unlinkSync(firstFile.path); } catch {}
      if (lastFile) { try { fs.unlinkSync(lastFile.path); } catch {} }
      return res.status(400).send(error(`Failed to read image: ${err.message}`));
    }

    const firstExt = path.extname(firstFile.originalname || ".png") || ".png";
    const firstFrameFilename = `${uuidv4()}${firstExt}`;
    let lastFrameFilename = "";

    try {
      copyToContainer(firstFile.path, `${LTX_CONFIG.comfyuiInputDir}/${firstFrameFilename}`);
      if (lastFile) {
        const lastExt = path.extname(lastFile.originalname || ".png") || ".png";
        lastFrameFilename = `${uuidv4()}${lastExt}`;
        copyToContainer(lastFile.path, `${LTX_CONFIG.comfyuiInputDir}/${lastFrameFilename}`);
      }
    } catch (err: any) {
      try { fs.unlinkSync(firstFile.path); } catch {}
      if (lastFile) { try { fs.unlinkSync(lastFile.path); } catch {} }
      return res.status(502).send(error(`Failed to upload image: ${err.message}`));
    }
    try { fs.unlinkSync(firstFile.path); } catch {}
    if (lastFile) { try { fs.unlinkSync(lastFile.path); } catch {} }

    const common = {
      prompt, negativePrompt, width, height, numFrames, fps, cfg, seed,
      stage1Sigmas, stage2Sigmas, transformerName, clipName1, clipName2,
      loraName, loraStrength, videoVaeName, audioVaeName, upscalerName,
      imgCompression, sageAttention, allowCompile, filenamePrefix, crf,
    };

    const workflow = hasLastFrame
      ? buildFFLFWorkflow({ ...common, firstFrameFilename, lastFrameFilename })
      : buildSingleWorkflow({ ...common, firstFrameFilename });

    try {
      // ─── GPU 全局串行队列 (gpuVramManager withGpuQueue, 2026-08-19 收编) ───
      // LTX 与 H3/TTS/music3/qwen_eye 共享 GPU1 锁 (kmc 已退役, 挂队列防误调用
      // 撞卡)。异步 taskId 模式: 锁只包「提交段」(显存预检/驱逐 + POST /prompt),
      // 作业在 ComfyUI 侧异步跑。multipart 解析/容器拷贝在队列外 (不持锁等上传)。
      const submitted = await withGpuQueue(
        "ltx",
        async () => {
          const comfyRes = await axios.post(
            `${LTX_CONFIG.comfyuiUrl}/prompt`,
            { prompt: workflow },
            { timeout: 30_000, validateStatus: (s: number) => s < 500 },
          );
          if (comfyRes.status !== 200) {
            return { kind: "rejected" as const, detail: JSON.stringify(comfyRes.data) };
          }
          return { kind: "ok" as const, promptId: comfyRes.data.prompt_id as string };
        },
        { gpuIndex: 1, comfyuiUrl: LTX_CONFIG.comfyuiUrl },
      );
      if (submitted.kind === "rejected") return res.status(502).send(error(`ComfyUI rejected: ${submitted.detail}`));
      res.status(200).send(success({
        promptId: submitted.promptId, status: "pending",
        mode: hasLastFrame ? "fflf" : "i2v",
        message: `LTX Singularity ${hasLastFrame ? "首尾帧" : "单图"} task submitted`,
        firstFrameFilename, lastFrameFilename: lastFrameFilename || undefined,
        params: { width, height, numFrames, fps, durationSec, cfg, seed, stage1Sigmas, stage2Sigmas },
      }));
    } catch (err: any) {
      if (err instanceof VramInsufficientError) {
        return res.status(503).send(error(err.message, {
          kind: "vram_insufficient",
          engine: "ltx",
          freeMiB: err.freeMiB,
          requiredMiB: err.requiredMiB,
          gpuIndex: err.gpuIndex,
        }));
      }
      const msg = err.response?.data?.error?.message || err.response?.data?.node_errors || err.message || String(err);
      res.status(502).send(error(`ComfyUI request failed: ${msg}`));
    }
  },
);
