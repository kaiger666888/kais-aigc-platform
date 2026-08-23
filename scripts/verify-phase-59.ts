#!/usr/bin/env tsx
/**
 * verify-phase-59.ts — Phase 59 (narrow-trigger-stale-cascade) aggregate
 * contract gate. 59-01 先落 S1 + S2 骨架,59-02 起在此聚合行为级断言。
 *
 *   S1 双向路径翻译(59-01 Task 1):
 *     fsToOssUrl 引擎 outputs.* 容器路径(/mnt/agents/output/...)→ /oss/ web
 *     路径分支(断点②);ossToEnginePath /oss/→宿主双根白名单翻译 + `..`
 *     穿越拒绝(T-59-01 缓解)。
 *   S2 fake 引擎三模式(59-01 Task 2):
 *     进程内 http.createServer 起 stub :8002;completed/failed/提交体捕获。
 *     pollEngineTask 读 raw.outputs.*(断点①) + ref_images/model_preference
 *     提交体形(断点④ + A3)。baseUrl() 运行时读 process.env.GOLD_TEAM_URL,
 *     fake 引擎 set env 后直调,无需 spawn。
 *   S3/S4 spawn dispatch 行为断言(59-02 Task 3):
 *     每模式 spawn scripts/verify-59-dispatch.ts(49-01 教训:端点 dispatch 的
 *     app-db knex 池不落共享进程)——cwd=mkdtemp 隔离空库 + --tsconfig 显式指向
 *     repo(子进程 cwd 无 repo tsconfig,@/ 不解析,实证)。四模式:
 *       cascade(D-01 级联+node:updated 契约+seed 777+D-05 reload 保真) /
 *       engine-fail(D-02 失败零标记)/ no-marker(负向#1 ContextMenu 路径) /
 *       orchestrate(非空洞负向#2:关系表目标真执行+零 stale——blob 从未写入)。
 *     59-fix r2 追加: orchestrate-legacy(WR-01 兜底)/ import-guard(CR-04/WR-06
 *     workdir 守卫四探针)/ seed-precedence(IN-05 专用 seed 通道优先)。
 *     fake 引擎常驻本进程(completed/failed 可切换,POST 捕获体跨模式累积)。
 *   S5 客户端静态断言(59-04 Task 3):
 *     useCanvasSocket node:updated 订阅(独立 handler,FLAG-3 红线:转发不得进
 *     normalizeSocketNodeState 调用链)/ FlowCanvas onNodeUpdated→triggerStaleCascade /
 *     canvasApi regenSource 类型 / panel-regen·reroll-seed 两发射点。
 *   S6 命令门(verify-phase-58 同款):三根 tsc + 双包 vitest
 *     (flowgraph-v3 全量含 stale.test.ts——D-03 语义基线回归)。
 *   Forced-failure self-check — must-fail 断言组;意外 PASS 整门红。
 *
 * Isolation guard (verify-phase-51 pattern, line-for-line): _engine.ts
 * 传递 import import-from-dir.ts → @/utils/db,其 import-time IIFE 从
 * process.cwd()/data 解析 sqlite。mkdtemp + chdir BEFORE the dynamic
 * imports → boot 在临时目录建空 db,生产库绝不被本门打开。
 *
 * Run: npm run verify:phase-59   (or: npx tsx scripts/verify-phase-59.ts)
 * Exit: 0 all sections pass + self-check behaves / 1 any failure / 2 crash
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn, spawnSync } from "node:child_process";

interface TestResult { name: string; pass: boolean; detail?: string; }
const results: TestResult[] = [];
function assert(cond: boolean, name: string, detail?: string): void {
  results.push({ name, pass: cond, detail });
  console.log(`  ${cond ? "PASS" : "FAIL"}: ${name}${detail ? " — " + detail : ""}`);
}

const REPO_ROOT = path.resolve(__dirname, "..");
function read(rel: string): string {
  const p = path.join(REPO_ROOT, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
}
function exists(rel: string): boolean {
  return fs.existsSync(path.join(REPO_ROOT, rel));
}

/** S6 命令门:cwd + 命令,tail 摘要;非零 exit 红。 */
function runCmd(name: string, cwdRel: string, cmd: string, tailLines = 3): void {
  const res = spawnSync(cmd, {
    cwd: path.join(REPO_ROOT, cwdRel),
    shell: true,
    encoding: "utf8",
    timeout: 300_000,
    // WR-01: 命令不再经 shell 管道,stdout/stderr 全量捕获——默认 1MB maxBuffer
    // 会被 vitest 全量输出撑爆(res.error=ENOBUFS 之外 status=null 假红),放大到 16MB。
    maxBuffer: 16 * 1024 * 1024,
  });
  const out = (res.stdout ?? "") + (res.stderr ?? "");
  const tail = out.split("\n").filter((l) => l.trim().length > 0).slice(-tailLines).join(" | ");
  assert(
    res.status === 0,
    `S6 cmd: ${name} (exit ${res.status})`,
    res.status === 0 ? tail.slice(0, 160) : tail.slice(-300),
  );
}

// ── Isolation chdir (see header) — MUST precede the dynamic imports ────────
const ISOLATION_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "verify-phase-59-"));
// Transitive module graph quirk: src/utils/writeVersion.ts parses package.json
// from process.cwd() at import time — stage a copy so the chdir stays safe.
fs.copyFileSync(path.join(REPO_ROOT, "package.json"), path.join(ISOLATION_DIR, "package.json"));
process.chdir(ISOLATION_DIR);

