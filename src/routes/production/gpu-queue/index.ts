/**
 * GET /api/production/gpu-queue — GPU 全局串行队列状态 (可观测性)
 *
 * 返回:
 *   holders          — 每张 GPU 当前持锁引擎 (null = 空闲) + 持锁时长
 *   waitingByEngine  — 各引擎当前排队数
 *   engineOrder      — 锁获取顺序约定 (ENGINE_VRAM_REQUIREMENTS 键排序, 防死锁)
 *   recentEvents     — 最近 20 条队列事件 (enqueue/acquire/release/vram_retry/timeout/...)
 *
 * 详见 src/lib/gpuVramManager.ts (withGpuQueue, 2026-08-16 二期)。
 */

import express from "express";
import { success } from "@/lib/responseFormat";
import { getGpuQueueStatus, getGpuStatus, ENGINE_VRAM_REQUIREMENTS } from "@/lib/gpuVramManager";

const router = express.Router();

router.get("/", async (_req, res) => {
  const queue = getGpuQueueStatus();
  const gpus = await getGpuStatus(); // 5s 缓存, 顺带带出各卡 free/used
  return res.status(200).send(success({
    ...queue,
    vramRequirements: ENGINE_VRAM_REQUIREMENTS,
    gpus: gpus.map(({ index, name, totalMiB, usedMiB, freeMiB }) => ({
      index, name, totalMiB, usedMiB, freeMiB,
    })),
  }));
});

export default router;
