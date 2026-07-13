/**
 * POST /api/v1/tts/speak
 *
 * Unified TTS endpoint — Qwen3-TTS 1.7B single engine.
 *
 * 三种模式:
 *   { mode: "voice_design", text, instruct }                         → 声音设计
 *   { mode: "voice_clone", text, ref_audio, ref_text }               → 声音克隆
 *   { mode: "custom_voice", text, speaker }                           → 预设声音
 *
 * 旧 track 参数兼容映射:
 *   track=zh|en|bilingual → mode=voice_clone (如有 ref_audio) 或 custom_voice
 *   track=clone           → mode=voice_clone
 *
 * Response: { audio_path, audio_url, mode, service }
 */
import express, { Router } from "express";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import path from "path";
import { TTS_CONFIG, PRESET_SPEAKERS, type TtsMode } from "./config";

const router = express.Router();

// ─── Schema ─────────────────────────────────────────────────────────────────

const SpeakSchema = z.object({
  // 新参数
  mode: z.enum(["voice_design", "voice_clone", "custom_voice"]).optional(),
  instruct: z.string().optional(),
  speaker: z.string().optional(),
  ref_audio: z.string().optional(),
  ref_text: z.string().optional(),

  // 旧参数兼容
  track: z.enum(["auto", "zh", "en", "bilingual", "clone"]).optional(),
  language: z.string().optional().default("Auto"),

  // 通用
  text: z.string().min(1).max(5000),
  speed: z.number().min(0.3).max(2.0).optional().default(1.0),
  model_choice: z.enum(["0.6B", "1.7B"]).optional().default("1.7B"),
  device: z.enum(["auto", "cuda", "xpu", "mps", "cpu"]).optional(),
  precision: z.enum(["bf16", "fp32"]).optional(),
  attention: z.enum(["auto", "sage_attn", "flash_attn", "sdpa", "eager"]).optional(),
  seed: z.number().int().optional(),
  max_new_tokens: z.number().int().min(512).max(4096).optional(),
  top_p: z.number().min(0.0).max(1.0).optional(),
  top_k: z.number().int().min(0).max(100).optional(),
  temperature: z.number().min(0.1).max(2.0).optional(),
  repetition_penalty: z.number().min(1.0).max(2.0).optional(),
  unload_model_after_generate: z.boolean().optional().default(false),

  // 旧 CosyVoice/GPT-SoVITS 参数兼容（忽略，不影响功能）
  ref_audio_path: z.string().optional(),
  prompt_text: z.string().optional(),
  prompt_lang: z.string().optional(),
  audio_prompt_path: z.string().optional(),
  mode_legacy: z.string().optional(),
}).transform((data) => {
  // 旧 track → 新 mode 映射
  if (!data.mode && data.track) {
    if (data.track === "clone" || data.ref_audio || data.ref_audio_path) {
      data.mode = "voice_clone";
    } else {
      data.mode = "custom_voice";
    }
  }
  if (!data.mode) {
    // 默认：有 ref_audio 就 clone，否则 custom_voice
    data.mode = (data.ref_audio || data.ref_audio_path) ? "voice_clone" : "custom_voice";
  }

  // 合并旧参数名
  if (!data.ref_audio && data.ref_audio_path) data.ref_audio = data.ref_audio_path;
  if (!data.ref_text && data.prompt_text) data.ref_text = data.prompt_text;

  return data;
});

// ─── ComfyUI Workflow Builders ──────────────────────────────────────────────

function buildVoiceDesignWorkflow(body: z.infer<typeof SpeakSchema>): Record<string, unknown> {
  return {
    "1": {
      class_type: TTS_CONFIG.NODE_TYPES.VOICE_DESIGN,
      inputs: {
        text: body.text,
        instruct: body.instruct || "A warm, gentle voice.",
        model_size: body.model_choice || "1.7B",
        language: mapLanguage(body.language),
        seed: body.seed ?? -1,
        unload_models: body.unload_model_after_generate,
      },
    },
    "2": {
      class_type: TTS_CONFIG.NODE_TYPES.SAVE_AUDIO,
      inputs: { audio: ["1", 0], filename_prefix: `tts_vd_${Date.now()}` },
    },
  };
}

function buildVoiceCloneWorkflow(body: z.infer<typeof SpeakSchema>): Record<string, unknown> {
  return {
    "1": {
      class_type: TTS_CONFIG.NODE_TYPES.LOAD_AUDIO,
      inputs: { audio: body.ref_audio!, channel: "input" },
    },
    "2": {
      class_type: TTS_CONFIG.NODE_TYPES.VOICE_CLONE,
      inputs: {
        target_text: body.text,
        model_size: body.model_choice || "1.7B",
        language: mapLanguage(body.language),
        reference_audio: ["1", 0],
        reference_text: body.ref_text || "",
        seed: body.seed ?? -1,
        unload_models: body.unload_model_after_generate,
      },
    },
    "3": {
      class_type: TTS_CONFIG.NODE_TYPES.SAVE_AUDIO,
      inputs: { audio: ["2", 0], filename_prefix: `tts_vc_${Date.now()}` },
    },
  };
}

