export const HUNYUAN3D_CONFIG = {
  goldTeamUrl: process.env.GOLD_TEAM_URL || "http://gold-team:8002",
  outputDir: process.env.OUTPUT_DIR || "/mnt/agents/output",
  /** Gold-team task engine ID for Hunyuan3D */
  engineId: process.env.HUNYUAN3D_ENGINE_ID || "hunyuan3d-local",
};

// NOTE: exported as route handler (no-op) because auto-router scans all .ts in routes/
export default function configRoute() { /* config-only, no HTTP handler */ }
