import express from "express";
import axios from "axios";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { success, error } from "@/lib/responseFormat";
import { SCAIL2_CONFIG } from "../_shared/scail2-config";

const router = express.Router();

const TAILSCALE_BASE = process.env.TAILSCALE_BASE_URL || "https://kais-engine.taile7d1c8.ts.net";
const OUTPUT_RELATIVE_DIR = "scail2-outputs";
const HOST_OUTPUT_DIR = `${SCAIL2_CONFIG.outputDir.replace("/gpu1", "")}/${OUTPUT_RELATIVE_DIR}`;
if (!fs.existsSync(HOST_OUTPUT_DIR)) {
  try { fs.mkdirSync(HOST_OUTPUT_DIR, { recursive: true }); } catch {}
}

function dockerExec(cmd: string): string {
  try {
    return execSync(cmd, { timeout: 15_000, encoding: "utf-8" }).trim();
  } catch {
    return "";
  }
}

function faststartRemux(containerSrc: string, hostDst: string): boolean {
  const tmpSrc = `/tmp/__scail2_fs_src_${Date.now()}.mp4`;
  try {
    execSync(`docker cp ${SCAIL2_CONFIG.containerName}:"${containerSrc}" "${tmpSrc}"`, { timeout: 30_000 });
    execSync(`ffmpeg -y -i "${tmpSrc}" -movflags +faststart -c copy "${hostDst}"`, { timeout: 60_000, stdio: "ignore" });
    return true;
  } catch {
    return false;
  } finally {
    try { fs.unlinkSync(tmpSrc); } catch {}
  }
}

export default router.get("/:promptId", async (req: any, res) => {
  await getStatus(req, res);
});

router.get("/", async (req: any, res) => {
  await getStatus(req, res);
});

async function getStatus(req: any, res: any) {
  const promptId = req.params.promptId || (req.query.promptId as string);
  if (!promptId) return res.status(400).send(error("promptId is required"));

  try {
    const resp = await axios.get(
      `${SCAIL2_CONFIG.comfyuiUrl}/history/${promptId}`,
      { timeout: 10_000, validateStatus: (s: number) => s < 500 },
    );
    const hist = resp.data;

    if (!hist[promptId]) {
      const queueResp = await axios.get(`${SCAIL2_CONFIG.comfyuiUrl}/queue`, { timeout: 10_000 });
      const running = queueResp.data.queue_running || [];
      const pending = queueResp.data.queue_pending || [];
      const inRunning = running.some((item: any[]) => item[1] === promptId);
      const inPending = pending.some((item: any[]) => item[1] === promptId);
      const status = inRunning ? "running" : inPending ? "pending" : "unknown";
      return res.status(200).send(success({ promptId, status }));
    }

    const entry = hist[promptId];
    const statusStr = entry.status?.status_str || "done";
    const outputs = entry.outputs || {};

    const videos: any[] = [];
    const images: any[] = [];
    for (const nid of Object.keys(outputs)) {
      const out = outputs[nid];
      if (out.gifs) videos.push(...out.gifs);
      if (out.images) images.push(...out.images);
    }

    const resultVideos: any[] = [];
    for (const v of videos) {
      const filename = v.filename as string;
      const subfolder = v.subfolder || "";
      const containerPath = `${SCAIL2_CONFIG.comfyuiOutputDir}/${subfolder ? subfolder + "/" : ""}${filename}`.replace(/\/+/g, "/");

      const exists = dockerExec(`docker exec ${SCAIL2_CONFIG.containerName} test -f "${containerPath}" && echo YES || echo NO`) === "YES";
      if (!exists) {
        resultVideos.push({ filename, subfolder, status: "container_file_missing" });
        continue;
      }

      const hostName = `${promptId}.mp4`;
      const hostPath = path.join(HOST_OUTPUT_DIR, hostName);
      const ok = faststartRemux(containerPath, hostPath);
      if (!ok) {
        resultVideos.push({ filename, subfolder, status: "remux_failed" });
        continue;
      }
      const stat = fs.statSync(hostPath);
      const tailscaleUrl = `${TAILSCALE_BASE}/oss/${OUTPUT_RELATIVE_DIR}/${hostName}`;
      resultVideos.push({
        filename, subfolder,
        status: "ok",
        sizeBytes: stat.size,
        hostPath,
        tailscaleUrl,
      });
    }

    res.status(200).send(success({
      promptId,
      status: statusStr === "success" ? "done" : statusStr,
      videos: resultVideos,
      previewImages: images.map((im) => ({
        filename: im.filename,
        comfyuiUrl: `${SCAIL2_CONFIG.comfyuiUrl}/view?filename=${encodeURIComponent(im.filename)}&type=output`,
      })),
    }));
  } catch (err: any) {
    const msg = err.response?.data?.error?.message || err.message || String(err);
    res.status(502).send(error(`Status check failed: ${msg}`));
  }
}
