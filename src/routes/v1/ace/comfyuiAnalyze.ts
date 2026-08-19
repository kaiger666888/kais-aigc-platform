import express from "express";
import { Router, Request, Response } from "express";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import {
  VramInsufficientError,
  QueueTimeoutError,
  QueueAbortedError,
  QueuePurgedError,
  withGpuQueueTimed,
} from "@/lib/gpuVramManager";
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
  /** 排队等待补偿 (withGpuQueueTimed 的 queueWaitMs) — 排队耗时不计入作业预算 */
  extraBudgetMs = 0,
): Promise<{ status: string; outputs?: any }> {
  const deadline = Date.now() + POLL_TIMEOUT_MS + extraBudgetMs;
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

  // ─── 2026-08-19 收编：GPU 全局串行队列 (gpuVramManager withGpuQueueTimed) ───
  // 来源 docs/engine-integration-spec.md M2 / docs/gpu-unified-scheduling-plan.md §P2-A。
  // ACE Music Analyzer 加载完整 SFT 模型 (~7GB, 与 /generate 同 engineKey "ace") —
  // 此前直提 ComfyUI 绕过队列, 是同卡撞车源。同步语义 (提交+轮询到完成才返回):
  // 锁罩「提交+轮询」整段; queueWaitMs 不计入轮询预算 (POLL_TIMEOUT_MS +
  // queueWaitMs, 镜像 minimax-h3/generate.ts 双重超时修复)。
  try {
    const { data } = await withGpuQueueTimed(
      "ace",
      async (queueWaitMs) => {
        // 1. Submit to ComfyUI
        const submitRes = await fetch(`${comfyuiUrl}/prompt`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: workflow }),
        });

        if (!submitRes.ok) {
          const body = await submitRes.text();
          return { kind: "rejected" as const, detail: `ComfyUI submit failed (${submitRes.status}): ${body}` };
        }

        const { prompt_id } = (await submitRes.json()) as { prompt_id: string };
        if (!prompt_id) {
          return { kind: "rejected" as const, detail: "ComfyUI returned no prompt_id" };
        }

        // 2. Poll until complete (10 min + 排队补偿)
        const result = await pollUntilComplete(comfyuiUrl, prompt_id, queueWaitMs);

        if (result.status !== "success" || !result.outputs) {
          return { kind: "poll_failed" as const, promptId: prompt_id };
        }

        // 3. Extract analysis results from node 3
        const analyzerOutput = result.outputs["3"];
        if (!analyzerOutput) {
          return { kind: "no_output" as const, promptId: prompt_id };
        }

        return { kind: "ok" as const, promptId: prompt_id, analysis: analyzerOutput };
      },
      { gpuIndex: 1, comfyuiUrl },
    );

    if (data.kind === "rejected") {
      return res.status(502).send(error(data.detail));
    }
    if (data.kind === "poll_failed") {
      return res.status(500).send(error("ComfyUI analysis failed"));
    }
    if (data.kind === "no_output") {
      return res.status(500).send(error("No analysis output from ComfyUI"));
    }

    return res.send(success({
      task_id: data.promptId,
      analysis: data.analysis,
    }));
  } catch (err: any) {
    if (err instanceof VramInsufficientError) {
      return res.status(503).send(error(err.message, {
        kind: "vram_insufficient",
        engine: "ace",
        freeMiB: err.freeMiB,
        requiredMiB: err.requiredMiB,
        gpuIndex: err.gpuIndex,
      }));
    }
    // 队列类结构化错误: queue_timeout→504 / queue_aborted→499 / queue_purged→503
    // (镜像 minimax-h3/generate.ts 三联判)
    if (
      err instanceof QueueTimeoutError ||
      err instanceof QueueAbortedError ||
      err instanceof QueuePurgedError
    ) {
      const status =
        err.kind === "queue_timeout" ? 504 : err.kind === "queue_aborted" ? 499 : 503;
      return res.status(status).send(error(err.message, {
        kind: err.kind,
        engine: err.engine,
        gpuIndex: err.gpuIndex,
      }));
    }
    return res.status(500).send(error(err.message || "Internal server error"));
  }
});
