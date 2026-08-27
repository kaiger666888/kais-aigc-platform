/**
 * blockCache.test.ts — H3 block-cache (MiniMaxH3BlockCacheT8) 灰度注入单测 (2026-08-27)。
 *
 * Project convention (Pitfalls B3): no vitest/jest at repo root. Plain TypeScript
 * module exporting async test functions; the runnable entrypoint is
 * `scripts/verify-h3-blockcache.ts` (tsx + check()/results[] pattern,
 * mirrors qwenTts.test.ts / verify-qwen-tts.ts)。
 *
 * 被测对象 (任务: KAP H3 工作流注入 MiniMaxH3BlockCacheT8 开关, 默认关闭):
 * - config.ts   — H3_BLOCK_CACHE / parseH3BlockCacheFlag / resolveH3BlockCacheThreshold
 * - generate.ts — buildH3WorkflowNative 的 BC 注入 + /generate handler 灰度参数
 *
 * 契约清单 (从任务规格提炼):
 *  ① 默认关闭回归红线: 不带 blockCache 的一切请求生成的图与改动前逐字节等价
 *     (golden 对比 — golden/*.json 于改动前代码 dump, 仅加 export 关键字, 无行为变更)。
 *  ② blockCache=on 且路由到 native-sage 原生链路 → BC 节点存在, 接线
 *     [12,0] → 12_blockcache → 21(SigmaShift), 生产参数齐备, verbose=true,
 *     阈值默认 0.4 / blockCacheThreshold 覆盖生效。
 *  ③ blockCacheThreshold 仅 [0,1] 合法浮点生效, 非法值回落默认 0.4 并 WARN。
 *  ④ turbo/T8 (DualClock) 拓扑即使传 blockCache=on 也不含 BC 节点 (静默忽略, 不报错)。
 *  ⑤ 元数据可核验: 返回 payload 带 blockCache <bool> 与实际生效 threshold。
 *
 * 隔离手法:
 * - generate/config 经动态 import 加载 — env (COMFYUI_URL/OUTPUT_DIR) 必须先注入,
 *   config 在模块加载时读 env; stub ComfyUI 是本地 http server (axios 真连 stub,
 *   /prompt 捕获提交的工作流 JSON)。
 * - KAP_VRAM_SKIP=1 跳过显存预检 (不 spawn nvidia-smi, 不碰真 GPU);
 *   KAP_GPU_QUEUE_CROSSPROC=off — 进程内锁, 不与同机 prod server 互斥。
 */

import http from "http";
import { AddressInfo } from "net";
import express from "express";
import fs from "fs";
import os from "os";
import path from "path";

export interface TestResult {
  name: string;
  pass: boolean;
  detail?: string;
}

