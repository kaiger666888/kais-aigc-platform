import express from "express";
import { Router, Request, Response } from "express";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { withGpuQueue, resolveDispatchGpuIndex, comfyuiUrlForGpu, pinTaskGpu, gpuOutputRoots } from "@/lib/gpuVramManager";
import {
  SA3_CONFIG,
  SA3_MODELS,
  SA3_AUDIO_FORMATS,
} from "./config";
import {
  CommonParams,
  pollUntilComplete,
  uploadAudioToComfyUI,
  buildCommonNodes,
  buildSaveNode,
  isBaseModel,
} from "./shared";

const router = express.Router();

// ─── Zod Schema ────────────────────────────────────────────────────────────

const transformSchema = z.object({
  /** Text prompt describing the desired transformation */
  prompt: z.string().min(1).max(4000),
  /** Negative prompt */
  negative_prompt: z.string().max(2000).default("low quality, distorted, noise"),
  /** Path to input audio file (on server filesystem) */
  input_audio_path: z.string().min(1).max(500),
  /** Denoise strength: 0 = keep original entirely, 1 = fully regenerate.
   *  Typically 0.3-0.7 for style transfer, 0.5-0.8 for strong modification. */
  denoise: z.number().min(0.01).max(1).default(0.6),
  /** Seed (-1 = random) */
  seed: z.number().int().default(-1),
  /** Checkpoint to use */
  model: z.enum([...SA3_MODELS]).default("stable_audio_3_medium_base.safetensors"),
  /** Text encoder */
  text_encoder: z.string().max(200).default("t5gemma_b_b_ul2.safetensors"),
  /** Sampler — auto-selected by model type if not specified */
  sampler_name: z
    .enum(["lcm", "euler", "euler_ancestral", "dpmpp_2m"])
    .optional(),
  /** Scheduler */
  scheduler: z.enum(["simple", "normal", "karras", "sgm_uniform"]).default("simple"),
  /** Steps — auto-selected by model type if not specified */
  steps: z.number().int().min(1).max(200).optional(),
  /** CFG scale */
  cfg: z.number().min(1).max(20).optional(),
  /** ModelSampling shift for AuraFlow */
  model_shift: z.number().min(0).max(10).default(1.0),
  /** Output format */
  format: z.enum([...SA3_AUDIO_FORMATS]).default("mp3"),
  /** Filename prefix */
  filename_prefix: z.string().max(200).default("stable_audio_3_transform"),
  /** Optional callback URL */
  callback_url: z.string().url().optional().nullable(),
});

// ─── Workflow Builder ──────────────────────────────────────────────────────

/**
 * Audio-to-Audio workflow topology:
 *
 *   1. CheckpointLoaderSimple → MODEL + VAE
 *   2. CLIPLoader (t5gemma) → CLIP
 *   3. CLIPTextEncode (positive)
 *   4. CLIPTextEncode (negative)
 *   5. ConditioningStableAudio
 *   [6/7]. ModelSamplingAuraFlow (distilled only)
 *   N.   LoadAudio (uploaded input) → AUDIO
 *   N+1. VAEEncodeAudio (AUDIO + VAE) → LATENT (init_audio)
 *   N+2. KSampler (denoise < 1.0 → partial noise → style transfer)
 *   N+3. VAEDecodeAudio → AUDIO
 *   N+4. SaveAudio/SaveAudioMP3
 */
function buildTransformWorkflow(
  p: Required<TransformParams>,
  uploadedFilename: string,
) {
  const nodeSeed = p.seed === -1 ? Math.floor(Math.random() * 2147483647) : p.seed;
  const isBase = isBaseModel(p.model);

  const commonParams: CommonParams = {
    ...p,
    seconds_total: 0, // not used in audio2audio (derived from input)
    seconds_start: 0,
    batch_size: 1,
  };
  const { workflow, modelNodeId, conditioningNodeId, vaeNodeId, nextNodeId } =
    buildCommonNodes(commonParams);

  // Node N: LoadAudio (uploaded input)
  const loadNodeId = String(nextNodeId);
  workflow[loadNodeId] = {
    class_type: "LoadAudio",
    inputs: { audio: uploadedFilename },
  };

  // Node N+1: VAEEncodeAudio (input → latent)
  const encodeNodeId = String(nextNodeId + 1);
  workflow[encodeNodeId] = {
    class_type: "VAEEncodeAudio",
    inputs: {
      audio: [loadNodeId, 0],
      vae: [vaeNodeId, 2],
    },
  };

  // Node N+2: KSampler (with init latent, denoise < 1.0)
  const samplerNodeId = String(nextNodeId + 2);
  workflow[samplerNodeId] = {
    class_type: "KSampler",
    inputs: {
      model: [modelNodeId, 0],
      positive: [conditioningNodeId, 0],
      negative: [conditioningNodeId, 1],
      latent_image: [encodeNodeId, 0],
      seed: nodeSeed,
      steps: p.steps,
      cfg: p.cfg,
      sampler_name: p.sampler_name,
      scheduler: p.scheduler,
      denoise: p.denoise,
    },
  };

  // Node N+3: VAE Decode Audio
  const decodeNodeId = String(nextNodeId + 3);
  workflow[decodeNodeId] = {
    class_type: "VAEDecodeAudio",
    inputs: {
      samples: [samplerNodeId, 0],
      vae: [vaeNodeId, 2],
    },
  };

  // Node N+4: Save Audio
  const saveNodeId = String(nextNodeId + 4);
  buildSaveNode(workflow, saveNodeId, decodeNodeId, p.format, p.filename_prefix);

  return { workflow, saveNodeId, nodeSeed };
}

