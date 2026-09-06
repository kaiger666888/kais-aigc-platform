/**
 * Breeze TTS 2 HTTP client — /clone (multipart→wav 字节) + /generate (JSON→base64)
 * + /health 探针 + oss 落盘。供 breezeTts/speak.ts 与 breezeTts/voice-design.ts
 * 共用 (旧 indextts2 兼容层也转调到这里)。
 *
 * 文件名 `_` 前缀 — router 再生成扫描跳过 helper (无 default export)。
 */

import { promises as fs } from "fs";
import path from "path";
import { BREEZE_TTS_CONFIG } from "./config";

export interface BreezeCloneParams {
  text: string;
  refBuffer: Buffer;
  refFilename: string;
  /** 情绪/风格导演指令 (Breeze 自然语言 instruction; 旧 emo_text 原文透传至此) */
  instruction?: string;
  /** 参考音频转写文本 (Breeze /clone 可选字段) */
  refText?: string;
  cfgScale: number;
  seed: number;
  signal?: AbortSignal;
}

export interface BreezeSynthResult {
  audioBuffer: Buffer;
  /** 墙钟合成耗时 (秒) — Breeze 无 X-Synthesis-Time 头, 本地实测 */
  synthTime: number;
}

/** POST {serverUrl}/clone — multipart, 响应为 audio/wav 原始字节 (24kHz PCM16) */
export async function callBreezeClone(params: BreezeCloneParams): Promise<BreezeSynthResult> {
  const started = Date.now();

  const boundary = `----FormBoundary${Date.now()}${Math.random().toString(36).slice(2)}`;
  const parts: Buffer[] = [];

  const addField = (name: string, value: string) => {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  };

  addField("text", params.text);
  addField("cfg_scale", String(params.cfgScale));
  addField("seed", String(params.seed));
  if (params.instruction) addField("instruction", params.instruction);
  if (params.refText) addField("ref_text", params.refText);

  parts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="ref_audio"; filename="${params.refFilename}"\r\nContent-Type: audio/wav\r\n\r\n`,
  ));
  parts.push(params.refBuffer);
  parts.push(Buffer.from("\r\n"));
  parts.push(Buffer.from(`--${boundary}--\r\n`));

  const resp = await fetch(`${BREEZE_TTS_CONFIG.serverUrl}/clone`, {
    method: "POST",
    body: Buffer.concat(parts),
    headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
    signal: params.signal,
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw Object.assign(
      new Error(`Breeze TTS clone error (${resp.status}): ${txt.slice(0, 500)}`),
      { statusCode: resp.status },
    );
  }
  return {
    audioBuffer: Buffer.from(await resp.arrayBuffer()),
    synthTime: (Date.now() - started) / 1000,
  };
}

/** POST {serverUrl}/generate — JSON, 零参考设计, 响应 {success, audio_base64, duration, sr} */
export async function callBreezeGenerate(params: {
  text: string;
  instruct: string;
  cfgScale: number;
  seed: number;
  signal?: AbortSignal;
}): Promise<BreezeSynthResult & { duration: number; sr: number }> {
  const started = Date.now();

  const resp = await fetch(`${BREEZE_TTS_CONFIG.serverUrl}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: params.text,
      instruct: params.instruct,
      cfg_scale: params.cfgScale,
      seed: params.seed,
    }),
    signal: params.signal,
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw Object.assign(
      new Error(`Breeze TTS generate error (${resp.status}): ${txt.slice(0, 500)}`),
      { statusCode: resp.status },
    );
  }
  const data = (await resp.json()) as {
    success?: boolean; audio_base64?: string; duration?: number; sr?: number; error?: string;
  };
  if (!data.success || !data.audio_base64) {
    throw new Error(`Breeze TTS generate failed: ${data.error || "no audio_base64 in response"}`);
  }
  const audioBuffer = Buffer.from(data.audio_base64, "base64");
  if (!audioBuffer.length) {
    throw new Error("Breeze TTS generate returned empty audio_base64");
  }
  return {
    audioBuffer,
    synthTime: (Date.now() - started) / 1000,
    duration: data.duration ?? 0,
    sr: data.sr ?? 24000,
  };
}

