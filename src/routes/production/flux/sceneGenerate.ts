/**
 * Flux Dev FP8 — 场景一致性图片生成
 *
 * 支持 4 种模式:
 *   1. storyboard_lora — film-storyboard LoRA（角色+场景一致性）
 *   2. ipadapter_style — IPAdapter style lock（风格一致性）
 *   3. combined — LoRA + IPAdapter 组合
 *   4. none — 纯 Flux 文生图
 *
 * POST /api/v1/production/flux/scene-generate
 *   multipart: reference_image (可选, IPAdapter 风格参考)
 *   body: { prompt, negative_prompt, mode, width, height, batch_size, seed, steps, guidance }
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
import { FLUX_CONFIG, FLUX_DEFAULTS, ConsistencyMode } from "./config";

const router = express.Router();

const LOCAL_STAGING_DIR = "/tmp/comfyui-flux-input";
if (!fs.existsSync(LOCAL_STAGING_DIR)) {
  fs.mkdirSync(LOCAL_STAGING_DIR, { recursive: true });
}

const upload = multer({ dest: LOCAL_STAGING_DIR });

// ─── 工作流构建 ─────────────────────────────────────────────────────────────

function copyToContainer(localPath: string, containerPath: string) {
  const { execSync } = require("child_process");
  try {
    execSync(`docker cp "${localPath}" ${FLUX_CONFIG.containerName}:"${containerPath}"`, { timeout: 30_000 });
  } catch {
    throw new Error(`Failed to copy ${localPath} to container`);
  }
}

interface SceneGenOptions {
  prompt: string;
  negativePrompt: string;
  mode: ConsistencyMode;
  width: number;
  height: number;
  batchSize: number;
  seed: number;
  steps: number;
  guidance: number;
  referenceImageName?: string; // IPAdapter 风格参考图（容器内文件名）
  filenamePrefix: string;
}

function buildFluxStoryboardWorkflow(opts: SceneGenOptions) {
  const {
    prompt, negativePrompt, width, height, batchSize,
    seed, steps, guidance, filenamePrefix,
  } = opts;

  return {
    "3": {
      class_type: "KSamplerSelect",
      inputs: { sampler_name: FLUX_DEFAULTS.samplerName },
    },
    "4": {
      class_type: "CLIPTextEncode",
      inputs: { text: negativePrompt, clip: ["11", 1] },
    },
    "5": {
      class_type: "EmptySD3LatentImage",
      inputs: { width, height, batch_size: batchSize },
    },
    "6": {
      class_type: "CLIPTextEncode",
      inputs: { text: prompt, clip: ["11", 0] },
    },
    "8": {
      class_type: "VAEDecode",
      inputs: { samples: ["13", 0], vae: ["10", 0] },
    },
    "9": {
      class_type: "SaveImage",
      inputs: { filename_prefix: filenamePrefix, images: ["8", 0] },
    },
    "10": {
      class_type: "VAELoader",
      inputs: { vae_name: FLUX_DEFAULTS.vaeName },
    },
    "11": {
      class_type: "DualCLIPLoader",
      inputs: {
        clip_name1: FLUX_DEFAULTS.clipName1,
        clip_name2: FLUX_DEFAULTS.clipName2,
        type: FLUX_DEFAULTS.clipType,
      },
    },
    "12": {
      class_type: "UNETLoader",
      inputs: {
        unet_name: FLUX_DEFAULTS.unetName,
        weight_dtype: FLUX_DEFAULTS.unetWeightDtype,
      },
    },
    "13": {
      class_type: "SamplerCustomAdvanced",
      inputs: {
        noise: ["25", 0],
        guider: ["22", 0],
        sampler: ["3", 0],
        sigmas: ["17", 0],
        latent_image: ["5", 0],
      },
    },
    "17": {
      class_type: "BasicScheduler",
      inputs: {
        scheduler: FLUX_DEFAULTS.scheduler,
        steps,
        denoise: FLUX_DEFAULTS.denoise,
        model: ["30", 0],
      },
    },
    "22": {
      class_type: "BasicGuider",
      inputs: { model: ["30", 0], conditioning: ["26", 0] },
    },
    "25": {
      class_type: "RandomNoise",
      inputs: { noise_seed: seed },
    },
    "26": {
      class_type: "FluxGuidance",
      inputs: { guidance, conditioning: ["6", 0] },
    },
    "30": {
      class_type: "ModelSamplingFlux",
      inputs: {
        shift: FLUX_DEFAULTS.shift,
        max_shift: FLUX_DEFAULTS.maxShift,
        base_shift: FLUX_DEFAULTS.baseShift,
        width,
        height,
        model: ["38", 0],
      },
    },
    "38": {
      class_type: "LoraLoader",
      inputs: {
        lora_name: FLUX_DEFAULTS.storyboardLoraName,
        strength_model: FLUX_DEFAULTS.storyboardLoraStrength,
        strength_clip: 1,
        model: ["12", 0],
        clip: ["11", 0],
      },
    },
  };
}

function buildFluxIPAdapterWorkflow(opts: SceneGenOptions): Record<string, any> {
  // IPAdapter style lock 工作流（需要参考图）
  // TODO: 当 IPAdapter 节点在 comfyui-flux 容器中验证后实现
  throw new Error("IPAdapter style mode not yet implemented — use storyboard_lora mode");
}

function buildFluxCombinedWorkflow(opts: SceneGenOptions): Record<string, any> {
  // LoRA + IPAdapter 组合
  // TODO: 待 IPAdapter 验证后实现
  throw new Error("Combined mode not yet implemented — use storyboard_lora mode");
}

function buildFluxPureWorkflow(opts: SceneGenOptions) {
  const {
    prompt, negativePrompt, width, height, batchSize,
    seed, steps, guidance, filenamePrefix,
  } = opts;

  // 纯 Flux，无 LoRA
  const wf = buildFluxStoryboardWorkflow(opts);
  // 移除 LoRA 节点，UNET 直连 ModelSamplingFlux
  wf["30"].inputs.model = ["12", 0];
  delete (wf as any)["38"];
  return wf;
}

export function buildWorkflow(opts: SceneGenOptions): Record<string, any> {
  switch (opts.mode) {
    case ConsistencyMode.STORYBOARD_LORA:
      return buildFluxStoryboardWorkflow(opts);
    case ConsistencyMode.IPADAPTER_STYLE:
      return buildFluxIPAdapterWorkflow(opts);
    case ConsistencyMode.COMBINED:
      return buildFluxCombinedWorkflow(opts);
    case ConsistencyMode.NONE:
      return buildFluxPureWorkflow(opts);
    default:
      return buildFluxStoryboardWorkflow(opts);
  }
}

// ─── ComfyUI API 交互 ───────────────────────────────────────────────────────

async function submitPrompt(workflow: Record<string, any>): Promise<string> {
  const res = await axios.post(
    `${FLUX_CONFIG.comfyuiUrl}/prompt`,
    { prompt: workflow },
    { timeout: 15_000 }
  );
  return res.data.prompt_id;
}

async function pollResult(promptId: string): Promise<any> {
  const start = Date.now();
  while (Date.now() - start < FLUX_CONFIG.pollTimeoutMs) {
    const res = await axios.get(
      `${FLUX_CONFIG.comfyuiUrl}/history/${promptId}`,
      { timeout: 10_000 }
    );
    const data = res.data;
    if (data && data[promptId]) {
      const status = data[promptId].status;
      if (status.status_str === "success" || status.completed) {
        return data[promptId];
      }
      if (status.status_str === "error") {
        throw new Error(`ComfyUI execution error: ${JSON.stringify(status.messages)}`);
      }
    }
    await new Promise(r => setTimeout(r, FLUX_CONFIG.pollIntervalMs));
  }
  throw new Error(`ComfyUI prompt ${promptId} timed out after ${FLUX_CONFIG.pollTimeoutMs}ms`);
}

// ─── 路由 ───────────────────────────────────────────────────────────────────

const sceneGenSchema = z.object({
  prompt: z.string().min(1).max(8000),
  negative_prompt: z.string().max(2000).default("worst quality, low quality, blurry, deformed, ugly, duplicate"),
  mode: z.enum(["storyboard_lora", "ipadapter_style", "combined", "none"]).default("storyboard_lora"),
  width: z.number().int().min(256).max(2048).default(FLUX_DEFAULTS.defaultWidth),
  height: z.number().int().min(256).max(2048).default(FLUX_DEFAULTS.defaultHeight),
  batch_size: z.number().int().min(1).max(8).default(1),
  seed: z.number().int().default(() => Math.floor(Math.random() * 1e15)),
  steps: z.number().int().min(1).max(100).default(FLUX_DEFAULTS.steps),
  guidance: z.number().min(0).max(20).default(FLUX_DEFAULTS.guidance),
});

router.post("/scene-generate", upload.single("reference_image"), async (req: any, res: any) => {
  try {
    const params = sceneGenSchema.parse(req.body);
    const mode = params.mode as ConsistencyMode;
    const jobId = uuidv4().slice(0, 8);
    const filenamePrefix = `flux-scene-${jobId}`;

    // 如果有参考图，复制到容器
    let referenceImageName: string | undefined;
    if (req.file && (mode === ConsistencyMode.IPADAPTER_STYLE || mode === ConsistencyMode.COMBINED)) {
      referenceImageName = `ref_${jobId}${path.extname(req.file.originalname)}`;
      copyToContainer(req.file.path, `/root/ComfyUI/input/${referenceImageName}`);
    }

    // 构建工作流
    const workflow = buildWorkflow({
      prompt: params.prompt,
      negativePrompt: params.negative_prompt,
      mode,
      width: params.width,
      height: params.height,
      batchSize: params.batch_size,
      seed: params.seed,
      steps: params.steps,
      guidance: params.guidance,
      referenceImageName,
      filenamePrefix,
    });

    // 提交并轮询
    const promptId = await submitPrompt(workflow);
    const result = await pollResult(promptId);

    // 提取输出图片
    const images: Array<{ filename: string; subfolder: string }> = [];
    for (const nodeId in result.outputs) {
      const nodeOutput = result.outputs[nodeId];
      if (nodeOutput.images) {
        for (const img of nodeOutput.images) {
          images.push({ filename: img.filename, subfolder: img.subfolder || "" });
        }
      }
    }

    res.json(success({
      jobId,
      promptId,
      mode,
      seed: params.seed,
      imageCount: images.length,
      images,
      downloadUrls: images.map((img, i) =>
        `${FLUX_CONFIG.comfyuiUrl}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder)}&type=output`
      ),
    }, "Scene generation complete"));
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json(error("VALIDATION_ERROR", (err as any).errors));
    }
    res.status(500).json(error("SCENE_GEN_FAILED", err.message));
  }
});

// ─── 批量分镜生成 ───────────────────────────────────────────────────────────

const storyboardSchema = z.object({
  story_prompt: z.string().min(1).max(8000),
  scenes: z.array(z.object({
    scene_id: z.number().int(),
    location: z.string(),
    time_of_day: z.string(),
    description: z.string(),
    mood: z.string(),
  })).min(1).max(20),
  art_style: z.string().default("cinematic"),
  character_name: z.string().optional(),
  character_features: z.string().optional(), // 例: "short silver hair, glowing blue eyes, black leather jacket"
  width: z.number().int().min(256).max(2048).default(FLUX_DEFAULTS.defaultWidth),
  height: z.number().int().min(256).max(2048).default(FLUX_DEFAULTS.defaultHeight),
  seed: z.number().int().default(() => Math.floor(Math.random() * 1e15)),
  steps: z.number().int().min(1).max(100).default(FLUX_DEFAULTS.steps),
  guidance: z.number().min(0).max(20).default(FLUX_DEFAULTS.guidance),
});

router.post("/storyboard", async (req: any, res: any) => {
  try {
    const params = storyboardSchema.parse(req.body);
    const jobId = uuidv4().slice(0, 8);
    const filenamePrefix = `flux-storyboard-${jobId}`;

    // 构建 film-storyboard 格式的 prompt
    const sceneDescriptions = params.scenes.map(s =>
      `[SCENE-${s.scene_id}] ${params.character_features ? `<${params.character_name}> ${params.character_features}, ` : ""}${s.description} at ${s.location}, ${s.time_of_day}, mood: ${s.mood}`
    ).join(", ");

    const fullPrompt = `[MOVIE-SHOTS] In a ${params.art_style} story, ${sceneDescriptions}.`;

    const negativePrompt = "worst quality, low quality, blurry, deformed, ugly, duplicate, inconsistent features";

    // 构建 batch 工作流（所有场景在一个 batch 中）
    const workflow = buildWorkflow({
      prompt: fullPrompt,
      negativePrompt,
      mode: ConsistencyMode.STORYBOARD_LORA,
      width: params.width,
      height: params.height,
      batchSize: params.scenes.length,
      seed: params.seed,
      steps: params.steps,
      guidance: params.guidance,
      filenamePrefix,
    });

    // 提交并轮询
    const promptId = await submitPrompt(workflow);
    const result = await pollResult(promptId);

    // 提取输出图片
    const images: Array<{ filename: string; subfolder: string; scene_id: number }> = [];
    let imgIndex = 0;
    for (const nodeId in result.outputs) {
      const nodeOutput = result.outputs[nodeId];
      if (nodeOutput.images) {
        for (const img of nodeOutput.images) {
          images.push({
            filename: img.filename,
            subfolder: img.subfolder || "",
            scene_id: params.scenes[imgIndex]?.scene_id ?? imgIndex + 1,
          });
          imgIndex++;
        }
      }
    }

    res.json(success({
      jobId,
      promptId,
      fullPrompt,
      seed: params.seed,
      sceneCount: params.scenes.length,
      imageCount: images.length,
      scenes: params.scenes.map((s, i) => ({
        ...s,
        image: images[i] || null,
        downloadUrl: images[i]
          ? `${FLUX_CONFIG.comfyuiUrl}/view?filename=${encodeURIComponent(images[i].filename)}&subfolder=${encodeURIComponent(images[i].subfolder)}&type=output`
          : null,
      })),
    }, "Storyboard generation complete"));
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json(error("VALIDATION_ERROR", (err as any).errors));
    }
    res.status(500).json(error("STORYBOARD_FAILED", err.message));
  }
});

export default router;
