import express from "express";
import { Router, Request, Response } from "express";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import {
  SA3_CONFIG,
  SA3_MODELS,
  SA3_AUDIO_FORMATS,
  POLL_INTERVAL_MS,
  POLL_TIMEOUT_MS,
} from "./config";

const router = express.Router();

// ─── Zod Schema ────────────────────────────────────────────────────────────

const generateSchema = z.object({
  /** Text prompt describing the desired audio */
  prompt: z.string().max(4000),
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
  /** Sampler (euler for Medium, lcm only for Medium LCM-distilled checkpoints) */
  sampler_name: z.enum(["euler", "euler_ancestral", "dpmpp_2m", "dpmpp_3m_sde", "lcm"]).default("euler"),
  /** Scheduler */
  scheduler: z.enum(["simple", "normal", "karras", "sgm_uniform"]).default("simple"),
  /** Steps (50 for Medium base, 8 only for LCM-distilled checkpoints) */
  steps: z.number().int().min(1).max(200).default(50),
  /** CFG scale (7 for Medium base, 1 only for LCM-distilled checkpoints) */
  cfg: z.number().min(1).max(20).default(7.0),
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

type GenerateParams = z.infer<typeof generateSchema>;

// ─── Workflow Builder ──────────────────────────────────────────────────────

/**
 * Build ComfyUI API-format workflow for Stable Audio 3 generation.
 *
 * Verified working topology (tested 2026-08-05 on comfyui-primary v0.30.1):
 *
 *   1. CheckpointLoaderSimple → MODEL + VAE (no CLIP in SA3 checkpoint)
 *   2. CLIPLoader (t5gemma, type=stable_audio) → CLIP
 *   3. CLIPTextEncode (positive)
 *   4. CLIPTextEncode (negative)
 *   5. ConditioningStableAudio (fixes seconds_total bug — PR #14858)
 *   6. EmptyLatentAudio
 *   7. KSampler
 *   8. VAEDecodeAudio
 *   9. SaveAudio / SaveAudioMP3
 *
 * SA3 checkpoint does NOT include a text encoder — must use separate CLIPLoader.
 */
function buildWorkflow(p: GenerateParams) {
  const nodeSeed = p.seed === -1 ? Math.floor(Math.random() * 2147483647) : p.seed;
  const isMP3 = p.format === "mp3";

  const workflow: Record<string, any> = {};

  // Node 1: Checkpoint Loader (DiT + VAE; no CLIP)
  workflow["1"] = {
    class_type: "CheckpointLoaderSimple",
    inputs: {
      ckpt_name: p.model,
    },
  };

  // Node 2: CLIP Loader (T5Gemma text encoder — separate from checkpoint)
  workflow["2"] = {
    class_type: "CLIPLoader",
    inputs: {
      clip_name: p.text_encoder,
      type: "stable_audio",
    },
  };

  // Node 3: CLIP Text Encode (positive)
  workflow["3"] = {
    class_type: "CLIPTextEncode",
    inputs: {
      text: p.prompt,
      clip: ["2", 0],
    },
  };

  // Node 4: CLIP Text Encode (negative)
  workflow["4"] = {
    class_type: "CLIPTextEncode",
    inputs: {
      text: p.negative_prompt,
      clip: ["2", 0],
    },
  };

  // Node 5: ConditioningStableAudio — manually set seconds to fix the
  // latent rate calculation bug (Issue #14825, PR #14858).
  workflow["5"] = {
    class_type: "ConditioningStableAudio",
    inputs: {
      positive: ["3", 0],
      negative: ["4", 0],
      seconds_start: p.seconds_start,
      seconds_total: p.seconds_total,
    },
  };

  // Node 6: Empty Latent Audio
  workflow["6"] = {
    class_type: "EmptyLatentAudio",
    inputs: {
      seconds: p.seconds_total,
      batch_size: p.batch_size,
    },
  };

  // Node 7: KSampler
  workflow["7"] = {
    class_type: "KSampler",
    inputs: {
      model: ["1", 0],
      positive: ["5", 0],
      negative: ["5", 1],
      latent_image: ["6", 0],
      seed: nodeSeed,
      steps: p.steps,
      cfg: p.cfg,
      sampler_name: p.sampler_name,
      scheduler: p.scheduler,
      denoise: p.denoise,
    },
  };

  // Node 8: VAE Decode Audio
  workflow["8"] = {
    class_type: "VAEDecodeAudio",
    inputs: {
      samples: ["7", 0],
      vae: ["1", 2],
    },
  };

  // Node 9: Save Audio
  if (isMP3) {
    workflow["9"] = {
      class_type: "SaveAudioMP3",
      inputs: {
        audio: ["8", 0],
        filename_prefix: p.filename_prefix,
        quality: "320k",
      },
    };
  } else {
    workflow["9"] = {
      class_type: "SaveAudio",
      inputs: {
        audio: ["8", 0],
        filename_prefix: p.filename_prefix,
      },
    };
  }

  return workflow;
}

// ─── Polling ───────────────────────────────────────────────────────────────

async function pollUntilComplete(
  comfyuiUrl: string,
  promptId: string,
): Promise<{ status: string; outputs?: any }> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const res = await fetch(`${comfyuiUrl}/history/${promptId}`);
    if (!res.ok) throw new Error(`ComfyUI history error: ${res.status}`);

    const history = (await res.json()) as Record<string, any>;
    const entry = history[promptId];
    if (entry) {
      if (entry.status?.status === "error" || entry.status?.status_str === "error") {
        const msgs = entry.status?.messages || [];
        const errMsg = msgs
          .find((m: any[]) => m[0] === "execution_error")
          ?.[1]?.exception_message || "Unknown ComfyUI error";
        throw new Error(`ComfyUI execution error: ${errMsg}`);
      }
      if (entry.status?.completed || entry.outputs) {
        return { status: "success", outputs: entry.outputs };
      }
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error("ComfyUI generation timed out (10 min)");
}

// ─── Route Handler ──────────────────────────────────────────────────────────

/**
 * POST /api/v1/stableaudio/generate
 *
 * Generate audio via ComfyUI Stable Audio 3 workflow.
 *
 * Body:
 *   prompt: string (required) — text description of desired audio
 *   seconds_total: number — clip length in seconds (default: 30, max: 380)
 *   model: string — checkpoint name (default: stable_audio_3_medium.safetensors)
 *   ...
 *
 * Returns:
 *   task_id, audio_path, audio_url, filename, duration, seed, model
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

  const p = parsed.data;
  const comfyuiUrl = SA3_CONFIG.comfyuiUrl;
  const outputDir = SA3_CONFIG.comfyuiOutputDir;
  const workflow = buildWorkflow(p);

  try {
    // 1. Submit prompt to ComfyUI
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

    const { prompt_id } = (await submitRes.json()) as {
      prompt_id: string;
      number: number;
      node_errors?: any;
    };
    if (!prompt_id) {
      return res.status(502).send(error("ComfyUI returned no prompt_id"));
    }

    // 2. Poll until complete
    const result = await pollUntilComplete(comfyuiUrl, prompt_id);

    if (result.status !== "success" || !result.outputs) {
      return res.status(500).send(error("ComfyUI generation failed"));
    }

    // 3. Extract output audio file from SaveAudio node (node 9)
    const audioOutput = result.outputs["9"];
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
      seed: p.seed,
      model: p.model,
      prompt: p.prompt,
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
