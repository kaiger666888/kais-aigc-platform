/**
 * memoryStateStore.test.ts — 锁 TTL 惰性过期单测 (C4, 2026-09-06 GPU 加固)。
 *
 * 运行方式 (node:test + tsx):
 *   node --import tsx --test src/services/gpu/__tests__/memoryStateStore.test.ts
 *
 * 背景: acquireLock 此前忽略 _ttlMs (R1 关联缺陷) — 持有者崩溃后锁永不过期。
 * 注入假钟做时间跳跃, 不真睡。
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { MemoryStateStore } from "../memoryStateStore";

const T0 = 1_780_000_000_000;
const TTL_MS = 5 * 60 * 1000; // 与 GpuScheduler LOCK_TTL_MS 同量级

function makeStore(): { store: MemoryStateStore; tick: (ms: number) => void } {
  let clock = T0;
  const store = new MemoryStateStore({ now: () => clock });
  return { store, tick: (ms: number) => { clock += ms; } };
}

describe("C4 MemoryStateStore 锁 TTL 惰性过期", () => {
  it("TTL 内持有: 他人 acquire 拒绝, getLock/getAllLocks 可见", async () => {
    const { store } = makeStore();
    assert.equal(await store.acquireLock(1, "holder-a", TTL_MS), true);
    assert.equal(await store.getLock(1), "holder-a");
    assert.equal(await store.acquireLock(1, "holder-b", TTL_MS), false, "TTL 内他人不得获取");
    const locks = await store.getAllLocks();
    assert.deepEqual(locks.find(([id]) => id === 1), [1, "holder-a"]);
  });

  it("TTL 过后可被他人获取 (过期锁视为无锁)", async () => {
    const { store, tick } = makeStore();
    assert.equal(await store.acquireLock(1, "holder-a", TTL_MS), true);
    tick(TTL_MS + 1); // 越过有效期
    assert.equal(await store.acquireLock(1, "holder-b", TTL_MS), true, "过期后他人应可获取");
    assert.equal(await store.getLock(1), "holder-b");
    // getAllLocks 的过期清扫: 再过期一次后投影为 null
    tick(TTL_MS + 1);
    const locks = await store.getAllLocks();
    assert.deepEqual(locks.find(([id]) => id === 1), [1, null], "过期锁在 getAllLocks 投影为 null");
    assert.equal(await store.getLock(1), null);
  });

  it("原 holder release 幂等: 过期未易主 → 成功; 已被他人接手 → 不误伤新 holder", async () => {
    const { store, tick } = makeStore();
    assert.equal(await store.acquireLock(1, "holder-a", TTL_MS), true);
    tick(TTL_MS + 1);
    // 过期但无人接手: 原 holder release 幂等成功
    assert.equal(await store.releaseLock(1, "holder-a"), true);
    assert.equal(await store.getLock(1), null);

    // 过期且已被 B 接手: A 的 release 失败, B 不受影响
    assert.equal(await store.acquireLock(1, "holder-b", TTL_MS), true);
    tick(TTL_MS + 1);
    assert.equal(await store.acquireLock(1, "holder-c", TTL_MS), true);
    assert.equal(await store.releaseLock(1, "holder-b"), false, "易主后原 holder release 应失败");
    assert.equal(await store.getLock(1), "holder-c", "新 holder 不被误伤");
  });

  it("重入 acquire 刷新 TTL 起点 (活跃持有者不被自己的重入判过期)", async () => {
    const { store, tick } = makeStore();
    assert.equal(await store.acquireLock(1, "holder-a", TTL_MS), true);
    tick(TTL_MS - 1_000); // 还差 1s 到期
    assert.equal(await store.acquireLock(1, "holder-a", TTL_MS), true, "重入应成功");
    tick(TTL_MS - 1_000); // 刷新后再走 (TTL - 1s): 若未刷新此时已过期
    assert.equal(await store.getLock(1), "holder-a", "重入刷新后仍应持有");
    assert.equal(await store.acquireLock(1, "holder-b", TTL_MS), false);
  });

  it("非持有者/无锁 release 返回 false (不抛错)", async () => {
    const { store } = makeStore();
    assert.equal(await store.releaseLock(1, "nobody"), false);
    assert.equal(await store.acquireLock(1, "holder-a", TTL_MS), true);
    assert.equal(await store.releaseLock(1, "holder-b"), false);
  });
});
