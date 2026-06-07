import express from "express";
import { success, error } from "@/lib/responseFormat";
import { ACE_CONFIG } from "./config";

const router = express.Router();

/**
 * GET /api/v1/ace/models
 *
 * List available ACE-Step models.
 * Falls back to defaults if gold-team doesn't expose a models endpoint.
 */
export default router.get("/", async (req, res) => {
  try {
    const axios = (await import("axios")).default;
    const resp = await axios.get(`${ACE_CONFIG.goldTeamUrl}/api/v1/engines`, {
      timeout: 5_000,
      validateStatus: (s: number) => s < 500,
    });

    // Try to extract ACE engine info
    const engines = resp.data?.engines || resp.data || [];
    const aceEngine = Array.isArray(engines)
      ? engines.find((e: any) => e.engine_id?.includes("ace") || e.name?.includes("ACE"))
      : null;

    if (aceEngine) {
      return res.status(200).send(success({
        models: aceEngine.models || ["acestep-v15-xl-turbo", "acestep-v15-xl-sft"],
        engine_id: aceEngine.engine_id || ACE_CONFIG.engineId,
        status: aceEngine.status || "unknown",
        capabilities: aceEngine.capabilities || null,
      }));
    }
  } catch {
    // Fallback to static defaults
  }

  // Static defaults when gold-team is unreachable or has no ACE info
  return res.status(200).send(success({
    models: [
      {
        id: "acestep-v15-xl-turbo",
        name: "ACE-Step 1.5 XL Turbo",
        description: "Fast generation, good quality. Recommended for production.",
        default: true,
      },
      {
        id: "acestep-v15-xl-sft",
        name: "ACE-Step 1.5 XL SFT",
        description: "Highest quality, slower. Best for final output.",
        default: false,
      },
    ],
    engine_id: ACE_CONFIG.engineId,
    status: "cached",
    task_types: [
      { type: "text2music", label: "Text to Music", description: "Generate music from text prompt and/or lyrics" },
      { type: "cover", label: "Cover Version", description: "Create a cover version of a reference song" },
      { type: "repaint", label: "Repaint", description: "Repaint/re-generate a section of existing audio" },
      { type: "extract", label: "Extract", description: "Extract stems/separate tracks from audio" },
      { type: "lego", label: "LEGO", description: "Build a full track from individual stem descriptions" },
      { type: "complete", label: "Complete", description: "Complete/extend an existing audio clip" },
      { type: "remix", label: "Remix", description: "Remix an existing audio track" },
    ],
    audio_formats: ["mp3", "wav", "flac", "opus", "aac", "wav32"],
  }));
});
