#!/usr/bin/env tsx
/**
 * verify-canvas-resync.ts — Phase 41 resumable replay 动态验证
 * （脚本层重构：arg/结果收集/汇总退出收敛至 lib/verify-harness.ts；WS 测试逻辑不变）
 *
 * 模拟 hermes-agent 重连场景，验证事件流可靠补发：
 *   1. POST /events 写入若干事件，拿 lastEventId
 *   2. 连接 WS /ws/projects + subscribe(since=N)，验证补发
 *   3. 断开 WS → 期间 POST 3 个事件 → 重连 subscribe(since=N)
 *      验证所有漏掉的事件都被 canvas:event 推送
 *   4. 验证 eventId 单调递增、不重不漏
 *
 * 前提:
 *   - 服务必须跑 master 当前代码（含 Phase 41 events API + socket subscribe）
 *   - 若服务是旧版（events 404）会明确提示重启
 *
 * 依赖:
 *   - socket.io-client（可选，未装则跳过 WS 部分仅测 REST）
 *     启用 WS 测试: npm i --no-save socket.io-client
 *
 * 用法:
 *   npx tsx scripts/verify-canvas-resync.ts
 *   npx tsx scripts/verify-canvas-resync.ts --projectId 1800 --episodesId 1 --host 127.0.0.1 --port 10588
 */
import { arg, createHarness } from "./lib/verify-harness";

const { assert, summary } = createHarness({ summaryFormat: "tally" });

// ─── args ────────────────────────────────────────────────
const HOST = arg("host", "127.0.0.1");
const PORT = arg("port", "10588");
const PROJECT_ID = Number(arg("projectId", "9999"));
const EPISODES_ID = Number(arg("episodesId", "1"));
const BASE = `http://${HOST}:${PORT}`;
const WS_URL = `ws://${HOST}:${PORT}`;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── HTTP helpers (Node 18+ global fetch) ───────────────
async function postEvents(clientId: string, events: Array<{ type: string; nodeId?: string; payload: unknown }>): Promise<any> {
  const r = await fetch(`${BASE}/api/canvas/v2/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId: PROJECT_ID,
      episodesId: EPISODES_ID,
      clientId,
      source: "verify-resync",
      events,
    }),
  });
  if (!r.ok) throw new Error(`POST /events HTTP ${r.status}: ${await r.text().catch(() => "")}`);
  return r.json();
}

async function probeService(): Promise<{ eventsOk: boolean; healthOk: boolean }> {
  let eventsOk = false;
  let healthOk = false;
  try {
    const r = await fetch(`${BASE}/api/canvas/v2/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: PROJECT_ID,
        episodesId: EPISODES_ID,
        clientId: "probe",
        events: [{ type: "node_upsert", nodeId: "probe", payload: {} }],
      }),
    });
    eventsOk = r.status !== 404;
  } catch {
    eventsOk = false;
  }
  try {
    const r = await fetch(`${BASE}/api/canvas/v2/health`);
    healthOk = r.ok;
  } catch {
    healthOk = false;
  }
  return { eventsOk, healthOk };
}

