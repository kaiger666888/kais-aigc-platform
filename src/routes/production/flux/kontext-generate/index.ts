/**
 * Flux Kontext Dev — 角色一致性图片生成
 *
 * 使用 Flux Kontext Dev FP8 模型，通过参考图（reference image）
 * 实现跨角度/跨场景的角色一致性生成。
 *
 * POST /api/v1/production/flux/kontext-generate
 *   multipart: reference_image (必选, 参考人物图)
 *   body: {
 *     prompt: string,           // 生成提示词
 *     negative_prompt?: string,  // 负面提示词
 *     width?: number,            // 默认 1024
 *     height?: number,           // 默认 1024
 *     batch_size?: number,       // 默认 1
 *     seed?: number,             // 默认随机
 *     steps?: number,            // 默认 28
 *     guidance?: number,         // 默认 3.5 (cfg)
 *   }
 *
 * 响应: { success: true, data: { images: [{ url, filename }], seed, elapsed_ms } }
 */

import express from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import axios from "axios";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { FLUX_CONFIG, FLUX_DEFAULTS } from "../config";

const router = express.Router();

const LOCAL_STAGING_DIR = "/tmp/comfyui-flux-input";
if (!fs.existsSync(LOCAL_STAGING_DIR)) {
  fs.mkdirSync(LOCAL_STAGING_DIR, { recursive: true });
}

const upload = multer({ dest: LOCAL_STAGING_DIR });

// ─── 工具函数 ─────────────────────────────────────────────────────────────

function copyToContainer(localPath: string, containerPath: string) {
  const { execSync } = require("child_process");
  try {
    execSync(`docker cp "${localPath}" ${FLUX_CONFIG.containerName}:"${containerPath}"`, { timeout: 30_000 });
  } catch {
    throw new Error(`Failed to copy ${localPath} to container`);
  }
}

async function pollComfyUI(promptId: string): Promise<any> {
  const startTime = Date.now();
  while (Date.now() - startTime < FLUX_CONFIG.pollTimeoutMs) {
    await new Promise((r) => setTimeout(r, FLUX_CONFIG.pollIntervalMs));
    const resp = await axios.get(`${FLUX_CONFIG.comfyuiUrl}/history/${promptId}`);
    const hist = resp.data;
    if (promptId in hist) {
      const entry = hist[promptId];
      const status = entry.status;
      if (status?.status_str === "error") {
        const msgs = status.messages || [];
        for (const m of msgs) {
          if (Array.isArray(m) && m.length > 1 && typeof m[1] === "object" && "exception_message" in m[1]) {
            throw new Error(`ComfyUI: ${m[1].exception_message}`);
          }
        }
        throw new Error("ComfyUI execution error");
      }
      const outputs = entry.outputs || {};
      return outputs;
    }
  }
  throw new Error("ComfyUI poll timeout");
}

async function fetchImage(url: string, outputPath: string) {
  const resp = await axios.get(url, { responseType: "arraybuffer", timeout: 60_000 });
  fs.writeFileSync(outputPath, resp.data);
}

// ─── Kontext 工作流构建 ───────────────────────────────────────────────────

interface KontextGenOptions {
  prompt: string;
  negativePrompt: string;
  width: number;
  height: number;
  batchSize: number;
  seed: number;
  steps: number;
  guidance: number;
  referenceImageName: string; // 容器内 input/ 目录的文件名
  filenamePrefix: string;
}

