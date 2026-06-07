import express from "express";
import { success, error } from "@/lib/responseFormat";
import { ACE_CONFIG } from "./config";

const router = express.Router();

/**
 * POST /api/v1/ace/cancel/:taskId
 *
 * Cancel an ACE-Step task via gold-team.
 */
export default router.post("/:taskId", async (req, res) => {
  const { taskId } = req.params;

  try {
    const axios = (await import("axios")).default;
    const resp = await axios.post(
      `${ACE_CONFIG.goldTeamUrl}/api/v1/tasks/${encodeURIComponent(taskId)}/cancel`,
      {},
      { timeout: 10_000, validateStatus: (s: number) => s < 500 },
    );

    return res.status(200).send(success({
      task_id: taskId,
      cancelled: true,
      message: "ACE-Step task cancellation submitted",
    }));
  } catch (err: any) {
    if (err.response?.status === 404) {
      return res.status(404).send(error(`Task '${taskId}' not found`));
    }
    if (err.response?.status === 409) {
      return res.status(409).send(error(`Task '${taskId}' cannot be cancelled (already completed/failed)`));
    }
    const msg =
      err.response?.data?.detail?.message ||
      err.response?.data?.error ||
      err.message ||
      String(err);
    return res.status(502).send(error(`Gold-team cancel failed: ${msg}`));
  }
});
