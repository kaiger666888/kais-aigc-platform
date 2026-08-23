#!/usr/bin/env tsx
/**
 * verify-59-dispatch.ts — 59-02 Task 3 spawn dispatch 手 harness(短命子进程)。
 *
 * 由 scripts/verify-phase-59.ts 逐模式 spawn:
 *   env: DISPATCH_MODE ∈ {cascade | engine-fail | no-marker | orchestrate};
 *        GOLD_TEAM_URL = 父进程 fake 引擎(completed/failed 由父进程切换);
 *        ENGINE_POLL_INTERVAL_MS=10(防御性,fake 引擎首个 GET 即终结)。
 *   cwd: 父进程指定的 mkdtemp 临时目录——getPath 以 process.cwd()/data 为基,
 *        @/utils/db IIFE 在临时目录自动建隔离空库 db2.sqlite,生产库绝不被
 *        打开(verify-phase-51 隔离模式);package.json 由父进程 staged(writeVersion
 *        从 cwd 解析)。
 *   argv: 父进程传 --tsconfig <repo>/tsconfig.json——tsx 从 cwd(临时目录)找不到
 *        repo tsconfig 时 @/ 别名不解析(实证),必须显式指定。
 *
 * 每模式完整链路:express 挂真路由(execute/orchestrate,真 validateFields 中间件)
 * + socket.io Server(io 挂 http server,app.ts 范式)→ setIo → /ws/projects
 * connection join room project:<query.projectId> → socket.io-client 连自身带
 * query {projectId} 收集广播事件 → seed fixture 图(canvasRelationalStore 原语:
 * upsertNode ×3 + upsertLink ×2 + ensureMeta)→ migrateV2toV3+getDownstreamIds
 * fixture 形状自检(不对只修 fixture,不改产品代码)→ dispatch(fetch POST)→
 * 轮询事件至 node:state success/error 或 15s 超时 → loadFullGraph 读回 staleRows
 * (同一读即 D-05 reload 保真:loadFullGraph 是 load-v2 数据源)→ stdout 末行
 * "V59_DISPATCH_JSON={单行 JSON}";自检/日志走 stderr。
 *
 * fixture(blob 从未写入——关系表是唯一数据源,orchestrate 模式 200 的行为级证明):
 *   trig-1(asset,success,data.prompt) --l1--> node-1(storyboard,idle,prompt)
 *   node-1 --l2--> down-1(asset,idle,prompt)
 * migrate 合成因果链(§14):trig-1 →[input]→ evt_node-1 →[output]→ node-1
 * →[input]→ evt_down-1 →[output]→ down-1;markStaleDownstream(['trig-1']) 传递
 * 闭包标 node-1 + down-1(D-03),triggerEventId 均为链条起点 evt_node-1。
 *
 * 49-01 教训:app-db knex 池不落共享进程——本脚本本身即 spawn 出的子进程,
 * 结尾 process.exit 强退不等 knex/better-sqlite3 句柄 drain(否则进程挂住)。
 */

import http from "node:http";
import { Server } from "socket.io";
import { io } from "socket.io-client";
import express from "express";
import type { FlowNodeV2 } from "../src/types/flowgraph-v2";
import { bootReady, db } from "../src/utils/db";
import { setIo } from "../src/utils/ws";
import {
  ensureMeta,
  upsertNode,
  upsertLink,
  loadFullGraph,
} from "../src/lib/canvasRelationalStore";
import { migrateV2toV3 } from "../packages/flowgraph-v3/ts/src/migrate";
import { getDownstreamIds } from "../packages/flowgraph-v3/ts/src/stale";
import executeRoute from "../src/routes/canvas/execute";
import orchestrateRoute from "../src/routes/canvas/orchestrate";

const MODE = process.env.DISPATCH_MODE ?? "cascade";
const PROJECT_ID = 990059;
const EPISODES_ID = 1;
const SCOPE = { projectId: PROJECT_ID, episodesId: EPISODES_ID };
// 59-fix WR-01: legacy-blob-only 模式——关系表仅 ensureMeta(空图),唯一真值在
// o_agentWorkData canvasGraph blob(59-02 前项目形态)。orchestrate 全量模式
// 应经 59-fix 兜底发现 blob 目标(total=1)而非 404。
const IS_LEGACY = MODE === "orchestrate-legacy";

