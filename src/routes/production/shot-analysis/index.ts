/**
 * 逐镜头运镜解构 — THIN gold-team proxy route
 *
 * POST /api/v1/production/shot-analysis
 *   body: { video, shots, shot_id_range?, semantic?, subject?, grid_n?, fps? }
 *
 * 这个路由只做四件事:
 *   1. zod 校验 body
 *   2. 读 shots.json + 按 shot_id_range 过滤
 *   3. 把宿主机视频暂存进 ComfyUI 容器(docker cp,必要时)使 params.video 容器可见
 *   4. 为每个镜头向 gold-team v6 排一个 SHOT_ANALYSIS task
 *      (POST /api/v1/tasks → GET /api/v1/tasks/{id} 轮询到 completed/failed),
 *      聚合每个 task 的 shot JSON sidecar 返回
 *
 * 所有 ComfyUI workflow 构建、prompt 提交、history 轮询、串行排队、VRAM 调度
 * 都在 gold-team v6 executor + ComfyUIEngine 里。TS 侧只做 fan-out + 轮询聚合,
 * 不直接调 ComfyUI HTTP —— 与 LTX 等其他 GPU 任务串行,GPUGuard 管 VRAM。
 */

import express from "express";
import { z } from "zod";
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { success, error } from "@/lib/responseFormat";
import { SHOT_ANALYSIS_CONFIG } from "./_shared/config";

const router = express.Router();

// gold-team v6 task API base URL (matches /api/v1/tasks router prefix).
// Falls back to the docker-compose service name.
const GOLD_TEAM_URL = process.env.GOLD_TEAM_URL || "http://gold-team:8002";
const GOLD_TEAM_TASKS = `${GOLD_TEAM_URL}/api/v1/tasks`;

// Per-shot polling budget. Single-shot semantic analysis on RTX 3090 typically
// runs <120s; we allow generous headroom for queueing behind other GPU tasks.
const POLL_INTERVAL_MS = 2000;
const PER_SHOT_DEADLINE_MS = Number(process.env.SHOT_ANALYSIS_PER_SHOT_TIMEOUT_MS || 900_000);