type TransformParams = z.infer<typeof transformSchema>;

// ─── Route Handler ──────────────────────────────────────────────────────────

/**
 * POST /api/v1/stableaudio/transform
 *
 * Audio-to-Audio: transform an existing audio file using a text prompt.
 *
 * Body:
 *   prompt: string (required) — describe the desired transformation
 *   input_audio_path: string (required) — server path to input audio
 *   denoise: number — 0.01-1.0 (default 0.6; lower = closer to original)
 *
 * Use cases:
 *   - Style transfer: "bossa nova guitar version" with denoise=0.5
 *   - Mood change: "dark horror version" with denoise=0.6
 *   - Instrument swap: "piano arrangement" with denoise=0.7
 */
export default router.post("/", async (req: Request, res: Response) => {
  const parsed = transformSchema.safeParse(req.body);
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

  const p: Required<TransformParams> = {
    ...raw,
    sampler_name: raw.sampler_name ?? (isBase ? "euler" : "lcm"),
    steps: raw.steps ?? (isBase ? 50 : 10),
    cfg: raw.cfg ?? (isBase ? 7.0 : 1.0),
    callback_url: raw.callback_url ?? null,
  } as Required<TransformParams>;

  // ── M4 双实例选卡 (gpuDispatch): 白名单命中且 GPU2 探活成功 → secondary;
  // 输出目录随实例切换 (secondary 容器 --output-directory → /mnt/agents/output/gpu2) ──
  const dispatch = await resolveDispatchGpuIndex("sa3");
  const comfyuiUrl = dispatch.secondary ? comfyuiUrlForGpu(2) : SA3_CONFIG.comfyuiUrl;
  const outputDir = dispatch.secondary ? gpuOutputRoots()[1] : SA3_CONFIG.comfyuiOutputDir;

  try {
    // 0. Upload input audio to ComfyUI input dir
    const uploadFilename = `sa3_input_${Date.now()}.${raw.input_audio_path.split(".").pop() || "wav"}`;
    const uploadedFilename = await uploadAudioToComfyUI(
      comfyuiUrl,
      raw.input_audio_path,
      uploadFilename,
    );

    // 1. Build and submit workflow
    const { workflow, saveNodeId, nodeSeed } = buildTransformWorkflow(p, uploadedFilename);

    // ─── GPU 全局串行队列 (gpuVramManager withGpuQueue, 2026-08-16 二期) ───
    // SA3 transform (~6GB) 与 TTS/H3/music3/qwen_eye 共享 GPU1 锁; 锁内「提交+轮询到完成」。
    const { prompt_id, result } = await withGpuQueue(
      "sa3",
      async () => {
        const submitRes = await fetch(`${comfyuiUrl}/prompt`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: workflow }),
        });

        if (!submitRes.ok) {
          const body = await submitRes.text();
          throw new Error(`ComfyUI submit failed (${submitRes.status}): ${body}`);
        }

        const { prompt_id } = (await submitRes.json()) as { prompt_id: string };
        if (!prompt_id) {
          throw new Error("ComfyUI returned no prompt_id");
        }

        // 2. Poll until complete
        const result = await pollUntilComplete(comfyuiUrl, prompt_id);
        return { prompt_id, result };
      },
      { gpuIndex: dispatch.gpuIndex, comfyuiUrl },
    );
    pinTaskGpu(prompt_id, dispatch.gpuIndex);

    if (result.status !== "success" || !result.outputs) {
      return res.status(500).send(error("ComfyUI generation failed"));
    }

    // 3. Extract output
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
      seed: nodeSeed,
      model: p.model,
      prompt: p.prompt,
      input_audio: raw.input_audio_path,
      denoise: p.denoise,
      sampler: p.sampler_name,
      steps: p.steps,
      cfg: p.cfg,
      model_type: isBase ? "base" : "distilled",
    };

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
