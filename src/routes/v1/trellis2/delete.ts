import express from "express";
import path from "path";
import fs from "fs";
import axios from "axios";
import { success, error } from "@/lib/responseFormat";
import { TRELLIS2_CONFIG } from "./config";

const router = express.Router();

export default router.delete("/:promptId", async (req, res) => {
  const { promptId } = req.params;
  const containerName = TRELLIS2_CONFIG.containerName;

  let outputFiles: string[] = [];

  try {
    const histRes = await axios.get(`${TRELLIS2_CONFIG.comfyuiUrl}/history/${encodeURIComponent(promptId)}`, {
      timeout: 10_000,
      validateStatus: (s) => s < 500,
    });

    if (histRes.data?.[promptId]?.outputs?.["86"]) {
      const exportNode = histRes.data[promptId].outputs["86"];
      const meshes = exportNode.meshes || [];
      outputFiles = meshes.map((f: any) =>
        typeof f === "string" ? f : f.filename || f.name,
      );
    }

    // Also try to find the input filename from node 1 (LoadImage)
    const loadImageNode = histRes.data?.[promptId]?.outputs?.["1"];
    let inputFile: string | null = null;
    if (loadImageNode?.images?.length) {
      inputFile = typeof loadImageNode.images[0] === "string"
        ? loadImageNode.images[0]
        : loadImageNode.images[0].filename || null;
    }

    // Cleanup container input file
    if (inputFile) {
      try {
        const { execSync } = await import("child_process");
        execSync(`docker exec ${containerName} rm -f ${TRELLIS2_CONFIG.comfyuiInputDir}/${path.basename(inputFile)}`, {
          timeout: 5_000,
        });
      } catch {}
    }
  } catch {
    // Ignore — proceed with cleanup of what we can
  }

  // Delete local output files
  const deleted: string[] = [];
  for (const file of outputFiles) {
    const safeName = path.basename(file);
    const baseName = path.basename(safeName, path.extname(safeName));
    const localPath = path.join(TRELLIS2_CONFIG.outputDir, safeName);

    const toDelete = [localPath];
    for (let i = 1; i <= 3; i++) {
      toDelete.push(path.join(TRELLIS2_CONFIG.outputDir, `${baseName}_preview${i}.png`));
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
        execSync(`docker exec ${containerName} rm -f ${TRELLIS2_CONFIG.comfyuiOutputDir}/${path.basename(file)}`, {
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
