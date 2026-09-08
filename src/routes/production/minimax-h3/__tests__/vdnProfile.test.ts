/**
 * vdnProfile.test.ts — H3 VDN 引擎臂 (profile="vdn-8", ApplyVDNH3) 集成单测 (2026-09-08)。
 *
 * Project convention (Pitfalls B3): no vitest/jest at repo root. Plain TypeScript
 * module exporting async test functions; the runnable entrypoint is
 * `scripts/verify-h3-vdn.ts` (tsx + check()/results[] pattern,
 * mirrors blockCache.test.ts / verify-h3-blockcache.ts)。
 *
 * 被测对象 (任务: VDN 引擎臂正式集成 KAP, 新增可选 profile vdn-8):
 * - config.ts   — H3_VDN 配置块 / H3ProfileName / H3_PROFILES / H3_EXPOSED_PROFILES
 * - generate.ts — buildH3WorkflowVDN 构图 + vdn-8 路由分支 + 241f 硬边界/互斥语义守卫
 * - ref2va/i2va/t2va.ts — per-mode 路由 vdn-8 400 拒绝 (d3eb69e0 模式)
 *
 * 契约清单:
 *  ① profile 校验接受 vdn-8: H3_EXPOSED_PROFILES 含 vdn-8 且 H3_PROFILES 定义齐全
 *     (steps=8 / skipFoley / turbo=native=tespeed=false); H3_VDN 参数与 0907 盲测
 *     获胜臂蓝图 (/tmp/case08_241_dual.py, prompt_id=5d732d1e) 逐字一致。
 *  ② 三模式 (t2va/i2va/ref2va) 构图: ApplyVDNH3 节点在位且参数正确、无任何
 *     LoraLoaderModelOnly/LoraLoaderBypassModelOnly、无 MiniMaxH3SigmaShift、
 *     无 T8 节点 (DualClock/AVDecode)、无 TESpeed; 基模 int8_convrot;
 *     er_sde + beta + 8 步 + denoise 1.0; ref2va 点号键 + ref_image_size="match"。
 *  ③ length > 241 → 400 (边界=0907 实测 OOM; 守卫按对齐后 length 判, raw 227..241
 *     → 对齐 243 亦拒; 226=最大网格值放行)。
 *  ④ vdn-8 与显式 turbo/native 互斥 → 400 (防静默错渲染)。
 *  ⑤ per-mode 路由 (ref2va) 收 vdn-8 → 400 指引 /generate (防静默降级 T8)。
 *
 * 隔离手法 (同 blockCache.test.ts round-3):
 * - config/generate 经动态 import 加载 — env 先注入; KAP_VRAM_SKIP=1 不碰真 GPU;
 *   KAP_GPU_QUEUE_CROSSPROC=off 进程内锁。e2e 用本地 stub ComfyUI (回环标记端点
 *   探针硬守卫, 非封闭环境整套 SKIP, 不发任何越出回环的请求)。
 * - e2e 用 mode=t2va (无图入参) — 避免 copyToContainer docker cp 触碰真实容器;
 *   ref2va 的图构造由 builder 层 T2 覆盖。
 */
import http from "http";
import { AddressInfo } from "net";
import { randomUUID } from "crypto";
import axios from "axios";
import express from "express";
import fs from "fs";
import os from "os";
import path from "path";

export interface TestResult {
  name: string;
  pass: boolean;
  detail?: string;
  /** SKIP — 非封闭环境下 e2e 整套跳过; runner 不计入总数、不算失败 */
  skip?: boolean;
}

function check(results: TestResult[], cond: boolean, name: string, detail?: string): void {
  results.push({ name, pass: cond, detail: cond ? undefined : detail });
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// ─── stub ComfyUI (本地回环; 捕获 POST /prompt 的工作流) ─────────────────────

interface StubComfy {
  port: number;
  magic: string;
  prompts: Array<{ promptId: string; wf: Record<string, any> }>;
  close(): Promise<void>;
}

async function startStubComfy(): Promise<StubComfy> {
  const prompts: Array<{ promptId: string; wf: Record<string, any> }> = [];
  const magic = randomUUID().replace(/-/g, "").slice(0, 16);
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", "http://stub");
    if (req.method === "GET" && url.pathname === "/__stub_identity__") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ stub: "h3-vdn-test", magic }));
      return;
    }
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
    magic,
    prompts,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

