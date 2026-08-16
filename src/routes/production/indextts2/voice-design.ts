/**
 * IndexTTS 2.5 × Qwen3-TTS VoiceDesign — 链式音色设计 API
 *
 * POST /api/production/indextts2/voice-design/voice-design
 *
 * 用户输入角色描述（instruct）→
 *   Step 1: Qwen3-TTS VoiceDesign 生成参考音频（"声音身份证"）
 *   Step 2: IndexTTS 2.5 用该参考音频克隆音色 + 合成语音
 *
 * 链路 (2026-08-16 Kai 决策, AILab ComfyUI 插件已损坏 → 全直连):
 *   Step 1: POST {voiceDesignUrl}/generate {text, instruct, language}
 *           → {success, audio_base64(24kHz wav), duration, sr} → Buffer
 *   Step 2: multipart POST {v25ServerUrl}/api/production/indextts2/{speak}
 *           → audio/wav 二进制 → 落盘 v25OutputDir
 *
 * 整链 (Step1+Step2) 包 withGpuQueueTimed("indextts2") — 与 TTS/H3/music3
 * 等共享 GPU1 全局互斥锁 (显存互斥期 = 排队 + 两步全程), 排队等待不计入
 * 下游超时预算 (queueWaitMs 回传)。
 */

import express from "express";
import { promises as fs } from "fs";
import path from "path";
import { success, error } from "@/lib/responseFormat";
import { withGpuQueueTimed, VramInsufficientError } from "@/lib/gpuVramManager";
import { INDEXTTS2_CONFIG, INDEXTTS2_DEFAULTS } from "./config";
import type { Request, Response } from "express";

const router = express.Router();

// ─── Types ──────────────────────────────────────────────────────────────────

interface EmotionVector {
  happy?: number; sad?: number; angry?: number; surprised?: number;
  fearful?: number; disgusted?: number; excited?: number; neutral?: number;
}

interface VoiceDesignBody {
  /** 角色名称(用于命名/voice_id) */
  character_name: string;
  /** 角色声音描述(VoiceDesign instruct) */
  instruct: string;
  /** 要合成的文本 */
  text: string;
  /** IndexTTS 2.5 语言:ZH|EN|JA|ES|AR */
  lang?: string;
  /** 情感模式:none|vector|text (vector/text 透传 emo 字段给下游) */
  emotion_mode?: "none" | "vector" | "text";
  /** 情感向量(emotion_mode=vector 必填) */
  emotion_vector?: EmotionVector;
  /** 情感描述文本(emotion_mode=text 必填) */
  emotion_text?: string;
  /** 语速因子 0.5-2.0,默认 1.0 */
  duration_factor?: number;
  /** VoiceDesign 参考文本,默认按 language 自动选择 */
  ref_text?: string;
  /** VoiceDesign 语言:Chinese|English|Japanese|Auto */
  language?: string;
  /** VoiceDesign 种子(可选,透传 /generate; 服务端当前忽略,预留) */
  seed?: number;
}

// ─── 默认参考文本(VoiceDesign 用,保证音素覆盖) ─────────────────────────────

const DEFAULT_REF_TEXTS: Record<string, string> = {
  Chinese: "你好，我是这个角色的声音参考。今天天气不错，我们一起出去走走吧。",
  English: "Hello, this is a voice reference for this character. The weather is nice today, let's go for a walk.",
  Japanese: "こんにちは、このキャラクターの声の参考です。今日はいい天気ですね、一緒に散歩しませんか。",
};

// ─── 8 维情感向量字段名(IndexTTS 2.5 emotion_vector 端点契约) ────────────────

const EMOTION_KEYS = [
  "happy", "sad", "angry", "surprised",
  "fearful", "disgusted", "excited", "neutral",
] as const;

// ─── Step 1 helper — VoiceDesign /generate 直连 ─────────────────────────────

interface VoiceDesignResult {
  refBuffer: Buffer;
  refFilename: string;
  duration: number;
  sr: number;
}