// ─── main ───────────────────────────────────────────────
async function main(): Promise<void> {
  console.log(`=== Canvas v2 resumable replay 验证 ===`);
  console.log(`Target: ${BASE}  projectId=${PROJECT_ID}  episodesId=${EPISODES_ID}\n`);

  // ─── 0. 服务版本探测 ───
  console.log("=== 0. 服务版本探测 ===");
  const probe = await probeService();
  assert(probe.eventsOk, "POST /api/canvas/v2/events 路由存在");
  assert(probe.healthOk, "GET /api/canvas/v2/health 路由存在（Phase 41 后新增）");

  if (!probe.eventsOk) {
    console.error("\n❌ 服务是旧版，缺少 Phase 41 events API。请重启：");
    console.error("   - dev 模式: yarn dev   (nodemon 会自动加载 src/)");
    console.error("   - prod 模式: yarn build && yarn start:server");
    console.error(`\n   若 service pid=… 仍跑旧版，先 kill 再启动。`);
    summary();
    return;
  }

  // ─── 1. 写入若干事件，建立 baseline ───
  console.log("\n=== 1. 写入 baseline 事件 ===");
  const runId = Date.now();
  const baselineClientId = `verify-resync-base-${runId}`;
  const baselineNodeId = `n-base-${runId}`;

  let baselineResp: any;
  try {
    baselineResp = await postEvents(baselineClientId, [
      { type: "node_upsert", nodeId: baselineNodeId, payload: { type: "script", data: { label: "baseline" } } },
    ]);
    assert(
      baselineResp.code === 200 && Array.isArray(baselineResp.data?.eventIds) && baselineResp.data.eventIds.length > 0,
      "POST /events 写入成功",
      `eventIds=${baselineResp.data?.eventIds?.join(",")}`,
    );
  } catch (e) {
    assert(false, "POST /events 写入", String(e));
    summary();
    return;
  }

  const baselineEventId: number = baselineResp.data.lastEventId;
  assert(baselineEventId != null, "响应包含 lastEventId", `lastEventId=${baselineEventId}`);

  // ─── 2. WS 连接 + subscribe(since=baseline-1) 补发 ───
  console.log("\n=== 2. WS subscribe + 增量补发 ===");
  let io: ((url: string, opts: any) => any) | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore — optional dep, may not be installed
    const mod: any = await import("socket.io-client");
    io = mod.io || mod.default || mod;
  } catch {
    console.warn("  SKIP: socket.io-client 未安装。运行 `npm i --no-save socket.io-client` 启用 WS 测试。");
    console.warn("  REST 部分结果仍然有效。\n");
    summary();
    return;
  }

  if (!io) {
    assert(false, "socket.io-client 导入成功但 io 未定义");
    summary();
    return;
  }
  const connect = io;

  const sock1 = connect(`${WS_URL}/ws/projects`, {
    query: { projectId: PROJECT_ID },
    transports: ["websocket"],
    reconnection: false,
    timeout: 5000,
  });

  try {
    await new Promise<void>((resolve, reject) => {
      sock1.on("connect", resolve);
      sock1.on("connect_error", reject);
      setTimeout(() => reject(new Error("connect timeout")), 5000);
    });
    assert(true, "WS /ws/projects 连接成功");
  } catch (e) {
    assert(false, "WS /ws/projects 连接", String(e));
    sock1.close?.();
    summary();
    return;
  }

  const replayed: any[] = [];
  sock1.on("canvas:event", (ev: any) => replayed.push(ev));

  // 用 baselineEventId - 1 作为 since，应该补发 baseline 事件
  sock1.emit("subscribe", {
    projectId: PROJECT_ID,
    episodesId: EPISODES_ID,
    since: baselineEventId - 1,
  });
  await sleep(600);

  assert(
    replayed.some((e) => e.eventId === baselineEventId && e.type === "node_upsert" && e.nodeId === baselineNodeId),
    "subscribe(since=N-1) 补发 baseline 事件",
    `共收到 ${replayed.length} 条，目标 eventId=${baselineEventId}`,
  );

  // ─── 3. 断开 → 漏事件 → 重连补发 ───
  console.log("\n=== 3. 断开 → 漏事件 → 重连补发 ===");
  sock1.close();
  replayed.length = 0;

  const missedCount = 3;
  for (let i = 1; i <= missedCount; i++) {
    await postEvents(`verify-resync-miss-${runId}-${i}`, [
      { type: "node_upsert", nodeId: `n-miss-${runId}-${i}`, payload: { type: "asset", data: { idx: i } } },
    ]);
  }
  console.log(`  断开期间写入 ${missedCount} 个事件`);

  const sock2 = connect(`${WS_URL}/ws/projects`, {
    query: { projectId: PROJECT_ID },
    transports: ["websocket"],
    reconnection: false,
    timeout: 5000,
  });

  await new Promise<void>((resolve, reject) => {
    sock2.on("connect", resolve);
    sock2.on("connect_error", reject);
    setTimeout(() => reject(new Error("reconnect timeout")), 5000);
  });

  const afterReconnect: any[] = [];
  sock2.on("canvas:event", (ev: any) => afterReconnect.push(ev));
  sock2.on("canvas:reset", (ev: any) => afterReconnect.push({ ...ev, type: "canvas:reset" }));

  // since=baselineEventId：应该补发所有 baseline 之后的事件（即 missedCount 个）
  sock2.emit("subscribe", {
    projectId: PROJECT_ID,
    episodesId: EPISODES_ID,
    since: baselineEventId,
  });
  await sleep(900);

  const missedReceived = afterReconnect.filter((e) => e.type !== "canvas:reset");
  assert(
    missedReceived.length >= missedCount,
    `重连补发漏掉的 ${missedCount} 个事件`,
    `实际收到 ${missedReceived.length} 个`,
  );

  // 验证 eventId 单调递增
  const ids = missedReceived.map((e) => e.eventId).filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  let monotonic = ids.length >= missedCount;
  for (let i = 1; i < ids.length; i++) {
    if (ids[i] !== ids[i - 1] + 1) {
      monotonic = false;
      break;
    }
  }
  assert(monotonic, "补发的 eventId 单调递增、无空洞", `ids=${JSON.stringify(ids)}`);

  sock2.close();
  summary();
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(2);
});
