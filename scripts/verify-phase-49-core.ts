/**
 * scripts/verify-phase-49-core.ts — GPU 统一调度三期验收 (docs/gpu-unified-scheduling-plan.md)
 *
 * 用法: npx tsx scripts/verify-phase-49-core.ts
 *
 * 两层验收:
 *   1. 源码合同断言 — 核心 API/路由接入/收编覆盖/管理面守卫是否都在位
 *   2. 单测执行 — src/lib/__tests__/gpuVramManager.test.ts 全绿
 *
 * 事故回归 (A1, 2026-08-19 ep-ccport-test01 p11a 5h 死锁): 占用看门狗在单测里
 * 以 20ms×2 阈值验证 (生产默认 30s×2) — :8125 死后 ≤90s 自愈, 不再依赖重启。
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = join(__dirname, "..");
let failures = 0;

function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    console.log(`  ✅ ${label}`);
  } else {
    failures++;
    console.error(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf-8");
}

function contains(rel: string, needle: string): boolean {
  try {
    return read(rel).includes(needle);
  } catch {
    return false;
  }
}

// ─── 1. 核心库合同 (src/lib/gpuVramManager.ts) ─────────────────────────────

console.log("\n[1] 核心库 src/lib/gpuVramManager.ts");
const core = "src/lib/gpuVramManager.ts";
check("QueueTimeoutError (D1 锁等待超时)", contains(core, "class QueueTimeoutError"));
check("QueueAbortedError (D3 断连取消)", contains(core, "class QueueAbortedError"));
check("QueuePurgedError (管理面摘除)", contains(core, "class QueuePurgedError"));
check("占用看门狗 (D2)", contains(core, "startOccupancyWatch") && contains(core, "watchdog_release"));
check("forceReleaseOccupancy 原语", contains(core, "export function forceReleaseOccupancy"));
check("purgeWaiters 原语", contains(core, "export function purgeWaiters"));
check("状态扩展 waiter 明细", contains(core, "GpuQueueWaiterInfo"));
check("锁等待 deadline env", contains(core, "KAP_GPU_LOCK_WAIT_TIMEOUT_MS"));
check("看门狗 env 开关", contains(core, "KAP_GPU_WATCHDOG"));

// ─── 2. GpuScheduler 联动 (D5) ──────────────────────────────────────────────

console.log("\n[2] GpuScheduler 停服联动 (D5)");
const sched = "src/services/gpu/GpuScheduler.ts";
check("SERVICE_TO_QUEUE_ENGINE 映射", contains(sched, "SERVICE_TO_QUEUE_ENGINE"));
check("release() 联动 releaseEngineOccupancy", contains(sched, "releaseEngineOccupancy(queueEngine.engine"));

// ─── 3. P1 路由接入 ────────────────────────────────────────────────────────

console.log("\n[3] P1 路由接入 (看门狗 + AbortSignal + 错误映射)");
check("llm allocate 看门狗 :8125", contains("src/routes/production/llm/index.ts", "healthUrl: EYE_HEALTH_URL"));
check("ear allocate 看门狗 :8126", contains("src/routes/production/ear/index.ts", "healthUrl: EAR_HEALTH_URL"));

const heavyRoutes = [
  "src/routes/production/minimax-h3/generate.ts",
  "src/routes/production/qwenTts/speak.ts",
  "src/routes/v1/tts/speak.ts",
  "src/routes/production/indextts2/speak.ts",
  "src/routes/production/flux/sceneGenerate.ts",
  "src/routes/production/music3/generate.ts",
];
for (const rel of heavyRoutes) {
  const src = read(rel);
  check(
    `${rel} — res.on("close") 断连判据 + signal`,
    src.includes("writableFinished") && src.includes("signal: ac.signal"),
    "缺 writableFinished 守卫或 signal 透传",
  );
  check(
    `${rel} — 队列错误 kind 映射`,
    src.includes("queue_timeout") || src.includes("QueueTimeoutError"),
  );
}

// ─── 4. P2-A 收编覆盖 (D10) ────────────────────────────────────────────────

console.log("\n[4] P2-A 绕过路由收编 (D10)");
const adopted = [
  "src/routes/production/minimax-h3/i2va.ts",
  "src/routes/production/minimax-h3/t2va.ts",
  "src/routes/production/minimax-h3/ref2va.ts",
  "src/routes/production/flux/flux2Generate.ts",
  "src/routes/production/flux/kontext-generate/index.ts",
  "src/routes/production/ltx/extension.ts",
  "src/routes/production/ltx/fflf.ts",
  "src/routes/production/ltx/msr.ts",
  "src/routes/production/ltx/poseVideo.ts",
  "src/routes/production/ltx/promptRelayI2V.ts",
  "src/routes/production/ltx/singularityFFLF.ts",
  "src/routes/production/ltx/twoStageAudioI2V.ts",
];
for (const rel of adopted) {
  check(`${rel} — withGpuQueue 在位`, contains(rel, "withGpuQueue"));
}
// 豁免面: 纯 CPU 路由不该被包 (收编过度同样有害)
check(
  "ltx/trim.ts 纯 CPU 豁免 (无 withGpuQueue)",
  !contains("src/routes/production/ltx/trim.ts", "withGpuQueue"),
);

// ─── 5. P2-B 管理面 (D7) ───────────────────────────────────────────────────

console.log("\n[5] P2-B 管理面 (D7)");
const admin = "src/routes/production/gpu-queue/index.ts";
check("token 守卫存在", contains(admin, "KAP_ADMIN_TOKEN"));
check("force-release 端点", contains(admin, "force-release") && contains(admin, "forceReleaseOccupancy"));
check("purge-waiters 端点", contains(admin, "purge-waiters") && contains(admin, "purgeWaiters"));

// ─── 6. 单测执行 (A1-A4 事故回归) ─────────────────────────────────────────

console.log("\n[6] 单测 src/lib/__tests__/gpuVramManager.test.ts");
const testRun = spawnSync(
  process.execPath,
  ["--import", "tsx", "--test", "src/lib/__tests__/gpuVramManager.test.ts"],
  { cwd: ROOT, encoding: "utf-8", timeout: 120_000 },
);
const testOut = `${testRun.stdout ?? ""}${testRun.stderr ?? ""}`;
const passMatch = /# pass (\d+)/.exec(testOut) || /ℹ pass (\d+)/.exec(testOut);
const failMatch = /# fail (\d+)/.exec(testOut) || /ℹ fail (\d+)/.exec(testOut);
const passCount = passMatch ? parseInt(passMatch[1], 10) : 0;
const failCount = failMatch ? parseInt(failMatch[1], 10) : -1;
check(
  `单测全绿 (pass=${passCount}, fail=${Math.max(failCount, 0)})`,
  testRun.status === 0 && passCount >= 8 && failCount === 0,
  testRun.status !== 0 ? testOut.slice(-500) : undefined,
);

// ─── 汇总 ─────────────────────────────────────────────────────────────────

console.log(
  `\n${failures === 0 ? "✅ PHASE-49 CORE: 全部通过" : `❌ PHASE-49 CORE: ${failures} 项失败`}\n`,
);
process.exit(failures === 0 ? 0 : 1);
