/**
 * GpuScheduler 打断/dev-TTL 单测 — M1 双卡调度 (docs/gpu-scheduling-architecture.md §2.2-§2.3)。
 *
 * 运行方式 (仿 gpuRoles.test.ts, node:test + tsx; 仓库无 vitest):
 *   node --import tsx --test src/services/gpu/__tests__/gpuSchedulerPreempt.test.ts
 *
 * 隔离策略:
 *   - 副作用 setup 模块写在被测模块 import 之前 (hermetic conf + nvidia-smi 桩),
 *     profileGpuIndex 解析吃桩 (qwen-llm/cosyvoice → GPU1)。
 *   - TestScheduler (preemptTestKit) 桩掉 docker/script/健康检查/显存查询 —
 *     全程零 docker、零网络、零 /opt 接触。
 *   - 假钟注入 (opts.now) + sleep 注入做 T1 超时/让卡/TTL 时间跳跃。
 */
import "./gpuSchedulerRoles.setup";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { TestScheduler, CLOCK_START } from "./preemptTestKit";

// 快照取 GPU1 条目的小工具 (preemptTestKit.gpuEntry 需要 assert — 这里直接内联等价)
async function gpu1(sched: TestScheduler) {
  const snap = await sched.getSchedulingState();
  const g = snap.gpus.find((x) => x.gpuIndex === 1);
  assert.ok(g, "snapshot 应含 GPU1");
  return g;
}

async function lastEventTypes(sched: TestScheduler): Promise<string[]> {
  const snap = await sched.getSchedulingState();
  return snap.events.map((e) => e.type);
}

// ─── 红线 1: 默认参数 = 今日行为 ─────────────────────────────────────────────

describe("M1 红线兼容性 — 无 dev/preempt 流量 = 今日行为", () => {
  it("普通 allocate (无 priorityClass) 逐位兼容: 无 preempt/TTL 副作用, 无新字段", async () => {
    let clock = CLOCK_START;
    const sched = new TestScheduler({ now: () => clock, sleep: async () => {} });
    const r = await sched.allocate({ serviceId: "cosyvoice", caller: "prod-batch", idleTimeoutMs: 0 });
    assert.equal(r.granted, true);
    assert.equal(r.preempted, undefined, "无 dev 流量时不得出现 preempted 字段");
    assert.equal(r.priorityClass, undefined, "未显式声明优先级类时不加该字段");
    assert.equal(r.devTtl, undefined);
    assert.equal(r.error, undefined);

    const g = await gpu1(sched);
    assert.equal(g.preempt, null, "无 dev 流量不建 preempt 记录");
    assert.equal(g.devTtl, null);
    assert.equal(g.running.length, 1);
    assert.equal(g.running[0].serviceId, "cosyvoice");
  });

  it("prod-P3 (缺省折叠) 在干净卡上正常派发, 行为与不传一致", async () => {
    let clock = CLOCK_START;
    const sched = new TestScheduler({ now: () => clock, sleep: async () => {} });
    const r = await sched.allocate({ serviceId: "cosyvoice", caller: "prod-batch", priorityClass: "prod-P3", idleTimeoutMs: 0 });
    assert.equal(r.granted, true);
    assert.equal(r.preempted, undefined);
    assert.equal(r.devTtl, undefined);
  });
});

// ─── 优先级三元组入口校验 ────────────────────────────────────────────────────

describe("M1 allocate 入口 — 非法组合零调度动作直接拒绝", () => {
  it("force + prod-P2 → granted:false, 不发生任何启停", async () => {
    let clock = CLOCK_START;
    const sched = new TestScheduler({ now: () => clock, sleep: async () => {} });
    const r = await sched.allocate({
      serviceId: "cosyvoice", caller: "x", priorityClass: "prod-P2", force: true, idleTimeoutMs: 0,
    });
    assert.equal(r.granted, false);
    assert.match(r.error!, /force 仅 dev-P0 合法/);
    assert.deepEqual(sched.startCalls, [], "非法组合不得触发服务启动");
  });

  it("ttlMin + prod 类 → 拒绝", async () => {
    let clock = CLOCK_START;
    const sched = new TestScheduler({ now: () => clock, sleep: async () => {} });
    const r = await sched.allocate({
      serviceId: "cosyvoice", caller: "x", priorityClass: "prod-P3", ttlMin: 30, idleTimeoutMs: 0,
    });
    assert.equal(r.granted, false);
    assert.match(r.error!, /ttlMin 仅 dev 类合法/);
    assert.deepEqual(sched.startCalls, []);
  });
});

// ─── T0 停派发 / T2 (force) ─────────────────────────────────────────────────

