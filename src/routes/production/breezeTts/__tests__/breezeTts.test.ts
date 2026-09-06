/**
 * breezeTts.test.ts — Breeze TTS 2 契约测试 + 旧 indextts2 端点兼容性测试
 * (2026-09-04 feat/tts-breeze, 接替 indextts25.test.ts)。
 *
 * Project convention (Pitfalls B3): no vitest/jest at repo root. Plain
 * TypeScript module exporting async test functions; the runnable entrypoint
 * is `scripts/verify-breeze-tts.ts` (tsx + assert() + results[] pattern)。
 *
 * Coverage:
 * - config 字段: serverUrl (:5130) / outputDir (cwd 相对映射 /oss/tts) / defaults。
 * - breezeTts/speak: multipart 代理 :5130/clone + 落盘 + JSON envelope (app 级
 *   真实 multipart, 修复旧套件 fake-req 假绿问题)。
 * - breezeTts/voice-design: 单步 JSON 代理 :5130/generate + envelope 同形。
 * - 旧端点兼容: /api/production/indextts2/{speak,voice-design,status} URL 与
 *   响应包络 100% 保持; emo_text→instruction 映射; cfg_scale=4.0 默认;
 *   version=2 legacy 分支同样转调 Breeze; 全程零 :5110/:5111/:8188 流量。
 *
 * HTTP mock: 全局 fetch 打桩 (route 模块用裸 fetch, 无 DI seam — stub
 * globalThis.fetch + ephemeral port 真实 HTTP 回放)。
 */

import express from "express";
import http from "http";
import { promises as fs } from "fs";
import path from "path";
import { BREEZE_TTS_CONFIG, BREEZE_TTS_DEFAULTS, BREEZE_ENGINE_ID } from "../config";

// ─── fetch stub 基建 ─────────────────────────────────────────────────────────

interface CapturedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Buffer | string | undefined;
}

type FetchHandler = (req: CapturedRequest) => {
  status: number;
  body: Buffer | string;
  headers?: Record<string, string>;
};

const captured: CapturedRequest[] = [];
const realFetch = globalThis.fetch;

function installFetchStub(handler: FetchHandler): void {
  (globalThis as any).fetch = async (url: any, init: any = {}) => {
    const req: CapturedRequest = {
      url: String(url),
      method: init.method || "GET",
      headers: (init.headers as Record<string, string>) || {},
      body: init.body,
    };
    captured.push(req);
    const out = handler(req);
    const buf = typeof out.body === "string" ? Buffer.from(out.body) : out.body;
    return {
      ok: out.status >= 200 && out.status < 300,
      status: out.status,
      headers: {
        get: (name: string) => out.headers?.[name.toLowerCase()] ?? null,
      },
      json: async () => JSON.parse(buf.toString("utf-8")),
      text: async () => buf.toString("utf-8"),
      arrayBuffer: async () =>
        buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length),
    } as any;
  };
}

function restoreFetch(): void {
  (globalThis as any).fetch = realFetch;
  captured.length = 0;
}

/**
 * R5 常驻感知 (2026-09-06): speak/voice-design 预检前多一发 GET :5130/health
 * (probeBreezeResident, 1s 超时) — 上游契约断言只关心业务请求, 过滤掉探针。
 */
function upstreamCaptured(): CapturedRequest[] {
  return captured.filter((c) => !c.url.endsWith("/health"));
}

/** GPU 队列旁路 — KAP_VRAM_SKIP=1 跳过 ensureVram 预检 (nvidia-smi), 锁即时获取 */
async function installGpuQueueBypass(): Promise<void> {
  process.env.KAP_VRAM_SKIP = "1";
}

/** 从 multipart/raw body 提取 form 字段值 (text 形态) */
function multipartField(bodyStr: string, name: string): string | null {
  const re = new RegExp(`name="${name}"\\r\\n\\r\\n([^\\r\\n]*)\\r\\n`);
  const m = bodyStr.match(re);
  return m ? m[1] : null;
}

