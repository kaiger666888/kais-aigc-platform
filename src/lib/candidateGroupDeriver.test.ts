/**
 * src/lib/candidateGroupDeriver.test.ts — 候选组推导(通道 A/B)回归锁。
 *
 * 运行: cd /data/workspace/kais-aigc-platform && node --import tsx --test src/lib/candidateGroupDeriver.test.ts
 *
 * 纯函数直测纪律(deriveCandidateGroups 无 IO):零 db/零 fs/零网络。
 * Fix-1(2026-08-27):纯 v{N} 族(kmc canvas_sync 只入库每族被选中的单一
 * 变体,canonical 节点永远不在库)也须成组且 winnerNodeId 不设 = 盲选投票
 * 素材;混合族(canonical 在场)winnerNodeId=canonical 为现行为锁死。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveCandidateGroups, type DeriveNode } from "./candidateGroupDeriver";

const mk = (id: string, data: Record<string, unknown>): DeriveNode => ({
  id,
  type: "asset",
  data,
});

const variantNode = (id: string, filePath: string): DeriveNode =>
  mk(id, { filePath });

// ─── Fix-1:纯变体族 ───────────────────────────────────────────────────────

test("纯 v1+v2 无 canonical → 1 组、2 成员按 N 升序、无 winnerNodeId", () => {
  const r = deriveCandidateGroups([
    variantNode("n-v2", "/oss/proj/p04/char_a_v2.png"), // 故意倒序入
    variantNode("n-v1", "/oss/proj/p04/char_a_v1.png"),
  ]);
  assert.equal(r.groups.length, 1, `应成 1 组,实际 ${r.groups.length}`);
  const g = r.groups[0]!;
  assert.equal(g.id, "cand:name:proj/p04/char_a");
  assert.equal(g.groupKey, "name:proj/p04/char_a");
  assert.deepEqual(g.variantNodeIds, ["n-v1", "n-v2"], "成员须按 N 升序");
  assert.equal(g.winnerNodeId, undefined, "纯族不设 winner(盲选素材)");
  assert.deepEqual(r.skipped, []);
});

test("v1+v2+canonical 混合族 → 1 组、3 成员、winnerNodeId=canonical(现行为锁死)", () => {
  const r = deriveCandidateGroups([
    variantNode("n-v1", "/oss/proj/p04/char_b_v1.png"),
    variantNode("n-v2", "/oss/proj/p04/char_b_v2.png"),
    mk("n-canonical", { filePath: "/oss/proj/p04/char_b.png" }),
  ]);
  assert.equal(r.groups.length, 1);
  const g = r.groups[0]!;
  assert.equal(g.id, "cand:name:proj/p04/char_b");
  assert.equal(g.variantNodeIds.length, 3, "canonical + 两个变体");
  assert.ok(g.variantNodeIds.includes("n-canonical"), "canonical 须是成员");
  assert.equal(g.winnerNodeId, "n-canonical", "canonical 在场 = 默认 winner");
});

test("单独 v1(无兄弟无 canonical)→ 0 组(<2 不同 N 不成族)", () => {
  const r = deriveCandidateGroups([
    variantNode("n-v1", "/oss/proj/p04/lonely_v1.png"),
  ]);
  assert.equal(r.groups.length, 0);
  assert.ok(
    r.skipped.some((s) => s.nodeId === "n-v1" && s.reason === "single-variant-family"),
    "丢弃须可审计(skipped 记录)",
  );
});

test("同 N 重复节点(v1×2,无 canonical)不成纯族", () => {
  const r = deriveCandidateGroups([
    variantNode("n-a", "/oss/proj/p04/dup_v1.png"),
    variantNode("n-b", "/oss/proj/p04/dup_v1.png"),
  ]);
  assert.equal(r.groups.length, 0, "1 个不同 N ≠ 族");
});

test("同 base 不同 dir → 两个独立组(dir-aware 不变)", () => {
  const r = deriveCandidateGroups([
    variantNode("d1-v1", "/oss/proj/p04/turnaround/cat_v1.png"),
    variantNode("d1-v2", "/oss/proj/p04/turnaround/cat_v2.png"),
    variantNode("d2-v1", "/oss/proj/p04/fanart/cat_v1.png"),
    variantNode("d2-v2", "/oss/proj/p04/fanart/cat_v2.png"),
  ]);
  assert.equal(r.groups.length, 2);
  const keys = r.groups.map((g) => g.groupKey).sort();
  assert.deepEqual(keys, ["name:proj/p04/fanart/cat", "name:proj/p04/turnaround/cat"]);
  for (const g of r.groups) assert.equal(g.winnerNodeId, undefined);
});

test("v1+v2+v10 → 成员序 [v1,v2,v10](数值序非字典序)", () => {
  const r = deriveCandidateGroups([
    variantNode("n-v10", "/oss/proj/p09/shot_v10.png"),
    variantNode("n-v2", "/oss/proj/p09/shot_v2.png"),
    variantNode("n-v1", "/oss/proj/p09/shot_v1.png"),
  ]);
  assert.equal(r.groups.length, 1);
  assert.deepEqual(
    r.groups[0]!.variantNodeIds,
    ["n-v1", "n-v2", "n-v10"],
    "字典序会给 [v1,v10,v2],必须数值序",
  );
});

// ─── 通道 A:envelope 回归锚(纯族改造不得波及)────────────────────────────

test("通道 A envelope 节点照旧成组,selected 者 = winner(回归锚)", () => {
  const r = deriveCandidateGroups([
    mk("env-1", {
      source: "p11a_preview",
      groupKey: "shot:S01:first",
      variantId: "a",
      selected: false,
    }),
    mk("env-2", {
      source: "p11a_preview",
      groupKey: "shot:S01:first",
      variantId: "b",
      selected: true,
    }),
  ]);
  assert.equal(r.groups.length, 1);
  const g = r.groups[0]!;
  assert.equal(g.id, "cand:shot:S01:first");
  assert.deepEqual(g.variantNodeIds, ["env-1", "env-2"]);
  assert.equal(g.winnerNodeId, "env-2", "selected 信号定 winner 通道不变");
});

test("通道 A 信封节点不被命名通道重复吸收(带 filePath 也不双claim)", () => {
  const r = deriveCandidateGroups([
    mk("env-1", {
      source: "p11a0_flf",
      groupKey: "S01_first",
      shot_id: "S01",
      frame_type: "first",
      filePath: "/oss/proj/p11/S01_first_v1.png", // 与命名族 v1 同文件——双claim试探
    }),
    mk("env-2", {
      source: "p11a0_flf",
      groupKey: "S01_first",
      shot_id: "S01",
      frame_type: "first",
      variant: "2",
    }),
    variantNode("n-v1", "/oss/proj/p11/S01_first_v1.png"),
    variantNode("n-v2", "/oss/proj/p11/S01_first_v2.png"),
  ]);
  const flf = r.groups.find((g) => g.groupKey === "shot:S01:first");
  assert.ok(flf != null, "通道 A 组须在(legacy {sid}_{slot} 词表归一)");
  assert.deepEqual(flf.variantNodeIds, ["env-1", "env-2"], "信封节点不进命名族");
  const naming = r.groups.find((g) => g.groupKey === "name:proj/p11/S01_first");
  assert.ok(naming != null, "命名纯族照常成组");
  assert.deepEqual(naming!.variantNodeIds, ["n-v1", "n-v2"], "env-1 不得因 filePath 重合混入");
});

// ─── 红线锁 ────────────────────────────────────────────────────────────────

test("红线:id 超 128 记 skipped;全程不 throw;非变体节点不产出组", () => {
  const longBase = "x".repeat(140);
  const r = deriveCandidateGroups([
    variantNode("long-1", `/oss/proj/p04/${longBase}_v1.png`),
    variantNode("long-2", `/oss/proj/p04/${longBase}_v2.png`),
    mk("garbage-1", { filePath: 42 }), // 非字符串 filePath 忽略
    mk("garbage-2", {}), // 无 filePath 忽略
    mk("plain", { filePath: "/oss/proj/p04/plain.png" }), // 无 _v{N} 后缀
  ]);
  assert.equal(r.groups.length, 0, "超长 id 组不入列");
  assert.ok(
    r.skipped.some((s) => s.reason === "id-too-long" && s.nodeId === "long-1"),
    "超长 id 须记 skipped 拒绝(绝不截断造碰撞)",
  );
  // 幂等:同输入两次推导输出逐字节一致
  const r2 = deriveCandidateGroups([
    variantNode("long-1", `/oss/proj/p04/${longBase}_v1.png`),
    variantNode("long-2", `/oss/proj/p04/${longBase}_v2.png`),
    mk("garbage-1", { filePath: 42 }),
    mk("garbage-2", {}),
    mk("plain", { filePath: "/oss/proj/p04/plain.png" }),
  ]);
  assert.deepEqual(r, r2, "确定性:同输入同输出(cand: 前缀幂等的前提)");
});
