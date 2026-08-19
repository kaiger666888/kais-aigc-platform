/**
 * gpuVramManager 单测 — 对应 docs/gpu-unified-scheduling-plan.md Phase 1 验收 A1-A4
 * （A5 是 GpuScheduler 联动, 不在本文件范围）。
 *
 * 运行方式（仓库无 test script, 直接用 node 内置 runner + tsx）:
 *   cd /data/workspace/kais-aigc-platform && node --import tsx --test src/lib/__tests__/gpuVramManager.test.ts
 *
 * 隔离策略:
 *   - gpuLocks / waitingByEngine / eventRing 是模块级单例, node:test 同文件串行执行。
 *     每个用例使用独立 gpuIndex (201-209) + 独立 engine 名, 互不踩锁。
 *   - 所有排队调用都传 { skipVram: true }, 不触碰 nvidia-smi / ComfyUI。
 *   - 挂起型 fn 的 promise 一律在测试内手动 resolve 并 await, 保证无残留 waiter/holder。
 *   - 断言 rejects 的 promise 在创建后立即挂 assert.rejects 处理器（避免 unhandledRejection）。
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  withGpuQueue,
  withGpuQueueTimed,
  acquireEngineOccupancy,
  releaseEngineOccupancy,
  forceReleaseOccupancy,
  purgeWaiters,
  getGpuQueueStatus,
  getOccupancyWatches,
  QueueTimeoutError,
  QueueAbortedError,
  QueuePurgedError,
} from "../gpuVramManager";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** 轮询等待谓词为真, 超时抛错（防挂起, 比固定 sleep 更稳） */
async function waitFor(what: string, pred: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`waitFor timeout (${timeoutMs}ms): ${what}`);
    }
    await sleep(5);
  }
}

/** 指定 GPU 上的排队 waiter 明细 */
function waitersOn(gpuIndex: number) {
  return getGpuQueueStatus().waiters.filter((w) => w.gpuIndex === gpuIndex);
}

