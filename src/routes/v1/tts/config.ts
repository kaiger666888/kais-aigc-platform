/**
 * TTS Configuration — Three-track TTS system.
 *
 * Tracks:
 *   zh        → CosyVoice 3.0  (中文主声道, 自然度优先)
 *   en        → Chatterbox-Turbo (英文主声道)
 *   bilingual → CosyVoice 3.0  (中英双语)
 *   clone     → GPT-SoVITS     (角色/IP 音色克隆兜底)
 */
export const TTS_CONFIG = {
  /** Base URLs for each TTS service (inside container, use docker network) */
  tracks: {
    zh: process.env.TTS_ZH_URL || "http://127.0.0.1:9882",
    en: process.env.TTS_EN_URL || "http://127.0.0.1:9881",
    bilingual: process.env.TTS_BILINGUAL_URL || "http://127.0.0.1:9882",
    clone: process.env.TTS_CLONE_URL || "http://127.0.0.1:9880",
  } as Record<string, string>,

  /** Track metadata */
  trackMeta: {
    zh: { name: "CosyVoice 3.0", gpu: "3090", vram: "2.5GB", role: "中文主声道" },
    en: { name: "Chatterbox-Turbo", gpu: "3060Ti", vram: "2.8GB", role: "英文主声道" },
    bilingual: { name: "CosyVoice 3.0", gpu: "3090", vram: "2.5GB", role: "中英双语" },
    clone: { name: "GPT-SoVITS", gpu: "3090", vram: "4GB", role: "角色克隆兜底" },
  } as Record<string, { name: string; gpu: string; vram: string; role: string }>,

  /** Default timeout (ms) per track */
  timeoutMs: {
    zh: 60_000,
    en: 60_000,
    bilingual: 120_000,
    clone: 90_000,
  } as Record<string, number>,

  /** Default speaker names */
  defaultSpeaker: {
    zh: "",           // CosyVoice cross_lingual mode, no preset speaker
    en: "alex",       // Chatterbox-Turbo
    bilingual: "",    // CosyVoice cross_lingual mode
    clone: "",        // GPT-SoVITS — needs ref_audio
  } as Record<string, string>,
};

export type TtsTrack = "zh" | "en" | "bilingual" | "clone";

// NOTE: exported as route handler (no-op) because auto-router scans all .ts in routes/
// NOTE: 不导出 default，避免被 router 注册为空 middleware 阻塞后续路由

import express from "express";
const router = express.Router();
export default router;
