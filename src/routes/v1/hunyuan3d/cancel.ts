import express from "express";
import axios from "axios";
import path from "path";
import fs from "fs";
import { success, error } from "@/lib/responseFormat";
import { HUNYUAN3D_CONFIG } from "./config";

const router = express.Router();

/**
 * POST /api/v1/hunyuan3d/cancel/:taskId
 *
 * Cancel a Hunyuan3D task via gold-team.
 */
export default router.post("/:taskId", async (req, res) => {
  const { taskId } = req.params;

  try {
    const resp = await axios.post(
      `${HUNYUAN3D_CONFIG.goldTeamUrl}/api/v1/tasks/${encodeURIComponent(taskId)}/cancel`,
      {},
      { timeout: 10_000, validateStatus: (s) => s < 500 },
    );

    return res.status(200).send(success({
      task_id: taskId,
      cancelled: true,
      message: "Hunyuan3D task cancellation submitted",
    }));
  } catch (err: any) {
    if (err.response?.status === 404) {
      return res.status(404).send(error(`Task '${taskId}' not found`));
    }
    if (err.response?.status === 409) {
      return res.status(409).send(error(`Task '${taskId}' cannot be cancelled (already completed/failed)`));
    }
    const msg = err.response?.data?.detail?.message || err.response?.data?.error || err.message || String(err);
    return res.status(502).send(error(`Gold-team cancel failed: ${msg}`));
  }
});
