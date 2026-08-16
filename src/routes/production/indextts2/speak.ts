/**
 * IndexTTS 2.0 — 语音合成 API
 *
 * POST /api/production/indextts2/speak
 *   零样本语音克隆：输入文本 + 参考音频 → 输出克隆语音
 *
 * POST /api/production/indextts2/batch
 *   批量合成：多段文本共享同一参考音频
 *
 * POST /api/production/indextts2/dubbing
 *   SRT 字幕配音：上传 SRT + 参考音频 → 输出每行配音
 *
 * 工作流：构建 ComfyUI prompt JSON → 提交 → 轮询 → 返回音频路径
 */

import express from "express";
import { promises as fs } from "fs";
import path from "path";
import { success, error } from "@/lib/responseFormat";
import { withGpuQueue, withGpuQueueTimed, VramInsufficientError } from "@/lib/gpuVramManager";
import { INDEXTTS2_CONFIG, INDEXTTS2_DEFAULTS, NODE_TYPES, SynthMode } from "./config";
import type { Request, Response } from "express";

const router = express.Router();

// ─── Types ──────────────────────────────────────────────────────────────────

interface SpeakBody {
  text: string;
  /** 参考音频文件名（在 ComfyUI input/ 目录）或绝对路径 */
  ref_audio: string;
  /** 合成模式 */
  mode?: SynthMode | string;
  /** 情感文本（emotion_text 模式用） */
  emotion_text?: string;
  /** 情感向量（emotion_vector 模式用） */
  emotion_vector?: number[];
  /** 采样参数覆盖 */
  temperature?: number;
  top_k?: number;
  top_p?: number;
  use_random?: boolean;
  /** use_fp16 覆盖（首次调用可设 false 测试） */
  use_fp16?: boolean;
}

