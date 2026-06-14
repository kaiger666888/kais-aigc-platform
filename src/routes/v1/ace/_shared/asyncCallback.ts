/**
 * Fire-and-forget callback poller for async ComfyUI submissions.
 *
 * When /api/v1/ace/generate accepts a callback_url, it returns immediately
 * with a prompt_id. ComfyUI itself does not invoke callbacks on completion,
 * so this module polls /history/:promptId in the background and POSTs the
 * result to the registered callback_url when the prompt finishes (or fails,
 * or times out).
 *
 * Limitations:
 *   - State is in-process. If the server restarts while a generation is
 *     pending, the callback is lost. Clients should still poll
 *     /api/v1/ace/status/:promptId as a fallback.
 *   - No persistence across cluster workers (project is single-process
 *     today; see src/app.ts).
 */

const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_MAX_WAIT_MS = 30 * 60 * 1000; // 30 min
const COMFYUI_TIMEOUT_MS = 5_000;

interface ActiveTracker {
  promptId: string;
  callbackUrl: string;
  startedAt: number;
  maxWaitMs: number;
  cancelled: boolean;
}

const activeTrackers = new Map<string, ActiveTracker>();

/**
 * Start polling ComfyUI for prompt completion and fire the callback when done.
 * Safe to call multiple times for the same promptId — only the first
 * registration takes effect.
 */
export function startCallbackTracker(opts: {
  promptId: string;
  callbackUrl: string;
  comfyuiUrl: string;
  maxWaitMs?: number;
  pollIntervalMs?: number;
}): void {
  const {
    promptId,
    callbackUrl,
    comfyuiUrl,
    maxWaitMs = DEFAULT_MAX_WAIT_MS,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  } = opts;

  if (activeTrackers.has(promptId)) return;

  const tracker: ActiveTracker = {
    promptId,
    callbackUrl,
    startedAt: Date.now(),
    maxWaitMs,
    cancelled: false,
  };
  activeTrackers.set(promptId, tracker);

  // Fire-and-forget — caller does not await
  void runTrackerLoop(tracker, comfyuiUrl, pollIntervalMs);
}

/**
 * Cancel a tracker (e.g., when /cancel/:promptId is called).
 * Removes it from the active set; the in-flight loop will exit on next tick.
 */
export function cancelCallbackTracker(promptId: string): boolean {
  const tracker = activeTrackers.get(promptId);
  if (!tracker) return false;
  tracker.cancelled = true;
  activeTrackers.delete(promptId);
  return true;
}

/**
 * Current count of in-flight trackers (for diagnostics / scheduler endpoint).
 */
export function activeTrackerCount(): number {
  return activeTrackers.size;
}

async function runTrackerLoop(
  tracker: ActiveTracker,
  comfyuiUrl: string,
  pollIntervalMs: number,
): Promise<void> {
  try {
    while (!tracker.cancelled) {
      const elapsed = Date.now() - tracker.startedAt;
      if (elapsed > tracker.maxWaitMs) {
        await postCallback(tracker.callbackUrl, {
          event: "timeout",
          task_id: tracker.promptId,
          reason: `exceeded max wait ${tracker.maxWaitMs}ms`,
        });
        return;
      }

      await sleep(pollIntervalMs);
      if (tracker.cancelled) return;

      const outcome = await queryComfyUIOutcome(comfyuiUrl, tracker.promptId);
      if (outcome === "pending") continue;

      if (outcome === "success") {
        await postCallback(tracker.callbackUrl, {
          event: "complete",
          task_id: tracker.promptId,
          status: "completed",
        });
      } else if (outcome === "error") {
        await postCallback(tracker.callbackUrl, {
          event: "failed",
          task_id: tracker.promptId,
          status: "failed",
        });
      }
      return;
    }
  } catch (err: any) {
    console.error(`[ACE Callback Tracker] Uncaught error for prompt ${tracker.promptId}:`, err?.message || err);
  } finally {
    activeTrackers.delete(tracker.promptId);
  }
}

type ComfyUIOutcome = "pending" | "success" | "error" | "unknown";

async function queryComfyUIOutcome(comfyuiUrl: string, promptId: string): Promise<ComfyUIOutcome> {
  try {
    const res = await fetch(
      `${comfyuiUrl}/history/${encodeURIComponent(promptId)}`,
      { signal: AbortSignal.timeout(COMFYUI_TIMEOUT_MS) },
    );
    if (!res.ok) return "unknown";
    const data = (await res.json()) as {
      [promptId: string]: { status?: { status_str?: string } };
    };
    const entry = data[promptId];
    if (!entry) return "pending";
    const statusStr = entry.status?.status_str;
    if (statusStr === "success") return "success";
    if (statusStr === "error") return "error";
    return "pending";
  } catch {
    return "unknown";
  }
}

async function postCallback(url: string, payload: Record<string, any>): Promise<void> {
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err: any) {
    console.warn(`[ACE Callback Tracker] POST to ${url} failed: ${err?.message || err}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// NOTE: router.ts auto-scans all .ts in src/routes/. Export an empty Express
// router so the auto-generator can mount it without blocking subsequent
// routes (Express Router auto-calls next() when no sub-route matches).
import express from "express";
const router = express.Router();
export default router;
