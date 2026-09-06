/**
 * Breeze TTS 2 — 零参考音色设计 API (2026-09-03 盲测定谳后接替
 * VoiceDesign(:5111) + IndexTTS 2.5 两步链)
 *
 * POST /api/production/breezeTts/voice-design/voice-design
 *
 *   JSON: { character_name, instruct, text, lang?, language?, ref_text?,
 *           cfg_scale?, seed?, emotion_mode? }
 *
 *   → JSON 代理 {BREEZE_TTS_SERVER_URL}/generate {text, instruct, cfg_scale, seed}
 *     一步完成音色设计+合成 (旧链 Step1 设计参考 + Step2 克隆合成已合并),
 *     audio/wav 落盘 /oss/tts → envelope 保持与旧端点同形:
 *     {code, data:{synthesis:{audio_url, ...}, ...}}
 *
 * 兼容说明: emotion_mode/emotion_text/emotion_vector 校验保留, 但 Breeze 零参考
 * 设计无独立情感通道 — 情绪诉求写进 instruct (自然语言指令, 盲测胜出用法);
 * ref_text 仅 envelope 回显 (单步设计不再有独立参考合成步)。
 * cfg_scale 平台默认 4.0 (盲测胜出配方)。
 *
 * ⚠️ Breeze TTS 2 权重许可证: 非商用 (自托管输出限研究/非商用), Kai 已知情拍板。
 */

import express from "express";
import { success, error } from "@/lib/responseFormat";
import { withGpuQueueTimed, VramInsufficientError } from "@/lib/gpuVramManager";
import { BREEZE_TTS_CONFIG, BREEZE_TTS_DEFAULTS, BREEZE_ENGINE_ID, BREEZE_TTS_RESIDENT_INCREMENT_MIB } from "./config";
import { callBreezeGenerate, persistWav, probeBreezeResident } from "./_client";
import type { Request, Response } from "express";

const router = express.Router();

// ─── Types (与旧 indextts2 voice-design 请求体同形) ──────────────────────────

interface EmotionVector {
  happy?: number; sad?: number; angry?: number; surprised?: number;
  fearful?: number; disgusted?: number; excited?: number; neutral?: number;
}

export interface VoiceDesignBody {
  /** 角色名称(用于命名/voice_id) */
  character_name: string;
  /** 角色声音描述(Breeze instruct) */
  instruct: string;
  /** 要合成的文本 */
  text: string;
  /** 兼容回显: ZH|EN|JA|ES|AR (Breeze 原生双语, 不消费) */
  lang?: string;
  /** 兼容校验保留: none|vector|text */
  emotion_mode?: "none" | "vector" | "text";
  /** 兼容收下 (Breeze 无独立情感通道, 忽略) */
  emotion_vector?: EmotionVector;
  /** 兼容收下 (情绪诉求建议写进 instruct) */
  emotion_text?: string;
  /** 兼容收下不生效 (Breeze 无 duration_factor) */
  duration_factor?: number;
  /** 兼容回显 (单步设计无独立参考合成步) */
  ref_text?: string;
  /** VoiceDesign 语言:Chinese|English|Japanese|Auto (ref_text 回显选择用) */
  language?: string;
  /** Breeze 采样种子 */
  seed?: number;
  /** Breeze cfg_scale (平台默认 4.0, 盲测胜出配方) */
  cfg_scale?: number;
}

/**
 * voice-design 共享实现 — breezeTts 新端点与旧 indextts2 兼容层 (统一转调) 都走
 * 这里。校验错误文案与旧端点保持一致。
 */
