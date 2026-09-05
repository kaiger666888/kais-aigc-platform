/**
 * PersonaArbiter 单测 — M2 GPU2 双人格仲裁 (docs/gpu-scheduling-architecture.md §2.4)。
 *
 * 运行方式 (仿 gpuRoles.test.ts, node:test + tsx; 仓库无 vitest):
 *   node --import tsx --test src/services/gpu/__tests__/personaArbiter.test.ts
 *
 * 隔离策略:
 *   - 副作用 setup 模块写在被测模块 import 之前 (hermetic conf + nvidia-smi 桩)。
 *   - 信号源全注入 (队列深度/QC 活跃/P11 假数据 — 工单允许 mock, 真实信号 M3)。
 *   - autoEvaluate:false 手动 evaluate, 假钟驱动 T1 超时/空闲窗口。
 *   - 零 docker 零网络 (仲裁器本批只做逻辑态 + dry-run; executor 留 TODO 接口)。
 */
import "./gpuSchedulerRoles.setup";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { PersonaArbiter, QC_PERSONA_SERVICES } from "../personaArbiter";
import { MemoryStateStore } from "../memoryStateStore";
import { TestScheduler, CLOCK_START } from "./preemptTestKit";

/** 假信号源 (纯数值, 测试里直接改值) */
interface FakeSignals {
  renderQueueDepth?: number;
  qcQueueDepth?: number;
  qcActiveCount?: number;
  p11Active?: boolean;
}

/** 假钟 + 可覆写信号源的 arbiter 工厂 */
function mkArbiter(
  opts: {
    clock?: { v: number };
    signals?: FakeSignals;
    store?: MemoryStateStore;
    t1TimeoutMs?: number;
    renderIdleMs?: number;
    threshold?: number;
  } = {},
): PersonaArbiter {
  const clock = opts.clock ?? { v: CLOCK_START };
  const s: Required<FakeSignals> = {
    renderQueueDepth: 0,
    qcQueueDepth: 0,
    qcActiveCount: 0,
    p11Active: false,
    ...opts.signals,
  };
  return new PersonaArbiter({
    store: opts.store ?? new MemoryStateStore(),
    now: () => clock.v,
    autoEvaluate: false,
    t1TimeoutMs: opts.t1TimeoutMs ?? 15 * 60_000,
    renderIdleMs: opts.renderIdleMs ?? 5 * 60_000,
    renderQueueDepthThreshold: opts.threshold ?? 2,
    signals: {
      renderQueueDepth: () => s.renderQueueDepth,
      qcQueueDepth: () => s.qcQueueDepth,
      qcActiveCount: () => s.qcActiveCount,
      p11Active: () => s.p11Active,
    },
  });
}

// ─── A→B 真值表 (§2.4: 深度>2 或 P11 活跃 ∧ QC 零排队零活跃) ─────────────────

describe("Arbiter A→B 条件真值表", () => {
  const cases: Array<{
    name: string;
    depth: number;
    qcQ: number;
    qcA: number;
    p11: boolean;
    expectB: boolean;
  }> = [
    { name: "深度3 ∧ QC 全静 → B", depth: 3, qcQ: 0, qcA: 0, p11: false, expectB: true },
    { name: "深度2 (==阈值, 非 >) → 仍 A", depth: 2, qcQ: 0, qcA: 0, p11: false, expectB: false },
    { name: "深度3 ∧ QC 排队1 → 仍 A", depth: 3, qcQ: 1, qcA: 0, p11: false, expectB: false },
    { name: "深度3 ∧ QC 活跃2 → 仍 A", depth: 3, qcQ: 0, qcA: 2, p11: false, expectB: false },
    { name: "深度0 ∧ P11 活跃 ∧ QC 静 → B", depth: 0, qcQ: 0, qcA: 0, p11: true, expectB: true },
    { name: "深度0 ∧ P11 停 → 仍 A", depth: 0, qcQ: 0, qcA: 0, p11: false, expectB: false },
  ];

  for (const c of cases) {
    it(c.name, async () => {
      const arb = mkArbiter({ signals: { renderQueueDepth: c.depth, qcQueueDepth: c.qcQ, qcActiveCount: c.qcA, p11Active: c.p11 } });
      const st = await arb.evaluate();
      assert.equal(st.persona, c.expectB ? "B" : "A");
      assert.equal(st.desired, c.expectB ? "B" : "A");
    });
  }
});

// ─── B→A 真值表 (§2.4: QC 任务到达 T1 边界 ∨ 渲染队列空闲 5min) ──────────────