/** GET {serverUrl}/health — 探针失败返回 null (不抛), 供 status 路由组装降级态 */
export async function probeBreezeHealth(): Promise<{
  healthy: boolean;
  status?: string;
  modelLoaded?: boolean;
  engine?: string;
  error?: string;
}> {
  try {
    const resp = await fetch(`${BREEZE_TTS_CONFIG.serverUrl}/health`, {
      signal: AbortSignal.timeout(BREEZE_TTS_CONFIG.healthTimeoutMs),
    });
    if (!resp.ok) {
      return { healthy: false, error: `health HTTP ${resp.status}` };
    }
    const data = (await resp.json()) as { status?: string; model_loaded?: boolean; engine?: string };
    return {
      healthy: data.status === "ok",
      status: data.status,
      modelLoaded: data.model_loaded,
      engine: data.engine,
    };
  } catch (err: any) {
    return { healthy: false, error: `${err?.name || "Error"}: ${err?.message || err}` };
  }
}

/**
 * 权重驻留快探 (R5 常驻感知, 2026-09-06) — 供 speak/voice-design 预检前判定
 * 「Breeze 权重是否已常驻显存」, 决定增量 (2560MiB) 还是满档 (8192MiB) 预检。
 *
 * 与 probeBreezeHealth 的分工: 本函数为预检路径专用 — 1s 硬超时 (探针慢本身
 * 就说明服务不健康, 不值得让 GPU 队列排队多等), 失败一律视为 not loaded
 * (fail-closed 到满档预检, 绝不放行错增量)。fetchImpl 参数仅供单测注入桩。
 */
export async function probeBreezeResident(
  fetchImpl: typeof fetch = fetch,
): Promise<{ modelLoaded: boolean; loading: boolean }> {
  try {
    const resp = await fetchImpl(`${BREEZE_TTS_CONFIG.serverUrl}/health`, {
      signal: AbortSignal.timeout(1_000),
    });
    if (!resp.ok) return { modelLoaded: false, loading: false };
    const data = (await resp.json()) as { model_loaded?: boolean; loading?: boolean };
    // loading=true (加载中) 尚未驻留完成 — 按未加载处理, 走满档
    return { modelLoaded: data.model_loaded === true, loading: data.loading === true };
  } catch {
    return { modelLoaded: false, loading: false };
  }
}

/** wav 落盘 outputDir (映射 /oss/tts 静态服务), 返回 {filename, absPath} */
export async function persistWav(audioBuffer: Buffer, prefix: string): Promise<{
  filename: string;
  absPath: string;
}> {
  const filename = `${prefix}_${Date.now()}.wav`;
  await fs.mkdir(BREEZE_TTS_CONFIG.outputDir, { recursive: true });
  const absPath = path.join(BREEZE_TTS_CONFIG.outputDir, filename);
  await fs.writeFile(absPath, audioBuffer);
  return { filename, absPath };
}

/**
 * multer originalname latin1 乱码修复 — multer 按 latin1 解码 filename, 非 ASCII
 * (KMC ref 文件名含中文角色名) 会 mojibake; latin1 字节重编码回 utf8 复原。
 * multipart 入口消费 req.file 后调用。
 */
export function fixMulterFilename(originalname: string): string {
  try {
    return Buffer.from(originalname, "latin1").toString("utf8");
  } catch {
    return originalname;
  }
}

/**
 * 解析 JSON 形态 ref_audio → Buffer (http URL 下载 / /oss/ 相对路径 / 绝对路径)。
 * multipart 入口不走这里 (multer 已给出 buffer)。
 */
export async function resolveRefAudio(refSpec: string): Promise<{ buffer: Buffer; filename: string }> {
  if (refSpec.startsWith("http://") || refSpec.startsWith("https://")) {
    const dl = await fetch(refSpec);
    if (!dl.ok) throw new Error(`ref_audio download failed (${dl.status})`);
    return { buffer: Buffer.from(await dl.arrayBuffer()), filename: refSpec.split("/").pop() || "ref.wav" };
  }
  // /oss/ 相对路径 → 相对 data/oss 解析 (与静态服务同源; /oss/ 前缀优先于
  // isAbsolute 判定 — 旧 indextts2 JSON 形态此处有 ENOENT bug, /oss/ 引用
  // 被当字面绝对路径打开); 其余按绝对路径读。
  const ossRoot = BREEZE_TTS_CONFIG.outputDir.replace(/\/tts$/, "");
  const abs = refSpec.startsWith("/oss/")
    ? path.join(ossRoot, refSpec.replace(/^\/oss\//, ""))
    : refSpec;
  return { buffer: await fs.readFile(abs), filename: path.basename(refSpec) || "ref.wav" };
}
