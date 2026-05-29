import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { broadcastToProject, getIo } from "@/utils/ws";

const router = express.Router();

/**
 * POST /api/v1/pipeline/callback/review-result
 *
 * Callback from review-platform (or Telegram inline button) when a user
 * approves, rejects, or requests revision on a shot.
 *
 * Body:
 *   reviewId   — review card identifier
 *   shotId     — shot identifier
 *   phase      — pipeline phase that was under review
 *   action     — "approve" | "reject" | "revise"
 *   feedback   — optional user feedback text
 *   pipelineId — optional pipeline run id (looked up if omitted)
 */
export default router.post(
  "/",
  validateFields({
    reviewId: z.string().min(1),
    shotId: z.string().min(1),
    phase: z.string().min(1),
    action: z.enum(["approve", "reject", "revise"]),
    feedback: z.string().optional(),
    pipelineId: z.string().optional(),
  }),
  async (req, res) => {
    const { reviewId, shotId, phase, action, feedback, pipelineId: maybePipelineId } = req.body;
    const now = Date.now();

    // --- Resolve pipeline run ------------------------------------------------
    let pipelineId = maybePipelineId || null;
    let pipeline: Record<string, any> | null | undefined = null;

    if (pipelineId) {
      pipeline = await u.db("kv_pipelineRun").where({ id: pipelineId }).first();
    }

    if (!pipeline) {
      // Try to find by matching currentPhase = phase and state = "awaiting-review"
      const candidates = await u.db("kv_pipelineRun")
        .where({ currentPhase: phase, state: "awaiting-review" })
        .orderBy("updateTime", "desc")
        .limit(1);
      if (candidates.length > 0) {
        pipeline = candidates[0];
        pipelineId = pipeline!.id!;
      }
    }

    if (!pipeline || !pipelineId) {
      return res.status(404).send(
        error(`No pipeline run found for phase '${phase}' awaiting review`),
      );
    }

    const projectId = pipeline.projectId;

    // --- Write audit record --------------------------------------------------
    await u.db("kv_audit").insert({
      id: now,
      projectId,
      action: `review:${action}`,
      result: action === "approve" ? "approved" : action === "reject" ? "rejected" : "revise-requested",
      detail: `[${phase}] reviewId=${reviewId} shotId=${shotId}${feedback ? ` feedback="${feedback}"` : ""}`,
      createTime: now,
    });

    // --- Update pipeline state -----------------------------------------------
    const nextState: Record<string, string> = {
      approve: "running",
      reject: "revision-needed",
      revise: "revision-needed",
    };

    const updateFields: Record<string, any> = {
      state: nextState[action],
      updateTime: now,
    };

    if (action === "approve") {
      // Advance currentPhaseOrder so the next phase can start
      const currentOrder = pipeline.currentPhaseOrder ?? 0;
      updateFields.currentPhaseOrder = currentOrder + 1;
      // We don't update currentPhase here — the orchestrator (OpenClaw agent)
      // will set it when it picks up the next phase.
    } else {
      // Reject / revise: keep phase and order so the agent knows where to retry
      updateFields.currentPhase = phase;
    }

    await u.db("kv_pipelineRun").where({ id: pipelineId }).update(updateFields);

    // --- Broadcast via WebSocket ---------------------------------------------
    const eventType =
      action === "approve"
        ? "pipeline:review-approved"
        : "pipeline:review-rejected";

    broadcastToProject(projectId, eventType, {
      pipelineId,
      reviewId,
      shotId,
      phase,
      action,
      feedback: feedback || null,
    });

    // Also emit on the dedicated pipelineProgress namespace
    const io = getIo();
    if (io) {
      io.of("/api/socket/pipelineProgress")
        .to(`pipeline:${pipelineId}`)
        .emit("pipeline:review-result", {
          pipelineId,
          reviewId,
          shotId,
          phase,
          action,
          feedback: feedback || null,
        });
    }

    res.status(200).send(
      success({
        pipelineId,
        action,
        newState: nextState[action],
        message:
          action === "approve"
            ? `Phase '${phase}' approved, pipeline resuming`
            : `Phase '${phase}' ${action === "reject" ? "rejected" : "revision requested"}, awaiting rework`,
      }),
    );
  },
);
