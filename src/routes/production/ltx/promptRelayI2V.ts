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

function buildPromptRelayI2VWorkflow(opts: {
  inputFilename: string;
  prompt: string;
  localPrompts: string;
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
  strength: number;
  epsilon: number;
  filenamePrefix: string;
  crf: number;
}) {
  const {
    inputFilename, prompt, localPrompts, negativePrompt,
    width, height, numFrames, fps, steps, cfg, seed,
    samplerName, scheduler, denoise, strength, epsilon,
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
      inputs: { image: inputFilename, upload: "image" },
    },
    "5": {
      class_type: "EmptyLTXVLatentVideo",
      inputs: { width, height, length: numFrames, batch_size: 1 },
    },
    "6": {
      class_type: "LTXVImgToVideoConditionOnly",
      inputs: {
        vae: ["3", 0],
        image: ["4", 0],
        latent: ["5", 0],
        strength,
        blend_with_first: false,
      },
    },
    "7": {
      class_type: "PromptRelayEncode",
      inputs: {
        model: ["1", 0],
        clip: ["2", 0],
        latent: ["6", 0],
        global_prompt:
        local_prompts: localPrompts,
        segment_lengths: "",
        negative: negativePrompt,
        epsilon,
      },
    },
    "8": {
      class_type: "CLIPTextEncode",
      inputs: { clip: ["2", 0], text: negativePrompt },
    },
    "9": {
      class_type: "LTXVConditioning",
      inputs: { positive: ["7", 1], negative: ["8", 0], frame_rate: fps },
    },
    "10": {
      class_type: "KSampler",
      inputs: {
        model: ["7", 0],
        positive: ["9", 0],
        negative: ["9", 1],
        latent_image: ["6", 0],
        seed, steps, cfg,
        sampler_name: samplerName,
        scheduler,
        denoise,
      },
    },
    "11": {
      class_type: "VAEDecodeTiled",
      inputs: { samples: ["10", 0], vae: ["3", 0], tile_size: 512, overlap: 64, temporal_size: 64, temporal_overlap: 8 },
    },
    "12": {
      class_type: "VHS_VideoCombine",
      inputs: {
        images: ["11", 0],
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
  upload.single("sourceImage"),
  validateFields({
    projectId: z.number(),
    globalPrompt: z.string().min(1),
    localPrompts: z.string().min(1),
  }),
  async (req, res) => {
    const { projectId, globalPrompt, localPrompts } = req.body;
    const negativePrompt = req.body.negativePrompt || "";
    const width = Number(req.body.width) || 832;
    const height = Number(req.body.height) || 480;
    const numFrames = Number(req.body.numFrames) || 81;
    const fps = Number(req.body.fps) || 25;
    const steps = Number(req.body.steps) || 8;
    const cfg = Number(req.body.cfg) || 5.5;
    const seed = req.body.seed ? Number(req.body.seed) : Math.floor(Math.random() * 2147483647);
    const samplerName = req.body.samplerName || "euler_ancestral";
    const scheduler = req.body.scheduler || "normal";
    const denoise = Number(req.body.denoise) || 1.0;
    const strength = Number(req.body.strength) || 1.0;
    const epsilon = Number(req.body.epsilon) || 0.001;
    const filenamePrefix = req.body.filenamePrefix || `ltx_relay_${projectId}_${Date.now()}`;
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

    const workflow = buildPromptRelayI2VWorkflow({
      inputFilename, prompt: globalPrompt, localPrompts, negativePrompt,
      width, height, numFrames, fps, steps, cfg, seed,
      samplerName, scheduler, denoise, strength, epsilon,
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
        message: "LTX Prompt Relay I2V task submitted to ComfyUI",
        inputFilename,
      }));
    } catch (err: any) {
      const msg = err.response?.data?.error?.message || err.response?.data?.node_errors || err.message || String(err);
      res.status(502).send(error(`ComfyUI request failed: ${msg}`));
    }
  },
);
