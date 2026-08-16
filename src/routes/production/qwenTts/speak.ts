/**
 * Qwen3-TTS — 声音合成 API
 *
 * POST /api/production/qwen-tts/speak
 *   统一入口：自动路由到三种模式
 *     - voice_design: 文字描述创建声音
 *     - voice_clone:  参考音频克隆
 *     - custom_voice: 预设说话人
 *
 * POST /api/production/qwen-tts/batch
 *   批量合成：多段文本共享同一配置
 *
 * 工作流：构建 ComfyUI prompt JSON → 提交 → 轮询 → 返回音频路径
 */

import express from "express";
import path from "path";
import { success, error } from "@/lib/responseFormat";
import { ensureVram, VramInsufficientError, withEngineLock } from "@/lib/gpuVramManager";
import {
  QWEN_TTS_CONFIG,
  QWEN_TTS_DEFAULTS,
  NODE_TYPES,
  QwenTtsMode,
} from "./config";
import type { Request, Response } from "express";

const router = express.Router();

// ─── Types ──────────────────────────────────────────────────────────────────

interface SpeakBody {
  /** 合成模式 */
  mode: QwenTtsMode | string;
  /** 目标文本（必填） */
  text: string;

  // ── VoiceDesign 参数 ──
  /** 声音描述指令（voice_design 模式必填） */
  instruct?: string;

  // ── VoiceClone 参数 ──
  /** 参考音频文件名（ComfyUI input/ 目录） */
  ref_audio?: string;
  /** 参考音频文本（提升克隆质量） */
  ref_text?: string;

  // ── CustomVoice 参数 ──
  /** 预设说话人名称 */
  speaker?: string;

  // ── 通用可选参数 ──
  model_choice?: "0.6B" | "1.7B";
  device?: "auto" | "cuda" | "xpu" | "mps" | "cpu";
  precision?: "bf16" | "fp32";
  language?: string;
  attention?: "auto" | "sage_attn" | "flash_attn" | "sdpa" | "eager";
  seed?: number;
  max_new_tokens?: number;
  top_p?: number;
  top_k?: number;
  temperature?: number;
  repetition_penalty?: number;
  unload_model_after_generate?: boolean;
}

interface BatchBody {
  items: { text: string; id?: string; instruct?: string }[];
  mode: QwenTtsMode | string;
  ref_audio?: string;
  ref_text?: string;
  speaker?: string;
  model_choice?: "0.6B" | "1.7B";
  language?: string;
  instruct?: string;
}

// ─── Workflow Builders ──────────────────────────────────────────────────────

/**
 * 构建 VoiceDesign 工作流
 * Node 1: VoiceDesign → Node 2: SaveAudio
 */
function buildVoiceDesignWorkflow(body: SpeakBody): Record<string, unknown> {
  return {
    "1": {
      class_type: NODE_TYPES.VOICE_DESIGN,
      inputs: {
        text: body.text,
        instruct: body.instruct || "",
        model_choice: body.model_choice || QWEN_TTS_DEFAULTS.modelChoice,
        device: body.device || QWEN_TTS_DEFAULTS.device,
        precision: body.precision || QWEN_TTS_DEFAULTS.precision,
        language: body.language || QWEN_TTS_DEFAULTS.language,
        seed: body.seed ?? QWEN_TTS_DEFAULTS.seed,
        max_new_tokens: body.max_new_tokens ?? QWEN_TTS_DEFAULTS.maxNewTokens,
        top_p: body.top_p ?? QWEN_TTS_DEFAULTS.topP,
        top_k: body.top_k ?? QWEN_TTS_DEFAULTS.topK,
        temperature: body.temperature ?? QWEN_TTS_DEFAULTS.temperature,
        repetition_penalty: body.repetition_penalty ?? QWEN_TTS_DEFAULTS.repetitionPenalty,
        attention: body.attention || QWEN_TTS_DEFAULTS.attention,
        unload_model_after_generate: body.unload_model_after_generate ?? false,
      },
    },
    "2": {
      class_type: NODE_TYPES.SAVE_AUDIO,
      inputs: {
        audio: ["1", 0],
        filename_prefix: `qwents_vd_${Date.now()}`,
      },
    },
  };
}

/**
 * 构建 VoiceClone 工作流
 * Node 1: LoadAudio → Node 2: VoiceClone → Node 3: SaveAudio
 */
