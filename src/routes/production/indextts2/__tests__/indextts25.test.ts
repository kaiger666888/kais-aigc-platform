/**
 * indextts25.test.ts — VoiceDesign→IndexTTS 2.5 链路单测 (2026-08-16 Kai 决策)。
 *
 * Project convention (Pitfalls B3): no vitest/jest at repo root. Plain
 * TypeScript module exporting async test functions; the runnable entrypoint
 * is `scripts/verify-indextts25.ts` (tsx + assert() + results[] pattern,
 * mirrors verify-phase-28.ts).
 *
 * Coverage:
 * - config 字段: v25ServerUrl / voiceDesignUrl / v25OutputDir / defaults。
 * - voice-design Step 1 直连 :5111 /generate (不再构建 ComfyUI workflow)。
 * - speak v2.5 分支: multipart 代理 + 落盘 + JSON envelope。
 *
 * HTTP mock: 全局 fetch 打桩 (route 模块用的是裸 fetch, 无 DI seam —
 * stub globalThis.fetch + 直接调 router handler)。
 */

import express from "express";
import { INDEXTTS2_CONFIG, INDEXTTS2_DEFAULTS } from "../config";

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
    return {
      ok: out.status >= 200 && out.status < 300,
      status: out.status,
      headers: {
        get: (name: string) => out.headers?.[name.toLowerCase()] ?? null,
      },
      json: async () =>
        typeof out.body === "string" ? JSON.parse(out.body) : JSON.parse(out.body.toString("utf-8")),
      text: async () =>
        typeof out.body === "string" ? out.body : out.body.toString("utf-8"),
      arrayBuffer: async () =>
        (typeof out.body === "string" ? Buffer.from(out.body) : out.body)
          .buffer.slice(
            (typeof out.body === "string" ? Buffer.from(out.body) : out.body).byteOffset,
            (typeof out.body === "string" ? Buffer.from(out.body) : out.body).byteOffset +
              (typeof out.body === "string" ? Buffer.from(out.body) : out.body).length,
          ),
    } as any;
  };
}

function restoreFetch(): void {
  (globalThis as any).fetch = realFetch;
  captured.length = 0;
}

// ─── express app harness (真实 router, 不 mock express) ─────────────────────
// (suites 直接调 router.handle — 无需整 app 装配)

