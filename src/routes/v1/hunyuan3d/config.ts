export const HUNYUAN3D_CONFIG = {
  goldTeamUrl: process.env.GOLD_TEAM_URL || "http://gold-team:8002",
  outputDir: process.env.OUTPUT_DIR || "/mnt/agents/output",
  /** Gold-team task engine ID for Hunyuan3D */
  engineId: process.env.HUNYUAN3D_ENGINE_ID || "hunyuan3d-local",
};
