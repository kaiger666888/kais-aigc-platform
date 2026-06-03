import express from "express";
import axios from "axios";
import { success, error } from "@/lib/responseFormat";

const router = express.Router();

const TRELLIS2_COMFYUI_URL = process.env.TRELLIS2_COMFYUI_URL || "http://localhost:8189";

export default router.get("/:promptId", async (req, res) => {
  const { promptId } = req.params;

  try {
    const histRes = await axios.get(`${TRELLIS2_COMFYUI_URL}/history/${encodeURIComponent(promptId)}`, {
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

    // Check for error
    if (historyEntry.status?.status_str === "error" || historyEntry.status?.completed === false) {
      const errMsg = historyEntry.status?.messages?.join("; ") || "ComfyUI execution error";
      return res.status(200).send(success({
        promptId,
        status: "error",
        error: errMsg,
        outputs: null,
      }));
    }

    // Extract outputs from node 86 (ExportTrimesh)
    const outputs = historyEntry.outputs || {};
    const exportNode = outputs["86"];

    if (!exportNode) {
      // Still executing — no output from export node yet
      return res.status(200).send(success({
        promptId,
        status: "executing",
        outputs: null,
      }));
    }

    const glbOutput = exportNode.meshes || [];
    const imageOutput = exportNode.images || [];
    const files: string[] = [...glbOutput, ...imageOutput].map((f: any) =>
      typeof f === "string" ? f : f.filename || f.name,
    );

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