async function callVoiceDesign(params: {
  refText: string;
  instruct: string;
  language: string;
  seed?: number;
  safeName: string;
}): Promise<VoiceDesignResult> {
  const vdBody: Record<string, unknown> = {
    text: params.refText,
    instruct: params.instruct,
    language: params.language,
  };
  if (params.seed !== undefined) vdBody.seed = params.seed;

  const resp = await fetch(`${INDEXTTS2_CONFIG.voiceDesignUrl}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(vdBody),
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw Object.assign(new Error(`VoiceDesign HTTP ${resp.status}: ${txt.slice(0, 500)}`), {
      statusCode: resp.status,
    });
  }
  const data = (await resp.json()) as {
    success?: boolean; audio_base64?: string; duration?: number; sr?: number; error?: string;
  };
  if (!data.success || !data.audio_base64) {
    throw new Error(`VoiceDesign failed: ${data.error || "no audio_base64 in response"}`);
  }
  const refBuffer = Buffer.from(data.audio_base64, "base64");
  if (!refBuffer.length) {
    throw new Error("VoiceDesign returned empty audio_base64");
  }
  return {
    refBuffer,
    refFilename: `vdesign_${params.safeName}_${Date.now()}.wav`,
    duration: data.duration ?? 0,
    sr: data.sr ?? 24000,
  };
}

// ─── Step 2 helper — IndexTTS 2.5 /speak multipart ───────────────────────────

async function callIndexTTS25Speak(params: {
  text: string;
  lang: string;
  durationFactor: number;
  emotionMode: string;
  body: VoiceDesignBody;
  refFilename: string;
  refBuffer: Buffer;
}): Promise<{ audioBuffer: Buffer; synthTime: number }> {
  // 5110 server 契约: POST /api/production/indextts2/speak
  // multipart {text, lang, duration_factor, ref_audio(file)} → audio/wav。
  // emo_text/emo_alpha 为情感透传字段(服务端未消费时被忽略, 前向兼容)。
  const boundary = `----FormBoundary${Date.now()}${Math.random().toString(36).slice(2)}`;
  const parts: Buffer[] = [];

  const addField = (name: string, value: string) => {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  };

  addField("text", params.text);
  addField("lang", params.lang);
  addField("duration_factor", String(params.durationFactor));

  if (params.emotionMode === "text" && params.body.emotion_text) {
    addField("emo_text", params.body.emotion_text);
    addField("emo_alpha", "1.0");
  }

  parts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="ref_audio"; filename="${params.refFilename}"\r\nContent-Type: audio/wav\r\n\r\n`,
  ));
  parts.push(params.refBuffer);
  parts.push(Buffer.from("\r\n"));
  parts.push(Buffer.from(`--${boundary}--\r\n`));

  const resp = await fetch(`${INDEXTTS2_CONFIG.v25ServerUrl}/api/production/indextts2/speak`, {
    method: "POST",
    body: Buffer.concat(parts),
    headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw Object.assign(
      new Error(`IndexTTS 2.5 server error (${resp.status}): ${txt.slice(0, 500)}`),
      { statusCode: resp.status },
    );
  }
  return {
    audioBuffer: Buffer.from(await resp.arrayBuffer()),
    synthTime: parseFloat(resp.headers.get("X-Synthesis-Time") || "0"),
  };
}

// ─── Route ──────────────────────────────────────────────────────────────────

/**
 * POST /api/production/indextts2/voice-design/voice-design
 *
 * Body (JSON): 见 VoiceDesignBody
 *
 * Response:
 *   {
 *     voice_id, character_name, instruct, ref_audio_filename, ref_text,
 *     synthesis: { text, lang, synthesis_time_s, audio_filename, audio_url },
 *     queue_wait_ms
 *   }
 */
router.post("/voice-design", async (req: Request, res: Response) => {
  const body = req.body as VoiceDesignBody;

  // ── 校验 ──
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
  const refText = body.ref_text || DEFAULT_REF_TEXTS[language] || DEFAULT_REF_TEXTS.Chinese;
  const lang = body.lang || INDEXTTS2_DEFAULTS.defaultLang;
  const durationFactor = body.duration_factor ?? INDEXTTS2_DEFAULTS.durationFactor;

  // 生成 voice_id
  const safeName = body.character_name.replace(/[^a-zA-Z0-9一-鿿]/g, "_").toLowerCase();
  const voiceId = `${safeName}_${Date.now()}`;

  // ── GPU 全局串行队列: Step1(VD 生成) + Step2(2.5 合成) 全程持锁 ──
  // 两步都是 GPU 推理 (VD ~4.4GB + 2.5 ~8GB), 互斥期覆盖整链。
  // 纯 HTTP 代理类无 poll 循环 — queueWaitMs 仅回传观测, 不延长预算。
  let out: {
    refFilename: string; outFilename: string; synthTime: number;
    refDuration: number; queueWaitMs: number;
  };
  try {
    const result = await withGpuQueueTimed(
      "indextts2",
      async (queueWaitMs) => {
        // Step 1: VoiceDesign 生成参考音频 (直连 :5111, base64 解码)
        const vd = await callVoiceDesign({
          refText, instruct: body.instruct, language,
          seed: body.seed, safeName,
        });

        // Step 2: IndexTTS 2.5 合成 (multipart, audio/wav 二进制)
        const synth = await callIndexTTS25Speak({
          text: body.text, lang, durationFactor, emotionMode, body,
          refFilename: vd.refFilename, refBuffer: vd.refBuffer,
        });

        // 落盘 (锁外不落 — 保持显存互斥期与产物一致)
        const outFilename = `vdesign_synth_${Date.now()}.wav`;
        await fs.mkdir(INDEXTTS2_CONFIG.v25OutputDir, { recursive: true });
        await fs.writeFile(path.join(INDEXTTS2_CONFIG.v25OutputDir, outFilename), synth.audioBuffer);

        return {
          refFilename: vd.refFilename,
          outFilename,
          synthTime: synth.synthTime,
          refDuration: vd.duration,
          queueWaitMs,
        };
      },
      { gpuIndex: 1, comfyuiUrl: INDEXTTS2_CONFIG.comfyuiUrl },
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
    return res.status(502).json(error(`voice-design chain error: ${err.message}`));
  }

  return res.json(success({
    voice_id: voiceId,
    character_name: body.character_name,
    instruct: body.instruct,
    ref_audio_filename: out.refFilename,
    ref_text: refText,
    ref_duration_s: out.refDuration,
    queue_wait_ms: out.queueWaitMs,
    synthesis: {
      text: body.text,
      lang,
      synthesis_time_s: out.synthTime,
      audio_filename: out.outFilename,
      audio_path: path.join(INDEXTTS2_CONFIG.v25OutputDir, out.outFilename),
      audio_url: `/oss/tts/${out.outFilename}`,
    },
  }));
});

export default router;
