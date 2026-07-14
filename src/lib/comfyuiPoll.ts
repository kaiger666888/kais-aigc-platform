/**
 * ComfyUI polling + output retrieval helpers.
 *
 * Extracted from src/routes/production/qwenTts/speak.ts so the BGM
 * verification flow can reuse the same logic.
 */

import axios from "axios";
import path from "path";
import fs from "fs";
import { LTX_CONFIG } from "@/routes/production/ltx/config";

export interface ComfyUiOutputFile {
  filename: string;
  subfolder: string;
  type: string; // "output" | "temp"
}

export interface PollResult {
  status: "success" | "error";
  outputs?: Record<string, any>;
  error?: string;
  elapsedMs: number;
}

/**
 * Poll /history/{promptId} until ComfyUI reports success or error.
 */
export async function pollComfyUi(
  promptId: string,
  opts: {
    comfyuiUrl?: string;
    pollIntervalMs?: number;
    pollTimeoutMs?: number;
    onTick?: (elapsedMs: number, statusStr?: string) => void;
  } = {},
): Promise<PollResult> {
  const comfyuiUrl = opts.comfyuiUrl || LTX_CONFIG.comfyuiUrl;
  const interval = opts.pollIntervalMs ?? LTX_CONFIG.pollIntervalMs;
  const timeout = opts.pollTimeoutMs ?? LTX_CONFIG.pollTimeoutMs;
  const start = Date.now();
  const deadline = start + timeout;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, interval));
    try {
      const resp = await axios.get(`${comfyuiUrl}/history/${promptId}`, {
        timeout: 10_000,
      });
      const entry = resp.data?.[promptId];
      if (entry) {
        const statusStr = entry.status?.status_str;
        if (statusStr === "success") {
          return {
            status: "success",
            outputs: entry.outputs,
            elapsedMs: Date.now() - start,
          };
        }
        if (statusStr === "error") {
          return {
            status: "error",
            error: JSON.stringify(
              entry.status?.messages || entry.status || "Unknown error",
            ).slice(0, 1000),
            elapsedMs: Date.now() - start,
          };
        }
        opts.onTick?.(Date.now() - start, statusStr);
      } else {
        opts.onTick?.(Date.now() - start, "queued");
      }
    } catch {
      // Network hiccup; keep polling.
    }
  }
  return {
    status: "error",
    error: `Timeout after ${timeout / 1000}s`,
    elapsedMs: Date.now() - start,
  };
}

/**
 * Find the first video file in ComfyUI outputs.
 */
export function findOutputVideo(
  outputs: Record<string, any>,
): ComfyUiOutputFile | null {
  for (const nodeId of Object.keys(outputs)) {
    const nodeOutput = outputs[nodeId];
    // SaveVideo uses "images" or "gifs"; VHS_VideoCombine uses "images"; CreateVideo+SaveVideo uses "videos"
    const candidates = [
      ...(nodeOutput?.videos || []),
      ...(nodeOutput?.gifs || []),
      ...(nodeOutput?.images || []),
    ];
    for (const c of candidates) {
      const fn: string = c.filename || "";
      if (/\.(mp4|webm|mov|mkv|avi)$/i.test(fn)) {
        return {
          filename: fn,
          subfolder: c.subfolder || "",
          type: c.type || "output",
        };
      }
    }
  }
  return null;
}

/**
 * Build the /view URL for an output file.
 */
export function buildViewUrl(
  file: ComfyUiOutputFile,
  comfyuiUrl: string = LTX_CONFIG.comfyuiUrl,
): string {
  const q = new URLSearchParams({
    filename: file.filename,
    subfolder: file.subfolder,
    type: file.type,
  });
  return `${comfyuiUrl}/view?${q.toString()}`;
}

/**
 * Download an output file from ComfyUI to a local temp path for analysis.
 */
export async function downloadOutput(
  file: ComfyUiOutputFile,
  opts: { comfyuiUrl?: string; destDir?: string } = {},
): Promise<string> {
  const url = buildViewUrl(file, opts.comfyuiUrl);
  const destDir = opts.destDir || "/tmp/comfyui-dl";
  fs.mkdirSync(destDir, { recursive: true });
  const ext = path.extname(file.filename) || ".mp4";
  const dest = path.join(destDir, `${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`);
  const resp = await axios.get(url, { responseType: "stream", timeout: 60_000 });
  const ws = fs.createWriteStream(dest);
  await new Promise<void>((resolve, reject) => {
    resp.data.pipe(ws);
    ws.on("finish", () => resolve());
    ws.on("error", reject);
  });
  return dest;
}
