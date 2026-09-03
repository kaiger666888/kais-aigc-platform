/**
 * Breeze TTS 2 — 语音克隆 API (2026-09-03 盲测定谳后接替 IndexTTS 2.5)
 *
 * POST /api/production/breezeTts/speak          (挂载根直达 — 单路径)
 * POST /api/production/breezeTts/speak/speak    (双挂载 — 与旧 indextts2 形状一致)
 *
 *   multipart/form-data: text, ref_audio(file),
 *     instruction?(情绪/风格导演指令, 自然语言), ref_text?, cfg_scale?, seed?
 *   JSON: 同名字段, ref_audio 为 oss 相对路径或 http URL
 *
 *   → multipart 代理 {BREEZE_TTS_SERVER_URL}/clone, audio/wav 落盘 /oss/tts,
 *     返回 JSON envelope {code, data:{audio_url, audio_path, audio_filename, ...}}
 *
 * 旧端点兼容: emo_text → instruction (原文透传, Breeze 指令即自然语言情绪描述);
 * emo_alpha / duration_factor / lang 兼容收下不生效 (Breeze 无对应参数)。
 * cfg_scale 平台默认 4.0 (盲测胜出配方), 调用方可显式覆盖。
 * ref_text 透传; 未传时回退默认转写 (ref_edit_tata 模板必填, 见 config
 * fallbackRefText 注释 — 转写失配会折损克隆质量, 调用方应尽量传真实转写)。
 *
 * GPU 调度: withGpuQueueTimed("breeze_tts") — Breeze 常驻 RENDER_GEN1, 与
 * ComfyUI/H3/music3 等共享同一把 GPU 串行锁 (ensureVram 不足先 /free 驱逐)。
 *
 * ⚠️ Breeze TTS 2 权重许可证: 非商用 (自托管输出限研究/非商用), Kai 已知情拍板。
 */

import express from "express";
import { success, error } from "@/lib/responseFormat";
import {
  withGpuQueueTimed,
  VramInsufficientError,
  QueueTimeoutError,
  QueueAbortedError,
  QueuePurgedError,
} from "@/lib/gpuVramManager";
import { BREEZE_TTS_CONFIG, BREEZE_TTS_DEFAULTS, BREEZE_ENGINE_ID } from "./config";
import { callBreezeClone, persistWav, resolveRefAudio, fixMulterFilename } from "./_client";
import type { Response } from "express";

const router = express.Router();

/** 已解析的 speak 请求形态 (multer 消费后的 multipart 或 JSON body) */
export interface BreezeSpeakRequest {
  body: Record<string, any>;
  /** multipart 上传的参考音频 (multer memoryStorage) */
  file?: { buffer: Buffer; originalname: string };
  signal?: AbortSignal;
}

/**
 * speak 共享实现 — breezeTts 新端点与旧 indextts2 兼容层 (统一转调) 都走这里。
 * versionLabel 仅影响 envelope 的 version 字段与 400 文案前缀 (旧端点传 "2.5"
 * 保持字节兼容; 新端点传 "breeze-2")。
 */
