/**
 * FLUX.2-dev — 文生图 + 状态检查（平行于 FLUX.1，不替换）
 *
 * 与 FLUX.1（sceneGenerate.ts）的关键架构差异（已对照 live ComfyUI object_info + 参考工作流核验）：
 *   - CLIPLoader 单文件（mistral_3_small_flux2, type="flux2"）替代 DualCLIPLoader(T5XXL+CLIP-L)
 *   - EmptyFlux2LatentImage 替代 EmptySD3LatentImage（FLUX.2 专属 latent）
 *   - Flux2Scheduler 替代 BasicScheduler；shift=2.02 内置于 Flux2 模型类，**不用 ModelSamplingFlux**
 *   - guidance-distilled：BasicGuider 单条件（FluxGuidance 嵌入引导），**无负向提示词**
 *   - 无 LoRA / 无 IPAdapter（FLUX.2 暂不支持）
 *   - INT8 模式：UNETLoader → INT8ModelAdapter → BasicGuider（与 FLUX.1 同节点）
 *
 * 挂载于 /api/v1/production/flux2（见 router.ts），故：
 *   GET  /api/v1/production/flux2/status
 *   POST /api/v1/production/flux2/scene-generate
 */

import express from "express";
import axios from "axios";
import { execSync } from "child_process";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { success, error } from "@/lib/responseFormat";
import { FLUX_CONFIG, FLUX2_DEFAULTS, QuantizationMode } from "./config";

const router = express.Router();

// ─── 工作流构建 ─────────────────────────────────────────────────────────────

interface Flux2GenOptions {
  prompt: string;
  width: number;
  height: number;
  batchSize: number;
  seed: number;
  steps: number;
  guidance: number;
  quantization: QuantizationMode; // fp8（直接加载 fp8mixed）| int8（INT8ModelAdapter ConvRot 量化）
  filenamePrefix: string;
}

/**
 * 构建 FLUX.2 dev 本地文生图工作流（SamplerCustomAdvanced 链）。
 *
 * 模型流：INT8 模式 UNETLoader(1) → INT8ModelAdapter(9) → BasicGuider(8)；
 *        FP8 模式 UNETLoader(1) → BasicGuider(8)（无 9 号节点）。
 * 文本流：CLIPLoader(2) → CLIPTextEncode(4) → FluxGuidance(5) → BasicGuider(8)。
 * 采样流：RandomNoise(7) + KSamplerSelect(10) + Flux2Scheduler(11) +
 *        EmptyFlux2LatentImage(6) → SamplerCustomAdvanced(12) → VAEDecode(13) → SaveImage(14)。
 */
