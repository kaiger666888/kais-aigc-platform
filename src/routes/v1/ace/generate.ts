import express from "express";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { success, error } from "@/lib/responseFormat";
import { withGpuQueue } from "@/lib/gpuVramManager";
import { ACE_CONFIG } from "./config";
import { startCallbackTracker } from "./_shared/asyncCallback";

const router = express.Router();

const generateSchema = z.object({
  prompt: z.string().max(4000).optional().default(""),
  caption: z.string().max(4000).optional().default(""),
  lyrics: z.string().max(8000).optional().default("[Instrumental]"),
  instrumental: z.boolean().optional().default(false),
  duration: z.number().min(1).max(600).optional().default(60),
  model: z.string().max(200).optional().default("acestep_v1.5_xl_sft.safetensors"),
  text_encoder_2: z.enum(["qwen_1.7b_ace15.safetensors", "qwen_4b_ace15.safetensors"]).optional().default("qwen_4b_ace15.safetensors"),
  seed: z.number().int().min(-1).optional().default(-1),
  bpm: z.number().int().min(20).max(300).optional().default(80),
  timesignature: z.enum(["auto", "4", "3", "2", "6"]).optional().default("auto"),
  language: z.enum(["en", "zh", "ja", "ko", "es", "de", "fr", "pt", "ru", "it"]).optional().default("en"),
  keyscale: z.string().max(20).optional().default("auto"),
  steps: z.number().int().min(1).max(200).optional().default(50),
  cfg: z.number().min(1).max(20).optional().default(7.0),
  sampler_name: z.string().max(50).optional().default("euler"),
  scheduler: z.string().max(50).optional().default("normal"),
  denoise: z.number().min(0).max(1).optional().default(1.0),
  filename_prefix: z.string().max(200).optional().default("acestep-async"),
  callback_url: z.string().url().optional().nullable(),
  client_task_id: z.string().max(100).optional(),
});

type GenerateParams = z.infer<typeof generateSchema>;

/**
 * POST /api/v1/ace/generate
 *
 * Async music generation via ComfyUI. Returns immediately with a prompt_id
 * (mapped as task_id). Poll via GET /api/v1/ace/status/:promptId.
 *
 * For full parameter control (repaint, cover, advanced sampling), use the
 * synchronous POST /api/v1/ace/comfyuiGenerate endpoint instead.
 */
export default router.post("/", async (req, res) => {
  const parsed = generateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .send(error("Validation failed: " + parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ")));
  }

  const p: GenerateParams = parsed.data;

  if (!p.prompt && !p.caption && !p.lyrics) {
    return res.status(400).send(error("At least one of prompt / caption / lyrics must be provided"));
  }

  const comfyuiUrl = ACE_CONFIG.comfyuiUrl;
  const workflow = buildMinimalWorkflow(p);

  try {
    // ─── GPU 全局串行队列 (gpuVramManager withGpuQueue, 2026-08-16 二期) ───
    // ACE-Step (~7GB) 与 TTS/H3/music3/qwen_eye 共享 GPU1 锁。本端点是异步语义
    // (提交即返回 202), 锁只罩提交 — 生成期显存占用由 ComfyUI 队列自身串行化,
    // 后续其它引擎提交时会看到 GPU 被占而在队列里等待。
    const data = await withGpuQueue(
      "ace",
      async () => {
        const submitRes = await fetch(`${comfyuiUrl}/prompt`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: workflow }),
          signal: AbortSignal.timeout(15_000),
        });

        if (!submitRes.ok) {
          const body = await submitRes.text();
          throw new Error(`ComfyUI submit failed (${submitRes.status}): ${body.slice(0, 500)}`);
        }

        const data = (await submitRes.json()) as {
          prompt_id: string;
          number: number;
          node_errors?: any;
        };

        if (!data.prompt_id) {
          throw new Error("ComfyUI returned no prompt_id");
        }

        if (data.node_errors && Object.keys(data.node_errors).length > 0) {
          throw Object.assign(
            new Error(`ComfyUI validation failed: ${JSON.stringify(data.node_errors).slice(0, 800)}`),
            { statusCode: 400 },
          );
        }
        return data;
      },
      { gpuIndex: 1, comfyuiUrl },
    );

    const clientTaskId = p.client_task_id || `ace_${uuidv4().replace(/-/g, "").slice(0, 12)}`;

    // Register in-process callback tracker. Polls ComfyUI /history every 5s
    // and POSTs the result to callback_url on completion/failure/timeout.
    // Best-effort — lost on server restart; clients should still poll
    // /api/v1/ace/status/:promptId as a fallback.
    if (p.callback_url) {
      startCallbackTracker({
        promptId: data.prompt_id,
        callbackUrl: p.callback_url,
        comfyuiUrl,
      });
      console.log(`[ACE Generate] callback tracker started for prompt_id=${data.prompt_id} → ${p.callback_url}`);
    }

    return res.status(202).send(success({
      task_id: data.prompt_id,
      client_task_id: clientTaskId,
      comfyui_prompt_id: data.prompt_id,
      queue_number: data.number,
      status: "queued",
      engine_target: "comfyui",
      comfyui_url: comfyuiUrl,
      poll_url: `/api/v1/ace/status/${encodeURIComponent(data.prompt_id)}`,
      cancel_url: `/api/v1/ace/cancel/${encodeURIComponent(data.prompt_id)}`,
      params_summary: {
        prompt_preview: (p.prompt || p.caption || "").slice(0, 80),
        lyrics_preview: p.lyrics.slice(0, 80),
        duration: p.duration,
        model: p.model,
        seed: p.seed,
      },
      message: "ACE-Step generation queued in ComfyUI. Poll status_url for completion.",
    }));
  } catch (err: any) {
    const msg = err.message || String(err);
    if (err.statusCode === 400) {
      return res.status(400).send(error(msg));
    }
    return res.status(502).send(error(`ComfyUI submit request failed: ${msg}`));
  }
});

