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
import { withGpuQueue } from "@/lib/gpuVramManager";
import { validateFields } from "@/middleware/middleware";
import { FLUX_CONFIG, FLUX_DEFAULTS, ConsistencyMode, QuantizationMode } from "./config";

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
  quantization: QuantizationMode; // 量化模式: fp8（默认）| int8（ConvRot，Ampere 原生 INT8 加速）
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

/**
 * FLUX INT8 ConvRot 场景一致性工作流（storyboard LoRA）
 *
 * 与 FP8 storyboard 的关键区别：在 LoraLoader 与 ModelSamplingFlux 之间插入
 * INT8ModelAdapter（ComfyUI-INT8-Fast-Fork），把模型实时转成 INT8 ConvRot。
 *
 * 节点契约（容器源码核验）：INT8ModelAdapter 的 required 输入为
 *   model / enable_quantization / model_type / quantization_mode /
 *   runtime_backend / bake_loaded_loras (+ int4_mixed_ratio /
 *   small_batch_fallback / prepack_weights / log_progress，此处用节点默认值)
 * 模型流: UNETLoader(12) → LoraLoader(38) → INT8ModelAdapter(39) →
 *         ModelSamplingFlux(40) → [BasicScheduler(17), BasicGuider(22)]
 * LoRA 必须在 INT8 之前加载，配合 bake_loaded_loras:true 把 LoRA 烘焙进 INT8。
 */
function buildFluxINT8StoryboardWorkflow(opts: SceneGenOptions) {
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
    // 加载原生 bf16 模型（INT8 路径不能用 fp8 源模型，否则反量化 kernel 以
    // fp8e4nv 为目标 dtype，Ampere 不支持）。INT8 转换由下游 INT8ModelAdapter 完成。
    "12": {
      class_type: "UNETLoader",
      inputs: {
        unet_name: FLUX_DEFAULTS.int8Config.unetName,
        weight_dtype: FLUX_DEFAULTS.int8Config.unetWeightDtype,
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
        model: ["40", 0], // 连到 INT8 后的 ModelSamplingFlux
      },
    },
    "22": {
      class_type: "BasicGuider",
      inputs: { model: ["40", 0], conditioning: ["26", 0] },
    },
    "25": {
      class_type: "RandomNoise",
      inputs: { noise_seed: seed },
    },
    "26": {
      class_type: "FluxGuidance",
      inputs: { guidance, conditioning: ["6", 0] },
    },
    // LoRA 必须在 INT8 之前（bake_loaded_loras 会把它烘焙进 INT8）
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
    // Enable INT8 (INT8ModelAdapter) — ConvRot 量化
    "39": {
      class_type: "INT8ModelAdapter",
      inputs: {
        model: ["38", 0],
        enable_quantization: FLUX_DEFAULTS.int8Config.enableQuantization,
        model_type: FLUX_DEFAULTS.int8Config.modelType,
        quantization_mode: FLUX_DEFAULTS.int8Config.quantizationMode,
        int4_mixed_ratio: FLUX_DEFAULTS.int8Config.int4MixedRatio,
        small_batch_fallback: FLUX_DEFAULTS.int8Config.smallBatchFallback,
        runtime_backend: FLUX_DEFAULTS.int8Config.runtimeBackend,
        prepack_weights: FLUX_DEFAULTS.int8Config.prepackWeights,
        bake_loaded_loras: FLUX_DEFAULTS.int8Config.bakeLoadedLoras,
        log_progress: FLUX_DEFAULTS.int8Config.logProgress,
      },
    },
    "40": {
      class_type: "ModelSamplingFlux",
      inputs: {
        shift: FLUX_DEFAULTS.shift,
        max_shift: FLUX_DEFAULTS.maxShift,
        base_shift: FLUX_DEFAULTS.baseShift,
        width,
        height,
        model: ["39", 0], // INT8 model → ModelSamplingFlux
      },
    },
  };
}

/**
 * 纯 INT8 文生图（无 LoRA）：与 INT8 storyboard 相同，但 UNETLoader 直连
 * INT8ModelAdapter，跳过 LoraLoader。
 */
function buildFluxINT8PureWorkflow(opts: SceneGenOptions) {
  const wf = buildFluxINT8StoryboardWorkflow(opts);
  // 跳过 LoRA：UNET 直连 INT8ModelAdapter
  (wf as any)["39"].inputs.model = ["12", 0];
  delete (wf as any)["38"];
  return wf;
}

export function buildWorkflow(opts: SceneGenOptions): Record<string, any> {
  const useINT8 = opts.quantization === QuantizationMode.INT8;

  switch (opts.mode) {
    case ConsistencyMode.STORYBOARD_LORA:
      return useINT8 ? buildFluxINT8StoryboardWorkflow(opts) : buildFluxStoryboardWorkflow(opts);
    case ConsistencyMode.IPADAPTER_STYLE:
      return buildFluxIPAdapterWorkflow(opts); // INT8 不适配（未实现，保持抛错）
    case ConsistencyMode.COMBINED:
      return buildFluxCombinedWorkflow(opts); // INT8 不适配（未实现，保持抛错）
    case ConsistencyMode.NONE:
      return useINT8 ? buildFluxINT8PureWorkflow(opts) : buildFluxPureWorkflow(opts);
    default:
      return useINT8 ? buildFluxINT8StoryboardWorkflow(opts) : buildFluxStoryboardWorkflow(opts);
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
  quantization: z.enum(["fp8", "int8"]).default("fp8"),
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
      quantization: params.quantization as QuantizationMode,
      referenceImageName,
      filenamePrefix,
    });

    // ─── GPU 全局串行队列 (gpuVramManager withGpuQueue, 2026-08-16 二期) ───
    // FLUX (~12GB) 与 TTS/H3/music3/qwen_eye 共享 GPU1 锁; 锁内「提交+轮询到完成」。
    const { promptId, result } = await withGpuQueue(
      "flux2",
      async () => {
        const promptId = await submitPrompt(workflow);
        return { promptId, result: await pollResult(promptId) };
      },
      { gpuIndex: 1, comfyuiUrl: FLUX_CONFIG.comfyuiUrl },
    );

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
      quantization: params.quantization,
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
  quantization: z.enum(["fp8", "int8"]).default("fp8"),
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
      quantization: params.quantization as QuantizationMode,
      filenamePrefix,
    });

    // ─── GPU 全局串行队列 (gpuVramManager withGpuQueue, 2026-08-16 二期) ───
    const { promptId, result } = await withGpuQueue(
      "flux2",
      async () => {
        const promptId = await submitPrompt(workflow);
        return { promptId, result: await pollResult(promptId) };
      },
      { gpuIndex: 1, comfyuiUrl: FLUX_CONFIG.comfyuiUrl },
    );

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
      quantization: params.quantization,
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
