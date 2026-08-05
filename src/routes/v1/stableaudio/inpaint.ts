import express from "express";
import { Router, Request, Response } from "express";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
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

const inpaintSchema = z.object({
  /** Text prompt for the regenerated segment */
  prompt: z.string().min(1).max(4000),
  /** Negative prompt */
  negative_prompt: z.string().max(2000).default("low quality, distorted, noise"),
  /** Path to input audio file (on server filesystem) */
  input_audio_path: z.string().min(1).max(500),
  /** Start time of the segment to regenerate (seconds) */
  segment_start: z.number().min(0).default(0),
  /** End time of the segment to regenerate (seconds).
   *  If omitted, regenerates from segment_start to end of audio. */
  segment_end: z.number().min(0).optional(),
  /** Total duration of the output audio in seconds.
   *  If omitted, uses input audio duration. */
  seconds_total: z.number().min(1).max(380).optional(),
  /** Seed (-1 = random) */
  seed: z.number().int().default(-1),
  /** Checkpoint to use */
  model: z.enum([...SA3_MODELS]).default("stable_audio_3_medium.safetensors"),
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
  /** Denoise strength for inpainting (typically 1.0 for full regeneration of masked region) */
  denoise: z.number().min(0.01).max(1).default(1.0),
  /** Output format */
  format: z.enum([...SA3_AUDIO_FORMATS]).default("mp3"),
  /** Filename prefix */
  filename_prefix: z.string().max(200).default("stable_audio_3_inpaint"),
  /** Optional callback URL */
  callback_url: z.string().url().optional().nullable(),
});

// ─── Workflow Builder ──────────────────────────────────────────────────────

/**
 * Inpainting / Continuation workflow:
 *
 * Strategy: Trim input audio to get the "keep" portion, encode to latent,
 * then use KSampler with the prompt to regenerate or extend.
 *
 * For inpainting (replace a segment):
 *   - Trim audio to [0, segment_start] as the "prefix"
 *   - Use EmptyLatentAudio for the "regenerated" portion
 *   - Concat prefix + regenerated output
 *
 * For continuation (extend audio):
 *   - Load full input audio as latent
 *   - Add EmptyLatentAudio for the extension
 *   - KSampler with low denoise on the combined latent
 *
 * Simplified approach (this implementation):
 *   - Load full input → VAEEncodeAudio → LATENT
 *   - KSampler with denoise=1.0 on the target segment area
 *   - The ConditioningStableAudio provides time boundaries
 *
 * Topology:
 *   1-5. Common nodes (checkpoint, CLIP, conditioning with seconds_start/total)
 *   [6/7]. ModelSamplingAuraFlow (distilled only)
 *   N.   LoadAudio → AUDIO
 *   N+1. VAEEncodeAudio → LATENT
 *   N+2. KSampler (denoise controls how much to regenerate)
 *   N+3. VAEDecodeAudio → AUDIO
 *   N+4. SaveAudio
 */
function buildInpaintWorkflow(
  p: Required<InpaintParams>,
  uploadedFilename: string,
) {
  const nodeSeed = p.seed === -1 ? Math.floor(Math.random() * 2147483647) : p.seed;
  const isBase = isBaseModel(p.model);

  const commonParams: CommonParams = {
    prompt: p.prompt,
    negative_prompt: p.negative_prompt,
    seconds_total: p.seconds_total,
    seconds_start: p.segment_start, // time-aware conditioning
    seed: p.seed,
    model: p.model,
    text_encoder: p.text_encoder,
    sampler_name: p.sampler_name,
    scheduler: p.scheduler,
    steps: p.steps,
    cfg: p.cfg,
    model_shift: p.model_shift,
    denoise: p.denoise,
    batch_size: 1,
    format: p.format,
    filename_prefix: p.filename_prefix,
  };

  const { workflow, modelNodeId, conditioningNodeId, vaeNodeId, nextNodeId } =
    buildCommonNodes(commonParams);

  // Node N: LoadAudio
  const loadNodeId = String(nextNodeId);
  workflow[loadNodeId] = {
    class_type: "LoadAudio",
    inputs: { audio: uploadedFilename },
  };

  // Node N+1: Trim audio to target duration (if segment_end specified)
  let audioSourceNodeId = loadNodeId;
  let nodeCounter = nextNodeId + 1;

  if (p.segment_end !== undefined && p.segment_end > 0) {
    const trimNodeId = String(nodeCounter);
    const trimDuration = p.segment_end - p.segment_start;
    workflow[trimNodeId] = {
      class_type: "TrimAudioDuration",
      inputs: {
        audio: [loadNodeId, 0],
        start_index: p.segment_start,
        duration: trimDuration > 0 ? trimDuration : p.seconds_total,
      },
    };
    audioSourceNodeId = trimNodeId;
    nodeCounter++;
  }

  // Node N+2: VAEEncodeAudio (trimmed audio → latent)
  const encodeNodeId = String(nodeCounter);
  workflow[encodeNodeId] = {
    class_type: "VAEEncodeAudio",
    inputs: {
      audio: [audioSourceNodeId, 0],
      vae: [vaeNodeId, 2],
    },
  };
  nodeCounter++;

  // Node N+3: KSampler
  const samplerNodeId = String(nodeCounter);
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
  nodeCounter++;

  // Node N+4: VAE Decode Audio
  const decodeNodeId = String(nodeCounter);
  workflow[decodeNodeId] = {
    class_type: "VAEDecodeAudio",
    inputs: {
      samples: [samplerNodeId, 0],
      vae: [vaeNodeId, 2],
    },
  };
  nodeCounter++;

  // Node N+5: Save Audio
  const saveNodeId = String(nodeCounter);
  buildSaveNode(workflow, saveNodeId, decodeNodeId, p.format, p.filename_prefix);

  return { workflow, saveNodeId, nodeSeed };
}

