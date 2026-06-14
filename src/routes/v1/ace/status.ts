import express from "express";
import { success, error } from "@/lib/responseFormat";
import { ACE_CONFIG } from "./config";

const router = express.Router();

interface ComfyUIHistoryEntry {
  prompt: { [nodeId: string]: { class_type: string; inputs?: any } };
  outputs: { [nodeId: string]: { audio?: Array<{ filename: string; subfolder?: string; type?: string }> } };
  status: {
    status_str?: "success" | "error";
    completed?: boolean;
    messages?: Array<{ type?: string; data?: any }>;
  };
}

interface ComfyUIQueueItem {
  number: number;
  prompt: [string, number]; // [prompt_id, ...]
}

/**
 * GET /api/v1/ace/status/:promptId
 *
 * Poll task status from ComfyUI history + queue.
 *
 * Status mapping:
 *   - In queue (running/queued) → { status: "queued" | "running" }
 *   - In history with status_str=success → { status: "completed", outputs: [...] }
 *   - In history with status_str=error   → { status: "failed", error: ... }
 *   - Neither → { status: "unknown", hint: "expired or invalid promptId" }
 */
export default router.get("/:promptId", async (req, res) => {
  const { promptId } = req.params;
  if (!promptId) {
    return res.status(400).send(error("promptId is required"));
  }

  const comfyuiUrl = ACE_CONFIG.comfyuiUrl;
  const outputDir = ACE_CONFIG.comfyuiOutputDir;

  try {
    // 1. Check history (completed/failed)
    const historyRes = await fetch(`${comfyuiUrl}/history/${encodeURIComponent(promptId)}`, {
      signal: AbortSignal.timeout(5_000),
    });

    if (historyRes.ok) {
      const historyData = (await historyRes.json()) as { [promptId: string]: ComfyUIHistoryEntry };
      const entry = historyData[promptId];
      if (entry) {
        const statusStr = entry.status?.status_str;
        if (statusStr === "success") {
          // Extract audio outputs
          const outputs: any[] = [];
          for (const [nodeId, nodeOut] of Object.entries(entry.outputs || {})) {
            if (nodeOut.audio?.length) {
              for (const audio of nodeOut.audio) {
                outputs.push({
                  node_id: nodeId,
                  filename: audio.filename,
                  subfolder: audio.subfolder || "",
                  path: `${outputDir}/${audio.filename}`,
                  download_url: `/api/v1/ace/comfyui/audio/${encodeURIComponent(audio.filename)}`,
                });
              }
            }
          }
          return res.status(200).send(success({
            task_id: promptId,
            status: "completed",
            outputs,
            engine: "comfyui",
          }));
        }
        if (statusStr === "error") {
          const errMsg = entry.status?.messages?.find((m: any) => m.type === "execution_error")?.data?.error_message
            || "ComfyUI execution error";
          return res.status(200).send(success({
            task_id: promptId,
            status: "failed",
            error: errMsg,
            engine: "comfyui",
          }));
        }
      }
    }

    // 2. Check queue (pending/running)
    const queueRes = await fetch(`${comfyuiUrl}/queue`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (queueRes.ok) {
      const queueData = (await queueRes.json()) as {
        queue_running: ComfyUIQueueItem[];
        queue_pending: ComfyUIQueueItem[];
      };
      const isRunning = queueData.queue_running?.some((q) => q.prompt?.[0] === promptId);
      const isPending = queueData.queue_pending?.some((q) => q.prompt?.[0] === promptId);
      if (isRunning || isPending) {
        return res.status(200).send(success({
          task_id: promptId,
          status: isRunning ? "running" : "queued",
          engine: "comfyui",
        }));
      }
    }

    // 3. Neither — unknown / expired
    return res.status(200).send(success({
      task_id: promptId,
      status: "unknown",
      engine: "comfyui",
      hint: "promptId not in queue or history — may have expired, been cancelled, or never submitted",
    }));
  } catch (err: any) {
    const msg = err.message || String(err);
    return res.status(502).send(error(`ComfyUI status query failed: ${msg}`));
  }
});