export async function voiceDesignBreezeCore(rawBody: VoiceDesignBody, res: Response): Promise<Response> {
  const body = rawBody || ({} as VoiceDesignBody);

  // ── 校验 (与旧 indextts2 voice-design 同文) ──
  if (!body.character_name) {
    return res.status(400).json(error("Missing required field: character_name"));
  }
  if (!body.instruct) {
    return res.status(400).json(error("Missing required field: instruct (voice description)"));
  }
  if (!body.text) {
    return res.status(400).json(error("Missing required field: text"));
  }

  const emotionMode = body.emotion_mode || "none";
  if (!["none", "vector", "text"].includes(emotionMode)) {
    return res.status(400).json(error(`Invalid emotion_mode: ${emotionMode} (none|vector|text)`));
  }
  if (emotionMode === "vector" && !body.emotion_vector) {
    return res.status(400).json(error("emotion_mode=vector requires emotion_vector object"));
  }
  if (emotionMode === "text" && !body.emotion_text) {
    return res.status(400).json(error("emotion_mode=text requires emotion_text field"));
  }

  const language = body.language || "Auto";
  const refText = body.ref_text || BREEZE_TTS_DEFAULTS.refTexts[language] || BREEZE_TTS_DEFAULTS.refTexts.Chinese;
  const lang = body.lang || BREEZE_TTS_DEFAULTS.lang;
  const cfgScale = Number.isFinite(body.cfg_scale as number)
    ? (body.cfg_scale as number)
    : BREEZE_TTS_DEFAULTS.cfgScale;
  const seed = Number.isFinite(body.seed as number)
    ? (body.seed as number)
    : BREEZE_TTS_DEFAULTS.seed;

  // 生成 voice_id (与旧端点同法)
  const safeName = body.character_name.replace(/[^a-zA-Z0-9一-鿿]/g, "_").toLowerCase();
  const voiceId = `${safeName}_${Date.now()}`;

  // ── GPU 全局串行锁: 单步 Breeze /generate (与 ComfyUI/H3/music3 互斥) ──
  let out: {
    filename: string; absPath: string; synthTime: number;
    refDuration: number; queueWaitMs: number;
  };
  try {
    // R5 常驻感知预检 (2026-09-06): 权重已驻留 → 只按合成增量预检 (music3 先例);
    // 未加载/加载中/服务不可达 → 不传覆盖, 走满档 8192 (首请求加载峰值就是全量)
    const resident = await probeBreezeResident();
    const result = await withGpuQueueTimed(
      "breeze_tts",
      async (queueWaitMs) => {
        const synth = await callBreezeGenerate({
          text: body.text,
          instruct: body.instruct,
          cfgScale,
          seed,
        });
        // 落盘 (设计产物即该角色音色身份证, KMC 下载后持久化为 ref 复用)
        const persisted = await persistWav(synth.audioBuffer, "breeze_vdesign");
        return {
          ...persisted,
          synthTime: synth.synthTime,
          refDuration: synth.duration,
          queueWaitMs,
        };
      },
      {
        comfyuiUrl: BREEZE_TTS_CONFIG.comfyuiUrl,
        ...(resident.modelLoaded ? { requireVramMiB: BREEZE_TTS_RESIDENT_INCREMENT_MIB } : {}),
      },
    );
    out = result.data;
  } catch (err: any) {
    if (err instanceof VramInsufficientError) {
      return res.status(503).json(error(err.message, {
        kind: "vram_insufficient",
        freeMiB: err.freeMiB,
        requiredMiB: err.requiredMiB,
        gpuIndex: err.gpuIndex,
      }));
    }
    const status = err?.statusCode;
    if (status && status >= 400 && status < 500) {
      return res.status(502).json(error(err.message));
    }
    return res.status(502).json(error(`voice-design error: ${err.message}`));
  }

  // ── 响应 envelope (与旧端点同形, engine 标注真实引擎) ──
  return res.json(success({
    voice_id: voiceId,
    character_name: body.character_name,
    instruct: body.instruct,
    engine: BREEZE_ENGINE_ID,
    ref_audio_filename: out.filename,
    ref_text: refText,
    ref_duration_s: out.refDuration,
    queue_wait_ms: out.queueWaitMs,
    synthesis: {
      text: body.text,
      lang,
      synthesis_time_s: out.synthTime,
      audio_filename: out.filename,
      audio_path: out.absPath,
      audio_url: `/oss/tts/${out.filename}`,
    },
  }));
}

/**
 * POST /voice-design   (挂载点 /api/production/breezeTts/voice-design +
 * 路由名叠加 — 真实路径 .../voice-design/voice-design, 与旧 indextts2 形状一致)
 */
router.post("/voice-design", async (req: Request, res: Response) => {
  return voiceDesignBreezeCore(req.body as VoiceDesignBody, res);
});

export default router;
