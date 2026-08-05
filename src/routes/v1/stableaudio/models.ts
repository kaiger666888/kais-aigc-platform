import express from "express";
import { Router, Request, Response } from "express";
import { success, error } from "@/lib/responseFormat";
import { SA3_CONFIG, SA3_MODELS, SA3_AUDIO_FORMATS } from "./config";
import { SA3_PROMPT_GUIDE } from "./prompt-guide";
import { promises as fs } from "fs";
import path from "path";

const router = express.Router();

/**
 * GET /api/v1/stableaudio/models
 *
 * List available Stable Audio 3 checkpoints and text encoders.
 * Checks the ComfyUI models directory for actual files.
 */
export default router.get("/", async (req: Request, res: Response) => {
  try {
    const modelsDir = "/data/models/comfyui";
    const checkpointsDir = path.join(modelsDir, "checkpoints");
    const textEncodersDir = path.join(modelsDir, "text_encoders");

    // Scan checkpoints directory for SA3 files
    let availableCheckpoints: string[] = [];
    try {
      const files = await fs.readdir(checkpointsDir);
      availableCheckpoints = files.filter(
        (f) =>
          f.toLowerCase().includes("stable_audio_3") &&
          !f.endsWith(".aria2"),
      );
    } catch {
      // directory not accessible
    }

    // Scan text encoders for t5gemma
    let availableTextEncoders: string[] = [];
    try {
      const files = await fs.readdir(textEncodersDir);
      availableTextEncoders = files.filter((f) =>
        f.toLowerCase().includes("t5gemma") || f.toLowerCase().includes("sa3"),
      );
    } catch {
      // directory not accessible
    }

    return res.send(
      success({
        checkpoints: availableCheckpoints,
        text_encoders: availableTextEncoders,
        default_model: SA3_CONFIG.defaultModel,
        default_text_encoder: SA3_CONFIG.defaultTextEncoder,
        all_models: SA3_MODELS,
        audio_formats: SA3_AUDIO_FORMATS,
        prompt_guide: SA3_PROMPT_GUIDE,
        endpoints: {
          generate: "POST /api/v1/stableaudio/generate — Text-to-Audio",
          transform: "POST /api/v1/stableaudio/transform — Audio-to-Audio (style transfer)",
          inpaint: "POST /api/v1/stableaudio/inpaint — Inpainting / Continuation",
        },
      }),
    );
  } catch (err: any) {
    return res.status(500).send(error(err.message || "Internal server error"));
  }
});
