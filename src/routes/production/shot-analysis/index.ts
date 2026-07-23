/**
 * 逐镜头运镜解构 — THIN production route
 *
 * POST /api/v1/production/shot-analysis
 *   body: { video, shots, shot_id_range?, semantic?, subject?, grid_n?, fps? }
 *
 * 这个路由只做三件事：
 *   1. zod 校验 body
 *   2. 把宿主机视频暂存进 ComfyUI 容器（docker cp，必要时）
 *   3. 同步 spawn 已 vendor 的 Python driver（scripts/shot-analysis/shot_analysis_driver.py），
 *      读回 driver 落盘的 shot_XXX.json 聚合返回
 *
 * 所有 ComfyUI workflow 构建、prompt 提交、history 轮询逻辑都在 Python driver 里。
 * TS 侧只 spawn 子进程,不直接调 ComfyUI HTTP —— 保持 THIN wrapper。
 */

import express from "express";
import { z } from "zod";
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { success, error } from "@/lib/responseFormat";
import { SHOT_ANALYSIS_CONFIG } from "./_shared/config";

const router = express.Router();

const bodySchema = z.object({
  video: z.string().min(1),
  shots: z.string().min(1),
  shot_id_range: z.tuple([z.number().int(), z.number().int()]).optional(),
  semantic: z.boolean().default(false),
  subject: z.boolean().default(false),
  grid_n: z.number().int().min(1).max(200).default(20),
  fps: z.number().min(1).max(120).default(24),
});

const SHOT_JSON_RE = /^shot_(\d{3})\.json$/;

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

  // --- 1. 确定 container 内可见的视频路径 ---
  // 已经在容器挂载卷里（/root/ComfyUI/... 或 /mnt/agents/...）→ 原样透传；
  // 否则 docker cp 暂存进容器的 input 目录。
  let containerVideo = params.video;
  if (
    !params.video.startsWith("/root/ComfyUI/") &&
    !params.video.startsWith("/mnt/agents/")
  ) {
    containerVideo = path.posix.join(
      SHOT_ANALYSIS_CONFIG.containerInputDir,
      path.basename(params.video)
    );
    try {
      execFileSync(
        "docker",
        ["cp", params.video, `${SHOT_ANALYSIS_CONFIG.containerName}:${containerVideo}`],
        { timeout: 30_000 }
      );
    } catch (cpErr) {
      return res.status(500).json(
        error("SHOT_ANALYSIS_STAGING_FAILED", {
          video: params.video,
          containerVideo,
          stderrTail: String((cpErr as any).stderr || "").slice(-2000),
        })
      );
    }
  }

  // --- 2. 构建 driver argv ---
  const argv = [
    SHOT_ANALYSIS_CONFIG.pythonBin,
    SHOT_ANALYSIS_CONFIG.driverPath,
    "--shots", params.shots,
    "--video", containerVideo,
    "--grid-n", String(params.grid_n),
    "--fps", String(params.fps),
  ];
  if (params.semantic) argv.push("--semantic");
  if (params.subject) argv.push("--subject");
  if (params.shot_id_range) {
    const [lo, hi] = params.shot_id_range;
    argv.push("--shot-id-range", String(lo), String(hi));
  }

  // --- 3. 同步 spawn driver ---
  let driverStdout = "";
  try {
    driverStdout = execFileSync(argv[0], argv.slice(1), {
      env: { ...process.env, COMFYUI_URL: SHOT_ANALYSIS_CONFIG.comfyuiUrl },
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      timeout: 900_000,
    });
  } catch (err) {
    // driver 非零退出 —— 返回 stderr 尾部便于排查
    return res.status(500).json(
      error("SHOT_ANALYSIS_DRIVER_FAILED", {
        stderrTail: String((err as any).stderr || "").slice(-2000),
        stdout: String((err as any).stdout || "").slice(-2000),
      })
    );
  }

  // --- 4. 聚合 driver 落盘的 shot_XXX.json ---
  // 单文件读取失败只 skip + 记 stderr，不让整个请求挂掉（部分结果也有价值）。
  const outDir = SHOT_ANALYSIS_CONFIG.shotAnalysisDir;
  let files: string[] = [];
  try {
    files = fs.readdirSync(outDir);
  } catch (readErr) {
    return res.status(500).json(
      error("SHOT_ANALYSIS_OUTPUT_UNREADABLE", {
        outputDir: outDir,
        message: (readErr as Error).message,
        driverStdout: driverStdout.slice(-2000),
      })
    );
  }

  const lo = params.shot_id_range ? params.shot_id_range[0] : null;
  const hi = params.shot_id_range ? params.shot_id_range[1] : null;

  const shotEntries: Array<{ id: number; file: string }> = [];
  for (const f of files) {
    const m = f.match(SHOT_JSON_RE);
    if (!m) continue;
    const id = Number(m[1]);
    if (lo !== null && hi !== null && (id < lo || id > hi)) continue;
    shotEntries.push({ id, file: f });
  }
  shotEntries.sort((a, b) => a.id - b.id);

  const shots: any[] = [];
  for (const entry of shotEntries) {
    const fp = path.join(outDir, entry.file);
    try {
      const raw = fs.readFileSync(fp, "utf8");
      shots.push(JSON.parse(raw));
    } catch (fErr) {
      // 部分失败不阻断 —— 记录到 server stderr，继续聚合其余镜头
      console.error(`[shot-analysis] failed to read ${fp}: ${(fErr as Error).message}`);
    }
  }

  return res.json(
    success(
      {
        shots,
        count: shots.length,
        outputDir: outDir,
        driverStdout: driverStdout.slice(-2000),
      },
      "Shot analysis complete"
    )
  );
});

export default router;
