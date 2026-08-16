#!/usr/bin/env tsx
/**
 * verify-save-gates.ts — 2026-08-16 审计 #8 收口验证（v1 save + PATCH merged 门）。
 *
 * 项目惯例（Pitfalls B3）：无 vitest/jest。本脚本用 supertest 不引入——
 * 直接对 express router 做离线断言不可行（save.ts 依赖 DB / ws 广播），
 * 因此这里分两层验证：
 *
 *   1. 静态契约断言（source grep，同 verify-schema-roundtrip SCHEMA-04 手法）：
 *      - v1 save.ts 带齐三件套：FlowGraphV2Schema.safeParse + validateGraphNodes
 *        双校验门 + 500 err.message 口径（B-6 对齐）。
 *      - nodes.ts PATCH 的 merged 结果过 validateNodeData（B-5 残留），
 *        不合法 → 400 拒绝且不落库。
 *   2. 纯函数行为断言：validateNodeData / validateGraphNodes 对 400/200
 *      两侧的代表 fixture 给出正确判定（非法 audio node → 错误串；
 *      zone 结构节点 → null）——即两端点 400/200 分支的判定核心。
 *
 * 端到端 400/200 已在生产 curl 复核（见 commit message）；离线脚本钉住
 * 源码契约防回归即可，不重复起服务器。
 *
 * Run: npx tsx scripts/canvas/verify-save-gates.ts
 * Exit: 0 全过 / 1 有失败 / 2 未捕获异常
 */

import fs from "node:fs";
import path from "node:path";
import { validateNodeData, validateGraphNodes } from "../../src/lib/canvasAssetSchema";
import { createHarness } from "./lib/verify-harness";

const { assert, section, summary } = createHarness();

const REPO_ROOT = path.resolve(__dirname, "..", "..");
function read(rel: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
}

function main(): void {
  console.log("=== 2026-08-16 审计 #8 — verify-save-gates.ts ===");

  // ─── v1 /api/canvas/save 收口 ────────────────────────────────
  section("v1 save.ts 双校验门（B-4 已落地 + B-6 500 口径对齐）");
  const saveSrc = read("src/routes/canvas/save.ts");
  assert(
    saveSrc.includes("FlowGraphV2Schema.safeParse(v2Graph)"),
    "v1 save: FlowGraphV2Schema.safeParse 归一化后的 v2Graph",
  );
  assert(
    saveSrc.includes("validateGraphNodes(validGraph.nodes"),
    "v1 save: validateGraphNodes 结构化参数门（内部逐 node 调 validateNodeData）",
  );
  assert(
    /return res\.status\(400\)/.test(saveSrc),
    "v1 save: 校验失败返回 400",
  );
  assert(
    /error\(`保存画布失败: \$\{message\}`\)/.test(saveSrc),
    "v1 save: 500 带 err.message（对齐 save-v2 B-6 口径）",
  );

  // ─── PATCH merged 门 ────────────────────────────────────────
  section("nodes.ts PATCH merged 过 validateNodeData（B-5 残留）");
  const nodesSrc = read("src/routes/canvas/v2/nodes.ts");
  assert(
    nodesSrc.includes("updates: nodeInputSchema.partial()"),
    "PATCH: updates 仍为 nodeInputSchema.partial()（B-5 主修复未回退）",
  );
  const mergedIdx = nodesSrc.indexOf("const merged = { ...node, ...updates }");
  assert(mergedIdx > 0, "PATCH: merged 合并点存在");
  const afterMerged = nodesSrc.slice(mergedIdx, mergedIdx + 1200);
  assert(
    afterMerged.includes("validateNodeData(merged.type, merged.data"),
    "PATCH: merged 后跑 validateNodeData",
    "merged 必须在校验通过后才 upsertNode 落库",
  );
  const upsertIdx = afterMerged.indexOf("await upsertNode");
  const validateIdx = afterMerged.indexOf("validateNodeData(merged.type");
  assert(
    upsertIdx > validateIdx,
    "PATCH: upsertNode 在 validateNodeData 之后（不合法不落库）",
  );
  assert(
    afterMerged.includes("return res.status(400)"),
    "PATCH: merged 校验失败返回 400",
  );

  // ─── 判定核心行为（两端点 400/200 分支的共享核心） ────────────
  section("validateNodeData / validateGraphNodes 行为断言");
  const badAudio = validateNodeData("audio", { label: "x" });
  assert(
    typeof badAudio === "string" && badAudio.includes("filePath"),
    "非法 audio node（缺 filePath/shot_id/engine/duration_sec）→ 错误串",
    badAudio ?? "",
  );
  const zoneOk = validateNodeData("zone", { label: "z" });
  assert(zoneOk === null, "zone 结构节点 → null（200 路径）");
  const graphErrs = validateGraphNodes([
    { type: "zone", id: "z1", data: { label: "z" } },
    { type: "audio", id: "a1", data: { label: "x" } },
  ]);
  assert(
    graphErrs.length === 1 && graphErrs[0].nodeId === "a1",
    "validateGraphNodes 只报非法 node、带 nodeId 明细",
    JSON.stringify(graphErrs),
  );
  // PATCH merged 门的真实形态：存量 audio data + 合法 partial updates
  // （例如只改 position）后仍缺必填字段 → 必须拒。
  const mergedBad = validateNodeData("audio", {
    label: "存量行", position: { x: 1, y: 1 },
  });
  assert(
    typeof mergedBad === "string",
    "merged 形态（存量 audio data + partial updates）不合法 → 错误串",
    "这正是 B-5 残留要拦的死循环脏数据形态",
  );

  summary();
}

try {
  main();
} catch (err) {
  console.error("uncaught:", err);
  process.exit(2);
}