/** ── 真实 multipart 构造 (Node 18+ 无 form-data 包, 手拼 buffer) ── */
function buildMultipart(
  fields: Record<string, string>,
  file: { field: string; filename: string; content: Buffer },
): { body: Buffer; contentType: string } {
  const boundary = `----TestBoundary${Math.random().toString(36).slice(2)}`;
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }
  parts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; filename="${file.filename}"\r\nContent-Type: audio/wav\r\n\r\n`,
  ));
  parts.push(file.content);
  parts.push(Buffer.from("\r\n"));
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

// ─── ephemeral-port HTTP harness (真实 express app, 与 router.ts 同挂载形态) ──

interface HttpResponse {
  status: number;
  body: string;
  raw: Buffer;
}

async function postRaw(
  port: number,
  urlPath: string,
  headers: Record<string, string>,
  payload: Buffer | string,
): Promise<HttpResponse> {
  const body = typeof payload === "string" ? Buffer.from(payload) : payload;
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: urlPath,
        method: "POST",
        headers: { ...headers, "content-length": body.length },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve({
          status: res.statusCode ?? 0,
          body: Buffer.concat(chunks).toString("utf-8"),
          raw: Buffer.concat(chunks),
        }));
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function postJson(port: number, urlPath: string, body: unknown): Promise<HttpResponse> {
  return postRaw(port, urlPath, { "content-type": "application/json" }, JSON.stringify(body));
}

function getJson(port: number, urlPath: string): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: urlPath }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve({
        status: res.statusCode ?? 0,
        body: Buffer.concat(chunks).toString("utf-8"),
        raw: Buffer.concat(chunks),
      }));
    }).on("error", reject);
  });
}

async function listen(app: express.Express): Promise<{ server: http.Server; port: number }> {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  return { server, port };
}

async function close(server: http.Server): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

/** 断言 captured 里没有任何 legacy 5110/5111/ComfyUI 流量 */
function legacyTrafficUrls(): string[] {
  return captured
    .map((c) => c.url)
    .filter((u) => u.includes(":5110") || u.includes(":5111") || u.includes(":8188"));
}

// ─── Tests ──────────────────────────────────────────────────────────────────

export interface TestResult {
  name: string;
  pass: boolean;
  detail?: string;
}

function check(results: TestResult[], cond: boolean, name: string, detail?: string): void {
  results.push({ name, pass: cond, detail: cond ? undefined : detail });
}

const FAKE_WAV = Buffer.from("RIFF-fake-breeze-wav-bytes");

/** B1: config 字段齐备 */
export async function testConfigFields(): Promise<TestResult[]> {
  const results: TestResult[] = [];
  check(results,
    BREEZE_TTS_CONFIG.serverUrl === "http://127.0.0.1:5130",
    "config.serverUrl default = http://127.0.0.1:5130",
    `got ${BREEZE_TTS_CONFIG.serverUrl}`);
  check(results,
    BREEZE_TTS_CONFIG.outputDir.endsWith("/oss/tts"),
    "config.outputDir 映射 /oss/tts 静态服务 (cwd 相对)",
    `got ${BREEZE_TTS_CONFIG.outputDir}`);
  check(results,
    BREEZE_TTS_CONFIG.comfyuiUrl.includes("comfyui-primary:8188"),
    "config.comfyuiUrl = comfyui-primary:8188 (GPU 队列驱逐目标)",
    `got ${BREEZE_TTS_CONFIG.comfyuiUrl}`);
  check(results, BREEZE_TTS_DEFAULTS.cfgScale === 4.0, "defaults.cfgScale = 4.0 (盲测胜出配方)");
  check(results, BREEZE_TTS_DEFAULTS.seed === 42, "defaults.seed = 42");
  check(results, BREEZE_ENGINE_ID === "breeze-tts-2", "BREEZE_ENGINE_ID = breeze-tts-2");
  return results;
}

/** B2: breezeTts/speak — app 级真实 multipart, 代理 :5130/clone + envelope */
export async function testBreezeSpeakAppMount(): Promise<TestResult[]> {
  const results: TestResult[] = [];
  await installGpuQueueBypass();

  installFetchStub((req) => {
    if (req.url === "http://127.0.0.1:5130/clone") {
      return { status: 200, body: FAKE_WAV };
    }
    return { status: 404, body: "not found" };
  });

  let server: http.Server | null = null;
  try {
    const { default: speakRouter } = await import("../speak");
    const app = express();
    app.use(express.json());
    app.use("/api/production/breezeTts/speak", speakRouter);
    const li = await listen(app);
    server = li.server;

    const mp = buildMultipart(
      { text: "你好世界", instruction: "开心一点", cfg_scale: "4.0", seed: "7",
        ref_text: "在下钟馗，乃终南山进士。" },
      { field: "ref_audio", filename: "ref_阿毛.wav", content: Buffer.from("REF-WAV") },
    );
    const resp = await postRaw(li.port, "/api/production/breezeTts/speak/speak",
      { "content-type": mp.contentType }, mp.body);

    check(results, resp.status === 200, "breezeTts/speak 双路径 multipart → 200",
      `status=${resp.status} body=${resp.body.slice(0, 300)}`);
    const env = JSON.parse(resp.body);
    const data = env.data || {};
    check(results, data.version === "breeze-2", "envelope version=breeze-2");
    check(results, data.engine === "breeze-tts-2", "envelope engine=breeze-tts-2");
    check(results, typeof data.audio_url === "string" && data.audio_url.startsWith("/oss/tts/"),
      "envelope audio_url=/oss/tts/...", JSON.stringify(data).slice(0, 200));
    check(results, typeof data.audio_path === "string" && data.audio_path.length > 0,
      "envelope audio_path (绝对路径)");
    check(results, /breeze_clone_\d+\.wav$/.test(data.audio_filename || ""),
      "envelope audio_filename = breeze_clone_<ts>.wav", data.audio_filename);
    check(results, typeof data.synthesis_time_s === "number", "envelope synthesis_time_s (墙钟实测)");

    // 上游契约: 恰好一次 :5130/clone multipart (R5 /health 探针不计)
    const up = upstreamCaptured();
    check(results, up.length === 1 && up[0].url === "http://127.0.0.1:5130/clone",
      "上游 POST {serverUrl}/clone 恰好一次", `requests: ${up.map((c) => c.url).join(", ")}`);
    const upBody = String(up[0]?.body ?? "");
    check(results, multipartField(upBody, "text") === "你好世界", "上游 text 透传");
    check(results, multipartField(upBody, "instruction") === "开心一点", "上游 instruction 透传");
    check(results, multipartField(upBody, "cfg_scale") === "4", "上游 cfg_scale 透传 (caller 显式)");
    check(results, multipartField(upBody, "seed") === "7", "上游 seed 透传");
    check(results, multipartField(upBody, "ref_text") === "在下钟馗，乃终南山进士。",
      "上游 ref_text 透传 (caller 显式)");
    check(results, /name="ref_audio"; filename="ref_阿毛\.wav"/.test(upBody),
      "上游 ref_audio 文件透传 (multer latin1 乱码已修复)");
    check(results, legacyTrafficUrls().length === 0, "零 :5110/:5111/:8188 流量",
      legacyTrafficUrls().join(", "));

    // 产物真实落盘 (outputDir gitignored, 幂等可重跑)
    const written = await fs.readFile(path.join(BREEZE_TTS_CONFIG.outputDir, data.audio_filename));
    check(results, written.equals(FAKE_WAV), "audio/wav 字节完整落盘 outputDir");
  } finally {
    if (server) await close(server);
    restoreFetch();
  }
  return results;
}

/** B3: breezeTts/speak — 单路径挂载根直达 + 缺 ref_audio 400 (非 404) */
export async function testBreezeSpeakDualPath(): Promise<TestResult[]> {
  const results: TestResult[] = [];
  await installGpuQueueBypass();

  installFetchStub(() => ({ status: 404, body: "not found" }));

  let server: http.Server | null = null;
  try {
    const { default: speakRouter } = await import("../speak");
    const app = express();
    app.use(express.json());
    app.use("/api/production/breezeTts/speak", speakRouter);
    const li = await listen(app);
    server = li.server;

    const single = await postJson(li.port, "/api/production/breezeTts/speak", { text: "x" });
    check(results, single.status === 400 && /ref_audio/.test(single.body),
      "单路径 POST /api/production/breezeTts/speak → 400 (缺 ref_audio, 非 404)",
      `status=${single.status} body=${single.body.slice(0, 200)}`);

    const noText = await postRaw(li.port, "/api/production/breezeTts/speak",
      { "content-type": "multipart/form-data; boundary=x" }, "--x--\r\n");
    check(results, noText.status === 400, "multipart 缺 text → 400", `status=${noText.status}`);
  } finally {
    if (server) await close(server);
    restoreFetch();
  }
  return results;
}

/** B4: breezeTts/voice-design — 单步 JSON 代理 :5130/generate + envelope 同形 */
export async function testBreezeVoiceDesign(): Promise<TestResult[]> {
  const results: TestResult[] = [];
  await installGpuQueueBypass();

  installFetchStub((req) => {
    if (req.url === "http://127.0.0.1:5130/generate") {
      return {
        status: 200,
        body: JSON.stringify({ success: true, sr: 24000, duration: 2.5, audio_base64: FAKE_WAV.toString("base64") }),
      };
    }
    return { status: 404, body: "not found" };
  });

  let server: http.Server | null = null;
  try {
    const { default: vdRouter } = await import("../voice-design");
    const app = express();
    app.use(express.json());
    app.use("/api/production/breezeTts/voice-design", vdRouter);
    const li = await listen(app);
    server = li.server;

    // KMC IndexTTS25Engine design_voice 的真实请求形状
    const resp = await postJson(li.port, "/api/production/breezeTts/voice-design/voice-design", {
      character_name: "阿毛",
      instruct: "约5岁男童",
      text: "你好，这是我的声音。",
      lang: "ZH",
      language: "Chinese",
      emotion_mode: "none",
      seed: 1234,
    });

    check(results, resp.status === 200, "breezeTts/voice-design → 200",
      `status=${resp.status} body=${resp.body.slice(0, 300)}`);
    const env = JSON.parse(resp.body);
    const data = env.data || {};
    check(results, data.engine === "breeze-tts-2", "envelope engine=breeze-tts-2");
    check(results, typeof data.voice_id === "string" && data.voice_id.startsWith("阿毛_"),
      "envelope voice_id 按角色名生成 (CJK 字符保留)", data.voice_id);
    check(results,
      typeof data.synthesis?.audio_url === "string" && data.synthesis.audio_url.startsWith("/oss/tts/"),
      "envelope synthesis.audio_url = /oss/tts/...", JSON.stringify(data.synthesis || {}).slice(0, 200));
    check(results, typeof data.synthesis?.audio_filename === "string", "envelope synthesis.audio_filename");
    check(results, typeof data.ref_audio_filename === "string", "envelope ref_audio_filename (设计产物即音色身份证)");
    check(results, typeof data.ref_text === "string" && data.ref_text.length > 0, "envelope ref_text 回显");

    // 上游契约: 恰好一次 :5130/generate JSON (无 :5111 设计步, 无 :5110 克隆步; R5 /health 探针不计)
    const up = upstreamCaptured();
    check(results, up.length === 1 && up[0].url === "http://127.0.0.1:5130/generate",
      "上游 POST {serverUrl}/generate 恰好一次 (单步, 无 5111+5110 两步链)",
      `requests: ${up.map((c) => c.url).join(", ")}`);
    const upBody = JSON.parse(String(up[0]?.body ?? "{}"));
    check(results, upBody.text === "你好，这是我的声音。", "上游 text 直通");
    check(results, upBody.instruct === "约5岁男童", "上游 instruct 直通");
    check(results, upBody.cfg_scale === 4.0, "上游 cfg_scale 默认 4.0 (盲测胜出配方)");
    check(results, upBody.seed === 1234, "上游 seed 透传");
    check(results, legacyTrafficUrls().length === 0, "零 :5110/:5111/:8188 流量",
      legacyTrafficUrls().join(", "));

    // 产物落盘
    const written = await fs.readFile(
      path.join(BREEZE_TTS_CONFIG.outputDir, data.synthesis.audio_filename));
    check(results, written.equals(FAKE_WAV), "设计 wav 完整落盘 outputDir");
  } finally {
    if (server) await close(server);
    restoreFetch();
  }
  return results;
}

/** B5: voice-design 校验逻辑 (400 分支, 文案与旧端点一致) */
export async function testVoiceDesignValidation(): Promise<TestResult[]> {
  const results: TestResult[] = [];
  const { voiceDesignBreezeCore } = await import("../voice-design");

  const runCase = (body: any) =>
    new Promise<any>((resolve) => {
      const res: any = {
        statusCode: 200,
        status(code: number) { this.statusCode = code; return this; },
        json(payload: any) { resolve({ status: this.statusCode, json: payload }); return this; },
      };
      voiceDesignBreezeCore(body, res).catch((e) => resolve({ status: -1, json: { error: String(e) } }));
    });

  const missingName = await runCase({ instruct: "x", text: "y" });
  check(results, missingName.status === 400 && /character_name/.test(missingName.json?.message || ""),
    "缺 character_name → 400");
  const missingInstruct = await runCase({ character_name: "c", text: "y" });
  check(results, missingInstruct.status === 400 && /instruct/.test(missingInstruct.json?.message || ""),
    "缺 instruct → 400");
  const missingText = await runCase({ character_name: "c", instruct: "i" });
  check(results, missingText.status === 400 && /text/.test(missingText.json?.message || ""),
    "缺 text → 400");
  const badEmotion = await runCase({
    character_name: "c", instruct: "i", text: "t", emotion_mode: "bogus",
  });
  check(results, badEmotion.status === 400 && /emotion_mode/.test(badEmotion.json?.message || ""),
    "非法 emotion_mode → 400");
  const textNoPayload = await runCase({
    character_name: "c", instruct: "i", text: "t", emotion_mode: "text",
  });
  check(results, textNoPayload.status === 400 && /emotion_text/.test(textNoPayload.json?.message || ""),
    "emotion_mode=text 缺 emotion_text → 400");
  return results;
}

/** C1: 旧端点 /api/production/indextts2/speak — multipart version=2.5 兼容转调 */
export async function testOldSpeakV25Compat(): Promise<TestResult[]> {
  const results: TestResult[] = [];
  await installGpuQueueBypass();

  installFetchStub((req) => {
    if (req.url === "http://127.0.0.1:5130/clone") {
      return { status: 200, body: FAKE_WAV };
    }
    return { status: 404, body: "not found" };
  });

  let server: http.Server | null = null;
  try {
    const { default: speakRouter } = await import("../../indextts2/speak");
    const app = express();
    app.use(express.json());
    // 与 src/router.ts 相同的挂载形态
    app.use("/api/production/indextts2/speak", speakRouter);
    const li = await listen(app);
    server = li.server;

    // KMC IndexTTS25Engine._post_speak 的真实 multipart 形状
    const mp = buildMultipart(
      {
        text: "台词一",
        lang: "ZH",
        duration_factor: "1",
        version: "2.5",
        emo_text: "悲伤压抑",
      },
      { field: "ref_audio", filename: "ref_阿毛.wav", content: Buffer.from("REF-WAV") },
    );
    const resp = await postRaw(li.port, "/api/production/indextts2/speak/speak",
      { "content-type": mp.contentType }, mp.body);

    check(results, resp.status === 200, "旧端点 speak (multipart version=2.5, KMC 形状) → 200",
      `status=${resp.status} body=${resp.body.slice(0, 300)}`);
    const env = JSON.parse(resp.body);
    const data = env.data || {};
    check(results, env.code === 200, "envelope code=200");
    check(results, data.version === "2.5", "envelope version=2.5 (字节兼容)");
    check(results, data.lang === "ZH", "envelope lang 回显");
    check(results, data.engine === "breeze-tts-2", "envelope engine=breeze-tts-2 (真实引擎标注)");
    check(results,
      typeof data.audio_url === "string" && data.audio_url.startsWith("/oss/tts/"),
      "envelope audio_url=/oss/tts/...", JSON.stringify(data).slice(0, 200));
    check(results, typeof data.audio_path === "string" && data.audio_path.length > 0,
      "envelope audio_path");
    check(results, typeof data.audio_filename === "string" && data.audio_filename.length > 0,
      "envelope audio_filename");
    check(results, typeof data.synthesis_time_s === "number", "envelope synthesis_time_s");

    // 上游: emo_text → instruction 原文映射, cfg_scale=4.0, 无 5110/8188 流量
    const up = upstreamCaptured();
    const upBody = String(up[0]?.body ?? "");
    check(results, up[0]?.url === "http://127.0.0.1:5130/clone",
      "上游 POST :5130/clone (不再打 :5110)", `got ${up[0]?.url}`);
    check(results, multipartField(upBody, "instruction") === "悲伤压抑",
      "emo_text 原文 → instruction 映射");
    check(results, multipartField(upBody, "cfg_scale") === "4",
      "cfg_scale 平台默认 4.0 (盲测胜出配方)");
    check(results, multipartField(upBody, "seed") === "42", "seed 默认 42");
    check(results,
      multipartField(upBody, "ref_text") === BREEZE_TTS_DEFAULTS.fallbackRefText,
      "ref_text 缺失 → fallbackRefText 兜底 (ref_edit_tata 模板必填, 缺失 500)");
    check(results, multipartField(upBody, "duration_factor") === null,
      "duration_factor 不透传 (Breeze 无语速参数)");
    check(results, legacyTrafficUrls().length === 0, "零 :5110/:5111/:8188 流量",
      legacyTrafficUrls().join(", "));
  } finally {
    if (server) await close(server);
    restoreFetch();
  }
  return results;
}

/** C2: 旧端点 version=2 (legacy ComfyUI 分支) 也转调 Breeze — 无 :8188 workflow 流量 */
export async function testOldSpeakV2AlsoBreeze(): Promise<TestResult[]> {
  const results: TestResult[] = [];
  await installGpuQueueBypass();

  installFetchStub((req) => {
    if (req.url === "http://127.0.0.1:5130/clone") {
      return { status: 200, body: FAKE_WAV };
    }
    return { status: 404, body: "not found" };
  });

  let server: http.Server | null = null;
  try {
    const { default: speakRouter } = await import("../../indextts2/speak");
    const app = express();
    app.use(express.json());
    app.use("/api/production/indextts2/speak", speakRouter);
    const li = await listen(app);
    server = li.server;

    const mp = buildMultipart(
      { text: "旧链路调用方", version: "2" },
      { field: "ref_audio", filename: "ref.wav", content: Buffer.from("REF") },
    );
    const resp = await postRaw(li.port, "/api/production/indextts2/speak",
      { "content-type": mp.contentType }, mp.body);

    check(results, resp.status === 200, "version=2 (单路径) → 200 (legacy 分支统一转调 Breeze)",
      `status=${resp.status} body=${resp.body.slice(0, 300)}`);
    check(results,
      captured.some((c) => c.url === "http://127.0.0.1:5130/clone"),
      "version=2 上游仍 POST :5130/clone",
      `requests: ${captured.map((c) => c.url).join(", ")}`);
    check(results,
      !captured.some((c) => c.url.includes(":8188/prompt")),
      "version=2 不再提交 ComfyUI /prompt (workflow 路径已退役)",
      `requests: ${captured.map((c) => c.url).join(", ")}`);
    const env = JSON.parse(resp.body);
    check(results, env.data?.version === "2.5" && !!env.data?.audio_url,
      "version=2 响应包络同形 (audio_url)");
    check(results, legacyTrafficUrls().length === 0, "零 :5110/:5111/:8188 流量",
      legacyTrafficUrls().join(", "));
  } finally {
    if (server) await close(server);
    restoreFetch();
  }
  return results;
}

/** C3: 旧端点 /api/production/indextts2/voice-design/voice-design 兼容转调 */
export async function testOldVoiceDesignCompat(): Promise<TestResult[]> {
  const results: TestResult[] = [];
  await installGpuQueueBypass();

  installFetchStub((req) => {
    if (req.url === "http://127.0.0.1:5130/generate") {
      return {
        status: 200,
        body: JSON.stringify({ success: true, sr: 24000, duration: 3.2, audio_base64: FAKE_WAV.toString("base64") }),
      };
    }
    return { status: 404, body: "not found" };
  });

  let server: http.Server | null = null;
  try {
    const { default: vdRouter } = await import("../../indextts2/voice-design");
    const app = express();
    app.use(express.json());
    app.use("/api/production/indextts2/voice-design", vdRouter);
    const li = await listen(app);
    server = li.server;

    // KMC IndexTTS25Engine.design_voice 的真实请求形状
    const resp = await postJson(li.port, "/api/production/indextts2/voice-design/voice-design", {
      character_name: "阿毛",
      instruct: "约5岁男童",
      text: "你好，这是我的声音。",
      lang: "ZH",
      language: "Chinese",
      emotion_mode: "none",
      seed: 42,
    });

    check(results, resp.status === 200, "旧端点 voice-design (KMC 形状) → 200",
      `status=${resp.status} body=${resp.body.slice(0, 300)}`);
    const env = JSON.parse(resp.body);
    const data = env.data || {};
    check(results, env.code === 200, "envelope code=200");
    check(results, !!data.voice_id && data.character_name === "阿毛" && data.instruct === "约5岁男童",
      "envelope voice_id/character_name/instruct 同形");
    const synth = data.synthesis || {};
    check(results,
      typeof synth.audio_url === "string" && synth.audio_url.startsWith("/oss/tts/"),
      "envelope synthesis.audio_url = /oss/tts/...", JSON.stringify(synth).slice(0, 200));
    check(results, typeof synth.lang === "string" && typeof synth.synthesis_time_s === "number"
      && typeof synth.audio_filename === "string" && synth.text === "你好，这是我的声音。",
      "envelope synthesis.{text,lang,synthesis_time_s,audio_filename} 同形");

    // 上游: 单步 :5130/generate (不再有 :5111 设计步 + :5110 克隆步; R5 /health 探针不计)
    const up = upstreamCaptured();
    check(results,
      up.length === 1 && up[0].url === "http://127.0.0.1:5130/generate",
      "上游恰好一次 :5130/generate (5111+5110 两步链退役)",
      `requests: ${up.map((c) => c.url).join(", ")}`);
    const upBody = JSON.parse(String(up[0]?.body ?? "{}"));
    check(results, upBody.instruct === "约5岁男童" && upBody.cfg_scale === 4.0,
      "上游 instruct 直通 + cfg_scale=4.0");
    check(results, legacyTrafficUrls().length === 0, "零 :5110/:5111/:8188 流量",
      legacyTrafficUrls().join(", "));
  } finally {
    if (server) await close(server);
    restoreFetch();
  }
  return results;
}

/** C4: 旧端点 status → :5130/health 探针; breezeTts/status 同验 */
export async function testStatusCompat(): Promise<TestResult[]> {
  const results: TestResult[] = [];
  await installGpuQueueBypass();

  installFetchStub((req) => {
    if (req.url === "http://127.0.0.1:5130/health") {
      return {
        status: 200,
        body: JSON.stringify({ status: "ok", model_loaded: true, engine: "breeze-tts-2" }),
      };
    }
    return { status: 404, body: "not found" };
  });

  let server: http.Server | null = null;
  try {
    const { default: oldStatusRouter } = await import("../../indextts2/status");
    const { default: breezeStatusRouter } = await import("../status");
    const app = express();
    app.use("/api/production/indextts2/status", oldStatusRouter);
    app.use("/api/production/breezeTts/status", breezeStatusRouter);
    const li = await listen(app);
    server = li.server;

    const oldResp = await getJson(li.port, "/api/production/indextts2/status/status");
    check(results, oldResp.status === 200, "旧端点 status/status → 200", `status=${oldResp.status}`);
    const oldEnv = JSON.parse(oldResp.body);
    check(results, oldEnv.code === 200 && oldEnv.data?.healthy === true
      && oldEnv.data?.model_loaded === true && oldEnv.data?.engine === "breeze-tts-2",
      "旧端点 status envelope {healthy, model_loaded, engine}", oldResp.body.slice(0, 200));

    const newResp = await getJson(li.port, "/api/production/breezeTts/status");
    check(results, newResp.status === 200, "breezeTts/status 单路径 → 200", `status=${newResp.status}`);
    const newEnv = JSON.parse(newResp.body);
    check(results, newEnv.data?.healthy === true && newEnv.data?.server_url === "http://127.0.0.1:5130",
      "breezeTts/status envelope {healthy, server_url}", newResp.body.slice(0, 200));

    // 探针降级态: health 挂 → 200 + healthy:false (查询语义, 不抛 5xx)
    installFetchStub(() => ({ status: 500, body: "boom" }));
    const downResp = await getJson(li.port, "/api/production/breezeTts/status/status");
    const downEnv = JSON.parse(downResp.body);
    check(results, downResp.status === 200 && downEnv.data?.healthy === false,
      "breeze :5130 挂 → 200 + healthy:false 降级态", downResp.body.slice(0, 200));
    check(results, legacyTrafficUrls().length === 0, "零 :5110/:5111/:8188 流量",
      legacyTrafficUrls().join(", "));
  } finally {
    if (server) await close(server);
    restoreFetch();
  }
  return results;
}

/** C5: 旧端点 /batch — 共享 ref 逐条 Breeze 克隆, 包络保持 */
export async function testOldBatchCompat(): Promise<TestResult[]> {
  const results: TestResult[] = [];
  await installGpuQueueBypass();

  // ref 走 /oss/ 相对路径解析 (写进 gitignored outputDir)
  const refPath = path.join(BREEZE_TTS_CONFIG.outputDir, "_test_batch_ref.wav");
  await fs.mkdir(BREEZE_TTS_CONFIG.outputDir, { recursive: true });
  await fs.writeFile(refPath, Buffer.from("RIFF-batch-ref"));

  installFetchStub((req) => {
    if (req.url === "http://127.0.0.1:5130/clone") {
      return { status: 200, body: FAKE_WAV };
    }
    return { status: 404, body: "not found" };
  });

  let server: http.Server | null = null;
  try {
    const { default: speakRouter } = await import("../../indextts2/speak");
    const app = express();
    app.use(express.json());
    app.use("/api/production/indextts2/speak", speakRouter);
    const li = await listen(app);
    server = li.server;

    const resp = await postJson(li.port, "/api/production/indextts2/speak/batch", {
      items: [{ text: "第一句", id: "a" }, { text: "第二句", id: "b" }],
      ref_audio: "/oss/tts/_test_batch_ref.wav",
    });

    check(results, resp.status === 200, "/batch → 200", `status=${resp.status} body=${resp.body.slice(0, 300)}`);
    const env = JSON.parse(resp.body);
    check(results, env.data?.total === 2 && env.data?.succeeded === 2 && env.data?.failed === 0,
      "batch 包络 {total, succeeded, failed}", resp.body.slice(0, 300));
    check(results, env.data?.items?.[0]?.status === "success"
      && String(env.data?.items?.[0]?.audio_url || "").startsWith("/oss/tts/"),
      "items[] {status, audio_url} 同形", JSON.stringify(env.data?.items || []).slice(0, 200));
    check(results, captured.length === 2
      && captured.every((c) => c.url === "http://127.0.0.1:5130/clone"),
      "逐条 2 次 :5130/clone", `requests: ${captured.map((c) => c.url).join(", ")}`);
    check(results, legacyTrafficUrls().length === 0, "零 :5110/:5111/:8188 流量",
      legacyTrafficUrls().join(", "));
  } finally {
    if (server) await close(server);
    await fs.unlink(refPath).catch(() => {});
    restoreFetch();
  }
  return results;
}
