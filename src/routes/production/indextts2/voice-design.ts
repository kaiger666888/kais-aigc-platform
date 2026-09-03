/**
 * IndexTTS 2.5 × Qwen3-TTS VoiceDesign 兼容层 — 链式音色设计 API
 * (URL/请求/响应包络保持, 引擎已切 Breeze TTS 2 零参考设计)
 *
 * POST /api/production/indextts2/voice-design/voice-design
 *
 * ⚠️ 2026-09-04 引擎替换 (feat/tts-breeze): 2026-09-03 盲测定谳 Breeze2 零参考
 * VoiceDesign 几乎全胜 KAP VoiceDesign(:5111)+IndexTTS2.5 两步链, 旧
 * Step1(:5111 /generate 设计参考) + Step2(:5110 克隆合成) 链退役, 整体转调
 * breezeTts voice-design 实现 (单步 JSON 代理 breeze-tts.service :5130 /generate,
 * cfg_scale=4.0 盲测胜出配方)。端点 URL、请求字段校验、响应包络
 * {code, data:{synthesis:{audio_url, ...}, ...}} 100% 保持; emotion_* 与
 * ref_text 兼容收下 (Breeze 单步设计无独立情感通道/参考合成步, 情绪诉求写进 instruct)。
 *
 * ⚠️ Breeze TTS 2 权重许可证: 非商用 (自托管输出限研究/非商用), Kai 已知情拍板。
 */

import express from "express";
import {
  voiceDesignBreezeCore,
  type VoiceDesignBody,
} from "../breezeTts/voice-design";
import type { Request, Response } from "express";

const router = express.Router();

/**
 * POST /voice-design   (挂载点 /api/production/indextts2/voice-design +
 * 路由名叠加 — 真实路径 .../voice-design/voice-design, KMC IndexTTS25Engine
 * 调用形态)
 */
router.post("/voice-design", async (req: Request, res: Response) => {
  return voiceDesignBreezeCore(req.body as VoiceDesignBody, res);
});

export default router;
