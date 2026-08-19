/**
 * src/lib/__tests__/gpuQueueCrossProc.test.ts — 跨进程门控单测 (P3-A/D4)
 *
 * 运行: cd /data/workspace/kais-aigc-platform && node --import tsx --test src/lib/__tests__/gpuQueueCrossProc.test.ts
 *
 * 两个 MemoryGate 共享一个 Map + 不同 owner = 模拟两个进程 (owner 是门控互斥的
 * 判据, 见 gpuQueueCrossProc.ts)。redis 行为与 MemoryGate 同语义 (SET NX PX /
 * TTL 过期 / Lua 原子释放), 不起真实 redis — 该层由部署后回归覆盖。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MemoryGate,
  CrossProcGateTimeoutError,
  __setQueueGateForTests,
  __resetQueueGateForTests,
} from "../gpuQueueCrossProc";
import { withGpuQueueTimed } from "../gpuVramManager";

const GPU = 301; // 独立 gpuIndex, 与其他测试文件隔离

test("strict: 异主互斥 — B 等待直到 A 释放", async () => {
  const shared = new Map();
  const gateA = new MemoryGate(shared, "strict", 60_000, 10, "owner-A");
  const gateB = new MemoryGate(shared, "strict", 60_000, 10, "owner-B");

  await gateA.acquire(GPU, "engine_a");
  // B 超时拒绝
  await assert.rejects(
    () => gateB.acquire(GPU, "engine_b", 80),
    (err: unknown) => err instanceof CrossProcGateTimeoutError && err.kind === "queue_crossproc_timeout",
  );
  // A 释放后 B 拿到
  gateA.release(GPU);
  await gateB.acquire(GPU, "engine_b", 500);
  gateB.release(GPU);
});

test("strict: 异主 TTL 过期后可抢占 (崩溃属主兜底)", async () => {
  const shared = new Map();
  // owner-C 的 entry 已过期
  shared.set(GPU, { owner: "owner-C", engine: "crashed", expiresAt: Date.now() - 1 });
  const gateD = new MemoryGate(shared, "strict", 60_000, 10, "owner-D");
  await gateD.acquire(GPU, "engine_d", 100); // 不应等待/抛错
  gateD.release(GPU);
});

test("strict: 同 owner 重入放行", async () => {
  const shared = new Map();
  const gate = new MemoryGate(shared, "strict", 60_000, 10, "owner-X");
  await gate.acquire(GPU, "e1");
  await gate.acquire(GPU, "e2", 100); // 同 owner 不自锁
  gate.release(GPU);
  gate.release(GPU); // 幂等
});

test("mirror: 异主存在也不阻塞 (只留碰撞痕迹)", async () => {
  const shared = new Map();
  shared.set(GPU, { owner: "owner-A", engine: "engine_a", expiresAt: Date.now() + 60_000 });
  const gateB = new MemoryGate(shared, "mirror", 60_000, 10, "owner-B");
  const start = Date.now();
  await gateB.acquire(GPU, "engine_b"); // 立即返回
  assert.ok(Date.now() - start < 50, "mirror 模式不应阻塞");
});

test("integration: withGpuQueueTimed 过 strict 门 — 异主短 TTL 残留在门等待期内过期", async () => {
  const shared = new Map();
  shared.set(GPU + 1, { owner: "owner-Z", engine: "stale", expiresAt: Date.now() + 60 }); // 60ms 后过期
  const gate = new MemoryGate(shared, "strict", 60_000, 5, "owner-real");
  __setQueueGateForTests(gate);
  try {
    const result = await withGpuQueueTimed(
      "t_crossproc",
      async () => "ok",
      { gpuIndex: GPU + 1, skipVram: true, lockWaitTimeoutMs: 3000 },
    );
    assert.equal(result.data, "ok");
    // 门释放后共享 map 清空
    assert.equal(shared.get(GPU + 1), undefined);
  } finally {
    __resetQueueGateForTests();
  }
});

test("integration: 门超时 → CrossProcGateTimeoutError 且进程内锁归还 (后续作业可获锁)", async () => {
  const shared = new Map();
  shared.set(GPU + 2, { owner: "owner-forever", engine: "stuck", expiresAt: Date.now() + 60_000 });
  const gate = new MemoryGate(shared, "strict", 60_000, 5, "owner-real");
  __setQueueGateForTests(gate);
  try {
    await assert.rejects(
      () =>
        withGpuQueueTimed(
          "t_gate_timeout",
          async () => "never",
          { gpuIndex: GPU + 2, skipVram: true, lockWaitTimeoutMs: 60 }, // 门 deadline = 60ms
        ),
      (err: unknown) => err instanceof CrossProcGateTimeoutError,
    );
    // 进程内锁必须已归还: 新作业 (换掉卡死的门) 能立刻获锁
    __setQueueGateForTests(new MemoryGate(new Map(), "strict", 60_000, 5, "owner-real2"));
    const r2 = await withGpuQueueTimed(
      "t_after_gate_timeout",
      async () => "recovered",
      { gpuIndex: GPU + 2, skipVram: true, lockWaitTimeoutMs: 1000 },
    );
    assert.equal(r2.data, "recovered");
  } finally {
    __resetQueueGateForTests();
  }
});
