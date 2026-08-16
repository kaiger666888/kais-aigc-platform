/**
 * GET /api/v1/tts/status
 *
 * Qwen3-TTS 引擎健康检查 + 能力查询
 *
 * GET /api/v1/tts/status/:promptId
 *
 * 按 promptId 直读 ComfyUI history — 两段式异步轮询端点 (2026-08-16)。
 * 配合 POST /speak {"async":true} (202 {prompt_id}): 客户端提交后轮询本端点,
 * 单请求超时不再约束「GPU 排队 + 作业」总时长 (P10 双重超时根因)。
 * success 时直接返回音频 URL (与 /speak 同构的 audio_url/audio_path)。
 */
import express, { Router } from "express";
import path from "path";
import { success, error } from "@/lib/responseFormat";
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

// ─── GET /status/:promptId — ComfyUI history 直读 (两段式异步轮询) ──────────

router.get("/:promptId", async (req, res) => {
  const promptId = req.params.promptId;
  try {
    const resp = await fetch(`${TTS_CONFIG.comfyuiUrl}/history/${promptId}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) {
      return res.status(502).json(error(`ComfyUI history responded ${resp.status}`));
    }
    const history = await resp.json() as Record<string, any>;
    const entry = history[promptId];

    if (!entry) {
      // 尚在队列/执行中, history 未落 — 客户端继续轮询
      return res.json(success({ prompt_id: promptId, status: "pending" }));
    }

    const statusStr = entry.status?.status_str;
    if (statusStr === "success") {
      // 提取音频输出 (与 /speak 的 extractAudioPath 同构)
      let audio: { filename: string; subfolder: string; url: string } | null = null;
      for (const nodeId of Object.keys(entry.outputs || {})) {
        const out = entry.outputs[nodeId];
        if (out?.audio?.[0]) {
          const a = out.audio[0];
          const filename = a.filename as string;
          const subfolder = (a.subfolder || "") as string;
          const type = (a.type || "output") as string;
          const url = `${TTS_CONFIG.comfyuiHostUrl}/view?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(subfolder)}&type=${encodeURIComponent(type)}`;
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
        audio_path: path.join(TTS_CONFIG.outputDir, audio.filename),
        audio_url: audio.url,
      }));
    }

    if (statusStr === "error") {
      const errMsg = JSON.stringify(entry.status?.messages || entry.status || "Unknown error").slice(0, 500);
      return res.json(success({ prompt_id: promptId, status: "error", error: errMsg }));
    }

    // status_str 其它值 (executing 等) — 仍在执行
    return res.json(success({ prompt_id: promptId, status: "running" }));
  } catch (err: any) {
    return res.status(502).json(error(`ComfyUI unreachable: ${err?.message || err}`));
  }
});

export default router;
