import express from "express";
import { Router, Request, Response } from "express";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { success, error } from "@/lib/responseFormat";
import {
  ACE_CONFIG,
  ACE_TASK_TYPES,
  ACE_AUDIO_FORMATS,
  ACE_REPAINT_MODES,
  ACE_LM_BACKENDS,
  ACE_INFER_METHODS,
  type AceTaskType,
  type AceAudioFormat,
  type AceRepaintMode,
  type AceLmBackend,
  type AceInferMethod,
} from "./config";

const router = express.Router();

/**
 * POST /api/v1/ace/generate
 *
 * Submit a music generation task via gold-team → ACE-Step engine.
 * Exposes the full ACE-Step 1.5 parameter set for maximum control.
 *
 * Quick start (minimal):
 *   { prompt: "cinematic dark tension orchestral, 120 bpm" }
 *
 * Full params — see ACE-Step 1.5 API docs.
 */
export default router.post("/generate", async (req, res) => {
  // ---- Zod validation ----
  const schema = z.object({
    // --- Task identity ---
    task_type: z.enum(["text2music", "cover", "repaint", "extract", "lego", "complete", "remix"]).optional().default("text2music"),
    model: z.string().max(100).optional(),

    // --- Prompt & lyrics ---
    prompt: z.string().max(4000).optional().default(""),
    lyrics: z.string().max(8000).optional().default(""),
    global_caption: z.string().max(4000).optional().default(""),

    // --- Thinking / LM code generation ---
    thinking: z.boolean().optional().default(true),
    sample_mode: z.boolean().optional().default(false),
    sample_query: z.string().max(2000).optional().default(""),
    use_format: z.boolean().optional().default(false),

    // --- Music metadata ---
    bpm: z.number().int().min(20).max(300).optional(),
    key_scale: z.string().max(20).optional().default(""),
    time_signature: z.string().max(20).optional().default(""),
    vocal_language: z.string().max(10).optional().default("en"),
    audio_duration: z.number().min(1).max(300).optional(),

    // --- Inference control ---
    inference_steps: z.number().int().min(1).max(100).optional().default(8),
    guidance_scale: z.number().min(0).max(30).optional().default(7.0),
    seed: z.number().int().min(-1).optional().default(-1),
    use_random_seed: z.boolean().optional().default(true),
    shift: z.number().min(1).max(5).optional().default(3.0),
    infer_method: z.enum(["ode", "sde"]).optional().default("ode"),
    timesteps: z.string().max(500).optional(),

    // --- Cover / Remix ---
    reference_audio_path: z.string().max(500).optional(),
    src_audio_path: z.string().max(500).optional(),
    audio_cover_strength: z.number().min(0).max(2).optional().default(1.0),
    cover_noise_strength: z.number().min(0).max(1).optional().default(0.0),

    // --- Repaint ---
    repainting_start: z.number().min(0).max(1).optional().default(0.0),
    repainting_end: z.number().min(0).max(1).optional(),
    repaint_mode: z.enum(["conservative", "balanced", "aggressive"]).optional().default("balanced"),
    repaint_strength: z.number().min(0).max(1).optional().default(0.5),
    repaint_latent_crossfade_frames: z.number().int().min(0).max(100).optional().default(10),
    repaint_wav_crossfade_sec: z.number().min(0).max(5).optional().default(0.0),

    // --- Audio code control ---
    audio_code_string: z.string().max(10000).optional(),
    chunk_mask_mode: z.enum(["explicit", "auto"]).optional().default("auto"),

    // --- Analysis ---
    analysis_only: z.boolean().optional().default(false),
    full_analysis_only: z.boolean().optional().default(false),
    extract_codes_only: z.boolean().optional().default(false),

    // --- Advanced inference ---
    use_adg: z.boolean().optional().default(false),
    cfg_interval_start: z.number().min(0).max(1).optional().default(0.0),
    cfg_interval_end: z.number().min(0).max(1).optional().default(1.0),
    instruction: z.string().max(2000).optional(),
    use_tiled_decode: z.boolean().optional().default(true),

    // --- LM control ---
    lm_model_path: z.string().max(200).optional(),
    lm_backend: z.enum(["vllm", "pt", "mlx"]).optional().default("vllm"),
    lm_temperature: z.number().min(0).max(3).optional().default(0.85),
    lm_cfg_scale: z.number().min(0).max(10).optional().default(2.5),
    lm_top_k: z.number().int().min(1).max(1000).optional(),
    lm_top_p: z.number().min(0).max(1).optional().default(0.9),
    lm_repetition_penalty: z.number().min(0.5).max(3).optional().default(1.0),
    lm_negative_prompt: z.string().max(2000).optional().default("NO USER INPUT"),
    constrained_decoding: z.boolean().optional().default(true),
    constrained_decoding_debug: z.boolean().optional().default(false),
    use_cot_caption: z.boolean().optional().default(true),
    use_cot_language: z.boolean().optional().default(true),
    is_format_caption: z.boolean().optional().default(false),
    allow_lm_batch: z.boolean().optional().default(true),
    track_name: z.string().max(100).optional(),
    track_classes: z.array(z.string().max(50)).max(20).optional(),

    // --- Output ---
    audio_format: z.enum(["mp3", "wav", "flac", "opus", "aac", "wav32"]).optional().default("mp3"),
    batch_size: z.number().int().min(1).max(10).optional().default(1),

    // --- Pipeline metadata (passthrough) ---
    priority: z.enum(["normal", "high", "critical"]).optional().default("normal"),
    callback_url: z.string().url().optional().nullable(),
    description: z.string().max(500).optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).send(error("Validation failed: " + parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ")));
  }

  const p = parsed.data;
  const task_type = p.task_type as AceTaskType;
  const gt_task_type = ACE_TASK_TYPES[task_type];

  // Validate task-type specific requirements
  if (task_type === "cover" && !p.reference_audio_path) {
    return res.status(400).send(error("'reference_audio_path' is required for cover task type"));
  }
  if ((task_type === "repaint" || task_type === "remix") && !p.src_audio_path) {
    return res.status(400).send(error("'src_audio_path' is required for repaint/remix task type"));
  }
  if (task_type === "text2music" && !p.prompt && !p.lyrics) {
    return res.status(400).send(error("At least 'prompt' or 'lyrics' must be provided for text2music"));
  }

  // Generate deterministic task ID
  const task_id = `ace_${uuidv4().replace(/-/g, "").slice(0, 12)}`;

  // Build gold-team payload — pass through all ACE-Step params via `extra.acestep`
  const acestepParams: Record<string, any> = {
    task_type,
    prompt: p.prompt,
    lyrics: p.lyrics,
    global_caption: p.global_caption,
    thinking: p.thinking,
    sample_mode: p.sample_mode,
    sample_query: p.sample_query,
    use_format: p.use_format,
    bpm: p.bpm,
    key_scale: p.key_scale,
    time_signature: p.time_signature,
    vocal_language: p.vocal_language,
    audio_duration: p.audio_duration,
    inference_steps: p.inference_steps,
    guidance_scale: p.guidance_scale,
    seed: p.seed,
    use_random_seed: p.use_random_seed,
    shift: p.shift,
    infer_method: p.infer_method,
    audio_format: p.audio_format,
    batch_size: p.batch_size,
    instruction: p.instruction,
    use_tiled_decode: p.use_tiled_decode,
    use_adg: p.use_adg,
    cfg_interval_start: p.cfg_interval_start,
    cfg_interval_end: p.cfg_interval_end,
    audio_cover_strength: p.audio_cover_strength,
    cover_noise_strength: p.cover_noise_strength,
    audio_code_string: p.audio_code_string,
    chunk_mask_mode: p.chunk_mask_mode,
    analysis_only: p.analysis_only,
    full_analysis_only: p.full_analysis_only,
    extract_codes_only: p.extract_codes_only,
    repaint_mode: p.repaint_mode,
    repaint_strength: p.repaint_strength,
    repaint_latent_crossfade_frames: p.repaint_latent_crossfade_frames,
    repaint_wav_crossfade_sec: p.repaint_wav_crossfade_sec,
    repainting_start: p.repainting_start,
    repainting_end: p.repainting_end,
    lm_backend: p.lm_backend,
    lm_temperature: p.lm_temperature,
    lm_cfg_scale: p.lm_cfg_scale,
    lm_repetition_penalty: p.lm_repetition_penalty,
    lm_negative_prompt: p.lm_negative_prompt,
    constrained_decoding: p.constrained_decoding,
    use_cot_caption: p.use_cot_caption,
    use_cot_language: p.use_cot_language,
    is_format_caption: p.is_format_caption,
    allow_lm_batch: p.allow_lm_batch,
  };

  // Optional fields — only include if provided (avoid sending undefined)
  if (p.model) acestepParams.model = p.model;
  if (p.timesteps) acestepParams.timesteps = p.timesteps;
  if (p.reference_audio_path) acestepParams.reference_audio_path = p.reference_audio_path;
  if (p.src_audio_path) acestepParams.src_audio_path = p.src_audio_path;
  if (p.lm_model_path) acestepParams.lm_model_path = p.lm_model_path;
  if (p.lm_top_k) acestepParams.lm_top_k = p.lm_top_k;
  if (p.lm_top_p !== undefined) acestepParams.lm_top_p = p.lm_top_p;
  if (p.track_name) acestepParams.track_name = p.track_name;
  if (p.track_classes) acestepParams.track_classes = p.track_classes;
  if (p.constrained_decoding_debug) acestepParams.constrained_decoding_debug = p.constrained_decoding_debug;

  const payload: Record<string, any> = {
    task_id,
    type: gt_task_type,
    priority: p.priority,
    model_preference: ACE_CONFIG.engineId,
    params: acestepParams,
    extra: {
      acestep: acestepParams,
    },
  };

  if (p.callback_url) payload.callback_url = p.callback_url;
  if (p.description) payload.description = p.description;

  try {
    const resp = await (
      await import("axios")
    ).default.post(`${ACE_CONFIG.goldTeamUrl}/api/v1/tasks`, payload, {
      timeout: 15_000,
      validateStatus: (s: number) => s < 500,
    });

    if (resp.status === 202 || resp.status === 200) {
      const data = resp.data;
      return res.status(202).send(success({
        task_id,
        gold_team_task_id: data.task_id || task_id,
        status: data.status || "queued",
        engine_target: data.engine_target || ACE_CONFIG.engineId,
        queue_position: data.queue_position,
        estimated_start_sec: data.estimated_start_sec,
        ace_task_type: task_type,
        model: p.model || ACE_CONFIG.defaultModel,
        audio_format: p.audio_format,
        message: `ACE-Step ${task_type} task submitted`,
      }));
    }

    return res.status(502).send(error(`Gold-team rejected task: ${JSON.stringify(resp.data)}`));
  } catch (err: any) {
    const msg =
      err.response?.data?.detail?.message ||
      err.response?.data?.error ||
      err.message ||
      String(err);
    return res.status(502).send(error(`Gold-team request failed: ${msg}`));
  }
});