// ─── 延迟加载 ctx — env 必须先于 config 模块加载注入 ────────────────────────

interface TestCtx {
  cfg: typeof import("../config");
  gen: typeof import("../generate");
  ref2va: typeof import("../ref2va");
  stub: StubComfy;
  tmpOutDir: string;
  appPort: number;
  appClose: () => Promise<void>;
  hermetic: { ok: true } | { ok: false; reason: string };
}

let ctxRef: TestCtx | null = null;

export async function setupCtx(): Promise<TestCtx> {
  if (ctxRef) return ctxRef;
  const stub = await startStubComfy();
  const tmpOutDir = fs.mkdtempSync(path.join(os.tmpdir(), "h3-vdn-test-out-"));
  // ⚠️ 必须在首次 import config/generate 之前注入 (config 模块加载时读 env)
  process.env.COMFYUI_URL = `http://127.0.0.1:${stub.port}`;
  process.env.OUTPUT_DIR = tmpOutDir;
  process.env.KAP_VRAM_SKIP = "1";
  process.env.KAP_GPU_QUEUE_CROSSPROC = "off";
  const cfg = await import("../config");
  const expectStubUrl = `http://127.0.0.1:${stub.port}`;
  const hermetic = cfg.H3_CONFIG.comfyuiUrl !== expectStubUrl || cfg.H3_CONFIG.outputDir !== tmpOutDir
    ? {
        ok: false as const,
        reason:
          `config.comfyuiUrl=${cfg.H3_CONFIG.comfyuiUrl} (期望 stub ${expectStubUrl}), ` +
          `config.outputDir=${cfg.H3_CONFIG.outputDir} — env 注入失效 (config 模块被提前加载); ` +
          `入口脚本不得在调用测试前 import 任何 minimax-h3 业务模块`,
      }
    : { ok: true as const };
  const gen = await import("../generate");
  const ref2va = await import("../ref2va");

  const app = express();
  app.use("/api/production/minimax-h3/generate", gen.default);
  app.use("/api/production/minimax-h3/ref2va", ref2va.default);
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const appPort = (server.address() as AddressInfo).port;
  ctxRef = {
    cfg,
    gen,
    ref2va,
    stub,
    tmpOutDir,
    appPort,
    appClose: () => new Promise<void>((r) => server.close(() => r())),
    hermetic,
  };
  return ctxRef;
}

/** 收尾: 关闭 stub 与 express server (否则事件循环不空, 进程不退出) */
export async function teardownCtx(): Promise<void> {
  if (!ctxRef) return;
  const { appClose, stub } = ctxRef;
  ctxRef = null;
  await appClose();
  await stub.close();
}

/** e2e 封闭性硬守卫 (同 blockCache.test.ts round-3): 不过 → 整套 SKIP, 不发真实请求 */
async function verifyStubInEffect(ctx: TestCtx): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!ctx.hermetic.ok) {
    return { ok: false, reason: ctx.hermetic.reason };
  }
  const stubUrl = `http://127.0.0.1:${ctx.stub.port}`;
  try {
    const resp = await axios.get(`${stubUrl}/__stub_identity__`, { timeout: 2_000 });
    if (resp.status !== 200 || resp.data?.stub !== "h3-vdn-test" || resp.data?.magic !== ctx.stub.magic) {
      return {
        ok: false,
        reason: `回环探针应答异常 (status=${resp.status} body=${JSON.stringify(resp.data)?.slice(0, 120)})`,
      };
    }
  } catch (err: any) {
    return { ok: false, reason: `回环探针失败: ${err?.message || String(err)}` };
  }
  return { ok: true };
}

