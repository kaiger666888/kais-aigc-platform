/**
 * IndexTTS 2.5 × Qwen3-TTS VoiceDesign — 链式音色设计 API
 *
 * POST /api/production/indextts2/voice-design/voice-design
 *
 * 用户输入角色描述（instruct）→
 *   Step 1: Qwen3-TTS VoiceDesign 生成参考音频（"声音身份证"）
 *   Step 2: IndexTTS 2.5 用该参考音频克隆音色 + 合成带情感控制的语音
 *
 * 工作流:
 *   VoiceDesign(instruct → ref 音频) → 读 ref 音频为 Buffer
 *   → IndexTTS 2.5 (speak | emotion_vector | emotion_text)
 *
 * 与 qwenTts/voiceId.ts 的区别:voiceId 只生成参考音频即返回;
 * 本端点在此基础上自动链式调用 IndexTTS 2.5 完成最终语音合成(含情感控制)。
 */

import express from "express";
import { promises as fs } from "fs";
import path from "path";
import { success, error } from "@/lib/responseFormat";
import { INDEXTTS2_CONFIG, INDEXTTS2_DEFAULTS } from "./config";
import { QWEN_TTS_CONFIG, NODE_TYPES as QWEN_NODE_TYPES } from "../qwenTts/config";
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
  /** 情感模式:none|vector|text */
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

// ─── ComfyUI VoiceDesign Helpers(复用 qwenTts/voiceId.ts 模式) ──────────────

