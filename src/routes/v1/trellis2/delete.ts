import express from "express";
import path from "path";
import fs from "fs";
import axios from "axios";
import { success, error } from "@/lib/responseFormat";

const router = express.Router();

const TRELLIS2_COMFYUI_URL = process.env.TRELLIS2_COMFYUI_URL || "http://localhost:8189";
const OUTPUT_DIR = process.env.OUTPUT_DIR || "/mnt/agents/output";

export default router.delete("/:promptId", async (req, res) => {
  const { promptId } = req.params;

  // Try to get history to find output files
  let outputFiles: string[] = [];

  try {
    const histRes = await axios.get(`${TRELLIS2_COMFYUI_URL}/history/${encodeURIComponent(promptId)}`, {
      timeout: 10_000,
      validateStatus: (s) => s < 500,
    });

    if (histRes.data?.[promptId]?.outputs?.["86"]) {
      const exportNode = histRes.data[promptId].outputs["86"];
      const meshes = exportNode.meshes || [];
      const images = exportNode.images || [];
      outputFiles = [...meshes, ...images].map((f: any) =>
        typeof f === "string" ? f : f.filename || f.name,
      );
    }
  } catch {
    // Ignore — proceed with cleanup of what we can
  }

  // Delete local output files
  const deleted: string[] = [];
  for (const file of outputFiles) {
    const safeName = path.basename(file);
    const baseName = path.basename(safeName, path.extname(safeName));
    const localPath = path.join(OUTPUT_DIR, safeName);

    // Delete main file + preview screenshots
    const toDelete = [localPath];
    for (let i = 1; i <= 3; i++) {
      toDelete.push(path.join(OUTPUT_DIR, `${baseName}_preview${i}.png`));
    }

    for (const p of toDelete) {
      try { fs.unlinkSync(p); deleted.push(path.basename(p)); } catch {}
    }
  }

  // Delete from ComfyUI container output
  try {
    const { execSync } = await import("child_process");
    for (const file of outputFiles) {
      try {
        execSync(`docker exec comfyui-trellis rm -f /app/ComfyUI/output/${path.basename(file)}`, {
          timeout: 5_000,
        });
      } catch {}
    }
  } catch {}

  return res.status(200).send(success({
    promptId,
    deleted,
    message: `Cleaned up ${deleted.length} files`,
  }));
});