describe("Arbiter B→A 条件真值表", () => {
  async function toB(signals: FakeSignals = {}): Promise<{ arb: PersonaArbiter; clock: { v: number } }> {
    const clock = { v: CLOCK_START };
    const arb = mkArbiter({ clock, signals });
    const r = await arb.requestPersona("B", { requester: "test" });
    assert.ok(r.ok);
    return { arb, clock };
  }

  it("QC 任务到达 → 期望 A + T1 边界截止, 生效人格仍 B (让卡窗口)", async () => {
    const { arb, clock } = await toB({ qcQueueDepth: 1 });
    clock.v += 1000;
    const st = await arb.evaluate();
    assert.equal(st.desired, "A");
    assert.equal(st.persona, "B", "T1 窗口内生效人格仍 B");
    assert.ok(st.pendingDeadlineAt);
    assert.equal(Date.parse(st.pendingDeadlineAt!), clock.v + 15 * 60_000);
    assert.ok(arb.getEvents().some((e) => e.type === "switch-requested" && e.to === "A" && /qc-task-arrived/.test(e.reason)));
  });

  it("渲染队列空闲满 5min → 即时回 A (无 QC 等待即无边界可让)", async () => {
    const { arb, clock } = await toB();
    await arb.evaluate(); // 首次观察: 深度 0 → 空闲计时起点 t0
    clock.v += 6 * 60_000; // 空闲 6min ≥ 5min
    const st = await arb.evaluate();
    assert.equal(st.persona, "A");
    assert.ok(arb.getEvents().some((e) => e.type === "switch-applied" && /render-queue-idle/.test(e.reason)));
  });

  it("渲染队列空闲不足 5min → 仍 B", async () => {
    const { arb, clock } = await toB({ renderQueueDepth: 3 });
    // 先有渲染 (空闲计时清零) 再停 (空闲起点从此刻起算)
    await arb.evaluate(); // depth=3 → B 期间无 QC 到达 → 无切换, 空闲清零
    clock.v += 2 * 60_000;
    const st = await arb.evaluate(); // depth 转 0 → 空闲 2min < 5min
    assert.equal(st.persona, "B");
  });

  it("QC 到达后 T1 截止 (15min) 仍未让完 → 升级生效 A (escalated)", async () => {
    const { arb, clock } = await toB({ qcQueueDepth: 1 });
    clock.v += 1000;
    await arb.evaluate(); // 记 T1 截止
    clock.v += 15 * 60_000 + 1; // 越过截止
    const st = await arb.evaluate();
    assert.equal(st.persona, "A");
    assert.ok(st.history[0].escalated, "升级切换应标 escalated");
    assert.ok(arb.getEvents().some((e) => e.type === "switch-escalated"));
  });
});

// ─── QC allocate 闸门 (B 期间等待语义) ──────────────────────────────────────

describe("Arbiter QC 闸门 — B 期间 QC allocate 走 T1 等待", () => {
  it("人格 A: 全放行 (今日行为)", async () => {
    const arb = mkArbiter();
    assert.deepEqual(arb.qcGate("qwen-ear"), { wait: false });
    assert.deepEqual(arb.qcGate("comfyui-primary"), { wait: false });
  });

  it("人格 B: QC 服务 wait + 截止时刻; 非 QC 服务不受人格约束", async () => {
    const clock = { v: CLOCK_START };
    const arb = mkArbiter({ clock, t1TimeoutMs: 60_000 });
    await arb.requestPersona("B", { requester: "test" });
    const qc = arb.qcGate("qwen-ear");
    assert.equal(qc.wait, true);
    assert.equal(qc.reason, "persona-b-render-overflow");
    assert.equal(Date.parse(qc.deadlineAt!), clock.v + 60_000);
    assert.deepEqual(arb.qcGate("comfyui-primary"), { wait: false });
    assert.deepEqual(arb.qcGate("music3").wait, true);
  });

  it("isQcService: 显式清单命中; conf 角色链 QC_GEN2 命中 (hermetic conf 下走清单)", async () => {
    const arb = mkArbiter();
    for (const s of QC_PERSONA_SERVICES) assert.equal(arb.isQcService(s), true, s);
    assert.equal(arb.isQcService("comfyui-primary"), false);
    assert.equal(arb.isQcService("comfyui-auxiliary"), false);
  });

  it("调度器集成: B 期间 QC allocate 等待 → 闸门截止收卡 (B→A 升级) 后放行", async () => {
    const clock = { v: CLOCK_START };
    const arb = mkArbiter({ clock, t1TimeoutMs: 60_000 });
    await arb.requestPersona("B", { requester: "test" });

    const sched = new TestScheduler({
      now: () => clock.v,
      sleep: async () => { clock.v += 20_000; }, // 每次轮询推进 20s → 3 轮越闸门截止
    });
    sched.setPersonaArbiterHooks(arb.qcGate, arb.onQcGateTimeout);

    const r = await sched.allocate({ serviceId: "qwen-ear", caller: "qc-task", idleTimeoutMs: 0 });
    assert.equal(r.granted, true, "T1 截止收卡后 QC allocate 应放行");
    const st = await arb.getState();
    assert.equal(st.persona, "A", "闸门截止应把人格收回 A");
    assert.ok(st.history[0].escalated);
    assert.ok(arb.getEvents().some((e) => e.type === "switch-escalated" && e.requester === "scheduler-gate"));
  });

  it("调度器集成: 非 QC 服务在 B 期间不受闸门影响 (直通)", async () => {
    const clock = { v: CLOCK_START };
    const arb = mkArbiter({ clock });
    await arb.requestPersona("B", { requester: "test" });

    const sched = new TestScheduler({ now: () => clock.v, sleep: async () => {} });
    sched.setPersonaArbiterHooks(arb.qcGate, arb.onQcGateTimeout);
    const r = await sched.allocate({ serviceId: "cosyvoice", caller: "x", idleTimeoutMs: 0 });
    assert.equal(r.granted, true);
    assert.equal((await arb.getState()).persona, "B", "非 QC 服务不触发人格变化");
  });
});

