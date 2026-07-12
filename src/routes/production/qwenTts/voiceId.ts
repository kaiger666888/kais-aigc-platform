/**
 * POST /api/production/qwen-tts/voice-id
 *
 * 角色声音身份证生成 — 在 P04 角色设计阶段调用
 *
 * 输入角色描述（instruct），通过 VoiceDesign 生成一段参考音频，
 * 该音频 + ref_text 即为角色的"声音身份证"，
 * 后续 P10 所有该角色的台词都通过 VoiceClone 用这个身份证来克隆。
 *
 * 工作流:
 *   VoiceDesign(角色描述 → 5-10s 参考音频) → SaveAudio
 *   输出: { ref_audio_path, ref_text, instruct, voice_id }
 *
 * 全角色统一 1.7B（不分主角配角）。
 */

import express from "express";
import path from "path";
import { success, error } from "@/lib/responseFormat";
import { QWEN_TTS_CONFIG, QWEN_TTS_DEFAULTS, NODE_TYPES } from "./config";
import type { Request, Response } from "express";

const router = express.Router();

// ─── Schema ─────────────────────────────────────────────────────────────────

interface VoiceIdBody {
  /** 角色名称（用于命名文件） */
  character_name: string;
  /** 角色声音描述（VoiceDesign instruct） */
  /** 例: "30岁女性，声音低沉，带着疲惫但坚定的气质，语速偏慢" */
  instruct: string;
  /** 参考文本——作为声音身份证的文本内容，建议用通用问候语 */
  /** 默认值保证足够的音素覆盖 */
  ref_text?: string;
  /** 语言 */
  language?: string;
  /** 采样参数覆盖 */
  seed?: number;
  temperature?: number;
  top_p?: number;
  top_k?: number;
}

// ─── 默认参考文本（保证音素覆盖率） ────────────────────────────────────────

const DEFAULT_REF_TEXTS: Record<string, string> = {
  Chinese: "你好，我是这个角色的声音参考。今天天气不错，我们一起出去走走吧。",
  English: "Hello, this is a voice reference for this character. The weather is nice today, let's go for a walk.",
  Japanese: "こんにちは、このキャラクターの声の参考です。今日はいい天気ですね、一緒に散歩しませんか。",
};

// ─── ComfyUI Helpers（复用 qwenTts/speak.ts 的模式） ────────────────────────

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

function extractAudioPath(outputs: Record<string, any>): {
  filename: string; subfolder: string; url: string;
} | null {
  for (const nodeId of Object.keys(outputs)) {
    const out = outputs[nodeId];
    if (out?.audio?.[0]) {
      const a = out.audio[0];
      const filename = a.filename as string;
      const subfolder = (a.subfolder || "") as string;
      const type = (a.type || "output") as string;
      const url = `${QWEN_TTS_CONFIG.comfyuiHostUrl}/view?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(subfolder)}&type=${encodeURIComponent(type)}`;
      return { filename, subfolder: `${subfolder} (${type})`, url };
    }
  }
  return null;
}

// ─── Route ──────────────────────────────────────────────────────────────────

/**
 * POST /api/production/qwen-tts/voice-id/voice-id
 *
 * Body:
 *   {
 *     character_name: "李明",
 *     instruct: "30岁男性，声音沉稳有力，带着一点沙哑，像经历了许多",
 *     ref_text: "你好，我是这个角色的声音参考。",  // 可选，默认自动选择
 *     language: "Chinese"  // 可选，默认 Auto
 *   }
 *
 * Response:
 *   {
 *     voice_id: "liming_20260712_153000",
 *     ref_audio_path: "/mnt/agents/output/gpu1/qwents_voiceid_liming_xxx.wav",
 *     ref_audio_url: "http://...",
 *     ref_text: "你好，我是这个角色的声音参考。今天天气不错...",
 *     instruct: "30岁男性...",
 *     engine: "Qwen3-TTS-12Hz-1.7B-VoiceDesign",
 *     character_name: "李明"
 *   }
 */
router.post("/voice-id", async (req: Request, res: Response) => {
  try {
    const body = req.body as VoiceIdBody;

    if (!body.character_name) {
      return res.status(400).json(error("Missing required field: character_name"));
    }
    if (!body.instruct) {
      return res.status(400).json(error("Missing required field: instruct (voice description)"));
    }

    const language = body.language || "Auto";
    const refText = body.ref_text || DEFAULT_REF_TEXTS[language] || DEFAULT_REF_TEXTS.Chinese;

    // 生成 voice_id
    const safeName = body.character_name.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, "_").toLowerCase();
    const voiceId = `${safeName}_${Date.now()}`;

    const d = QWEN_TTS_DEFAULTS;

    // 构建 VoiceDesign 工作流 — 生成参考音频
    const workflow: Record<string, unknown> = {
      "1": {
        class_type: NODE_TYPES.VOICE_DESIGN,
        inputs: {
          text: refText,
          instruct: body.instruct,
          model_choice: "1.7B",  // 统一 1.7B
          device: d.device,
          precision: d.precision,
          language: language,
          seed: body.seed ?? d.seed,
          max_new_tokens: d.maxNewTokens,
          top_p: body.top_p ?? d.topP,
          top_k: body.top_k ?? d.topK,
          temperature: body.temperature ?? d.temperature,
          repetition_penalty: d.repetitionPenalty,
          attention: d.attention,
          unload_model_after_generate: false,
        },
      },
      "2": {
        class_type: NODE_TYPES.SAVE_AUDIO,
        inputs: {
          audio: ["1", 0],
          filename_prefix: `voiceid_${safeName}`,
        },
      },
    };

    const promptId = await submitPrompt(workflow);
    const result = await pollUntilDone(promptId);

    if (result.status === "error") {
      return res.status(500).json(error(`Voice ID generation failed: ${result.error}`));
    }

    const audioInfo = extractAudioPath(result.outputs || {});
    if (!audioInfo) {
      return res.status(500).json(error("VoiceDesign completed but no audio output found"));
    }

    const localPath = path.join(QWEN_TTS_CONFIG.outputDir, audioInfo.filename);

    return res.json(success({
      voice_id: voiceId,
      character_name: body.character_name,
      ref_audio_path: localPath,
      ref_audio_url: audioInfo.url,
      ref_audio_filename: audioInfo.filename,
      ref_text: refText,
      instruct: body.instruct,
      language: language,
      engine: "Qwen3-TTS-12Hz-1.7B-VoiceDesign",
      model_choice: "1.7B",
      prompt_id: promptId,
      // 后续 P10 VoiceClone 使用说明
      usage: {
        mode: "voice_clone",
        ref_audio: audioInfo.filename,
        ref_text: refText,
        model_choice: "1.7B",
      },
    }));
  } catch (err: any) {
    return res.status(500).json(error(err.message || "Internal error"));
  }
});

export default router;