/**
 * Build a minimal ComfyUI API-format workflow for ACE-Step text2music.
 * Mirrors the structure used by comfyuiGenerate.ts but without repaint/cover
 * extensions. The full parameter surface lives in /comfyuiGenerate.
 */
function buildMinimalWorkflow(p: GenerateParams): Record<string, any> {
  const seed = p.seed === -1 ? Math.floor(Math.random() * 1e9) : p.seed;
  const lyrics = p.instrumental ? "[Instrumental]" : p.lyrics;
  const hasCaption = (p.caption || p.prompt || "").trim().length > 0;
  const caption = (p.caption || p.prompt || "");

  const workflow: Record<string, any> = {};

  // Node 1: TurboTagAdapter (optional, when caption supplied)
  if (hasCaption) {
    workflow["1"] = {
      class_type: "AceStepSFTTurboTagAdapter",
      inputs: {
        turbo_tags: caption,
        adaptation_strength: "aggressive",
        keep_unknown_tags: true,
        add_sft_bias_tags: true,
      },
    };
  }

  // Node 2: AceStepSFTGenerate (all-in-one)
  const generateNodeId = hasCaption ? "2" : "5";
  workflow[generateNodeId] = {
    class_type: "AceStepSFTGenerate",
    inputs: {
      diffusion_model: p.model,
      text_encoder_1: "qwen_0.6b_ace15.safetensors",
      text_encoder_2: p.text_encoder_2,
      vae_name: "ace_1.5_vae.safetensors",
      caption: hasCaption ? ["1", 0] : "",
      lyrics,
      instrumental: p.instrumental,
      seed,
      steps: p.steps,
      cfg: p.cfg,
      sampler_name: p.sampler_name,
      scheduler: p.scheduler,
      denoise: p.denoise,
      infer_method: "ode",
      guidance_mode: "apg",
      duration: p.duration,
      bpm: p.bpm,
      timesignature: p.timesignature,
      language: p.language,
      keyscale: p.keyscale,
      generate_audio_codes: true,
      use_tiled_vae: true,
      shift: 3.0,
      lm_cfg_scale: 2.0,
      lm_temperature: 0.85,
      lm_top_p: 0.9,
      lm_top_k: 0,
      lm_min_p: 0.0,
      lm_negative_prompt: "",
      voice_boost: 0.0,
      apg_eta: 0.0,
      apg_momentum: -0.75,
      apg_norm_threshold: 2.5,
      latent_shift: 0.0,
      latent_rescale: 1.0,
      fade_in_duration: 0.0,
      fade_out_duration: 0.0,
      guidance_interval: 0.5,
      guidance_interval_decay: 0.0,
      min_guidance_scale: 3.0,
      guidance_scale_text: -1.0,
      guidance_scale_lyric: -1.0,
      omega_scale: 0.0,
      erg_scale: 0.0,
      cfg_interval_start: 0.0,
      cfg_interval_end: 1.0,
      style_tags: hasCaption ? ["1", 0] : "",
      batch_size: 1,
      unload_models_after_generate: false,
    },
  };

  // Node 4: SaveAudio
  workflow["4"] = {
    class_type: "SaveAudio",
    inputs: {
      audio: [generateNodeId, 0],
      filename_prefix: p.filename_prefix,
    },
  };

  return workflow;
}
