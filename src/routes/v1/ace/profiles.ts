import express from "express";
import { Router, Request, Response } from "express";
import fs from "fs";
import path from "path";
import { z } from "zod";
import yaml from "js-yaml";
import { success, error } from "@/lib/responseFormat";
import {
  ACE_SAMPLERS,
  ACE_SCHEDULERS,
  ACE_GUIDANCE_MODES,
  ACE_KEYSCALES,
  ACE_TIME_SIGNATURES,
  ACE_MUSIC_LANGUAGES,
  ACE_QUALITY_PRESETS,
  ACE_CONFIG,
} from "./config";

const router = express.Router();

// ─── Profile Params Schema ─────────────────────────────────────────────────

export const profileParamsSchema = z.object({
  // TextEncode
  caption: z.string().max(4000).optional(),
  lyrics: z.string().max(8000).optional(),
  instrumental: z.boolean().optional(),
  duration: z.number().min(0).max(600).optional(),
  bpm: z.number().int().min(0).max(300).optional(),
  timesignature: z.enum([...ACE_TIME_SIGNATURES]).optional(),
  language: z.enum([...ACE_MUSIC_LANGUAGES]).optional(),
  keyscale: z.enum([...ACE_KEYSCALES]).optional(),
  generate_audio_codes: z.boolean().optional(),
  lm_cfg_scale: z.number().min(0).max(100).optional(),
  lm_temperature: z.number().min(0).max(2).optional(),
  lm_top_p: z.number().min(0).max(2000).optional(),
  lm_top_k: z.number().int().min(0).max(100).optional(),
  lm_min_p: z.number().min(0).max(1).optional(),
  lm_negative_prompt: z.string().max(4000).optional(),
  // Generate
  seed: z.number().int().optional(),
  steps: z.number().int().min(1).max(200).optional(),
  cfg: z.number().min(1).max(20).optional(),
  sampler_name: z.enum([...ACE_SAMPLERS]).optional(),
  scheduler: z.enum([...ACE_SCHEDULERS]).optional(),
  denoise: z.number().min(0).max(1).optional(),
  infer_method: z.enum(["ode", "sde"]).optional(),
  guidance_mode: z.enum([...ACE_GUIDANCE_MODES]).optional(),
  latent_or_audio: z.string().max(500).optional(),
  batch_size: z.number().int().min(1).max(16).optional(),
  latent_shift: z.number().min(-0.2).max(0.2).optional(),
  latent_rescale: z.number().min(0.5).max(1.5).optional(),
  fade_in_duration: z.number().min(0).max(10).optional(),
  fade_out_duration: z.number().min(0).max(10).optional(),
  use_tiled_vae: z.boolean().optional(),
  unload_models_after_generate: z.boolean().optional(),
  voice_boost: z.number().min(-12).max(12).optional(),
  apg_eta: z.number().min(-10).max(10).optional(),
  apg_momentum: z.number().min(-1).max(1).optional(),
  apg_norm_threshold: z.number().min(0).max(15).optional(),
  guidance_interval: z.number().min(-1).max(1).optional(),
  guidance_interval_decay: z.number().min(0).max(1).optional(),
  min_guidance_scale: z.number().min(0).max(30).optional(),
  guidance_scale_text: z.number().min(-1).max(30).optional(),
  guidance_scale_lyric: z.number().min(-1).max(30).optional(),
  omega_scale: z.number().min(-8).max(8).optional(),
  erg_scale: z.number().min(-0.9).max(2).optional(),
  cfg_interval_start: z.number().min(0).max(1).optional(),
  cfg_interval_end: z.number().min(0).max(1).optional(),
  shift: z.number().min(0).max(5).optional(),
  // SaveAudio
  format: z.enum(["flac", "mp3", "opus"]).optional(),
  quality: z.enum([...ACE_QUALITY_PRESETS]).optional(),
});

const profileSchema = z.object({
  name: z.string().max(200),
  description: z.string().max(1000).optional().default(""),
  model: z.string().max(200).optional(),
  params: profileParamsSchema.optional().default({}),
});

export type AceProfileParams = z.infer<typeof profileParamsSchema>;

// ─── Helpers ──────────────────────────────────────────────────────────────

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase();
}

function profileFilePath(name: string): string {
  return path.join(ACE_CONFIG.profilesDir, `${sanitizeName(name)}.yaml`);
}

function ensureProfilesDir(): void {
  fs.mkdirSync(ACE_CONFIG.profilesDir, { recursive: true });
}

/** Load a profile by name. Returns null if not found. */
export function loadProfile(
  name: string,
): { name: string; description?: string; model?: string; params: AceProfileParams } | null {
  const fp = profileFilePath(name);
  if (!fs.existsSync(fp)) return null;
  try {
    const raw = yaml.load(fs.readFileSync(fp, "utf-8")) as any;
    return profileSchema.parse(raw);
  } catch {
    return null;
  }
}

/** List all profiles (name + description only). */
export function listProfiles(): { name: string; description: string }[] {
  ensureProfilesDir();
  const files = fs.readdirSync(ACE_CONFIG.profilesDir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
  return files.map((f) => {
    const name = path.basename(f, path.extname(f));
    try {
      const raw = yaml.load(fs.readFileSync(path.join(ACE_CONFIG.profilesDir, f), "utf-8")) as any;
      return { name, description: raw?.description || "" };
    } catch {
      return { name, description: "" };
    }
  });
}

// ─── Routes ────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/ace/profiles
 * List all available profiles.
 */
router.get("/", (_req: Request, res: Response) => {
  try {
    const profiles = listProfiles();
    return res.send(success(profiles));
  } catch (err: any) {
    return res.status(500).send(error(err.message || "Failed to list profiles"));
  }
});

/**
 * GET /api/v1/ace/profiles/:name
 * Get a single profile's full config.
 */
router.get("/:name", (req: Request, res: Response) => {
  const profileName = String(req.params.name);
  const profile = loadProfile(profileName);
  if (!profile) {
    return res.status(404).send(error(`Profile "${profileName}" not found`));
  }
  return res.send(success(profile));
});

/**
 * POST /api/v1/ace/profiles/:name
 * Create or update a profile.
 */
router.post("/:name", (req: Request, res: Response) => {
  const profileName = String(req.params.name);
  const parsed = profileSchema.safeParse(req.body);
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

  try {
    ensureProfilesDir();
    const data = { ...parsed.data, name: parsed.data.name || req.params.name };
    const fp = profileFilePath(profileName);
    fs.writeFileSync(fp, yaml.dump(data, { lineWidth: 120, noRefs: true }), "utf-8");
    return res.send(success({ name: sanitizeName(profileName), saved: true }));
  } catch (err: any) {
    return res.status(500).send(error(err.message || "Failed to save profile"));
  }
});

export default router;
