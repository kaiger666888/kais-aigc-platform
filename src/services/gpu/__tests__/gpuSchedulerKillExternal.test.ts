/**
 * GpuScheduler.ensureVram 尾部接线单测 — R2 裸进程外部清理 (2026-09-06 GPU 加固)。
 *
 * 运行方式 (同 gpuSchedulerPreempt.test.ts, node:test + tsx):
 *   node --import tsx --test src/services/gpu/__tests__/gpuSchedulerKillExternal.test.ts
 *
 * 隔离策略: 继承 TestScheduler 桩法 (docker/script/健康检查/显存全桩), 另桩化
 * killExternalGpuProcesses (protected 可桩化方法) — 全程零 /usr/local/bin 接触、
 * 零真实信号。显存用队列值驱动 (初始→逐次驱逐后→外部清理后的复查)。
 */
import "./gpuSchedulerRoles.setup";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { GpuScheduler } from "../GpuScheduler";
import type { SchedulerTuningOpts } from "../GpuScheduler";
import type { ServiceProfile } from "../types";
import { MemoryStateStore } from "../memoryStateStore";

/** 外部清理桩行为 */
type KillEffect = "free" | "noop" | "throw";

class KillExternalTestScheduler extends GpuScheduler {
  /** 显存读数队列: 每次 getGpuVramFree 消费一项; 队列耗尽后重复末项 */
  vramQueue: number[] = [24_000];
  killCalls: Array<[number, number]> = [];
  killEffect: KillEffect = "free";
  startCalls: string[] = [];
  stopCalls: string[] = [];

  constructor(opts?: SchedulerTuningOpts) {
    super(new MemoryStateStore(), opts);
  }

  protected override async executeStartStep(profile: ServiceProfile): Promise<void> {
    this.startCalls.push(profile.id);
  }

  protected override async executeStopStep(profile: ServiceProfile): Promise<void> {
    this.stopCalls.push(profile.id);
  }

  protected override async waitForHealthy(_profile: ServiceProfile, _maxMs?: number): Promise<boolean> {
    return true;
  }

  protected override async checkServiceAlive(_profile: ServiceProfile): Promise<boolean> {
    return true;
  }

  override async getGpuVramFree(_gpuId: number): Promise<number> {
    if (this.vramQueue.length > 1) return this.vramQueue.shift()!;
    return this.vramQueue[this.vramQueue.length - 1] ?? 24_000;
  }

  protected override async killExternalGpuProcesses(gpuId: number, neededFreeMb: number): Promise<void> {
    this.killCalls.push([gpuId, neededFreeMb]);
    if (this.killEffect === "throw") throw new Error("simulated script crash");
    if (this.killEffect === "free") this.vramQueue.unshift(24_000); // 模拟裸进程被清后显存达标
    // "noop": SKIP insufficient-after-kill — 显存读数不变
  }
}

function makeScheduler(vramQueue: number[], killEffect: KillEffect): KillExternalTestScheduler {
  const sched = new KillExternalTestScheduler({ now: () => 1_780_000_000_000, sleep: async () => {} });
  sched.vramQueue = vramQueue;
  sched.killEffect = killEffect;
  return sched;
}

// qwen-llm: GPU1, vramEstMb=20500, start 桩化; cosyvoice: GPU1, vramEstMb=3500 (驱逐候选)
const QWEN_NEED_MB = 20_500;

describe("R2 ensureVram 尾部接线 — 外部清理兜底", () => {
  it("free 足够时零调用 (红线: 不改变现有行为语义)", async () => {
    const sched = makeScheduler([24_000], "free");
    const r = await sched.allocate({ serviceId: "qwen-llm", caller: "t", idleTimeoutMs: 0 });
    assert.equal(r.granted, true);
    assert.deepEqual(sched.killCalls, [], "free 足够时不得调用外部清理");
    assert.deepEqual(sched.stopCalls, [], "free 足够时不得驱逐");
  });

  it("驱逐后仍不足 → 调用外部清理 → free 达标 → granted", async () => {
    // 读数序列: 初始 4000 → 驱逐 cosyvoice 后 8000 (仍 < 20500) → 外部清理后 24000
    const sched = makeScheduler([4_000, 8_000], "free");
    // 先让 cosyvoice 在 GPU1 跑起来 (作为驱逐候选)
    const warm = await sched.allocate({ serviceId: "cosyvoice", caller: "t-warm", idleTimeoutMs: 0 });
    assert.equal(warm.granted, true);
    sched.killCalls = [];

    const r = await sched.allocate({ serviceId: "qwen-llm", caller: "t", idleTimeoutMs: 0 });
    assert.equal(r.granted, true, "外部清理腾出显存后应 granted");
    assert.deepEqual(sched.stopCalls, ["cosyvoice"], "注册表驱逐先行");
    assert.equal(sched.killCalls.length, 1, "驱逐仍不足应恰好调用一次外部清理");
    assert.deepEqual(sched.killCalls[0], [1, QWEN_NEED_MB], "入参 = GPU 索引 + 需求总量");
    assert.deepEqual(r.evictedServices, ["cosyvoice"]);
  });

  it("外部清理无效果 (SKIP) → 仍返回原有结果 (granted, 不抛错)", async () => {
    const sched = makeScheduler([4_000, 8_000], "noop");
    const warm = await sched.allocate({ serviceId: "cosyvoice", caller: "t-warm", idleTimeoutMs: 0 });
    assert.equal(warm.granted, true);
    sched.killCalls = [];

    const r = await sched.allocate({ serviceId: "qwen-llm", caller: "t", idleTimeoutMs: 0 });
    assert.equal(r.granted, true, "清理失败不得打断 allocate (与接线前行为一致)");
    assert.deepEqual(sched.killCalls.length, 1);
    assert.deepEqual(r.evictedServices, ["cosyvoice"]);
  });

  it("外部清理抛异常 → 尾部 try/catch 吞错, allocate 照常完成", async () => {
    const sched = makeScheduler([4_000, 8_000], "throw");
    const warm = await sched.allocate({ serviceId: "cosyvoice", caller: "t-warm", idleTimeoutMs: 0 });
    assert.equal(warm.granted, true);
    sched.killCalls = [];

    const r = await sched.allocate({ serviceId: "qwen-llm", caller: "t", idleTimeoutMs: 0 });
    assert.equal(r.granted, true, "桩抛异常也不得冒泡");
    assert.deepEqual(sched.killCalls.length, 1);
  });

  it("无注册表服务可驱逐但 free 不足 (裸进程占卡画像) → 也触发外部清理", async () => {
    // 干净卡 + free=4000 < 20500: 候选为空, 尾部条件仍成立
    const sched = makeScheduler([4_000], "free");
    const r = await sched.allocate({ serviceId: "qwen-llm", caller: "t", idleTimeoutMs: 0 });
    assert.equal(r.granted, true);
    assert.deepEqual(sched.stopCalls, [], "无候选 → 不驱逐");
    assert.deepEqual(sched.killCalls, [[1, QWEN_NEED_MB]], "尾部仍应兜底调用");
    assert.deepEqual(r.evictedServices, []);
  });
});
