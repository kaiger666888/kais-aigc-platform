import express from "express";
import { Router, Request, Response } from "express";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { ACE_CONFIG } from "./config";

const router = express.Router();

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

const analyzeSchema = z.object({
  audio_path: z.string().min(1, "audio_path is required"),
  audio_duration: z.number().int().min(1).max(600).default(60),
  unload_model: z.boolean().default(true),
});

/** Build ComfyUI workflow for AceStepSFTMusicAnalyzer. */
function buildAnalyzerWorkflow(p: z.infer<typeof analyzeSchema>) {
  return {
    "1": {
      class_type: "LoadAudio",
      inputs: {
        audio: p.audio_path,
      },
    },
    "2": {
      class_type: "AceStepSFTModelLoader",
      inputs: {
        diffusion_model: "acestep_v1.5_sft.safetensors",
        text_encoder_1: "qwen_0.6b_ace15.safetensors",
        text_encoder_2: "qwen_1.7b_ace15.safetensors",
        vae_name: "ace_1.5_vae.safetensors",
      },
    },
    "3": {
      class_type: "AceStepSFTMusicAnalyzer",
      inputs: {
        model: ["2", 0],
        audio: ["1", 0],
        audio_duration: p.audio_duration,
        unload_model: p.unload_model,
      },
    },
  };
}

/** Poll ComfyUI history until prompt completes or times out. */
async function pollUntilComplete(
  comfyuiUrl: string,
  promptId: string,
): Promise<{ status: string; outputs?: any }> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const res = await fetch(`${comfyuiUrl}/history/${promptId}`);
    if (!res.ok) throw new Error(`ComfyUI history error: ${res.status}`);

    const history = (await res.json()) as Record<string, any>;
    const entry = history[promptId];
    if (entry) {
      if (entry.status?.status === "error") {
        throw new Error(`ComfyUI execution error: ${JSON.stringify(entry.status.messages || [])}`);
      }
      if (entry.status?.completed || entry.outputs) {
        return { status: "success", outputs: entry.outputs };
      }
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error("ComfyUI analysis timed out (10 min)");
}

/**
 * POST /api/v1/ace/comfyui/analyze
 *
 * Analyze audio via ComfyUI AceStep SFT Music Analyzer.
 */
export default router.post("/", async (req: Request, res: Response) => {
  const parsed = analyzeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).send(
      error("Validation failed: " + parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")),
    );
  }

  const p = parsed.data;
  const comfyuiUrl = ACE_CONFIG.comfyuiUrl;
  const workflow = buildAnalyzerWorkflow(p);

  try {
    // 1. Submit to ComfyUI
    const submitRes = await fetch(`${comfyuiUrl}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: workflow }),
    });

    if (!submitRes.ok) {
      const body = await submitRes.text();
      return res.status(502).send(error(`ComfyUI submit failed (${submitRes.status}): ${body}`));
    }

    const { prompt_id } = (await submitRes.json()) as { prompt_id: string };
    if (!prompt_id) {
      return res.status(502).send(error("ComfyUI returned no prompt_id"));
    }

    // 2. Poll until complete
    const result = await pollUntilComplete(comfyuiUrl, prompt_id);

    if (result.status !== "success" || !result.outputs) {
      return res.status(500).send(error("ComfyUI analysis failed"));
    }

    // 3. Extract analysis results from node 3
    const analyzerOutput = result.outputs["3"];
    if (!analyzerOutput) {
      return res.status(500).send(error("No analysis output from ComfyUI"));
    }

    return res.send(success({
      task_id: prompt_id,
      analysis: analyzerOutput,
    }));
  } catch (err: any) {
    return res.status(500).send(error(err.message || "Internal server error"));
  }
});