async function main(): Promise<void> {
  console.log("=== Phase 59 — verify-phase-59.ts (aggregate gate: 窄触发 stale 级联 + execute 链四断点修真, plans 59-01..59-04) ===\n");

  // 动态 import 必须在 chdir 之后(@/utils/db IIFE 才落到隔离目录)。
  const engineMod = await import("../src/routes/canvas/_engine");
  const importMod = await import("../src/routes/canvas/v2/import-from-dir");
  const { ossToEnginePath } = engineMod;
  const { fsToOssUrl } = importMod;

  // ═══ S1 — 双向路径翻译(59-01 Task 1) ═══════════════════════════════════
  console.log("=== S1 双向路径翻译: fsToOssUrl(出向:引擎容器路径→/oss/ web) ↔ ossToEnginePath(入向:/oss/→宿主双根白名单) ===");

  // 断点②: 引擎 outputs.* 容器路径 → /oss/ web 路径
  assert(
    fsToOssUrl("/mnt/agents/output/jimeng_x/output.png") === "/oss/jimeng_x/output.png",
    "S1: fsToOssUrl 翻译 /mnt/agents/output/ 前缀为 /oss/(断点②)",
  );
  // 既有分支回归: /oss/ 与 http(s) 透传不变
  assert(
    fsToOssUrl("/oss/a.png") === "/oss/a.png",
    "S1: fsToOssUrl /oss/ 输入原样透传",
  );
  assert(
    fsToOssUrl("https://cdn.example/x.png") === "https://cdn.example/x.png",
    "S1: fsToOssUrl http(s) 输入原样透传(覆盖 cloud 引擎 CDN 直链形态)",
  );

  // T-59-01 穿越拒绝: /oss/ 前缀含 `..` 上溯 → null
  assert(
    ossToEnginePath("/oss/../../etc/passwd") === null,
    "S1: ossToEnginePath 拒绝 /oss/../../etc/passwd(T-59-01 穿越)",
  );
  assert(
    ossToEnginePath("/oss/a/../../b") === null,
    "S1: ossToEnginePath 拒绝 /oss/a/../../b(规范化后仍上溯)",
  );

  // 双根白名单: 写入 data/oss/__v59_probe/t.png → ossToEnginePath 命中第二个根。
  // fixture 写在 ossToEnginePath 实际探测的字面量根(_engine.ts L86 部署契约,
  // IN-03 已记录)——gate 从任意 checkout 位置(含 git worktree)跑均自洽,
  // 不依赖 REPO_ROOT 与部署字面量重合。
  const OSS_ROOT_LITERAL = "/data/workspace/kais-aigc-platform/data/oss";
  const probeRel = "__v59_probe/t.png";
  const probeAbs = path.join(OSS_ROOT_LITERAL, probeRel);
  fs.mkdirSync(path.dirname(probeAbs), { recursive: true });
  try {
    fs.writeFileSync(probeAbs, Buffer.from([0x89, 0x50, 0x4e, 0x47])); // PNG magic stub
    const translated = ossToEnginePath(`/oss/${probeRel}`);
    assert(
      translated === probeAbs,
      "S1: ossToEnginePath 命中 data/oss 白名单根,返回宿主绝对路径",
      `got=${translated}`,
    );
  } finally {
    fs.rmSync(path.dirname(probeAbs), { recursive: true, force: true });
  }

  // 宿主绝对路径原样透传(已是引擎可见形态, kmc 活体先例)
  assert(
    ossToEnginePath("/data/workspace/kais-hermes-skills/x.png") ===
      "/data/workspace/kais-hermes-skills/x.png",
    "S1: ossToEnginePath 非 /oss/ 宿主绝对路径原样透传",
  );
  // 空 / 非 string 输入防御
  assert(
    ossToEnginePath("") === null && ossToEnginePath(undefined as unknown as string) === null,
    "S1: ossToEnginePath 空/非 string → null",
  );

  // ═══ S2 — fake 引擎三模式(59-01 Task 2) ════════════════════════════════
  // 进程内 http.createServer 起 stub(verify-phase-54.ts L284-328 骨架):
  //   - POST /api/v1/tasks 捕获请求体入数组,返回 202 + task_id
  //   - GET  /api/v1/tasks/:id 按 id 前缀分流 completed/failed 两模式
  // GOLD_TEAM_URL 指向 127.0.0.1 随机端口,baseUrl() 运行时读取,直调无需 spawn。
  // fake 第一次 GET 即终结(completed / failed),不触发 POLL_INTERVAL sleep。
  console.log("\n=== S2 fake 引擎三模式: poll outputs.*(断点①②) + submit ref_images/model_preference/seed(断点④ + A3 + REGEN-02) ===");
  {
    const capturedBodies: any[] = [];
    let server: http.Server | null = null;
    const prevGoldUrl = process.env.GOLD_TEAM_URL;
    try {
      server = http.createServer((req, res) => {
        const url = new URL(req.url ?? "/", "http://stub");
        const bodyChunks: Buffer[] = [];
        req.on("data", (c: Buffer) => bodyChunks.push(c));
        req.on("end", () => {
          const bodyText = Buffer.concat(bodyChunks).toString("utf8");
          let body: any = null;
          try { body = bodyText ? JSON.parse(bodyText) : null; } catch { /* non-JSON */ }
          const json = (status: number, payload: unknown) => {
            res.writeHead(status, { "Content-Type": "application/json" });
            res.end(JSON.stringify(payload));
          };
          if (url.pathname === "/api/v1/tasks" && req.method === "POST") {
            capturedBodies.push(body);
            json(202, { task_id: body?.task_id ?? "stub-task" });
            return;
          }
          const getMatch = /^\/api\/v1\/tasks\/([^/]+)$/.exec(url.pathname);
          if (getMatch && req.method === "GET") {
            const tid = decodeURIComponent(getMatch[1]!);
            if (tid.startsWith("fail-")) {
              json(200, { status: "failed", error: "Generation timed out" });
              return;
            }
            // completed 模式:活体实证形状(docker/gold-team/src/v6/models/task.py:90-127)
            json(200, {
              status: "completed",
              outputs: {
                image: "/mnt/agents/output/jimeng_T6384/output.png",
                thumbnail: "/mnt/agents/output/jimeng_T6384/output.png",
              },
              metadata: { seed: 42 },
            });
            return;
          }
          json(404, { detail: `no stub route ${req.method} ${url.pathname}` });
        });
      });
      await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
      const port = (server.address() as { port: number }).port;
      process.env.GOLD_TEAM_URL = `http://127.0.0.1:${port}`;

      const { submitEngineTask, pollEngineTask } = engineMod;

      // ─ completed 模式:断点①② 行为链 ─
      const okRes = await pollEngineTask("canvas-nodeA-1");
      assert(
        okRes.outputUrl === "/oss/jimeng_T6384/output.png",
        "S2: pollEngineTask completed → outputUrl = /oss/jimeng_T6384/output.png(断点① outputs.image + 断点② fsToOssUrl 翻译)",
        `got=${okRes.outputUrl}`,
      );

      // ─ failed 模式:抛错而非假成功 ─
      let failedErr: unknown = null;
      try {
        await pollEngineTask("fail-nodeB-2");
      } catch (err) {
        failedErr = err;
      }
      assert(
        failedErr instanceof Error && /failed|timed out/i.test(String((failedErr as Error).message)),
        "S2: pollEngineTask failed 模式抛错(模拟器 rethrow 前提,断点③配套)",
        failedErr ? String((failedErr as Error).message).slice(0, 120) : "no error",
      );

      // ─ image_draw 提交体形:ref_images 宿主路径 + model_preference cloud + seed 通道 ─
      // fixture 同 S1:写在 ossToEnginePath 实际探测的字面量根(checkout 位置无关)。
      const probeRel2 = "__v59_probe/t.png";
      const probeAbs2 = path.join(OSS_ROOT_LITERAL, probeRel2);
      fs.mkdirSync(path.dirname(probeAbs2), { recursive: true });
      fs.writeFileSync(probeAbs2, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      try {
        await submitEngineTask({
          taskType: "image_draw",
          prompt: "probe",
          projectId: 1,
          episodesId: 0,
          nodeId: "n1",
          referenceImages: [`/oss/${probeRel2}`],
          metadata: { seed: 12345 },
        });
        const imgBody = capturedBodies.find((b) => b?.type === "image_draw");
        assert(Boolean(imgBody), "S2: 捕获到 image_draw POST 体");
        const p = (imgBody?.params ?? {}) as Record<string, unknown>;
        assert(
          Array.isArray(p.ref_images) && (p.ref_images as string[]).includes(probeAbs2),
          "S2: 提交体 params.ref_images 为含宿主绝对路径的数组(ossToEnginePath 已翻译,断点④)",
          JSON.stringify(p.ref_images),
        );
        assert(
          !("reference_images" in p),
          "S2: 提交体 params 无 reference_images 键(断点④旧键名消灭)",
        );
        assert(
          p.model_preference === "cloud",
          "S2: image_draw 提交体 params.model_preference === 'cloud'(A3 裁定:平台政策 2026-08-19)",
          `got=${String(p.model_preference)}`,
        );
        assert(
          p.seed === 12345,
          "S2: metadata.seed 平铺达 params.seed(REGEN-02 seed 通道,59-02 接线前提)",
          `got=${String(p.seed)}`,
        );
      } finally {
        fs.rmSync(path.dirname(probeAbs2), { recursive: true, force: true });
      }

      // ─ video_final 提交体形:无 model_preference 键 ─
      await submitEngineTask({
        taskType: "video_final",
        prompt: "probe-video",
        projectId: 1,
        episodesId: 0,
        nodeId: "n2",
      });
      const vidBody = capturedBodies.find((b) => b?.type === "video_final");
      assert(Boolean(vidBody), "S2: 捕获到 video_final POST 体");
      const vp = (vidBody?.params ?? {}) as Record<string, unknown>;
      assert(
        !("model_preference" in vp),
        "S2: video_final 提交体 params 无 model_preference 键(路由政策仅 image_* 适用)",
      );

      // ─ 59-fix CR-01: metadata 保留键剔除(伪造 ref_images/model_preference/
      //    身份键/prompt 不可覆盖服务端显式设置;非保留键不误伤) ─
      await submitEngineTask({
        taskType: "video_final",
        prompt: "server-prompt",
        projectId: 7,
        episodesId: 8,
        nodeId: "scrub-probe",
        metadata: {
          ref_images: ["/etc/passwd"],
          model_preference: "local",
          prompt: "forged-prompt",
          nodeId: "forged-node",
          projectId: 999,
          episodesId: 999,
          nodeType: "forged-type",
          originalNodeId: "forged-orig",
          seed: 42,
        },
      });
      const scrubBody = capturedBodies.find((b) => b?.params?.nodeId === "scrub-probe");
      assert(Boolean(scrubBody), "S2 CR-01: 捕获到 scrub 探针 POST 体");
      if (scrubBody) {
        const sp = scrubBody.params as Record<string, unknown>;
        assert(
          sp.prompt === "server-prompt" && sp.projectId === 7 && sp.episodesId === 8 &&
            sp.nodeType !== "forged-type" && sp.originalNodeId !== "forged-orig",
          "S2 CR-01: 服务端身份/prompt 键不被 metadata 覆盖(RESERVED_PARAM_KEYS 剔除)",
          JSON.stringify(sp).slice(0, 160),
        );
        assert(
          !("ref_images" in sp) && !("model_preference" in sp),
          "S2 CR-01: 伪造 ref_images/model_preference 被剔除(video 非政策任务,服务端不设也不被注入)",
        );
        assert(
          sp.seed === 42,
          "S2 CR-01: 非保留键(seed)照常平铺透传(剔除不误伤)",
        );
      }
    } finally {
      if (prevGoldUrl === undefined) delete process.env.GOLD_TEAM_URL;
      else process.env.GOLD_TEAM_URL = prevGoldUrl;
      if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    }
  }

  // ═══ S3/S4 — spawn dispatch 行为断言(59-02 Task 3) ═══════════════════════
  console.log("\n=== S3/S4 spawn dispatch: D-01 级联+契约广播 / D-02 失败零标记 / SC3 负向三件套 / REGEN-02 seed / D-05 reload 保真 ===");
  interface DispatchOutcome {
    mode: string;
    httpStatus: number;
    respBody: any;
    events: Array<{ event: string; data: any }>;
    staleRows: Array<{ id: string; stale: any }>;
  }
  const dispatchOutcomes: Record<string, DispatchOutcome | null> = {};
  {
    // fake 引擎常驻本进程(S2 stub 模式;completed/failed 由 engineMode 切换,
    // POST 捕获体 dispatchBodies 跨模式累积——seed===777 只有 cascade 模式发)。
    let engineMode: "completed" | "failed" = "completed";
    const dispatchBodies: any[] = [];
    const fakeEngine = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://stub");
      const bodyChunks: Buffer[] = [];
      req.on("data", (c: Buffer) => bodyChunks.push(c));
      req.on("end", () => {
        const bodyText = Buffer.concat(bodyChunks).toString("utf8");
        let body: any = null;
        try { body = bodyText ? JSON.parse(bodyText) : null; } catch { /* non-JSON */ }
        const json = (status: number, payload: unknown) => {
          res.writeHead(status, { "Content-Type": "application/json" });
          res.end(JSON.stringify(payload));
        };
        if (url.pathname === "/api/v1/tasks" && req.method === "POST") {
          dispatchBodies.push(body);
          json(202, { task_id: body?.task_id ?? "stub-task" });
          return;
        }
        const getMatch = /^\/api\/v1\/tasks\/([^/]+)$/.exec(url.pathname);
        if (getMatch && req.method === "GET") {
          if (engineMode === "failed") {
            json(200, { status: "failed", error: "Generation timed out" });
            return;
          }
          json(200, {
            status: "completed",
            outputs: {
              image: "/mnt/agents/output/jimeng_T6384/output.png",
              thumbnail: "/mnt/agents/output/jimeng_T6384/output.png",
            },
            metadata: { seed: 42 },
          });
          return;
        }
        json(404, { detail: `no stub route ${req.method} ${url.pathname}` });
      });
    });
    let feServer: http.Server | null = null;
    try {
      feServer = fakeEngine;
      await new Promise<void>((resolve) => fakeEngine.listen(0, "127.0.0.1", resolve));
      const stubUrl = `http://127.0.0.1:${(fakeEngine.address() as { port: number }).port}`;

      // 单模式 spawn(必须异步 spawn 而非 spawnSync——54-05 同款教训:fake 引擎
      // 常驻本进程,spawnSync 冻结父进程事件循环会让子进程的引擎 fetch 死锁
      // 超时):cwd=mkdtemp 隔离空库(getPath 以 cwd/data 为基;生产库绝不被
      // 打开);package.json staged(writeVersion 从 cwd 解析);--tsconfig 显式
      // 指 repo(实证:tsx 从临时 cwd 找不到 tsconfig,@/ 不解析)。
      const runDispatch = async (mode: string): Promise<DispatchOutcome | null> => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `verify-59-dispatch-${mode}-`));
        fs.copyFileSync(path.join(REPO_ROOT, "package.json"), path.join(tmp, "package.json"));
        try {
          const child = spawn(
            path.join(REPO_ROOT, "node_modules", ".bin", "tsx"),
            [
              "--tsconfig", path.join(REPO_ROOT, "tsconfig.json"),
              path.join(REPO_ROOT, "scripts", "verify-59-dispatch.ts"),
            ],
            {
              cwd: tmp,
              env: {
                ...process.env,
                GOLD_TEAM_URL: stubUrl,
                DISPATCH_MODE: mode,
                ENGINE_POLL_INTERVAL_MS: "10", // 防御性:fake 引擎首个 GET 即终结
              },
              stdio: ["ignore", "pipe", "pipe"],
            },
          );
          let out = "";
          let err = "";
          child.stdout.on("data", (d: Buffer) => { out += d.toString(); });
          child.stderr.on("data", (d: Buffer) => { err += d.toString(); });
          const exitCode = await new Promise<number | null>((resolve) => {
            const killer = setTimeout(() => child.kill("SIGKILL"), 120_000);
            child.once("exit", (code) => { clearTimeout(killer); resolve(code); });
          });
          const line = out
            .split("\n")
            .map((l) => l.trim())
            .filter((l) => l.startsWith("V59_DISPATCH_JSON="))
            .pop();
          if (!line) {
            const errTail = err.split("\n").filter((l) => l.trim()).slice(-3).join(" | ");
            console.log(`  [dispatch:${mode}] 子进程未产出 JSON (exit ${exitCode}): ${errTail.slice(-250)}`);
            return null;
          }
          return JSON.parse(line.slice("V59_DISPATCH_JSON=".length)) as DispatchOutcome;
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true }); // 临时目录清理
        }
      };

      // ── S3-cascade(completed):D-01 级联 + wire 契约 + seed + D-05 ──
      engineMode = "completed";
      const cascade = await runDispatch("cascade");
      dispatchOutcomes.cascade = cascade;
      assert(cascade != null, "S3-cascade: 子进程产出 V59_DISPATCH_JSON");
      if (cascade) {
        assert(
          cascade.events.some((e) => e.event === "node:state" && e.data?.nodeId === "trig-1" && e.data?.state === "success"),
          "S3-cascade: node:state success(trig-1)",
        );
        const staleUpdates = cascade.events.filter(
          (e) => e.event === "node:updated" &&
            Array.isArray(e.data?.changedFields) &&
            e.data.changedFields.length === 1 &&
            e.data.changedFields[0] === "data.stale",
        );
        assert(
          staleUpdates.length >= 1,
          `S3-cascade: ≥1 条 node:updated 且 changedFields === ["data.stale"](得 ${staleUpdates.length})`,
        );
        assert(
          staleUpdates.some((e) => e.data?.node?.data?.stale?.triggerAssetId === "trig-1"),
          "S3-cascade: 广播 node.data.stale.triggerAssetId === 'trig-1'",
        );
        const downRow = cascade.staleRows.find((r) => r.id === "down-1");
        assert(
          downRow != null &&
            typeof downRow.stale?.since === "number" &&
            typeof downRow.stale?.triggerAssetId === "string" &&
            typeof downRow.stale?.triggerEventId === "string",
          "S3-cascade: DB down-1 stale 三字段齐全(D-05 reload 保真;fixture 混入 migrate 不支持 'phase' 节点仍级联——WR-03 容错行为级)",
          JSON.stringify(downRow ?? null),
        );
        assert(
          dispatchBodies.some((b) => b?.params?.seed === 777),
          "S3-cascade: fake 引擎捕获体 params.seed === 777(REGEN-02 行为级)",
        );
        // 59-fix CR-01 行为级:dispatch body 混入伪造保留键(ref_images=/etc 路径/
        // model_preference=local/身份键/prompt)——_simulate CLIENT_PARAM_KEYS 白名单
        // + _engine RESERVED_PARAM_KEYS 两道防线后,引擎提交体只应有服务端真值。
        const cascadeBody = dispatchBodies.find((b) => b?.params?.seed === 777);
        assert(Boolean(cascadeBody), "S3-cascade CR-01: 捕获 cascade 引擎提交体");
        if (cascadeBody) {
          const cp = cascadeBody.params as Record<string, unknown>;
          assert(
            cp.nodeId === "trig-1" && cp.prompt === "v59 probe",
            "S3-cascade CR-01: 客户端 params 伪造身份/prompt 键被拦截(execute→engine 全链,服务端值保持)",
            JSON.stringify(cp).slice(0, 160),
          );
          assert(
            cp.model_preference === "cloud",
            "S3-cascade CR-01: image 任务 model_preference 仍为服务端强制 cloud(伪造 'local' 不落地)",
            `got=${String(cp.model_preference)}`,
          );
          assert(
            !Array.isArray(cp.ref_images) || !(cp.ref_images as string[]).includes("/etc/passwd"),
            "S3-cascade CR-01: 伪造 ref_images(/etc/passwd)不可经 params 注入引擎(白名单外键静默丢弃)",
          );
        }
      }

      // ── S3-engine-fail(failed):D-02 失败零标记负向 ──
      engineMode = "failed";
      const fail = await runDispatch("engine-fail");
      dispatchOutcomes["engine-fail"] = fail;
      assert(fail != null, "S3-engine-fail: 子进程产出 V59_DISPATCH_JSON");
      if (fail) {
        assert(
          fail.events.some((e) => e.event === "node:state" && e.data?.nodeId === "trig-1" && e.data?.state === "error"),
          "S3-engine-fail: node:state error 广播(59-01 断点③修真后失败可见)",
        );
        assert(
          !fail.events.some((e) => e.event === "node:state" && e.data?.state === "success"),
          "S3-engine-fail: 零 success 事件",
        );
        assert(
          !fail.events.some((e) => e.event === "node:updated"),
          "S3-engine-fail: 零 node:updated 广播",
        );
        assert(
          fail.staleRows.length === 0,
          "S3-engine-fail: staleRows 空(D-02 负向:失败零 stale 写)",
        );
      }
      engineMode = "completed";

      // ── S4-no-marker(completed):负向 #1 ContextMenu 路径 ──
      const nom = await runDispatch("no-marker");
      dispatchOutcomes["no-marker"] = nom;
      assert(nom != null, "S4-no-marker: 子进程产出 V59_DISPATCH_JSON");
      if (nom) {
        assert(
          nom.events.some((e) => e.event === "node:state" && e.data?.nodeId === "trig-1" && e.data?.state === "success"),
          "S4-no-marker: 无标记 execute 仍 success(ContextMenu 路径行为不变)",
        );
        assert(
          !nom.events.some((e) => e.event === "node:updated"),
          "S4-no-marker: 零 node:updated(负向 #1:无 regenSource 零级联)",
        );
        assert(
          nom.staleRows.length === 0,
          "S4-no-marker: staleRows 空(负向 #1)",
        );
      }

      // ── S4-orchestrate(completed):非空洞负向 #2(SC3) ──
      const orch = await runDispatch("orchestrate");
      dispatchOutcomes.orchestrate = orch;
      assert(orch != null, "S4-orchestrate: 子进程产出 V59_DISPATCH_JSON");
      if (orch) {
        assert(
          orch.httpStatus === 200,
          "S4-orchestrate: httpStatus 200(blob 从未写入——关系表非空直读不走兜底,orchestrate 数据源真化的行为级证明)",
          `status=${orch.httpStatus} body=${JSON.stringify(orch.respBody).slice(0, 120)}`,
        );
        assert(
          orch.events.some((e) => e.event === "node:state" && e.data?.nodeId === "down-1" && e.data?.state === "success"),
          "S4-orchestrate: down-1 node:state success(非空洞负向前提:orchestrate 真执行了关系表目标,而非 404 空转)",
        );
        assert(
          !orch.events.some((e) => e.event === "node:updated"),
          "S4-orchestrate: 零 node:updated(负向 #2:SC3 orchestrate 零级联)",
        );
        assert(
          orch.staleRows.length === 0,
          "S4-orchestrate: staleRows 空(负向 #2:SC3)",
        );
      }

      // ── S4-orchestrate-legacy(completed):WR-01 legacy blob 兜底 ──
      // 59-fix WR-01 行为级:legacy-blob-only scope(关系表仅 meta 零节点,blob
      // 单节点)——59-02 换 loadFullGraph 后此形态恒 404;修复后关系表 null →
      // 回退 legacy blob 读取,目标发现 total=1/skipped=0(59-02 前行为恢复)。
      const orchLegacy = await runDispatch("orchestrate-legacy");
      dispatchOutcomes["orchestrate-legacy"] = orchLegacy;
      assert(orchLegacy != null, "S4-orchestrate-legacy: 子进程产出 V59_DISPATCH_JSON");
      if (orchLegacy) {
        assert(
          orchLegacy.httpStatus === 200 &&
            orchLegacy.respBody?.data?.total === 1 &&
            orchLegacy.respBody?.data?.skipped === 0,
          "S4-orchestrate-legacy: legacy-blob-only scope 200 + blob 目标发现 total=1/skipped=0(WR-01:关系表 null 回退 legacy blob,修复前 404)",
          `status=${orchLegacy.httpStatus} body=${JSON.stringify(orchLegacy.respBody).slice(0, 120)}`,
        );
        assert(
          !orchLegacy.events.some((e) => e.event === "node:updated"),
          "S4-orchestrate-legacy: 零 node:updated(兜底路径零级联,SC3)",
        );
        assert(
          orchLegacy.staleRows.length === 0,
          "S4-orchestrate-legacy: staleRows 空(兜底路径零 stale 写)",
        );
      }

      // ── S4-import-guard(59-fix r2 CR-04/WR-06):workdir 守卫负向三件套 + 正向对照 ──
      const guard = await runDispatch("import-guard");
      dispatchOutcomes["import-guard"] = guard as unknown as DispatchOutcome | null;
      assert(guard != null, "S4-import-guard: 子进程产出 V59_DISPATCH_JSON");
      if (guard) {
        const probes = ((guard as any).probes ?? []) as Array<{ name: string; status: number; minted: boolean }>;
        const by = (n: string) => probes.find((p) => p.name === n);
        assert(
          by("repo-root")?.status === 400 && by("repo-root")?.minted === false,
          "S4-import-guard CR-04: workdir=仓库根 → 400 且未铸造 /oss symlink(审查实证向量收口)",
          JSON.stringify(by("repo-root") ?? null),
        );
        assert(
          by("repo-ancestor")?.status === 400 && by("repo-ancestor")?.minted === false,
          "S4-import-guard CR-04: workdir=仓库祖先(/data/workspace) → 400 且未铸造",
          JSON.stringify(by("repo-ancestor") ?? null),
        );
        assert(
          by("symlink-escape")?.status === 400 && by("symlink-escape")?.minted === false,
          "S4-import-guard WR-06: 允许根内 symlink 指向根外 → 400(realpath 复检)且未铸造",
          JSON.stringify(by("symlink-escape") ?? null),
        );
        assert(
          by("positive-control")?.status === 200 && by("positive-control")?.minted === true,
          "S4-import-guard 正向对照: 合法 workdir(真实目录,非仓库根/祖先/含 data)仍 200 + 正常铸造(守卫不过拦)",
          JSON.stringify(by("positive-control") ?? null),
        );
      }

      // ── S4-seed-precedence(59-fix r2 IN-05):专用 seed 通道赢过 params 袋字符串 seed ──
      const seedPrec = await runDispatch("seed-precedence");
      assert(seedPrec != null, "S4-seed-precedence: 子进程产出 V59_DISPATCH_JSON");
      if (seedPrec) {
        const spBody = dispatchBodies.find((b) => b?.params?.prompt === "v59 seed-precedence probe");
        assert(Boolean(spBody), "S4-seed-precedence: 捕获 seed 优先级探针引擎提交体");
        if (spBody) {
          assert(
            spBody.params.seed === 424242,
            "S4-seed-precedence IN-05: 专用 seed 通道(424242,execute.ts typeof number 类型门)赢过 params 袋 seed(修复前白名单袋后展开,字符串 'spoofed' 覆盖直达引擎)",
            `got=${JSON.stringify(spBody.params.seed)}`,
          );
        }
      }

      // ── 静态断言(结构冻结锁) ──
      const executeSrc = read("src/routes/canvas/execute.ts");
      const orchestrateSrc = read("src/routes/canvas/orchestrate.ts");
      const staleSrc = read("src/routes/canvas/_stale.ts");
      const simulateSrc = read("src/routes/canvas/_simulate.ts");
      const engineSrc = read("src/routes/canvas/_engine.ts");
      assert(executeSrc.includes("regenSource: z.enum"), "静态: execute.ts 含 regenSource: z.enum(zod 白名单)");
      // 59-fix CR-01: params 双防线静态锁(行为级在 S2 scrub 探针 + S3-cascade)
      assert(
        simulateSrc.includes("CLIENT_PARAM_KEYS") && simulateSrc.includes("filterClientParams"),
        "静态 CR-01: _simulate.ts 含客户端 params 白名单(CLIENT_PARAM_KEYS)",
      );
      assert(
        engineSrc.includes("RESERVED_PARAM_KEYS") && engineSrc.includes("scrubReservedParams"),
        "静态 CR-01: _engine.ts 含引擎 params 保留键剔除(纵深防御)",
      );
      assert(orchestrateSrc.includes("loadFullGraph"), "静态: orchestrate.ts 含 loadFullGraph(关系表优先读)");
      // 59-fix WR-01 翻转:legacy blob 兜底是审查裁定的修复行为(关系表 null →
      // 回退旧查询,59-02 前 legacy-blob-only 项目行为保持)——锁从「无 blob 读」
      // 翻为「兜底在场」,防止未来被误删。
      assert(orchestrateSrc.includes("o_agentWorkData"), "静态: orchestrate.ts 含 legacy blob 兜底读(WR-01:关系表 null 回退)");
      assert(
        !/markStaleDownstream|\.\/_stale|regenSource/.test(orchestrateSrc),
        "静态: orchestrate.ts 零级联结构(无级联函数 import / 无 _stale 引用 / 无重生成标记消费)",
      );
      assert(!staleSrc.includes("ts/src/index"), "静态: _stale.ts 无 flowgraph-v3 index.ts 深链(zod 分裂防线)");
      // 59-fix r2 CR-04/WR-06 静态锁(行为级在 S4-import-guard 四探针)
      const importSrc = read("src/routes/canvas/v2/import-from-dir.ts");
      assert(
        importSrc.includes("PROTECTED_REPO_ROOTS") && importSrc.includes("realpath(absWorkdir)"),
        "静态 CR-04/WR-06: import-from-dir 含仓库自身/祖先守卫(PROTECTED_REPO_ROOTS)与 realpath 复检",
      );
      // 59-fix r2 IN-05 静态锁(行为级在 S4-seed-precedence)
      assert(
        simulateSrc.includes("delete clientParams.seed"),
        "静态 IN-05: _simulate.ts 专用 seed 通道优先(袋内 seed 删除后再平铺)",
      );
    } finally {
      if (feServer) await new Promise<void>((resolve) => feServer!.close(() => resolve()));
    }
  }

  // ═══ S5 — 客户端静态断言(59-04 Task 3:59-03 接线锁) ══════════════════════
  console.log("\n=== S5 客户端静态断言: 59-03 窄通道接线(node:updated 订阅 + regenSource 发射) ===");
  {
    const socketSrc = read("packages/infinite-canvas/src/hooks/useCanvasSocket.ts");
    const flowCanvasSrc = read("packages/infinite-canvas/src/components/FlowCanvas.tsx");
    const canvasApiSrc = read("packages/infinite-canvas/src/services/canvasApi.ts");
    const panelSrc = read("packages/infinite-canvas/src/components/panel/NodeDetailPanel.tsx");
    const popoverSrc = read("packages/infinite-canvas/src/components/eventParams/EventParamsPopover.tsx");
    assert(
      socketSrc.includes("socket.on('node:updated'"),
      "S5: useCanvasSocket 注册 socket.on('node:updated'(G1 缺口闭合,59-03)",
    );
    assert(
      flowCanvasSrc.includes("onNodeUpdated") && flowCanvasSrc.includes("triggerStaleCascade"),
      "S5: FlowCanvas 含 onNodeUpdated 与 triggerStaleCascade(实时级联链,FLAG-1 Option A)",
    );
    // 59-fix CR-02: onNodeUpdated scope 守卫静态锁(行为级在 phase59 e2e
    // cross-episode 用例)——与 onGateState/onVariantSelected 同款两行守卫。
    {
      const nuIdx = flowCanvasSrc.indexOf("onNodeUpdated: (payload)");
      assert(nuIdx >= 0, "S5: onNodeUpdated 回调块可定位");
      if (nuIdx >= 0) {
        const nuBlock = flowCanvasSrc.slice(nuIdx, nuIdx + 1200);
        assert(
          nuBlock.includes("payload.projectId !== projectId") &&
            nuBlock.includes("payload.episodesId !== episodesId"),
          "S5 CR-02: onNodeUpdated 含 scope 守卫(他 episode 广播静默拒绝,onGateState 同法)",
        );
      }
    }
    assert(
      canvasApiSrc.includes("regenSource"),
      "S5: canvasApi executeNode extra 含 regenSource 类型(两值字面量联合)",
    );
    assert(panelSrc.includes("'panel-regen'"), "S5: NodeDetailPanel 发射 'panel-regen'(STALE-01)");
    assert(popoverSrc.includes("'reroll-seed'"), "S5: EventParamsPopover 发射 'reroll-seed'(STALE-02)");
    // 59-fix r2 WR-05: popover 换 seed 提交带顶层 prompt 专用通道(行为级在
    // phase59 SC2 / phase52-reroll e2e 断言 exec.body.prompt;CR-01 白名单后
    // params 袋内 prompt 不再达引擎,顶层通道使「同配方」不依赖 extractPrompt 兜底)。
    assert(
      popoverSrc.includes("prompt: typeof params.prompt === 'string'"),
      "S5 WR-05: EventParamsPopover reroll-seed 提交顶层 prompt(NodeDetailPanel 同款)",
    );
    // FLAG-3 / 52-01 红线:node:updated 转发必须是独立 handler——读注册块上下文,
    // 断言转发经 callbacksRef.current.onNodeUpdated 且不进 normalizeSocketNodeState
    // 调用链(stale 载荷误映射执行态会在 error 时错清 stale)。
    const regIdx = socketSrc.indexOf("socket.on('node:updated'");
    assert(regIdx >= 0, "S5: node:updated 注册块可定位");
    if (regIdx >= 0) {
      const regBlock = socketSrc.slice(regIdx, regIdx + 700);
      assert(
        regBlock.includes("callbacksRef.current.onNodeUpdated"),
        "S5: node:updated 注册块经 callbacksRef.current.onNodeUpdated 转发(订阅三件套)",
      );
      assert(
        !regBlock.includes("normalizeSocketNodeState"),
        "S5: node:updated 转发不在 normalizeSocketNodeState 调用链内(FLAG-3 / 52-01 红线)",
      );
    }
  }

  // ═══ S6 — 命令门(verify-phase-58 同款:三根 tsc + 双包 vitest) ════════════
  console.log("\n=== S6 command gates (tsc ×3 + vitest ×2; flowgraph-v3 全量含 stale.test.ts——D-03 语义基线) ===");
  runCmd("root tsc --noEmit", ".", "npx tsc --noEmit");
  runCmd("infinite-canvas tsc -b", "packages/infinite-canvas", "npx tsc -b");
  runCmd("flowgraph-v3 tsc --noEmit", "packages/flowgraph-v3/ts", "npx tsc --noEmit");
  // WR-01: vitest 门禁不经 shell 管道(tail 管道会让 res.status 变成 tail 的退出码,
  // vitest 全红仍 exit 0 → 假绿);摘要由 runCmd 在 JS 侧 slice 完成。
  runCmd("infinite-canvas vitest", "packages/infinite-canvas", "npm test", 2);
  runCmd("flowgraph-v3 vitest", "packages/flowgraph-v3", "npx vitest run", 2);
  console.log("\n=== Forced-failure self-check (gate can actually fail — expected FAILs below) ===");
  const selfCheckShadow: TestResult[] = [];
  const shadowAssert = (cond: boolean, name: string): void => {
    selfCheckShadow.push({ name, pass: cond });
    console.log(`  SELF-CHECK ${cond ? "UNEXPECTED-PASS" : "expected-FAIL ok"}: ${name}`);
  };
  shadowAssert(
    fsToOssUrl("/mnt/agents/output/x.png") !== "/oss/x.png",
    "self-check: inverted /mnt/agents/output 翻译断言失败",
  );
  shadowAssert(
    ossToEnginePath("/oss/../escape") !== null,
    "self-check: inverted 穿越拒绝断言失败",
  );
  shadowAssert(
    exists("src/routes/canvas/__definitely_not_real__.ts"),
    "self-check: known-nonexistent file is reported missing",
  );
  // 59-02 S3/S4 三条 forced-failure(证明 dispatch 门能红):
  const nomShadow = dispatchOutcomes["no-marker"];
  const failShadow = dispatchOutcomes["engine-fail"];
  const orchShadow = dispatchOutcomes.orchestrate;
  shadowAssert(
    (nomShadow?.staleRows.length ?? 0) > 0,
    "self-check: inverted 断言失败——no-marker 模式 staleRows.length > 0 必须不成立",
  );
  shadowAssert(
    (failShadow?.events ?? []).some((e) => e.event === "node:state" && e.data?.state === "success"),
    "self-check: inverted 断言失败——engine-fail 模式出现 success 事件必须不成立",
  );
  shadowAssert(
    orchShadow?.httpStatus === 404,
    "self-check: inverted 断言失败——orchestrate 模式 httpStatus 404 必须不成立",
  );
  // 59-04 forced-failure 补一项:orchestrate.ts 含 markStaleDownstream 必须 FAIL
  // (SC3 结构性保证的静态面——正向断言在 S3/S4 静态锁,此处反向自证门能红)
  shadowAssert(
    read("src/routes/canvas/orchestrate.ts").includes("markStaleDownstream"),
    "self-check: inverted 断言失败——orchestrate.ts 含 markStaleDownstream 必须不成立(SC3 架构性保证)",
  );
  const shadowFailed = selfCheckShadow.filter((r) => !r.pass).length;
  assert(
    selfCheckShadow.length >= 3 && selfCheckShadow.every((r) => !r.pass),
    "forced-failure self-check: every must-fail assertion failed as expected (gate fail-path is live)",
    `shadow: ${selfCheckShadow.length - shadowFailed}/${selfCheckShadow.length} unexpectedly passed`,
  );

  // ═══ Summary ═════════════════════════════════════════════════════════════
  const passed = results.filter((r) => r.pass).length;
  const total = results.length;
  const failed = total - passed;
  console.log(`\n=== Summary: ${passed}/${total} assertions passed, FAIL count = ${failed} (self-check excluded from totals) ===`);
  if (passed === total) {
    console.log("✅ Phase 59 verification PASSED (S1 双向路径翻译 ✓ S2 fake 引擎三模式 ✓ S3/S4 spawn dispatch 行为断言 ✓ S5 客户端静态断言 ✓ S6 命令门 ✓ + forced-failure self-check ✓)");
    process.exit(0);
  } else {
    console.log("❌ Phase 59 verification FAILED");
    for (const r of results.filter((x) => !x.pass)) {
      console.log(`   FAIL: ${r.name}${r.detail ? " — " + r.detail : ""}`);
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("verify-phase-59.ts crashed:", err);
  process.exit(2);
});