const bodySchema = z.object({
  video: z.string().min(1),
  shots: z.string().min(1), // host-visible path to shots.json
  shot_id_range: z.tuple([z.number().int(), z.number().int()]).optional(),
  // Defaults preserve legacy caller behavior (driver path defaulted semantic=false).
  semantic: z.boolean().default(false),
  subject: z.boolean().default(false),
  grid_n: z.number().int().min(1).max(200).default(20),
  fps: z.number().min(1).max(120).default(24),
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

router.post("/", async (req: any, res: any) => {
  let params: z.infer<typeof bodySchema>;
  try {
    params = bodySchema.parse(req.body);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json(error("VALIDATION_ERROR", (err as any).errors));
    }
    return res.status(500).json(error("SHOT_ANALYSIS_FAILED", (err as Error).message));
  }

  // --- 1. Read shots.json + filter by range ---
  let shotList: any[];
  try {
    const raw = fs.readFileSync(params.shots, "utf8");
    shotList = JSON.parse(raw);
    if (!Array.isArray(shotList)) {
      throw new Error("shots.json must be a JSON array of shot objects");
    }
  } catch (readErr) {
    return res.status(400).json(
      error("SHOT_ANALYSIS_SHOTS_UNREADABLE", {
        shots: params.shots,
        message: (readErr as Error).message,
      }),
    );
  }

  const lo = params.shot_id_range ? params.shot_id_range[0] : null;
  const hi = params.shot_id_range ? params.shot_id_range[1] : null;
  if (lo !== null && hi !== null) {
    shotList = shotList.filter(
      (s: any) => s && typeof s.id === "number" && s.id >= (lo as number) && s.id <= (hi as number),
    );
  }
  shotList.sort((a: any, b: any) => a.id - b.id);

  if (shotList.length === 0) {
    return res.json(success({ shots: [], count: 0, errors: [] }, "No shots to analyze"));
  }

  // --- 2. Stage host video into container-visible path if needed ---
  // Already inside a mounted volume (/root/ComfyUI/... or /mnt/agents/...) → pass through;
  // otherwise docker cp into the ComfyUI container's input dir.
  let containerVideo = params.video;
  if (
    !params.video.startsWith("/root/ComfyUI/") &&
    !params.video.startsWith("/mnt/agents/")
  ) {
    containerVideo = path.posix.join(
      SHOT_ANALYSIS_CONFIG.containerInputDir,
      path.basename(params.video),
    );
    try {
      execFileSync(
        "docker",
        ["cp", params.video, `${SHOT_ANALYSIS_CONFIG.containerName}:${containerVideo}`],
        { timeout: 30_000 },
      );
    } catch (cpErr) {
      return res.status(500).json(
        error("SHOT_ANALYSIS_STAGING_FAILED", {
          video: params.video,
          containerVideo,
          stderrTail: String((cpErr as any).stderr || "").slice(-2000),
        }),
      );
    }
  }

  // --- 3. Fan out: one gold-team SHOT_ANALYSIS task per shot ---
  const shots: any[] = [];
  const errors: Array<{ shot_id: number; error: string }> = [];

  for (const shot of shotList) {
    const localShotId = Number(shot.id);
    const taskId = `shot-analysis-${localShotId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    let goldTaskId: string | null = null;
    try {
      const resp = await fetch(GOLD_TEAM_TASKS, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task_id: taskId,
          type: "shot_analysis",
          params: {
            video: containerVideo,
            shot_id: localShotId,
            start_sec: shot.start_sec,
            end_sec: shot.end_sec,
            semantic: params.semantic,
            subject: params.subject,
            grid_n: params.grid_n,
            fps: params.fps,
            save_dir: SHOT_ANALYSIS_CONFIG.shotAnalysisDir,
          },
        }),
      });
      if (!resp.ok) {
        const errBody = await resp.text().catch(() => "");
        errors.push({
          shot_id: localShotId,
          error: `gold-team POST /api/v1/tasks failed ${resp.status}: ${errBody.slice(0, 500)}`,
        });
        continue;
      }
      const taskData = await resp.json().catch(() => ({}));
      goldTaskId = taskData.task_id || taskData.taskId || taskId;
    } catch (postErr) {
      errors.push({
        shot_id: localShotId,
        error: `gold-team POST threw: ${(postErr as Error).message}`,
      });
      continue;
    }

    // Poll until completed/failed/timeout
    const deadline = Date.now() + PER_SHOT_DEADLINE_MS;
    let resolved = false;
    while (Date.now() < deadline) {
      let pollData: any;
      try {
        const pollResp = await fetch(`${GOLD_TEAM_TASKS}/${encodeURIComponent(goldTaskId as string)}`);
        if (!pollResp.ok) {
          // Transient — keep polling
          await sleep(POLL_INTERVAL_MS);
          continue;
        }
        pollData = await pollResp.json().catch(() => ({}));
      } catch (pollErr) {
        await sleep(POLL_INTERVAL_MS);
        continue;
      }

      const status = String(pollData.status ?? "running");
      if (status === "completed") {
        resolved = true;
        // gold-team returns outputs.analysis = path to shot JSON sidecar
        // (container-visible). Try to read its content from the host-visible
        // equivalent (SHOT_ANALYSIS_CONFIG.shotAnalysisDir is host-mounted).
        const outputs = pollData.outputs || {};
        const analysisPath: string = outputs.analysis || "";
        const shotJsonPath =
          analysisPath ||
          path.join(SHOT_ANALYSIS_CONFIG.shotAnalysisDir, `shot_${String(localShotId).padStart(3, "0")}.json`);

        let shotJson: any = null;
        try {
          shotJson = JSON.parse(fs.readFileSync(shotJsonPath, "utf8"));
          shots.push(shotJson);
        } catch (readErr) {
          // Path not host-visible or file missing — return what we have.
          shots.push({
            shot_id: `shot_${String(localShotId).padStart(3, "0")}`,
            task_id: goldTaskId,
            analysis_path: shotJsonPath,
            outputs,
            read_error: (readErr as Error).message,
          });
        }
        break;
      }
      if (status === "failed" || status === "cancelled") {
        resolved = true;
        errors.push({
          shot_id: localShotId,
          error: `gold-team task ${goldTaskId} ${status}: ${String(pollData.error ?? "").slice(0, 500)}`,
        });
        break;
      }
      await sleep(POLL_INTERVAL_MS);
    }

    if (!resolved) {
      errors.push({
        shot_id: localShotId,
        error: `gold-team task ${goldTaskId} poll timeout after ${PER_SHOT_DEADLINE_MS}ms`,
      });
    }
  }

  shots.sort((a: any, b: any) => {
    const ai = typeof a.shot_id === "string" ? parseInt(a.shot_id.replace(/\D/g, ""), 10) : a.shot_id;
    const bi = typeof b.shot_id === "string" ? parseInt(b.shot_id.replace(/\D/g, ""), 10) : b.shot_id;
    return (ai || 0) - (bi || 0);
  });

  return res.json(
    success(
      {
        shots,
        count: shots.length,
        errors,
        error_count: errors.length,
        containerVideo,
        goldTeamUrl: GOLD_TEAM_URL,
      },
      errors.length > 0
        ? `Shot analysis complete with ${errors.length} failure(s)`
        : "Shot analysis complete",
    ),
  );
});

export default router;