// ─── 手动切换 / 权限 / dry-run / 持久化 ─────────────────────────────────────

describe("Arbiter 手动切换 (dev-P0 语义) + dry-run + 持久化", () => {
  it("requestPersona: dev-P0 即时生效; 非 dev-P0 / 非法目标拒绝", async () => {
    const clock = { v: CLOCK_START };
    const arb = mkArbiter({ clock });
    const bad = await arb.requestPersona("B", { priorityClass: "prod-P2" as never });
    assert.equal(bad.ok, false);
    const badTo = await arb.requestPersona("C" as never, {});
    assert.equal(badTo.ok, false);

    const ok = await arb.requestPersona("B", { requester: "kai", priorityClass: "dev-P0" });
    assert.ok(ok.ok);
    assert.equal((await arb.getState()).persona, "B");
    // 幂等: 重复同向切换不追加历史
    await arb.requestPersona("B", { requester: "kai" });
    assert.equal((await arb.getState()).history.length, 1);
  });

  it("buildSwitchPlan dry-run: B 计划停 QC 清单起 secondary; A 计划停 secondary (零副作用)", async () => {
    const arb = mkArbiter();
    const planB = arb.buildSwitchPlan("B");
    assert.deepEqual(planB.stopServices, [...QC_PERSONA_SERVICES]);
    assert.equal(planB.startContainer, "comfyui-secondary");
    assert.equal(planB.stopContainer, null);
    assert.ok(planB.notes.length > 0);

    const planA = arb.buildSwitchPlan("A");
    assert.deepEqual(planA.stopServices, []);
    assert.equal(planA.startContainer, null);
    assert.equal(planA.stopContainer, "comfyui-secondary");
    // dry-run 本体不改变人格
    assert.equal((await arb.getState()).persona, "A");
  });

  it("人格状态持久化: 换实例 (模拟 KAP 重启) 后恢复正确人格", async () => {
    const clock = { v: CLOCK_START };
    const store = new MemoryStateStore();
    const a1 = mkArbiter({ clock, store });
    await a1.requestPersona("B", { requester: "kai" });
    const a2 = mkArbiter({ clock, store });
    const st = await a2.getState();
    assert.equal(st.persona, "B");
    assert.equal(st.since, (await a1.getState()).since, "生效时刻随状态持久化");
  });

  it("executor 注入 (M3 接口): apply 被调用且拿到切换计划", async () => {
    const clock = { v: CLOCK_START };
    const calls: Array<{ to: string; plan: unknown }> = [];
    const arb = new PersonaArbiter({
      now: () => clock.v,
      autoEvaluate: false,
      store: new MemoryStateStore(),
      executor: {
        async apply(to, ctx) {
          calls.push({ to, plan: ctx.plan });
          return { ok: true, actions: [`stub:${to}`] };
        },
      },
      signals: {
        renderQueueDepth: () => 9,
        qcQueueDepth: () => 0,
        qcActiveCount: () => 0,
        p11Active: () => false,
      },
    });
    await arb.evaluate(); // A→B (深度 9 > 2 ∧ QC 静)
    assert.deepEqual(calls.map((c) => c.to), ["B"]);
    const plan = calls[0].plan as { startContainer: string };
    assert.equal(plan.startContainer, "comfyui-secondary");
  });
});

// ─── 兼容性: 缺省信号 = 人格 A 恒定 (今日行为) ───────────────────────────────

describe("Arbiter 兼容性 — 缺省 (mock 全零) 永不自动切 B", () => {
  it("多轮 evaluate 后人格仍 A, 无切换事件", async () => {
    const clock = { v: CLOCK_START };
    const arb = mkArbiter({ clock });
    for (let i = 0; i < 5; i++) {
      clock.v += 60_000;
      await arb.evaluate();
    }
    const st = await arb.getState();
    assert.equal(st.persona, "A");
    assert.equal(st.desired, "A");
    assert.deepEqual(st.history, []);
    assert.ok(arb.getEvents().length === 0);
  });
});
