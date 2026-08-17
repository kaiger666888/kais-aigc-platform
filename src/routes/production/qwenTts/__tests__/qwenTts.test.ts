/**
 * qwenTts.test.ts — qwenTts / v1-tts 两阶段异步 + GPU 队列预算/orphan 单测 (2026-08-17)。
 *
 * Project convention (Pitfalls B3): no vitest/jest at repo root. Plain
 * TypeScript module exporting async test functions; the runnable entrypoint
 * is `scripts/verify-qwen-tts.ts` (tsx + check()/results[] pattern,
 * mirrors verify-indextts25.ts / indextts25.test.ts)。
 *
 * 被测对象 (commits 722ee985 / d0480dbc / 2da9d455):
 * - src/routes/production/qwenTts/speak.ts + status.ts (两阶段异步 speak/status)
 * - src/routes/v1/tts/speak.ts + status.ts (独立实现的同款两阶段链路)
 * - src/lib/gpuVramManager.ts (withGpuQueueTimed / withGpuQueue / ensureVram)
 *
 * 契约清单 (从实现提炼, 不发明):
 *  ① speak {async:true | X-KAP-Async:1} → 提交成功即 202 {prompt_id, queue_wait_ms,
 *     status_url}, 不做任何 /history 轮询 (两阶段); GPU 队列只保提交段。
 *  ② status GET /:promptId 直读 ComfyUI history: pending/running/success(含
 *     audio_url/audio_path)/error; ComfyUI 异常 → 502。
 *  ③ queue wait 不计入 job 预算: pollUntilDone(pid, queueWaitMs) — 预算 =
 *     pollTimeoutMs + queueWaitMs (错误消息 "Timeout after Ns" 的 N 可证)。
 *  ④ 超时弃单后 orphan cleanup: POST /queue {"delete":[promptId]}。
 *  ⑤ pollTimeoutMs env 可配置 (QWEN_TTS_POLL_TIMEOUT_MS, 默认 600s)。
 *  ⑥ vram 预检 fail-fast: 不足 → /free 驱逐 → 复查 → 仍不足 → 503
 *     vram_insufficient (结构化 kind/engine/freeMiB/requiredMiB/gpuIndex)。
 *
 * 隔离手法 (照 indextts25):
 * - 全局 fetch 打桩 — 不发真 HTTP;
 * - 主进程 KAP_VRAM_SKIP=1 — ensureVram 直接放行, 不 spawn 真 nvidia-smi、
 *   不碰真 GPU 状态; lib 级锁测试用独立 gpuIndex=42, 不与路由用的 GPU1 互相干扰;
 * - 需要真实 ensureVram / pollTimeoutMs 覆盖 / KAP_GPU_QUEUE_TIMEOUT_MS 的场景
 *   (env 均在模块加载时读取) 通过 spawn 子进程跑: 本文件以
 *   KAP_TEST_SCENARIO=<name> 直接执行时进入 child 模式, 输出
 *   ###CHILD-RESULT###<json> 由父进程断言。子进程用 fake nvidia-smi (PATH 注入)。
 */

import express from "express";
import http from "http";
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

// 主进程跳过显存预检 (ensureVram 在调用时读取本变量 — 模块加载顺序无碍)。
// 需要 ensureVram 真实分支的 child scenario 会在自己进程里 delete 它。
process.env.KAP_VRAM_SKIP = "1";

import {
  withGpuQueueTimed,
  withGpuQueue,
  ensureVram,
  ENGINE_VRAM_REQUIREMENTS,
  getGpuQueueStatus,
} from "@/lib/gpuVramManager";
import { QWEN_TTS_CONFIG, NODE_TYPES } from "../config";
import qwenSpeakRouter from "../speak";
import qwenStatusRouter from "../status";
import { TTS_CONFIG } from "../../../v1/tts/config";
import v1SpeakRouter from "../../../v1/tts/speak";
import v1StatusRouter from "../../../v1/tts/status";

// ─── 基建 ────────────────────────────────────────────────────────────────────

export interface TestResult {
  name: string;
  pass: boolean;
  detail?: string;
}

function check(results: TestResult[], cond: boolean, name: string, detail?: string): void {
  results.push({ name, pass: cond, detail: cond ? undefined : detail });
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// ─── fetch stub (同 indextts25 手法) ─────────────────────────────────────────

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
  captured.length = 0;
  (globalThis as any).fetch = async (url: any, init: any = {}) => {
    const req: CapturedRequest = {
      url: String(url),
      method: init.method || "GET",
      headers: (init.headers as Record<string, string>) || {},
      body: init.body,
    };
    captured.push(req);
    const out = handler(req); // handler throw → 本 async fn reject (模拟网络失败)
    return {
      ok: out.status >= 200 && out.status < 300,
      status: out.status,
      headers: { get: (name: string) => out.headers?.[name.toLowerCase()] ?? null },
      json: async () =>
        typeof out.body === "string" ? JSON.parse(out.body) : JSON.parse(out.body.toString("utf-8")),
      text: async () => (typeof out.body === "string" ? out.body : out.body.toString("utf-8")),
    } as any;
  };
}

function restoreFetch(): void {
  (globalThis as any).fetch = realFetch;
  captured.length = 0;
}

const countReq = (pred: (c: CapturedRequest) => boolean): number => captured.filter(pred).length;

// ─── router 直驱 harness (同 indextts25: 真实 express Router, 不 mock express) ─

interface DriveResponse {
  status: number;
  json: any;
}

