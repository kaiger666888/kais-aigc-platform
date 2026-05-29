import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { broadcastToProject } from "@/utils/ws";

const router = express.Router();

/**
 * POST /api/v1/pipeline/resume
 *
 * Resume (or retry) a pipeline phase after a reject/revise.
 * The OpenClaw agent polling for state changes will detect the new state
 * and re-execute the phase.
 *
 * Body:
 *   pipelineId — pipeline run id
 *   phase      — phase to retry / resume
 *   reason     — optional reason for resume
 */
export default router.post(
  "/",
  validateFields({
    pipelineId: z.string().min(1),
    phase: z.string().min(1),
    reason: z.string().optional(),
  }),
  async (req, res) => {
    const { pipelineId, phase, reason } = req.body;
    const now = Date.now();

    const pipeline = await u.db("kv_pipelineRun").where({ id: pipelineId }).first();
    if (!pipeline) {
      return res.status(404).send(error(`Pipeline run '${pipelineId}' not found`));
    }

    // Only allow resume from terminal / paused states
    const allowedStates = ["revision-needed", "failed", "paused"];
    if (!pipeline.state || !allowedStates.includes(pipeline.state)) {
      return res.status(409).send(
        error(`Cannot resume pipeline in state '${pipeline.state}'. Expected one of: ${allowedStates.join(", ")}`),
      );
    }

    // Determine phase order from the phase name
    const PHASE_ORDER: Record<string, number> = {
      requirement: 0,
      "art-direction": 1,
      character: 2,
      scenario: 3,
      voice: 4,
      storyboard: 5,
      scene: 6,
      "camera-preview": 7,
      "camera-final": 8,
      "post-production": 9,
      "quality-gate": 10,
      delivery: 11,
    };

    const phaseOrder = PHASE_ORDER[phase] ?? pipeline.currentPhaseOrder ?? 0;

    await u.db("kv_pipelineRun").where({ id: pipelineId }).update({
      state: "running",
      currentPhase: phase,
      currentPhaseOrder: phaseOrder,
      updateTime: now,
    });

    // Write audit record
    await u.db("kv_audit").insert({
      id: now,
      projectId: pipeline.projectId,
      action: "pipeline:resume",
      result: "running",
      detail: `[${phase}] Resumed from ${pipeline.state}. ${reason || ""}`.trim(),
      createTime: now,
    });

    broadcastToProject(pipeline.projectId, "pipeline:resumed", {
      pipelineId,
      phase,
      phaseOrder,
      previousState: pipeline.state,
      reason: reason || null,
    });

    res.status(200).send(
      success({
        pipelineId,
        phase,
        phaseOrder,
        previousState: pipeline.state,
        newState: "running",
        message: `Pipeline resumed at phase '${phase}'`,
      }),
    );
  },
);
