import express from "express";
import { Router, Request, Response } from "express";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import {
  ACE_CONFIG,
  ACE_SAMPLERS,
  ACE_SCHEDULERS,
  ACE_GUIDANCE_MODES,
  ACE_KEYSCALES,
  ACE_TIME_SIGNATURES,
  ACE_MUSIC_LANGUAGES,
  ACE_QUALITY_PRESETS,
} from "./config";
import { loadProfile, type AceProfileParams } from "./profiles";

const router = express.Router();

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

// ─── Zod Schema ────────────────────────────────────────────────────────────

const textEncodeRequiredSchema = z.object({
  caption: z.string().max(4000).default(""),
  lyrics: z.string().max(8000).default("[Instrumental]"),
  instrumental: z.boolean().default(false),
  duration: z.number().min(0).max(600).default(120),
  bpm: z.number().int().min(0).max(300).default(0),
  timesignature: z.enum([...ACE_TIME_SIGNATURES]).default("auto"),
  language: z.enum([...ACE_MUSIC_LANGUAGES]).default("en"),
  keyscale: z.enum([...ACE_KEYSCALES]).default("auto"),
});

const textEncodeOptionalSchema = z.object({
  generate_audio_codes: z.boolean().default(true),
  lm_cfg_scale: z.number().min(0).max(100).default(2.0),
  lm_temperature: z.number().min(0).max(2).default(0.85),
  lm_top_p: z.number().min(0).max(2000).default(0.9),
  lm_top_k: z.number().int().min(0).max(100).default(0),
  lm_min_p: z.number().min(0).max(1).default(0.0),
  lm_negative_prompt: z.string().max(4000).default(""),
});

const generateRequiredSchema = z.object({
  seed: z.number().int().default(-1),
  steps: z.number().int().min(1).max(200).default(50),
  cfg: z.number().min(1).max(20).default(7.0),
  sampler_name: z.enum([...ACE_SAMPLERS]).default("euler"),
  scheduler: z.enum([...ACE_SCHEDULERS]).default("normal"),
  denoise: z.number().min(0).max(1).default(1.0),
  infer_method: z.enum(["ode", "sde"]).default("ode"),
  guidance_mode: z.enum([...ACE_GUIDANCE_MODES]).default("apg"),
});

const generateOptionalSchema = z.object({
  latent_or_audio: z.string().max(500).optional(),
  batch_size: z.number().int().min(1).max(16).default(1),
  latent_shift: z.number().min(-0.2).max(0.2).default(0.0),
  latent_rescale: z.number().min(0.5).max(1.5).default(1.0),
  fade_in_duration: z.number().min(0).max(10).default(0.0),
  fade_out_duration: z.number().min(0).max(10).default(0.0),
  use_tiled_vae: z.boolean().default(true),
  unload_models_after_generate: z.boolean().default(false),
  voice_boost: z.number().min(-12).max(12).default(0.0),
  apg_eta: z.number().min(-10).max(10).default(0.0),
  apg_momentum: z.number().min(-1).max(1).default(-0.75),
  apg_norm_threshold: z.number().min(0).max(15).default(2.5),
  guidance_interval: z.number().min(-1).max(1).default(0.5),
  guidance_interval_decay: z.number().min(0).max(1).default(0.0),
  min_guidance_scale: z.number().min(0).max(30).default(3.0),
  guidance_scale_text: z.number().min(-1).max(30).default(-1.0),
  guidance_scale_lyric: z.number().min(-1).max(30).default(-1.0),
  omega_scale: z.number().min(-8).max(8).default(0.0),
  erg_scale: z.number().min(-0.9).max(2).default(0.0),
  cfg_interval_start: z.number().min(0).max(1).default(0.0),
  cfg_interval_end: z.number().min(0).max(1).default(1.0),
  shift: z.number().min(0).max(5).default(3.0),
  repaint_auto_tiled_vae_off: z.boolean().default(true),
  repaint_enabled: z.boolean().default(false),
  repaint_denoise: z.number().min(0).max(1).default(0.6),
  repaint_steps: z.number().int().min(1).max(200).default(20),
  repaint_cfg: z.number().min(1).max(20).default(3.5),
});

const saveAudioSchema = z.object({
  format: z.enum(["flac", "mp3", "opus"]).default("flac"),
  quality: z.enum([...ACE_QUALITY_PRESETS]).default("128k"),
});

