import express from "express";
import { success, error } from "@/lib/responseFormat";
import { ACE_CONFIG } from "./config";
import { cancelCallbackTracker } from "./_shared/asyncCallback";
import { getPinnedGpu, comfyuiUrlForGpu } from "@/lib/gpuVramManager";

const router = express.Router();

/**
 * POST /api/v1/ace/cancel/:promptId
 *
 * Cancel a ComfyUI prompt (queued or running).
 * - POST /queue with {delete: [promptId]} removes from queue
 * - POST /interrupt halts the currently-executing prompt
 */
export default router.post("/:promptId", async (req, res) => {
  const { promptId } = req.params;
  if (!promptId) {
    return res.status(400).send(error("promptId is required"));
  }

  // ── M4 双实例: 按提交时钉扎的实例取消 (interrupt 只作用于正确实例;
  // 未钉扎的旧任务回落 primary — 行为不变) ──
  const pinnedGpu = getPinnedGpu(promptId);
  const comfyuiUrl = pinnedGpu === 2 ? comfyuiUrlForGpu(2) : ACE_CONFIG.comfyuiUrl;
  let removed = false;
  let interrupted = false;
  const notes: string[] = [];

  try {
    // 1. Remove from queue (no-op if not queued)
    try {
      const queueRes = await fetch(`${comfyuiUrl}/queue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ delete: [promptId] }),
        signal: AbortSignal.timeout(5_000),
      });
      removed = queueRes.ok;
      if (!queueRes.ok) notes.push(`queue delete returned ${queueRes.status}`);
    } catch (err: any) {
      notes.push(`queue delete failed: ${err.message}`);
    }

    // 2. Interrupt current execution (best-effort; only effective if promptId is the running one)
    try {
      const intrRes = await fetch(`${comfyuiUrl}/interrupt`, {
        method: "POST",
        signal: AbortSignal.timeout(5_000),
      });
      interrupted = intrRes.ok;
    } catch (err: any) {
      notes.push(`interrupt failed: ${err.message}`);
    }

    // 3. Cancel any in-process callback tracker for this promptId
    const trackerCancelled = cancelCallbackTracker(promptId);

    return res.status(200).send(success({
      task_id: promptId,
      cancelled: removed || interrupted,
      removed_from_queue: removed,
      interrupted_running: interrupted,
      callback_tracker_cancelled: trackerCancelled,
      message: removed
        ? "Prompt removed from queue"
        : interrupted
          ? "Running prompt interrupted"
          : "Prompt not found in queue or running (may already be complete)",
      notes: notes.length ? notes : undefined,
    }));
  } catch (err: any) {
    const msg = err.message || String(err);
    return res.status(502).send(error(`ComfyUI cancel failed: ${msg}`));
  }
});