function check(results: TestResult[], cond: boolean, name: string, detail?: string): void {
  results.push({ name, pass: cond, detail: cond ? undefined : detail });
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// ─── golden 基准 (改动前代码 dump; 输入全部固定) ─────────────────────────────

const GOLDEN_DIR = path.join(__dirname, "golden");
const GOLDEN_PROMPT = "a girl walks along a rainy neon street at night";
const GOLDEN_NEGATIVE = "golden negative";
const GOLDEN_BASE = {
  prompt: GOLDEN_PROMPT,
  width: 1344,
  height: 768,
  length: 124,
  seed: 12345,
  stepsOverride: null,
  filenamePrefix: "golden_h3",
} as const;
const NATIVE_SAGE_OPTS = {
  turbo: false,
  native: true,
  tespeed: false,
  nativeInterp: true,
} as const;

function loadGoldenText(name: string): string {
  return fs.readFileSync(path.join(GOLDEN_DIR, `${name}.json`), "utf8");
}

/** 与 golden 文件相同的序列化格式 (2-space pretty + 换行) — 键序也参与对比 */
function serializeWf(wf: Record<string, any>): string {
  return JSON.stringify(wf, null, 2) + "\n";
}

// ─── stub ComfyUI (本地 http server; 捕获 POST /prompt 的工作流) ────────────

interface StubComfy {
  port: number;
  prompts: Array<{ promptId: string; wf: Record<string, any> }>;
  close(): Promise<void>;
}

async function startStubComfy(): Promise<StubComfy> {
  const prompts: Array<{ promptId: string; wf: Record<string, any> }> = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", "http://stub");
    if (req.method === "POST" && url.pathname === "/prompt") {
      let body = "";
      req.on("data", (c: Buffer) => (body += c.toString()));
      req.on("end", () => {
        const parsed = JSON.parse(body);
        const promptId = `stub_${prompts.length + 1}`;
        prompts.push({ promptId, wf: parsed.prompt });
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ prompt_id: promptId }));
      });
      return;
    }
    if (req.method === "GET" && url.pathname.startsWith("/history/")) {
      const pid = url.pathname.split("/").pop() as string;
      res.setHeader("content-type", "application/json");
      // 立即完成: 首轮 /history 即 success (省 3s 轮询间隔)
      res.end(JSON.stringify({
        [pid]: {
          status: { status_str: "success", completed: true, messages: [] },
          outputs: { "50": { videos: [{ filename: "stub_out.mp4", subfolder: "", type: "output" }] } },
        },
      }));
      return;
    }
    if (req.method === "GET" && url.pathname === "/view") {
      res.end(Buffer.from("stub-mp4-bytes"));
      return;
    }
    if (req.method === "POST" && url.pathname === "/queue") {
      res.end("{}");
      return;
    }
    res.statusCode = 404;
    res.end("{}");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    prompts,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

// ─── 延迟加载 ctx — env 必须先于 config 模块加载注入 ────────────────────────

interface TestCtx {
  cfg: typeof import("../config");
  gen: typeof import("../generate");
  stub: StubComfy;
  tmpOutDir: string;
  appPort: number;
  appClose: () => Promise<void>;
}

let ctxRef: TestCtx | null = null;

export async function setupCtx(): Promise<TestCtx> {
  if (ctxRef) return ctxRef;
  const stub = await startStubComfy();
  const tmpOutDir = fs.mkdtempSync(path.join(os.tmpdir(), "h3-bc-test-out-"));
  // ⚠️ 必须在首次 import config/generate 之前注入 (config 模块加载时读 env)
  process.env.COMFYUI_URL = `http://127.0.0.1:${stub.port}`;
  process.env.OUTPUT_DIR = tmpOutDir;
  process.env.KAP_VRAM_SKIP = "1";           // 跳过显存预检, 不碰真 GPU
  process.env.KAP_GPU_QUEUE_CROSSPROC = "off"; // 进程内锁, 不与 prod server 互斥
  const cfg = await import("../config");
  const gen = await import("../generate");

  const app = express();
  app.use("/api/production/minimax-h3/generate", gen.default);
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const appPort = (server.address() as AddressInfo).port;
  ctxRef = {
    cfg,
    gen,
    stub,
    tmpOutDir,
    appPort,
    appClose: () => new Promise<void>((r) => server.close(() => r())),
  };
  return ctxRef;
}

/** 收尾: 关闭 stub ComfyUI 与 express server (否则事件循环不空, 进程不退出) */
export async function teardownCtx(): Promise<void> {
  if (!ctxRef) return;
  const { appClose, stub } = ctxRef;
  ctxRef = null;
  await appClose();
  await stub.close();
}

/** e2e: multipart POST /generate, 返回 {status, json} + 提交到 stub 的工作流 */
async function postGenerate(
  ctx: TestCtx,
  fields: Record<string, string>,
): Promise<{ status: number; json: any; submittedWf: Record<string, any> }> {
  const before = ctx.stub.prompts.length;
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  const resp = await fetch(`http://127.0.0.1:${ctx.appPort}/api/production/minimax-h3/generate`, {
    method: "POST",
    body: form,
  });
  const json = await resp.json();
  await sleep(50); // 等 handler 收尾 (锁释放)
  const submitted = ctx.stub.prompts[before];
  return { status: resp.status, json, submittedWf: submitted?.wf };
}

