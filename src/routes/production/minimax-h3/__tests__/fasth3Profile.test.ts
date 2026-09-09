/**
 * fasth3Profile.test.ts — H3 FastH3 引擎臂 (profile="fasth3", dense 蒸馏 LoRA) 集成单测 (2026-09-09)。
 *
 * Project convention (Pitfalls B3): no vitest/jest at repo root. Plain TypeScript
 * module exporting async test functions; the runnable entrypoint is
 * `scripts/verify-h3-fasth3.ts` (tsx + check()/results[] pattern,
 * mirrors vdnProfile.test.ts / verify-h3-vdn.ts)。
 *
 * 被测对象 (任务: FastH3 5步档正式集成 KAP, 新增可选 profile fasth3, 不切默认):
 * - config.ts   — H3_FASTH3 配置块 / H3ProfileName / H3_PROFILES / H3_EXPOSED_PROFILES
 * - generate.ts — loraShiftConfig fasth3 分支 (buildH3WorkflowLightX2V 泛化拓扑, 无新 builder)
 * - t2va/i2va/ref2va.ts — per-mode 路由 fasth3 400 拒绝 (d3eb69e0 模式)
 *
 * 契约清单:
 *  ① profile 校验接受 fasth3: H3_EXPOSED_PROFILES 含 fasth3 且 H3_PROFILES 定义齐全
 *     (steps=5 / skipFoley / turbo=native=tespeed=false); H3_FASTH3 参数与 0909 A/B
 *     获胜臂蓝图口径逐字一致 (权重名 / strength 1.0 / 5 步 / shift 6,3 / euler+simple)。
 *  ② 默认档不漂移 (红线): H3_USE_CASES / H3_PREVIEW_MOTION_ROUTES 均不指向 fasth3。
 *  ③ 三模式 (t2va/i2va/ref2va) 构图: 12(UNET fl2va_int8_convrot) → 14_shift(SigmaShift
 *     6/3) → 15(LoraLoaderModelOnly, strength 1.0) → 30/31/33/34 采样链 (euler + simple
 *     + 5 步 + denoise 1.0); 无 ApplyVDNH3 / 无 T8 节点 / 无 TESpeed; ref2va 点号键 +
 *     ref_image_size="match"; stepsOverride 显式优先。
 *  ④ /generate e2e: fasth3 t2va → 200 且提交图 = LoRA 链 (路由分支正确, 未落入 T8);
 *     vdn-8 共存回归; 无 profile 默认档仍 lightx2v-8-768p。
 *  ⑤ per-mode 路由 (t2va/i2va/ref2va) 收 fasth3 → 400 指引 /generate (防静默降级 T8)。
 *
 * 隔离手法 (同 vdnProfile.test.ts):
 * - config/generate 经动态 import 加载 — env 先注入; KAP_VRAM_SKIP=1 不碰真 GPU;
 *   KAP_GPU_QUEUE_CROSSPROC=off 进程内锁。e2e 用本地 stub ComfyUI (回环标记端点
 *   探针硬守卫, 非封闭环境整套 SKIP, 不发任何越出回环的请求)。
 * - e2e 用 mode=t2va (无图入参) — 避免 copyToContainer docker cp 触碰真实容器;
 *   i2va/ref2va 的图构造由 builder 层 T2 覆盖 (buildH3WorkflowLightX2V 已为测试
 *   导出, 同 buildH3WorkflowT8/Native/VDN 先例)。
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
      res.end(JSON.stringify({ stub: "h3-fasth3-test", magic }));
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
  t2va: typeof import("../t2va");
  i2va: typeof import("../i2va");
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
  const tmpOutDir = fs.mkdtempSync(path.join(os.tmpdir(), "h3-fasth3-test-out-"));
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
  const t2va = await import("../t2va");
  const i2va = await import("../i2va");
  const ref2va = await import("../ref2va");

  const app = express();
  app.use("/api/production/minimax-h3/generate", gen.default);
  app.use("/api/production/minimax-h3/t2va", t2va.default);
  app.use("/api/production/minimax-h3/i2va", i2va.default);
  app.use("/api/production/minimax-h3/ref2va", ref2va.default);
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const appPort = (server.address() as AddressInfo).port;
  ctxRef = {
    cfg,
    gen,
    t2va,
    i2va,
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

/** e2e 封闭性硬守卫 (同 vdnProfile.test.ts): 不过 → 整套 SKIP, 不发真实请求 */
async function verifyStubInEffect(ctx: TestCtx): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!ctx.hermetic.ok) {
    return { ok: false, reason: ctx.hermetic.reason };
  }
  const stubUrl = `http://127.0.0.1:${ctx.stub.port}`;
  try {
    const resp = await axios.get(`${stubUrl}/__stub_identity__`, { timeout: 2_000 });
    if (resp.status !== 200 || resp.data?.stub !== "h3-fasth3-test" || resp.data?.magic !== ctx.stub.magic) {
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

// ─── T1: 配置层 — 白名单 / H3_PROFILES / H3_FASTH3 蓝图一致性 / 默认档红线 ──

export async function testProfileConfig(): Promise<TestResult[]> {
  const { cfg } = await setupCtx();
  const results: TestResult[] = [];

  check(results,
    cfg.H3_EXPOSED_PROFILES.includes("fasth3"),
    "H3_EXPOSED_PROFILES 白名单含 fasth3 (profile 校验接受)");
  check(results,
    (cfg.H3_PROFILES as any)["fasth3"] !== undefined,
    "H3_PROFILES 有 fasth3 定义");
  const p = (cfg.H3_PROFILES as any)["fasth3"];
  check(results,
    !!p && p.steps === 5 && p.skipFoley === true &&
    p.turbo === false && p.native === false && p.tespeed === false,
    "fasth3 preset: steps=5 / skipFoley / turbo=native=tespeed=false",
    JSON.stringify(p));
  check(results,
    typeof p?.label === "string" && p.label.includes("FastH3") && p.label.includes("5-step"),
    "fasth3 label 注明 FastH3 + 5-step",
    p?.label);

  // H3_FASTH3 与 0909 A/B 获胜臂蓝图口径逐字一致 (蓝图脚本为 /tmp 临时件未随台账
  // 留存 — 参数面以本块常量为权威, 工单条款3核对: 5步/shift 6,3/euler+simple/1.0)
  const f = cfg.H3_FASTH3;
  check(results,
    f.loraName === "minimax_h3_fasth3_4step_dense_datafree_comfyui.safetensors" &&
    f.strengthModel === 1.0,
    "H3_FASTH3 权重名 + strength_model=1.0 (合并型 LoraLoaderModelOnly 口径)",
    JSON.stringify(f));
  check(results,
    f.steps === 5 && f.shiftVideo === 6.0 && f.shiftAudio === 3.0 && f.denoise === 1.0,
    "H3_FASTH3 采样口径: 5 步 (4蒸馏+1终步) / shift 6,3 (768p 家族) / denoise 1.0",
    JSON.stringify(f));
  check(results,
    f.samplerName === "euler" && f.scheduler === "simple" &&
    f.nodeId === "15" && f.loaderClassType === "LoraLoaderModelOnly",
    "H3_FASTH3 节点槽位: euler + simple + 节点15 LoraLoaderModelOnly",
    JSON.stringify(f));

  // 默认档红线 (不切默认): useCase / motion 路由均不指向 fasth3
  check(results,
    Object.values(cfg.H3_USE_CASES).every((u: any) => u.profile !== "fasth3"),
    "H3_USE_CASES 无任何 useCase 指向 fasth3 (useCase 映射不动)",
    JSON.stringify(Object.values(cfg.H3_USE_CASES).map((u: any) => u.profile)));
  check(results,
    Object.values(cfg.H3_PREVIEW_MOTION_ROUTES).every((r: any) => r.profile !== "fasth3"),
    "H3_PREVIEW_MOTION_ROUTES 无任何 motion 档指向 fasth3 (motion 路由不动)");
  check(results,
    JSON.stringify(cfg.H3_EXPOSED_USE_CASES) === JSON.stringify(["preview-lock", "final-shot"]),
    "H3_EXPOSED_USE_CASES 不动 (仍 preview-lock + final-shot)",
    JSON.stringify(cfg.H3_EXPOSED_USE_CASES));
  return results;
}

// ─── T2: builder 层 — 三模式构图断言 (契约 ③) ──────────────────────────────

export async function testFasth3GraphBuilders(): Promise<TestResult[]> {
  const { cfg, gen } = await setupCtx();
  const results: TestResult[] = [];
  const F = cfg.H3_FASTH3;

  const base = {
    prompt: "a girl walks along a rainy neon street at night",
    width: 1216,
    height: 672,
    length: 97,
    seed: 20260909,
    stepsOverride: null,
    filenamePrefix: "fasth3_test",
    refVideoFilename: null,
  } as const;

  const cases = [
    { mode: "t2va" as const, firstFrameFilename: null, refImageFilenames: [] as string[] },
    { mode: "i2va" as const, firstFrameFilename: "fasth3_first.png", refImageFilenames: [] as string[] },
    { mode: "ref2va" as const, firstFrameFilename: null, refImageFilenames: ["fasth3_r1.jpg", "fasth3_r2.jpg", "fasth3_r3.png"] },
  ];

  for (const c of cases) {
    const wf = gen.buildH3WorkflowLightX2V({ ...base, ...c }, F);

    // 基模: 现役 fl2va int8_convrot (t2va/i2va/ref2va 同文件, REF2VA_MODEL=FL2VA_MODEL)
    check(results,
      wf["12"].class_type === "UNETLoader" &&
      wf["12"].inputs.unet_name === "minimax_h3_fl2va_int8_convrot.safetensors",
      `${c.mode}: UNETLoader 基模 = fl2va_int8_convrot (同 lightx2v-8-768p 臂)`,
      wf["12"]?.inputs?.unet_name);

    // SigmaShift: 6/3 (768p 家族口径), model=[12,0]
    check(results,
      wf["14_shift"].class_type === "MiniMaxH3SigmaShift" &&
      JSON.stringify(wf["14_shift"].inputs.model) === JSON.stringify(["12", 0]) &&
      wf["14_shift"].inputs.shift_video === 6.0 &&
      wf["14_shift"].inputs.shift_audio === 3.0,
      `${c.mode}: SigmaShift 节点 14_shift = shift 6/3, model=[12,0]`,
      JSON.stringify(wf["14_shift"]?.inputs));

    // LoRA: 节点15 LoraLoaderModelOnly, strength 1.0, model=[14_shift,0]
    check(results,
      wf[F.nodeId].class_type === "LoraLoaderModelOnly" &&
      wf[F.nodeId].inputs.lora_name === F.loraName &&
      wf[F.nodeId].inputs.strength_model === 1.0 &&
      JSON.stringify(wf[F.nodeId].inputs.model) === JSON.stringify(["14_shift", 0]),
      `${c.mode}: LoRA 节点15 = FastH3 权重 / strength 1.0 / model=[14_shift,0]`,
      JSON.stringify(wf[F.nodeId]?.inputs));

    // 采样链: euler + simple + 5 步 + denoise 1.0, model 一律接 [15,0] (LoRA 之后)
    check(results,
      wf["30"].class_type === "KSamplerSelect" && wf["30"].inputs.sampler_name === "euler",
      `${c.mode}: KSamplerSelect = euler`);
    check(results,
      wf["31"].class_type === "BasicScheduler" &&
      wf["31"].inputs.scheduler === "simple" &&
      wf["31"].inputs.steps === 5 &&
      wf["31"].inputs.denoise === 1.0 &&
      JSON.stringify(wf["31"].inputs.model) === JSON.stringify([F.nodeId, 0]),
      `${c.mode}: BasicScheduler = simple/5步/denoise1.0, model=[15,0]`,
      JSON.stringify(wf["31"]?.inputs));
    check(results,
      wf["33"].class_type === "BasicGuider" &&
      JSON.stringify(wf["33"].inputs.model) === JSON.stringify([F.nodeId, 0]) &&
      JSON.stringify(wf["33"].inputs.conditioning) === JSON.stringify(["20", 0]),
      `${c.mode}: BasicGuider model=[15,0] (LoRA 输出, 非 [12,0]/[14_shift,0])`);
    check(results,
      wf["34"].class_type === "SamplerCustomAdvanced" &&
      JSON.stringify(wf["34"].inputs.latent_image) === JSON.stringify(["20", 1]) &&
      JSON.stringify(wf["34"].inputs.sigmas) === JSON.stringify(["31", 0]),
      `${c.mode}: SamplerCustomAdvanced 接线正确`);

    // 互斥红线: 无 VDN / 无 T8 节点 / 无 TESpeed (非 T8、非 VDN 链路)
    const wfStr = JSON.stringify(wf);
    check(results,
      !wfStr.includes("ApplyVDNH3"),
      `${c.mode}: 图中不含 ApplyVDNH3 (非 VDN 链路)`);
    check(results,
      !wfStr.includes("MiniMaxH3DualClockSamplerT8") &&
      !wfStr.includes("MiniMaxH3AudioConditioningT8") &&
      !wfStr.includes("MiniMaxH3AVDecodeT8"),
      `${c.mode}: 图中不含 T8 节点`);
    check(results,
      !wfStr.includes("TESpeed"),
      `${c.mode}: 图中不含 TESpeed 节点`);
  }

  // ref2va 专属: ReferenceToVideo + 点号键 + ref_image_size + LoadImage 槽位
  const wfR2V = gen.buildH3WorkflowLightX2V({
    ...base, mode: "ref2va",
    firstFrameFilename: null, refImageFilenames: ["fasth3_r1.jpg", "fasth3_r2.jpg", "fasth3_r3.png"],
  }, F);
  check(results,
    wfR2V["20"].class_type === "MiniMaxH3ReferenceToVideo" &&
    wfR2V["20"].inputs.ref_image_size === "match",
    "ref2va: 条件节点 = MiniMaxH3ReferenceToVideo + ref_image_size=match");
  check(results,
    JSON.stringify(wfR2V["20"].inputs["ref_images.ref_image_0"]) === JSON.stringify(["14", 0]) &&
    JSON.stringify(wfR2V["20"].inputs["ref_images.ref_image_1"]) === JSON.stringify(["141", 0]) &&
    JSON.stringify(wfR2V["20"].inputs["ref_images.ref_image_2"]) === JSON.stringify(["142", 0]),
    "ref2va: autogrow 点号键 ref_images.ref_image_N → [14/141/142,0]");

  // i2va 专属: ImageToVideo + first_frame
  const wfI2V = gen.buildH3WorkflowLightX2V({
    ...base, mode: "i2va",
    firstFrameFilename: "fasth3_first.png", refImageFilenames: [],
  }, F);
  check(results,
    wfI2V["20"].class_type === "MiniMaxH3ImageToVideo" &&
    JSON.stringify(wfI2V["20"].inputs.first_frame) === JSON.stringify(["14", 0]) &&
    wfI2V["14"].inputs.image === "fasth3_first.png",
    "i2va: ImageToVideo + first_frame=[14,0]");

  // t2va 专属: 无图输入
  const wfT2V = gen.buildH3WorkflowLightX2V({
    ...base, mode: "t2va",
    firstFrameFilename: null, refImageFilenames: [],
  }, F);
  check(results,
    wfT2V["20"].class_type === "MiniMaxH3ImageToVideo" &&
    wfT2V["20"].inputs.first_frame === undefined &&
    wfT2V["14"] === undefined,
    "t2va: ImageToVideo 无图输入 (无 14 节点, 14_shift 不受影响)");

  // stepsOverride 覆盖: 显式 steps 优先于 H3_FASTH3.steps
  const wfOvr = gen.buildH3WorkflowLightX2V({
    ...base, mode: "t2va", stepsOverride: 9,
    firstFrameFilename: null, refImageFilenames: [],
  }, F);
  check(results,
    wfOvr["31"].inputs.steps === 9,
    "stepsOverride=9 → BasicScheduler steps=9 (显式优先)");
  return results;
}

// ─── T3: /generate + per-mode handler e2e — 路由分支 + 守卫 400 (stub 封闭) ──

export async function testHandlerE2e(): Promise<TestResult[]> {
  const ctx = await setupCtx();
  const guard = await verifyStubInEffect(ctx);
  if (!guard.ok) {
    return [{
      name: "/generate + per-mode handler e2e — SKIP (非封闭环境, 未发送任何请求)",
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
    mode: "t2va",           // 无图入参: 避免 docker cp 触碰真实容器 (i2va/ref2va 图由 T2 覆盖)
    profile: "fasth3",
    width: "1216",
    height: "672",
    seed: "20260909",
    filenamePrefix: "fasth3_e2e",
  };

  // ① 正常路由: fasth3 → 200, 提交图 = SigmaShift + FastH3 LoRA 链 (loraShiftConfig
  //    fasth3 分支命中, 未落入 T8/native/VDN)
  const ok = await postForm(ctx, "/api/production/minimax-h3/generate", { ...e2eBase, length: "97" });
  check(results, ok.status === 200, `fasth3 t2va 1216×672 length=97 → 200 (${ok.desc})`);
  const wf = await lastSubmittedWf(ctx);
  const F = cfg.H3_FASTH3;
  check(results,
    !!wf && wf[F.nodeId]?.class_type === "LoraLoaderModelOnly" &&
    wf[F.nodeId]?.inputs?.lora_name === F.loraName &&
    wf["14_shift"]?.class_type === "MiniMaxH3SigmaShift" &&
    wf["14_shift"]?.inputs?.shift_video === 6.0 && wf["14_shift"]?.inputs?.shift_audio === 3.0,
    "e2e 提交图: 节点15 FastH3 LoRA + SigmaShift 6/3 (loraShiftConfig fasth3 分支正确)",
    wf ? `wf15=${wf[F.nodeId]?.class_type} lora=${wf[F.nodeId]?.inputs?.lora_name?.slice(0, 30)}` : "图未捕获");
  check(results,
    !!wf && wf["30"]?.inputs?.sampler_name === "euler" &&
    wf["31"]?.inputs?.scheduler === "simple" && wf["31"]?.inputs?.steps === 5,
    "e2e 提交图: euler + simple + 5 步 (profile.steps 经 h3StepsOverride 生效)",
    wf ? `sampler=${wf["30"]?.inputs?.sampler_name} sched=${wf["31"]?.inputs?.scheduler} steps=${wf["31"]?.inputs?.steps}` : "图未捕获");
  check(results, ok.json?.data?.profile === "fasth3", "e2e 响应 payload profile=fasth3");

  // ② 显式 steps 覆盖: steps=9 → BasicScheduler 9 (显式 steps > profile.steps)
  const ovr = await postForm(ctx, "/api/production/minimax-h3/generate", { ...e2eBase, length: "97", steps: "9" });
  const wfOvr = await lastSubmittedWf(ctx);
  check(results,
    ovr.status === 200 && wfOvr?.["31"]?.inputs?.steps === 9,
    "e2e steps=9 显式覆盖 → BasicScheduler steps=9",
    `${ovr.desc}; steps=${wfOvr?.["31"]?.inputs?.steps}`);

  // ③ vdn-8 共存回归: elif 链互不抢分支 (fasth3 分支不劫持 vdn-8)
  const vdn = await postForm(ctx, "/api/production/minimax-h3/generate", {
    ...e2eBase, profile: "vdn-8", filenamePrefix: "fasth3_e2e_vdn",
  });
  const wfVdn = await lastSubmittedWf(ctx);
  check(results,
    vdn.status === 200 && wfVdn?.[cfg.H3_VDN.nodeId]?.class_type === "ApplyVDNH3",
    "vdn-8 共存回归: 仍走 ApplyVDNH3 链 (fasth3 分支未劫持)",
    `${vdn.desc}; wf15=${wfVdn?.["15"]?.class_type}`);

  // ④ 回归红线: 不传 profile 的默认档仍走 lightx2v-8-768p (不切默认档)
  const { profile: _drop, ...noProfile } = e2eBase;
  const dflt = await postForm(ctx, "/api/production/minimax-h3/generate", noProfile);
  const wfDflt = await lastSubmittedWf(ctx);
  check(results,
    dflt.status === 200 && dflt.json?.data?.profile === "lightx2v-8-768p" &&
    !!wfDflt && wfDflt["15"]?.class_type === "LoraLoaderModelOnly",
    "无 profile 默认档回归: 仍 lightx2v-8-768p (LoRA 链, 不因 FastH3 集成漂移)",
    `${dflt.desc}; wf15=${wfDflt?.["15"]?.class_type}`);

  // ⑤ per-mode 三路由 fasth3 → 400 指引 /generate (d3eb69e0 模式, 防静默降级 T8)
  for (const mode of ["t2va", "i2va", "ref2va"] as const) {
    const pm = await postForm(ctx, `/api/production/minimax-h3/${mode}`, {
      projectId: "1",
      prompt: "per-mode guard probe",
      profile: "fasth3",
    });
    check(results,
      pm.status === 400 && JSON.stringify(pm.json).includes("FastH3 loraShift workflow chain"),
      `per-mode /${mode} 收 fasth3 → 400 指引 /generate (防静默降级 T8)`,
      pm.desc);
  }
  return results;
}
