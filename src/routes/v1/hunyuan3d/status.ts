import express from "express";
import axios from "axios";
import { success, error } from "@/lib/responseFormat";
import { HUNYUAN3D_CONFIG } from "./config";

const router = express.Router();

/**
 * GET /api/v1/hunyuan3d/status/:taskId
 *
 * Poll task status from gold-team, enrich with Hunyuan3D-specific info.
 */
export default router.get("/:taskId", async (req, res) => {
  const { taskId } = req.params;

  try {
    const resp = await axios.get(
      `${HUNYUAN3D_CONFIG.goldTeamUrl}/api/v1/tasks/${encodeURIComponent(taskId)}`,
      { timeout: 10_000, validateStatus: (s) => s < 500 },
    );

    const data = resp.data;

    // Enrich completed tasks with download URL
    if (data.status === "completed" && data.outputs?.length) {
      const outputs = data.outputs.map((o: any) => ({
        ...o,
        download_url: o.path ? `/api/v1/hunyuan3d/download/${encodeURIComponent(o.path.split("/").pop())}` : null,
      }));
      return res.status(200).send(success({
        ...data,
        outputs,
      }));
    }

    return res.status(200).send(success(data));
  } catch (err: any) {
    if (err.response?.status === 404) {
      return res.status(404).send(error(`Task '${taskId}' not found`));
    }
    const msg = err.response?.data?.detail?.message || err.response?.data?.error || err.message || String(err);
    return res.status(502).send(error(`Gold-team status query failed: ${msg}`));
  }
});
