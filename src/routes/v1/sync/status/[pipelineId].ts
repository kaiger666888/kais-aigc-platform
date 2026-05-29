import express from "express";
import u from "@/utils";
import { success, error } from "@/lib/responseFormat";

const router = express.Router();

/**
 * GET /api/v1/sync/status/:pipelineId
 *
 * Query sync status for a pipeline.
 */
export default router.get("/:pipelineId", async (req, res) => {
  const { pipelineId } = req.params;

  try {
    const syncRecord = await u.db("kv_syncStatus")
      .where({ pipelineId })
      .orderBy("syncTime", "desc")
      .first();

    if (!syncRecord) {
      return res.status(404).send(error(`No sync record found for pipeline ${pipelineId}`));
    }

    return res.status(200).send(
      success({
        pipelineId: syncRecord.pipelineId,
        projectId: syncRecord.projectId,
        toonflowProjectId: syncRecord.toonflowProjectId,
        status: syncRecord.status, // "completed" | "failed"
        syncedAssets: syncRecord.syncedAssets || 0,
        syncedStoryboards: syncRecord.syncedStoryboards || 0,
        syncedVideos: syncRecord.syncedVideos || 0,
        syncTime: syncRecord.syncTime,
        error: syncRecord.error || null,
      }),
    );
  } catch (err: any) {
    const msg = err.message || String(err);
    return res.status(500).send(error(`Failed to query sync status: ${msg}`));
  }
});