async function drive(
  router: unknown,
  method: string,
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<DriveResponse> {
  const hdrs: Record<string, string> = { "content-type": "application/json", ...headers };
  const resp = await new Promise<DriveResponse>((resolve) => {
    const res: any = {
      statusCode: 200,
      status(code: number) { this.statusCode = code; return this; },
      json(payload: any) { resolve({ status: this.statusCode, json: payload }); return this; },
    };
    (router as any).handle(
      {
        method,
        url,
        headers: hdrs,
        body,
        // express req.header(name) — 大小写不敏感查表 (speak.ts 读 X-KAP-Async)
        header(name: string) { return hdrs[name.toLowerCase()] ?? hdrs[name]; },
        get(name: string) { return hdrs[name.toLowerCase()] ?? hdrs[name]; },
      } as any,
      res,
      () => resolve({ status: 404, json: { message: "fell through" } }),
    );
  });
  // res.json 在 GPU 锁内被调用; 让 finally release 跑完再返回, 避免下一用例排队残留
  await sleep(30);
  return resp;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

/** T1: config 契约 — pollTimeoutMs 默认 600s / env 可覆盖变量名 / 需求表 */
export async function testConfigContract(): Promise<TestResult[]> {
  const results: TestResult[] = [];
  const envOverride = process.env.QWEN_TTS_POLL_TIMEOUT_MS !== undefined;
  check(results,
    QWEN_TTS_CONFIG.pollTimeoutMs === 600_000 && !envOverride,
    "qwenTts pollTimeoutMs 默认 600_000ms (旧 300s 已升, P10 实测 361-374s)",
    `got ${QWEN_TTS_CONFIG.pollTimeoutMs}${envOverride ? " (env 已覆盖, 本机 QWEN_TTS_POLL_TIMEOUT_MS=" + process.env.QWEN_TTS_POLL_TIMEOUT_MS + ")" : ""}`);
  check(results, QWEN_TTS_CONFIG.pollIntervalMs === 1500,
    "qwenTts pollIntervalMs = 1500ms");
  check(results,
    TTS_CONFIG.pollTimeoutMs === 600_000 && !envOverride,
    "v1/tts pollTimeoutMs 默认 600_000ms (与 qwenTts 同读 QWEN_TTS_POLL_TIMEOUT_MS)");
  check(results,
    ENGINE_VRAM_REQUIREMENTS.qwen_tts === 8192,
    "ENGINE_VRAM_REQUIREMENTS.qwen_tts = 8192MiB (预检阈值)");
  check(results,
    ENGINE_VRAM_REQUIREMENTS.minimax_h3 === 18432,
    "ENGINE_VRAM_REQUIREMENTS.minimax_h3 = 18432MiB (跨引擎互斥参与方)");
  check(results,
    QWEN_TTS_CONFIG.outputDir === "/mnt/agents/output/gpu1",
    "outputDir = /mnt/agents/output/gpu1 (audio_path 拼接基準)");
  check(results,
    NODE_TYPES.VOICE_DESIGN === "AILab_Qwen3TTSVoiceDesign" &&
    NODE_TYPES.VOICE_CLONE === "AILab_Qwen3TTSVoiceClone" &&
    NODE_TYPES.CUSTOM_VOICE === "AILab_Qwen3TTSCustomVoice",
    "NODE_TYPES 三模式 ComfyUI 节点名");
  return results;
}

/**
 * T2: GPU 队列原语 (lib 级, 独立 gpuIndex=42 + skipVram — 不碰真 GPU/真预检)。
 * 契约: FIFO 串行 / queueWaitMs 传给 fn / fn 抛错必释放锁 / 嵌套直通 /
 * withGpuQueue 兼容签名丢弃计时。
 */
const TEST_GPU = 42;

export async function testGpuQueuePrimitives(): Promise<TestResult[]> {
  const results: TestResult[] = [];
  const opts = { gpuIndex: TEST_GPU, skipVram: true };

  // 1) 无竞争: 即时获得, queueWaitMs≈0, fn 实参 === queueWaitMs
  const free = await withGpuQueueTimed("engine_free", async (waitedMs) => waitedMs, opts);
  check(results, free.queueWaitMs === free.data && free.queueWaitMs < 100,
    "无竞争: queueWaitMs≈0 且 fn 实参 === queueWaitMs",
    `queueWaitMs=${free.queueWaitMs} fnArg=${free.data}`);

  // 2) FIFO 串行 + 等待计时: A 持锁 250ms, B 排队 → B 的 fn 拿到 ≈220ms 等待
  const holdA = withGpuQueueTimed("engine_a", async () => {
    await sleep(250);
    return "a-done";
  }, opts);
  await sleep(30); // 保证 A 先获得锁
  const bPromise = withGpuQueueTimed("engine_b", async (waitedMs) => waitedMs, opts);
  const aData = await holdA;
  const bOut = await bPromise;
  check(results, aData.data === "a-done", "FIFO: 持锁者 A 正常完成");
  check(results,
    bOut.data >= 180 && bOut.data <= 5000,
    "FIFO: B 排队等待 A 释放, fn 收到排队耗时 (≥180ms)",
    `waitedMs=${bOut.data}`);
  check(results, bOut.queueWaitMs === bOut.data,
    "GpuQueueResult.queueWaitMs === fn 收到的实参 (调用方据此延长 poll 预算)");
  const evts = getGpuQueueStatus().recentEvents;
  const bAcq = evts.find((e) => e.event === "acquire" && e.engine === "engine_b");
  check(results, !!bAcq && (bAcq?.waitMs ?? 0) >= 180,
    "事件观测: engine_b acquire 事件带 waitMs (gpu-queue 端点数据源)");

  // 3) fn 抛错 → 锁必须释放 (finally 兜底), 后续作业不死锁
  let threw = false;
  try {
    await withGpuQueueTimed("engine_x", async () => { throw new Error("boom"); }, opts);
  } catch { threw = true; }
  check(results, threw, "fn 抛错 → withGpuQueueTimed reject (错误上抛调用方)");
  const after = await withGpuQueueTimed("engine_y", async (w) => w, opts);
  check(results, after.queueWaitMs < 100 && after.data === after.queueWaitMs,
    "fn 抛错后锁已释放 — 后续作业即时获得 (无死锁)",
    `queueWaitMs=${after.queueWaitMs}`);

  // 4) 嵌套直通 (AsyncLocalStorage): 同一异步上下文再次入队直接放行, fn(0)
  const outer = await withGpuQueueTimed("engine_outer", async () => {
    const inner = await Promise.race([
      withGpuQueueTimed("engine_inner", async (w) => w, opts),
      sleep(3000).then(() => ({ data: "NESTED-TIMEOUT", queueWaitMs: -1 })),
    ]);
    return inner as { data: unknown; queueWaitMs: number };
  }, opts);
  check(results, outer.data.data === 0 && outer.data.queueWaitMs === 0,
    "嵌套 withGpuQueueTimed 直通 (不重新排队, queueWaitMs=0)",
    `inner=${JSON.stringify(outer.data)}`);

  // 5) withGpuQueue 向后兼容签名: 返回裸 data (13 处既有调用点)
  const wrapped = await withGpuQueue("engine_compat", async () => 42, opts);
  check(results, wrapped === 42,
    "withGpuQueue 兼容签名返回裸 data (丢弃计时元数据)");

  // 6) ensureVram 跳过逃生口 (主进程隔离手法本身也是契约)
  const skipped = await ensureVram("qwen_tts", 1, QWEN_TTS_CONFIG.comfyuiUrl);
  check(results,
    skipped.freeMiB === -1 && skipped.requiredMiB === 8192 && skipped.evicted === false,
    "ensureVram KAP_VRAM_SKIP=1 → {freeMiB:-1, requiredMiB:8192, evicted:false} 直接放行");

  // 7) 队列空闲态 + 获取顺序约定
  const st = getGpuQueueStatus();
  check(results, st.holders[TEST_GPU] === null,
    "全部作业完成后 holders[42] = null (锁已释放)");
  const sortedKeys = Object.keys(ENGINE_VRAM_REQUIREMENTS).sort();
  check(results,
    JSON.stringify(st.engineOrder) === JSON.stringify(sortedKeys),
    "engineOrder = ENGINE_VRAM_REQUIREMENTS 键排序 (多锁防死锁约定)");
  return results;
}

/**
 * T3: speak 两阶段契约 ① — async 提交即 202, 不轮询 /history,
 * envelope 带 prompt_id / queue_wait_ms / status_url; 工作流透传。
 */
export async function testSpeakAsyncTwoPhase(): Promise<TestResult[]> {
  const results: TestResult[] = [];
  installFetchStub((req) => {
    if (req.method === "POST" && req.url.endsWith("/prompt")) {
      return { status: 200, body: JSON.stringify({ prompt_id: "pid-async-1" }) };
    }
    return { status: 404, body: "nope" };
  });

  try {
    const resp = await drive(qwenSpeakRouter, "POST", "/speak", {
      mode: "custom_voice", text: "你好世界", async: true,
    });
    check(results, resp.status === 202,
      "async:true → HTTP 202 (提交即返回, 不等合成)",
      `status=${resp.status} body=${JSON.stringify(resp.json).slice(0, 200)}`);
    const data = resp.json?.data || {};
    check(results, data.prompt_id === "pid-async-1", "envelope prompt_id (ComfyUI 提交回执)");
    check(results, typeof data.queue_wait_ms === "number" && data.queue_wait_ms >= 0,
      "envelope queue_wait_ms 数值 (客户端据此延长自己的预算)",
      `got ${JSON.stringify(data.queue_wait_ms)}`);
    check(results, data.status_url === "/api/production/qwenTts/status/pid-async-1",
      "envelope status_url 指向两段式轮询端点",
      `got ${data.status_url}`);
    check(results, data.mode === "custom_voice", "envelope mode 透传");
    check(results, resp.json?.code === 200, "响应体是 success envelope {code:200,...}");
    check(results,
      countReq((c) => c.method === "POST" && c.url.endsWith("/prompt")) === 1,
      "两阶段: 恰好 1 次 POST /prompt (锁内提交)");
    check(results,
      countReq((c) => c.url.includes("/history/")) === 0,
      "两阶段: 0 次 /history 轮询 (poll 留给 status 端点)");

    const promptBody = JSON.parse(String(captured.find((c) => c.url.endsWith("/prompt"))?.body));
    const node1 = promptBody.prompt["1"];
    check(results, node1.class_type === "AILab_Qwen3TTSCustomVoice",
      "工作流 Node1 = AILab_Qwen3TTSCustomVoice (custom_voice 模式)");
    check(results, node1.inputs.text === "你好世界" && node1.inputs.speaker === "Eric",
      "工作流透传 text + 默认 speaker=Eric");

    // X-KAP-Async: 1 header 等价契约
    const hdrResp = await drive(qwenSpeakRouter, "POST", "/speak", {
      mode: "custom_voice", text: "hdr",
    }, { "X-KAP-Async": "1" });
    check(results, hdrResp.status === 202 && hdrResp.json?.data?.status_url?.includes("/status/"),
      "header X-KAP-Async:1 等价触发 202 两阶段",
      `status=${hdrResp.status}`);

    // voice_design 模式工作流
    await drive(qwenSpeakRouter, "POST", "/speak", {
      mode: "voice_design", text: "台词", instruct: "温柔女声", async: true,
    });
    const vdPrompt = JSON.parse(String(captured.filter((c) => c.url.endsWith("/prompt")).pop()?.body));
    check(results,
      vdPrompt.prompt["1"].class_type === "AILab_Qwen3TTSVoiceDesign" &&
      vdPrompt.prompt["1"].inputs.instruct === "温柔女声",
      "voice_design 工作流: AILab_Qwen3TTSVoiceDesign + instruct 透传");
  } finally {
    restoreFetch();
  }
  return results;
}

/** T4: speak 同步 (一阶段 legacy) — 锁内轮询到 success, 提取音频产物 */
export async function testSpeakSyncPoll(): Promise<TestResult[]> {
  const results: TestResult[] = [];
  installFetchStub((req) => {
    if (req.method === "POST" && req.url.endsWith("/prompt")) {
      return { status: 200, body: JSON.stringify({ prompt_id: "pid-sync-1" }) };
    }
    if (req.url.includes("/history/")) {
      return {
        status: 200,
        body: JSON.stringify({
          "pid-sync-1": {
            status: { status_str: "success" },
            outputs: { "9": { audio: [{ filename: "qwen_out.wav", subfolder: "sfx", type: "temp" }] } },
          },
        }),
      };
    }
    return { status: 404, body: "nope" };
  });

  try {
    const resp = await drive(qwenSpeakRouter, "POST", "/speak", {
      mode: "custom_voice", text: "同步一阶段",
    });
    check(results, resp.status === 200,
      "同步模式: 轮询到 success → 200 出片",
      `status=${resp.status} body=${JSON.stringify(resp.json).slice(0, 250)}`);
    const data = resp.json?.data || {};
    check(results, data.prompt_id === "pid-sync-1", "同步 envelope prompt_id");
    check(results, data.audio_filename === "qwen_out.wav", "audio_filename 从 outputs 提取");
    check(results,
      data.audio_path === path.join(QWEN_TTS_CONFIG.outputDir, "qwen_out.wav"),
      "audio_path = outputDir + filename");
    check(results,
      data.audio_url === `${QWEN_TTS_CONFIG.comfyuiHostUrl}/view?filename=qwen_out.wav&subfolder=sfx&type=temp`,
      "audio_url = comfyuiHostUrl /view?filename=&subfolder=&type= (含编码)",
      `got ${data.audio_url}`);
    check(results, countReq((c) => c.url.includes("/history/")) >= 1,
      "同步模式至少 1 次 /history 轮询 (与两阶段的 0 次相对)");
  } finally {
    restoreFetch();
  }
  return results;
}

/** T5: speak 入参校验 (400 分支, 纯逻辑不发出 HTTP) */
export async function testSpeakValidation(): Promise<TestResult[]> {
  const results: TestResult[] = [];
  installFetchStub(() => ({ status: 500, body: "should-not-be-called" }));
  try {
    const noText = await drive(qwenSpeakRouter, "POST", "/speak", { mode: "custom_voice" });
    check(results, noText.status === 400 && /text/.test(noText.json?.message || ""),
      "缺 text → 400");
    const noMode = await drive(qwenSpeakRouter, "POST", "/speak", { text: "x" });
    check(results, noMode.status === 400 && /mode/.test(noMode.json?.message || ""),
      "缺 mode → 400");
    const noInstruct = await drive(qwenSpeakRouter, "POST", "/speak", { mode: "voice_design", text: "x" });
    check(results, noInstruct.status === 400 && /instruct/.test(noInstruct.json?.message || ""),
      "voice_design 缺 instruct → 400");
    const noRef = await drive(qwenSpeakRouter, "POST", "/speak", { mode: "voice_clone", text: "x" });
    check(results, noRef.status === 400 && /ref_audio/.test(noRef.json?.message || ""),
      "voice_clone 缺 ref_audio → 400");
    const badMode = await drive(qwenSpeakRouter, "POST", "/speak", { mode: "bogus", text: "x" });
    check(results, badMode.status === 500 && /Unknown mode/.test(badMode.json?.message || ""),
      "未知 mode → 500 Unknown mode");
    const noItems = await drive(qwenSpeakRouter, "POST", "/batch", {});
    check(results, noItems.status === 400 && /items/.test(noItems.json?.message || ""),
      "batch 缺 items/mode → 400");
    const tooMany = await drive(qwenSpeakRouter, "POST", "/batch", {
      mode: "custom_voice",
      items: Array.from({ length: 51 }, (_, i) => ({ text: `t${i}` })),
    });
    check(results, tooMany.status === 400 && /50/.test(tooMany.json?.message || ""),
      "batch > 50 条 → 400 上限拦截");
    check(results, captured.length === 0,
      "校验失败路径不发出任何上游 HTTP 请求",
      `captured=${captured.map((c) => c.url).join(",")}`);
  } finally {
    restoreFetch();
  }
  return results;
}

/** T6: status 两段式轮询生命周期 (契约 ②) — pending/running/success/error/502 */
export async function testStatusLifecycle(): Promise<TestResult[]> {
  const results: TestResult[] = [];
  const historyFor = (pid: string, entry: unknown) =>
    installFetchStub((req) => {
      if (req.url.includes(`/history/${pid}`)) {
        return { status: 200, body: JSON.stringify({ [pid]: entry }) };
      }
      return { status: 404, body: "nope" };
    });

  try {
    // pending: history 无该 prompt 条目 (还在 ComfyUI 队列未执行, /history 整体 {})
    installFetchStub((req) => {
      if (req.url.includes("/history/pid-p")) return { status: 200, body: JSON.stringify({}) };
      return { status: 404, body: "nope" };
    });
    let resp = await drive(qwenStatusRouter, "GET", "/pid-p", undefined);
    check(results, resp.status === 200 && resp.json?.data?.status === "pending",
      "history 无条目 → status=pending (客户端继续轮询)",
      JSON.stringify(resp.json).slice(0, 200));

    // running: status_str=executing
    historyFor("pid-r", { status: { status_str: "executing" } });
    resp = await drive(qwenStatusRouter, "GET", "/pid-r", undefined);
    check(results, resp.json?.data?.status === "running",
      "status_str=executing → status=running");

    // success: 提取音频产物 (与 /speak 同构)
    historyFor("pid-s", {
      status: { status_str: "success" },
      outputs: { "9": { audio: [{ filename: "a.wav", subfolder: "", type: "output" }] } },
    });
    resp = await drive(qwenStatusRouter, "GET", "/pid-s", undefined);
    const sd = resp.json?.data || {};
    check(results, sd.status === "success" && sd.audio_filename === "a.wav",
      "success → status=success + audio_filename (轮询到产物)");
    check(results,
      sd.audio_url === `${QWEN_TTS_CONFIG.comfyuiHostUrl}/view?filename=a.wav&subfolder=&type=output`,
      "success → audio_url /view 直链");
    check(results,
      sd.audio_path === path.join(QWEN_TTS_CONFIG.outputDir, "a.wav"),
      "success → audio_path 落盘路径");

    // success 但无音频节点 → error
    historyFor("pid-s2", { status: { status_str: "success" }, outputs: {} });
    resp = await drive(qwenStatusRouter, "GET", "/pid-s2", undefined);
    check(results,
      resp.json?.data?.status === "error" && /no audio output/.test(resp.json?.data?.error || ""),
      "success 但无 audio 输出节点 → status=error");

    // workflow error
    historyFor("pid-e", { status: { status_str: "error", messages: [["execution_error", "boom"]] } });
    resp = await drive(qwenStatusRouter, "GET", "/pid-e", undefined);
    check(results,
      resp.json?.data?.status === "error" && /boom/.test(resp.json?.data?.error || ""),
      "status_str=error → status=error + messages 透传");

    // ComfyUI history 非 200 → 502
    installFetchStub(() => ({ status: 500, body: "comfy down" }));
    resp = await drive(qwenStatusRouter, "GET", "/pid-502", undefined);
    check(results, resp.status === 502 && /history responded 500/.test(resp.json?.message || ""),
      "ComfyUI history 5xx → HTTP 502");

    // fetch 网络失败 → 502 unreachable
    installFetchStub(() => { throw new Error("connect ECONNREFUSED"); });
    resp = await drive(qwenStatusRouter, "GET", "/pid-net", undefined);
    check(results, resp.status === 502 && /ComfyUI unreachable/.test(resp.json?.message || ""),
      "ComfyUI 不可达 → HTTP 502 unreachable");
  } finally {
    restoreFetch();
  }

  // 健康检查 GET / (契约次要面: plugin_loaded + poll_timeout 暴露)
  installFetchStub((req) => {
    if (req.url.endsWith("/system_stats")) return { status: 200, body: JSON.stringify({ foo: 1 }) };
    if (req.url.endsWith("/object_info")) {
      return { status: 200, body: JSON.stringify({ AILab_Qwen3TTSVoiceDesign: {} }) };
    }
    return { status: 404, body: "nope" };
  });
  try {
    const resp = await drive(qwenStatusRouter, "GET", "/", undefined);
    const data = resp.json?.data || {};
    check(results, data.comfyui?.status === "online", "健康检查 comfyui=online");
    check(results, data.plugin_loaded === true, "健康检查 plugin_loaded (AILab 节点已注册)");
    check(results,
      data.config?.poll_timeout === `${QWEN_TTS_CONFIG.pollTimeoutMs / 1000}s`,
      "健康检查暴露 poll_timeout 配置");
  } finally {
    restoreFetch();
  }
  return results;
}

// ─── T7: app 级挂载拓扑 — 两阶段闭环 (202 的 status_url 是活路径) ────────────

interface HttpResponse {
  status: number;
  body: string;
}

function httpReq(port: number, method: string, reqPath: string, body?: unknown): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: reqPath,
        method,
        headers: payload
          ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) }
          : {},
      },
      (res) => {
        let data = "";
        res.on("data", (chunk: string) => { data += chunk; });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data }));
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