interface BatchBody {
  items: { text: string; id?: string }[];
  ref_audio: string;
  mode?: SynthMode | string;
  temperature?: number;
  top_k?: number;
  top_p?: number;
  use_random?: boolean;
  use_fp16?: boolean;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** 构建 ComfyUI workflow JSON */
function buildWorkflow(body: SpeakBody): Record<string, unknown> {
  const mode = body.mode || SynthMode.VOICE_CLONE;

  // Node 1: Model Loader
  const modelLoader = {
    class_type: NODE_TYPES.MODEL_LOADER,
    inputs: {
      model_dir: INDEXTTS2_DEFAULTS.modelDir,
      device: INDEXTTS2_DEFAULTS.device,
      use_fp16: body.use_fp16 ?? INDEXTTS2_DEFAULTS.useFp16,
      use_cuda_kernel: INDEXTTS2_DEFAULTS.useCudaKernel,
      use_deepspeed: INDEXTTS2_DEFAULTS.useDeepspeed,
    },
  };

  // Node 2: Load reference audio
  const loadAudio = {
    class_type: NODE_TYPES.LOAD_AUDIO,
    inputs: {
      audio: body.ref_audio,
      channel: "input",
    },
  };

  // Node 3: Synthesis node (varies by mode)
  const synthInputs: Record<string, unknown> = {
    model: ["1", 0],
    text: body.text,
    spk_audio_prompt: ["2", 0],
    temperature: body.temperature ?? INDEXTTS2_DEFAULTS.temperature,
    top_k: body.top_k ?? INDEXTTS2_DEFAULTS.topK,
    top_p: body.top_p ?? INDEXTTS2_DEFAULTS.topP,
    use_random: body.use_random ?? INDEXTTS2_DEFAULTS.useRandom,
  };

  // Add mode-specific inputs
  if (mode === SynthMode.EMOTION_TEXT && body.emotion_text) {
    synthInputs.emotion_text = body.emotion_text;
  }
  if (mode === SynthMode.EMOTION_VECTOR && body.emotion_vector) {
    synthInputs.emotion_vector = body.emotion_vector;
  }

  // Map mode to node type
  const synthNodeType: Record<string, string> = {
    [SynthMode.VOICE_CLONE]: NODE_TYPES.VOICE_CLONE,
    [SynthMode.EMOTION_AUDIO]: NODE_TYPES.EMOTION_AUDIO,
    [SynthMode.EMOTION_VECTOR]: NODE_TYPES.EMOTION_VECTOR,
    [SynthMode.EMOTION_TEXT]: NODE_TYPES.EMOTION_TEXT,
  };

  const synthNode = {
    class_type: synthNodeType[mode] || NODE_TYPES.VOICE_CLONE,
    inputs: synthInputs,
  };

  // Node 4: Save audio
  const saveAudio = {
    class_type: NODE_TYPES.SAVE_AUDIO,
    inputs: {
      audio: ["3", 0],
      filename_prefix: `indextts2_${Date.now()}`,
    },
  };

  return {
    "1": modelLoader,
    "2": loadAudio,
    "3": synthNode,
    "4": saveAudio,
  };
}

/** 提交 prompt 到 ComfyUI，返回 prompt_id */
async function submitPrompt(workflow: Record<string, unknown>): Promise<string> {
  const resp = await fetch(`${INDEXTTS2_CONFIG.comfyuiUrl}/prompt`, {
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

/** 轮询直到完成或超时 */
async function pollUntilDone(promptId: string): Promise<{
  status: "success" | "error";
  outputs?: Record<string, unknown>;
  error?: string;
}> {
  const deadline = Date.now() + INDEXTTS2_CONFIG.pollTimeoutMs;
  const interval = INDEXTTS2_CONFIG.pollIntervalMs;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, interval));

    try {
      const resp = await fetch(`${INDEXTTS2_CONFIG.comfyuiUrl}/history/${promptId}`);
      if (!resp.ok) continue;

      const history = await resp.json() as Record<string, any>;
      const entry = history[promptId];
      if (!entry) continue;

      const statusStr = entry.status?.status_str;
      if (statusStr === "success") {
        return { status: "success", outputs: entry.outputs };
      }
      if (statusStr === "error") {
        // Extract error message from execution
        const errMsg = JSON.stringify(entry.status?.messages || entry.status || "Unknown error").slice(0, 500);
        return { status: "error", error: errMsg };
      }
      // Still executing...
    } catch {
      // Network hiccup, keep trying
    }
  }

  return { status: "error", error: `Timeout after ${INDEXTTS2_CONFIG.pollTimeoutMs / 1000}s` };
}

/** 从 ComfyUI 输出提取音频文件路径 */
function extractAudioPath(outputs: Record<string, any>): { filename: string; subfolder: string; url: string } | null {
  for (const nodeId of Object.keys(outputs)) {
    const nodeOutput = outputs[nodeId];
    if (nodeOutput?.audio?.[0]) {
      const a = nodeOutput.audio[0];
      const filename = a.filename as string;
      const subfolder = (a.subfolder || "") as string;
      const type = (a.type || "output") as string;
      const hostUrl = INDEXTTS2_CONFIG.comfyuiHostUrl;
      const url = `${hostUrl}/view?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(subfolder)}&type=${encodeURIComponent(type)}`;
      return { filename, subfolder: `${subfolder} (${type})`, url };
    }
  }
  return null;
}

/** 上传参考音频到 ComfyUI input 目录 */
async function uploadRefAudio(fileBuffer: Buffer, originalName: string): Promise<string> {
  const ext = path.extname(originalName) || ".wav";
  const safeName = `ref_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;

  // 写到 ComfyUI input 目录（通过 ComfyUI API 上传）
  const formData = new FormData();
  formData.append("image", new Blob([new Uint8Array(fileBuffer)]), safeName);

  const resp = await fetch(`${INDEXTTS2_CONFIG.comfyuiUrl}/upload/image`, {
    method: "POST",
    body: formData,
  });

  if (!resp.ok) {
    throw new Error(`Failed to upload reference audio: ${resp.status}`);
  }

  const data = await resp.json() as { name: string; subfolder: string };
  return data.name;
}

// ─── v2.5 helpers — IndexTTS 2.5 standalone server proxy ────────────────────

/** JSON envelope 响应形状 (v1/tts 风格: {audio_path, audio_url, ...}) */
async function proxyV25Speak(params: {
  text: string;
  lang: string;
  durationFactor: number;
  emoText?: string;
  emoAlpha?: number;
  refBuffer: Buffer;
  refFilename: string;
}): Promise<{ audioBuffer: Buffer; synthTime: number }> {
  const boundary = `----FormBoundary${Date.now()}${Math.random().toString(36).slice(2)}`;
  const parts: Buffer[] = [];

  const addField = (name: string, value: string) => {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  };

  addField("text", params.text);
  addField("lang", params.lang);
  addField("duration_factor", String(params.durationFactor));
  if (params.emoText) {
    addField("emo_text", params.emoText);
    addField("emo_alpha", String(params.emoAlpha ?? 1.0));
  }

  parts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="ref_audio"; filename="${params.refFilename}"\r\nContent-Type: audio/wav\r\n\r\n`,
  ));
  parts.push(params.refBuffer);
  parts.push(Buffer.from("\r\n"));
  parts.push(Buffer.from(`--${boundary}--\r\n`));

  const resp = await fetch(`${INDEXTTS2_CONFIG.v25ServerUrl}/api/production/indextts2/speak`, {
    method: "POST",
    body: Buffer.concat(parts),
    headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw Object.assign(
      new Error(`IndexTTS 2.5 server error (${resp.status}): ${txt.slice(0, 500)}`),
      { statusCode: resp.status },
    );
  }
  return {
    audioBuffer: Buffer.from(await resp.arrayBuffer()),
    synthTime: parseFloat(resp.headers.get("X-Synthesis-Time") || "0"),
  };
}

