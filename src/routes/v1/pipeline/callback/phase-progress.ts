import express from "express";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { broadcastToProject } from "@/utils/ws";
import { getIo } from "@/utils/ws";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    pipelineId: z.string(),
    projectId: z.number(),
    phase: z.string(),
    progress: z.number().min(0).max(100),
    message: z.string().optional(),
  }),
  async (req, res) => {
    const { pipelineId, projectId, phase, progress, message } = req.body;

    broadcastToProject(projectId, "pipeline:phase-progress", {
      pipelineId,
      phase,
      progress,
      message: message || "",
    });

    // Also emit on the dedicated pipelineProgress namespace
    const io = getIo();
    if (io) {
      io.of("/api/socket/pipelineProgress")
        .to(`pipeline:${pipelineId}`)
        .emit("pipeline:phase-progress", {
          pipelineId,
          phase,
          progress,
          message: message || "",
        });
    }

    res.status(200).send(success({ acknowledged: true }));
  },
);
