/**
 * GET /api/production/qwen-tts/status
 *
 * Qwen3-TTS 引擎健康检查 + 能力查询
 */
import express, { Router } from "express";
import { success } from "@/lib/responseFormat";
import { QWEN_TTS_CONFIG, PRESET_SPEAKERS, SUPPORTED_LANGUAGES } from "./config";

const router = express.Router();

router.get("/", async (_req, res) => {
  let comfyuiStatus: Record<string, unknown> = { status: "offline" };

  try {
    const resp = await fetch(`${QWEN_TTS_CONFIG.comfyuiUrl}/system_stats`, {
      signal: AbortSignal.timeout(5000),
    });

    if (resp.ok) {
      const data = await resp.json();
      comfyuiStatus = {
        status: "online",
        system: data,
      };
    } else {
      comfyuiStatus = { status: "error", http: resp.status };
    }
  } catch {
    comfyuiStatus = { status: "offline" };
  }

  // 检查 Qwen3-TTS 节点是否已注册
  let nodesAvailable = false;
  try {
    const resp = await fetch(`${QWEN_TTS_CONFIG.comfyuiUrl}/object_info`, {
      signal: AbortSignal.timeout(5000),
    });

    if (resp.ok) {
      const data = (await resp.json()) as Record<string, unknown>;
      nodesAvailable =
        "FB_Qwen3TTSVoiceClone" in data ||
        "FB_Qwen3TTSVoiceDesign" in data ||
        "FB_Qwen3TTSCustomVoice" in data;
    }
  } catch {
    // ignore
  }

  res.json(
    success({
      comfyui: comfyuiStatus,
      plugin_loaded: nodesAvailable,
      capabilities: {
        modes: ["voice_design", "voice_clone", "custom_voice"],
        models: ["0.6B", "1.7B"],
        languages: SUPPORTED_LANGUAGES,
        preset_speakers: PRESET_SPEAKERS,
        attention_modes: ["auto", "sage_attn", "flash_attn", "sdpa", "eager"],
      },
      config: {
        comfyui_url: QWEN_TTS_CONFIG.comfyuiUrl,
        output_dir: QWEN_TTS_CONFIG.outputDir,
        poll_timeout: `${QWEN_TTS_CONFIG.pollTimeoutMs / 1000}s`,
      },
    }),
  );
});

export default router;
