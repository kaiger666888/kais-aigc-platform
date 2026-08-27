/**
 * src/lib/__tests__/selectWinnerSynthCompat.test.ts — 迭代平台 Fix-3 (FIX-1b)
 * 旧 SPA 合成组 id 过渡兼容回归锁。
 *
 * 运行: cd /data/workspace/kais-aigc-platform && node --import tsx --test src/lib/__tests__/selectWinnerSynthCompat.test.ts
 *
 * 封闭纪律(同 blindVoteLedger.test):零真实库零网络。canvasRelationalStore
 * 顶层 import @/utils/db,模块加载即对 process.cwd()/data/db2.sqlite 跑引导
 * (initDB/fixDB/seed…)——本套件 before() 先 chdir 进一次性 tmp 目录(补最小
 * package.json:writeVersion 模块加载读 cwd/package.json),把引导落点整个搬
 * 进 tmp,生产 data/db2.sqlite 零接触;输出尾部的「[isolated] db boot → …」
 * 是隔离自证(引导期打印被捕获,断言其路径落在 tmp 内)。真实查询全部走内存
 * fake trxDb(knex 形状桩 + 探查日志),after() 销毁 knex 池防句柄挂住事件循环。
 *
 * 覆盖面:
 *   ① stripSynthVariantGroupId 纯映射(命中/非前缀/缺壳/空剥壳/单层剥壳);
 *   ② 剥壳命中 → updated + canonical 回显 + 真值列写到 canonical 组行;
 *      探查序 = 原id先查 → miss → 剥壳恰重查一次;
 *   ③ 重查亦 miss → not_found(回显原 id);
 *   ④ 无前缀 id 不重查(单次探查);
 *   ⑤ canonical 直查命中不受影响(idempotent 零写,逐字节回归);
 *   ⑥ 过渡期重复投票:旧 id + 已选定同 winner → idempotent;
 *   ⑦ 旧 id 命中 multi 组 → multi_mode(回显 canonical)。
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const REPO = process.cwd();

let tmpRoot = "";
let mod: typeof import("../canvasRelationalStore");
let knexDb: { destroy: () => Promise<void> };
const capturedLogs: string[] = [];
let origLog: (typeof console)["log"] | null = null;
let origError: (typeof console)["error"] | null = null;

before(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fix3-compat-"));
  process.chdir(tmpRoot);
  fs.writeFileSync(
    path.join(tmpRoot, "package.json"),
    JSON.stringify({ name: "fix3-isolated", private: true }),
  );
  // 引导期 console 捕获:引导会打库路径 + 空库 seed 失败的巨量 embedding 噪声,
  // 全部收进 capturedLogs(仅 after 里回写一行隔离自证,保持输出可读)。
  origLog = console.log;
  origError = console.error;
  console.log = (...a: unknown[]) => { capturedLogs.push(a.map(String).join(" ")); };
  console.error = (...a: unknown[]) => { capturedLogs.push(a.map(String).join(" ")); };
  mod = await import("../canvasRelationalStore");
  const dbmod = await import("../../utils/db");
  knexDb = dbmod.db as unknown as { destroy: () => Promise<void> };
});

after(async () => {
  try { await knexDb.destroy(); } catch { /* 已销毁 */ }
  await new Promise((r) => setTimeout(r, 200)); // 让后台引导在捕获窗口内落定
  console.log = origLog!;
  console.error = origError!;
  process.chdir(REPO);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  // 隔离自证:引导打印的库路径必须落在 tmp 内(生产库零接触)
  const bootLine = capturedLogs.find((l) => l.includes("db2.sqlite"));
  console.log(`[isolated] db boot → ${(bootLine ?? "(未捕获)").trim()}`);
  assert.ok(
    bootLine != null && bootLine.includes(tmpRoot),
    `db 引导路径应落在 tmp(${tmpRoot})内,实际: ${bootLine}`,
  );
});

// ─── 内存 fake trxDb(knex 形状桩 + 探查日志) ───────────────

interface GroupRow {
  id: string;
  project_id: number;
  episodes_id: number;
  select_mode: string | null;
  winner_node_id: string | null;
  variant_node_ids: string;
}
interface NodeRow {
  id: string;
  data: string | null;
  phase_name: string | null;
  is_winner?: boolean;
}

const SCOPE = { projectId: 7, episodesId: 101 };

/** knex 调用面:可调用(table → chainable builder)+ transaction。 */
interface FakeTrxDb {
  (table: string): unknown;
  transaction: (fn: (trx: unknown) => Promise<void>) => Promise<void>;
};

function makeFakeDb(groups: GroupRow[], nodes: NodeRow[]) {
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const nodeById = new Map(nodes.map((n) => [n.id, { ...n }]));
  const probes: string[] = []; // canvas_variant_groups 探查序(按 where.id)

  function chain(table: string, where: Record<string, unknown>) {
    const b: Record<string, unknown> = {
      where: (w: Record<string, unknown>) => chain(table, { ...where, ...w }),
      whereIn: (_col: string, ids: string[]) => chain(table, { ...where, __in: ids }),
      first: async () => {
        probes.push(String(where.id));
        const g = groupById.get(String(where.id));
        return g != null &&
          g.project_id === where.project_id &&
          g.episodes_id === where.episodes_id
          ? g
          : undefined;
      },
      select: async () => {
        const ids = where.__in as string[];
        return [...nodeById.values()]
          .filter((n) => ids.includes(n.id))
          .map((n) => ({ id: n.id, data: n.data, phase_name: n.phase_name }));
      },
      update: async (patch: Record<string, unknown>) => {
        if (table === "canvas_variant_groups") {
          const g = groupById.get(String(where.id));
          if (g != null) Object.assign(g, patch);
        } else {
          const ids = (where.__in as string[] | undefined) ??
            (where.id != null ? [String(where.id)] : []);
          for (const id of ids) {
            const n = nodeById.get(id);
            if (n != null) Object.assign(n, patch);
          }
        }
        return 1;
      },
    };
    return b;
  }
  const db = ((t: string) => chain(t, {})) as FakeTrxDb;
  db.transaction = async (fn: (trx: unknown) => Promise<void>) => fn(db);
  return { db, probes, groupById, nodeById };
}

