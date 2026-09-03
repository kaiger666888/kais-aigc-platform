/**
 * Breeze TTS 2 — 服务状态 API
 *
 * GET /api/production/breezeTts/status          (挂载根直达)
 * GET /api/production/breezeTts/status/status   (双挂载 — 与旧 indextts2 形状一致)
 *
 * 探测 breeze-tts.service (:5130/health)。探针失败不抛 — 200 + healthy:false
 * 降级态 (与旧 indextts2/status 查询语义一致, 供看板/巡检轮询)。
 */

import express from "express";
import { success } from "@/lib/responseFormat";
import { BREEZE_TTS_CONFIG, BREEZE_ENGINE_ID } from "./config";
import { probeBreezeHealth } from "./_client";
import type { Request, Response } from "express";

const router = express.Router();

async function statusHandler(_req: Request, res: Response): Promise<Response> {
  const probe = await probeBreezeHealth();
  return res.json(success({
    healthy: probe.healthy,
    server_running: probe.healthy,
    model_loaded: probe.modelLoaded ?? false,
    engine: probe.engine || BREEZE_ENGINE_ID,
    server_url: BREEZE_TTS_CONFIG.serverUrl,
    health_status: probe.status ?? null,
    error: probe.error ?? null,
  }));
}

router.get("/status", statusHandler);
router.get("/", statusHandler);

export default router;
