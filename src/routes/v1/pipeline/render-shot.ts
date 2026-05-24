import express from "express";
import { z } from "zod";
import axios from "axios";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import u from "@/utils";

const router = express.Router();

// Service URLs (override via env)
const CORE_BACKEND_URL = process.env.CORE_BACKEND_URL || "http://localhost:10588";
const GOLD_TEAM_URL = process.env.GOLD_TEAM_URL || "http://localhost:8002";

/**
 * POST /api/v1/pipeline/render-shot
 *
 * Accept a shot ID → fetch storyboard data from core-backend →
 * submit a render task to gold-team.
 *
 * Body:
 *   shotId       — kv_shot.id (number)
 *   projectId    — project ID (number)
 *   taskType     — gold-team TaskType enum (default: "image_draw")
 *   priority     — "normal" | "high" | "critical" (default: "normal")
 *   callbackUrl  — optional callback URL for gold-team to POST results
 */
export default router.post(
  "/",
  validateFields({
    shotId: z.number(),
    projectId: z.number(),
    taskType: z.enum([
      "video_final",
      "video_preview",
      "image_draw",
      "image_refine",
      "tts",
      "music",
      "sfx",
      "upscale",
      "face_restore",
      "image_to_3d",
    ]).optional(),
    priority: z.enum(["normal", "high", "critical"]).optional(),
    callbackUrl: z.string().url().optional().nullable(),
  }),
  async (req, res) => {
    const {
      shotId,
      projectId,
      taskType = "image_draw",
      priority = "normal",
      callbackUrl = null,
    } = req.body;

    // Step 1: fetch shot data from local DB
    const shotRows = await u
      .db("kv_shot")
      .where({ id: shotId, projectId })
      .select("*")
      .limit(1);

    if (!shotRows.length) {
      return res.status(404).send(error(`Shot ${shotId} not found in project ${projectId}`));
    }

    const shot = shotRows[0];

    // Build params for gold-team task
    const taskParams: Record<string, any> = {
      shotId: shot.id,
      projectId: shot.projectId,
      prompt: shot.prompt || shot.description || "",
      shotIndex: shot.shotIndex,
    };

    // Include image reference if available
    if (shot.referenceImage) {
      taskParams.reference_image = shot.referenceImage;
    }
    if (shot.style) {
      taskParams.style = shot.style;
    }

    // Generate a deterministic task ID for idempotency
    const taskId = `shot-${shotId}-${Date.now()}`;

    // Step 2: submit render task to gold-team
    const goldTeamPayload = {
      task_id: taskId,
      type: taskType,
      priority,
      params: taskParams,
      ...(callbackUrl ? { callback_url: callbackUrl } : {}),
    };

    try {
      const goldRes = await axios.post(
        `${GOLD_TEAM_URL}/api/v1/tasks`,
        goldTeamPayload,
        {
          headers: { "Content-Type": "application/json" },
          timeout: 15_000,
          validateStatus: (s) => s < 500,
        },
      );

      if (goldRes.status !== 202) {
        return res.status(502).send(
          error(`gold-team rejected task: ${JSON.stringify(goldRes.data)}`),
        );
      }

      return res.status(200).send(
        success({
          taskId: goldRes.data.task_id,
          status: goldRes.data.status,
          engineTarget: goldRes.data.engine_target,
          queuePosition: goldRes.data.queue_position,
          estimatedStartSec: goldRes.data.estimated_start_sec,
          shotData: {
            id: shot.id,
            prompt: shot.prompt || shot.description,
            shotIndex: shot.shotIndex,
          },
        }),
      );
    } catch (err: any) {
      const msg = err.response?.data?.detail?.message || err.message || String(err);
      return res.status(502).send(error(`gold-team unreachable: ${msg}`));
    }
  },
);