export async function speakBreezeCore(
  req: BreezeSpeakRequest,
  res: Response,
  opts: { versionLabel: string },
): Promise<Response> {
  const body = req.body || {};
  const text = body.text;
  if (!text) return res.status(400).json(error("Missing 'text' field"));

  // ── 参考音频: multipart file 优先, JSON 形态走 oss/URL 解析 ──
  let refBuffer: Buffer;
  let refFilename: string;
  if (req.file) {
    refBuffer = req.file.buffer;
    refFilename = req.file.originalname || "ref.wav";
  } else {
    const refSpec = body.ref_audio as string | undefined;
    if (!refSpec) {
      return res.status(400).json(
        error(`${opts.versionLabel} speak requires 'ref_audio' (multipart file, oss path or http url)`),
      );
    }
    try {
      const resolved = await resolveRefAudio(refSpec);
      refBuffer = resolved.buffer;
      refFilename = resolved.filename;
    } catch (err: any) {
      return res.status(400).json(error(`cannot resolve ref_audio ${refSpec}: ${err.message}`));
    }
  }

  // ── 参数映射 (Breeze 契约) ──
  // instruction = 显式 instruction || 旧 emo_text 原文 (Breeze 指令即自然语言
  // 情绪描述, 盲测胜出链路; emotion_text 是 2.0 legacy 字段名, 一并收下);
  // emo_alpha 无对应能力, 兼容收下忽略。
  const instruction: string | undefined =
    body.instruction || body.emo_text || body.emotion_text || undefined;
  const cfgScale = Number.isFinite(parseFloat(body.cfg_scale))
    ? parseFloat(body.cfg_scale)
    : BREEZE_TTS_DEFAULTS.cfgScale;
  const seed = Number.isFinite(parseInt(body.seed, 10))
    ? parseInt(body.seed, 10)
    : BREEZE_TTS_DEFAULTS.seed;
  const refText: string = body.ref_text || BREEZE_TTS_DEFAULTS.fallbackRefText;
  // lang / duration_factor: 兼容收下不生效 (Breeze 原生双语, 无语速因子),
  // envelope 照旧回显 lang 保持响应形状不变。
  const lang: string = body.lang || BREEZE_TTS_DEFAULTS.lang;

  let out: { filename: string; absPath: string; synthTime: number; queueWaitMs: number };
  try {
    const result = await withGpuQueueTimed(
      "breeze_tts",
      async (queueWaitMs) => {
        const synth = await callBreezeClone({
          text,
          refBuffer,
          refFilename,
          instruction,
          refText,
          cfgScale,
          seed,
          signal: req.signal,
        });
        const persisted = await persistWav(synth.audioBuffer, "breeze_clone");
        return { ...persisted, synthTime: synth.synthTime, queueWaitMs };
      },
      { comfyuiUrl: BREEZE_TTS_CONFIG.comfyuiUrl, signal: req.signal },
    );
    out = result.data;
  } catch (err: any) {
    if (err instanceof VramInsufficientError) {
      return res.status(503).json(error(err.message, {
        kind: "vram_insufficient",
        freeMiB: err.freeMiB,
        requiredMiB: err.requiredMiB,
        gpuIndex: err.gpuIndex,
      }));
    }
    // 队列类结构化错误 (2026-08-19 P1 契约, KMC D-09 降级机依赖 kind 字段):
    // queue_timeout→504 / queue_aborted→499 / queue_purged→503
    if (
      err instanceof QueueTimeoutError ||
      err instanceof QueueAbortedError ||
      err instanceof QueuePurgedError
    ) {
      const status =
        err.kind === "queue_timeout" ? 504 : err.kind === "queue_aborted" ? 499 : 503;
      return res.status(status).json(error(err.message, {
        kind: err.kind,
        engine: err.engine,
        gpuIndex: err.gpuIndex,
      }));
    }
    return res.status(502).json(error(`Breeze TTS speak error: ${err.message}`));
  }

  return res.json(success({
    version: opts.versionLabel,
    text,
    lang,
    engine: BREEZE_ENGINE_ID,
    instruction: instruction ?? null,
    synthesis_time_s: out.synthTime,
    queue_wait_ms: out.queueWaitMs,
    audio_filename: out.filename,
    audio_path: out.absPath,
    audio_url: `/oss/tts/${out.filename}`,
  })) as any;
}

/**
 * POST /  与  POST /speak  (同一 handler 双挂载 — 与旧 indextts2/speak 形状一致,
 * 客户端单路径与双路径都通)
 */
async function speakHandler(req: any, res: Response): Promise<Response> {
  // 客户端断连取消: res "close" 且响应未完成才 abort (仅排队阶段生效)
  const ac = new AbortController();
  res.on("close", () => {
    if (!res.writableFinished) ac.abort();
  });

  const contentType = req.headers["content-type"] || "";
  if (contentType.includes("multipart/form-data")) {
    const { default: multerLib } = await import("multer");
    const upload = multerLib({ storage: multerLib.memoryStorage() });
    await new Promise<void>((resolve, reject) => {
      upload.single("ref_audio")(req, res, (err: any) => {
        if (err) reject(err);
        else resolve();
      });
    });
    if (req.file?.originalname) {
      req.file.originalname = fixMulterFilename(req.file.originalname);
    }
  }

  try {
    return await speakBreezeCore(
      { body: req.body || {}, file: req.file, signal: ac.signal },
      res,
      { versionLabel: "breeze-2" },
    );
  } catch (err: any) {
    return res.status(500).json(error(err.message || "Internal error"));
  }
}

router.post("/speak", speakHandler);
router.post("/", speakHandler);

export default router;
