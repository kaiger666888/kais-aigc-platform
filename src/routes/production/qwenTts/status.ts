/**
 * GET /api/production/qwen-tts/status
 *
 * Qwen3-TTS 引擎健康检查 + 能力查询
 *
 * GET /api/production/qwen-tts/status/:promptId
 *
 * 按 promptId 直读 ComfyUI history — 两段式异步轮询端点 (2026-08-16)。
 * 配合 POST /speak {"async":true} (202): 客户端提交后轮询本端点,
 * 单请求超时不再约束「GPU 排队 + 作业」总时长 (P10 双重超时根因)。
 */
import express, { Router } from "express";
import path from "path";
import { success, error } from "@/lib/responseFormat";
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
        "AILab_Qwen3TTSVoiceClone" in data ||
        "AILab_Qwen3TTSVoiceDesign" in data ||
        "AILab_Qwen3TTSCustomVoice" in data;
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

// ─── GET /status/:promptId — ComfyUI history 直读 (两段式异步轮询) ──────────

router.get("/:promptId", async (req, res) => {
  const promptId = req.params.promptId;
  try {
    const resp = await fetch(`${QWEN_TTS_CONFIG.comfyuiUrl}/history/${promptId}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) {
      return res.status(502).json(error(`ComfyUI history responded ${resp.status}`));
    }
    const history = (await resp.json()) as Record<string, any>;
    const entry = history[promptId];

    if (!entry) {
      return res.json(success({ prompt_id: promptId, status: "pending" }));
    }

    const statusStr = entry.status?.status_str;
    if (statusStr === "success") {
      let audio: { filename: string; subfolder: string; url: string } | null = null;
      for (const nodeId of Object.keys(entry.outputs || {})) {
        const nodeOutput = entry.outputs[nodeId];
        if (nodeOutput?.audio?.[0]) {
          const a = nodeOutput.audio[0];
          const filename = a.filename as string;
          const subfolder = (a.subfolder || "") as string;
          const type = (a.type || "output") as string;
          const url = `${QWEN_TTS_CONFIG.comfyuiHostUrl}/view?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(subfolder)}&type=${encodeURIComponent(type)}`;
          audio = { filename, subfolder: `${subfolder} (${type})`, url };
          break;
        }
      }
      if (!audio) {
        return res.json(success({
          prompt_id: promptId,
          status: "error",
          error: "workflow succeeded but no audio output node found",
        }));
      }
      return res.json(success({
        prompt_id: promptId,
        status: "success",
        audio_filename: audio.filename,
        audio_path: path.join(QWEN_TTS_CONFIG.outputDir, audio.filename),
        audio_url: audio.url,
      }));
    }

    if (statusStr === "error") {
      const errMsg = JSON.stringify(
        entry.status?.messages || entry.status || "Unknown error",
      ).slice(0, 500);
      return res.json(success({ prompt_id: promptId, status: "error", error: errMsg }));
    }

    return res.json(success({ prompt_id: promptId, status: "running" }));
  } catch (err: any) {
    return res.status(502).json(error(`ComfyUI unreachable: ${err?.message || err}`));
  }
});

export default router;