/** 数一数图里还有多少输入槽仍直连 ["12",0] (blockCache=on 时应只剩 BC 节点自己的 model) */
function countDirectUNETConsumers(wf: Record<string, any>): number {
  let n = 0;
  for (const node of Object.values(wf)) {
    for (const v of Object.values((node as any).inputs || {})) {
      if (Array.isArray(v) && v[0] === "12" && v[1] === 0) n++;
    }
  }
  return n;
}

// ─── T1: 开关解析 — "on"/"true"/"1" 开启, 其余一律关闭 ──────────────────────

export async function testFlagParsing(): Promise<TestResult[]> {
  const { cfg } = await setupCtx();
  const results: TestResult[] = [];
  const truthy: unknown[] = ["on", "ON", "On", "true", "TRUE", "1", 1, true];
  const falsy: unknown[] = ["false", "off", "0", "", "banana", "yes", undefined, null, false, 0];
  check(results,
    truthy.every((v) => cfg.parseH3BlockCacheFlag(v) === true),
    "parseH3BlockCacheFlag: on/ON/true/TRUE/1/1(number)/true(bool) → true");
  check(results,
    falsy.every((v) => cfg.parseH3BlockCacheFlag(v) === false),
    "parseH3BlockCacheFlag: false/off/0/空串/乱值/undefined/null → false (不报错)");
  check(results,
    cfg.parseH3BlockCacheFlag("true ") === true && cfg.parseH3BlockCacheFlag(" 1 ") === true,
    "parseH3BlockCacheFlag: 容忍前后空白 (trim)");
  return results;
}

// ─── T2: 阈值解析 — [0,1] 合法浮点生效, 非法回落默认 + WARN ────────────────

export async function testThresholdResolution(): Promise<TestResult[]> {
  const { cfg } = await setupCtx();
  const results: TestResult[] = [];
  const DEF = cfg.H3_BLOCK_CACHE.residualDiffThreshold;

  check(results, resolve("0.55") === 0.55, "blockCacheThreshold=0.55 → 0.55 生效");
  check(results, resolve("0") === 0 && resolve("1") === 1, "blockCacheThreshold=0/1 → 边界值合法 ([0,1] 闭区间)");
  check(results, resolve("0.4") === DEF, "blockCacheThreshold=0.4 (默认值本身) 合法");
  check(results, resolve(undefined) === DEF && resolve(null) === DEF && resolve("") === DEF && resolve("   ") === DEF,
    "缺省/null/空串/纯空白 → 默认 0.4, 且不 WARN");

  const warnings: string[] = [];
  const origWarn = console.warn;
  console.warn = (...args: unknown[]) => { warnings.push(args.join(" ")); };
  try {
    const invalid: unknown[] = ["abc", "1.5", "-0.1", "NaN", 2, -1];
    const fellBack = invalid.every((v) => resolve(v) === DEF);
    check(results, fellBack, `非法值 (${invalid.map(String).join("/")}) 全部回落默认 ${DEF}`);
    check(results,
      warnings.length >= invalid.length && warnings.every((w) => w.includes("blockCacheThreshold")),
      `每个非法值 WARN 一次 (${warnings.length} 条, 含关键字 blockCacheThreshold)`,
      warnings.join(" | "));
  } finally {
    console.warn = origWarn;
  }
  return results;

  function resolve(raw: unknown): number {
    return cfg.resolveH3BlockCacheThreshold(raw);
  }
}

// ─── T3: 默认无参图与旧图逐字节等价 (回归红线 ①) ───────────────────────────