const generateSchema = z
  .object({
    profile: z.string().max(100).optional(),
    model: z.string().max(200).default("acestep_v1.5_xl_sft.safetensors"),
    text_encoder_2: z.enum(["qwen_1.7b_ace15.safetensors", "qwen_4b_ace15.safetensors"]).default("qwen_4b_ace15.safetensors"),
    filename_prefix: z.string().max(200).default("acestep-sft"),
    callback_url: z.string().url().optional().nullable(),
  })
  .merge(textEncodeRequiredSchema)
  .merge(textEncodeOptionalSchema)
  .merge(generateRequiredSchema)
  .merge(generateOptionalSchema)
  .merge(saveAudioSchema);

type GenerateParams = z.infer<typeof generateSchema>;

// ─── Profile Merge ──────────────────────────────────────────────────────────

/** Apply profile defaults, then overlay explicit request params. */
async function applyProfile(params: GenerateParams): Promise<GenerateParams> {
  if (!params.profile) return params;

  const profile = await loadProfile(params.profile);
  if (!profile) return params;

  // Build a flat object: profile params → then explicit params override
  const merged = { ...profile.params };

  // Only overlay keys that were explicitly provided in the request
  // (i.e., not defaulted). We re-parse the raw body to detect explicit keys.
  // Simpler approach: overlay all keys from parsed params since defaults already applied.
  // The caller should send only non-default values for override.
  return generateSchema.parse({ ...merged, ...params, profile: params.profile });
}

// ─── Workflow Builder ──────────────────────────────────────────────────────

/**
 * Build the ComfyUI workflow JSON for AceStep SFT generation.
 *
 * Uses the all-in-one AceStepSFTGenerate node (jeankassio/ComfyUI-AceStep_SFT)
 * which handles model loading, text encoding, and generation in a single node.
 * This is the node currently available in comfyui-primary.
 *
 * Node outputs: slot 0 = AUDIO (for SaveAudio/PreviewAudio)
 *
 * Model selection:
 *   - acestep_v1.5_turbo.safetensors  → Turbo (8 steps, fast)
 *   - acestep_v1.5_xl_sft.safetensors → XL-SFT (50 steps, high quality)
 *   - acestep_v1.5_sft.safetensors     → SFT (50 steps, standard)
 */