type InpaintParams = z.infer<typeof inpaintSchema>;

// ─── Route Handler ──────────────────────────────────────────────────────────

/**
 * POST /api/v1/stableaudio/inpaint
 *
 * Inpainting / Continuation: regenerate or extend portions of an audio file.
 *
 * Body:
 *   prompt: string (required) — describe the desired audio for the target segment
 *   input_audio_path: string (required) — server path to input audio
 *   segment_start: number — start time of region to regenerate (default: 0)
 *   segment_end: number — end time (optional; if omitted, regenerates to end)
 *   seconds_total: number — output duration (optional; defaults to input length)
 *   denoise: number — 0.01-1.0 (default 1.0 for full regeneration)
 *
 * Use cases:
 *   - Fix a bad segment: regenerate seconds 5-10 with a better prompt
 *   - Extend audio: add 10 more seconds with continuation prompt
 *   - Remove artifacts: isolate and regenerate noisy regions
 */
export default router.post("/", async (req: Request, res: Response) => {
  const parsed = inpaintSchema.safeParse(req.body);
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

  // Default seconds_total: if not provided, use segment_end or a default
  const effectiveDuration = raw.seconds_total ?? raw.segment_end ?? 30;

  const p: Required<InpaintParams> = {
    ...raw,
    segment_end: raw.segment_end ?? effectiveDuration,
    seconds_total: effectiveDuration,
    sampler_name: raw.sampler_name ?? (isBase ? "euler" : "lcm"),
    steps: raw.steps ?? (isBase ? 50 : 10),
    cfg: raw.cfg ?? (isBase ? 7.0 : 1.0),
    callback_url: raw.callback_url ?? null,
  } as Required<InpaintParams>;

  const comfyuiUrl = SA3_CONFIG.comfyuiUrl;
  const outputDir = SA3_CONFIG.comfyuiOutputDir;

  try {
    // 0. Upload input audio
    const uploadFilename = `sa3_inpaint_${Date.now()}.${raw.input_audio_path.split(".").pop() || "wav"}`;
    const uploadedFilename = await uploadAudioToComfyUI(
      comfyuiUrl,
      raw.input_audio_path,
      uploadFilename,
    );

    // 1. Build and submit workflow
    const { workflow, saveNodeId, nodeSeed } = buildInpaintWorkflow(p, uploadedFilename);

    const submitRes = await fetch(`${comfyuiUrl}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: workflow }),
    });

    if (!submitRes.ok) {
      const body = await submitRes.text();
      return res
        .status(502)
        .send(error(`ComfyUI submit failed (${submitRes.status}): ${body}`));
    }

    const { prompt_id } = (await submitRes.json()) as { prompt_id: string };
    if (!prompt_id) {
      return res.status(502).send(error("ComfyUI returned no prompt_id"));
    }

    // 2. Poll until complete
    const result = await pollUntilComplete(comfyuiUrl, prompt_id);

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
      segment_start: p.segment_start,
      segment_end: p.segment_end,
      seconds_total: p.seconds_total,
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