export async function testGoldenDefaultGraphs(): Promise<TestResult[]> {
  const { gen } = await setupCtx();
  const results: TestResult[] = [];

  const cases: Array<{ golden: string; build: () => Record<string, any> }> = [
    {
      golden: "native-t2va",
      build: () => gen.buildH3WorkflowNative({
        ...GOLDEN_BASE, mode: "t2va",
        firstFrameFilename: null, refImageFilenames: [], refVideoFilename: null,
        ...NATIVE_SAGE_OPTS, negativePrompt: GOLDEN_NEGATIVE,
      }),
    },
    {
      golden: "native-i2va",
      build: () => gen.buildH3WorkflowNative({
        ...GOLDEN_BASE, mode: "i2va",
        firstFrameFilename: "golden_first.png", refImageFilenames: [], refVideoFilename: null,
        ...NATIVE_SAGE_OPTS, negativePrompt: GOLDEN_NEGATIVE,
      }),
    },
    {
      golden: "native-ref2va",
      build: () => gen.buildH3WorkflowNative({
        ...GOLDEN_BASE, mode: "ref2va",
        firstFrameFilename: null, refImageFilenames: ["golden_ref1.png", "golden_ref2.png"],
        refVideoFilename: null,
        ...NATIVE_SAGE_OPTS, negativePrompt: GOLDEN_NEGATIVE,
      }),
    },
    {
      golden: "t8-turbo",
      build: () => gen.buildH3WorkflowT8({
        ...GOLDEN_BASE, mode: "ref2va",
        firstFrameFilename: null, refImageFilenames: ["golden_ref1.png"], refVideoFilename: null,
        stepsOverride: 8, turbo: true, native: false, tespeed: false,
      }),
    },
  ];

  for (const { golden, build } of cases) {
    const wf = build();
    check(results,
      serializeWf(wf) === loadGoldenText(golden),
      `默认图 (无 blockCache) 与 golden/${golden}.json 逐字节等价`,
      diffHint(serializeWf(wf), loadGoldenText(golden)));
    check(results,
      !JSON.stringify(wf).includes("BlockCache"),
      `${golden}: 图中不含任何 BlockCache 节点`);
  }
  return results;
}

function diffHint(got: string, want: string): string {
  if (got === want) return "";
  const g = got.split("\n");
  const w = want.split("\n");
  for (let i = 0; i < Math.max(g.length, w.length); i++) {
    if (g[i] !== w[i]) return `首个差异 @line ${i + 1}:\n  got:  ${g[i]}\n  want: ${w[i]}`;
  }
  return "长度不同";
}

// ─── T4: blockCache=on 注入 — 节点/接线/阈值/最小 delta (红线 ②) ───────────

export async function testBlockCacheInjection(): Promise<TestResult[]> {
  const { gen, cfg } = await setupCtx();
  const results: TestResult[] = [];
  const BC = cfg.H3_BLOCK_CACHE.nodeId;
  const baseNative = {
    ...GOLDEN_BASE, mode: "t2va" as const,
    firstFrameFilename: null, refImageFilenames: [] as string[], refVideoFilename: null,
    ...NATIVE_SAGE_OPTS, negativePrompt: GOLDEN_NEGATIVE,
  };

  // 默认阈值 (不传 blockCacheThreshold)
  const wfOn = gen.buildH3WorkflowNative({ ...baseNative, blockCache: true });
  const bc = wfOn[BC] as any;

  check(results, !!bc && bc.class_type === "MiniMaxH3BlockCacheT8",
    "blockCache=on → 12_blockcache 节点存在且 class_type=MiniMaxH3BlockCacheT8");
  check(results,
    JSON.stringify(bc?.inputs?.model) === JSON.stringify(["12", 0]),
    "BC.model = [12,0] (直连 UNETLoader)");
  check(results,
    JSON.stringify(wfOn["21"].inputs.model) === JSON.stringify([BC, 0]),
    "SigmaShift(21).model = [12_blockcache,0] (原 [12,0] 消费者改接 BC)");
  check(results,
    countDirectUNETConsumers(wfOn) === 1,
    "全图仅 BC 节点自身仍引用 [12,0] (无遗漏消费者)",
    `直连 [12,0] 的输入槽 = ${countDirectUNETConsumers(wfOn)}`);
  check(results,
    bc.inputs.residual_diff_threshold === 0.4 &&
    bc.inputs.start_percent === 0.08 &&
    bc.inputs.end_percent === 0.95 &&
    bc.inputs.max_consecutive_hits === 2 &&
    bc.inputs.cache_device === "cpu" &&
    bc.inputs.metric_stride === 8 &&
    bc.inputs.verbose === true,
    "BC inputs 与实测生产参数一致 (threshold 0.4/0.08~0.95/hits2/cpu/stride8/verbose true)",
    JSON.stringify(bc?.inputs));

  // 阈值覆盖
  const wfOverride = gen.buildH3WorkflowNative({ ...baseNative, blockCache: true, blockCacheThreshold: 0.55 });
  check(results,
    wfOverride[BC].inputs.residual_diff_threshold === 0.55,
    "blockCacheThreshold=0.55 → residual_diff_threshold=0.55");

  // 最小 delta: 摘掉 BC 节点 + 还原 21.model 后与 golden 逐字节等价 (注入不改其他任何节点)
  const wfStripped = { ...wfOn };
  delete wfStripped[BC];
  wfStripped["21"] = { ...wfStripped["21"], inputs: { ...wfStripped["21"].inputs, model: ["12", 0] } };
  check(results,
    serializeWf(wfStripped) === loadGoldenText("native-t2va"),
    "最小 delta: 剥离 BC 后图与 golden 逐字节等价 (注入零副作用)");

  // 三种模式都正确注入 (t2va/i2va/ref2va 的 Native builder)
  for (const mode of ["i2va", "ref2va"] as const) {
    const wf = gen.buildH3WorkflowNative({
      ...GOLDEN_BASE, mode,
      firstFrameFilename: mode === "i2va" ? "golden_first.png" : null,
      refImageFilenames: mode === "ref2va" ? ["golden_ref1.png"] : [],
      refVideoFilename: null,
      ...NATIVE_SAGE_OPTS, negativePrompt: GOLDEN_NEGATIVE,
      blockCache: true, blockCacheThreshold: 0.7,
    });
    check(results,
      wf[BC]?.class_type === "MiniMaxH3BlockCacheT8" &&
      wf[BC].inputs.residual_diff_threshold === 0.7 &&
      JSON.stringify(wf["21"].inputs.model) === JSON.stringify([BC, 0]),
      `${mode} 模式 Native 链同样注入 (threshold 覆盖传递)`);
  }
  return results;
}

