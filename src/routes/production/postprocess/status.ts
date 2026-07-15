import express from "express";
import axios from "axios";
import { success, error } from "@/lib/responseFormat";
import { POSTPROCESS_CONFIG } from "./_shared/config";

const router = express.Router();

// ─── GET /api/production/postprocess/status/:promptId ─────
// 查询后处理任务状态

export default router.get("/", async (req: any, res) => {
  const promptId = req.params.promptId || (req.query.promptId as string);

  if (!promptId) return res.status(400).send(error("promptId is required"));

  try {
    const resp = await axios.get(
      `${POSTPROCESS_CONFIG.comfyuiUrl}/history/${promptId}`,
      { timeout: 10_000, validateStatus: (s: number) => s < 500 },
    );

    const hist = resp.data;
    if (!hist[promptId]) {
      // 还在队列中
      const queueResp = await axios.get(`${POSTPROCESS_CONFIG.comfyuiUrl}/queue`, { timeout: 10_000 });
      const running = queueResp.data.queue_running || [];
      const pending = queueResp.data.queue_pending || [];
      const inRunning = running.some((item: any[]) => item[1] === promptId);
      const inPending = pending.some((item: any[]) => item[1] === promptId);

      if (inRunning) {
        return res.status(200).send(success({ promptId, status: "running" }));
      } else if (inPending) {
        return res.status(200).send(success({ promptId, status: "pending" }));
      } else {
        return res.status(200).send(success({ promptId, status: "unknown" }));
      }
    }

    const entry = hist[promptId];
    const statusStr = entry.status?.status_str || "done";
    const outputs = entry.outputs || {};

    const images: Array<{ filename: string; subfolder: string; width: number; height: number }> = [];
    for (const nid of Object.keys(outputs)) {
      const out = outputs[nid];
      if (out.images) {
        images.push(...out.images);
      }
    }

    // VHS_VideoCombine 把视频输出放在 gifs 字段（即使是 mp4），单独收集
    const videos: Array<{ filename: string; subfolder: string; format: string; frame_rate: number }> = [];
    for (const nid of Object.keys(outputs)) {
      const out = outputs[nid];
      if (out.gifs) {
        videos.push(...out.gifs);
      }
    }

    // 构建可访问的 URL
    const imageUrls = images.map((img) => ({
      filename: img.filename,
      url: `${POSTPROCESS_CONFIG.comfyuiUrl}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder || "")}&type=output`,
      width: img.width,
      height: img.height,
    }));

    const videoUrls = videos.map((v) => ({
      filename: v.filename,
      url: `${POSTPROCESS_CONFIG.comfyuiUrl}/view?filename=${encodeURIComponent(v.filename)}&subfolder=${encodeURIComponent(v.subfolder || "")}&type=output`,
      format: v.format,
      frameRate: v.frame_rate,
    }));

    res.status(200).send(success({
      promptId,
      status: statusStr === "success" ? "done" : statusStr,
      images: imageUrls,
      videos: videoUrls,
    }));
  } catch (err: any) {
    const msg = err.response?.data?.error?.message || err.message || String(err);
    res.status(502).send(error(`Status check failed: ${msg}`));
  }
});