function buildKontextWorkflow(opts: KontextGenOptions) {
  const {
    prompt, negativePrompt, width, height, batchSize,
    seed, steps, guidance, referenceImageName, filenamePrefix,
  } = opts;

  return {
    // Load reference image
    "10": {
      class_type: "LoadImage",
      inputs: { image: referenceImageName },
    },
    // Scale to optimal Kontext resolution
    "11": {
      class_type: "FluxKontextImageScale",
      inputs: { image: ["10", 0] },
    },
    // Load VAE
    "12": {
      class_type: "VAELoader",
      inputs: { vae_name: FLUX_DEFAULTS.vaeName },
    },
    // Encode reference image to latent
    "13": {
      class_type: "VAEEncode",
      inputs: { pixels: ["11", 0], vae: ["12", 0] },
    },
    // Load Flux Kontext model
    "14": {
      class_type: "UNETLoader",
      inputs: {
        unet_name: "flux1-kontext-dev-fp8.safetensors",
        weight_dtype: "fp8_e4m3fn",
      },
    },
    // Dual CLIP
    "15": {
      class_type: "DualCLIPLoader",
      inputs: {
        clip_name1: FLUX_DEFAULTS.clipName2,  // clip_l
        clip_name2: "t5xxl_fp8_e4m3fn.safetensors",
        type: "flux",
      },
    },
    // Positive prompt
    "20": {
      class_type: "CLIPTextEncode",
      inputs: { text: prompt, clip: ["15", 0] },
    },
    // Negative prompt
    "22": {
      class_type: "CLIPTextEncode",
      inputs: { text: negativePrompt, clip: ["15", 0] },
    },
    // Inject reference_latents into conditioning (custom node)
    "25": {
      class_type: "FluxKontextConditioning",
      inputs: {
        positive: ["20", 0],
        negative: ["22", 0],
        reference_latent: ["13", 0],
      },
    },
    // Empty latent
    "30": {
      class_type: "EmptySD3LatentImage",
      inputs: { width, height, batch_size: batchSize },
    },
    // KSampler
    "40": {
      class_type: "KSampler",
      inputs: {
        seed,
        steps,
        cfg: guidance,
        sampler_name: FLUX_DEFAULTS.samplerName,
        scheduler: FLUX_DEFAULTS.scheduler,
        denoise: FLUX_DEFAULTS.denoise,
        model: ["14", 0],
        positive: ["25", 0],
        negative: ["25", 1],
        latent_image: ["30", 0],
      },
    },
    // Decode
    "50": {
      class_type: "VAEDecode",
      inputs: { samples: ["40", 0], vae: ["12", 0] },
    },
    // Save
    "60": {
      class_type: "SaveImage",
      inputs: { filename_prefix: filenamePrefix, images: ["50", 0] },
    },
  };
}

// ─── 路由 ─────────────────────────────────────────────────────────────────

router.post(
  "/kontext-generate",
  upload.single("reference_image"),
  async (req: any, res: any) => {
    const startTime = Date.now();

    try {
      // 验证参考图
      if (!req.file) {
        return res.status(400).json(error("reference_image is required"));
      }

      const body = req.body || {};
      const prompt = body.prompt;
      if (!prompt) {
        return res.status(400).json(error("prompt is required"));
      }

      const negativePrompt = body.negative_prompt || "";
      const width = parseInt(body.width) || 1024;
      const height = parseInt(body.height) || 1024;
      const batchSize = parseInt(body.batch_size) || 1;
      const seed = body.seed ? parseInt(body.seed) : Math.floor(Math.random() * 1_000_000);
      const steps = parseInt(body.steps) || 28;
      const guidance = parseFloat(body.guidance) || 3.5;

      const jobId = uuidv4().slice(0, 8);

      // 1. 上传参考图到 ComfyUI 容器
      const refExt = path.extname(req.file.originalname) || ".png";
      const refName = `kontext_ref_${jobId}${refExt}`;
      const containerInputPath = `/root/ComfyUI/input/${refName}`;
      copyToContainer(req.file.path, containerInputPath);

      // 2. 构建工作流
      const filenamePrefix = `kontext_${jobId}`;
      const workflow = buildKontextWorkflow({
        prompt,
        negativePrompt,
        width,
        height,
        batchSize,
        seed,
        steps,
        guidance,
        referenceImageName: refName,
        filenamePrefix,
      });

      // 3. 提交到 ComfyUI
      const submitResp = await axios.post(
        `${FLUX_CONFIG.comfyuiUrl}/prompt`,
        { prompt: workflow },
        { headers: { "Content-Type": "application/json" }, timeout: 30_000 }
      );
      const promptId = submitResp.data.prompt_id;

      // 4. 轮询结果
      const outputs = await pollComfyUI(promptId);

      // 5. 收集输出图片
      const images: { url: string; filename: string }[] = [];
      const outputNode = outputs["60"];
      if (outputNode?.images) {
        for (const img of outputNode.images) {
          const fname = img.filename;
          const subfolder = img.subfolder || "";
          const imgUrl = `${FLUX_CONFIG.comfyuiUrl}/view?filename=${encodeURIComponent(fname)}&subfolder=${encodeURIComponent(subfolder)}&type=output`;

          // 下载到本地 staging
          const localPath = path.join(LOCAL_STAGING_DIR, fname);
          await fetchImage(imgUrl, localPath);

          images.push({ url: imgUrl, filename: fname });
        }
      }

      const elapsedMs = Date.now() - startTime;

      // 6. 清理临时文件
      try { fs.unlinkSync(req.file.path); } catch {}

      return res.json(
        success({
          images,
          seed,
          steps,
          guidance,
          elapsed_ms: elapsedMs,
        }, "Kontext generation complete")
      );
    } catch (err: any) {
      console.error("[flux/kontext-generate] Error:", err.message);
      return res.status(500).json(error(err.message || "Kontext generation failed"));
    }
  }
);

export default router;
