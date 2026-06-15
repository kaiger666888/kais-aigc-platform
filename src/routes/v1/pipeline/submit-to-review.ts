import express from "express";
import { z } from "zod";
import axios from "axios";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { sendReviewCard } from "@/lib/telegram-review";
import { registry } from "@/skills/registry";
import u from "@/utils";

const router = express.Router();

const REVIEW_PLATFORM_URL = process.env.REVIEW_PLATFORM_URL || "http://localhost:8090";

/**
 * POST /api/v1/pipeline/submit-to-review
 *
 * Submit a completed render result to the review platform.
 *
 * Body:
 *   projectId       — project identifier (string, for review platform)
 *   shotId          — shot identifier (string, for review platform)
 *   phase           — pipeline phase string (validated against the active skill's
 *                     taxonomy at runtime). Old enum IDs (image/video/audio/compose)
 *                     are NOT in movie-v1's taxonomy and will return 400 — they were
 *                     never valid phase IDs downstream; the pre-refactor z.enum
 *                     silently accepted them, surfacing the bug later. This is a
 *                     documented behavior fix, not a regression.
 *   assetUrl        — URL of the rendered asset
 *   thumbnailUrl    — optional thumbnail URL
 *   narrativeContext — optional narrative context dict
 *   aiScores        — optional AI score vector
 *   priority        — "normal" | "urgent" (default: "normal")
 *   metadata        — optional metadata dict
 *   callbackUrl     — optional callback URL for review result notification
 *   pipelineId      — optional pipeline run ID; when present, the handler looks up
 *                     kv_pipelineRun.skill_id to resolve the active skill. Defaults
 *                     to "movie-v1" silently when pipelineId is absent or the row
 *                     has no skill_id (direct-curl path — silent fallback per
 *                     CONTEXT.md "submit-to-review's skill source").
 */
export default router.post(
  "/",
  validateFields({
    projectId: z.string().min(1),
    shotId: z.string().min(1),
    phase: z.string().min(1),
    assetUrl: z.string().min(1),
    thumbnailUrl: z.string().optional().nullable(),
    narrativeContext: z.record(z.string(), z.any()).optional().nullable(),
    aiScores: z
      .object({
        aesthetics: z.number().min(0).max(10).optional(),
        consistency: z.number().min(0).max(10).optional(),
        compliance: z.number().min(0).max(10).optional(),
        technical_quality: z.number().min(0).max(10).optional(),
        audio_match: z.number().min(0).max(10).optional(),
      })
      .optional()
      .nullable(),
    priority: z.enum(["normal", "urgent"]).optional(),
    metadata: z.record(z.string(), z.any()).optional().nullable(),
    callbackUrl: z.string().url().optional().nullable(),
    pipelineId: z.string().optional(),
  }),
  async (req, res) => {
    const {
      projectId,
      shotId,
      phase,
      assetUrl,
      thumbnailUrl = null,
      narrativeContext = null,
      aiScores = null,
      priority = "normal",
      metadata = null,
      callbackUrl = null,
      pipelineId: _,
    } = req.body;

    // --- Active skill resolution + phase taxonomy validation --------------
    // Per CONTEXT.md "submit-to-review's skill source": if the body carries a
    // pipelineId, look up kv_pipelineRun.skill_id. If pipelineId is absent
    // (direct curl) or the row has no skill_id, silently fall back to
    // "movie-v1" (no warn — submit-to-review is a less critical path than
    // phase-complete/resume per CONTEXT.md). The review submission does not
    // strictly need the pipeline row to exist.
    const pipelineRow = req.body.pipelineId
      ? await u.db("kv_pipelineRun").where({ id: req.body.pipelineId }).first()
      : undefined;
    const skillId = pipelineRow?.skill_id || "movie-v1";

    // Skill-registered guard: 500 if the resolved skill is not in the registry.
    // Signals operator action needed (dropped registry row, race with boot).
    const skillManifest = registry.get(skillId);
    if (!skillManifest) {
      return res.status(500).send(error(`skill '${skillId}' not registered`));
    }

    // Phase-declared guard: 400 if the phase is not in the skill's taxonomy.
    // Old invalid enum IDs (image/video/audio/compose) are not in movie-v1's
    // taxonomy and now correctly fail here instead of passing validation then
    // failing downstream. The phaseDecl is a pure validation gate — submit-to-
    // review forwards the phase string to the review platform as-is.
    const phaseDecl = registry.phaseById(skillId, phase);
    if (!phaseDecl) {
      return res
        .status(400)
        .send(error(`phase '${phase}' not declared by skill '${skillId}'`));
    }

    const reviewPayload: Record<string, any> = {
      project_id: projectId,
      shot_id: shotId,
      phase,
      asset_url: assetUrl,
      priority,
    };

    if (thumbnailUrl) reviewPayload.thumbnail_url = thumbnailUrl;
    if (narrativeContext) reviewPayload.narrative_context = narrativeContext;
    if (aiScores) reviewPayload.ai_scores = aiScores;
    if (metadata) reviewPayload.metadata = metadata;
    if (callbackUrl) reviewPayload.callback_url = callbackUrl;

    try {
      const reviewRes = await axios.post(
        `${REVIEW_PLATFORM_URL}/api/v1/v6/shot-cards/`,
        reviewPayload,
        {
          headers: { "Content-Type": "application/json" },
          timeout: 15_000,
          validateStatus: (s) => s < 500,
        },
      );

      if (reviewRes.status !== 201) {
        return res.status(502).send(
          error(`review-platform rejected submission: ${JSON.stringify(reviewRes.data)}`),
        );
      }

      const reviewCardId = reviewRes.data.id;

      // --- Send Telegram review card (fire-and-forget) ----------------------
      const telegramChatId = process.env.TELEGRAM_REVIEW_CHAT_ID;
      if (telegramChatId) {
        sendReviewCard(telegramChatId, {
          reviewId: reviewCardId,
          pipelineId: req.body.pipelineId || reviewCardId,
          shotId,
          phase,
          assetUrl,
          thumbnailUrl: thumbnailUrl || undefined,
          aiScores: aiScores || undefined,
        }).catch((e) => console.error("[submit-to-review] telegram notify failed:", e.message));
      }

      return res.status(200).send(
        success({
          reviewCardId,
          status: reviewRes.data.status,
          phase: reviewRes.data.phase,
          createdAt: reviewRes.data.created_at,
        }),
      );
    } catch (err: any) {
      const msg = err.response?.data?.detail?.message || err.message || String(err);
      return res.status(502).send(error(`review-platform unreachable: ${msg}`));
    }
  },
);
