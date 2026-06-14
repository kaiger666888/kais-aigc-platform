import express, { Router, Request, Response } from "express";
import { success, error } from "@/lib/responseFormat";
import { ACE_CONFIG } from "./config";
import fs from "fs";
import path from "path";

const router = express.Router();

/**
 * GET /api/v1/ace/comfyui/audio/:filename
 *
 * Download audio file from ComfyUI output directory.
 */
router.get("/:filename", async (req: Request, res: Response) => {
  const filename = Array.isArray(req.params.filename) ? req.params.filename[0] : req.params.filename;

  if (!filename || filename.includes("..") || filename.includes("/")) {
    return res.status(400).send(error("Invalid filename"));
  }

  const outputDir = ACE_CONFIG.comfyuiOutputDir;
  const filePath = path.join(outputDir, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).send(error("Audio file not found"));
  }

  try {
    const stat = fs.statSync(filePath);
    const ext = path.extname(filename).toLowerCase();

    const mimeMap: Record<string, string> = {
      ".flac": "audio/flac",
      ".mp3": "audio/mpeg",
      ".opus": "audio/opus",
      ".wav": "audio/wav",
    };

    res.setHeader("Content-Type", mimeMap[ext] || "application/octet-stream");
    res.setHeader("Content-Length", stat.size);
    res.setHeader("Cache-Control", "public, max-age=86400");

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  } catch (err: any) {
    return res.status(500).send(error(`Audio download failed: ${err.message}`));
  }
});

export default router;
