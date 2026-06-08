import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import axios from "axios";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { LTX_CONFIG, LTX_DEFAULTS } from "./config";

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

function buildTwoStageAudioI2VWorkflow(opts: {
  inputFilename: string;
  prompt: string;
  negativePrompt: string;
  width: number;
  height: number;
  numFrames: number;
  fps: number;
  cfg: number;
  seed: number;
  stage1Sampler: string;
  stage1Sigmas: string;
  stage2Sampler: string;
  stage2Sigmas: string;
  checkpointName: string;
  loraName: string;
  loraStrength: number;
  audioVaeName: string;
  strength: number;
  filenamePrefix: string;
  crf: number;
}) {
  const {
    inputFilename, prompt, negativePrompt,
    width, height, numFrames, fps, cfg, seed,
    stage1Sampler, stage1Sigmas, stage2Sampler, stage2Sigmas,
    checkpointName, loraName, loraStrength, audioVaeName,
    strength, filenamePrefix, crf,
  } = opts;

  const stage2Seed = seed + 1;

  return {
    // 100: UNETLoader (dev transformer only, mxfp8)
    "100": {
      class_type: "UNETLoader",
      inputs: {
        unet_name: checkpointName,
        weight_dtype: "mxfp8",
      },
    },
    // 101: LoraLoaderModelOnly
    "101": {
      class_type: "LoraLoaderModelOnly",
      inputs: {
        model: ["100", 0],
        lora_name: loraName,
        strength_model: loraStrength,
      },
    },
    // 102: DualCLIPLoader
    "102": {
      class_type: "DualCLIPLoader",
      inputs: {
        clip_name1: LTX_DEFAULTS.clipName1,
        clip_name2: LTX_DEFAULTS.clipName2,
        type: "ltxv",
      },
    },
    // 103: CLIPTextEncode (positive)
    "103": {
      class_type: "CLIPTextEncode",
      inputs: { clip: ["102", 0], text: prompt },
    },
    // 104: CLIPTextEncode (negative)
    "104": {
      class_type: "CLIPTextEncode",
      inputs: { clip: ["102", 0], text: negativePrompt },
    },
    // 105: LTXVConditioning
    "105": {
      class_type: "LTXVConditioning",
      inputs: {
        positive: ["103", 0],
        negative: ["104", 0],
        frame_rate: fps,
      },
    },
    // 106: LoadImage
    "106": {
      class_type: "LoadImage",
      inputs: { image: inputFilename, upload: "image" },
    },
    // 107: EmptyLTXVLatentVideo
    "107": {
      class_type: "EmptyLTXVLatentVideo",
      inputs: { width, height, length: numFrames, batch_size: 1 },
    },
    // 129: VAELoader (video VAE, separate from transformer-only checkpoint)
    "129": {
      class_type: "VAELoader",
      inputs: { vae_name: "ltx2_vae/LTX23_video_vae_bf16.safetensors" },
    },
    // 125: LTXVAudioVAELoader (separate audio VAE)
    "125": {
      class_type: "LTXVAudioVAELoader",
      inputs: { ckpt_name: audioVaeName },
    },
    // 108: LTXVEmptyLatentAudio
    "108": {
      class_type: "LTXVEmptyLatentAudio",
      inputs: {
        audio_vae: ["125", 0],
        frames_number: numFrames,
        frame_rate: fps,
        batch_size: 1,
      },
    },
    // --- Stage 1: Draft (9 steps) ---
    // 109: LTXVImgToVideoConditionOnly (Stage 1)
    "109": {
      class_type: "LTXVImgToVideoConditionOnly",
      inputs: {
        vae: ["129", 0],
        image: ["106", 0],
        latent: ["107", 0],
        strength,
        bypass: false,
      },
    },
    // 110: LTXVConcatAVLatent (Stage 1)
    "110": {
      class_type: "LTXVConcatAVLatent",
      inputs: {
        video_latent: ["109", 0],
        audio_latent: ["108", 0],
      },
    },
    // 111: RandomNoise (Stage 1)
    "111": {
      class_type: "RandomNoise",
      inputs: { noise_seed: seed },
    },
    // 112: CFGGuider (Stage 1)
    "112": {
      class_type: "CFGGuider",
      inputs: {
        model: ["101", 0],
        positive: ["105", 0],
        negative: ["105", 1],
        cfg,
      },
    },
    // 113: KSamplerSelect (Stage 1)
    "113": {
      class_type: "KSamplerSelect",
      inputs: { sampler_name: stage1Sampler },
    },
    // 114: ManualSigmas (Stage 1)
    "114": {
      class_type: "ManualSigmas",
      inputs: { sigmas: stage1Sigmas },
    },
    // 115: SamplerCustomAdvanced (Stage 1)
    "115": {
      class_type: "SamplerCustomAdvanced",
      inputs: {
        noise: ["111", 0],
        guider: ["112", 0],
        sampler: ["113", 0],
        sigmas: ["114", 0],
        latent_image: ["110", 0],
      },
    },
    // 116: LTXVSeparateAVLatent (Stage 1 output)
    "116": {
      class_type: "LTXVSeparateAVLatent",
      inputs: { av_latent: ["115", 0] },
    },
    // --- Stage 2: Refine (4 steps) ---
    // 117: LTXVImgToVideoConditionOnly (Stage 2, strength=1.0)
    "117": {
      class_type: "LTXVImgToVideoConditionOnly",
      inputs: {
        vae: ["129", 0],
        image: ["106", 0],
        latent: ["107", 0],
        strength: 1.0,
        bypass: false,
      },
    },
    // 118: LTXVConcatAVLatent (Stage 2)
    "118": {
      class_type: "LTXVConcatAVLatent",
      inputs: {
        video_latent: ["117", 0],
        audio_latent: ["116", 1],
      },
    },
    // 119: RandomNoise (Stage 2)
    "119": {
      class_type: "RandomNoise",
      inputs: { noise_seed: stage2Seed },
    },
    // 120: CFGGuider (Stage 2)
    "120": {
      class_type: "CFGGuider",
      inputs: {
        model: ["101", 0],
        positive: ["105", 0],
        negative: ["105", 1],
        cfg,
      },
    },
    // 121: KSamplerSelect (Stage 2)
    "121": {
      class_type: "KSamplerSelect",
      inputs: { sampler_name: stage2Sampler },
    },
    // 122: ManualSigmas (Stage 2)
    "122": {
      class_type: "ManualSigmas",
      inputs: { sigmas: stage2Sigmas },
    },
    // 123: SamplerCustomAdvanced (Stage 2)
    "123": {
      class_type: "SamplerCustomAdvanced",
      inputs: {
        noise: ["119", 0],
        guider: ["120", 0],
        sampler: ["121", 0],
        sigmas: ["122", 0],
        latent_image: ["118", 0],
      },
    },
    // 124: LTXVSeparateAVLatent (final)
    "124": {
      class_type: "LTXVSeparateAVLatent",
      inputs: { av_latent: ["123", 0] },
    },
    // --- Decode ---
    // 126: LTXVAudioVAEDecode
    "126": {
      class_type: "LTXVAudioVAEDecode",
      inputs: {
        samples: ["124", 1],
        audio_vae: ["125", 0],
      },
    },
    // 127: LTXVTiledVAEDecode
    "127": {
      class_type: "LTXVTiledVAEDecode",
      inputs: {
        latents: ["124", 0],
        vae: ["129", 0],
        horizontal_tiles: 2,
        vertical_tiles: 2,
        overlap: 8,
        last_frame_fix: true,
      },
    },
    // 128: VHS_VideoCombine (video + audio)
    "128": {
      class_type: "VHS_VideoCombine",
      inputs: {
        images: ["127", 0],
        audio: ["126", 0],
        frame_rate: fps,
        loop_count: 0,
        filename_prefix: filenamePrefix,
        format: "video/h264-mp4",
        pix_fmt: "yuv420p",
        crf,
        save_metadata: true,
        pingpong: false,
        save_output: true,
      },
    },
  };
}

