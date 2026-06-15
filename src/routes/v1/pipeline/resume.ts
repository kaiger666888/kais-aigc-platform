import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { broadcastToProject } from "@/utils/ws";
import { registry } from "@/skills/registry";

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

    // Resolve the active skill_id from the pipeline row (Phase 31 refactor).
    // Pre-Phase-30 rows may have null skill_id; fall back to "movie-v1" with a
    // warn so existing in-flight runs keep working.
    let skillId = pipeline.skill_id || "movie-v1";
    if (!pipeline.skill_id) {
      console.warn(
        `[resume] pipeline '${pipelineId}' has null skill_id — falling back to movie-v1.`,
      );
    }

    // Skill-registered guard: if the skill_id (resolved or fallback) is not in
    // the registry, surface a 500 — signals operator action needed (dropped
    // registry row, race with boot, etc.). No silent fallback to movie-v1 here
    // (registry contract: lookup is explicit, never scan-and-guess).
    const skillManifest = registry.get(skillId);
    if (!skillManifest) {
      return res.status(500).send(error(`skill '${skillId}' not registered`));
    }

    // Determine phase order from the registry. If the phase is not in the
    // skill's taxonomy (undefined phaseDecl), fall back to the pipeline's
    // currentPhaseOrder, then 0 — preserves the existing ?? fallback chain.
    const phaseDecl = registry.phaseById(skillId, phase);
    const phaseOrder = phaseDecl?.order ?? pipeline.currentPhaseOrder ?? 0;

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
