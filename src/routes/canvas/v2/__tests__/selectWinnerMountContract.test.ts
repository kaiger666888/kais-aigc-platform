/**
 * src/routes/canvas/v2/__tests__/selectWinnerMountContract.test.ts —
 * 迭代平台 Fix-4: select-winner 挂载契约回归锁(防复发)。
 *
 * 运行: cd /data/workspace/kais-aigc-platform && node --import tsx --test src/routes/canvas/v2/__tests__/selectWinnerMountContract.test.ts
 *
 * 背景(08-25 实锤): 路由生成器按文件名派生挂载,把 select-winner 错挂成
 * /api/canvas/v2/select-winner;handler 内部路径是 /:groupId/select-winner,
 * 叠成双重路径 → 前端 canvasApi.ts 契约 POST /api/canvas/v2/variant-groups/
 * :groupId/select-winner 在 HTTP 层全 404 零写入(handler 单测全绿但没过挂载层)。
 * 修复 = core.ts ROUTE_OVERRIDES "/canvas/v2/select-winner" → "/canvas/v2/variant-groups"
 * (regen-proof)+ 重生成 router.ts。
 *
 * 封闭纪律: 零真实路由模块 import(select-winner.ts 顶层拉 @/utils/db 即引导
 * 生产库),零生产库零网络。本套件做**静态挂载表解析 + 真 Express 匹配器回放**:
 *   - 从 src/router.ts 原文解析(import routeN ↔ 文件)+(app.use(mount, routeN))
 *     挂载表,即生成器(含 ROUTE_OVERRIDES)的真实产物;
 *   - 从 select-winner.ts 原文抽 router.post("…") handler 路径;
 *   - 把挂载 × handler 拼接装进真 Express 5 app(只挂 marker 中间件),
 *     node:http 起临时端口打真实请求,断言前端契约 URL 命中且全表唯一,
 *     08-25 病灶 URL(/api/canvas/v2/select-winner/...)必须 404。
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import type { Express } from "express";

const REPO = process.cwd();
const ROUTER_TS = path.join(REPO, "src/router.ts");
const HANDLER_TS = path.join(REPO, "src/routes/canvas/v2/select-winner.ts");
const CORE_TS = path.join(REPO, "src/core.ts");
const FRONTEND_API = path.join(
  REPO,
  "packages/infinite-canvas/src/services/canvasApi.ts",
);

/** 前端契约(infinitely-canvas canvasApi.ts)与后端拼接目标——核心断言值。 */
const CONTRACT_PATH = "/canvas/v2/variant-groups/:groupId/select-winner";
const CONTRACT_URL = "/api" + CONTRACT_PATH;

let routerSrc = "";
let handlerSrc = "";

before(() => {
  routerSrc = fs.readFileSync(ROUTER_TS, "utf8");
  handlerSrc = fs.readFileSync(HANDLER_TS, "utf8");
});

// ── 静态解析 ─────────────────────────────────────────────────────

type Mount = { varName: string; file: string; mount: string };