export async function testAppMountTwoPhase(): Promise<TestResult[]> {
  const results: TestResult[] = [];
  installFetchStub((req) => {
    if (req.method === "POST" && req.url.endsWith("/prompt")) {
      return { status: 200, body: JSON.stringify({ prompt_id: "pid-mount-1" }) };
    }
    if (req.url.includes("/history/")) return { status: 200, body: JSON.stringify({}) };
    return { status: 404, body: "nope" };
  });

  const app = express();
  app.use(express.json());
  // 与 src/router.ts:229-230 完全相同的挂载形态 — 这正是被验证的对象
  app.use("/api/production/qwenTts/speak", qwenSpeakRouter);
  app.use("/api/production/qwenTts/status", qwenStatusRouter);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;

  try {
    // 两阶段闭环: 202 → status_url → 轮询 pending
    const speakResp = await httpReq(port, "POST", "/api/production/qwenTts/speak/speak", {
      mode: "custom_voice", text: "闭环", async: true,
    });
    const speakJson = JSON.parse(speakResp.body);
    check(results, speakResp.status === 202 && speakJson.data?.prompt_id === "pid-mount-1",
      "app 挂载级: POST /api/production/qwenTts/speak/speak → 202",
      `status=${speakResp.status} body=${speakResp.body.slice(0, 200)}`);

    const statusUrl: string = speakJson.data?.status_url;
    const stResp = await httpReq(port, "GET", statusUrl);
    const stJson = JSON.parse(stResp.body);
    check(results,
      stResp.status === 200 && stJson.data?.status === "pending" && stJson.data?.prompt_id === "pid-mount-1",
      "两阶段闭环: 202 返回的 status_url 是活路径 → GET 得 pending",
      `status=${stResp.status} body=${stResp.body.slice(0, 200)}`);
    check(results,
      countReq((c) => c.url.includes("/history/pid-mount-1")) >= 1,
      "status 端点真读 ComfyUI history (非 canned 响应)");

    // 挂载拓扑现状: 单路径根 POST 404 (indextts2 已做根兼容 0cc5d2ab, qwenTts 未做 — 见报告)
    const root = await httpReq(port, "POST", "/api/production/qwenTts/speak", {
      mode: "custom_voice", text: "x", async: true,
    });
    check(results, root.status === 404,
      "现状记录: 单路径根 POST /qwenTts/speak → 404 (无 indextts2 式根兼容)",
      `status=${root.status}`);

    const unknown = await httpReq(port, "POST", "/api/production/qwenTts/speak/nope", {});
    check(results, unknown.status === 404,
      "未知子路径 /speak/nope → 404 (未吞命名空间)");
  } finally {
    restoreFetch();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  return results;
}

/** T8: v1/tts 两阶段 (独立实现, 同款契约) — 202/status/zod 校验/engine gate */
export async function testV1TtsTwoPhase(): Promise<TestResult[]> {
  const results: TestResult[] = [];
  installFetchStub((req) => {
    if (req.url.endsWith("/object_info")) {
      return { status: 200, body: JSON.stringify({ AILab_Qwen3TTSCustomVoice: {}, AILab_Qwen3TTSVoiceClone: {} }) };
    }
    if (req.method === "POST" && req.url.endsWith("/prompt")) {
      return { status: 200, body: JSON.stringify({ prompt_id: "pid-v1-1" }) };
    }
    return { status: 404, body: "nope" };
  });

  try {
    // 两阶段 202
    const resp = await drive(v1SpeakRouter, "POST", "/", { text: "你好", async: true });
    check(results, resp.status === 202,
      "v1/tts async:true → 202 提交即返回",
      `status=${resp.status} body=${JSON.stringify(resp.json).slice(0, 200)}`);
    const data = resp.json?.data || {};
    check(results, data.prompt_id === "pid-v1-1", "v1 envelope prompt_id");
    check(results,
      data.status_url === "/api/v1/tts/status/pid-v1-1",
      "v1 envelope status_url 指向 v1 轮询端点");
    check(results, data.mode === "custom_voice", "v1 无 mode/track → 默认映射 custom_voice");
    check(results, typeof data.queue_wait_ms === "number", "v1 envelope queue_wait_ms");
    check(results, countReq((c) => c.url.includes("/history/")) === 0,
      "v1 两阶段: 0 次 /history 轮询");
    const promptIdx = captured.findIndex((c) => c.method === "POST" && c.url.endsWith("/prompt"));
    check(results,
      promptIdx > 0 && captured.slice(0, promptIdx).every((c) => c.url.includes("/object_info")),
      "v1 engine gate: object_info 预检先于 /prompt 提交");

    // 旧 track 兼容映射
    await drive(v1SpeakRouter, "POST", "/", { text: "x", track: "clone", ref_audio: "ref.wav", async: true });
    const clonePrompt = JSON.parse(String(captured.filter((c) => c.url.endsWith("/prompt")).pop()?.body));
    check(results,
      clonePrompt.prompt["1"].class_type === "LoadAudio" &&
      clonePrompt.prompt["2"].class_type === "AILab_Qwen3TTSVoiceClone",
      "v1 track=clone + ref_audio → voice_clone 工作流");

    // zod 校验
    const tooLong = await drive(v1SpeakRouter, "POST", "/", { text: "x".repeat(5001) });
    check(results, tooLong.status === 400, "v1 text>5000 → zod 400");
    const badMode = await drive(v1SpeakRouter, "POST", "/", { text: "x", mode: "bogus" });
    check(results, badMode.status === 400, "v1 非法 mode → zod 400");
  } finally {
    restoreFetch();
  }

  // engine gate: 节点未注册 → 503 engine_unavailable (fail-fast, 不进队列)
  installFetchStub((req) => {
    if (req.url.endsWith("/object_info")) return { status: 200, body: JSON.stringify({}) };
    return { status: 404, body: "nope" };
  });
  try {
    const resp = await drive(v1SpeakRouter, "POST", "/", { text: "x" });
    check(results,
      resp.status === 503 && resp.json?.data?.error?.kind === "engine_unavailable",
      "v1 节点未注册 → 503 engine_unavailable (KMC 侧 fail-fast 信号)",
      `status=${resp.status} body=${JSON.stringify(resp.json).slice(0, 200)}`);
    check(results, countReq((c) => c.url.endsWith("/prompt")) === 0,
      "engine gate 拦截后不提交 /prompt");
  } finally {
    restoreFetch();
  }

  // v1 status 端点: pending + success
  installFetchStub((req) => {
    if (req.url.includes("/history/pid-v1-p")) return { status: 200, body: JSON.stringify({}) };
    if (req.url.includes("/history/pid-v1-s")) {
      return {
        status: 200,
        body: JSON.stringify({
          "pid-v1-s": {
            status: { status_str: "success" },
            outputs: { "9": { audio: [{ filename: "v1.wav", subfolder: "", type: "output" }] } },
          },
        }),
      };
    }
    return { status: 404, body: "nope" };
  });
  try {
    const pend = await drive(v1StatusRouter, "GET", "/pid-v1-p", undefined);
    check(results, pend.json?.data?.status === "pending", "v1 status: pending");
    const done = await drive(v1StatusRouter, "GET", "/pid-v1-s", undefined);
    const dd = done.json?.data || {};
    check(results,
      dd.status === "success" && dd.audio_filename === "v1.wav" &&
      dd.audio_url?.startsWith(`${TTS_CONFIG.comfyuiHostUrl}/view?filename=v1.wav`),
      "v1 status: success 返回产物 (与 /speak 同构 audio_url/audio_path)");
  } finally {
    restoreFetch();
  }
  return results;
}

// ─── T9: child scenarios — 契约 ③④⑤⑥ (env 须在模块加载前注入 → 子进程) ──────

const CHILD_MARK = "###CHILD-RESULT###";
const REPO_ROOT = path.resolve(__dirname, "../../../../../");
const TEST_FILE = path.join(__dirname, "qwenTts.test.ts");
const TSX_BIN = path.join(REPO_ROOT, "node_modules", ".bin", "tsx");

/** fake nvidia-smi (PATH 注入): 输出 $KAP_FAKE_SMI_OUT 文件内容 */
function makeFakeNvidiaSmi(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kap-fake-smi-"));
  const script = '#!/bin/sh\ncat "$KAP_FAKE_SMI_OUT" 2>/dev/null || echo "1, NVIDIA GeForce RTX 3090, 24576, 23576, 1000"\n';
  fs.writeFileSync(path.join(dir, "nvidia-smi"), script, { mode: 0o755 });
  return dir;
}

function installFakeSmi(freeMiB: number): void {
  const dir = makeFakeNvidiaSmi();
  const out = path.join(dir, "out.csv");
  fs.writeFileSync(out, `1, NVIDIA GeForce RTX 3090, 24576, ${24576 - freeMiB}, ${freeMiB}\n`);
  process.env.KAP_FAKE_SMI_OUT = out;
  process.env.PATH = `${dir}:${process.env.PATH}`;
}

/** 契约 ③④⑤: 排队 500ms 后提交, pollTimeout=150ms — 预算被 queueWaitMs 延长才不致误判 */
async function scenarioPollBudget(which: "qwen" | "v1"): Promise<Record<string, unknown>> {
  installFetchStub((req) => {
    if (req.url.endsWith("/object_info")) {
      return { status: 200, body: JSON.stringify({ AILab_Qwen3TTSCustomVoice: {} }) };
    }
    if (req.method === "POST" && req.url.endsWith("/prompt")) {
      return { status: 200, body: JSON.stringify({ prompt_id: `pid-budget-${which}` }) };
    }
    if (req.url.includes("/history/")) return { status: 200, body: JSON.stringify({}) };
    if (req.url.endsWith("/queue")) return { status: 200, body: "{}" };
    return { status: 404, body: "nope" };
  });

  // 预占 GPU1 锁 500ms — 模拟 minimax_h3 长作业持锁, speak 在队列里等
  const hold = withGpuQueueTimed("minimax_h3", () => new Promise<string>((r) => setTimeout(() => r("held"), 500)),
    { gpuIndex: 1, skipVram: true });
  const resp = which === "qwen"
    ? await drive(qwenSpeakRouter, "POST", "/speak", { mode: "custom_voice", text: "预算" })
    : await drive(v1SpeakRouter, "POST", "/", { text: "预算" });
  await hold;

  const msg = String(resp.json?.message || "");
  const m = /Timeout after ([\d.]+)s/.exec(msg);
  const queueDelete = captured.find((c) => c.method === "POST" && c.url.endsWith("/queue"));
  return {
    httpStatus: resp.status,
    message: msg,
    timeoutSeconds: m ? parseFloat(m[1]) : null,
    errKind: resp.json?.data?.error?.kind ?? null,
    promptCalls: countReq((c) => c.method === "POST" && c.url.endsWith("/prompt")),
    historyCalls: countReq((c) => c.url.includes("/history/")),
    queueDeleteBody: queueDelete ? String(queueDelete.body) : null,
  };
}

/** 契约 ⑥: 显存预检 fail-fast (fake smi free=100 < 8192, 队列超时 200ms) */
async function scenarioVram503(which: "qwen" | "v1"): Promise<Record<string, unknown>> {
  delete process.env.KAP_VRAM_SKIP; // 本场景要真实 ensureVram 分支
  installFakeSmi(100);
  installFetchStub((req) => {
    if (req.url.endsWith("/object_info")) {
      return { status: 200, body: JSON.stringify({ AILab_Qwen3TTSCustomVoice: {} }) };
    }
    if (req.url.endsWith("/free")) return { status: 200, body: "{}" };
    if (req.method === "POST" && req.url.endsWith("/prompt")) {
      return { status: 200, body: JSON.stringify({ prompt_id: "pid-never" }) };
    }
    return { status: 404, body: "nope" };
  });

  const resp = which === "qwen"
    ? await drive(qwenSpeakRouter, "POST", "/speak", { mode: "custom_voice", text: "x" })
    : await drive(v1SpeakRouter, "POST", "/", { text: "x" });

  // qwen: data={kind,...}; v1: data.error={kind,...} (engineError 包装)
  const d = resp.json?.data || {};
  const e = d.error || d;
  return {
    httpStatus: resp.status,
    kind: e.kind ?? null,
    engine: e.engine ?? null,
    freeMiB: e.freeMiB ?? null,
    requiredMiB: e.requiredMiB ?? null,
    gpuIndex: e.gpuIndex ?? null,
    freeCalls: countReq((c) => c.url.endsWith("/free")),
    promptCalls: countReq((c) => c.method === "POST" && c.url.endsWith("/prompt")),
  };
}

/** 契约 ⑥ 直测: ensureVram 充足放行 / 不足→/free 驱逐→复查→抛 */
async function scenarioVramPreflight(): Promise<Record<string, unknown>> {
  delete process.env.KAP_VRAM_SKIP;
  const smiDir = makeFakeNvidiaSmi();
  const outFile = path.join(smiDir, "out.csv");
  process.env.KAP_FAKE_SMI_OUT = outFile;
  process.env.PATH = `${smiDir}:${process.env.PATH}`;
  installFetchStub((req) => {
    if (req.url.endsWith("/free")) return { status: 200, body: "{}" };
    return { status: 404, body: "nope" };
  });

  fs.writeFileSync(outFile, "1, NVIDIA GeForce RTX 3090, 24576, 4576, 20000\n");
  const ok = await ensureVram("qwen_tts", 1, QWEN_TTS_CONFIG.comfyuiUrl);
  const freeCallsWhenOk = countReq((c) => c.url.endsWith("/free"));

  await sleep(500); // KAP_VRAM_CACHE_MS=300, 缓存过期后读新值
  fs.writeFileSync(outFile, "1, NVIDIA GeForce RTX 3090, 24576, 24476, 100\n");
  let err: any = null;
  try {
    await ensureVram("qwen_tts", 1, QWEN_TTS_CONFIG.comfyuiUrl);
  } catch (e) { err = e; }

  return {
    okFreeMiB: ok.freeMiB,
    okEvicted: ok.evicted,
    okRequiredMiB: ok.requiredMiB,
    freeCallsWhenOk,
    threw: err !== null,
    errKind: err?.kind ?? null,
    errFreeMiB: err?.freeMiB ?? null,
    errRequiredMiB: err?.requiredMiB ?? null,
    freeCallsAfter: countReq((c) => c.url.endsWith("/free")),
  };
}

const SCENARIOS: Record<string, () => Promise<Record<string, unknown>>> = {
  "poll-budget-qwen": () => scenarioPollBudget("qwen"),
  "poll-budget-v1": () => scenarioPollBudget("v1"),
  "vram-503-qwen": () => scenarioVram503("qwen"),
  "vram-503-v1": () => scenarioVram503("v1"),
  "vram-preflight": () => scenarioVramPreflight(),
};

interface ChildOutcome {
  code: number;
  result: Record<string, any> | null;
  stderr: string;
}

function runChild(scenario: string, envExtra: Record<string, string | undefined>): Promise<ChildOutcome> {
  return new Promise((resolve) => {
    const env: NodeJS.ProcessEnv = { ...process.env, KAP_TEST_SCENARIO: scenario };
    for (const [k, v] of Object.entries(envExtra)) {
      if (v === undefined) delete env[k];
      else env[k] = v;
    }
    const proc = spawn(TSX_BIN, [TEST_FILE, "--child"], {
      cwd: REPO_ROOT,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => proc.kill("SIGKILL"), 45_000);
    proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    proc.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: -1, result: null, stderr: String(err) });
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      const line = stdout.split("\n").filter((l) => l.startsWith(CHILD_MARK)).pop();
      let result: Record<string, any> | null = null;
      if (line) {
        try { result = JSON.parse(line.slice(CHILD_MARK.length)); } catch { result = null; }
      }
      resolve({ code: code ?? -1, result, stderr });
    });
  });
}

