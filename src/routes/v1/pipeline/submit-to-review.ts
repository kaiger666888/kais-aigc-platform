import express from "express";
import { z } from "zod";
import axios from "axios";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";

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
 *   phase           — pipeline phase: storyboard|character|image|video|audio|compose
 *   assetUrl        — URL of the rendered asset
 *   thumbnailUrl    — optional thumbnail URL
 *   narrativeContext — optional narrative context dict
 *   aiScores        — optional AI score vector
 *   priority        — "normal" | "urgent" (default: "normal")
 *   metadata        — optional metadata dict
 *   callbackUrl     — optional callback URL for review result notification
 */
export default router.post(
  "/",
  validateFields({
    projectId: z.string().min(1),
    shotId: z.string().min(1),
    phase: z.enum(["storyboard", "character", "image", "video", "audio", "compose"]),
    assetUrl: z.string().min(1),
    thumbnailUrl: z.string().optional().nullable(),
    narrativeContext: z.record(z.any()).optional().nullable(),
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
    metadata: z.record(z.any()).optional().nullable(),
    callbackUrl: z.string().url().optional().nullable(),
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
    } = req.body;

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

      return res.status(200).send(
        success({
          reviewCardId: reviewRes.data.id,
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