interface CapturedEvent {
  event: string;
  data: any;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  // ── 1) express 真路由 + socket.io 同 server(app.ts 范式) ───────────────
  const app = express();
  app.use(express.json());
  app.use("/api/canvas/execute", executeRoute);
  app.use("/api/canvas/orchestrate", orchestrateRoute);
  const server = http.createServer(app);
  const ioServer = new Server(server, { cors: { origin: "*" } });
  setIo(ioServer);
  ioServer.of("/ws/projects").on("connection", (s) => {
    const pid = s.handshake.query.projectId as string | undefined;
    if (pid) s.join(`project:${pid}`);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;

  // ── 2) socket.io-client 连自身,收集 room 广播事件 ────────────────────────
  const events: CapturedEvent[] = [];
  const client = io(`${base}/ws/projects`, {
    query: { projectId: String(PROJECT_ID) },
    transports: ["websocket"],
  });
  for (const name of [
    "node:state", "node:updated", "node:preview", "execution:progress",
    "orchestrate:start", "orchestrate:progress", "orchestrate:done",
  ]) {
    client.on(name, (data: any) => events.push({ event: name, data }));
  }
  await new Promise<void>((r) => client.once("connect", r));

  // ── 3) seed fixture 图(bootReady 先行:@/utils/db IIFE 异步建库) ─────────
  await bootReady;
  await ensureMeta(SCOPE);
  const node = (id: string, type: FlowNodeV2["type"], phaseIndex: number, phaseName: string, data: Record<string, unknown>, state: FlowNodeV2["state"]): FlowNodeV2 => ({
    id, type, branchId: "main", phaseIndex, phaseName,
    position: { x: phaseIndex * 300, y: 0 }, size: { width: 260, height: 180 },
    data, state,
  });
  if (IS_LEGACY) {
    // WR-01 fixture:legacy-blob-only——关系表零节点零边(仅 meta),blob 单节点
    // idle asset。loadFullGraph → null → orchestrate 走 59-fix 兜底读 blob。
    await db("o_agentWorkData").insert({
      projectId: String(PROJECT_ID),
      episodesId: String(EPISODES_ID),
      key: "canvasGraph",
      data: JSON.stringify({
        meta: { version: "2", projectId: PROJECT_ID, episodesId: EPISODES_ID, createdAt: Date.now(), updatedAt: Date.now(), lastEventId: 0 },
        nodes: [node("legacy-blob-1", "asset", 1, "P04", { prompt: "legacy blob asset" }, "idle")],
        links: [],
        branches: [],
        variantGroups: [],
      }),
      createTime: Date.now(),
      updateTime: Date.now(),
    });
    console.error("[v59-dispatch] legacy fixture OK: blob 单节点 legacy-blob-1(关系表空)");
  } else {
    await upsertNode(SCOPE, node("trig-1", "asset", 0, "P04", { prompt: "v59 trigger asset" }, "success"));
    await upsertNode(SCOPE, node("node-1", "storyboard", 2, "P06", { prompt: "v59 storyboard", shotType: "wide", durationS: 2 }, "idle"));
    await upsertNode(SCOPE, node("down-1", "asset", 0, "P07", { prompt: "v59 downstream" }, "idle"));
    await upsertLink(SCOPE, { id: "l-trig-node", source: "trig-1", target: "node-1", branchId: "main", dataType: "text" });
    await upsertLink(SCOPE, { id: "l-node-down", source: "node-1", target: "down-1", branchId: "main", dataType: "text" });

    // fixture 形状自检(migrate+getDownstreamIds;不对 → exit 3,只修 fixture 不改产品)
    const seeded = await loadFullGraph(SCOPE);
    const { graph } = migrateV2toV3(seeded as any);
    const downstream = getDownstreamIds(graph, "trig-1");
    if (!(downstream.includes("node-1") && downstream.includes("down-1"))) {
      console.error(`[v59-dispatch] fixture 自检失败: downstream(trig-1)=${JSON.stringify(downstream)}`);
      process.exit(3);
    }
    console.error(`[v59-dispatch] fixture 自检 OK: downstream(trig-1)=${JSON.stringify(downstream)}; evt ids: ${graph.nodes.filter((n) => n.kind === "event").map((n) => n.id).join(",")}`);

    // 59-fix WR-03 fixture 注入(自检之后,不进 migrate 自检):一个 migrate
    // planNode 不支持的 legacy 类型节点('phase'——probe-59-real 真机发现项)。
    // 修复前 markStaleAndBroadcast 在 migrate 阶段整图 throw → 零 stale 写;
    // 修复后过滤继续,cascade 模式 node-1/down-1 照常落 stale(verify 侧行为断言)。
    await upsertNode(SCOPE, node("legacy-phase-1", "phase", 9, "P00", { label: "legacy phase 容错锚" }, "idle"));
  }

  // ── 4) dispatch(真 zod 中间件链;mock req/res 直调升级为真 HTTP——
  //       validateFields/promise 链零 stub) ─────────────────────────────────
  const isOrch = MODE === "orchestrate";
  const url = isOrch || IS_LEGACY ? `${base}/api/canvas/orchestrate` : `${base}/api/canvas/execute`;
  const body = IS_LEGACY
    ? { projectId: PROJECT_ID, episodesId: EPISODES_ID } // 全量模式——目标发现走 legacy 兜底
    : isOrch
      ? { projectId: PROJECT_ID, episodesId: EPISODES_ID, nodeIds: ["down-1"] }
      : MODE === "no-marker"
        ? { projectId: PROJECT_ID, episodesId: EPISODES_ID, nodeId: "trig-1", nodeType: "asset", prompt: "v59 probe" }
        : {
            projectId: PROJECT_ID, episodesId: EPISODES_ID,
            nodeId: "trig-1", nodeType: "asset", prompt: "v59 probe",
            regenSource: "panel-regen",
            // 59-fix CR-01 探针:seed(合法配方标量)之外混入保留键伪造——
            // _simulate CLIENT_PARAM_KEYS 白名单应静默丢弃伪造键(不 500),
            // 引擎提交体 params.nodeId/prompt 保持服务端值。
            params: {
              seed: 777,
              ref_images: ["/etc/passwd"],
              model_preference: "local",
              prompt: "forged-prompt",
              nodeId: "forged-node",
            },
          };
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const respBody = await resp.json().catch(() => null);
  const httpStatus = resp.status;
  console.error(`[v59-dispatch] mode=${MODE} httpStatus=${httpStatus} respBody=${JSON.stringify(respBody).slice(0, 200)}`);

  // ── 5) 轮询收集事件至目标节点 node:state success/error 或 15s 超时 ───────
  // legacy 模式:blob 节点不在关系表 → simulateExecution readNode null →
  // simulateOnly(5-15s);断言面在 respBody(200 + blob 目标发现),不等终态。
  const targetNodeId = IS_LEGACY ? "legacy-blob-1" : isOrch ? "down-1" : "trig-1";
  const terminal = (e: CapturedEvent) =>
    e.event === "node:state" && e.data?.nodeId === targetNodeId &&
    (e.data?.state === "success" || e.data?.state === "error");
  const deadline = Date.now() + (IS_LEGACY ? 0 : 15_000);
  while (Date.now() < deadline && !events.some(terminal)) {
    await sleep(100);
  }
  await sleep(300); // 终态后 settle(同 socket 有序,余量防 transport 缓冲)

  // ── 6) loadFullGraph 读回(staleRows;同一读 = D-05 reload 保真) ─────────
  const after = await loadFullGraph(SCOPE);
  const staleRows = (after?.nodes ?? [])
    .filter((n) => n.data?.stale != null)
    .map((n) => ({ id: n.id, stale: n.data.stale }));

  console.log("V59_DISPATCH_JSON=" + JSON.stringify({ mode: MODE, httpStatus, respBody, events, staleRows }));

  client.disconnect();
  ioServer.close();
  server.close();
  // 49-01 教训:knex/better-sqlite3 池不落——强退不等 drain。
  process.exit(0);
}

main().catch((err) => {
  console.error("verify-59-dispatch crashed:", err);
  process.exit(2);
});