function buildVoiceCloneWorkflow(body: SpeakBody): Record<string, unknown> {
  if (!body.ref_audio) {
    throw new Error("voice_clone mode requires 'ref_audio'");
  }

  return {
    "1": {
      class_type: NODE_TYPES.LOAD_AUDIO,
      inputs: {
        audio: body.ref_audio,
        channel: "input",
      },
    },
    "2": {
      class_type: NODE_TYPES.VOICE_CLONE,
      inputs: {
        target_text: body.text,
        model_choice: body.model_choice || "1.7B",
        device: body.device || QWEN_TTS_DEFAULTS.device,
        precision: body.precision || QWEN_TTS_DEFAULTS.precision,
        language: body.language || QWEN_TTS_DEFAULTS.language,
        ref_audio: ["1", 0],
        ref_text: body.ref_text || "",
        seed: body.seed ?? QWEN_TTS_DEFAULTS.seed,
        max_new_tokens: body.max_new_tokens ?? QWEN_TTS_DEFAULTS.maxNewTokens,
        top_p: body.top_p ?? QWEN_TTS_DEFAULTS.topP,
        top_k: body.top_k ?? QWEN_TTS_DEFAULTS.topK,
        temperature: body.temperature ?? QWEN_TTS_DEFAULTS.temperature,
        repetition_penalty: body.repetition_penalty ?? QWEN_TTS_DEFAULTS.repetitionPenalty,
        attention: body.attention || QWEN_TTS_DEFAULTS.attention,
        unload_model_after_generate: body.unload_model_after_generate ?? false,
      },
    },
    "3": {
      class_type: NODE_TYPES.SAVE_AUDIO,
      inputs: {
        audio: ["2", 0],
        filename_prefix: `qwents_vc_${Date.now()}`,
      },
    },
  };
}

/**
 * 构建 CustomVoice 工作流
 * Node 1: CustomVoice → Node 2: SaveAudio
 */
function buildCustomVoiceWorkflow(body: SpeakBody): Record<string, unknown> {
  return {
    "1": {
      class_type: NODE_TYPES.CUSTOM_VOICE,
      inputs: {
        text: body.text,
        speaker: body.speaker || "Eric",
        model_choice: body.model_choice || QWEN_TTS_DEFAULTS.modelChoice,
        device: body.device || QWEN_TTS_DEFAULTS.device,
        precision: body.precision || QWEN_TTS_DEFAULTS.precision,
        language: body.language || QWEN_TTS_DEFAULTS.language,
        instruct: body.instruct || "",
        seed: body.seed ?? QWEN_TTS_DEFAULTS.seed,
        max_new_tokens: body.max_new_tokens ?? QWEN_TTS_DEFAULTS.maxNewTokens,
        top_p: body.top_p ?? QWEN_TTS_DEFAULTS.topP,
        top_k: body.top_k ?? QWEN_TTS_DEFAULTS.topK,
        temperature: body.temperature ?? QWEN_TTS_DEFAULTS.temperature,
        repetition_penalty: body.repetition_penalty ?? QWEN_TTS_DEFAULTS.repetitionPenalty,
        attention: body.attention || QWEN_TTS_DEFAULTS.attention,
        unload_model_after_generate: body.unload_model_after_generate ?? false,
      },
    },
    "2": {
      class_type: NODE_TYPES.SAVE_AUDIO,
      inputs: {
        audio: ["1", 0],
        filename_prefix: `qwents_cv_${Date.now()}`,
      },
    },
  };
}

/**
 * 根据模式构建工作流
 */
function buildWorkflow(body: SpeakBody): Record<string, unknown> {
  const mode = body.mode as QwenTtsMode;
  switch (mode) {
    case QwenTtsMode.VOICE_DESIGN:
      if (!body.instruct) throw new Error("voice_design mode requires 'instruct'");
      return buildVoiceDesignWorkflow(body);
    case QwenTtsMode.VOICE_CLONE:
      return buildVoiceCloneWorkflow(body);
    case QwenTtsMode.CUSTOM_VOICE:
      return buildCustomVoiceWorkflow(body);
    default:
      throw new Error(`Unknown mode: ${mode}. Use: voice_design | voice_clone | custom_voice`);
  }
}

// ─── ComfyUI Helpers (shared with indextts2 pattern) ────────────────────────

/** 提交 prompt 到 ComfyUI */
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

/** 轮询直到完成或超时 */
async function pollUntilDone(promptId: string): Promise<{
  status: "success" | "error";
  outputs?: Record<string, unknown>;
  error?: string;
}> {
  const deadline = Date.now() + QWEN_TTS_CONFIG.pollTimeoutMs;
  const interval = QWEN_TTS_CONFIG.pollIntervalMs;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, interval));

    try {
      const resp = await fetch(`${QWEN_TTS_CONFIG.comfyuiUrl}/history/${promptId}`);
      if (!resp.ok) continue;

      const history = (await resp.json()) as Record<string, any>;
      const entry = history[promptId];
      if (!entry) continue;

      const statusStr = entry.status?.status_str;
      if (statusStr === "success") {
        return { status: "success", outputs: entry.outputs };
      }
      if (statusStr === "error") {
        const errMsg = JSON.stringify(
          entry.status?.messages || entry.status || "Unknown error",
        ).slice(0, 500);
        return { status: "error", error: errMsg };
      }
    } catch {
      // Network hiccup, keep trying
    }
  }

  return { status: "error", error: `Timeout after ${QWEN_TTS_CONFIG.pollTimeoutMs / 1000}s` };
}