async function submitPrompt(workflow: Record<string, unknown>): Promise<string> {
  const resp = await fetch(`${QWEN_TTS_CONFIG.comfyuiUrl}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: workflow }),
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error(`ComfyUI prompt rejected (${resp.status}): ${txt.slice(0, 500)}`);
  }
  const data = (await resp.json()) as { prompt_id: string };
  return data.prompt_id;
}

async function pollUntilDone(promptId: string): Promise<{
  status: "success" | "error";
  outputs?: Record<string, any>;
  error?: string;
}> {
  const deadline = Date.now() + QWEN_TTS_CONFIG.pollTimeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, QWEN_TTS_CONFIG.pollIntervalMs));
    try {
      const resp = await fetch(`${QWEN_TTS_CONFIG.comfyuiUrl}/history/${promptId}`);
      if (!resp.ok) continue;
      const history = (await resp.json()) as Record<string, any>;
      const entry = history[promptId];
      if (!entry) continue;
      const statusStr = entry.status?.status_str;
      if (statusStr === "success") return { status: "success", outputs: entry.outputs };
      if (statusStr === "error") {
        const errMsg = JSON.stringify(entry.status?.messages || "Unknown error").slice(0, 500);
        return { status: "error", error: errMsg };
      }
    } catch { /* keep trying */ }
  }
  return { status: "error", error: `Timeout after ${QWEN_TTS_CONFIG.pollTimeoutMs / 1000}s` };
}

/** 从 ComfyUI 输出提取音频文件名 */
function extractAudioFilename(outputs: Record<string, any>): string | null {
  for (const nodeId of Object.keys(outputs)) {
    const out = outputs[nodeId];
    if (out?.audio?.[0]) {
      return (out.audio[0].filename as string) || null;
    }
  }
  return null;
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
 *     synthesis: { text, lang, synthesis_time_s, audio_filename, audio_url }
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

  // ── Step 1: VoiceDesign 生成参考音频 ──
  let refAudioFilename: string;
  try {
    // 仅发送 AILab_Qwen3TTSVoiceDesign 节点定义的输入(多余字段会被 ComfyUI 拒绝)
    const workflow: Record<string, unknown> = {
      "1": {
        class_type: QWEN_NODE_TYPES.VOICE_DESIGN,
        inputs: {
          text: refText,
          instruct: body.instruct,
          model_size: "1.7B",
          language,
          seed: 0,
          unload_models: false,
        },
      },
      "2": {
        class_type: QWEN_NODE_TYPES.SAVE_AUDIO,
        inputs: {
          audio: ["1", 0],
          filename_prefix: `vdesign_${safeName}`,
        },
      },
    };

    const promptId = await submitPrompt(workflow);
    const result = await pollUntilDone(promptId);

    if (result.status === "error") {
      return res.status(500).json(error(`VoiceDesign failed: ${result.error}`));
    }

    const fname = extractAudioFilename(result.outputs || {});
    if (!fname) {
      return res.status(500).json(error("VoiceDesign completed but no audio output found"));
    }
    refAudioFilename = fname;
  } catch (err: any) {
    return res.status(502).json(error(`VoiceDesign error: ${err.message}`));
  }

  // ── 读 VoiceDesign 参考音频为 Buffer ──
  const refAudioPath = path.join(QWEN_TTS_CONFIG.outputDir, refAudioFilename);
  let refBuffer: Buffer;
  try {
    refBuffer = await fs.readFile(refAudioPath);
  } catch (err: any) {
    return res.status(500).json(error(`Cannot read VoiceDesign output (${refAudioFilename}): ${err.message}`));
  }

  // ── Step 2: IndexTTS 2.5 合成(按 emotion_mode 路由) ──
  const synthEndpoint =
    emotionMode === "vector" ? "emotion_vector" :
    emotionMode === "text" ? "emotion_text" : "speak";
  const synthUrl = `${INDEXTTS2_CONFIG.v25ServerUrl}/api/production/indextts2/${synthEndpoint}`;

  // 手动构建 multipart/form-data(Node fetch 不支持 form-data stream)
  const boundary = `----FormBoundary${Date.now()}${Math.random().toString(36).slice(2)}`;
  const parts: Buffer[] = [];

  function addField(name: string, value: string) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }
  function addFile(name: string, filename: string, data: Buffer) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${filename}"\r\nContent-Type: audio/wav\r\n\r\n`));
    parts.push(data);
    parts.push(Buffer.from("\r\n"));
  }

  addField("text", body.text);
  addField("lang", lang);
  addField("duration_factor", String(durationFactor));

  if (emotionMode === "vector" && body.emotion_vector) {
    for (const key of EMOTION_KEYS) {
      addField(key, String(body.emotion_vector[key] ?? 0));
    }
  }
  if (emotionMode === "text" && body.emotion_text) {
    addField("emotion_text", body.emotion_text);
  }

  addFile("ref_audio", refAudioFilename, refBuffer);
  parts.push(Buffer.from(`--${boundary}--\r\n`));

  const multipartBody = Buffer.concat(parts);

  try {
    const synthResp = await fetch(synthUrl, {
      method: "POST",
      body: multipartBody,
      headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
    });

    if (!synthResp.ok) {
      const errTxt = await synthResp.text().catch(() => "");
      return res.status(502).json(error(`IndexTTS 2.5 server error (${synthResp.status}): ${errTxt.slice(0, 500)}`));
    }

    const audioBuffer = Buffer.from(await synthResp.arrayBuffer());
    const synthTime = parseFloat(synthResp.headers.get("X-Synthesis-Time") || "0");
    const outFilename = `vdesign_synth_${Date.now()}.wav`;
    await fs.mkdir(INDEXTTS2_CONFIG.v25OutputDir, { recursive: true });
    const outPath = path.join(INDEXTTS2_CONFIG.v25OutputDir, outFilename);
    await fs.writeFile(outPath, audioBuffer);

    return res.json(success({
      voice_id: voiceId,
      character_name: body.character_name,
      instruct: body.instruct,
      ref_audio_filename: refAudioFilename,
      ref_text: refText,
      synthesis: {
        text: body.text,
        lang,
        synthesis_time_s: synthTime,
        audio_filename: outFilename,
        audio_url: `/oss/tts/${outFilename}`,
      },
    }));
  } catch (err: any) {
    return res.status(502).json(error(`IndexTTS 2.5 server unreachable: ${err.message}`));
  }
});

export default router;
