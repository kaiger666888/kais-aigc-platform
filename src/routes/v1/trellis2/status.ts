import express from "express";
import axios from "axios";
import path from "path";
import fs from "fs";
import { success, error } from "@/lib/responseFormat";
import { TRELLIS2_CONFIG } from "./config";

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

    return res.status(200).send(success({
      promptId,
      status: "completed",
      outputs: {
        files,
        format: "glb",
      },
    }));
  } catch (err: any) {
    const msg = err.response?.data?.error || err.message || String(err);
    return res.status(502).send(error(`Failed to query ComfyUI status: ${msg}`));
  }
});