/**
 * v2.5 分支 handler — multer 已消费 multipart, 读 req.file.buffer 代理转发。
 * audio/wav 二进制落盘 v25OutputDir, 返回 JSON envelope (不原样透传二进制,
 * 客户端统一走 audio_url 下载 — 与 v1/tts 风格一致, KMC engine 好消费)。
 * 包 withGpuQueue("indextts2") — 与 voice-design.ts 同一把 GPU1 队列锁。
 */
async function speakV25(req: any, res: Response): Promise<Response> {
  const text = req.body?.text;
  if (!text) return res.status(400).json(error("Missing 'text' field"));
  if (!req.file) return res.status(400).json(error("v2.5 speak requires multipart 'ref_audio' file"));

  const lang = req.body?.lang || INDEXTTS2_DEFAULTS.defaultLang;
  const durationFactor = req.body?.duration_factor
    ? parseFloat(req.body.duration_factor)
    : INDEXTTS2_DEFAULTS.durationFactor;

  let out: { outFilename: string; synthTime: number; queueWaitMs: number };
  try {
    const result = await withGpuQueue(
      "indextts2",
      async () => {
        const synth = await proxyV25Speak({
          text,
          lang,
          durationFactor,
          emoText: req.body?.emo_text || undefined,
          emoAlpha: req.body?.emo_alpha ? parseFloat(req.body.emo_alpha) : undefined,
          refBuffer: req.file.buffer as Buffer,
          refFilename: req.file.originalname || "ref.wav",
        });
        const outFilename = `indextts25_${Date.now()}.wav`;
        await fs.mkdir(INDEXTTS2_CONFIG.v25OutputDir, { recursive: true });
        await fs.writeFile(path.join(INDEXTTS2_CONFIG.v25OutputDir, outFilename), synth.audioBuffer);
        return { outFilename, synthTime: synth.synthTime, queueWaitMs: 0 };
      },
      { gpuIndex: 1, comfyuiUrl: INDEXTTS2_CONFIG.comfyuiUrl },
    );
    out = result;
  } catch (err: any) {
    if (err instanceof VramInsufficientError) {
      return res.status(503).json(error(err.message, {
        kind: "vram_insufficient",
        freeMiB: err.freeMiB,
        requiredMiB: err.requiredMiB,
        gpuIndex: err.gpuIndex,
      }));
    }
    return res.status(502).json(error(`IndexTTS 2.5 speak error: ${err.message}`));
  }

  return res.json(success({
    version: "2.5",
    text,
    lang,
    synthesis_time_s: out.synthTime,
    audio_filename: out.outFilename,
    audio_path: path.join(INDEXTTS2_CONFIG.v25OutputDir, out.outFilename),
    audio_url: `/oss/tts/${out.outFilename}`,
  })) as any;
}

/**
 * v2.5 JSON 形态 — ref_audio 字段是 {v25ServerUrl} 可达的 URL 或 /oss/ 相对路径。
 * KMC IndexTTS25Engine 主要走 multipart (design_voice 落盘后的 host ref), 此
 * JSON 入口供轻量客户端复用已注册的 ref (读本地 oss 目录)。
 */
