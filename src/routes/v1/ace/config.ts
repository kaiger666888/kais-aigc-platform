export const ACE_CONFIG = {
  goldTeamUrl: process.env.GOLD_TEAM_URL || "http://gold-team:8002",
  outputDir: process.env.OUTPUT_DIR || "/mnt/agents/output",
  /** Gold-team task engine ID for ACE-Step */
  engineId: process.env.ACE_ENGINE_ID || "acestep-internal",
  /** Default model for generation */
  defaultModel: process.env.ACE_DEFAULT_MODEL || "acestep-v15-xl-turbo",
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

// NOTE: exported as route handler (no-op) because auto-router scans all .ts in routes/
export default function configRoute() { /* config-only, no HTTP handler */ }
