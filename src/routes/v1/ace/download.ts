import express from "express";
import path from "path";
import fs from "fs";
import { error } from "@/lib/responseFormat";
import { ACE_CONFIG } from "./config";

const router = express.Router();

/**
 * GET /api/v1/ace/download/:filename
 *
 * Serve an ACE-Step output audio file from the shared output directory.
 */
export default router.get("/:filename", async (req, res) => {
  const { filename } = req.params;
  const safeName = path.basename(filename); // prevent directory traversal
  const filePath = path.join(ACE_CONFIG.outputDir, safeName);

  if (!fs.existsSync(filePath)) {
    return res.status(404).send(error(`File '${safeName}' not found in output directory`));
  }

  const ext = path.extname(safeName).toLowerCase();
  const contentTypes: Record<string, string> = {
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".flac": "audio/flac",
    ".opus": "audio/opus",
    ".aac": "audio/aac",
  };

  res.setHeader("Content-Type", contentTypes[ext] || "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);

  const stream = fs.createReadStream(filePath);
  stream.on("error", () => res.status(500).send(error("Failed to read file")));
  stream.pipe(res);
});