async function postForm(
  ctx: TestCtx,
  pathUnderApp: string,
  fields: Record<string, string>,
): Promise<{ status: number; json: any; desc: string }> {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  const resp = await fetch(`http://127.0.0.1:${ctx.appPort}${pathUnderApp}`, {
    method: "POST",
    body: form,
  });
  const json = await resp.json().catch(() => null);
  return { status: resp.status, json, desc: `status=${resp.status} body=${JSON.stringify(json)?.slice(0, 300)}` };
}

/** 最近一次提交到 stub 的工作流 (因果序上在 handler 响应前必已收到; 留 ≤2s 兜底) */
async function lastSubmittedWf(ctx: TestCtx): Promise<Record<string, any> | null> {
  let submitted = ctx.stub.prompts[ctx.stub.prompts.length - 1];
  for (let i = 0; i < 40 && !submitted; i++) {
    await sleep(50);
    submitted = ctx.stub.prompts[ctx.stub.prompts.length - 1];
  }
  return submitted?.wf ?? null;
}

// ─── T1: 配置层 — 白名单 / H3_PROFILES / H3_VDN 蓝图一致性 ─────────────────

export async function testProfileConfig(): Promise<TestResult[]> {
  const { cfg } = await setupCtx();
  const results: TestResult[] = [];

  check(results,
    cfg.H3_EXPOSED_PROFILES.includes("vdn-8"),
    "H3_EXPOSED_PROFILES 白名单含 vdn-8 (profile 校验接受)");
  check(results,
    (cfg.H3_PROFILES as any)["vdn-8"] !== undefined,
    "H3_PROFILES 有 vdn-8 定义");
  const p = (cfg.H3_PROFILES as any)["vdn-8"];
  check(results,
    !!p && p.steps === 8 && p.skipFoley === true &&
    p.turbo === false && p.native === false && p.tespeed === false,
    "vdn-8 preset: steps=8 / skipFoley / turbo=native=tespeed=false",
    JSON.stringify(p));
  check(results,
    typeof p?.label === "string" && p.label.includes("VDN") && p.label.includes("8-step"),
    "vdn-8 label 注明 8步 + VDN adapter",
    p?.label);

  // H3_VDN 与 0907 获胜臂蓝图 (/tmp/case08_241_dual.py VDN_CHAIN) 逐字一致
  const v = cfg.H3_VDN;
  check(results,
    v.classType === "ApplyVDNH3" &&
    v.checkpoint === "vdn-minimax-h3-int8-convrot-comfyui" &&
    v.applyTurboAdapter === true &&
    v.strength === 1.0 &&
    v.loraMode === "merge" &&
    v.branchWeights === "stream" &&
    v.retainBuffers === "off" &&
    v.attentionBackend === "flex" &&
    v.verbose === true,
    "H3_VDN ApplyVDNH3 全参数 = 0907 获胜臂蓝图逐字一致",
    JSON.stringify(v));
  check(results,
    v.steps === 8 && v.samplerName === "er_sde" && v.scheduler === "beta" && v.denoise === 1.0,
    "H3_VDN 采样: er_sde + beta + 8 步 + denoise 1.0",
    JSON.stringify(v));
  check(results,
    v.maxFrames === 241,
    "H3_VDN.maxFrames = 241 (0907 实测 OOM 边界)",
    String(v.maxFrames));
  return results;
}

// ─── T2: builder 层 — 三模式构图断言 (红线 ②) ──────────────────────────────

