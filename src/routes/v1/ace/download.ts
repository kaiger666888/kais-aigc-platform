import express, { Router } from "express";
import { getGpuScheduler } from "@/services/gpu";

const router = express.Router();

const ACE_URL = process.env.ACE_DIRECT_URL || "http://kais-acestep:8001";

/**
 * GET /api/v1/ace/download
 *
 * Proxy audio file download from ACE-Step container.
 * Query param: path (URL-encoded path returned by ACE-Step)
 * Example: /api/v1/ace/download?path=%2Fv1%2Faudio%3Fpath%3D...
 */
router.get("/", async (req, res) => {
  const { path: audioPath } = req.query;

  if (!audioPath || typeof audioPath !== "string") {
    return res.status(400).json({ code: 400, message: "Missing 'path' query parameter" });
  }

  try {
    // ACE returns path like /v1/audio?path=%2Fapp%2F.cache%2F...
    // We need to proxy through the ACE container
    const proxyUrl = `${ACE_URL}${audioPath}`;
    const response = await fetch(proxyUrl);

    if (!response.ok) {
      return res.status(response.status).json({
        code: response.status,
        message: `ACE-Step audio fetch failed: ${response.statusText}`,
      });
    }

    const contentType = response.headers.get("content-type") || "audio/mpeg";
    const contentLength = response.headers.get("content-length");

    res.setHeader("Content-Type", contentType);
    if (contentLength) res.setHeader("Content-Length", contentLength);
    res.setHeader("Cache-Control", "public, max-age=86400");

    const buffer = await response.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (err: any) {
    return res.status(502).json({
      code: 502,
      message: `Audio download failed: ${err.message}`,
    });
  }
});

export default router;
