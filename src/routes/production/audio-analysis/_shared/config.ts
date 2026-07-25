// Mirror shot-analysis/_shared/config.ts pattern (env-driven config object).
// Phase 10 ROUTE-01 stub: only `stubMode` is consulted; the model IDs and
// timeout below are placeholders Phase 12+ will consume when ML fan-out lands.
export const AUDIO_ANALYSIS_CONFIG = {
  // Phase 10 stub default = true; Phase 12+ flips to false once ML is loaded.
  stubMode: process.env.AUDIO_ANALYSIS_STUB_MODE !== "false",
  goldTeamUrl: process.env.GOLD_TEAM_URL || "http://gold-team:8002",
  perShotDeadlineMs: Number(process.env.AUDIO_ANALYSIS_PER_SHOT_TIMEOUT_MS || 900_000),
  // Phase 12+ fills these in when ML lands. Pinned to canonical IDs per
  // 10-RESEARCH.md §Standard Stack (supply-chain T-10-03 mitigation).
  senseVoiceModel: "iic/SenseVoiceSmall",
  whisperxModel: "large-v3",
  mertModel: "m-a-p/MERT-v1-95M",
  pannsCheckpoint: null, // null = default Cnn14_mAP=0.431.pth
  log: process.env.AUDIO_ANALYSIS_LOG === "true",
};
