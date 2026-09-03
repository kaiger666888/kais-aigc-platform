/**
 * IndexTTS 2 兼容层 — 语音克隆 API (URL/响应包络保持, 引擎已切 Breeze TTS 2)
 *
 * POST /api/production/indextts2/speak/speak   (router 挂载点 + 路由名叠加)
 * POST /api/production/indextts2/speak         (挂载根直达 — 单路径兼容)
 *
 * ⚠️ 2026-09-04 引擎替换 (feat/tts-breeze): 2026-09-03 双盲测定谳 Breeze TTS 2
 * 克隆+情绪导演胜 IndexTTS2.5 emo_text 链, 本路由整体退役旧 IndexTTS-ComfyUI
 * workflow 路径与 :5110 直连代理, 统一转调 breezeTts speak 实现
 * (../breezeTts/speak speakBreezeCore — multipart 代理 breeze-tts.service :5130
 * /clone)。端点 URL、请求字段、响应包络 100% 保持:
 *   - version=2.5 (默认) 与 version=2 (旧 ComfyUI 分支) 都转调 Breeze;
 *   - emo_text/emo_alpha → instruction (Breeze 自然语言情绪指令, emo_text 原文
 *     透传; emo_alpha 无对应能力忽略), cfg_scale 平台默认 4.0 (盲测胜出配方);
 *   - duration_factor / lang / use_random / temperature 等旧字段兼容收下不生效
 *     (Breeze 无对应参数, envelope 照旧回显 lang);
 *   - 响应包络保持 {code, data:{version:"2.5", audio_url, audio_path,
 *     audio_filename, synthesis_time_s, ...}}, engine 字段标注真实引擎。
 *
 * ⚠️ Breeze TTS 2 权重许可证: 非商用 (自托管输出限研究/非商用), Kai 已知情拍板。
 */

import express from "express";
import { success, error } from "@/lib/responseFormat";
import {
  QueueTimeoutError,
  QueueAbortedError,
  QueuePurgedError,
  withGpuQueueTimed,
} from "@/lib/gpuVramManager";
import { BREEZE_TTS_CONFIG, BREEZE_TTS_DEFAULTS } from "../breezeTts/config";
import { speakBreezeCore, type BreezeSpeakRequest } from "../breezeTts/speak";
import { callBreezeClone, persistWav, resolveRefAudio, fixMulterFilename } from "../breezeTts/_client";
import type { Request, Response } from "express";

const router = express.Router();

// ─── Types (兼容收下字段清单, 实际消费见 breezeTts speakBreezeCore) ───────────

interface SpeakBody {
  text: string;
  ref_audio?: string;
  mode?: string;
  emotion_text?: string;
  emotion_vector?: number[];
  temperature?: number;
  top_k?: number;
  top_p?: number;
  use_random?: boolean;
  use_fp16?: boolean;
}

interface BatchBody {
  items: { text: string; id?: string }[];
  ref_audio: string;
  mode?: string;
  temperature?: number;
  top_k?: number;
  top_p?: number;
  use_random?: boolean;
  use_fp16?: boolean;
}

// ─── speak handler (multipart + JSON 双形态, 全部转调 breezeTts 实现) ────────

async function speakHandler(req: Request, res: Response): Promise<Response> {
  // 客户端断连取消 (2026-08-19 P1 契约): res "close" 且响应未完成才 abort;
  // signal 仅排队阶段生效, 已获锁作业照常跑完。
  const ac = new AbortController();
  res.on("close", () => {
    if (!res.writableFinished) ac.abort();
  });

  try {
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
      if ((req as any).file?.originalname) {
        (req as any).file.originalname = fixMulterFilename((req as any).file.originalname);
      }
    }

    const speakReq: BreezeSpeakRequest = {
      body: (req as any).body || {},
      file: (req as any).file,
      signal: ac.signal,
    };
    // version 字段兼容收下不再分叉: 2.5 (默认) 与 2 (旧 ComfyUI legacy 分支,
    // 该路径 2026-09-04 退役) 都走 Breeze。versionLabel 固定 "2.5" 保持旧
    // envelope 字节兼容。
    return await speakBreezeCore(speakReq, res, { versionLabel: "2.5" });
  } catch (err: any) {
    return res.status(500).json(error(err.message || "Internal error"));
  }
}

