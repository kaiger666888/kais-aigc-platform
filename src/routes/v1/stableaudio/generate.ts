import express from "express";
import { Router, Request, Response } from "express";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { withGpuQueue } from "@/lib/gpuVramManager";
import {
  SA3_CONFIG,
  SA3_MODELS,
  SA3_AUDIO_FORMATS,
} from "./config";
import {
  CommonParams,
  pollUntilComplete,
  buildCommonNodes,
  buildSaveNode,
  isBaseModel,
} from "./shared";

const router = express.Router();

// ─── Zod Schema ────────────────────────────────────────────────────────────

const generateSchema = z.object({
  /** Text prompt describing the desired audio */
  prompt: z.string().min(1).max(4000),
  /** Negative prompt (things to avoid) */
  negative_prompt: z.string().max(2000).default("low quality, distorted, noise"),
  /** Duration in seconds (max ~380s for Medium) */
  seconds_total: z.number().min(1).max(380).default(30),
  /** Start time for conditioning (usually 0) */
  seconds_start: z.number().min(0).max(380).default(0),
  /** Seed (-1 = random) */
  seed: z.number().int().default(-1),
  /** Checkpoint to use */
  model: z.enum([...SA3_MODELS]).default("stable_audio_3_medium.safetensors"),
  /** Text encoder */
  text_encoder: z.string().max(200).default("t5gemma_b_b_ul2.safetensors"),
  /** Sampler — auto-selected by model type if not specified */
  sampler_name: z
    .enum(["lcm", "euler", "euler_ancestral", "dpmpp_2m", "dpmpp_3m_sde"])
    .optional(),
  /** Scheduler */
  scheduler: z.enum(["simple", "normal", "karras", "sgm_uniform"]).default("simple"),
  /** Steps — auto-selected by model type if not specified */
  steps: z.number().int().min(1).max(200).optional(),
  /** CFG scale — auto-selected by model type if not specified */
  cfg: z.number().min(1).max(20).optional(),
  /** ModelSampling shift for AuraFlow (only used by distilled Medium model) */
  model_shift: z.number().min(0).max(10).default(1.0),
  /** Denoise strength */
  denoise: z.number().min(0).max(1).default(1.0),
  /** Batch size */
  batch_size: z.number().int().min(1).max(16).default(1),
  /** Output format */
  format: z.enum([...SA3_AUDIO_FORMATS]).default("mp3"),
  /** Filename prefix for saved audio */
  filename_prefix: z.string().max(200).default("stable_audio_3"),
  /** Optional callback URL for async completion */
  callback_url: z.string().url().optional().nullable(),
});

// ─── Workflow Builder ──────────────────────────────────────────────────────

function buildWorkflow(p: Required<GenerateParams>) {
  const nodeSeed = p.seed === -1 ? Math.floor(Math.random() * 2147483647) : p.seed;
  const isBase = isBaseModel(p.model);

  const { workflow, modelNodeId, conditioningNodeId, vaeNodeId, nextNodeId } =
    buildCommonNodes(p);

  // Node N: Empty Latent Audio
  const latentNodeId = String(nextNodeId);
  workflow[latentNodeId] = {
    class_type: "EmptyLatentAudio",
    inputs: {
      seconds: p.seconds_total,
      batch_size: p.batch_size,
    },
  };

  // Node N+1: KSampler
  const samplerNodeId = String(nextNodeId + 1);
  workflow[samplerNodeId] = {
    class_type: "KSampler",
    inputs: {
      model: [modelNodeId, 0],
      positive: [conditioningNodeId, 0],
      negative: [conditioningNodeId, 1],
      latent_image: [latentNodeId, 0],
      seed: nodeSeed,
      steps: p.steps,
      cfg: p.cfg,
      sampler_name: p.sampler_name,
      scheduler: p.scheduler,
      denoise: p.denoise,
    },
  };

  // Node N+2: VAE Decode Audio
  const decodeNodeId = String(nextNodeId + 2);
  workflow[decodeNodeId] = {
    class_type: "VAEDecodeAudio",
    inputs: {
      samples: [samplerNodeId, 0],
      vae: [vaeNodeId, 2],
    },
  };

  // Node N+3: Save Audio
  const saveNodeId = String(nextNodeId + 3);
  buildSaveNode(workflow, saveNodeId, decodeNodeId, p.format, p.filename_prefix);

  return { workflow, saveNodeId, nodeSeed };
}