async function speakV25Json(body: SpeakBody, res: Response): Promise<Response> {
  const refSpec = (body as any).ref_audio as string;
  if (!refSpec) {
    return res.status(400).json(error("v2.5 JSON speak requires 'ref_audio' (oss path or http url)"));
  }
  let refBuffer: Buffer;
  try {
    if (refSpec.startsWith("http://") || refSpec.startsWith("https://")) {
      const dl = await fetch(refSpec);
      if (!dl.ok) throw new Error(`ref_audio download failed (${dl.status})`);
      refBuffer = Buffer.from(await dl.arrayBuffer());
    } else {
      // /oss/... 或绝对路径 → 相对 data/oss 解析 (与静态服务同源)
      const fsPath = refSpec.replace(/^\/oss\//, "").replace(/^\//, "");
      const abs = path.isAbsolute(refSpec) ? refSpec : path.join(
        INDEXTTS2_CONFIG.v25OutputDir.replace(/\/tts$/, ""), fsPath,
      );
      refBuffer = await fs.readFile(abs);
    }
  } catch (err: any) {
    return res.status(400).json(error(`cannot resolve ref_audio ${refSpec}: ${err.message}`));
  }

  let out: { outFilename: string; synthTime: number; queueWaitMs: number };
  try {
    const result = await withGpuQueue(
      "indextts2",
      async () => {
        const synth = await proxyV25Speak({
          text: body.text,
          lang: (body as any).lang || INDEXTTS2_DEFAULTS.defaultLang,
          durationFactor: (body as any).duration_factor ?? INDEXTTS2_DEFAULTS.durationFactor,
          emoText: (body as any).emo_text || undefined,
          refBuffer,
          refFilename: path.basename(refSpec) || "ref.wav",
        });
        const outFilename = `indextts25_${Date.now()}.wav`;
        await fs.mkdir(INDEXTTS2_CONFIG.v25OutputDir, { recursive: true });
        await fs.writeFile(path.join(INDEXTTS2_CONFIG.v25OutputDir, outFilename), synth.audioBuffer);
        return { outFilename, synthTime: synth.synthTime, queueWaitMs: 0 };
      },
      { gpuIndex: 1, comfyuiUrl: INDEXTTS2_CONFIG.comfyuiUrl },
    );
    out = result;
  } catch (err: any) {
    if (err instanceof VramInsufficientError) {
      return res.status(503).json(error(err.message, {
        kind: "vram_insufficient",
        freeMiB: err.freeMiB,
        requiredMiB: err.requiredMiB,
        gpuIndex: err.gpuIndex,
      }));
    }
    return res.status(502).json(error(`IndexTTS 2.5 speak error: ${err.message}`));
  }

  return res.json(success({
    version: "2.5",
    text: body.text,
    lang: (body as any).lang || INDEXTTS2_DEFAULTS.defaultLang,
    synthesis_time_s: out.synthTime,
    audio_filename: out.outFilename,
    audio_path: path.join(INDEXTTS2_CONFIG.v25OutputDir, out.outFilename),
    audio_url: `/oss/tts/${out.outFilename}`,
  })) as any;
}

// ─── Routes ─────────────────────────────────────────────────────────────────

/**
 * POST /api/production/indextts2/speak
 *
 * Body (JSON):
 *   { text, ref_audio, mode?, temperature?, top_k?, top_p?, use_random? }
 *
 * Body (multipart/form-data):
 *   text=...  ref_audio=@file.wav   (自动上传到 ComfyUI)
 *   version=2.5 (可选, 默认 2.5) → 代理到 IndexTTS 2.5 standalone server
 *
 * version 分支 (2026-08-16 Kai 决策, VoiceDesign→IndexTTS2.5 成为唯一链路):
 *   - version=2.5 (默认): multipart 代理到 {v25ServerUrl}/api/production/
 *     indextts2/speak (text/lang/duration_factor/ref_audio/emo_text/emo_alpha),
 *     audio/wav 二进制落盘 v25OutputDir → 返回 JSON envelope
 *     {code:200, data:{audio_path, audio_url, ...}} (v1/tts 风格)。
 *   - version=2: 旧 ComfyUI IndexTTS-2 节点路径, 全保留 (legacy)。
 */
router.post("/speak", async (req: Request, res: Response) => {
  try {
    let body: SpeakBody;

    // Handle multipart upload
    const contentType = req.headers["content-type"] || "";
    if (contentType.includes("multipart/form-data")) {
      // Dynamic import multer only when needed
      const { default: multerLib } = await import("multer");
      const upload = multerLib({ storage: multerLib.memoryStorage() });

      await new Promise<void>((resolve, reject) => {
        upload.single("ref_audio")(req as any, res as any, (err: any) => {
          if (err) reject(err);
          else resolve();
        });
      });

      // ── version=2.5 分支: 代理 IndexTTS 2.5 standalone server ──
      // 默认 2.5 (唯一链路决策); 显式 version=2 走下面旧 ComfyUI 路径。
      const reqVersion = (req as any).body?.version ?? "2.5";
      if (reqVersion === "2.5") {
        return await speakV25(req as any, res);
      }

      const text = (req as any).body?.text;
      if (!text) return res.status(400).json(error("Missing 'text' field"));

      let refAudioName: string;
      if ((req as any).file) {
        refAudioName = await uploadRefAudio(
          (req as any).file.buffer as Buffer,
          (req as any).file.originalname,
        );
      } else {
        const ref = (req as any).body?.ref_audio;
        if (!ref) return res.status(400).json(error("Missing 'ref_audio' file or filename"));
        refAudioName = ref;
      }

      body = {
        text,
        ref_audio: refAudioName,
        mode: (req as any).body?.mode,
        temperature: (req as any).body?.temperature ? parseFloat((req as any).body.temperature) : undefined,
        top_k: (req as any).body?.top_k ? parseInt((req as any).body.top_k) : undefined,
        top_p: (req as any).body?.top_p ? parseFloat((req as any).body.top_p) : undefined,
        use_random: (req as any).body?.use_random === "true",
        use_fp16: (req as any).body?.use_fp16 === "false" ? false : true,
      };
    } else {
      // JSON body
      body = req.body as SpeakBody;
      // JSON 形态同样支持 version=2.5 (带 ref_audio 为 v25 server 可达 URL 时)
      if ((body as any).version === "2.5") {
        return await speakV25Json(body, res);
      }
    }

    if (!body.text || !body.ref_audio) {
      return res.status(400).json(error("Missing required fields: text, ref_audio"));
    }

    // Build & submit workflow
    const workflow = buildWorkflow(body);

    // ─── GPU 全局串行队列 (gpuVramManager withGpuQueue, 2026-08-16 二期) ───
    // IndexTTS-2 (~6GB) 与 TTS/H3/music3/qwen_eye 共享 GPU1 锁, 排队等待而非 fail-fast。
    // 锁粒度到「提交+等完成」。
    const { promptId, result } = await withGpuQueue(
      "indextts2",
      async () => {
        const pid = await submitPrompt(workflow);
        return { promptId: pid, result: await pollUntilDone(pid) };
      },
      { gpuIndex: 1, comfyuiUrl: INDEXTTS2_CONFIG.comfyuiUrl },
    );

    if (result.status === "error") {
      return res.status(500).json(error(`Synthesis failed: ${result.error}`));
    }

    const audioInfo = extractAudioPath(result.outputs || {});
    if (!audioInfo) {
      return res.status(500).json(error("Synthesis completed but no audio output found"));
    }

    // Construct local file path
    const localPath = path.join(INDEXTTS2_CONFIG.outputDir, audioInfo.filename);

    return res.json(success({
      prompt_id: promptId,
      audio_filename: audioInfo.filename,
      audio_path: localPath,
      audio_url: audioInfo.url,
      text: body.text,
      mode: body.mode || SynthMode.VOICE_CLONE,
    }));
  } catch (err: any) {
    return res.status(500).json(error(err.message || "Internal error"));
  }
});

/**
 * POST /api/production/indextts2/batch
 *
 * 批量合成 — 同一参考音频合成多段文本
 *
 * Body: { items: [{ text, id? }], ref_audio, mode?, ... }
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

    // Submit all prompts sequentially (avoid GPU OOM)
    const results: Array<{ id?: string; status: string; audio_url?: string; error?: string }> = [];

    for (const item of body.items) {
      try {
        const workflow = buildWorkflow({
          text: item.text,
          ref_audio: body.ref_audio,
          mode: body.mode,
          temperature: body.temperature,
          top_k: body.top_k,
          top_p: body.top_p,
          use_random: body.use_random,
          use_fp16: body.use_fp16,
        });

        // Unique filename per item
        const ts = Date.now();
        (workflow["4"] as any).inputs.filename_prefix = `indextts2_batch_${ts}_${results.length}`;

        // 批量同样走 GPU 全局串行队列 (每条逐条入队)
        const { promptId, result } = await withGpuQueue(
          "indextts2",
          async () => {
            const pid = await submitPrompt(workflow);
            return { promptId: pid, result: await pollUntilDone(pid) };
          },
          { gpuIndex: 1, comfyuiUrl: INDEXTTS2_CONFIG.comfyuiUrl },
        );

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
 * POST /api/production/indextts2/dubbing
 *
 * SRT 字幕配音
 *
 * Body: { srt_content, ref_audio, mode?, ... }
 *   或 multipart: srt_file=@sub.srt, ref_audio=@voice.wav
 *
 * Response: { items: [{ index, text, audio_url, start, end }] }
 */
router.post("/dubbing", async (req: Request, res: Response) => {
  try {
    // TODO: Implement SRT parsing + batch synthesis
    // For now, redirect to /batch with pre-parsed items
    return res.status(501).json(error("SRT dubbing endpoint — coming soon. Use /batch with manual SRT parsing."));
  } catch (err: any) {
    return res.status(500).json(error(err.message));
  }
});

export default router;