// 同一 handler 双挂载: 语义路径 /speak (真实路径 .../speak/speak, KMC 调用形态)
// + 挂载根 "/" (单路径 .../speak 直达)。双路径都通, 客户端不再踩 404。
router.post("/speak", speakHandler);
router.post("/", speakHandler);

/**
 * POST /api/production/indextts2/speak/batch
 *
 * 批量合成 — 同一参考音频合成多段文本 (引擎已切 Breeze, 共享 ref 逐条克隆)
 *
 * Body: { items: [{ text, id? }], ref_audio, ... }
 *   ref_audio: /oss/ 相对路径、绝对路径或 http URL (旧 ComfyUI input 文件名
 *   形态随 legacy 路径一并退役)
 *
 * Response: { total, succeeded, failed, items: [{ id, status, audio_url?, error? }] }
 */
router.post("/batch", async (req: Request, res: Response) => {
  try {
    const body = req.body as BatchBody;

    if (!body.items?.length || !body.ref_audio) {
      return res.status(400).json(error("Missing required fields: items[], ref_audio"));
    }

    if (body.items.length > 50) {
      return res.status(400).json(error("Batch limit: 50 items per request"));
    }

    // 客户端断连取消: 整批共享一个 signal — 断连后排队中即刻 QueueAbortedError。
    const ac = new AbortController();
    res.on("close", () => {
      if (!res.writableFinished) ac.abort();
    });

    // ref 解析一次, 整批共享 (旧语义: 同一参考音频)
    let refBuffer: Buffer;
    let refFilename: string;
    try {
      const resolved = await resolveRefAudio(body.ref_audio);
      refBuffer = resolved.buffer;
      refFilename = resolved.filename;
    } catch (err: any) {
      return res.status(400).json(error(`cannot resolve ref_audio ${body.ref_audio}: ${err.message}`));
    }

    const results: Array<{ id?: string; status: string; audio_url?: string; error?: string }> = [];

    // 整批一把 GPU 锁 — 逐条克隆, 单条失败不中断 (错误计入 items), 队列类
    // 结构化错误中止整批返回 5xx + kind (KMC D-09 依赖)。
    try {
      await withGpuQueueTimed(
        "breeze_tts",
        async () => {
          for (const item of body.items) {
            try {
              const synth = await callBreezeClone({
                text: item.text,
                refBuffer,
                refFilename,
                refText: BREEZE_TTS_DEFAULTS.fallbackRefText,
                cfgScale: 4.0,
                seed: 42,
                signal: ac.signal,
              });
              const persisted = await persistWav(synth.audioBuffer, "breeze_clone");
              results.push({
                id: item.id,
                status: "success",
                audio_url: `/oss/tts/${persisted.filename}`,
              });
            } catch (err: any) {
              results.push({ id: item.id, status: "error", error: err.message });
            }
          }
          return null;
        },
        { comfyuiUrl: BREEZE_TTS_CONFIG.comfyuiUrl, signal: ac.signal },
      );
    } catch (err: any) {
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
          batch: { processed: results.length, total: body.items.length },
        }));
      }
      throw err;
    }

    const succeeded = results.filter((r) => r.status === "success").length;
    const failed = results.filter((r) => r.status === "error").length;

    return res.json(success({
      total: results.length,
      succeeded,
      failed,
      items: results,
    }));
  } catch (err: any) {
    return res.status(500).json(error(err.message));
  }
});

/**
 * POST /api/production/indextts2/speak/dubbing
 *
 * SRT 字幕配音 — 一直是 501 占位 (旧 ComfyUI 批量路径退役后同样未实现)
 */
router.post("/dubbing", async (_req: Request, res: Response) => {
  return res.status(501).json(error("SRT dubbing endpoint — coming soon. Use /batch with manual SRT parsing."));
});

export default router;
