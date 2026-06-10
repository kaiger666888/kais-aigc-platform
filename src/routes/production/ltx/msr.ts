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

function buildMSRWorkflow(opts: {
  ref1Filename: string;
  ref2Filename: string;
  backgroundFilename: string;
  prompt: string;
  negativePrompt: string;
  width: number;
  height: number;
  numFrames: number;
  msrFrameCount: number;
  fps: number;
  seed: number;
  loraStrength: number;
  filenamePrefix: string;
}) {
  const {
    ref1Filename, ref2Filename, backgroundFilename,
    prompt, negativePrompt,
    width, height, numFrames, msrFrameCount, fps,
    seed, loraStrength, filenamePrefix,
  } = opts;

  return {
    "3": {
      class_type: "LowVRAMCheckpointLoader",
      inputs: { ckpt_name: LTX_DEFAULTS.msrModelName },
    },
    "26": {
      class_type: "LTXAVTextEncoderLoader",
      inputs: {
        text_encoder: LTX_DEFAULTS.clipName1,
        ckpt_name: LTX_DEFAULTS.msrModelName,
        device: "default",
      },
    },
    "10": {
      class_type: "LTXICLoRALoaderModelOnly",
      inputs: {
        model: ["3", 0],
        lora_name: LTX_DEFAULTS.msrLoraName,
        strength_model: loraStrength,
      },
    },
    "5": {
      class_type: "CLIPTextEncode",
      inputs: { text: prompt, clip: ["26", 0] },
    },
    "6": {
      class_type: "CLIPTextEncode",
      inputs: { text: negativePrompt, clip: ["26", 0] },
    },
    "7": {
      class_type: "LTXVConditioning",
      inputs: { positive: ["5", 0], negative: ["6", 0], frame_rate: fps },
    },
    "8": {
      class_type: "EmptyLTXVLatentVideo",
      inputs: { width, height, length: numFrames, batch_size: 1 },
    },
    "28": {
      class_type: "LiconMSR",
      inputs: {
        width,
        height,
        frame_count: msrFrameCount,
        "1": ["40", 0],
        "2": ["29", 0],
        background: ["30", 0],
      },
    },
    "29": {
      class_type: "LoadImage",
      inputs: { image: ref2Filename },
    },
    "40": {
      class_type: "LoadImage",
      inputs: { image: ref1Filename },
    },
    "30": {
      class_type: "LoadImage",
      inputs: { image: backgroundFilename },
    },
    "9": {
      class_type: "LTXAddVideoICLoRAGuide",
      inputs: {
        positive: ["7", 0],
        negative: ["7", 1],
        vae: ["3", 2],
        latent: ["8", 0],
        image: ["28", 0],
        frame_idx: 0,
        strength: 1.0,
        latent_downscale_factor: 1,
        crop: "center",
        use_tiled_encode: false,
        tile_size: 256,
        tile_overlap: 64,
      },
    },
    "15": {
      class_type: "RandomNoise",
      inputs: { noise_seed: seed },
    },
    "27": {
      class_type: "ManualSigmas",
      inputs: { sigmas: "1.0, 0.99375, 0.9875, 0.98125, 0.975, 0.909375, 0.725, 0.421875, 0.0" },
    },
    "13": {
      class_type: "KSamplerSelect",
      inputs: { sampler_name: "euler" },
    },
    "37": {
      class_type: "CFGGuider",
      inputs: {
        model: ["10", 0],
        positive: ["9", 0],
        negative: ["9", 1],
        cfg: 1.0,
      },
    },
    "16": {
      class_type: "SamplerCustomAdvanced",
      inputs: {
        noise: ["15", 0],
        guider: ["37", 0],
        sampler: ["13", 0],
        sigmas: ["27", 0],
        latent_image: ["9", 2],
      },
    },
    "17": {
      class_type: "LTXVCropGuides",
      inputs: {
        positive: ["9", 0],
        negative: ["9", 1],
        latent: ["16", 0],
      },
    },
    "38": {
      class_type: "VAEDecode",
      inputs: { samples: ["17", 2], vae: ["3", 2] },
    },
    "19": {
      class_type: "CreateVideo",
      inputs: { images: ["38", 0], fps },
    },
    "20": {
      class_type: "SaveVideo",
      inputs: {
        video: ["19", 0],
        filename_prefix: filenamePrefix,
        format: "auto",
        codec: "auto",
      },
    },
  };
}

export default router.post(
  "/",
  upload.fields([
    { name: "ref1", maxCount: 1 },
    { name: "ref2", maxCount: 1 },
    { name: "background", maxCount: 1 },
  ]),
  validateFields({
    projectId: z.number(),
    prompt: z.string().min(1),
  }),
  async (req, res) => {
    const { projectId, prompt } = req.body;
    const negativePrompt = req.body.negativePrompt || "";
    const width = Number(req.body.width) || 1280;
    const height = Number(req.body.height) || 1920;
    const numFrames = Number(req.body.numFrames) || 145;
    const msrFrameCount = Number(req.body.msrFrameCount) || 41;
    const fps = Number(req.body.fps) || 25;
    const seed = req.body.seed ? Number(req.body.seed) : Math.floor(Math.random() * 2147483647);
    const loraStrength = Number(req.body.loraStrength) || 1.0;
    const filenamePrefix = req.body.filenamePrefix || `ltx_msr_${projectId}_${Date.now()}`;

    const files = req.files as Record<string, Express.Multer.File[]>;
    if (!files?.ref1?.[0] || !files?.ref2?.[0] || !files?.background?.[0]) {
      return res.status(400).send(error("Three reference images are required: ref1, ref2, background"));
    }

    // Copy uploaded images to ComfyUI container
    const uploadedFiles: Express.Multer.File[] = [files.ref1[0], files.ref2[0], files.background[0]];
    const filenames: string[] = [];
    const containerPaths: string[] = [];

    try {
      for (const file of uploadedFiles) {
        const ext = path.extname(file.originalname || ".png") || ".png";
        const filename = `${uuidv4()}${ext}`;
        const containerPath = `${LTX_CONFIG.comfyuiInputDir}/${filename}`;
        filenames.push(filename);
        containerPaths.push(containerPath);
        copyToContainer(file.path, containerPath);
      }
    } catch (err: any) {
      // Cleanup on failure
      for (const file of uploadedFiles) {
        try { fs.unlinkSync(file.path); } catch {}
      }
      return res.status(502).send(error(`Failed to upload images to ComfyUI: ${err.message}`));
    }

    // Cleanup local staging files
    for (const file of uploadedFiles) {
      try { fs.unlinkSync(file.path); } catch {}
    }

    const workflow = buildMSRWorkflow({
      ref1Filename: filenames[0],
      ref2Filename: filenames[1],
      backgroundFilename: filenames[2],
      prompt, negativePrompt,
      width, height, numFrames, msrFrameCount, fps,
      seed, loraStrength, filenamePrefix,
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
        message: "LTX LiconMSR multi-reference task submitted to ComfyUI",
        filenames,
      }));
    } catch (err: any) {
      const msg = err.response?.data?.error?.message || err.response?.data?.node_errors || err.message || String(err);
      res.status(502).send(error(`ComfyUI request failed: ${msg}`));
    }
  },
);
