import express, { Router, Request, Response } from "express";
import { success, error } from "@/lib/responseFormat";
import { ACE_CONFIG } from "./config";
import { gpuOutputRoots } from "@/lib/gpuVramManager";
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

  // ── M4 双实例产物: 多根查找 (主根 → gpu2 根; GPU2 实例产物落 gpu2/) ──
  let filePath: string | null = null;
  for (const root of gpuOutputRoots()) {
    const candidate = path.join(root, filename);
    if (fs.existsSync(candidate)) {
      filePath = candidate;
      break;
    }
  }
  if (!filePath) {
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
