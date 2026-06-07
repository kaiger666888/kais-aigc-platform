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

function buildFFLFWorkflow(opts: {
  firstFrameFilename: string;
  lastFrameFilename: string;
  prompt: string;
  negativePrompt: string;
  width: number;
  height: number;
  numFrames: number;
  fps: number;
  steps: number;
  cfg: number;
  seed: number;
  samplerName: string;
  scheduler: string;
  denoise: number;
  nagScale: number;
  nagAlpha: number;
  nagTau: number;
  filenamePrefix: string;
  crf: number;
}) {
  const {
    firstFrameFilename, lastFrameFilename, prompt, negativePrompt,
    width, height, numFrames, fps, steps, cfg, seed,
    samplerName, scheduler, denoise,
    nagScale, nagAlpha, nagTau,
    filenamePrefix, crf,
  } = opts;

  return {
    "1": {
      class_type: "UNETLoader",
      inputs: { unet_name: LTX_DEFAULTS.modelName, weight_dtype: "default" },
    },
    "2": {
      class_type: "DualCLIPLoader",
      inputs: {
        clip_name1: LTX_DEFAULTS.clipName1,
        clip_name2: LTX_DEFAULTS.clipName2,
        type: "ltxv",
        device: "default",
      },
    },
    "3": {
      class_type: "VAELoader",
      inputs: { vae_name: LTX_DEFAULTS.vaeName },
    },
    "4": {
      class_type: "LoadImage",
      inputs: { image: firstFrameFilename, upload: "image" },
    },
    "5": {
      class_type: "LoadImage",
      inputs: { image: lastFrameFilename, upload: "image" },
    },
    "6": {
      class_type: "EmptyLTXVLatentVideo",
      inputs: { width, height, length: numFrames, batch_size: 1 },
    },
    "7": {
      class_type: "CLIPTextEncode",
      inputs: { clip: ["2", 0], text: prompt },
    },
    "8": {
      class_type: "CLIPTextEncode",
      inputs: { clip: ["2", 0], text: negativePrompt },
    },
    "9": {
      class_type: "LTXVImgToVideoInplaceKJ",
      inputs: {
        vae: ["3", 0],
        latent: ["6", 0],
        image_1: ["4", 0],
        image_2: ["5", 0],
        num_images: 2,
      },
    },
    "10": {
      class_type: "LTXVConditioning",
      inputs: { positive: ["7", 0], negative: ["8", 0], frame_rate: fps },
    },
    "11": {
      class_type: "LTX2_NAG",
      inputs: {
        model: ["1", 0],
        nag_scale: nagScale,
        nag_alpha: nagAlpha,
        nag_tau: nagTau,
        nag_inplace: nagInplace ?? true,
      },
    },
    "12": {
      class_type: "KSampler",
      inputs: {
        model: ["11", 0],
        positive: ["10", 0],
        negative: ["10", 1],
        latent_image: ["9", 0],
        seed, steps, cfg,
        sampler_name: samplerName,
        scheduler,
        denoise,
      },
    },
    "13": {
      class_type: "VAEDecodeTiled",
      inputs: { samples: ["12", 0], vae: ["3", 0], tile_size: 512, overlap: 64, temporal_size: 64, temporal_overlap: 8 },
    },
    "14": {
      class_type: "VHS_VideoCombine",
      inputs: {
        images: ["13", 0],
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

export default router.post(
  "/",
  upload.fields([
    { name: "firstFrame", maxCount: 1 },
    { name: "lastFrame", maxCount: 1 },
  ]),
  validateFields({
    projectId: z.number(),
    prompt: z.string().min(1),
  }),
  async (req, res) => {
    const { projectId, prompt } = req.body;
    const negativePrompt = req.body.negativePrompt || "";
    const width = Number(req.body.width) || 768;
    const height = Number(req.body.height) || 512;
    const numFrames = Number(req.body.numFrames) || 161;
    const fps = Number(req.body.fps) || 25;
    const steps = Number(req.body.steps) || 30;
    const cfg = Number(req.body.cfg) || 5.5;
    const seed = req.body.seed ? Number(req.body.seed) : Math.floor(Math.random() * 2147483647);
    const samplerName = req.body.samplerName || "euler_ancestral";
    const scheduler = req.body.scheduler || "normal";
    const denoise = Number(req.body.denoise) || 1.0;
    const nagScale = Number(req.body.nagScale) || 1.0;
    const nagAlpha = Number(req.body.nagAlpha) || 0.25;
    const nagTau = Number(req.body.nagTau) || 2.5;
    const filenamePrefix = req.body.filenamePrefix || `ltx_fflf_${projectId}_${Date.now()}`;
    const crf = Number(req.body.crf) || 19;

    const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
    if (!files?.firstFrame?.[0] || !files?.lastFrame?.[0]) {
      return res.status(400).send(error("firstFrame and lastFrame files are required"));
    }

    // Copy both frames to ComfyUI container
    const firstFile = files.firstFrame[0];
    const lastFile = files.lastFrame[0];

    const firstExt = path.extname(firstFile.originalname || ".png") || ".png";
    const lastExt = path.extname(lastFile.originalname || ".png") || ".png";
    const firstFrameFilename = `${uuidv4()}${firstExt}`;
    const lastFrameFilename = `${uuidv4()}${lastExt}`;
    const containerFirstPath = `${LTX_CONFIG.comfyuiInputDir}/${firstFrameFilename}`;
    const containerLastPath = `${LTX_CONFIG.comfyuiInputDir}/${lastFrameFilename}`;

    try {
      copyToContainer(firstFile.path, containerFirstPath);
      copyToContainer(lastFile.path, containerLastPath);
    } catch (err: any) {
      try { fs.unlinkSync(firstFile.path); } catch {}
      try { fs.unlinkSync(lastFile.path); } catch {}
      return res.status(502).send(error(`Failed to upload images to ComfyUI: ${err.message}`));
    }
    try { fs.unlinkSync(firstFile.path); } catch {}
    try { fs.unlinkSync(lastFile.path); } catch {}

    const workflow = buildFFLFWorkflow({
      firstFrameFilename, lastFrameFilename, prompt, negativePrompt,
      width, height, numFrames, fps, steps, cfg, seed,
      samplerName, scheduler, denoise,
      nagScale, nagAlpha, nagTau,
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
        message: "LTX FFLF task submitted to ComfyUI",
        firstFrameFilename,
        lastFrameFilename,
      }));
    } catch (err: any) {
      const msg = err.response?.data?.error?.message || err.response?.data?.node_errors || err.message || String(err);
      res.status(502).send(error(`ComfyUI request failed: ${msg}`));
    }
  },
);
