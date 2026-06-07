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

function buildExtensionWorkflow(opts: {
  inputVideoFilename: string;
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
  loraStrength: number;
  strength: number;
  startFrame: number;
  filenamePrefix: string;
  crf: number;
}) {
  const {
    inputVideoFilename, prompt, negativePrompt,
    width, height, numFrames, fps, steps, cfg, seed,
    samplerName, scheduler, denoise, loraStrength, strength,
    startFrame, filenamePrefix, crf,
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
      class_type: "VHS_LoadVideoPath",
      inputs: {
        video: inputVideoFilename,
        force_rate: 0,
        force_size: "Disabled",
        custom_width: 0,
        custom_height: 0,
        frame_load_cap: 0,
        skip_first_frames: 0,
        select_every_nth: 1,
        "choose video to preview": "start_frame",
        videopreview: { hidden: false, paused: false, params: {} },
      },
    },
    "5": {
      class_type: "GetImagesFromBatchIndexed",
      inputs: { images: ["4", 0], indexes: String(startFrame) },
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
      class_type: "LTXVImgToVideoConditionOnly",
      inputs: {
        vae: ["3", 0],
        image: ["5", 0],
        latent: ["6", 0],
        strength,
        blend_with_first: false,
      },
    },
    "10": {
      class_type: "LoraLoaderModelOnly",
      inputs: {
        model: ["1", 0],
        lora_name: LTX_DEFAULTS.loraName,
        strength_model: loraStrength,
      },
    },
    "11": {
      class_type: "LTXVConditioning",
      inputs: { positive: ["7", 0], negative: ["8", 0], frame_rate: fps },
    },
    "12": {
      class_type: "KSampler",
      inputs: {
        model: ["10", 0],
        positive: ["11", 0],
        negative: ["11", 1],
        latent_image: ["9", 0],
        seed, steps, cfg,
        sampler_name: samplerName,
        scheduler,
        denoise,
      },
    },
    "13": {
      class_type: "VAEDecodeTiled",
      inputs: { samples: ["12", 0], vae: ["3", 0], tile_size: 128, overlap: 64 },
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
  upload.single("sourceVideo"),
  validateFields({
    projectId: z.number(),
    prompt: z.string().min(1),
  }),
  async (req, res) => {
    const { projectId, prompt } = req.body;
    const negativePrompt = req.body.negativePrompt || "";
    const width = Number(req.body.width) || 832;
    const height = Number(req.body.height) || 480;
    const numFrames = Number(req.body.numFrames) || 49;
    const fps = Number(req.body.fps) || 25;
    const steps = Number(req.body.steps) || 8;
    const cfg = Number(req.body.cfg) || 5.5;
    const seed = req.body.seed ? Number(req.body.seed) : Math.floor(Math.random() * 2147483647);
    const samplerName = req.body.samplerName || "euler_ancestral";
    const scheduler = req.body.scheduler || "normal";
    const denoise = Number(req.body.denoise) || 1.0;
    const loraStrength = Number(req.body.loraStrength) || -0.3;
    const strength = Number(req.body.strength) || 1.0;
    const startFrame = Number(req.body.startFrame) || -1;
    const filenamePrefix = req.body.filenamePrefix || `ltx_extend_${projectId}_${Date.now()}`;
    const crf = Number(req.body.crf) || 19;

    if (!req.file) {
      return res.status(400).send(error("sourceVideo file is required"));
    }

    // Copy uploaded video to ComfyUI container
    const ext = path.extname(req.file.originalname || ".mp4") || ".mp4";
    const inputFilename = `${uuidv4()}${ext}`;
    const containerInputPath = `${LTX_CONFIG.comfyuiInputDir}/${inputFilename}`;

    try {
      copyToContainer(req.file.path, containerInputPath);
    } catch (err: any) {
      try { fs.unlinkSync(req.file.path); } catch {}
      return res.status(502).send(error(`Failed to upload video to ComfyUI: ${err.message}`));
    }
    try { fs.unlinkSync(req.file.path); } catch {}

    const workflow = buildExtensionWorkflow({
      inputVideoFilename: inputFilename, prompt, negativePrompt,
      width, height, numFrames, fps, steps, cfg, seed,
      samplerName, scheduler, denoise, loraStrength, strength,
      startFrame, filenamePrefix, crf,
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
        message: "LTX Extension task submitted to ComfyUI",
        inputFilename,
      }));
    } catch (err: any) {
      const msg = err.response?.data?.error?.message || err.response?.data?.node_errors || err.message || String(err);
      res.status(502).send(error(`ComfyUI request failed: ${msg}`));
    }
  },
);
