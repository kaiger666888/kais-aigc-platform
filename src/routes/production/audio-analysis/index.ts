/**
 * 逐镜头音频语义解构 — THIN stub route (Phase 10 ROUTE-01)
 *
 * POST /api/production/audio-analysis
 *   body: { video, shots, audio?, transcript?, shot_id_range? }
 *
 * Phase 10 (THIS): STUB ONLY. Returns schema-shaped empty data
 *   { shots: [], count: 0, errors: [], stub_mode: true }
 * so the Phase 12 producer client (call_audio_analysis.py) has an
 * integration target BEFORE route ML lands. Mirrors v1.1 Phase 7
 * CAST deferred pattern (live ML round-trip deferred to post-merge smoke).
 *
 * Phase 12+ (post-merge): replaces the STUB block below with fan-out to
 *   SenseVoice / WhisperX / MERT / PANNs / pyannote via gold-team tasks
 *   (mirror shot-analysis/index.ts gold-team task pattern). Intentionally
 *   NOT implemented in Phase 10 — spike runs models directly in throwaway
 *   scripts under spike/audio/, not through this route.
 *
 * -------------------------------------------------------------------------
 * SECURITY NOTE (T-10-04 mitigation): Phase 10 stub validates TYPE only
 *   via zod. It does NOT read `video` / `shots` / `audio` / `transcript`
 *   files from disk even though they appear in the body schema. Phase 12+
 *   MUST add path sandboxing (allow-list + fs.access guards) before any
 *   fs.readFileSync / path.resolve on body-supplied paths.
 * -------------------------------------------------------------------------
 *
 * Envelope via @/lib/responseFormat.ts:success — byte-identical shape
 *   to shot-analysis so call_audio_analysis.py can be built now.
 */

import express from "express";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { AUDIO_ANALYSIS_CONFIG } from "./_shared/config";

const router = express.Router();

const bodySchema = z.object({
  video: z.string().min(1),
  shots: z.string().min(1),
  audio: z.string().optional(),      // path to audio_analysis.json (cached Demucs analysis)
  transcript: z.string().optional(), // path to transcript.json
  shot_id_range: z.tuple([z.number().int(), z.number().int()]).optional(),
});

router.post("/", async (req: any, res: any) => {
  let params: z.infer<typeof bodySchema>;
  try {
    params = bodySchema.parse(req.body);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json(error("VALIDATION_ERROR", (err as any).errors));
    }
    return res.status(500).json(error("AUDIO_ANALYSIS_FAILED", (err as Error).message));
  }

  // Phase 10 boundary: validated type only, did NOT touch params.video/shots.
  // (T-10-04 mitigation — Phase 12+ adds path sandboxing before any fs read.)

  // --- Phase 10 STUB MODE: ML unloaded, return schema-shaped empty data ---
  // Phase 12+ replaces this block with fan-out to SenseVoice/WhisperX/MERT/PANNs.
  if (AUDIO_ANALYSIS_CONFIG.stubMode || !process.env.AUDIO_ANALYSIS_ML_LOADED) {
    return res.json(success({
      shots: [],
      count: 0,
      errors: [],
      stub_mode: true,
      message: "Phase 10 stub: ML models not loaded. Producer client envelope round-trip proven.",
    }, "Audio analysis stub"));
  }

  // --- Phase 12+ placeholder: ML fan-out goes here (mirror shot-analysis
  //     index.ts gold-team task pattern). Intentionally NOT implemented in
  //     Phase 10 — spike runs models directly in scripts/, not through route. ---

  return res.status(501).json(error("NOT_IMPLEMENTED",
    "ML path not yet wired — Phase 12+ responsibility"));
});

export default router;
