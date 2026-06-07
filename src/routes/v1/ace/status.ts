import express from "express";
import { v4 as uuidv4 } from "uuid";
import { success, error } from "@/lib/responseFormat";
import { ACE_CONFIG } from "./config";

const router = express.Router();

/**
 * GET /api/v1/ace/status/:taskId
 *
 * Poll ACE-Step task status from gold-team, enrich with download URL.
 */
export default router.get("/:taskId", async (req, res) => {
  const { taskId } = req.params;

  try {
    const axios = (await import("axios")).default;
    const resp = await axios.get(
      `${ACE_CONFIG.goldTeamUrl}/api/v1/tasks/${encodeURIComponent(taskId)}`,
      { timeout: 10_000, validateStatus: (s: number) => s < 500 },
    );

    const data = resp.data;

    // Enrich completed tasks with download URL
    if (data.status === "completed" && data.outputs?.length) {
      const outputs = data.outputs.map((o: any) => ({
        ...o,
        download_url: o.path
          ? `/api/v1/ace/download/${encodeURIComponent(o.path.split("/").pop())}`
          : null,
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
    const msg =
      err.response?.data?.detail?.message ||
      err.response?.data?.error ||
      err.message ||
      String(err);
    return res.status(502).send(error(`Gold-team status query failed: ${msg}`));
  }
});
