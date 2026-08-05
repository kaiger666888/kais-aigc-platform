import { engineOutputDir, getOutputRoot } from "@/lib/paths";

export const SA3_CONFIG = {
  /** Output root */
  outputDir: getOutputRoot(),
  /** Stable Audio 3 output subdir (uses generic comfyui output dir) */
  sa3OutputDir: engineOutputDir("comfyui"),
  /** ComfyUI API URL */
  comfyuiUrl: process.env.COMFYUI_URL || "http://localhost:8188",
  /** ComfyUI host output directory */
  comfyuiOutputDir: process.env.COMFYUI_OUTPUT_DIR || engineOutputDir("comfyui"),
  /** Default model for generation (Medium = LCM distilled, 8 steps) */
  defaultModel: process.env.SA3_DEFAULT_MODEL || "stable_audio_3_medium.safetensors",
  /** Default text encoder */
  defaultTextEncoder: "t5gemma_b_b_ul2.safetensors",
};

/** Supported checkpoint variants */
export const SA3_MODELS = [
  "stable_audio_3_medium.safetensors",
  "stable_audio_3_medium_base.safetensors",
] as const;

/** Audio output formats */
export const SA3_AUDIO_FORMATS = ["mp3", "wav", "flac"] as const;

/** Reprompt categories (Medium workflow with Qwen) */
export const SA3_REPROMPT_CATEGORIES = ["Music", "Instrument", "SFX", "One-shot"] as const;

export type Sa3Model = (typeof SA3_MODELS)[number];
export type Sa3AudioFormat = (typeof SA3_AUDIO_FORMATS)[number];
export type Sa3RepromptCategory = (typeof SA3_REPROMPT_CATEGORIES)[number];

/** Polling config */
export const POLL_INTERVAL_MS = 3000;
export const POLL_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
