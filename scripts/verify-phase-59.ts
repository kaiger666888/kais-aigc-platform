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
import { spawnSync } from "node:child_process";

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

/** S5 命令门:cwd + 命令,tail 摘要;非零 exit 红。 */
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
    `S5 cmd: ${name} (exit ${res.status})`,
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

  // 双根白名单: 写入 data/oss/__v59_probe/t.png → ossToEnginePath 命中第二个根
  const probeRel = "__v59_probe/t.png";
  const probeAbs = path.join(REPO_ROOT, "data/oss", probeRel);
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
      const probeRel2 = "__v59_probe/t.png";
      const probeAbs2 = path.join(REPO_ROOT, "data/oss", probeRel2);
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
    } finally {
      if (prevGoldUrl === undefined) delete process.env.GOLD_TEAM_URL;
      else process.env.GOLD_TEAM_URL = prevGoldUrl;
      if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    }
  }

  // ═══ Forced-failure self-check — prove the gate can fail ═════════════════
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
    console.log("✅ Phase 59 verification PASSED (S1 双向路径翻译 ✓ S2 fake 引擎三模式 ✓ + forced-failure self-check ✓)");
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