export async function testVdnGraphBuilders(): Promise<TestResult[]> {
  const { cfg, gen } = await setupCtx();
  const results: TestResult[] = [];
  const VDN = cfg.H3_VDN.nodeId; // "15"

  const base = {
    prompt: "a girl walks along a rainy neon street at night",
    width: 1216,
    height: 672,
    length: 97,
    seed: 20260908,
    stepsOverride: null,
    filenamePrefix: "vdn_test",
    refVideoFilename: null,
  } as const;

  const cases = [
    { mode: "t2va" as const, firstFrameFilename: null, refImageFilenames: [] as string[] },
    { mode: "i2va" as const, firstFrameFilename: "vdn_first.png", refImageFilenames: [] as string[] },
    { mode: "ref2va" as const, firstFrameFilename: null, refImageFilenames: ["vdn_r1.jpg", "vdn_r2.jpg", "vdn_r3.png"] },
  ];

  for (const c of cases) {
    const wf = gen.buildH3WorkflowVDN({ ...base, ...c });
    const vdnNode = wf[VDN];

    // ApplyVDNH3 节点 + 全参数
    check(results,
      !!vdnNode && vdnNode.class_type === "ApplyVDNH3",
      `${c.mode}: ApplyVDNH3 节点在位 (id=${VDN})`);
    check(results,
      JSON.stringify(vdnNode?.inputs) === JSON.stringify({
        model: ["12", 0],
        vdn_checkpoint: cfg.H3_VDN.checkpoint,
        apply_turbo_adapter: true,
        strength: 1.0,
        lora_mode: "merge",
        branch_weights: "stream",
        retain_buffers: "off",
        attention_backend: "flex",
        verbose: true,
      }),
      `${c.mode}: ApplyVDNH3 inputs 逐字段正确 (model=[12,0] + 蓝图全参数)`,
      JSON.stringify(vdnNode?.inputs));

    // 互斥红线: 无 LoRA / 无 SigmaShift / 无 T8 节点 / 无 TESpeed
    const wfStr = JSON.stringify(wf);
    check(results,
      !wfStr.includes("LoraLoaderModelOnly") && !wfStr.includes("LoraLoaderBypassModelOnly"),
      `${c.mode}: 图中不含任何 LoRA loader (互斥红线)`);
    check(results,
      !wfStr.includes("MiniMaxH3SigmaShift"),
      `${c.mode}: 图中不含 SigmaShift 节点 (8 步链自带 shift 语义)`);
    check(results,
      !wfStr.includes("MiniMaxH3DualClockSamplerT8") &&
      !wfStr.includes("MiniMaxH3AudioConditioningT8") &&
      !wfStr.includes("MiniMaxH3AVDecodeT8"),
      `${c.mode}: 图中不含 T8 节点`);
    check(results,
      !wfStr.includes("TESpeed"),
      `${c.mode}: 图中不含 TESpeed 节点 (互斥红线)`);

    // 基模 / 采样链
    check(results,
      wf["12"].inputs.unet_name === "minimax_h3_fl2va_int8_convrot.safetensors",
      `${c.mode}: UNETLoader 基模 = int8_convrot`,
      wf["12"].inputs.unet_name);
    check(results,
      wf["30"].class_type === "KSamplerSelect" && wf["30"].inputs.sampler_name === "er_sde",
      `${c.mode}: KSamplerSelect = er_sde`);
    check(results,
      wf["31"].class_type === "BasicScheduler" &&
      wf["31"].inputs.scheduler === "beta" &&
      wf["31"].inputs.steps === 8 &&
      wf["31"].inputs.denoise === 1.0 &&
      JSON.stringify(wf["31"].inputs.model) === JSON.stringify([VDN, 0]),
      `${c.mode}: BasicScheduler = beta/8步/denoise1.0, model=[${VDN},0]`,
      JSON.stringify(wf["31"]?.inputs));
    check(results,
      wf["33"].class_type === "BasicGuider" &&
      JSON.stringify(wf["33"].inputs.model) === JSON.stringify([VDN, 0]) &&
      JSON.stringify(wf["33"].inputs.conditioning) === JSON.stringify(["20", 0]),
      `${c.mode}: BasicGuider model=[${VDN},0] (VDN 输出, 非 [12,0])`);
    check(results,
      wf["34"].class_type === "SamplerCustomAdvanced" &&
      JSON.stringify(wf["34"].inputs.latent_image) === JSON.stringify(["20", 1]) &&
      JSON.stringify(wf["34"].inputs.sigmas) === JSON.stringify(["31", 0]),
      `${c.mode}: SamplerCustomAdvanced 接线正确`);
  }

  // ref2va 专属: ReferenceToVideo + 点号键 + ref_image_size + LoadImage 槽位
  const wfR2V = gen.buildH3WorkflowVDN({
    ...base, mode: "ref2va",
    firstFrameFilename: null, refImageFilenames: ["vdn_r1.jpg", "vdn_r2.jpg", "vdn_r3.png"],
  });
  check(results,
    wfR2V["20"].class_type === "MiniMaxH3ReferenceToVideo" &&
    wfR2V["20"].inputs.ref_image_size === "match",
    "ref2va: 条件节点 = MiniMaxH3ReferenceToVideo + ref_image_size=match");
  check(results,
    JSON.stringify(wfR2V["20"].inputs["ref_images.ref_image_0"]) === JSON.stringify(["14", 0]) &&
    JSON.stringify(wfR2V["20"].inputs["ref_images.ref_image_1"]) === JSON.stringify(["141", 0]) &&
    JSON.stringify(wfR2V["20"].inputs["ref_images.ref_image_2"]) === JSON.stringify(["142", 0]),
    "ref2va: autogrow 点号键 ref_images.ref_image_N → [14/141/142,0]");
  check(results,
    wfR2V["14"].inputs.image === "vdn_r1.jpg" &&
    wfR2V["141"].inputs.image === "vdn_r2.jpg" &&
    wfR2V["142"].inputs.image === "vdn_r3.png",
    "ref2va: LoadImage 槽位 14/141/142 就位");

  // i2va 专属: ImageToVideo + first_frame
  const wfI2V = gen.buildH3WorkflowVDN({
    ...base, mode: "i2va",
    firstFrameFilename: "vdn_first.png", refImageFilenames: [],
  });
  check(results,
    wfI2V["20"].class_type === "MiniMaxH3ImageToVideo" &&
    JSON.stringify(wfI2V["20"].inputs.first_frame) === JSON.stringify(["14", 0]) &&
    wfI2V["14"].inputs.image === "vdn_first.png",
    "i2va: ImageToVideo + first_frame=[14,0]");

  // t2va 专属: 无图输入
  const wfT2V = gen.buildH3WorkflowVDN({
    ...base, mode: "t2va",
    firstFrameFilename: null, refImageFilenames: [],
  });
  check(results,
    wfT2V["20"].class_type === "MiniMaxH3ImageToVideo" &&
    wfT2V["20"].inputs.first_frame === undefined &&
    wfT2V["14"] === undefined,
    "t2va: ImageToVideo 无图输入 (无 14 节点)");

  // stepsOverride 覆盖
  const wfOvr = gen.buildH3WorkflowVDN({
    ...base, mode: "t2va", stepsOverride: 5,
    firstFrameFilename: null, refImageFilenames: [],
  });
  check(results,
    wfOvr["31"].inputs.steps === 5,
    "stepsOverride=5 → BasicScheduler steps=5 (显式优先)");
  return results;
}