function buildCustomVoiceWorkflow(body: z.infer<typeof SpeakSchema>): Record<string, unknown> {
  return {
    "1": {
      class_type: TTS_CONFIG.NODE_TYPES.CUSTOM_VOICE,
      inputs: {
        text: body.text,
        speaker: body.speaker || "Eric",
        model_size: body.model_choice || "1.7B",
        language: mapLanguage(body.language),
        instruct: body.instruct || "",
        seed: body.seed ?? -1,
        unload_models: body.unload_model_after_generate,
      },
    },
    "2": {
      class_type: TTS_CONFIG.NODE_TYPES.SAVE_AUDIO,
      inputs: { audio: ["1", 0], filename_prefix: `tts_cv_${Date.now()}` },
    },
  };
}

/** 语言映射：旧 zh/en → Qwen3-TTS 语言名 */
function mapLanguage(lang: string): string {
  if (lang === "zh" || lang === "chinese") return "Chinese";
  if (lang === "en" || lang === "english") return "English";
  return "Auto";
}

function buildWorkflow(body: z.infer<typeof SpeakSchema>): Record<string, unknown> {
  const mode = body.mode as TtsMode;
  switch (mode) {
    case "voice_design":
      if (!body.instruct) throw new Error("voice_design mode requires 'instruct'");
      return buildVoiceDesignWorkflow(body);
    case "voice_clone":
      if (!body.ref_audio) throw new Error("voice_clone mode requires 'ref_audio'");
      return buildVoiceCloneWorkflow(body);
    case "custom_voice":
      return buildCustomVoiceWorkflow(body);
    default:
      throw new Error(`Unknown mode: ${mode}`);
  }
}

// ─── ComfyUI Helpers ────────────────────────────────────────────────────────

async function submitPrompt(workflow: Record<string, unknown>): Promise<string> {
  const resp = await fetch(`${TTS_CONFIG.comfyuiUrl}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: workflow }),
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error(`ComfyUI prompt rejected (${resp.status}): ${txt.slice(0, 500)}`);
  }
  const data = await resp.json() as { prompt_id: string };
  return data.prompt_id;
}

async function pollUntilDone(promptId: string): Promise<{
  status: "success" | "error";
  outputs?: Record<string, any>;
  error?: string;
}> {
  const deadline = Date.now() + TTS_CONFIG.pollTimeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, TTS_CONFIG.pollIntervalMs));
    try {
      const resp = await fetch(`${TTS_CONFIG.comfyuiUrl}/history/${promptId}`);
      if (!resp.ok) continue;
      const history = await resp.json() as Record<string, any>;
      const entry = history[promptId];
      if (!entry) continue;
      const statusStr = entry.status?.status_str;
      if (statusStr === "success") return { status: "success", outputs: entry.outputs };
      if (statusStr === "error") {
        const errMsg = JSON.stringify(entry.status?.messages || entry.status || "Unknown error").slice(0, 500);
        return { status: "error", error: errMsg };
      }
    } catch { /* keep trying */ }
  }
  return { status: "error", error: `Timeout after ${TTS_CONFIG.pollTimeoutMs / 1000}s` };
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
      const url = `${TTS_CONFIG.comfyuiHostUrl}/view?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(subfolder)}&type=${encodeURIComponent(type)}`;
      return { filename, subfolder: `${subfolder} (${type})`, url };
    }
  }
  return null;
}

// ─── Route ──────────────────────────────────────────────────────────────────

router.post("/", async (req, res) => {
  try {
    const body = SpeakSchema.parse(req.body);

    // Validate mode-specific requirements
    if (body.mode === "voice_design" && !body.instruct) {
      return res.status(400).json(error("voice_design mode requires 'instruct' field"));
    }
    if (body.mode === "voice_clone" && !body.ref_audio) {
      return res.status(400).json(error("voice_clone mode requires 'ref_audio' field"));
    }

    const workflow = buildWorkflow(body);
    const promptId = await submitPrompt(workflow);
    const result = await pollUntilDone(promptId);

    if (result.status === "error") {
      return res.status(500).json(error(`TTS failed: ${result.error}`));
    }

    const audioInfo = extractAudioPath(result.outputs || {});
    if (!audioInfo) {
      return res.status(500).json(error("TTS completed but no audio output found"));
    }

    const localPath = path.join(TTS_CONFIG.outputDir, audioInfo.filename);

    return res.json(success({
      audio_path: localPath,
      audio_url: audioInfo.url,
      audio_filename: audioInfo.filename,
      mode: body.mode,
      service: TTS_CONFIG.engine.name,
      text: body.text,
      prompt_id: promptId,
    }));
  } catch (err: any) {
    if (err.issues) {
      // Zod error
      return res.status(400).json(error(err.issues.map((i: any) => i.message).join("; ")));
    }
    return res.status(500).json(error(err.message || "Invalid request"));
  }
});

export default router;