type GenerateParams = z.infer<typeof generateSchema>;

// ─── Route Handler ──────────────────────────────────────────────────────────

/**
 * POST /api/v1/stableaudio/generate
 *
 * Generate audio via ComfyUI Stable Audio 3 workflow (Text-to-Audio).
 *
 * Auto-selects sampling params based on model:
 *   - Medium (distilled):  lcm/10steps/cfg=1 + ModelSamplingAuraFlow
 *   - Medium Base:         euler/50steps/cfg=7 (no AuraFlow)
 */
export default router.post("/", async (req: Request, res: Response) => {
  const parsed = generateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .send(
        error(
          "Validation failed: " +
            parsed.error.issues
              .map((i) => `${i.path.join(".")}: ${i.message}`)
              .join("; "),
        ),
      );
  }

  const raw = parsed.data;
  const isBase = isBaseModel(raw.model);

  // Auto-select params based on model type
  const p: Required<GenerateParams> = {
    ...raw,
    sampler_name: raw.sampler_name ?? (isBase ? "euler" : "lcm"),
    steps: raw.steps ?? (isBase ? 50 : 10),
    cfg: raw.cfg ?? (isBase ? 7.0 : 1.0),
    callback_url: raw.callback_url ?? null,
  } as Required<GenerateParams>;

  const comfyuiUrl = SA3_CONFIG.comfyuiUrl;
  const outputDir = SA3_CONFIG.comfyuiOutputDir;

  try {
    const { workflow, saveNodeId, nodeSeed } = buildWorkflow(p);

    // ─── GPU 全局串行队列 (gpuVramManager withGpuQueue, 2026-08-16 二期) ───
    // SA3 (~6GB) 与 TTS/H3/music3/qwen_eye 共享 GPU1 锁; 锁内「提交+轮询到完成」。
    const { prompt_id, result } = await withGpuQueue(
      "sa3",
      async () => {
        // 1. Submit prompt to ComfyUI
        const submitRes = await fetch(`${comfyuiUrl}/prompt`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: workflow }),
        });

        if (!submitRes.ok) {
          const body = await submitRes.text();
          throw new Error(`ComfyUI submit failed (${submitRes.status}): ${body}`);
        }

        const { prompt_id } = (await submitRes.json()) as {
          prompt_id: string;
          number: number;
          node_errors?: any;
        };
        if (!prompt_id) {
          throw new Error("ComfyUI returned no prompt_id");
        }

        // 2. Poll until complete
        const result = await pollUntilComplete(comfyuiUrl, prompt_id);
        return { prompt_id, result };
      },
      { gpuIndex: 1, comfyuiUrl },
    );

    if (result.status !== "success" || !result.outputs) {
      return res.status(500).send(error("ComfyUI generation failed"));
    }

    // 3. Extract output audio file
    const audioOutput = result.outputs[saveNodeId];
    if (!audioOutput || !audioOutput.audio) {
      return res
        .status(500)
        .send(error("No audio output in ComfyUI response"));
    }

    const audioFile = audioOutput.audio[0];
    const audioPath = `${outputDir}/${audioFile.filename}`;
    const audioUrl = `/api/v1/stableaudio/audio/${encodeURIComponent(audioFile.filename)}`;

    const responseData: Record<string, any> = {
      task_id: prompt_id,
      audio_path: audioPath,
      audio_url: audioUrl,
      filename: audioFile.filename,
      format: p.format,
      duration: p.seconds_total,
      seed: nodeSeed,
      model: p.model,
      prompt: p.prompt,
      sampler: p.sampler_name,
      steps: p.steps,
      cfg: p.cfg,
      model_type: isBase ? "base" : "distilled",
    };

    // 4. Optional callback
    if (p.callback_url) {
      fetch(p.callback_url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: "complete", ...responseData }),
      }).catch(() => {});
    }

    return res.send(success(responseData));
  } catch (err: any) {
    return res
      .status(500)
      .send(error(err.message || "Internal server error"));
  }
});
