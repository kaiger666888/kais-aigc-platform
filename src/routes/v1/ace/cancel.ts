import express from "express";
import { success, error } from "@/lib/responseFormat";
import { ACE_CONFIG } from "./config";

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

  const comfyuiUrl = ACE_CONFIG.comfyuiUrl;
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
      });
      removed = queueRes.ok;
      if (!queueRes.ok) notes.push(`queue delete returned ${queueRes.status}`);
    } catch (err: any) {
      notes.push(`queue delete failed: ${err.message}`);
    }

    // 2. Interrupt current execution (best-effort; only effective if promptId is the running one)
    try {
      const intrRes = await fetch(`${comfyuiUrl}/interrupt`, { method: "POST" });
      interrupted = intrRes.ok;
    } catch (err: any) {
      notes.push(`interrupt failed: ${err.message}`);
    }

    return res.status(200).send(success({
      task_id: promptId,
      cancelled: removed || interrupted,
      removed_from_queue: removed,
      interrupted_running: interrupted,
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