describe("M1 T0/T2 — dev 到达后 prod 停派发", () => {
  it("dev-P0+force 占卡 → 后续 prod allocate 立即拒绝 (preempted:true + preemptInfo)", async () => {
    let clock = CLOCK_START;
    const sched = new TestScheduler({ now: () => clock, sleep: async () => {} });
    // prod 先占卡
    const prod1 = await sched.allocate({ serviceId: "cosyvoice", caller: "prod-batch", idleTimeoutMs: 0 });
    assert.equal(prod1.granted, true);

    // dev-P0 force 直接 T2 占卡
    const dev = await sched.allocate({
      serviceId: "qwen-llm", caller: "kai-interactive", priorityClass: "dev-P0", force: true, idleTimeoutMs: 0,
    });
    assert.equal(dev.granted, true);

    // T0: prod 新派发被拒, 在跑任务不受影响 (cosyvoice 仍 running)
    const prod2 = await sched.allocate({ serviceId: "cosyvoice", caller: "prod-batch-2", idleTimeoutMs: 0 });
    assert.equal(prod2.granted, false);
    assert.equal(prod2.preempted, true);
    assert.equal(prod2.preemptInfo?.priorityClass, "dev-P0");
    assert.equal(prod2.preemptInfo?.requester, "kai-interactive");
    assert.equal(prod2.preemptInfo?.phase, "held");

    const g = await gpu1(sched);
    assert.equal(g.preempt?.phase, "held");
    assert.equal(g.running.find((s) => s.serviceId === "cosyvoice")?.status, "running", "T0 不影响在跑任务");
    assert.equal(g.priorityDistribution["dev-P0"], 1);
    const types = await lastEventTypes(sched);
    assert.ok(types.includes("prod-rejected-t0"));
  });

  it("dev-P0 fast-path (服务已驻留) 只记观测字段, 不建 preempt 记录", async () => {
    let clock = CLOCK_START;
    const sched = new TestScheduler({ now: () => clock, sleep: async () => {} });
    // prod 先拉起 qwen-llm (桩 waitForHealthy → healthy; 存活探测已桩化)
    await sched.allocate({ serviceId: "qwen-llm", caller: "prod-batch", idleTimeoutMs: 0 });
    // dev 同服务 allocate → 快速路径, 未发生占卡
    const dev = await sched.allocate({
      serviceId: "qwen-llm", caller: "kai-interactive", priorityClass: "dev-P0", idleTimeoutMs: 0,
    });
    assert.equal(dev.granted, true);
    assert.equal(dev.devTtl, undefined, "快速路径不发生占卡, 无 TTL");
    const g = await gpu1(sched);
    assert.equal(g.preempt, null, "快速路径不建 preempt 记录");
    // T0 未武装 → prod 照常派发
    const prod2 = await sched.allocate({ serviceId: "qwen-llm", caller: "prod-batch-2", idleTimeoutMs: 0 });
    assert.equal(prod2.granted, true);
  });
});

// ─── T1 边界让卡 / 超时升 T2 ────────────────────────────────────────────────

