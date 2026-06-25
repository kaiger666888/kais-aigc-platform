import express from "express";
import axios from "axios";
import path from "path";
import fs from "fs";
import { execSync } from "child_process";
import { success, error } from "@/lib/responseFormat";
import { TRELLIS2_CONFIG } from "./config";

const fixingInProgress = new Set<string>();

function fixedPathFor(filename: string) {
  return filename.replace(/\.glb$/, "_fixed.glb");
}

function triggerPostProcess(filename: string) {
  if (fixingInProgress.has(filename)) return;
  fixingInProgress.add(filename);

  const localPath = path.join(TRELLIS2_CONFIG.outputDir, filename);
  const fixedName = fixedPathFor(filename);
  const localFixedPath = path.join(TRELLIS2_CONFIG.outputDir, fixedName);

  // Already fixed
  if (fs.existsSync(localFixedPath)) {
    fixingInProgress.delete(filename);
    return;
  }

  // Copy from container if not local
  if (!fs.existsSync(localPath)) {
    try {
      execSync(`docker cp ${TRELLIS2_CONFIG.containerName}:${TRELLIS2_CONFIG.comfyuiOutputDir}/${filename} "${localPath}"`, { timeout: 30_000 });
    } catch {
      console.error(`[post-process] docker cp failed for ${filename}`);
      fixingInProgress.delete(filename);
      return;
    }
  }

  // Run fix.sh
  try {
    execSync(`bash ${TRELLIS2_CONFIG.fixScript} "${localPath}" --output "${localFixedPath}" --auto`, { timeout: 120_000 });
    console.log(`[post-process] Fixed: ${filename} → ${fixedName}`);
  } catch (err) {
    console.error(`[post-process] fix.sh failed for ${filename}:`, err);
  } finally {
    fixingInProgress.delete(filename);
  }
}

const router = express.Router();

export default router.get("/:promptId", async (req, res) => {
  const { promptId } = req.params;

  try {
    const histRes = await axios.get(`${TRELLIS2_CONFIG.comfyuiUrl}/history/${encodeURIComponent(promptId)}`, {
      timeout: 15_000,
      validateStatus: (s) => s < 500,
    });

    if (histRes.status === 404 || !histRes.data || !histRes.data[promptId]) {
      return res.status(200).send(success({
        promptId,
        status: "pending",
        outputs: null,
      }));
    }

    const historyEntry = histRes.data[promptId];

    if (historyEntry.status?.status_str === "error" || historyEntry.status?.completed === false) {
      const errMsg = historyEntry.status?.messages?.join("; ") || "ComfyUI execution error";
      return res.status(200).send(success({
        promptId,
        status: "error",
        error: errMsg,
        outputs: null,
      }));
    }

    const outputs = historyEntry.outputs || {};
    const exportNode = outputs["86"];

    if (!exportNode) {
      return res.status(200).send(success({
        promptId,
        status: "executing",
        outputs: null,
      }));
    }

    const meshes = exportNode.meshes || [];
    if (meshes.length === 0) {
      return res.status(200).send(success({
        promptId,
        status: "executing",
        outputs: null,
      }));
    }

    const files = meshes.map((f: any) => {
      const filename = typeof f === "string" ? f : f.filename || f.name;
      const subfolder = typeof f === "string" ? "" : (f.subfolder || "");
      const fullPath = subfolder ? `${subfolder}/${filename}` : filename;

      let size: number | null = null;
      try {
        const localPath = path.join(TRELLIS2_CONFIG.outputDir, filename);
        if (fs.existsSync(localPath)) {
          size = fs.statSync(localPath).size;
        }
      } catch {}

      return { filename, subfolder, path: fullPath, size };
    });

    // Check post-process state and trigger async fix for GLB files
    let postProcessed = false;
    const glbFiles = files.filter((f: any) => f.filename.endsWith(".glb"));
    if (glbFiles.length > 0) {
      const allFixed = glbFiles.every((f: any) =>
        fs.existsSync(path.join(TRELLIS2_CONFIG.outputDir, fixedPathFor(f.filename)))
      );
      postProcessed = allFixed;

      // Fire-and-forget fix for unfixed GLB files
      for (const f of glbFiles) {
        triggerPostProcess(f.filename);
      }
    }

    return res.status(200).send(success({
      promptId,
      status: "completed",
      outputs: {
        files,
        format: "glb",
        post_processed: postProcessed,
      },
    }));
  } catch (err: any) {
    const msg = err.response?.data?.error || err.message || String(err);
    return res.status(502).send(error(`Failed to query ComfyUI status: ${msg}`));
  }
});