function groupRow(id: string, patch: Partial<GroupRow> = {}): GroupRow {
  return {
    id,
    project_id: SCOPE.projectId,
    episodes_id: SCOPE.episodesId,
    select_mode: "single",
    winner_node_id: null,
    variant_node_ids: JSON.stringify(["a-keyframe-101-v1", "a-keyframe-101-v2"]),
    ...patch,
  };
}

const CANON = "cand:shot:S1:first";
const LEGACY = `vg_nvar_${CANON}`;

// ─── 用例 ──────────────────────────────────────────────

test("① stripSynthVariantGroupId 纯映射", () => {
  const strip = mod.stripSynthVariantGroupId;
  assert.equal(strip("vg_nvar_cand:name:p/f/base"), "cand:name:p/f/base");
  assert.equal(strip("cand:shot:S1:first"), null); // 真值 id 无壳
  assert.equal(strip("vg_myvar"), null); // 用户手建组
  assert.equal(strip("nvar_cand:x"), null); // 缺 vg_ 壳
  assert.equal(strip("vg_nvar_"), null); // 空剥壳退化形态不重查
  assert.equal(strip("vg_nvar_vg_nvar_x"), "vg_nvar_x"); // 只剥一层
});

test("② 剥壳命中 → updated + canonical 回显 + 真值列写到 canonical 组", async () => {
  const g = groupRow(CANON);
  const { db, probes, groupById, nodeById } = makeFakeDb([g], [
    { id: "a-keyframe-101-v1", data: null, phase_name: "video" },
    { id: "a-keyframe-101-v2", data: null, phase_name: "video" },
  ]);
  const r = await mod.selectWinnerInGroup(db, SCOPE, LEGACY, "a-keyframe-101-v1");
  assert.equal(r.status, "updated");
  assert.equal(r.groupId, CANON); // 回显 canonical(DB 真值)
  assert.equal(groupById.get(CANON)!.winner_node_id, "a-keyframe-101-v1");
  assert.equal(nodeById.get("a-keyframe-101-v1")!.is_winner, true);
  assert.equal(nodeById.get("a-keyframe-101-v2")!.is_winner, false);
  // 探查序:原 id 先查 → miss → 剥壳恰重查一次
  assert.deepEqual(probes, [LEGACY, CANON]);
});

test("③ 剥壳重查亦 miss → not_found(回显原 id)", async () => {
  const { db, probes } = makeFakeDb([], []);
  const r = await mod.selectWinnerInGroup(db, SCOPE, "vg_nvar_ghost", "x");
  assert.equal(r.status, "not_found");
  assert.equal(r.groupId, "vg_nvar_ghost");
  assert.deepEqual(probes, ["vg_nvar_ghost", "ghost"]);
});

test("④ 无前缀 id 不重查:miss 单次探查即 not_found", async () => {
  const { db, probes } = makeFakeDb([], []);
  const r = await mod.selectWinnerInGroup(db, SCOPE, "vg_other", "x");
  assert.equal(r.status, "not_found");
  assert.deepEqual(probes, ["vg_other"]);
});

test("⑤ canonical 直查命中不受影响:idempotent 零写(逐字节回归)", async () => {
  const g = groupRow(CANON, { winner_node_id: "a-keyframe-101-v1" });
  const { db, probes, nodeById } = makeFakeDb([g], [
    { id: "a-keyframe-101-v1", data: null, phase_name: "video" },
  ]);
  const r = await mod.selectWinnerInGroup(db, SCOPE, CANON, "a-keyframe-101-v1");
  assert.equal(r.status, "idempotent");
  assert.equal(r.groupId, CANON);
  assert.deepEqual(probes, [CANON]); // 无重查
  assert.equal(nodeById.get("a-keyframe-101-v1")!.is_winner, undefined); // D-03 零写
});

test("⑥ 过渡期重复投票:旧 id + 已选定同 winner → idempotent", async () => {
  const g = groupRow(CANON, { winner_node_id: "a-keyframe-101-v1" });
  const { db, probes, groupById } = makeFakeDb([g], []);
  const r = await mod.selectWinnerInGroup(db, SCOPE, LEGACY, "a-keyframe-101-v1");
  assert.equal(r.status, "idempotent");
  assert.equal(r.groupId, CANON);
  assert.deepEqual(probes, [LEGACY, CANON]);
  assert.equal(groupById.get(CANON)!.winner_node_id, "a-keyframe-101-v1"); // 未动
});

test("⑦ 旧 id 命中 multi 组 → multi_mode(回显 canonical)", async () => {
  const g = groupRow(CANON, { select_mode: "multi" });
  const { db, probes } = makeFakeDb([g], []);
  const r = await mod.selectWinnerInGroup(db, SCOPE, LEGACY, "a-keyframe-101-v1");
  assert.equal(r.status, "multi_mode");
  assert.equal(r.groupId, CANON);
  assert.deepEqual(probes, [LEGACY, CANON]);
});
