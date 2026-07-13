/**
 * GET /api/v1/tts/status
 *
 * Qwen3-TTS 引擎健康检查 + 能力查询
 */
import express, { Router } from "express";
import { success } from "@/lib/responseFormat";
import { TTS_CONFIG, PRESET_SPEAKERS } from "./config";

const router = express.Router();

router.get("/", async (_req, res) => {
  let comfyuiStatus: Record<string, unknown> = { status: "offline" };
  let pluginLoaded = false;

  try {
    const resp = await fetch(`${TTS_CONFIG.comfyuiUrl}/system_stats`, {
      signal: AbortSignal.timeout(5000),
    });

    if (resp.ok) {
      const data = await resp.json();
      comfyuiStatus = { status: "online", system: data };
    } else {
      comfyuiStatus = { status: "error", http: resp.status };
    }
  } catch {
    comfyuiStatus = { status: "offline" };
  }

  // 检查 Qwen3-TTS 节点是否已注册
  try {
    const resp = await fetch(`${TTS_CONFIG.comfyuiUrl}/object_info`, {
      signal: AbortSignal.timeout(5000),
    });

    if (resp.ok) {
      const data = (await resp.json()) as Record<string, unknown>;
      pluginLoaded =
        "AILab_Qwen3TTSVoiceClone" in data ||
        "AILab_Qwen3TTSVoiceDesign" in data ||
        "AILab_Qwen3TTSCustomVoice" in data;
    }
  } catch {
    // ignore
  }

  res.json(success({
    engine: {
      name: TTS_CONFIG.engine.name,
      model_choice: TTS_CONFIG.engine.model_choice,
      plugin_loaded: pluginLoaded,
      comfyui: comfyuiStatus,
      capabilities: {
        modes: TTS_CONFIG.engine.modes,
        languages: TTS_CONFIG.engine.languages,
        preset_speakers: PRESET_SPEAKERS,
        attention_modes: ["auto", "sage_attn", "flash_attn", "sdpa", "eager"],
      },
      config: {
        comfyui_url: TTS_CONFIG.comfyuiUrl,
        output_dir: TTS_CONFIG.outputDir,
        poll_timeout: `${TTS_CONFIG.pollTimeoutMs / 1000}s`,
      },
    },
    deprecated: {
      CosyVoice: "retired 2026-07-12 → replaced by Qwen3-TTS VoiceClone",
      Chatterbox: "retired 2026-07-12 → replaced by Qwen3-TTS CustomVoice",
      "GPT-SoVITS": "retired 2026-07-12 → replaced by Qwen3-TTS VoiceClone",
      IndexTTS2: "deprecated DUB-04 → replaced by Qwen3-TTS VoiceClone",
    },
  }));
});

export default router;
