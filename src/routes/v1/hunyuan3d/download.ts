import express from "express";
import path from "path";
import fs from "fs";
import { error } from "@/lib/responseFormat";
import { HUNYUAN3D_CONFIG } from "./config";

const router = express.Router();

/**
 * GET /api/v1/hunyuan3d/download/:filename
 *
 * Serve a Hunyuan3D output file (GLB) from the shared output directory.
 */
export default router.get("/:filename", async (req, res) => {
  const { filename } = req.params;
  const safeName = path.basename(filename);
  const filePath = path.join(HUNYUAN3D_CONFIG.outputDir, safeName);

  if (!fs.existsSync(filePath)) {
    return res.status(404).send(error(`File '${safeName}' not found in output directory`));
  }

  const ext = path.extname(safeName).toLowerCase();
  const contentTypes: Record<string, string> = {
    ".glb": "model/gltf-binary",
    ".gltf": "model/gltf+json",
    ".obj": "text/plain",
    ".fbx": "application/octet-stream",
    ".png": "image/png",
    ".jpg": "image/jpeg",
  };

  res.setHeader("Content-Type", contentTypes[ext] || "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);

  const stream = fs.createReadStream(filePath);
  stream.on("error", () => res.status(500).send(error("Failed to read file")));
  stream.pipe(res);
});