export async function testChildScenarios(): Promise<TestResult[]> {
  const results: TestResult[] = [];

  // ── ③④⑤ qwenTts: 排队 500ms 不吃掉 poll 预算 + 超时弃单清孤儿 ──
  const budgetQwen = await runChild("poll-budget-qwen", {
    QWEN_TTS_POLL_TIMEOUT_MS: "150", // ⑤ env 可配置 (默认 600s 不会在本测试内超时)
    KAP_VRAM_SKIP: "1",
  });
  const bq = budgetQwen.result;
  check(results, budgetQwen.code === 0 && !!bq,
    "[child poll-budget-qwen] 子进程正常退出",
    `code=${budgetQwen.code} stderr=${budgetQwen.stderr.slice(0, 300)}`);
  if (bq) {
    check(results, bq.httpStatus === 500,
      "③ 预算耗尽 → 500 (排队后预算=pollTimeout+queueWait 仍超时)",
      `status=${bq.httpStatus} msg=${bq.message}`);
    check(results,
      typeof bq.timeoutSeconds === "number" && bq.timeoutSeconds >= 0.6 && bq.timeoutSeconds <= 5,
      "③ queue wait 不计入 job 预算: Timeout after ≥0.6s (=0.15s 配置 + ~0.5s 排队补偿)",
      `timeoutSeconds=${bq.timeoutSeconds}`);
    check(results,
      typeof bq.timeoutSeconds === "number" && bq.timeoutSeconds < 5,
      "⑤ pollTimeoutMs env 覆盖生效 (150ms; 默认 600s 永不在此超时)",
      `timeoutSeconds=${bq.timeoutSeconds}`);
    check(results, bq.promptCalls === 1 && bq.historyCalls >= 1,
      "提交恰 1 次 + 轮询过至少 1 次后才判超时");
    const del = bq.queueDeleteBody ? JSON.parse(bq.queueDeleteBody) : null;
    check(results,
      !!del && JSON.stringify(del) === JSON.stringify({ delete: ["pid-budget-qwen"] }),
      "④ orphan cleanup: POST /queue {delete:[promptId]}",
      `body=${bq.queueDeleteBody}`);
  }

  // ── ③④ v1/tts 同款 ──
  const budgetV1 = await runChild("poll-budget-v1", {
    QWEN_TTS_POLL_TIMEOUT_MS: "150",
    KAP_VRAM_SKIP: "1",
  });
  const bv = budgetV1.result;
  check(results, budgetV1.code === 0 && !!bv,
    "[child poll-budget-v1] 子进程正常退出",
    `code=${budgetV1.code} stderr=${budgetV1.stderr.slice(0, 300)}`);
  if (bv) {
    check(results, bv.httpStatus === 500 && bv.errKind === "synthesis_failed",
      "③ v1/tts 预算耗尽 → 500 synthesis_failed (engineError 结构)",
      `status=${bv.httpStatus} kind=${bv.errKind}`);
    check(results,
      typeof bv.timeoutSeconds === "number" && bv.timeoutSeconds >= 0.6,
      "③ v1/tts 同样补偿 queue wait (Timeout after ≥0.6s)",
      `timeoutSeconds=${bv.timeoutSeconds}`);
    const delV = bv.queueDeleteBody ? JSON.parse(bv.queueDeleteBody) : null;
    check(results,
      !!delV && JSON.stringify(delV) === JSON.stringify({ delete: ["pid-budget-v1"] }),
      "④ v1/tts orphan cleanup 同款",
      `body=${bv.queueDeleteBody}`);
  }

  // ── ⑥ qwenTts: 显存不足 fail-fast 503 (fake nvidia-smi free=100) ──
  const vramQwen = await runChild("vram-503-qwen", {
    KAP_VRAM_SKIP: undefined,
    KAP_GPU_QUEUE_TIMEOUT_MS: "200",
    KAP_VRAM_FREE_WAIT_MS: "20",
  });
  const vq = vramQwen.result;
  check(results, vramQwen.code === 0 && !!vq,
    "[child vram-503-qwen] 子进程正常退出",
    `code=${vramQwen.code} stderr=${vramQwen.stderr.slice(0, 300)}`);
  if (vq) {
    check(results, vq.httpStatus === 503,
      "⑥ 显存不足 → 503 (fail-fast, 不进队列饿死)",
      `status=${vq.httpStatus}`);
    check(results,
      vq.kind === "vram_insufficient" && vq.engine === "qwen_tts",
      "⑥ 结构化 kind=vram_insufficient engine=qwen_tts");
    check(results,
      vq.freeMiB === 100 && vq.requiredMiB === 8192 && vq.gpuIndex === 1,
      "⑥ 结构化 freeMiB/requiredMiB/gpuIndex 透传",
      JSON.stringify({ freeMiB: vq.freeMiB, requiredMiB: vq.requiredMiB, gpuIndex: vq.gpuIndex }));
    check(results,
      vq.freeCalls >= 1 && vq.promptCalls === 0,
      "⑥ 不足时先 POST /free 驱逐复查, 仍不足则不提交任何 /prompt");
  }

  // ── ⑥ v1/tts 同款 ──
  const vramV1 = await runChild("vram-503-v1", {
    KAP_VRAM_SKIP: undefined,
    KAP_GPU_QUEUE_TIMEOUT_MS: "200",
    KAP_VRAM_FREE_WAIT_MS: "20",
  });
  const vv = vramV1.result;
  check(results, vramV1.code === 0 && !!vv,
    "[child vram-503-v1] 子进程正常退出",
    `code=${vramV1.code} stderr=${vramV1.stderr.slice(0, 300)}`);
  if (vv) {
    check(results,
      vv.httpStatus === 503 && vv.kind === "vram_insufficient" && vv.engine === "qwen_tts",
      "⑥ v1/tts 同款 503 vram_insufficient (engineError 包装)",
      `status=${vv.httpStatus} kind=${vv.kind}`);
    check(results,
      vv.freeMiB === 100 && vv.requiredMiB === 8192,
      "⑥ v1/tts 结构化 freeMiB/requiredMiB 透传");
  }

  // ── ⑥ 直测 ensureVram: 充足放行 / 不足→驱逐→复查→抛 ──
  const pre = await runChild("vram-preflight", {
    KAP_VRAM_SKIP: undefined,
    KAP_VRAM_CACHE_MS: "300",
    KAP_VRAM_FREE_WAIT_MS: "20",
  });
  const pf = pre.result;
  check(results, pre.code === 0 && !!pf,
    "[child vram-preflight] 子进程正常退出",
    `code=${pre.code} stderr=${pre.stderr.slice(0, 300)}`);
  if (pf) {
    check(results,
      pf.okFreeMiB === 20000 && pf.okEvicted === false && pf.okRequiredMiB === 8192 && pf.freeCallsWhenOk === 0,
      "⑥ ensureVram: free 20000 ≥ 8192 → 放行且不 /free",
      JSON.stringify(pf));
    check(results,
      pf.threw === true && pf.errKind === "vram_insufficient" && pf.errFreeMiB === 100 && pf.errRequiredMiB === 8192,
      "⑥ ensureVram: free 100 → /free 驱逐后仍不足 → VramInsufficientError",
      JSON.stringify(pf));
    check(results, pf.freeCallsAfter >= 1,
      "⑥ 不足路径确实尝试过 /free 驱逐 (可逆驱逐先于 fail-fast)");
  }

  return results;
}

// ─── child 入口: KAP_TEST_SCENARIO=<name> npx tsx <本文件> --child ────────────

const scenarioName = process.env.KAP_TEST_SCENARIO;
if (scenarioName && typeof require !== "undefined" && require.main === module) {
  const fn = SCENARIOS[scenarioName];
  if (!fn) {
    console.error(`unknown scenario: ${scenarioName}`);
    process.exit(2);
  }
  fn().then(
    (out) => {
      process.stdout.write(`${CHILD_MARK}${JSON.stringify(out)}\n`);
      process.exit(0);
    },
    (err) => {
      console.error("scenario crashed:", err);
      process.exit(1);
    },
  );
}
