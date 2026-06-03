import express from "express";
import path from "path";
import fs from "fs";
import { error } from "@/lib/responseFormat";
import { TRELLIS2_CONFIG } from "./config";

const router = express.Router();

export default router.get("/:filename", async (req, res) => {
  const { filename } = req.params;

  const safeName = path.basename(filename);
  const filePath = path.join(TRELLIS2_CONFIG.outputDir, safeName);

  if (!fs.existsSync(filePath)) {
    try {
      const { execSync } = await import("child_process");
      execSync(`docker cp ${TRELLIS2_CONFIG.containerName}:${TRELLIS2_CONFIG.comfyuiOutputDir}/${safeName} "${filePath}"`, {
        timeout: 15_000,
      });
    } catch {
      return res.status(404).send(error(`File '${safeName}' not found`));
    }
  }

  const ext = path.extname(safeName).toLowerCase();
  const contentTypes: Record<string, string> = {
    ".glb": "model/gltf-binary",
    ".gltf": "model/gltf+json",
    ".obj": "text/plain",
    ".fbx": "application/octet-stream",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
  };

  res.setHeader("Content-Type", contentTypes[ext] || "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);

  const stream = fs.createReadStream(filePath);
  stream.on("error", () => res.status(500).send(error("Failed to read file")));
  stream.pipe(res);
});
