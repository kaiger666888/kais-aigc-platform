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
 * 异步模式 (async:true 或 header X-KAP-Async:1, 2026-08-16):
 *   提交成功即 202 {prompt_id, queue_wait_ms, status_url} — 不等轮询完成。
 *   客户端两段式: GET /api/v1/tts/status/:promptId 轮询到 success 拿音频 URL。
 *
 * Response: { audio_path, audio_url, mode, service }
 */
import express, { Router } from "express";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import {
  VramInsufficientError,
  QueueTimeoutError,
  QueueAbortedError,
  QueuePurgedError,
  withGpuQueueTimed,
} from "@/lib/gpuVramManager";
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

  // 异步两段式 (2026-08-16): true → 提交成功即 202 {prompt_id, queue_wait_ms},
  // 客户端轮询 GET /api/v1/tts/status/:promptId (等价 header X-KAP-Async: 1)。
  // 单请求超时不再约束「排队+作业」总时长 (P10 双重超时根因)。
  async: z.boolean().optional(),

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

/**
 * 结构化引擎错误（KMC 侧 tts_engine 按 kind 机判降级 vs fail-fast，
 * 见 docs/kmc-tts-error-contract.md）。
 * 包装进 KAP 标准 {code, data, message} 响应格式的 data 字段。
 */
function engineError(
  kind:
    | "engine_unavailable"
    | "synthesis_failed"
    | "vram_insufficient"
    | "queue_timeout"
    | "queue_aborted"
    | "queue_purged",
  detail: string,
  extra: Record<string, unknown> = {},
) {
  return {
    error: {
      kind,
      engine: "qwen_tts",
      detail,
      ...extra,
    },
  };
}

/** ComfyUI fetch 网络层失败（连不上/超时）判定 */
function isNetworkFailure(err: any): boolean {
  const msg = String(err?.message || err?.cause?.message || err || "");
  return (
    err?.name === "TypeError" ||
    err?.name === "AbortError" ||
    err?.code === "ECONNREFUSED" ||
    err?.code === "ETIMEDOUT" ||
    err?.code === "UND_ERR_CONNECT_TIMEOUT" ||
    /fetch failed|network|ECONNREFUSED|ETIMEDOUT|timeout/i.test(msg)
  );
}

/** submitPrompt 前探测 object_info，确认所需节点已注册（engine gate） */
async function checkNodeRegistered(nodeType: string): Promise<boolean> {
  try {
    const resp = await fetch(`${TTS_CONFIG.comfyuiUrl}/object_info`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) return false;
    const data = (await resp.json()) as Record<string, unknown>;
    return nodeType in data;
  } catch {
    return false;
  }
}

/** 本 mode 对应的必需节点类型 */
function requiredNodeType(mode: TtsMode): string {
  switch (mode) {
    case "voice_design": return TTS_CONFIG.NODE_TYPES.VOICE_DESIGN;
    case "voice_clone": return TTS_CONFIG.NODE_TYPES.VOICE_CLONE;
    case "custom_voice": return TTS_CONFIG.NODE_TYPES.CUSTOM_VOICE;
  }
}

class ComfyUiNetworkError extends Error {
  constructor(msg: string) { super(msg); this.name = "ComfyUiNetworkError"; }
}