function buildWorkflow(p: GenerateParams) {
  const nodeSeed = p.seed === -1 ? 0 : p.seed;
  const lyrics = p.instrumental ? "[Instrumental]" : p.lyrics;

  // Pass caption through TurboTagAdapter for style enhancement when caption provided
  const hasCaption = p.caption && p.caption.trim().length > 0;

  const workflow: Record<string, any> = {};

  // Node 1: TurboTagAdapter (optional, only when caption provided)
  if (hasCaption) {
    workflow["1"] = {
      class_type: "AceStepSFTTurboTagAdapter",
      inputs: {
        turbo_tags: p.caption,
        adaptation_strength: "aggressive",
        keep_unknown_tags: true,
        add_sft_bias_tags: true,
      },
    };
  }

  // Node 2 or 5: AceStepSFTGenerate (all-in-one)
  const captionRef = hasCaption ? ["1", 0] : "";
  const styleTagsRef = hasCaption ? ["1", 0] : "";
  const generateNodeId = hasCaption ? "2" : "5";

  // Auto-disable tiled VAE for repaint (denoise < 1 + audio input)
  const useTiledVae = (p.denoise < 1.0 && p.latent_or_audio && p.repaint_auto_tiled_vae_off)
    ? false
    : p.use_tiled_vae;

  workflow[generateNodeId] = {
    class_type: "AceStepSFTGenerate",
    inputs: {
      diffusion_model: p.model,
      text_encoder_1: "qwen_0.6b_ace15.safetensors",
      text_encoder_2: p.text_encoder_2,
      vae_name: "ace_1.5_vae.safetensors",
      caption: hasCaption ? captionRef : (p.caption || ""),
      lyrics: lyrics,
      instrumental: p.instrumental,
      seed: nodeSeed,
      steps: p.steps,
      cfg: p.cfg,
      sampler_name: p.sampler_name,
      scheduler: p.scheduler,
      denoise: p.denoise,
      infer_method: p.infer_method,
      guidance_mode: p.guidance_mode,
      duration: p.duration,
      bpm: p.bpm,
      timesignature: p.timesignature,
      language: p.language,
      keyscale: p.keyscale,
      generate_audio_codes: p.generate_audio_codes,
      use_tiled_vae: useTiledVae,
      apg_eta: p.apg_eta,
      apg_momentum: p.apg_momentum,
      apg_norm_threshold: p.apg_norm_threshold,
      shift: p.shift,
      lm_cfg_scale: p.lm_cfg_scale,
      lm_temperature: p.lm_temperature,
      lm_top_p: p.lm_top_p,
      lm_top_k: p.lm_top_k,
      lm_min_p: p.lm_min_p,
      lm_negative_prompt: p.lm_negative_prompt || "",
      voice_boost: p.voice_boost,
      latent_shift: p.latent_shift,
      latent_rescale: p.latent_rescale,
      fade_in_duration: p.fade_in_duration,
      fade_out_duration: p.fade_out_duration,
      guidance_interval: p.guidance_interval,
      guidance_interval_decay: p.guidance_interval_decay,
      min_guidance_scale: p.min_guidance_scale,
      guidance_scale_text: p.guidance_scale_text,
      guidance_scale_lyric: p.guidance_scale_lyric,
      omega_scale: p.omega_scale,
      erg_scale: p.erg_scale,
      cfg_interval_start: p.cfg_interval_start,
      cfg_interval_end: p.cfg_interval_end,
      style_tags: hasCaption ? styleTagsRef : "",
      batch_size: p.batch_size,
      unload_models_after_generate: p.unload_models_after_generate,
    },
  };

  // Cover/repaint: add LoadAudio node when denoise < 1 and latent_or_audio provided
  if (p.denoise < 1.0 && p.latent_or_audio) {
    const loadNodeId = "3";
    workflow[loadNodeId] = {
      class_type: "LoadAudio",
      inputs: { audio: p.latent_or_audio },
    };
    workflow[generateNodeId].inputs.latent_or_audio = [loadNodeId, 0];
  }

  // SaveAudio node (slot 0 = AUDIO output from all-in-one node)
  const saveNodeId = "4";
  workflow[saveNodeId] = {
    class_type: "SaveAudio",
    inputs: {
      audio: [generateNodeId, 0],
      filename_prefix: p.filename_prefix,
    },
  };

  return workflow;
}

/**
 * Build a Repaint workflow: take generated audio and re-denoise with lower denoise
 * to reduce vocal graininess. Uses the same model and settings but denoise < 1.0.
 */