function buildFlux2Workflow(opts: Flux2GenOptions): Record<string, any> {
  const { prompt, width, height, batchSize, seed, steps, guidance, filenamePrefix, quantization } = opts;
  const useINT8 = quantization === QuantizationMode.INT8;

  // INT8 模式才存在的节点：包裹 UNETLoader 输出做 ConvRot INT8 量化。
  // FLUX.2 源即 fp8mixed，INT8ModelAdapter 实时转换（bake_loaded_loras 无 LoRA 可烘焙，仅对齐契约）。
  const int8Node = useINT8 ? {
    "9": {
      class_type: "INT8ModelAdapter",
      inputs: {
        model: ["1", 0],
        enable_quantization: FLUX2_DEFAULTS.int8Config.enableQuantization,
        model_type: FLUX2_DEFAULTS.int8Config.modelType,
        quantization_mode: FLUX2_DEFAULTS.int8Config.quantizationMode,
        int4_mixed_ratio: FLUX2_DEFAULTS.int8Config.int4MixedRatio,
        small_batch_fallback: FLUX2_DEFAULTS.int8Config.smallBatchFallback,
        runtime_backend: FLUX2_DEFAULTS.int8Config.runtimeBackend,
        prepack_weights: FLUX2_DEFAULTS.int8Config.prepackWeights,
        bake_loaded_loras: FLUX2_DEFAULTS.int8Config.bakeLoadedLoras,
        log_progress: FLUX2_DEFAULTS.int8Config.logProgress,
      },
    },
  } : {};

  // BasicGuider 的 model 输入：INT8 接 INT8ModelAdapter(9)，否则接 UNETLoader(1)
  const modelRef = useINT8 ? ["9", 0] : ["1", 0];

  return {
    // UNETLoader — FLUX.2 dev DiT（fp8mixed）。INT8 路径同模型，量化由下游 INT8ModelAdapter 完成。
    "1": {
      class_type: "UNETLoader",
      inputs: {
        unet_name: useINT8 ? FLUX2_DEFAULTS.int8Config.unetName : FLUX2_DEFAULTS.unetName,
        weight_dtype: useINT8 ? FLUX2_DEFAULTS.int8Config.unetWeightDtype : FLUX2_DEFAULTS.unetWeightDtype,
      },
    },
    // CLIPLoader — 单文件 mistral 文本编码器。device:cpu 卸载 17GB 编码器避免 VRAM 溢出。
    "2": {
      class_type: "CLIPLoader",
      inputs: {
        clip_name: FLUX2_DEFAULTS.clipName,
        type: FLUX2_DEFAULTS.clipType,
        device: FLUX2_DEFAULTS.clipDevice,
      },
    },
    "3": {
      class_type: "VAELoader",
      inputs: { vae_name: FLUX2_DEFAULTS.vaeName },
    },
    // FLUX.2 dev 用 BasicGuider 单条件，只有正向 prompt（guidance-distilled，无负向提示词）
    "4": {
      class_type: "CLIPTextEncode",
      inputs: { clip: ["2", 0], text: prompt },
    },
    "5": {
      class_type: "FluxGuidance",
      inputs: { conditioning: ["4", 0], guidance },
    },
    "6": {
      class_type: "EmptyFlux2LatentImage",
      inputs: { width, height, batch_size: batchSize },
    },
    "7": {
      class_type: "RandomNoise",
      inputs: { noise_seed: seed },
    },
    "8": {
      class_type: "BasicGuider",
      inputs: { model: modelRef, conditioning: ["5", 0] },
    },
    "10": {
      class_type: "KSamplerSelect",
      inputs: { sampler_name: FLUX2_DEFAULTS.samplerName },
    },
    // Flux2Scheduler — FLUX.2 专用 sigma 调度（替代 BasicScheduler + ModelSamplingFlux；
    // shift=2.02 已内置于 Flux2 模型类，按 steps/width/height 计算 sigmas）
    "11": {
      class_type: "Flux2Scheduler",
      inputs: { steps, width, height },
    },
    "12": {
      class_type: "SamplerCustomAdvanced",
      inputs: {
        noise: ["7", 0],
        guider: ["8", 0],
        sampler: ["10", 0],
        sigmas: ["11", 0],
        latent_image: ["6", 0],
      },
    },
    "13": {
      class_type: "VAEDecode",
      inputs: { samples: ["12", 0], vae: ["3", 0] },
    },
    "14": {
      class_type: "SaveImage",
      inputs: { filename_prefix: filenamePrefix, images: ["13", 0] },
    },
    ...int8Node,
  };
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

// ─── 路由：状态检查 ─────────────────────────────────────────────────────────

function dockerExec(cmd: string): string {
  try {
    return execSync(cmd, { timeout: 10_000, encoding: "utf-8" }).trim();
  } catch {
    return "";
  }
}

function checkContainerRunning(): boolean {
  const out = dockerExec(`docker ps --format '{{.Names}}' --filter name=${FLUX_CONFIG.containerName}`);
  return out.includes(FLUX_CONFIG.containerName);
}

/**
 * 检查容器内模型文件存在性。
 * 注意：容器内模型根目录是 /root/ComfyUI/models/（非 host 的 /data/models/comfyui/）。
 */
function checkFileInContainer(relPath: string): boolean {
  const out = dockerExec(`docker exec ${FLUX_CONFIG.containerName} test -f /root/ComfyUI/models/${relPath} && echo YES || echo NO`);
  return out === "YES";
}

router.get("/status", async (_req: any, res: any) => {
  try {
    const containerRunning = checkContainerRunning();
    let comfyuiReady = false;
    let vramFreeGb: number | null = null;

    if (containerRunning) {
      try {
        const resp = await axios.get(`${FLUX_CONFIG.comfyuiUrl}/system_stats`, { timeout: 5_000 });
        comfyuiReady = true;
        const devices = resp.data?.devices || [];
        if (devices.length > 0) {
          vramFreeGb = Math.round((devices[0].vram_free / 1024 ** 3) * 10) / 10;
        }
      } catch { /* not ready yet */ }
    }

    const modelsAvailable = containerRunning ? {
      unet: checkFileInContainer(`diffusion_models/${FLUX2_DEFAULTS.unetName}`),
      clip: checkFileInContainer(`text_encoders/${FLUX2_DEFAULTS.clipName}`),
      vae: checkFileInContainer(`vae/${FLUX2_DEFAULTS.vaeName}`),
    } : { unet: false, clip: false, vae: false };

    res.json(success({
      containerRunning,
      comfyuiReady,
      vramFreeGb,
      modelsAvailable,
      model: "FLUX.2-dev",
      quantizationSupported: ["fp8", "int8"],
    }, `Flux.2 worker ${containerRunning ? "running" : "stopped"}`));
  } catch (err: any) {
    res.status(500).json(error("FLUX2_STATUS_FAILED", err.message));
  }
});

// ─── 路由：场景/文生图生成 ───────────────────────────────────────────────────

const flux2GenSchema = z.object({
  prompt: z.string().min(1).max(8000),
  // FLUX.2 dev 用 BasicGuider（guidance-distilled，无负向提示词）；保留参数仅为 API 一致，工作流不接入。
  negative_prompt: z.string().max(2000).default(""),
  width: z.number().int().min(256).max(2048).default(FLUX2_DEFAULTS.defaultWidth),
  height: z.number().int().min(256).max(2048).default(FLUX2_DEFAULTS.defaultHeight),
  batch_size: z.number().int().min(1).max(8).default(1),
  seed: z.number().int().default(() => Math.floor(Math.random() * 1e15)),
  steps: z.number().int().min(1).max(100).default(FLUX2_DEFAULTS.steps),
  guidance: z.number().min(0).max(20).default(FLUX2_DEFAULTS.guidance),
  quantization: z.enum(["fp8", "int8"]).default("fp8"),
});

router.post("/scene-generate", async (req: any, res: any) => {
  try {
    const params = flux2GenSchema.parse(req.body);
    const jobId = uuidv4().slice(0, 8);
    const filenamePrefix = `flux2-scene-${jobId}`;

    const workflow = buildFlux2Workflow({
      prompt: params.prompt,
      width: params.width,
      height: params.height,
      batchSize: params.batch_size,
      seed: params.seed,
      steps: params.steps,
      guidance: params.guidance,
      quantization: params.quantization as QuantizationMode,
      filenamePrefix,
    });

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
      model: "FLUX.2-dev",
      quantization: params.quantization,
      seed: params.seed,
      imageCount: images.length,
      images,
      downloadUrls: images.map((img) =>
        `${FLUX_CONFIG.comfyuiUrl}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder)}&type=output`
      ),
    }, "FLUX.2 generation complete"));
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json(error("VALIDATION_ERROR", (err as any).errors));
    }
    res.status(500).json(error("FLUX2_GEN_FAILED", err.message));
  }
});

export default router;
