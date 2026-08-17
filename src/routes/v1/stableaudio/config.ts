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
  /** Default model for generation (Medium Base = non-distilled, euler/50steps/cfg=7) */
  defaultModel: process.env.SA3_DEFAULT_MODEL || "stable_audio_3_medium_base.safetensors",
  /** Default text encoder */
  defaultTextEncoder: "t5gemma_b_b_ul2.safetensors",
};

/** Supported checkpoint variants */
export const SA3_MODELS = [
  "stable_audio_3_medium.safetensors",
  "stable_audio_3_medium_base.safetensors",
] as const;

/** Audio output formats */
export const SA3_AUDIO_FORMATS = ["mp3", "flac"] as const;

// Note: Qwen reprompt intentionally NOT integrated — KAP runs inside an agent
// ecosystem where the caller (agent/pipeline) can expand prompts itself using
// much stronger LLMs (GLM-5.2, Claude, etc.) without downloading a 4GB model.

export type Sa3Model = (typeof SA3_MODELS)[number];
export type Sa3AudioFormat = (typeof SA3_AUDIO_FORMATS)[number];

/** Polling config */
export const POLL_INTERVAL_MS = 3000;
export const POLL_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
