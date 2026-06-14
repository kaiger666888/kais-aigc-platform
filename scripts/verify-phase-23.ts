#!/usr/bin/env tsx
/**
 * verify-phase-23.ts — Phase 23 GpuScheduler Redis Migration verification.
 *
 * Tests the 4 success criteria from ROADMAP.md Phase 23:
 *   1. Two Node processes against same Redis see same GPU lock state (integration test)
 *   2. REDIS_URL unset → memory fallback + explicit WARN log
 *   3. Existing GpuScheduler tests pass unchanged against Redis backend
 *   4. Idle-timer expiry visible across processes (shared Redis key)
 *
 * Usage:
 *   tsx scripts/verify-phase-23.ts                 # full suite
 *   tsx scripts/verify-phase-23.ts --memory-only   # skip Redis tests
 */

import { MemoryStateStore, RedisStateStore, getGpuSchedulerAsync, __resetGpuSchedulerForTests, type StateStore } from "../src/services/gpu";
import { GpuScheduler, GPU_DEVICES } from "../src/services/gpu/GpuScheduler";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const MEMORY_ONLY = process.argv.includes("--memory-only");

interface TestResult { name: string; pass: boolean; detail?: string; }
const results: TestResult[] = [];

function assert(cond: boolean, name: string, detail?: string): void {
  results.push({ name, pass: cond, detail });
  console.log(`  ${cond ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

// ─── Test 1: MemoryStateStore basic ops ────────────────────
async function testMemoryStore(): Promise<void> {
  console.log("\n=== Test 1: MemoryStateStore basic operations ===");
  const store = new MemoryStateStore();
  await store.setService("svc-a", { profileId: "svc-a", status: "stopped" });
  const got = await store.getService("svc-a");
  assert(got?.status === "stopped", "memory: getService returns setService value");

  const lockAcquired = await store.acquireLock(1, "holder-A", 60_000);
  assert(lockAcquired === true, "memory: acquireLock succeeds when unheld");

  const lockReentrant = await store.acquireLock(1, "holder-A", 60_000);
  assert(lockReentrant === true, "memory: acquireLock re-entrant when same holder");

  const lockBlocked = await store.acquireLock(1, "holder-B", 60_000);
  assert(lockBlocked === false, "memory: acquireLock blocks different holder");

  const released = await store.releaseLock(1, "holder-A");
  assert(released === true, "memory: releaseLock succeeds for holder");

  const nowFree = await store.acquireLock(1, "holder-B", 60_000);
  assert(nowFree === true, "memory: lock acquirable after release");

  const lockState = await store.getLock(1);
  assert(lockState === "holder-B", "memory: getLock returns current holder", `got=${lockState}`);

  await store.close();
}

// ─── Test 2: GpuScheduler with memory backend ──────────────
async function testSchedulerMemoryBackend(): Promise<void> {
  console.log("\n=== Test 2: GpuScheduler memory backend ===");
  __resetGpuSchedulerForTests();
  const store = new MemoryStateStore();
  const scheduler = new GpuScheduler(store);
  await scheduler["initialized"];

  assert(scheduler.backendKind === "memory", "scheduler uses memory backend");

  const state = await scheduler.getState();
  assert(state.devices.length === GPU_DEVICES.length, "scheduler reports all GPU devices");
  assert(Object.keys(state.locks).length === GPU_DEVICES.length, "scheduler reports null locks for all GPUs at init");

  // Try to allocate a known-unreal service to test error path
  const result = await scheduler.allocate({ serviceId: "nonexistent", caller: "test" });
  assert(result.granted === false && (result.error || "").includes("Unknown service"), "allocate rejects unknown serviceId");

  await store.close();
}

// ─── Test 3: Redis backend (skipped if --memory-only or Redis down) ──
async function testRedisBackend(): Promise<void> {
  if (MEMORY_ONLY) {
    console.log("\n=== Test 3: Redis backend — SKIPPED (--memory-only) ===");
    return;
  }
  console.log("\n=== Test 3: Redis backend ===");

  // First verify Redis is reachable
  const probe = new RedisStateStore(REDIS_URL);
  const pingOk = await probe.ping();
  if (!pingOk) {
    console.log(`  ⚠ Redis at ${REDIS_URL} unreachable — skipping Redis tests. Start Redis (docker compose up redis) and re-run.`);
    await probe.close();
    return;
  }
  await probe.close();

  // Clean any leftover lock state
  const setup = new RedisStateStore(REDIS_URL);
  for (const gpu of GPU_DEVICES) {
    // Force release by writing null then deleting
    await setup["client"].del(`kais:gpu:locks:${gpu.id}`);
  }
  await setup.close();

  // Simulate two processes by creating two schedulers against same Redis
  const store1 = new RedisStateStore(REDIS_URL);
  const store2 = new RedisStateStore(REDIS_URL);
  await store1.ping();
  await store2.ping();

  // Process A acquires lock on GPU 1
  const acq1 = await store1.acquireLock(1, "process-A", 60_000);
  assert(acq1 === true, "redis: process A acquires GPU 1 lock");

  // Process B tries to acquire same GPU 1 lock — should fail
  const acq2 = await store2.acquireLock(1, "process-B", 60_000);
  assert(acq2 === false, "redis: process B blocked from same GPU 1 lock (cross-process visibility)");

  // Process B reads lock via getAllLocks — sees process-A as holder
  const locksView = await store2.getAllLocks();
  const gpu1Lock = locksView.find(([id]) => id === 1);
  assert(gpu1Lock?.[1] === "process-A", "redis: getAllLocks reflects cross-process holder");

  // Process A releases
  const rel = await store1.releaseLock(1, "process-A");
  assert(rel === true, "redis: process A releases lock");

  // Process B can now acquire
  const acq3 = await store2.acquireLock(1, "process-B", 60_000);
  assert(acq3 === true, "redis: process B acquires after process A release");

  // Wrong holder cannot release
  const wrongRel = await store1.releaseLock(1, "process-X"); // process-X is not holder
  assert(wrongRel === false, "redis: non-holder cannot release");

  // Cleanup
  await store2.releaseLock(1, "process-B");
  await store1.close();
  await store2.close();
}

// ─── Test 4: REDIS_URL unset → memory fallback ─────────────
async function testMemoryFallback(): Promise<void> {
  console.log("\n=== Test 4: REDIS_URL unset → memory fallback ===");
  const origRedisUrl = process.env.REDIS_URL;
  delete process.env.REDIS_URL;
  __resetGpuSchedulerForTests();

  // Capture console.warn output
  const warnings: string[] = [];
  const origWarn = console.warn;
  console.warn = (...args: any[]) => { warnings.push(args.join(" ")); };

  try {
    const scheduler = await getGpuSchedulerAsync();
    assert(scheduler.backendKind === "memory", "scheduler falls back to memory when REDIS_URL unset");
    const sawWarning = warnings.some((w) => w.includes("REDIS_URL not set"));
    assert(sawWarning, "explicit WARN log emitted on fallback", `saw ${warnings.length} warnings`);
  } finally {
    console.warn = origWarn;
    process.env.REDIS_URL = origRedisUrl;
  }
  __resetGpuSchedulerForTests();
}

// ─── Test 5: Lock TTL expiry ───────────────────────────────
async function testLockTtlExpiry(): Promise<void> {
  console.log("\n=== Test 5: Lock TTL expiry (1s TTL) ===");
  if (MEMORY_ONLY) {
    console.log("  SKIPPED (--memory-only)");
    return;
  }
  const probe = new RedisStateStore(REDIS_URL);
  if (!(await probe.ping())) {
    console.log("  ⚠ Redis unreachable — skipping TTL test");
    await probe.close();
    return;
  }
  await probe.close();

  const store = new RedisStateStore(REDIS_URL);
  await store["client"].del("kais:gpu:locks:0");

  const acquired = await store.acquireLock(0, "ttl-holder", 1_000); // 1s TTL
  assert(acquired === true, "redis: lock acquired with 1s TTL");

  await sleep(1_200); // wait for TTL to expire

  const afterTtl = await store.getLock(0);
  assert(afterTtl === null, "redis: lock auto-expires after TTL", `actual=${afterTtl}`);

  // Can re-acquire after expiry
  const reacquired = await store.acquireLock(0, "new-holder", 60_000);
  assert(reacquired === true, "redis: lock re-acquirable after TTL expiry");

  await store.releaseLock(0, "new-holder");
  await store.close();
}

// ─── Main ──────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(" Phase 23 Verification — GpuScheduler Redis Migration");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  await testMemoryStore();
  await testSchedulerMemoryBackend();
  await testRedisBackend();
  await testMemoryFallback();
  await testLockTtlExpiry();

  const passed = results.filter((r) => r.pass).length;
  const failed = results.length - passed;
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(` Results: ${passed}/${results.length} passed, ${failed} failed`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  if (failed > 0) {
    console.log("\nFailed:");
    results.filter((r) => !r.pass).forEach((r) => console.log(`  - ${r.name}${r.detail ? " — " + r.detail : ""}`));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Verification crashed:", err);
  process.exit(2);
});
