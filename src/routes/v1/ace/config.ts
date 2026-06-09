export const ACE_CONFIG = {
  /** Directory for ACE profile YAML presets */
  profilesDir: process.env.ACE_PROFILES_DIR || "/home/kai/ComfyUI/ace-profiles",
  goldTeamUrl: process.env.GOLD_TEAM_URL || "http://gold-team:8002",
  outputDir: process.env.OUTPUT_DIR || "/mnt/agents/output",
  /** Gold-team task engine ID for ACE-Step */
  engineId: process.env.ACE_ENGINE_ID || "acestep-internal",
  /** Default model for generation */
  defaultModel: process.env.ACE_DEFAULT_MODEL || "acestep_v1.5_xl_sft.safetensors",
  /** Direct ACE-Step API URL (for quick/sync mode) */
  directUrl: process.env.ACE_DIRECT_URL || "http://kais-acestep:8001",
  /** ComfyUI API URL */
  comfyuiUrl: process.env.COMFYUI_URL || "http://localhost:8188",
  /** ComfyUI host output directory */
  comfyuiOutputDir: process.env.COMFYUI_OUTPUT_DIR || "/mnt/agents/output",
};

/** Supported task types — map ACE-Step task_type to gold-team TaskType enum */
export const ACE_TASK_TYPES = {
  text2music: "music",
  cover: "music",
  repaint: "music",
  extract: "music",
  lego: "music",
  complete: "music",
  remix: "music",
} as const;

/** Supported audio output formats */
export const ACE_AUDIO_FORMATS = ["mp3", "wav", "flac", "opus", "aac", "wav32"] as const;

/** Supported repaint modes */
export const ACE_REPAINT_MODES = ["conservative", "balanced", "aggressive"] as const;

/** Supported LM backends */
export const ACE_LM_BACKENDS = ["vllm", "pt", "mlx"] as const;

/** Supported inference methods */
export const ACE_INFER_METHODS = ["ode", "sde"] as const;

export type AceTaskType = keyof typeof ACE_TASK_TYPES;
export type AceAudioFormat = (typeof ACE_AUDIO_FORMATS)[number];
export type AceRepaintMode = (typeof ACE_REPAINT_MODES)[number];
export type AceLmBackend = (typeof ACE_LM_BACKENDS)[number];
export type AceInferMethod = (typeof ACE_INFER_METHODS)[number];

/** ComfyUI samplers (AceStep SFT) */
export const ACE_SAMPLERS = [
  "euler", "euler_ancestral", "heun", "heunpp2", "dpm_2", "dpm_2_ancestral",
  "lms", "dpm_fast", "dpm_adaptive", "dpmpp_2s_ancestral", "dpmpp_sde",
  "dpmpp_sde_gpu", "dpmpp_2m", "dpmpp_2m_sde", "dpmpp_2m_sde_gpu",
  "dpmpp_3m_sde", "dpmpp_3m_sde_gpu", "ipndm", "ipndm_v", "deois",
  "ddpm", "lcm", "ddim", "uni_pc", "uni_pc_bh2",
] as const;

/** ComfyUI schedulers (AceStep SFT) */
export const ACE_SCHEDULERS = [
  "normal", "karras", "exponential", "sgm_uniform", "simple", "ddim_uniform",
  "beta",
] as const;

/** Guidance modes (AceStep SFT) */
export const ACE_GUIDANCE_MODES = ["apg", "adg", "standard_cfg"] as const;

/** Keyscales (35 options) — lowercase per ComfyUI node spec */
export const ACE_KEYSCALES = [
  "auto",
  "C major", "C# major", "Db major", "D major", "D# major", "Eb major",
  "E major", "F major", "F# major", "Gb major", "G major", "G# major", "Ab major",
  "A major", "A# major", "Bb major", "B major",
  "C minor", "C# minor", "Db minor", "D minor", "D# minor", "Eb minor",
  "E minor", "F minor", "F# minor", "Gb minor", "G minor", "G# minor", "Ab minor",
  "A minor", "A# minor", "Bb minor", "B minor",
] as const;

/** Time signatures */
export const ACE_TIME_SIGNATURES = ["auto", "4", "3", "2", "6"] as const;

/** Music vocal languages (23) — per ComfyUI node spec */
export const ACE_MUSIC_LANGUAGES = [
  "en", "ja", "zh", "es", "de", "fr", "pt", "ru", "it", "nl",
  "pl", "tr", "vi", "cs", "fa", "id", "ko", "uk", "hu", "ar",
  "sv", "ro", "el",
] as const;

export type AceSampler = (typeof ACE_SAMPLERS)[number];
export type AceScheduler = (typeof ACE_SCHEDULERS)[number];
export type AceGuidanceMode = (typeof ACE_GUIDANCE_MODES)[number];
export type AceKeyscale = (typeof ACE_KEYSCALES)[number];
export type AceTimeSignature = (typeof ACE_TIME_SIGNATURES)[number];
export type AceMusicLanguage = (typeof ACE_MUSIC_LANGUAGES)[number];

/** AceStepSFT quality presets for audio output */
export const ACE_QUALITY_PRESETS = ["V0", "64k", "96k", "128k", "192k", "320k"] as const;
export type AceQualityPreset = (typeof ACE_QUALITY_PRESETS)[number];

// NOTE: exported as route handler (no-op) because auto-router scans all .ts in routes/
export default function configRoute() { /* config-only, no HTTP handler */ }