async function submitPrompt(workflow: Record<string, unknown>): Promise<string> {
  let resp: Response;
  try {
    resp = await fetch(`${TTS_CONFIG.comfyuiUrl}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: workflow }),
    });
  } catch (err: any) {
    throw new ComfyUiNetworkError(`ComfyUI unreachable (${TTS_CONFIG.comfyuiUrl}): ${err?.message || err}`);
  }
  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error(`ComfyUI prompt rejected (${resp.status}): ${txt.slice(0, 500)}`);
  }
  const data = await resp.json() as { prompt_id: string };
  return data.prompt_id;
}

/**
 * 轮询 ComfyUI history 直到完成。
 *
 * @param extraBudgetMs 排队等待补偿 (withGpuQueueTimed 的 queueWaitMs) — 排队
 *   不计入作业预算 (2026-08-16 P10 双重超时根因): poll 预算 = pollTimeoutMs + 排队耗时。
 *   超时弃单前尽力 POST /queue {"delete":[promptId]} 清理 pending 孤儿
 *   (21:48 事故: KAP 300s 弃单但 ComfyUI 21:54 实际成功, 孤儿继续占显存)。
 */
async function pollUntilDone(promptId: string, extraBudgetMs = 0): Promise<{
  status: "success" | "error";
  outputs?: Record<string, any>;
  error?: string;
  timedOut?: boolean;
}> {
  const budgetMs = TTS_CONFIG.pollTimeoutMs + extraBudgetMs;
  const deadline = Date.now() + budgetMs;
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
  await cleanupOrphanPrompt(promptId, budgetMs);
  return { status: "error", error: `Timeout after ${budgetMs / 1000}s`, timedOut: true };
}

/**
 * 超时弃单后的孤儿清理 — 尽力删除 ComfyUI 队列中的 pending 任务。
 * POST /queue {"delete":[promptId]} (注意: DELETE method 是 405, ComfyUI 契约是 POST)。
 * 已 running 的任务 delete 无效 (ComfyUI 会在跑完后保留产物) — 记 log 提示可能孤儿。
 */
async function cleanupOrphanPrompt(promptId: string, budgetMs: number): Promise<void> {
  try {
    const resp = await fetch(`${TTS_CONFIG.comfyuiUrl}/queue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ delete: [promptId] }),
      signal: AbortSignal.timeout(5000),
    });
    if (resp.ok) {
      console.log(`[tts] orphan cleanup: deleted pending prompt ${promptId} from ComfyUI queue (poll budget ${budgetMs / 1000}s exhausted)`);
    } else {
      console.warn(`[tts] orphan cleanup: ComfyUI /queue delete responded ${resp.status} for ${promptId} — task may be running; possible orphan`);
    }
  } catch (err) {
    console.warn(`[tts] orphan cleanup failed for ${promptId} (${err instanceof Error ? err.message : err}) — possible orphan holding VRAM`);
  }
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

    // ─── Preflight: 引擎节点注册探测（engine gate，矩阵 #2 KAP 侧）───
    // 未注册 → 503 engine_unavailable（KMC 侧应 fail-fast 修引擎，不走 delegate 重试）
    const nodeType = requiredNodeType(body.mode as TtsMode);
    if (!(await checkNodeRegistered(nodeType))) {
      return res.status(503).json(error(
        `node ${nodeType} not registered in ComfyUI`,
        engineError("engine_unavailable", `node ${nodeType} not registered in ComfyUI (plugin dir missing or import failed)`, {
          node_type: nodeType,
          comfyui_url: TTS_CONFIG.comfyuiUrl,
        }),
      ));
    }

    // ── 客户端断连取消 (2026-08-19 P1 路由接入) ──
    // 排队中客户端断开 → signal 摘除 waiter (QueueAbortedError)。Node ≥16 的
    // req "close" 在 body 读完即触发, 不能当断连信号; res "close" 且响应未完成才是。
    // signal 仅排队阶段生效 — 已获锁作业照常跑完。
    const ac = new AbortController();
    res.on("close", () => {
      if (!res.writableFinished) ac.abort();
    });

    // ─── GPU 全局串行队列 (gpuVramManager withGpuQueueTimed, 2026-08-16) ───
    // 跨引擎互斥 (TTS/H3/music3/qwen_eye 共享 GPU1 锁), 排队等待而非 fail-fast
    // (P10 事故根因: TTS 预检放行后 qwen-eye 拉起吃掉 14.7G → TTS 合成时崩)。
    // 排队超时 (KAP_GPU_QUEUE_TIMEOUT_MS, 默认 30min) 才抛 vram_insufficient。
    //
    // 双重超时修复 (21:48 事故): queueWaitMs (排队+vram_retry) 不计入作业预算 —
    // poll 预算 = pollTimeoutMs + queueWaitMs。async 模式下提交成功即 202 返回,
    // 客户端改走 GET /api/v1/tts/status/:promptId 两段式轮询。
    const isAsync = body.async === true || req.header("X-KAP-Async") === "1";
    let promptId: string;
    let queueWaitMs = 0;
    let result: { status: "success" | "error"; outputs?: Record<string, any>; error?: string } | null;
    try {
      const out = await withGpuQueueTimed(
        "qwen_tts",
        async (waitedMs) => {
          const pid = await submitPrompt(workflow);
          if (isAsync) return { promptId: pid, result: null };
          return { promptId: pid, result: await pollUntilDone(pid, waitedMs) };
        },
        { gpuIndex: 1, comfyuiUrl: TTS_CONFIG.comfyuiUrl, signal: ac.signal },
      );
      promptId = out.data.promptId;
      queueWaitMs = out.queueWaitMs;
      result = out.data.result;
    } catch (err) {
      if (err instanceof VramInsufficientError) {
        return res.status(503).json(error(
          err.message,
          engineError("vram_insufficient", err.message, {
            freeMiB: err.freeMiB,
            requiredMiB: err.requiredMiB,
            gpuIndex: err.gpuIndex,
          }),
        ));
      }
      // 队列类结构化错误 (2026-08-19 P1): queue_timeout→504 / queue_aborted→499
      // (客户端已断, 状态码仅留痕) / queue_purged→503 — kind 供 KMC 降级机判。
      if (
        err instanceof QueueTimeoutError ||
        err instanceof QueueAbortedError ||
        err instanceof QueuePurgedError
      ) {
        const status =
          err.kind === "queue_timeout" ? 504 : err.kind === "queue_aborted" ? 499 : 503;
        return res.status(status).json(error(
          err.message,
          engineError(err.kind, err.message, {
            gpuIndex: err.gpuIndex,
            ...(err instanceof QueueTimeoutError ? { waitedMs: err.waitedMs } : {}),
          }),
        ));
      }
      throw err;
    }

    // ─── 异步模式: 提交成功即 202, 不等 poll (客户端两段式轮询 status 端点) ───
    if (isAsync && result === null) {
      return res.status(202).json(success({
        prompt_id: promptId,
        queue_wait_ms: queueWaitMs,
        mode: body.mode,
        status_url: `/api/v1/tts/status/${promptId}`,
      }));
    }
    result = result!;

    if (result.status === "error") {
      return res.status(500).json(error(
        `TTS failed: ${result.error}`,
        engineError("synthesis_failed", result.error || "unknown workflow error", { prompt_id: promptId }),
      ));
    }

    const audioInfo = extractAudioPath(result.outputs || {});
    if (!audioInfo) {
      return res.status(500).json(error(
        "TTS completed but no audio output found",
        engineError("synthesis_failed", "workflow succeeded but no audio output node found", { prompt_id: promptId }),
      ));
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
      // Zod error — 请求本身不合法
      return res.status(400).json(error(err.issues.map((i: any) => i.message).join("; ")));
    }
    if (err instanceof ComfyUiNetworkError || isNetworkFailure(err)) {
      // 网络层失败（ComfyUI 不可达/超时）→ 502 engine_unavailable。
      // 旧版把 "fetch failed" 折成 400/500 语义错位（分析报告 C.1 实测复现）。
      return res.status(502).json(error(
        err.message || "ComfyUI unreachable",
        engineError("engine_unavailable", err.message || String(err), {
          comfyui_url: TTS_CONFIG.comfyuiUrl,
        }),
      ));
    }
    // 其余（workflow 被 ComfyUI 拒绝等）→ 500 synthesis_failed
    return res.status(500).json(error(
      err.message || "Invalid request",
      engineError("synthesis_failed", err.message || String(err)),
    ));
  }
});

export default router;