function parseMountTable(src: string): Mount[] {
  const varToFile = new Map<string, string>();
  for (const m of src.matchAll(/^import\s+(route\d+)\s+from\s+"(\.\/[^"]+)"/gm)) {
    varToFile.set(m[1], m[2].replace(/^\.\//, "src/") + ".ts");
  }
  const mounts: Mount[] = [];
  for (const m of src.matchAll(/app\.use\("([^"]+)",\s*(route\d+)\)/g)) {
    const file = varToFile.get(m[2]);
    if (file == null) continue;
    mounts.push({ varName: m[2], file, mount: m[1] });
  }
  return mounts;
}

function parseHandlerPaths(src: string): string[] {
  return [...src.matchAll(/\brouter\s*\.\s*post\s*\(\s*(['"`])((?:\\.|(?!\1).)*)\1/gs)].map(
    (m) => m[2],
  );
}

// ── ① 挂载表静态断言 ─────────────────────────────────────────────

test("① router.ts 把 select-winner.ts 挂在 /api/canvas/v2/variant-groups", () => {
  const mounts = parseMountTable(routerSrc);
  const hit = mounts.filter((m) => m.file === "src/routes/canvas/v2/select-winner.ts");
  assert.equal(hit.length, 1, "select-winner.ts 应恰好挂载一次");
  assert.equal(
    hit[0].mount,
    "/api/canvas/v2/variant-groups",
    "挂载必须与前端 canvasApi.ts 契约前缀一致(08-25 病灶: /api/canvas/v2/select-winner)",
  );
});

test("② 病灶挂载 /api/canvas/v2/select-winner 不得复活", () => {
  const mounts = parseMountTable(routerSrc);
  const diseased = mounts.filter((m) => m.mount === "/api/canvas/v2/select-winner");
  assert.equal(diseased.length, 0, "双重路径挂载(文件名派生病灶)不得存在");
});

test("③ core.ts ROUTE_OVERRIDES 保留重映射条目(regen-proof 前提)", () => {
  const coreSrc = fs.readFileSync(CORE_TS, "utf8");
  assert.match(
    coreSrc,
    /"\/canvas\/v2\/select-winner"\s*:\s*"\/canvas\/v2\/variant-groups"/,
    "删掉此条再重跑生成器,挂载会回退成 08-25 病灶",
  );
});

test("④ 前端 canvasApi.ts 契约路径未被漂移", () => {
  const feSrc = fs.readFileSync(FRONTEND_API, "utf8");
  assert.match(
    feSrc,
    /\/canvas\/v2\/variant-groups\/\$\{[^}]+\}\/select-winner/,
    "前端 selectWinner 调用路径必须仍是 /canvas/v2/variant-groups/:groupId/select-winner 形",
  );
});

// ── ② 真 Express 匹配器回放 ──────────────────────────────────────

type Replay = { app: Express; hits: Set<string> };

/**
 * 把「挂载表 × select-winner handler 路径」重放进真 Express 5:
 * 每个挂载 app.use(mount, sub),sub 内按 handler 路径注册 marker。
 * marker 只记 path 不碰 db——被测对象是**路由链本身**,不是 handler 逻辑。
 */
async function buildReplayApp(): Promise<Replay> {
  const express = (await import("express")).default;
  const mounts = parseMountTable(routerSrc);
  const handlerPaths = parseHandlerPaths(handlerSrc);
  assert.equal(handlerPaths.length, 1, "select-winner.ts 应只定义一个 POST 路由");

  const hits = new Set<string>();
  const app = express();
  app.use(express.json());

  for (const { file, mount } of mounts) {
    if (file !== "src/routes/canvas/v2/select-winner.ts") {
      // 其余挂载全部落空 marker(记 mount 供唯一性裁决)
      app.use(mount, (_req, _res, next) => {
        hits.add(mount);
        next();
      });
      continue;
    }
    const sub = express();
    for (const hp of handlerPaths) {
      sub.post(hp, (_req, res) => {
        hits.add(`${mount}${hp === "/" ? "" : hp}`);
        res.status(200).json({ ok: true });
      });
    }
    app.use(mount, sub);
  }
  return { app, hits };
}

/** node:http 临时端口起服务,返回请求函数与关闭钩子。 */
async function listen(app: Express) {
  const server = http.createServer(app as never);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  const base = `http://127.0.0.1:${addr.port}`;
  return {
    post: async (url: string, body: unknown) =>
      fetch(base + url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

test("⑤ 契约 URL 打真 Express:命中且命中点 = 拼接结果(核心断言)", async () => {
  const { app, hits } = await buildReplayApp();
  const { post, close } = await listen(app);
  try {
    const res = await post(CONTRACT_URL.replace(":groupId", "vg_abc123"), {
      projectId: 1,
      episodesId: 1,
      winnerNodeId: "n_1",
    });
    assert.equal(res.status, 200, "挂载×handler 链应让契约 URL 通到 handler");
    assert.deepEqual(
      [...hits],
      ["/api/canvas/v2/variant-groups/:groupId/select-winner"],
      "命中点必须是 mount+handler 的原样拼接",
    );
    // 核心断言(剥掉 /api 前缀后与前端契约逐字节一致)
    assert.equal(
      [...hits][0].replace(/^\/api/, ""),
      CONTRACT_PATH,
    );
  } finally {
    await close();
  }
});

test("⑥ 契约 URL 全表唯一(无第二个挂载截胡)", async () => {
  const { app, hits } = await buildReplayApp();
  const { post, close } = await listen(app);
  try {
    const res = await post(CONTRACT_URL.replace(":groupId", "vg_xyz"), {
      projectId: 1,
      episodesId: 1,
      winnerNodeId: "n_1",
    });
    assert.equal(res.status, 200);
    assert.equal(hits.size, 1, `应只命中一条路由链,实际: ${[...hits].join(", ")}`);
  } finally {
    await close();
  }
});

test("⑦ 08-25 病灶 URL 打真 Express 必须 404", async () => {
  const { app, hits } = await buildReplayApp();
  const { post, close } = await listen(app);
  try {
    const res = await post("/api/canvas/v2/select-winner/vg_abc123/select-winner", {
      projectId: 1,
      episodesId: 1,
      winnerNodeId: "n_1",
    });
    assert.equal(res.status, 404, "双重路径(挂载错位叠加 handler 路径)必须不通");
    assert.equal(hits.size, 0);
  } finally {
    await close();
  }
});

after(() => {
  void routerSrc;
  void handlerSrc;
});
