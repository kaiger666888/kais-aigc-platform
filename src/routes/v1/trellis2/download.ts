import express from "express";
import path from "path";
import fs from "fs";
import { error } from "@/lib/responseFormat";

const router = express.Router();

const OUTPUT_DIR = process.env.OUTPUT_DIR || "/mnt/agents/output";

export default router.get("/:filename", async (req, res) => {
  const { filename } = req.params;

  // Prevent path traversal
  const safeName = path.basename(filename);
  const filePath = path.join(OUTPUT_DIR, safeName);

  if (!fs.existsSync(filePath)) {
    // Try to copy from ComfyUI container first
    try {
      const { execSync } = await import("child_process");
      execSync(`docker cp comfyui-trellis:/app/ComfyUI/output/${safeName} "${filePath}"`, {
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