/** 从 ComfyUI 输出提取音频文件路径 */
function extractAudioPath(outputs: Record<string, any>): {
  filename: string;
  subfolder: string;
  url: string;
} | null {
  for (const nodeId of Object.keys(outputs)) {
    const nodeOutput = outputs[nodeId];
    if (nodeOutput?.audio?.[0]) {
      const a = nodeOutput.audio[0];
      const filename = a.filename as string;
      const subfolder = (a.subfolder || "") as string;
      const type = (a.type || "output") as string;
      const hostUrl = QWEN_TTS_CONFIG.comfyuiHostUrl;
      const url = `${hostUrl}/view?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(subfolder)}&type=${encodeURIComponent(type)}`;
      return { filename, subfolder: `${subfolder} (${type})`, url };
    }
  }
  return null;
}

/** 上传参考音频到 ComfyUI input 目录 */
async function uploadRefAudio(
  fileBuffer: Buffer,
  originalName: string,
): Promise<string> {
  const ext = path.extname(originalName) || ".wav";
  const safeName = `qwen_ref_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;

  const formData = new FormData();
  formData.append("image", new Blob([new Uint8Array(fileBuffer)]), safeName);

  const resp = await fetch(`${QWEN_TTS_CONFIG.comfyuiUrl}/upload/image`, {
    method: "POST",
    body: formData,
  });

  if (!resp.ok) {
    throw new Error(`Failed to upload reference audio: ${resp.status}`);
  }

  const data = (await resp.json()) as { name: string; subfolder: string };
  return data.name;
}

// ─── Routes ─────────────────────────────────────────────────────────────────

/**
 * POST /api/production/qwen-tts/speak
 *
 * Body (JSON):
 *   { mode, text, instruct?, ref_audio?, ref_text?, speaker?, ... }
 *
 * Body (multipart/form-data):
 *   mode=voice_clone  text=...  ref_audio=@file.wav  (自动上传到 ComfyUI)
 *
 * Examples:
 *   VoiceDesign: { mode: "voice_design", text: "你好世界", instruct: "温柔女声" }
 *   VoiceClone:  { mode: "voice_clone", text: "你好", ref_audio: "ref.wav", ref_text: "参考文本" }
 *   CustomVoice: { mode: "custom_voice", text: "Hello", speaker: "Eric" }
 */
router.post("/speak", async (req: Request, res: Response) => {
  try {
    let body: SpeakBody;

    // Handle multipart upload
    const contentType = req.headers["content-type"] || "";
    if (contentType.includes("multipart/form-data")) {
      const { default: multerLib } = await import("multer");
      const upload = multerLib({ storage: multerLib.memoryStorage() });

      await new Promise<void>((resolve, reject) => {
        upload.single("ref_audio")(req as any, res as any, (err: any) => {
          if (err) reject(err);
          else resolve();
        });
      });

      const text = (req as any).body?.text;
      const mode = (req as any).body?.mode;
      if (!text) return res.status(400).json(error("Missing 'text' field"));
      if (!mode) return res.status(400).json(error("Missing 'mode' field"));

      let refAudioName: string | undefined;
      if ((req as any).file) {
        refAudioName = await uploadRefAudio(
          (req as any).file.buffer as Buffer,
          (req as any).file.originalname,
        );
      } else {
        refAudioName = (req as any).body?.ref_audio;
      }

      body = {
        mode,
        text,
        instruct: (req as any).body?.instruct,
        ref_audio: refAudioName,
        ref_text: (req as any).body?.ref_text,
        speaker: (req as any).body?.speaker,
        model_choice: (req as any).body?.model_choice,
        language: (req as any).body?.language,
        seed: (req as any).body?.seed ? parseInt((req as any).body.seed) : undefined,
        top_p: (req as any).body?.top_p ? parseFloat((req as any).body.top_p) : undefined,
        top_k: (req as any).body?.top_k ? parseInt((req as any).body.top_k) : undefined,
        temperature: (req as any).body?.temperature
          ? parseFloat((req as any).body.temperature)
          : undefined,
      };
    } else {
      body = req.body as SpeakBody;
    }

    if (!body.text) {
      return res.status(400).json(error("Missing required field: text"));
    }
    if (!body.mode) {
      return res.status(400).json(error("Missing required field: mode"));
    }

    // Validate mode-specific requirements
    if (body.mode === QwenTtsMode.VOICE_DESIGN && !body.instruct) {
      return res.status(400).json(error("voice_design mode requires 'instruct' field"));
    }
    if (body.mode === QwenTtsMode.VOICE_CLONE && !body.ref_audio) {
      return res
        .status(400)
        .json(error("voice_clone mode requires 'ref_audio' field (filename or file upload)"));
    }

    // Build & submit workflow
    const workflow = buildWorkflow(body);

    // ─── Preflight: 显存预检 + 引擎互斥 (gpuVramManager, 2026-08-16) ───
    // 不足先 /free 驱逐, 仍不足 fail-fast (vram_insufficient), 不进队列盲等超时。
    try {
      await ensureVram("qwen_tts", 1, QWEN_TTS_CONFIG.comfyuiUrl);
    } catch (err) {
      if (err instanceof VramInsufficientError) {
        return res.status(503).json(error(err.message, {
          kind: "vram_insufficient",
          engine: "qwen_tts",
          freeMiB: err.freeMiB,
          requiredMiB: err.requiredMiB,
          gpuIndex: err.gpuIndex,
        }));
      }
      throw err;
    }

    const promptId = await withEngineLock("qwen_tts", () => submitPrompt(workflow));

    // Poll for result
    const result = await pollUntilDone(promptId);

    if (result.status === "error") {
      return res.status(500).json(error(`Synthesis failed: ${result.error}`));
    }

    const audioInfo = extractAudioPath(result.outputs || {});
    if (!audioInfo) {
      return res
        .status(500)
        .json(error("Synthesis completed but no audio output found"));
    }

    const localPath = path.join(QWEN_TTS_CONFIG.outputDir, audioInfo.filename);

    return res.json(
      success({
        prompt_id: promptId,
        audio_filename: audioInfo.filename,
        audio_path: localPath,
        audio_url: audioInfo.url,
        text: body.text,
        mode: body.mode,
      }),
    );
  } catch (err: any) {
    return res.status(500).json(error(err.message || "Internal error"));
  }
});

/**
 * POST /api/production/qwen-tts/batch
 *
 * 批量合成 — 同一配置合成多段文本
 *
 * Body: { items: [{ text, id?, instruct? }], mode, ref_audio?, speaker?, ... }
 */
router.post("/batch", async (req: Request, res: Response) => {
  try {
    const body = req.body as BatchBody;

    if (!body.items?.length || !body.mode) {
      return res
        .status(400)
        .json(error("Missing required fields: items[], mode"));
    }

    if (body.items.length > 50) {
      return res.status(400).json(error("Batch limit: 50 items per request"));
    }

    if (body.mode === QwenTtsMode.VOICE_CLONE && !body.ref_audio) {
      return res
        .status(400)
        .json(error("voice_clone mode requires 'ref_audio' field"));
    }

    // Submit all prompts sequentially (avoid GPU OOM)
    const results: Array<{
      id?: string;
      status: string;
      audio_url?: string;
      error?: string;
    }> = [];

    for (const [idx, item] of body.items.entries()) {
      try {
        const speakBody: SpeakBody = {
          mode: body.mode,
          text: item.text,
          instruct: item.instruct || body.instruct,
          ref_audio: body.ref_audio,
          ref_text: body.ref_text,
          speaker: body.speaker,
          model_choice: body.model_choice as "0.6B" | "1.7B" | undefined,
          language: body.language,
        };

        const workflow = buildWorkflow(speakBody);

        // Unique filename per item
        const ts = Date.now();
        const lastNode = Object.keys(workflow).length.toString();
        (workflow[lastNode] as any).inputs.filename_prefix = `qwents_batch_${ts}_${idx}`;

        // 批量同样走显存预检 + 互斥 (每条提交前逐条检查)
        await ensureVram("qwen_tts", 1, QWEN_TTS_CONFIG.comfyuiUrl).catch((err) => {
          if (err instanceof VramInsufficientError) throw err;
        });
        const promptId = await withEngineLock("qwen_tts", () => submitPrompt(workflow));
        const result = await pollUntilDone(promptId);

        if (result.status === "error") {
          results.push({ id: item.id, status: "error", error: result.error });
        } else {
          const audioInfo = extractAudioPath(result.outputs || {});
          results.push({
            id: item.id,
            status: "success",
            audio_url: audioInfo?.url,
          });
        }
      } catch (err: any) {
        results.push({ id: item.id, status: "error", error: err.message });
      }
    }

    const succeeded = results.filter((r) => r.status === "success").length;
    const failed = results.filter((r) => r.status === "error").length;

    return res.json(
      success({
        total: results.length,
        succeeded,
        failed,
        items: results,
      }),
    );
  } catch (err: any) {
    return res.status(500).json(error(err.message));
  }
});

export default router;
