/**
 * Unified output path convention for kais-aigc-platform.
 *
 * Problem this solves (v1.5 PATH-01/02):
 *   The codebase accumulated 6+ parallel env vars for "where do generated
 *   files go": OUTPUT_DIR, COMFYUI_OUTPUT_DIR, FLUX_OUTPUT_DIR,
 *   INDEXTTS2_OUTPUT_DIR, LTX_OUTPUT_DIR, etc. Defaults were inconsistent
 *   (some "/mnt/agents/output", some "/mnt/agents/output/gpu1").
 *
 * Convention introduced here:
 *   OUTPUT_ROOT  = single root for all generation outputs
 *                  default: /mnt/agents/output
 *   Each engine writes to a dedicated subdir:
 *     <OUTPUT_ROOT>/ace/      — ACE-Step music
 *     <OUTPUT_ROOT>/flux/     — Flux image generation
 *     <OUTPUT_ROOT>/tts/      — CosyVoice / Chatterbox / IndexTTS2
 *     <OUTPUT_ROOT>/ltx/      — LTX video
 *     <OUTPUT_ROOT>/wan/      — Wan2.2 video
 *     <OUTPUT_ROOT>/postprocess/ — face restore / upscale / RIFE
 *     <OUTPUT_ROOT>/threeD/   — Hunyuan3D / Trellis
 *
 * Legacy env vars (OUTPUT_DIR, FLUX_OUTPUT_DIR, etc.) remain supported
 * as aliases — they override the engine-specific subdir when set. This
 * lets existing deployments continue to work without config changes
 * while new code uses the unified convention.
 *
 * Migration:
 *   - New code: import { engineOutputDir, EngineKind } from "@/lib/paths"
 *   - Existing code: keep using env vars directly; migrate opportunistically
 *     when touching the file for other reasons.
 */

import path from "path";

/**
 * Engine categories with dedicated output subdirectories.
 * Add new engines here as they're introduced.
 */
export type EngineKind =
  | "ace"
  | "flux"
  | "tts"
  | "ltx"
  | "wan"
  | "postprocess"
  | "threeD"
  | "comfyui"; // generic comfyui output (not engine-specific)

/**
 * Subdirectory name under OUTPUT_ROOT for each engine kind.
 * Defaults to the kind name itself; override here only if needed.
 */
const ENGINE_SUBDIR: Record<EngineKind, string> = {
  ace: "ace",
  flux: "flux",
  tts: "tts",
  ltx: "ltx",
  wan: "wan",
  postprocess: "postprocess",
  threeD: "3d",
  comfyui: "", // root — no subdir
};

/**
 * Legacy env var that overrides the engine subdir when set.
 * Maps each engine kind to the env var name that historically controlled
 * its output path. Empty string = no legacy alias (use subdir).
 */
const LEGACY_ENV_OVERRIDE: Record<EngineKind, string> = {
  ace: "COMFYUI_OUTPUT_DIR", // ace writes via comfyui
  flux: "FLUX_OUTPUT_DIR",
  tts: "TTS_OUTPUT_DIR",
  ltx: "LTX_OUTPUT_DIR",
  wan: "WAN_OUTPUT_DIR",
  postprocess: "POSTPROCESS_OUTPUT_DIR",
  threeD: "THREED_OUTPUT_DIR",
  comfyui: "OUTPUT_DIR",
};

/**
 * Resolve the OUTPUT_ROOT — single source of truth for the output tree.
 *
 * Resolution order:
 *   1. OUTPUT_ROOT env var (preferred new convention)
 *   2. OUTPUT_DIR env var (legacy alias — common across codebase)
 *   3. Default: /mnt/agents/output
 */
export function getOutputRoot(): string {
  return process.env.OUTPUT_ROOT || process.env.OUTPUT_DIR || "/mnt/agents/output";
}

/**
 * Resolve the output directory for a specific engine kind.
 *
 * Resolution order:
 *   1. Engine-specific legacy env var (e.g. FLUX_OUTPUT_DIR for flux)
 *      — preserves existing deployment overrides
 *   2. OUTPUT_ROOT/<subdir> per ENGINE_SUBDIR map
 *   3. OUTPUT_ROOT directly (for engines with no subdir, e.g. comfyui)
 *
 * Always returns an absolute path. Does NOT create the directory —
 * callers should use `ensureEngineOutputDir()` or fs.mkdir if needed.
 */
export function engineOutputDir(kind: EngineKind): string {
  const legacyEnvName = LEGACY_ENV_OVERRIDE[kind];
  if (legacyEnvName && process.env[legacyEnvName]) {
    return process.env[legacyEnvName]!;
  }
  const root = getOutputRoot();
  const subdir = ENGINE_SUBDIR[kind];
  return subdir ? path.join(root, subdir) : root;
}

/**
 * Backwards-compatible alias for code that still uses OUTPUT_DIR directly.
 * Equivalent to getOutputRoot() but reads the legacy env var name.
 *
 * @deprecated Prefer getOutputRoot() or engineOutputDir() for new code.
 */
export const OUTPUT_DIR = process.env.OUTPUT_DIR || "/mnt/agents/output";

/**
 * List all engine kinds (useful for diagnostics / listing).
 */
export const ALL_ENGINE_KINDS: EngineKind[] = [
  "ace", "flux", "tts", "ltx", "wan", "postprocess", "threeD", "comfyui",
];