describe("M1 T1 — dev 非 force 到达, 等 prod 边界让卡", () => {
  it("prod 让卡后 dev 获卡, preempt 转 held + TTL 起算", async () => {
    let clock = CLOCK_START;
    const sched = new TestScheduler({
      now: () => clock,
      // 让卡模拟: prod 在第一次轮询间隙按镜头边界收尾 (release 走既有停服路径)
      sleep: async () => { await sched.release("cosyvoice", "boundary-yield"); },
    });
    await sched.allocate({ serviceId: "cosyvoice", caller: "prod-render", idleTimeoutMs: 0 });

    const dev = await sched.allocate({
      serviceId: "qwen-llm", caller: "kai-bg", priorityClass: "dev-P1", idleTimeoutMs: 0,
    });
    assert.equal(dev.granted, true, "prod 让卡后 dev 应获卡");
    assert.ok(dev.devTtl, "dev 获卡应带 TTL");
    assert.equal(dev.devTtl!.grantedMin, 120, "缺省 TTL = 120min");
    assert.equal(dev.devTtl!.renewals, 0);

    const g = await gpu1(sched);
    assert.equal(g.preempt?.phase, "held");
    assert.equal(g.preempt?.priorityClass, "dev-P1");
    assert.equal(g.preempt?.holderServiceId, "qwen-llm");
    assert.ok(g.devTtl);
    assert.ok(g.devTtl!.remainingMs > 0);
    const types = await lastEventTypes(sched);
    assert.ok(types.includes("preempt-requested"));
    assert.ok(types.includes("dev-granted"));
    assert.ok(!types.includes("t1-timeout-escalated"), "边界内让卡不应升级 T2");
  });

  it("T1 上限 (注入 5min) 超时自动升 T2: ensureVram 驱逐 + evictedForDev 标记", async () => {
    let clock = CLOCK_START;
    const sched = new TestScheduler({
      now: () => clock,
      sleep: async () => { clock += 60_000; }, // 每次轮询推进 1min, prod 始终不让卡
      t1TimeoutMs: 5 * 60_000,
    });
    sched.vramFree = 1_000; // 逼 ensureVram 走驱逐 (qwen-llm 需 20500MB)
    await sched.allocate({ serviceId: "cosyvoice", caller: "prod-render", idleTimeoutMs: 0 });

    const dev = await sched.allocate({
      serviceId: "qwen-llm", caller: "kai-interactive", priorityClass: "dev-P0", idleTimeoutMs: 0,
    });
    assert.equal(dev.granted, true, "T2 升级后 dev 应获卡");
    assert.deepEqual(dev.evictedForDev, ["cosyvoice"], "被杀 prod 任务标记 evictedForDev");

    const g = await gpu1(sched);
    assert.equal(g.preempt?.phase, "held");
    assert.equal(g.preempt?.tier, "T2");
    assert.ok(!g.running.some((s) => s.serviceId === "cosyvoice"), "被杀 prod 不再在跑");
    const types = await lastEventTypes(sched);
    assert.ok(types.includes("t1-timeout-escalated"));
    assert.ok(types.includes("t2-evicted"));

    const evT2 = (await sched.getSchedulingState()).events.find((e) => e.type === "t2-evicted");
    assert.deepEqual(evT2?.detail.evictedForDev, ["cosyvoice"]);
    // T0 随 held 生效
    const prod2 = await sched.allocate({ serviceId: "cosyvoice", caller: "prod-render-2", idleTimeoutMs: 0 });
    assert.equal(prod2.granted, false);
    assert.equal(prod2.preempted, true);
  });

  it("调用方 waitTimeoutMs 短于 T1 上限 → 到点放弃且 preempt 撤销 (卡还 prod)", async () => {
    let clock = CLOCK_START;
    const sched = new TestScheduler({
      now: () => clock,
      sleep: async () => { clock += 10_000; },
    });
    await sched.allocate({ serviceId: "cosyvoice", caller: "prod-render", idleTimeoutMs: 0 });

    const dev = await sched.allocate({
      serviceId: "qwen-llm", caller: "kai-bg", priorityClass: "dev-P1",
      waitTimeoutMs: 30_000, idleTimeoutMs: 0,
    });
    assert.equal(dev.granted, false);
    assert.match(dev.error!, /waitTimeoutMs 截断/);
    const g = await gpu1(sched);
    assert.equal(g.preempt, null, "无人等待的 requested 记录应撤销");
    // prod 不受 T0 影响 (卡已还)
    const prod2 = await sched.allocate({ serviceId: "cosyvoice", caller: "prod-render-2", idleTimeoutMs: 0 });
    assert.equal(prod2.granted, true);
  });
});

// ─── dev-TTL: 到期归还 + 续期 ───────────────────────────────────────────────