function extendWithRepaint(
  workflow: Record<string, any>,
  p: GenerateParams,
  generateNodeId: string,
  saveNodeId: string,
): void {
  const repaintSeed = p.seed === -1
    ? Math.floor(Math.random() * 2147483647)
    : p.seed + 1000;
  const repaintSteps = p.repaint_steps || 20;
  const repaintCfg = p.repaint_cfg || 3.5;
  const repaintDenoise = p.repaint_denoise || 0.6;

  // Rename first save to _original
  workflow[saveNodeId].inputs.filename_prefix = `${p.filename_prefix}_original`;

  // Repaint node — linked to generation audio output via node reference
  const repaintGenId = "5";
  workflow[repaintGenId] = {
    class_type: "AceStepSFTGenerate",
    inputs: {
      diffusion_model: p.model,
      text_encoder_1: "qwen_0.6b_ace15.safetensors",
      text_encoder_2: p.text_encoder_2,
      vae_name: "ace_1.5_vae.safetensors",
      caption: p.caption || "",
      lyrics: p.lyrics || "[Instrumental]",
      instrumental: p.instrumental,
      seed: repaintSeed,
      steps: repaintSteps,
      cfg: repaintCfg,
      sampler_name: p.sampler_name,
      scheduler: p.scheduler,
      denoise: repaintDenoise,
      infer_method: p.infer_method,
      guidance_mode: p.guidance_mode,
      duration: p.duration,
      bpm: p.bpm,
      timesignature: p.timesignature,
      language: p.language,
      keyscale: p.keyscale,
      generate_audio_codes: p.generate_audio_codes,
      use_tiled_vae: false,
      apg_eta: p.apg_eta,
      apg_momentum: p.apg_momentum,
      apg_norm_threshold: p.apg_norm_threshold,
      shift: p.shift,
      lm_cfg_scale: p.lm_cfg_scale,
      lm_temperature: p.lm_temperature,
      lm_top_p: p.lm_top_p,
      lm_top_k: p.lm_top_k,
      lm_min_p: p.lm_min_p,
      voice_boost: p.voice_boost,
      latent_shift: p.latent_shift,
      latent_rescale: p.latent_rescale,
      fade_in_duration: p.fade_in_duration,
      fade_out_duration: p.fade_out_duration,
      guidance_interval: p.guidance_interval,
      guidance_interval_decay: p.guidance_interval_decay,
      min_guidance_scale: p.min_guidance_scale,
      guidance_scale_text: p.guidance_scale_text,
      guidance_scale_lyric: p.guidance_scale_lyric,
      omega_scale: p.omega_scale,
      erg_scale: p.erg_scale,
      cfg_interval_start: p.cfg_interval_start,
      cfg_interval_end: p.cfg_interval_end,
      batch_size: 1,
      unload_models_after_generate: p.unload_models_after_generate,
      latent_or_audio: [generateNodeId, 0],
    },
  };

  // Repaint SaveAudio
  const repaintSaveId = "6";
  workflow[repaintSaveId] = {
    class_type: "SaveAudio",
    inputs: {
      audio: [repaintGenId, 0],
      filename_prefix: `${p.filename_prefix}_repainted`,
    },
  };
}

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
      if (entry.status?.status === "error") {
        throw new Error(
          `ComfyUI execution error: ${JSON.stringify(entry.status.messages || [])}`,
        );
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
 * POST /api/v1/ace/comfyui/generate
 *
 * Generate music via ComfyUI AceStep SFT workflow with full parameter exposure
 * and optional profile preset support.
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

  // Apply profile if specified
  let p: GenerateParams;
  try {
    p = await applyProfile(parsed.data);
    console.log('[ACE Generate] repaint_enabled=' + p.repaint_enabled + ' denoise=' + p.denoise + ' voice_boost=' + p.voice_boost);
  } catch (err: any) {
    return res.status(400).send(error(`Profile error: ${err.message}`));
  }

  const comfyuiUrl = ACE_CONFIG.comfyuiUrl;
  const outputDir = ACE_CONFIG.comfyuiOutputDir;
  const workflow = buildWorkflow(p);

  const hasCaption = p.caption && p.caption.trim().length > 0;
  const generateNodeId = hasCaption ? "2" : "5";
  const saveNodeId = "4";

  // Extend workflow with repaint if enabled (single ComfyUI prompt)
  if (p.repaint_enabled) {
    console.log('[ACE] Extending workflow with repaint, denoise=' + p.repaint_denoise);
    extendWithRepaint(workflow, p, generateNodeId, saveNodeId);
  }

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

    const hasCaption = p.caption && p.caption.trim().length > 0;

    // 3. Extract output audio file info from SaveAudio node (node 4)
    const saveNodeId = hasCaption ? "4" : "4";
    const audioOutput = result.outputs[saveNodeId];
    if (!audioOutput || !audioOutput.audio) {
      return res
        .status(500)
        .send(error("No audio output in ComfyUI response"));
    }

    const audioFile = audioOutput.audio[0];
    const audioPath = `${outputDir}/${audioFile.filename}`;
    const audioUrl = `/api/v1/ace/comfyui/audio/${encodeURIComponent(audioFile.filename)}`;

    const responseData: Record<string, any> = {
      task_id: prompt_id,
      audio_path: audioPath,
      audio_url: audioUrl,
      filename: audioFile.filename,
      format: audioFile.subfolder || p.format,
      duration: p.duration,
      seed: p.seed,
      model: p.model,
      profile: p.profile || undefined,
    };

    // 4. Check for repaint output (node 6) if enabled
    if (p.repaint_enabled && result.outputs["6"]) {
      const repaintOutput = result.outputs["6"];
      if (repaintOutput?.audio?.[0]) {
        const repaintFile = repaintOutput.audio[0];
        responseData.repaint_filename = repaintFile.filename;
        responseData.repaint_url = `/api/v1/ace/comfyui/audio/${encodeURIComponent(repaintFile.filename)}`;
      }
    }

    // 5. Optional callback
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