// ─── T3/T4/T5: /generate handler e2e — 守卫 400 + 路由到 VDN 图 (stub 封闭) ─

export async function testHandlerE2e(): Promise<TestResult[]> {
  const ctx = await setupCtx();
  const guard = await verifyStubInEffect(ctx);
  if (!guard.ok) {
    return [{
      name: "/generate handler e2e — SKIP (非封闭环境, 未发送任何请求)",
      pass: false,
      skip: true,
      detail: guard.reason,
    }];
  }
  const { cfg } = ctx;
  const results: TestResult[] = [];

  const e2eBase: Record<string, string> = {
    projectId: "1",
    prompt: "a girl walks along a rainy neon street at night",
    mode: "t2va",           // 无图入参: 避免 docker cp 触碰真实容器 (ref2va 图由 T2 覆盖)
    profile: "vdn-8",
    width: "1216",
    height: "672",
    seed: "20260908",
    filenamePrefix: "vdn_e2e",
  };

  // ① 正常路由: vdn-8 → 200, 提交图 = ApplyVDNH3 链
  const ok = await postForm(ctx, "/api/production/minimax-h3/generate", { ...e2eBase, length: "97" });
  check(results, ok.status === 200, `vdn-8 t2va 1216×672 length=97 → 200 (${ok.desc})`);
  const wf = await lastSubmittedWf(ctx);
  check(results,
    !!wf && wf[cfg.H3_VDN.nodeId]?.class_type === "ApplyVDNH3" &&
    wf["30"]?.inputs?.sampler_name === "er_sde" && wf["31"]?.inputs?.scheduler === "beta",
    "e2e 提交图: ApplyVDNH3 + er_sde/beta (路由分支正确, 未落入 T8)",
    wf ? JSON.stringify(Object.keys(wf).join(",")) : "图未捕获");
  check(results, ok.json?.data?.profile === "vdn-8", "e2e 响应 payload profile=vdn-8");

  // ② 241f 硬边界: length>241 → 400 (raw 227..241 对齐 243 亦拒)
  for (const [len, why] of [["300", "超边界"], ["241", "网格对齐后 243 > 241 亦拒"]] as const) {
    const r = await postForm(ctx, "/api/production/minimax-h3/generate", { ...e2eBase, length: len });
    check(results,
      r.status === 400 && JSON.stringify(r.json).includes("241"),
      `length=${len} (${why}) → 400 且文案含边界 241`,
      r.desc);
  }
  // ②b 最大网格值 226 放行
  const r226 = await postForm(ctx, "/api/production/minimax-h3/generate", { ...e2eBase, length: "226" });
  check(results, r226.status === 200, `length=226 (最大网格值) → 200 放行 (${r226.desc})`);

  // ③ 互斥: 显式 turbo / native → 400
  const rt = await postForm(ctx, "/api/production/minimax-h3/generate", { ...e2eBase, turbo: "true" });
  check(results,
    rt.status === 400 && JSON.stringify(rt.json).includes("互斥"),
    "vdn-8 + 显式 turbo=true → 400 互斥拒绝",
    rt.desc);
  const rn = await postForm(ctx, "/api/production/minimax-h3/generate", { ...e2eBase, native: "true" });
  check(results,
    rn.status === 400 && JSON.stringify(rn.json).includes("互斥"),
    "vdn-8 + 显式 native=true → 400 互斥拒绝",
    rn.desc);

  // ④ 回归红线: 不传 profile 的默认档仍走 lightx2v-8-768p (不切默认档)
  const { profile: _drop, ...noProfile } = e2eBase;
  const dflt = await postForm(ctx, "/api/production/minimax-h3/generate", noProfile);
  const wfDflt = await lastSubmittedWf(ctx);
  check(results,
    dflt.status === 200 && dflt.json?.data?.profile === "lightx2v-8-768p" &&
    !!wfDflt && wfDflt["15"]?.class_type === "LoraLoaderModelOnly",
    "无 profile 默认档回归: 仍 lightx2v-8-768p (LoRA 链, 不因 VDN 集成漂移)",
    `${dflt.desc}; wf15=${wfDflt?.["15"]?.class_type}`);

  // ⑤ per-mode 路由 vdn-8 → 400 指引 /generate (d3eb69e0 模式)
  const pm = await postForm(ctx, "/api/production/minimax-h3/ref2va", {
    projectId: "1",
    prompt: "per-mode guard probe",
    profile: "vdn-8",
  });
  check(results,
    pm.status === 400 && JSON.stringify(pm.json).includes("ApplyVDNH3 workflow chain"),
    "per-mode /ref2va 收 vdn-8 → 400 指引 /generate (防静默降级 T8)",
    pm.desc);
  return results;
}