// GPU 队列旁路 — withGpuQueueTimed 锁内会 ensureVram (spawn nvidia-smi)。
// 测试环境无 nvidia-smi → getGpuStatus 返回 [] → ensureVram 放行 (模块
// 自带的容错路径), 无竞争时锁即时获取。只需跳过预检, 不 stub 模块导出
// (ES namespace 导出是 getter-only, 赋值会 TypeError)。
async function installGpuQueueBypass(): Promise<void> {
  process.env.KAP_VRAM_SKIP = "1";
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

/** T1: config 字段齐备 (v25ServerUrl / voiceDesignUrl / v25OutputDir) */
export async function testConfigFields(): Promise<TestResult[]> {
  const results: TestResult[] = [];
  check(results,
    INDEXTTS2_CONFIG.v25ServerUrl === "http://indextts25-server:5110",
    "config.v25ServerUrl default = http://indextts25-server:5110",
    `got ${INDEXTTS2_CONFIG.v25ServerUrl}`);
  check(results,
    INDEXTTS2_CONFIG.voiceDesignUrl === "http://voicedesign-server:5111",
    "config.voiceDesignUrl default = http://voicedesign-server:5111",
    `got ${INDEXTTS2_CONFIG.voiceDesignUrl}`);
  check(results,
    typeof INDEXTTS2_CONFIG.v25OutputDir === "string" && INDEXTTS2_CONFIG.v25OutputDir.length > 0,
    "config.v25OutputDir 非空 (voice-design/speak 落盘目录)",
    `got ${INDEXTTS2_CONFIG.v25OutputDir}`);
  check(results,
    INDEXTTS2_CONFIG.v25OutputDir.endsWith("/oss/tts"),
    "config.v25OutputDir 映射 /oss/tts 静态服务",
    `got ${INDEXTTS2_CONFIG.v25OutputDir}`);
  check(results, INDEXTTS2_DEFAULTS.defaultLang === "ZH", "defaults.defaultLang = ZH");
  check(results, INDEXTTS2_DEFAULTS.durationFactor === 1.0, "defaults.durationFactor = 1.0");
  return results;
}

/**
 * T2: voice-design Step 1 直连 :5111 /generate
 * (修复前构建 AILab ComfyUI workflow — 100% 失败路径; 修复后应只 POST
 *  voiceDesignUrl/generate + v25ServerUrl/speak 两个 HTTP 请求)
 */
export async function testVoiceDesignStep1Direct(): Promise<TestResult[]> {
  const results: TestResult[] = [];
  await installGpuQueueBypass();

  const fakeWav = Buffer.from("RIFF-fake-wav-bytes");
  const vdResponse = JSON.stringify({
    success: true, sr: 24000, duration: 2.5,
    audio_base64: fakeWav.toString("base64"),
  });

  installFetchStub((req) => {
    if (req.url.endsWith(":5111/generate")) {
      return { status: 200, body: vdResponse };
    }
    if (req.url.includes(":5110/api/production/indextts2/speak")) {
      return { status: 200, body: fakeWav, headers: { "x-synthesis-time": "1.234" } };
    }
    return { status: 404, body: "not found" };
  });

  try {
    const { default: vdRouter } = await import("../voice-design");
    const app = express();
    app.use(express.json());
    app.use("/", vdRouter);

    const resp = await new Promise<any>((resolve) => {
      const res: any = {
        statusCode: 200,
        status(code: number) { this.statusCode = code; return this; },
        json(payload: any) { resolve({ status: this.statusCode, json: payload }); return this; },
      };
      (vdRouter as any).handle(
        { method: "POST", url: "/voice-design", headers: { "content-type": "application/json" },
          body: {
            character_name: "阿毛", instruct: "约5岁男童", text: "你好世界",
            language: "Chinese", lang: "ZH", seed: 42,
          } } as any,
        res,
        () => resolve({ status: 500, json: { error: "unhandled" } }),
      );
    });

    check(results, resp.status === 200, "voice-design 链路 200",
      `status=${resp.status} body=${JSON.stringify(resp.json).slice(0, 300)}`);

    const urls = captured.map((c) => c.url);
    // Step 1 直连 :5111 /generate — 不再有 ComfyUI /prompt 提交
    const vdCall = urls.find((u) => u.endsWith(":5111/generate"));
    check(results, !!vdCall, "Step 1 POST voiceDesignUrl/generate (直连 :5111)",
      `requests: ${urls.join(", ")}`);
    check(results,
      !urls.some((u) => u.includes(":8188/prompt")),
      "不再 POST ComfyUI /prompt (AILab 插件路径已移除)",
      `requests: ${urls.join(", ")}`);
    // Step 2 走 v25ServerUrl
    check(results,
      urls.some((u) => u.includes("indextts25-server:5110/api/production/indextts2/speak")),
      "Step 2 POST v25ServerUrl/api/production/indextts2/speak",
      `requests: ${urls.join(", ")}`);
    // 修复前 bug: undefined/api/... (v25ServerUrl 缺失)
    check(results,
      !urls.some((u) => u.startsWith("undefined")),
      "无 undefined/... URL (v25ServerUrl 缺失 bug 已修)");

    // Step 1 请求体: {text: refText, instruct, language, seed}
    const vdBody = JSON.parse(String(captured[0].body));
    check(results, typeof vdBody.text === "string" && vdBody.text.length > 0,
      "VD 请求体 text=默认参考文本");
    check(results, vdBody.instruct === "约5岁男童", "VD 请求体 instruct 透传");
    check(results, vdBody.language === "Chinese", "VD 请求体 language 透传");
    check(results, vdBody.seed === 42, "VD 请求体 seed 透传 (新增字段)");

    // 响应 envelope
    const data = resp.json?.data || {};
    check(results,
      typeof data.synthesis?.audio_url === "string" && data.synthesis.audio_url.startsWith("/oss/tts/"),
      "响应 synthesis.audio_url = /oss/tts/...");
    check(results, data.voice_id?.startsWith("阿毛".replace(/[^a-zA-Z0-9一-鿿]/g, "_").toLowerCase()),
      "响应 voice_id 按角色名生成");
  } finally {
    restoreFetch();
  }
  return results;
}

/** T3: voice-design 校验逻辑保留 (400 分支) */
export async function testVoiceDesignValidation(): Promise<TestResult[]> {
  const results: TestResult[] = [];
  const { default: vdRouter } = await import("../voice-design");

  const runCase = (body: any) =>
    new Promise<any>((resolve) => {
      const res: any = {
        statusCode: 200,
        status(code: number) { this.statusCode = code; return this; },
        json(payload: any) { resolve({ status: this.statusCode, json: payload }); return this; },
      };
      (vdRouter as any).handle(
        { method: "POST", url: "/voice-design", headers: {}, body } as any,
        res,
        () => resolve({ status: 500, json: {} }),
      );
    });

  const missingName = await runCase({ instruct: "x", text: "y" });
  check(results, missingName.status === 400 && /character_name/.test(missingName.json?.message || ""),
    "缺 character_name → 400");
  const missingInstruct = await runCase({ character_name: "c", text: "y" });
  check(results, missingInstruct.status === 400 && /instruct/.test(missingInstruct.json?.message || ""),
    "缺 instruct → 400");
  const badEmotion = await runCase({
    character_name: "c", instruct: "i", text: "t", emotion_mode: "bogus",
  });
  check(results, badEmotion.status === 400 && /emotion_mode/.test(badEmotion.json?.message || ""),
    "非法 emotion_mode → 400");
  return results;
}

/** T4: speak v2.5 分支 — multipart version=2.5 代理 + JSON envelope */
export async function testSpeakV25Branch(): Promise<TestResult[]> {
  const results: TestResult[] = [];
  await installGpuQueueBypass();

  const fakeWav = Buffer.from("RIFF-v25-clone-bytes");

  installFetchStub((req) => {
    if (req.url.includes("indextts25-server:5110/api/production/indextts2/speak")) {
      return { status: 200, body: fakeWav, headers: { "x-synthesis-time": "3.5" } };
    }
    return { status: 404, body: "not found" };
  });

  try {
    const { default: speakRouter } = await import("../speak");

    // 模拟 multer 已消费后的 req 形态 (handler 顶部 multer 分支之后的逻辑)
    const resp = await new Promise<any>((resolve) => {
      const res: any = {
        statusCode: 200,
        status(code: number) { this.statusCode = code; return this; },
        json(payload: any) { resolve({ status: this.statusCode, json: payload }); return this; },
      };
      // 直接调用内部 handler: 构造 multipart 形态请求, 让 multer 真跑一遍太重 —
      // 走 JSON path 不行 (v2.5 multipart 才是 KMC 契约)。
      // 此处构造原始 multipart buffer + headers, 用 supertest 风格手动过 express。
      const busboyish = {
        method: "POST",
        url: "/speak",
        headers: { "content-type": "multipart/form-data" },
        body: { text: "台词", version: "2.5", lang: "ZH", duration_factor: "1.0", emo_text: "悲伤压抑" },
        file: { buffer: Buffer.from("REF-WAV"), originalname: "ref_阿毛.wav" },
        // multer.single 之后的 next() 直通 — 用桩跳过 multer
      };
      (speakRouter as any).handle(
        { ...busboyish, __skipMulter: true } as any,
        res,
        () => resolve({ status: 500, json: { message: "fell through" } }),
      );
    });

    check(results, resp.status === 200, "speak v2.5 → 200 JSON envelope",
      `status=${resp.status} body=${JSON.stringify(resp.json).slice(0, 300)}`);
    const data = resp.json?.data || {};
    check(results, data.version === "2.5", "envelope version=2.5");
    check(results, typeof data.audio_url === "string" && data.audio_url.startsWith("/oss/tts/"),
      "envelope audio_url=/oss/tts/... (写盘方案, 非二进制直返)");
    check(results, typeof data.audio_path === "string" && data.audio_path.length > 0,
      "envelope audio_path (绝对路径)");
    check(results, data.synthesis_time_s === 3.5, "X-Synthesis-Time 头透传为 synthesis_time_s");

    // 代理请求契约: multipart 到 :5110, 带 text/lang/duration_factor/emo_text
    const proxy = captured[0];
    check(results,
      proxy.url.includes("indextts25-server:5110/api/production/indextts2/speak"),
      "代理 POST v25ServerUrl/api/production/indextts2/speak",
      `got ${proxy.url}`);
    const proxyBody = proxy.body as Buffer;
    const bodyStr = proxyBody.toString("utf-8");
    check(results, /name="text"\r\n\r\n台词/.test(bodyStr), "multipart text 字段");
    check(results, /name="lang"\r\n\r\nZH/.test(bodyStr), "multipart lang 字段");
    check(results, /name="duration_factor"\r\n\r\n1(\.0)?/.test(bodyStr), "multipart duration_factor 字段");
    check(results, /name="emo_text"\r\n\r\n悲伤压抑/.test(bodyStr), "multipart emo_text 字段 (emotion_hint 链路)");
    check(results, /name="ref_audio"; filename="ref_阿毛\.wav"/.test(bodyStr), "multipart ref_audio 文件透传");
  } finally {
    restoreFetch();
  }
  return results;
}

/** T5: speak version=2 (legacy ComfyUI) 路径全保留 — version=2 时走旧分支 */
export async function testSpeakV2Preserved(): Promise<TestResult[]> {
  const results: TestResult[] = [];
  await installGpuQueueBypass();

  installFetchStub((req) => {
    // ComfyUI prompt 提交 → 立即成功 history
    if (req.url.includes(":8188/prompt")) {
      return { status: 200, body: JSON.stringify({ prompt_id: "pid-legacy" }) };
    }
    if (req.url.includes(":8188/history/")) {
      return {
        status: 200,
        body: JSON.stringify({
          "pid-legacy": {
            status: { status_str: "success" },
            outputs: { "4": { audio: [{ filename: "legacy.wav", subfolder: "", type: "output" }] } },
          },
        }),
      };
    }
    if (req.url.includes(":8188/upload/image")) {
      return { status: 200, body: JSON.stringify({ name: "ref_123.wav", subfolder: "" }) };
    }
    return { status: 404, body: "not found" };
  });

  try {
    const { default: speakRouter } = await import("../speak");
    const resp = await new Promise<any>((resolve) => {
      const res: any = {
        statusCode: 200,
        status(code: number) { this.statusCode = code; return this; },
        json(payload: any) { resolve({ status: this.statusCode, json: payload }); return this; },
      };
      (speakRouter as any).handle(
        { method: "POST", url: "/speak", headers: { "content-type": "multipart/form-data" },
          body: { text: "旧链路", version: "2" },
          file: { buffer: Buffer.from("REF"), originalname: "ref.wav" },
        } as any,
        res,
        () => resolve({ status: 500, json: { message: "fell through" } }),
      );
    });

    check(results,
      captured.some((c) => c.url.includes(":8188/prompt")),
      "version=2 仍走 ComfyUI /prompt (legacy 路径保留)",
      `requests: ${captured.map((c) => c.url).join(", ")}`);
    check(results,
      !captured.some((c) => c.url.includes(":5110")),
      "version=2 不打 :5110");
    check(results, resp.json?.data?.audio_filename === "legacy.wav",
      "version=2 响应带 ComfyUI 产物 filename");
  } finally {
    restoreFetch();
  }
  return results;
}

// (helper removed — shadowing global JSON broke JSON.stringify)
