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
    action: z.enum(["approve", "reject", "revise", "select", "compare"]),
    feedback: z.string().optional(),
    pipelineId: z.string().optional(),
    winnerId: z.string().optional(),
    compareAssets: z.array(z.string()).optional(),
    compareScore: z.number().optional(),
  }),
  async (req, res) => {
    const { reviewId, shotId, phase, action, feedback, pipelineId: maybePipelineId, winnerId, compareAssets, compareScore } = req.body;
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
      select: "winner-selected",
      compare: "compare-completed",
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
    } else if (action === "select" && winnerId) {
      // select 模式: 将 winnerId 写入 o_agentWorkData reviewStatus mapping
      const reviewKey = `reviewStatus-${pipeline.episodesId || ""}`;
      const row = await u
        .db("o_agentWorkData")
        .where("projectId", String(projectId))
        .andWhere("key", reviewKey)
        .first();
      if (row?.data) {
        let mapping = typeof row.data === "string" ? JSON.parse(row.data) : row.data;
        if (!mapping[winnerId]) mapping[winnerId] = {};
        mapping[winnerId].isWinner = true;
        await u.db("o_agentWorkData").where("id", row.id).update({ data: JSON.stringify(mapping) });
      }
      updateFields.currentPhaseOrder = (pipeline.currentPhaseOrder ?? 0) + 1;
    } else if (action === "compare") {
      // compare 模式: 对比完成，写入评分
      if (compareScore !== undefined) {
        await u.db("kv_audit").insert({
          id: now + 1,
          projectId,
          action: "review:compare",
          result: `compare-score=${compareScore}`,
          detail: `[${phase}] comparing ${compareAssets?.join(" vs ")}`,
          createTime: now,
        });
      }
      updateFields.currentPhaseOrder = (pipeline.currentPhaseOrder ?? 0) + 1;
    } else {
      // Reject / revise: keep phase and order so the agent knows where to retry
      updateFields.currentPhase = phase;
    }

    await u.db("kv_pipelineRun").where({ id: pipelineId }).update(updateFields);

    // --- Broadcast via WebSocket ---------------------------------------------
    const eventType =
      action === "approve" || action === "select" || action === "compare"
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
