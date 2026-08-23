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

  // ═══ S2 — fake 引擎三模式(59-01 Task 2 落) ══════════════════════════════
  // PLACEHOLDER: Task 2 将在此段起 http.createServer fake 引擎,
  // 设 process.env.GOLD_TEAM_URL 指向 127.0.0.1:0 随机端口,验证:
  //   - completed 模式: pollEngineTask 返回 outputUrl === "/oss/jimeng_T6384/output.png"
  //   - failed 模式: pollEngineTask 抛错
  //   - submitEngineTask image_draw: params.ref_images 宿主路径 + model_preference "cloud" + seed 通道
  //   - submitEngineTask video_final: 无 model_preference 键
  // 段末 delete process.env.GOLD_TEAM_URL + server.close。

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
    console.log("✅ Phase 59 verification PASSED (S1 双向路径翻译 ✓ + forced-failure self-check ✓;S2 fake 引擎段待 59-01 Task 2 落)");
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