describe("gpuVramManager — GPU 统一调度三期 (A1-A4 + 管理原语)", () => {
  it(
    "A4 兼容: withGpuQueue 不传新 opts 时基本 acquire/release 正常, 两个调用串行",
    { timeout: 5000 },
    async () => {
      const IDX = 201;
      const order: string[] = [];
      let releaseFirst!: () => void;
      const gate = new Promise<void>((r) => (releaseFirst = r));

      const p1 = withGpuQueue(
        "t_a4_a",
        async () => {
          order.push("a:start");
          await gate;
          order.push("a:end");
          return "a";
        },
        { skipVram: true, gpuIndex: IDX },
      );
      await waitFor("holder t_a4_a", () => getGpuQueueStatus().holders[IDX]?.engine === "t_a4_a");
      assert.equal(getGpuQueueStatus().holders[IDX]?.occupancy, false, "普通作业 holder 非 occupancy");

      // 第二个调用进入排队, 在第一个 release 前不得执行 fn
      const p2 = withGpuQueue(
        "t_a4_b",
        async () => {
          order.push("b:start");
          return "b";
        },
        { skipVram: true, gpuIndex: IDX },
      );
      await waitFor("t_a4_b enqueued", () => waitersOn(IDX).length === 1);
      await sleep(80);
      assert.deepEqual(order, ["a:start"], "第二个调用在第一个 release 前不得开始");

      releaseFirst();
      assert.equal(await p1, "a");
      assert.equal(await p2, "b");
      assert.deepEqual(order, ["a:start", "a:end", "b:start"], "严格串行: b 等 a release 后才跑");
      assert.equal(getGpuQueueStatus().holders[IDX], null, "结束后锁空闲");
      assert.equal(waitersOn(IDX).length, 0);
    },
  );

  it(
    "A2 锁等待超时: lockWaitTimeoutMs 超时 → QueueTimeoutError(kind=queue_timeout), waitingByEngine 无残留",
    { timeout: 5000 },
    async () => {
      const IDX = 202;
      let releaseFirst!: () => void;
      const gate = new Promise<void>((r) => (releaseFirst = r));
      const p1 = withGpuQueue("t_a2_first", () => gate, { skipVram: true, gpuIndex: IDX });
      await waitFor("holder t_a2_first", () => getGpuQueueStatus().holders[IDX]?.engine === "t_a2_first");

      const t0 = Date.now();
      const p2 = withGpuQueueTimed("t_a2_second", async () => "never", {
        skipVram: true,
        gpuIndex: IDX,
        lockWaitTimeoutMs: 50,
      });
      await assert.rejects(p2, (err: unknown) => {
        assert.ok(err instanceof QueueTimeoutError, `expected QueueTimeoutError, got: ${err}`);
        assert.equal(err.kind, "queue_timeout");
        assert.equal(err.engine, "t_a2_second");
        assert.equal(err.gpuIndex, IDX);
        assert.ok(err.waitedMs >= 45, `waitedMs should be ~50ms, got ${err.waitedMs}`);
        assert.ok(Date.now() - t0 < 2000, "超时应及时触发, 不是靠外层兜底");
        return true;
      });

      const st = getGpuQueueStatus();
      assert.equal(st.waitingByEngine["t_a2_second"] ?? 0, 0, "waitingByEngine 无残留计数");
      assert.equal(waitersOn(IDX).length, 0, "waiter 已从队列摘除");
      assert.ok(
        st.recentEvents.some((e) => e.event === "timeout" && e.engine === "t_a2_second"),
        "事件环应有 timeout 留痕",
      );

      // resolve 第一个 → 锁释放（p2 已被摘除, 不应有幽灵 grant）
      releaseFirst();
      await p1;
      await waitFor("lock idle", () => getGpuQueueStatus().holders[IDX] === null);
      assert.equal(getGpuQueueStatus().holders[IDX], null);
    },
  );

  it(
    "A3 abort 取消: 排队中 AbortSignal.abort() → QueueAbortedError, waiters 清空, 事件留痕",
    { timeout: 5000 },
    async () => {
      const IDX = 203;
      let releaseFirst!: () => void;
      const gate = new Promise<void>((r) => (releaseFirst = r));
      const p1 = withGpuQueue("t_a3_first", () => gate, { skipVram: true, gpuIndex: IDX });
      await waitFor("holder t_a3_first", () => getGpuQueueStatus().holders[IDX]?.engine === "t_a3_first");

      const controller = new AbortController();
      const p2 = withGpuQueue("t_a3_second", async () => "never", {
        skipVram: true,
        gpuIndex: IDX,
        signal: controller.signal,
      });
      await waitFor("t_a3_second enqueued", () => waitersOn(IDX).some((w) => w.engine === "t_a3_second"));

      setTimeout(() => controller.abort(), 30);
      await assert.rejects(p2, (err: unknown) => {
        assert.ok(err instanceof QueueAbortedError, `expected QueueAbortedError, got: ${err}`);
        assert.equal(err.kind, "queue_aborted");
        assert.equal(err.engine, "t_a3_second");
        return true;
      });

      const st = getGpuQueueStatus();
      assert.equal(waitersOn(IDX).length, 0, "waiters 为空（waiter 已摘除）");
      assert.equal(st.waitingByEngine["t_a3_second"] ?? 0, 0);
      assert.ok(
        st.recentEvents.some((e) => e.event === "aborted" && e.engine === "t_a3_second"),
        "事件环应有 aborted 留痕",
      );

      releaseFirst();
      await p1;
      await waitFor("lock idle", () => getGpuQueueStatus().holders[IDX] === null);
    },
  );

  it(
    "A1 看门狗: occupancy 转交后 healthUrl 连续探测失败 → 自动 watchdog_release, holder 清空",
    { timeout: 5000 },
    async () => {
      const IDX = 204;
      // 端口 9 (discard) 本机无监听 → 连接拒绝, probeHealth 立即 false
      const p = withGpuQueue(
        "t_a1_outer",
        async () => {
          await acquireEngineOccupancy("t_watch", IDX, {
            healthUrl: "http://127.0.0.1:9/health",
            watchdogIntervalMs: 20,
            watchdogFailThreshold: 2,
          });
          return "done";
        },
        { skipVram: true, gpuIndex: IDX },
      );
      assert.equal(await p, "done", "外层 withGpuQueue 正常返回");

      // 外层 fn 返回后: release 是 no-op, holder 已转交给服务级占用
      const st1 = getGpuQueueStatus();
      assert.equal(st1.holders[IDX]?.engine, "t_watch", "holder 仍是 t_watch (occupancy 转交)");
      assert.equal(st1.holders[IDX]?.occupancy, true);
      assert.ok(
        getOccupancyWatches().some((w) => w.engine === "t_watch" && w.gpuIndex === IDX),
        "看门狗已注册",
      );

      // 等看门狗自愈: interval 20ms × threshold 2 ≈ 40-60ms; 轮询上限 2s 防御性兜底
      const start = Date.now();
      await waitFor(
        "watchdog auto-release",
        () => {
          const h = getGpuQueueStatus().holders[IDX];
          return h === null || h.engine !== "t_watch";
        },
        2000,
      );
      const elapsed = Date.now() - start;
      assert.ok(elapsed < 500, `看门狗应在 ~150ms 内释放, 实际 ${elapsed}ms`);

      const st2 = getGpuQueueStatus();
      assert.ok(
        st2.recentEvents.some((e) => e.event === "watchdog_release" && e.engine === "t_watch"),
        "事件环应出现 watchdog_release",
      );
      assert.ok(
        !getOccupancyWatches().some((w) => w.engine === "t_watch" && w.gpuIndex === IDX),
        "释放后看门狗注销, 无残留 interval",
      );
      assert.equal(waitersOn(IDX).length, 0);
    },
  );

  it(
    "handoff no-op: fn 内 acquireEngineOccupancy 后外层 release 不生效, 显式 releaseEngineOccupancy 才释放",
    { timeout: 5000 },
    async () => {
      const IDX = 205;
      const p = withGpuQueue(
        "t_ho_outer",
        async () => {
          await acquireEngineOccupancy("t_ho_occ", IDX);
          return "ok";
        },
        { skipVram: true, gpuIndex: IDX },
      );
      assert.equal(await p, "ok");

      let st = getGpuQueueStatus();
      assert.equal(st.holders[IDX]?.engine, "t_ho_occ", "外层 release 是 no-op — 锁仍在占用手中");
      assert.equal(st.holders[IDX]?.occupancy, true);

      releaseEngineOccupancy("t_ho_occ", IDX);
      st = getGpuQueueStatus();
      assert.equal(st.holders[IDX], null, "显式 releaseEngineOccupancy 后锁空闲");
      assert.equal(waitersOn(IDX).length, 0);
    },
  );

  it(
    "force-release 语义: 普通作业 holder 拒绝 (in-flight), occupancy holder 放行",
    { timeout: 5000 },
    async () => {
      // a) 挂起中的普通作业 holder — 不可强放
      const IDX = 206;
      let releaseJob!: () => void;
      const gate = new Promise<void>((r) => (releaseJob = r));
      const p = withGpuQueue("t_fr_job", () => gate, { skipVram: true, gpuIndex: IDX });
      await waitFor("holder t_fr_job", () => getGpuQueueStatus().holders[IDX]?.engine === "t_fr_job");

      const r1 = forceReleaseOccupancy(undefined, IDX);
      assert.equal(r1.released, false, "in-flight 作业不可 force release");
      assert.match(r1.reason ?? "", /in-flight/, "reason 应提示 in-flight");
      assert.equal(getGpuQueueStatus().holders[IDX]?.engine, "t_fr_job", "强放被拒后 holder 不变");

      releaseJob();
      await p;
      await waitFor("lock idle after job", () => getGpuQueueStatus().holders[IDX] === null);

      // b) 服务级占用 holder — 可强放
      const IDX2 = 207;
      await acquireEngineOccupancy("t_fr_occ", IDX2); // 形态 a: 锁空闲, 直接持有
      assert.equal(getGpuQueueStatus().holders[IDX2]?.engine, "t_fr_occ");
      const r2 = forceReleaseOccupancy("t_fr_occ", IDX2);
      assert.equal(r2.released, true, "occupancy holder 可 force release");
      assert.equal(r2.engine, "t_fr_occ");
      assert.equal(getGpuQueueStatus().holders[IDX2], null, "强放后锁空闲");
      assert.ok(
        getGpuQueueStatus().recentEvents.some((e) => e.event === "admin_release" && e.engine === "t_fr_occ"),
        "事件环应留 admin_release 痕",
      );
    },
  );

  it(
    "purge: purgeWaiters 摘除全部排队 waiter → QueuePurgedError, 返回 { purged: 2 }",
    { timeout: 5000 },
    async () => {
      const IDX = 208;
      let releaseHolder!: () => void;
      const gate = new Promise<void>((r) => (releaseHolder = r));
      const p0 = withGpuQueue("t_pu_hold", () => gate, { skipVram: true, gpuIndex: IDX });
      await waitFor("holder t_pu_hold", () => getGpuQueueStatus().holders[IDX]?.engine === "t_pu_hold");

      const p1 = withGpuQueue("t_pu_w1", async () => "w1", { skipVram: true, gpuIndex: IDX });
      const p2 = withGpuQueue("t_pu_w2", async () => "w2", { skipVram: true, gpuIndex: IDX });
      // 立即挂 rejection 处理器, 防 purge 同步 reject 造成 unhandledRejection
      const r1 = assert.rejects(p1, (err: unknown) => {
        assert.ok(err instanceof QueuePurgedError, `expected QueuePurgedError, got: ${err}`);
        assert.equal(err.kind, "queue_purged");
        assert.equal(err.engine, "t_pu_w1");
        return true;
      });
      const r2 = assert.rejects(p2, (err: unknown) => {
        assert.ok(err instanceof QueuePurgedError, `expected QueuePurgedError, got: ${err}`);
        assert.equal(err.kind, "queue_purged");
        assert.equal(err.engine, "t_pu_w2");
        return true;
      });
      await waitFor("2 waiters enqueued", () => waitersOn(IDX).length === 2);

      const res = purgeWaiters(undefined, IDX);
      assert.deepEqual(res, { purged: 2 });
      assert.equal(waitersOn(IDX).length, 0, "purge 后 waiters 清空");
      assert.ok(
        getGpuQueueStatus().recentEvents.some((e) => e.event === "purged" && e.gpuIndex === IDX),
        "事件环应留 purged 痕",
      );
      await r1;
      await r2;

      releaseHolder();
      await p0;
      await waitFor("lock idle", () => getGpuQueueStatus().holders[IDX] === null);
    },
  );

  it(
    "nested pass-through: fn 内同 GPU 嵌套 withGpuQueue 直接放行, 不死锁",
    { timeout: 5000 },
    async () => {
      const IDX = 209;
      const seen: string[] = [];
      const res = await withGpuQueue(
        "t_nest_outer",
        async () => {
          seen.push("outer");
          const inner = await withGpuQueue(
            "t_nest_inner",
            async () => {
              seen.push("inner");
              return "inner-result";
            },
            { skipVram: true, gpuIndex: IDX },
          );
          return inner;
        },
        { skipVram: true, gpuIndex: IDX },
      );
      assert.equal(res, "inner-result", "嵌套调用能完整返回 (无死锁)");
      assert.deepEqual(seen, ["outer", "inner"]);
      assert.equal(getGpuQueueStatus().holders[IDX], null, "外层 release 后锁空闲");
      assert.equal(waitersOn(IDX).length, 0, "内层不应入队");
      assert.ok(
        getGpuQueueStatus().recentEvents.some(
          (e) => e.event === "nested_pass_through" && e.engine === "t_nest_inner" && e.gpuIndex === IDX,
        ),
        "事件环应留 nested_pass_through 痕",
      );
    },
  );
});
