import express from "express";
import axios from "axios";
import { success, error } from "@/lib/responseFormat";

const router = express.Router();

const GOLD_TEAM_URL = process.env.GOLD_TEAM_URL || "http://localhost:8002";

/**
 * GET /api/v1/pipeline/status/:taskId
 *
 * Query gold-team task status by task ID.
 */
export default router.get("/:taskId", async (req, res) => {
  const { taskId } = req.params;

  try {
    const goldRes = await axios.get(
      `${GOLD_TEAM_URL}/api/v1/tasks/${encodeURIComponent(taskId)}`,
      {
        timeout: 10_000,
        validateStatus: (s) => s < 500,
      },
    );

    if (goldRes.status === 404) {
      return res.status(404).send(error(`Task '${taskId}' not found`));
    }

    return res.status(200).send(
      success({
        taskId: goldRes.data.task_id,
        type: goldRes.data.type,
        status: goldRes.data.status,
        priority: goldRes.data.priority,
        engineUsed: goldRes.data.engine_used,
        outputs: goldRes.data.outputs || null,
        metadata: goldRes.data.metadata || null,
        createdAt: goldRes.data.created_at,
        updatedAt: goldRes.data.updated_at,
        completedAt: goldRes.data.completed_at || null,
        failedAt: goldRes.data.failed_at || null,
      }),
    );
  } catch (err: any) {
    const msg = err.response?.data?.detail?.message || err.message || String(err);
    return res.status(502).send(error(`gold-team unreachable: ${msg}`));
  }
});