describe("M1 dev-TTL — 到期自动归还 + 续期原语", () => {
  async function heldScheduler(): Promise<{ sched: TestScheduler; clock: { v: number } }> {
    const clock = { v: CLOCK_START };
    const sched = new TestScheduler({ now: () => clock.v, sleep: async () => {} });
    await sched.allocate({
      serviceId: "qwen-llm", caller: "kai-interactive", priorityClass: "dev-P0", idleTimeoutMs: 0,
    });
    const g = await gpu1(sched);
    assert.equal(g.preempt?.phase, "held");
    return { sched, clock };
  }

  it("TTL 到期: 惰性清扫归还 — 停 dev 服务 + 清 preempt + 事件", async () => {
    const { sched, clock } = await heldScheduler();
    clock.v += 121 * 60_000; // 越过 120min TTL
    const g = await gpu1(sched); // getSchedulingState 读取即清扫
    assert.equal(g.preempt, null, "TTL 到期 preempt 应归还");
    assert.equal(g.devTtl, null);
    const state = await sched.getState();
    const qwen = state.services.find((s) => s.profileId === "qwen-llm");
    assert.equal(qwen?.status, "stopped", "TTL 到期应停 dev 服务 (既有 idle-release 停服路径)");
    const types = await lastEventTypes(sched);
    assert.ok(types.includes("dev-ttl-expired"));
    // 归还后 prod 恢复派发
    const prod = await sched.allocate({ serviceId: "cosyvoice", caller: "prod-batch", idleTimeoutMs: 0 });
    assert.equal(prod.granted, true);
  });

  it("TTL 内 (未到期) 不归还", async () => {
    const { sched, clock } = await heldScheduler();
    clock.v += 119 * 60_000;
    const g = await gpu1(sched);
    assert.equal(g.preempt?.phase, "held", "TTL 未到期仍持有");
    assert.ok(g.devTtl && g.devTtl.remainingMs > 0 && g.devTtl.remainingMs <= 60_000);
  });

  it("renewDevTtl: 重置计时 + renewals 递增; 到期判定跟随新时刻", async () => {
    const { sched, clock } = await heldScheduler();
    const r1 = await sched.renewDevTtl(1, { ttlMin: 30, requester: "kai" });
    assert.ok(r1.ok);
    if (r1.ok) {
      assert.equal(r1.ttl.renewals, 1);
      assert.equal(r1.ttl.grantedMin, 30);
      assert.equal(Date.parse(r1.ttl.expiresAt), clock.v + 30 * 60_000);
    }
    clock.v += 31 * 60_000; // 越过续期后的 30min (但未到原 120min)
    const g = await gpu1(sched);
    assert.equal(g.preempt, null, "续期后到期判定应跟随新 expiresAt");
    const types = await lastEventTypes(sched);
    assert.ok(types.includes("dev-ttl-renewed"));
    assert.ok(types.includes("dev-ttl-expired"));
  });

  it("renewDevTtl 非法输入: 无占用卡 / 超上限 ttlMin → ok:false", async () => {
    let clock = CLOCK_START;
    const sched = new TestScheduler({ now: () => clock, sleep: async () => {} });
    const none = await sched.renewDevTtl(1, {});
    assert.equal(none.ok, false);
    const { sched: held } = await heldScheduler();
    const bad = await held.renewDevTtl(1, { ttlMin: 481 });
    assert.equal(bad.ok, false);
  });

  it("releaseDevOccupation: 手动归还 (停 holder 服务 + 清记录)", async () => {
    const { sched } = await heldScheduler();
    const r = await sched.releaseDevOccupation(1, "kai");
    assert.ok(r.ok);
    const g = await gpu1(sched);
    assert.equal(g.preempt, null);
    const state = await sched.getState();
    assert.equal(state.services.find((s) => s.profileId === "qwen-llm")?.status, "stopped");
    const none = await sched.releaseDevOccupation(1, "kai");
    assert.equal(none.ok, false, "重复归还应报无记录");
  });
});

// ─── 手动强制打断端点原语 ───────────────────────────────────────────────────

describe("M1 forcePreempt — 手动 T2 硬杀原语 (dev-P0 专属)", () => {
  it("硬杀在跑 prod + 占卡起算 TTL + T0 生效", async () => {
    let clock = CLOCK_START;
    const sched = new TestScheduler({ now: () => clock, sleep: async () => {} });
    await sched.allocate({ serviceId: "cosyvoice", caller: "prod-render", idleTimeoutMs: 0 });

    const r = await sched.forcePreempt(1, { requester: "kai", ttlMin: 60 });
    assert.ok(r.ok);
    if (r.ok) {
      assert.deepEqual(r.evictedForDev, ["cosyvoice"]);
      assert.equal(r.preempt.phase, "held");
      assert.equal(r.preempt.tier, "T2");
      assert.equal(r.preempt.ttl?.grantedMin, 60);
    }
    const g = await gpu1(sched);
    assert.equal(g.running.length, 0, "卡应被清空");
    const prod2 = await sched.allocate({ serviceId: "cosyvoice", caller: "prod-render-2", idleTimeoutMs: 0 });
    assert.equal(prod2.granted, false);
    assert.equal(prod2.preempted, true);
    const types = await lastEventTypes(sched);
    assert.ok(types.includes("t2-evicted"));
    assert.ok(types.includes("dev-granted"));
  });

  it("非 dev-P0 / 缺 requester / 非法 ttlMin → 拒绝", async () => {
    let clock = CLOCK_START;
    const sched = new TestScheduler({ now: () => clock, sleep: async () => {} });
    const badClass = await sched.forcePreempt(1, { requester: "x", priorityClass: "prod-P2" });
    assert.equal(badClass.ok, false);
    const noReq = await sched.forcePreempt(1, { requester: "" });
    assert.equal(noReq.ok, false);
    const badTtl = await sched.forcePreempt(1, { requester: "x", ttlMin: 999 });
    assert.equal(badTtl.ok, false);
  });
});
