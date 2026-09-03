/**
 * IndexTTS 2 兼容层 — 服务状态 API (URL 保持, 探测目标已切 Breeze TTS 2)
 *
 * GET  /api/production/indextts2/status          (挂载根直达)
 * GET  /api/production/indextts2/status/status   (双挂载 — 真实部署形态)
 *
 * ⚠️ 2026-09-04 引擎替换 (feat/tts-breeze): 旧 ComfyUI 容器/模型巡检
 * (docker exec + IndexTTS2ModelLoader object_info) 与 /preload (ComfyUI
 * prompt 预载) 随 legacy 路径退役, 本路由改探 breeze-tts.service :5130/health。
 * 响应包络保持 {code, data:{...}} 查询语义: 探针失败不抛, 200 + healthy:false
 * 降级态 (旧 docker/comfyui 字段不再返回 — 消费方仅看板巡检, 无字段级依赖)。
 */

import express from "express";
import { success } from "@/lib/responseFormat";
import { BREEZE_TTS_CONFIG, BREEZE_ENGINE_ID } from "../breezeTts/config";
import { probeBreezeHealth } from "../breezeTts/_client";
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
