/**
 * GET /api/v1/tts/status
 *
 * Health status for all three TTS tracks.
 */
import express, { Router } from "express";
import { success } from "@/lib/responseFormat";
import { TTS_CONFIG } from "./config";

const router = express.Router();

router.get("/", async (_req, res) => {
  const results: Record<string, unknown> = {};

  for (const [track, baseUrl] of Object.entries(TTS_CONFIG.tracks)) {
    try {
      const resp = await fetch(`${baseUrl}/health`, {
        signal: AbortSignal.timeout(5000),
      });
      if (resp.ok) {
        results[track] = await resp.json();
      } else {
        results[track] = { status: "error", http: resp.status };
      }
    } catch {
      results[track] = { status: "offline" };
    }
  }

  const onlineCount = Object.values(results).filter(
    (r: any) => r?.status === "ok" || r?.model_loaded === true
  ).length;

  res.json(success({
    tracks: results,
    online: onlineCount,
    total: Object.keys(TTS_CONFIG.tracks).length,
    routing: {
      zh: "CosyVoice 3.0 (:9882)",
      en: "Chatterbox-Turbo (:9881)",
      bilingual: "CosyVoice 3.0 (:9882)",
      clone: "GPT-SoVITS (:9880)",
    },
  }));
});

export default router;
