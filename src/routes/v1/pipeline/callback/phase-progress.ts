import express from "express";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { broadcastToProject } from "@/utils/ws";

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

    broadcastToProject(projectId, "pipeline:progress", {
      pipelineId,
      phase,
      progress,
      message: message || "",
    });

    res.status(200).send(success({ acknowledged: true }));
  },
);
