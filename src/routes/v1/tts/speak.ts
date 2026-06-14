/**
 * POST /api/v1/tts/speak
 *
 * Unified TTS endpoint — auto-routes to the correct track based on language/track param.
 *
 * Quick start:
 *   { text: "你好世界" }                          → CosyVoice 中文
 *   { text: "Hello world", track: "en" }          → Chatterbox 英文
 *   { text: "你好Hello混合", track: "bilingual" } → CosyVoice 双语
 *   { text: "克隆测试", track: "clone", ref_audio_path: "/audio/ref.wav", prompt_text: "参考文本" } → GPT-SoVITS 克隆
 *
 * Response:
 *   { audio_path, duration_sec, sample_rate, service, track }
 */
import express, { Router } from "express";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { TTS_CONFIG, type TtsTrack } from "./config";

const router = express.Router();

/** Language detection — CJK ratio > 30% → zh */
function detectLanguage(text: string): "zh" | "en" {
  const cjk = [...text].filter(c => c >= "\u4e00" && c <= "\u9fff").length;
  return text.length > 0 && cjk / text.length > 0.3 ? "zh" : "en";
}

const SpeakSchema = z.object({
  text: z.string().min(1).max(5000),
  track: z.enum(["auto", "zh", "en", "bilingual", "clone"]).optional().default("auto"),
  language: z.enum(["zh", "en", "auto"]).optional().default("auto"),
  speaker: z.string().optional(),
  speed: z.number().min(0.3).max(2.0).optional().default(1.0),
  // CosyVoice params
  mode: z.enum(["cross_lingual", "zero_shot", "vc", "sft"]).optional(),
  ref_audio: z.string().optional(),
  ref_text: z.string().optional(),
  instruct_text: z.string().optional(),
  // GPT-SoVITS params
  ref_audio_path: z.string().optional(),
  prompt_text: z.string().optional(),
  prompt_lang: z.enum(["zh", "en", "ja", "ko", "yue"]).optional(),
  temperature: z.number().min(0.01).max(2.0).optional(),
  top_k: z.number().int().min(1).max(100).optional(),
  top_p: z.number().min(0.1).max(1.0).optional(),
  speed_factor: z.number().min(0.3).max(2.0).optional(),
  seed: z.number().int().optional(),
  // Chatterbox params
  audio_prompt_path: z.string().optional(),
  // Output format
  output_format: z.enum(["wav", "ogg", "mp3"]).optional().default("wav"),
});

router.post("/", async (req, res) => {
  try {
    const body = SpeakSchema.parse(req.body);
    const { text, language } = body;

    // Resolve track
    let track: TtsTrack;
    if (body.track === "auto") {
      const detected = language === "auto" ? detectLanguage(text) : language;
      track = detected === "en" ? "en" : "zh";
    } else {
      track = body.track;
    }

    const baseUrl = TTS_CONFIG.tracks[track];
    if (!baseUrl) {
      return res.status(400).json(error(`Unknown track: ${track}`));
    }

    // Build payload per track
    const payload: Record<string, unknown> = { text };

    switch (track) {
      case "zh":
      case "bilingual":
        // CosyVoice 3.0
        payload.mode = body.mode || "cross_lingual";
        payload.ref_audio = body.ref_audio || body.ref_audio_path || "";
        payload.ref_text = body.ref_text || body.prompt_text || "";
        payload.instruct_text = body.instruct_text || "";
        payload.speaker = body.speaker || "";
        payload.speed = body.speed;
        break;

      case "en":
        // Chatterbox-Turbo
        payload.speaker = body.speaker || TTS_CONFIG.defaultSpeaker.en;
        payload.speed = body.speed;
        payload.temperature = body.temperature || 0.8;
        payload.top_p = body.top_p || 0.95;
        payload.top_k = body.top_k || 1000;
        payload.seed = body.seed || 0;
        if (body.audio_prompt_path) payload.audio_prompt_path = body.audio_prompt_path;
        break;

      case "clone":
        // GPT-SoVITS
        payload.text_lang = body.prompt_lang || (language === "en" ? "en" : "zh");
        payload.ref_audio_path = body.ref_audio_path || body.ref_audio || "";
        payload.prompt_text = body.prompt_text || body.ref_text || "";
        payload.prompt_lang = body.prompt_lang || "zh";
        payload.speed_factor = body.speed_factor || body.speed;
        payload.temperature = body.temperature || 1.0;
        payload.top_k = body.top_k || 15;
        payload.top_p = body.top_p || 1.0;
        payload.seed = body.seed || 42;
        break;
    }

    // Call TTS service
    const timeoutMs = TTS_CONFIG.timeoutMs[track] || 60_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const resp = await fetch(`${baseUrl}/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!resp.ok) {
        const errText = await resp.text().catch(() => "Unknown error");
        return res.status(resp.status).json(error(`TTS service error (${track}): ${errText.slice(0, 300)}`));
      }

      const contentType = resp.headers.get("content-type") || "";
      let result: Record<string, unknown>;

      if (contentType.includes("application/json")) {
        result = await resp.json();
      } else {
        // Raw audio bytes (GPT-SoVITS native direct mode)
        const buffer = Buffer.from(await resp.arrayBuffer());
        const fs = await import("fs");
        const tempPath = `/tmp/tts_output_${Date.now()}.wav`;
        fs.writeFileSync(tempPath, buffer);
        result = { audio_path: tempPath, duration_sec: 0, service: "gpt-sovits-raw" };
      }

      result.track = track;
      result.service = TTS_CONFIG.trackMeta[track]?.name || track;

      return res.json(success(result));
    } catch (fetchErr: any) {
      clearTimeout(timer);
      if (fetchErr.name === "AbortError") {
        return res.status(504).json(error(`TTS timeout (${track}, ${timeoutMs}ms)`));
      }
      return res.status(502).json(error(`TTS service unreachable (${track}): ${fetchErr.message}`));
    }
  } catch (err: any) {
    return res.status(400).json(error(err.message || "Invalid request"));
  }
});

export default router;