export default router.post(
  "/",
  upload.single("sourceImage"),
  validateFields({
    projectId: z.number(),
    prompt: z.string().min(1),
  }),
  async (req, res) => {
    const { projectId, prompt } = req.body;
    const negativePrompt = req.body.negativePrompt || "";
    const width = Number(req.body.width) || 768;
    const height = Number(req.body.height) || 432;
    const numFrames = Number(req.body.numFrames) || 97;
    const fps = Number(req.body.fps) || 25;
    const cfg = Number(req.body.cfg) || 1.0;
    const seed = req.body.seed ? Number(req.body.seed) : Math.floor(Math.random() * 2147483647);
    const stage1Sampler = req.body.stage1Sampler || "euler_ancestral_cfg_pp";
    const stage1Sigmas = req.body.stage1Sigmas || "1.0, 0.99375, 0.9875, 0.98125, 0.975, 0.909375, 0.725, 0.421875, 0.0";
    const stage2Sampler = req.body.stage2Sampler || "euler_cfg_pp";
    const stage2Sigmas = req.body.stage2Sigmas || "0.85, 0.725, 0.4219, 0.0";
    const checkpointName = req.body.checkpointName || "ltx-2.3-22b-dev.safetensors";
    const loraName = req.body.loraName || LTX_DEFAULTS.loraName;
    const loraStrength = Number(req.body.loraStrength) || 0.5;
    const audioVaeName = req.body.audioVaeName || "LTX23_audio_vae_bf16.safetensors";
    const strength = Number(req.body.strength) || 0.7;
    const filenamePrefix = req.body.filenamePrefix || `ltx_audio_${projectId}_${Date.now()}`;
    const crf = Number(req.body.crf) || 19;

    if (!req.file) {
      return res.status(400).send(error("sourceImage file is required"));
    }

    // Copy uploaded image to ComfyUI container
    const ext = path.extname(req.file.originalname || ".png") || ".png";
    const inputFilename = `${uuidv4()}${ext}`;
    const containerInputPath = `${LTX_CONFIG.comfyuiInputDir}/${inputFilename}`;

    try {
      copyToContainer(req.file.path, containerInputPath);
    } catch (err: any) {
      try { fs.unlinkSync(req.file.path); } catch {}
      return res.status(502).send(error(`Failed to upload image to ComfyUI: ${err.message}`));
    }
    try { fs.unlinkSync(req.file.path); } catch {}

    const workflow = buildTwoStageAudioI2VWorkflow({
      inputFilename, prompt, negativePrompt,
      width, height, numFrames, fps, cfg, seed,
      stage1Sampler, stage1Sigmas, stage2Sampler, stage2Sigmas,
      checkpointName, loraName, loraStrength, audioVaeName,
      strength, filenamePrefix, crf,
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
        message: "LTX Two-Stage Audio I2V task submitted to ComfyUI",
        inputFilename,
      }));
    } catch (err: any) {
      const msg = err.response?.data?.error?.message || err.response?.data?.node_errors || err.message || String(err);
      res.status(502).send(error(`ComfyUI request failed: ${msg}`));
    }
  },
);