// ─── T5: turbo/T8 拓扑免疫 — 传参也不含 BC (红线 ④) ───────────────────────

export async function testTurboTopologyImmune(): Promise<TestResult[]> {
  const { gen } = await setupCtx();
  const results: TestResult[] = [];

  const wfT8 = gen.buildH3WorkflowT8({
    ...GOLDEN_BASE, mode: "ref2va",
    firstFrameFilename: null, refImageFilenames: ["golden_ref1.png"], refVideoFilename: null,
    stepsOverride: 8, turbo: true, native: false, tespeed: false,
    blockCache: true, blockCacheThreshold: 0.9,   // ← 传参也必须被忽略
  });
  check(results,
    !JSON.stringify(wfT8).includes("BlockCache"),
    "T8 builder 收到 blockCache=true 也不产生 BlockCache 节点");
  check(results,
    serializeWf(wfT8) === loadGoldenText("t8-turbo"),
    "T8 图 (带 blockCache 参数) 与 golden/t8-turbo.json 逐字节等价 — 参数零影响",
    diffHint(serializeWf(wfT8), loadGoldenText("t8-turbo")));
  return results;
}

// ─── T6: /generate handler e2e — 参数 → 提交图 → payload 元数据 (红线 ①②④⑤) ─

export async function testHandlerE2e(): Promise<TestResult[]> {
  const ctx = await setupCtx();
  const { cfg } = ctx;
  const results: TestResult[] = [];
  const BC = cfg.H3_BLOCK_CACHE.nodeId;

  // e2e 黄金输入: 固定 seed/prompt/filenamePrefix, 与 golden/native-t2va.json 对齐。
  // handler 对 native 链路硬编码 negativePrompt=H3_DEFAULT_NEGATIVE (golden 是自定义值) → 对比前替换。
  const e2eBase: Record<string, string> = {
    projectId: "1",
    prompt: GOLDEN_PROMPT,
    mode: "t2va",
    profile: "native-sage",
    seed: "12345",
    filenamePrefix: "golden",
  };

  // ① 默认无参 (HTTP 级回归红线): 提交图与 golden 逐字节等价
  const dflt = await postGenerate(ctx, e2eBase);
  check(results, dflt.status === 200, `默认请求 200 (got ${dflt.status}: ${JSON.stringify(dflt.json).slice(0, 200)})`);
  const goldenT2va = JSON.parse(loadGoldenText("native-t2va"));
  goldenT2va["16"].inputs.prompt = cfg.H3_DEFAULT_NEGATIVE;
  check(results,
    dflt.submittedWf && serializeWf(dflt.submittedWf) === serializeWf(goldenT2va),
    "e2e 默认请求提交到 ComfyUI 的图与 golden 逐字节等价 (除 handler 硬编码 negativePrompt)",
    dflt.submittedWf ? diffHint(serializeWf(dflt.submittedWf), serializeWf(goldenT2va)) : "未捕获 /prompt");
  check(results,
    dflt.json?.data?.blockCache === false && dflt.json?.data?.blockCacheThreshold === 0.4,
    "e2e 默认响应 payload: blockCache=false + threshold=0.4",
    JSON.stringify(dflt.json?.data)?.slice(0, 200));

  // ② native-sage + blockCache=on + threshold=0.55
  const on = await postGenerate(ctx, { ...e2eBase, blockCache: "on", blockCacheThreshold: "0.55" });
  const bcNode = on.submittedWf?.[BC];
  check(results, on.status === 200, `blockCache=on 请求 200 (got ${on.status})`);
  check(results,
    bcNode?.class_type === "MiniMaxH3BlockCacheT8" &&
    bcNode?.inputs?.residual_diff_threshold === 0.55 &&
    JSON.stringify(bcNode?.inputs?.model) === JSON.stringify(["12", 0]) &&
    JSON.stringify(on.submittedWf["21"].inputs.model) === JSON.stringify([BC, 0]),
    "e2e 提交图: BC 节点 + [12,0]→BC→21 接线 + threshold=0.55");
  check(results,
    on.json?.data?.blockCache === true && on.json?.data?.blockCacheThreshold === 0.55,
    "e2e payload: blockCache=true + blockCacheThreshold=0.55 (元数据可核验)",
    JSON.stringify(on.json?.data)?.slice(0, 200));

  // ④ turbo (T8/DualClock) + blockCache=on → 忽略
  const turbo = await postGenerate(ctx, {
    ...e2eBase, profile: "turbo", steps: "8", blockCache: "on",
  });
  check(results, turbo.status === 200, `turbo+blockCache=on 请求 200 (got ${turbo.status})`);
  check(results,
    !JSON.stringify(turbo.submittedWf).includes("BlockCache"),
    "e2e turbo 拓扑提交图不含 BlockCache 节点 (参数被忽略, 不报错)");
  check(results,
    turbo.json?.data?.blockCache === false && turbo.json?.data?.blockCacheThreshold === 0.4,
    "e2e turbo payload: blockCache=false (如实反映未注入)",
    JSON.stringify(turbo.json?.data)?.slice(0, 200));

  // ③ 非法 threshold → WARN + 回落默认 0.4
  const warnings: string[] = [];
  const origWarn = console.warn;
  console.warn = (...args: unknown[]) => { warnings.push(args.join(" ")); };
  let bad: Awaited<ReturnType<typeof postGenerate>>;
  try {
    bad = await postGenerate(ctx, { ...e2eBase, blockCache: "on", blockCacheThreshold: "1.5" });
  } finally {
    console.warn = origWarn;
  }
  check(results,
    warnings.some((w) => w.includes("blockCacheThreshold")),
    "e2e 非法 threshold (1.5) 触发 WARN",
    warnings.join(" | "));
  check(results,
    bad.status === 200 &&
    bad.submittedWf?.[BC]?.inputs?.residual_diff_threshold === 0.4 &&
    bad.json?.data?.blockCacheThreshold === 0.4,
    "e2e 非法 threshold 回落默认 0.4 (提交图 + payload 一致)",
    `status=${bad.status} bc=${JSON.stringify(bad.submittedWf?.[BC]?.inputs?.residual_diff_threshold)}`);

  return results;
}
