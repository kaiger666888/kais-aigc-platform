#!/usr/bin/env tsx
/**
 * verify-phase-49-linkage.ts — Phase 49 wave-2 behavioral gate (Plan 49-03,
 * SELECT-03: 资产中心 ↔ 画布联动, registry→canvas 半向 / D-06).
 *
 * This script imports the REAL modules from src (never re-implemented
 * copies) and asserts, on a temp :memory: sqlite database:
 *
 *   (a) an asset whose a-oasset- node sits in a single group → the group's
 *       winner_node_id moves to that node, old winner is_winner=false,
 *       new winner is_winner=true
 *   (b) re-selecting a sibling asset migrates the winner again
 *   (c) a node with variant_group_id NULL → no throw, zero DB writes
 *       (THE normal path — sync-assets nodes carry no group until the user
 *       groups them in the UI)
 *   (d) an asset with no canvas node at all → no throw, zero DB writes
 *   (e) a multi-mode group → no throw, zero DB writes (info skip)
 *   (f) json_extract fallback: node id NOT a-oasset- shaped but
 *       data.oAssetId matches → linkage still succeeds
 *   (xp) cross-project guard: the lookup is scoped to the asset's
 *       projectId — a same-id node under another project is invisible
 *   (err) any internal failure is swallowed (never throws outward)
 *   (g) route source-shape: the registry PATCH hook fires only on
 *       isPrimaryView === true, after the o_assets update, wrapped in
 *       void + .catch (T-49-11), response shape unchanged
 *
 * Isolation guard (mirrors scripts/verify-phase-49.ts): the module under
 * test transitively imports the app db boot (src/utils/db), whose
 * import-time IIFE resolves its sqlite file from process.cwd()/data. We
 * chdir into a throwaway temp directory BEFORE the dynamic import so the
 * boot writes an isolated temp file — the production sqlite database is
 * never opened. All behavior runs against the local :memory: knex handle.
 *
 * Run: npm run verify:phase-49-linkage   (or: npx tsx scripts/verify-phase-49-linkage.ts)
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import knex from "knex";

interface TestResult { name: string; pass: boolean; detail?: string; }
const results: TestResult[] = [];
function assert(cond: boolean, name: string, detail?: string): void {
  results.push({ name, pass: cond, detail });
  console.log(`  ${cond ? "PASS" : "FAIL"}: ${name}${detail ? " — " + detail : ""}`);
}

const REPO_ROOT = path.resolve(__dirname, "..");
function read(rel: string): string {
  const p = path.join(REPO_ROOT, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
}

// ── Isolation chdir (see header) — MUST precede the dynamic imports ────────
const ISOLATION_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "verify-phase-49-linkage-"));
// src/utils/writeVersion.ts parses package.json from process.cwd() at import
// time — stage a copy so the chdir stays safe.
fs.copyFileSync(path.join(REPO_ROOT, "package.json"), path.join(ISOLATION_DIR, "package.json"));
process.chdir(ISOLATION_DIR);

async function main(): Promise<void> {
  console.log("=== Phase 49 — verify-phase-49-linkage.ts (SELECT-03 registry→canvas linkage) ===\n");

  // Import-order guard: mirror the app's module-graph root (@/utils barrel)
  // BEFORE anything that transitively imports @/utils/db — see the circular
  // db.ts ↔ barrel ↔ fixDB evaluation-order note in scripts/verify-phase-49.ts.
  const utilsBarrel: any = await import("../src/utils");

  // ── Export gate (TDD RED pivot: everything below needs these exports) ────
  let linkage: any = null;
  let importErr: string | null = null;
  try {
    linkage = await import("../src/lib/canvasAssetLinkage");
  } catch (e: any) {
    importErr = String(e?.message ?? e);
  }
  const hasFind = !!linkage && typeof linkage.findCanvasNodeForAsset === "function";
  const hasFindAll = !!linkage && typeof linkage.findCanvasNodesForAsset === "function";
  const hasApply = !!linkage && typeof linkage.applyRegistrySelectionToCanvas === "function";
  assert(hasFind, "SELECT-03: canvasAssetLinkage exports findCanvasNodeForAsset", importErr ?? undefined);
  assert(hasFindAll, "WR-04: canvasAssetLinkage exports findCanvasNodesForAsset (all-episodes plural lookup)", importErr ?? undefined);
  assert(hasApply, "SELECT-03: canvasAssetLinkage exports applyRegistrySelectionToCanvas", importErr ?? undefined);

  // ── Lib source-shape assertions (threat-model mitigations in the source) ─
  const libSrc = read("src/lib/canvasAssetLinkage.ts");
  // Code-only view for the assertions below — the header comment is REQUIRED
  // to document the loop-prevention design (naming @/utils and the registry
  // route), so prose mentions must not trip code-shape checks.
  const libCode = libSrc
    .replace(/\/\*[\s\S]*?\*\//g, "")   // block comments
    .replace(/^[ \t]*\/\/.*$/gm, "");   // line comments
  assert(!libCode.includes("@/utils"), "lib: no @/utils import (db handle injected as a parameter)");
  assert(
    (libCode.match(/db\("o_assets"\)/g) || []).length === 1,
    "lib: exactly ONE o_assets reference — the read-only projectId lookup",
  );
  assert(
    !/\.\s*(update|insert|del|delete)\s*\(/.test(libCode),
    "lib: no direct write builders — every write delegated to selectWinnerInGroup (o_assets never written)",
  );
  assert(
    /whereRaw\(\s*"json_extract\(data, '\$\.oAssetId'\) = \?"\s*,\s*\[oAssetId\]\s*\)/.test(libCode),
    "T-49-10: json_extract fallback binds oAssetId via whereRaw placeholder (no concatenated values)",
  );
  assert(
    /import\s*\{[^}]*selectWinnerInGroup[^}]*\}\s*from\s*["']\.\/canvasRelationalStore["']/.test(libCode),
    "lib: reuses selectWinnerInGroup from ./canvasRelationalStore (selection logic NOT rewritten)",
  );
  assert(
    !/assets-registry|fetch\s*\(|axios|express/.test(libCode),
    "loop prevention (T-49-13): lib references no registry route and no HTTP client — registry→canvas one-way",
  );
  assert(
    libSrc.includes("registry→canvas"),
    "lib: header documents the registry→canvas one-way direction (D-06)",
  );

  if (!hasFind || !hasFindAll || !hasApply) {
    return summary();
  }

  // ─── Temp :memory: sqlite (NEVER the production file) ────────────────────
  const db = knex({
    client: "better-sqlite3",
    connection: { filename: ":memory:" },
    useNullAsDefault: true,
  });

  // Mirror the production DDL (same shapes as scripts/verify-phase-49.ts —
  // canvas_nodes / canvas_variant_groups per src/lib/initDB.ts builders,
  // o_assets minimal columns: the linkage only reads projectId).
  await db.schema.createTable("canvas_nodes", (t: any) => {
    t.string("id", 128).notNullable();
    t.integer("project_id").notNullable();
    t.integer("episodes_id").notNullable();
    t.string("type", 32).notNullable();
    t.string("branch_id", 64).notNullable().defaultTo("main");
    t.integer("phase_index").defaultTo(0);
    t.string("phase_name", 128);
    t.float("position_x").defaultTo(0);
    t.float("position_y").defaultTo(0);
    t.float("size_width").defaultTo(260);
    t.float("size_height").defaultTo(180);
    t.text("data");
    t.string("state", 16).defaultTo("idle");
    t.string("review_status", 16);
    t.text("ai_score");
    t.boolean("is_winner").defaultTo(false);
    t.text("reject_reason");
    t.text("suggestion");
    t.string("variant_of", 128);
    t.string("variant_group_id", 128);
    t.bigInteger("created_at").notNullable();
    t.bigInteger("updated_at").notNullable();
    t.primary(["id", "project_id", "episodes_id"]);
  });
  await db.schema.createTable("canvas_variant_groups", (t: any) => {
    t.string("id", 128).notNullable();
    t.integer("project_id").notNullable();
    t.integer("episodes_id").notNullable();
    t.integer("phase_index").defaultTo(0);
    t.string("branch_id", 64).defaultTo("main");
    t.text("variant_node_ids");
    t.string("winner_node_id", 128);
    t.string("select_mode", 16).defaultTo("single");
    t.bigInteger("created_at").notNullable();
    t.bigInteger("updated_at").notNullable();
    t.primary(["id", "project_id", "episodes_id"]);
  });
  await db.schema.createTable("o_assets", (t: any) => {
    t.increments("id").primary();
    t.integer("projectId");
    t.boolean("isPrimaryView").defaultTo(false);
  });

  try {
    // ── Fixture ────────────────────────────────────────────────────────────
    const P = 101;   // asset project
    const E = 1;     // episodes
    const T0 = 1700000000000;

    // asset 8 lives in project 108 — its a-oasset-8 node exists ONLY under
    // project 202 → the project-scoped lookup must never see it (xp guard).
    await db("o_assets").insert([
      { id: 1, projectId: P, isPrimaryView: 1 },   // family primary (not canvas-mapped)
      { id: 2, projectId: P, isPrimaryView: 0 },   // → a-oasset-2, group gL1 (initial winner)
      { id: 3, projectId: P, isPrimaryView: 0 },   // → a-oasset-3, group gL1
      { id: 4, projectId: P, isPrimaryView: 0 },   // → a-oasset-4, NO group
      { id: 5, projectId: P, isPrimaryView: 0 },   // NO canvas node at all
      { id: 6, projectId: P, isPrimaryView: 0 },   // → a-oasset-6, group gLm (multi)
      { id: 7, projectId: P, isPrimaryView: 0 },   // → node-json-7 (json_extract fallback), gLj
      { id: 8, projectId: 108, isPrimaryView: 0 }, // node a-oasset-8 exists only in project 202
      { id: 9, projectId: null, isPrimaryView: 0 },// projectless asset — never mappable
    ]);

    const node = (id: string, projectId: number, oAssetId: number | null, groupId: string | null, isWinner: number) => ({
      id, project_id: projectId, episodes_id: E, type: "asset", branch_id: "main",
      phase_index: 4, phase_name: "p04_character_design",
      position_x: 0, position_y: 0, size_width: 260, size_height: 180,
      data: JSON.stringify(oAssetId == null ? {} : { oAssetId }),
      state: "idle", is_winner: isWinner, variant_group_id: groupId,
      created_at: T0, updated_at: T0,
    });
    await db("canvas_nodes").insert([
      node("a-oasset-2", P, 2, "gL1", 1),   // initial winner
      node("a-oasset-3", P, 3, "gL1", 0),
      node("a-oasset-4", P, 4, null, 0),    // in no group (normal sync-node state)
      node("a-oasset-6", P, 6, "gLm", 0),
      node("node-json-7", P, 7, "gLj", 0),  // id NOT a-oasset- shaped; data.oAssetId only
      node("a-oasset-8", 202, 8, "g8x", 0), // foreign project, same node id
    ]);
    const group = (id: string, projectId: number, members: string[], mode: string, winner: string | null) => ({
      id, project_id: projectId, episodes_id: E, phase_index: 4, branch_id: "main",
      variant_node_ids: JSON.stringify(members), winner_node_id: winner,
      select_mode: mode, created_at: T0, updated_at: T0,
    });
    await db("canvas_variant_groups").insert([
      group("gL1", P, ["a-oasset-2", "a-oasset-3"], "single", "a-oasset-2"),
      group("gLm", P, ["a-oasset-6"], "multi", null),
      group("gLj", P, ["node-json-7"], "single", null),
      group("g8x", 202, ["a-oasset-8"], "single", null),
    ]);

    // WR-04 fixture: asset 12's node exists in episodes 1 AND 2 (canvas_nodes
    // composite PK allows the same id across episodes); a-oasset-13 is the
    // incumbent winner of BOTH episodes' groups.
    const nodeEp = (id: string, episodesId: number, oAssetId: number, groupId: string, isWinner: number) => ({
      id, project_id: P, episodes_id: episodesId, type: "asset", branch_id: "main",
      phase_index: 4, phase_name: "p04_character_design",
      position_x: 0, position_y: 0, size_width: 260, size_height: 180,
      data: JSON.stringify({ oAssetId }), state: "idle", is_winner: isWinner,
      variant_group_id: groupId, created_at: T0, updated_at: T0,
    });
    await db("o_assets").insert([
      { id: 12, projectId: P, isPrimaryView: 0 },
      { id: 13, projectId: P, isPrimaryView: 1 },
    ]);
    await db("canvas_nodes").insert([
      nodeEp("a-oasset-12", 1, 12, "gEp1", 0),
      nodeEp("a-oasset-12", 2, 12, "gEp2", 0),
      nodeEp("a-oasset-13", 1, 13, "gEp1", 1),
      nodeEp("a-oasset-13", 2, 13, "gEp2", 1),
    ]);
    await db("canvas_variant_groups").insert([
      { id: "gEp1", project_id: P, episodes_id: 1, phase_index: 4, branch_id: "main",
        variant_node_ids: JSON.stringify(["a-oasset-12", "a-oasset-13"]),
        winner_node_id: "a-oasset-13", select_mode: "single", created_at: T0, updated_at: T0 },
      { id: "gEp2", project_id: P, episodes_id: 2, phase_index: 4, branch_id: "main",
        variant_node_ids: JSON.stringify(["a-oasset-12", "a-oasset-13"]),
        winner_node_id: "a-oasset-13", select_mode: "single", created_at: T0, updated_at: T0 },
    ]);

    const groupRow = (id: string, projectId: number) =>
      db("canvas_variant_groups").where({ id, project_id: projectId, episodes_id: E }).first();
    const nodeRow = (id: string, projectId: number) =>
      db("canvas_nodes").where({ id, project_id: projectId, episodes_id: E }).first();

    // ── findCanvasNodeForAsset: direct mapping assertions ──────────────────
    console.log("\n=== SELECT-03 findCanvasNodeForAsset (o_assets → canvas node mapping) ===");
    const f2 = await linkage.findCanvasNodeForAsset(db, 2);
    assert(
      !!f2 && f2.nodeId === "a-oasset-2" && f2.projectId === P && f2.episodesId === E && f2.variantGroupId === "gL1",
      "find: asset 2 → deterministic a-oasset-2 node ref {nodeId, projectId, episodesId, variantGroupId}",
      JSON.stringify(f2),
    );
    const f7 = await linkage.findCanvasNodeForAsset(db, 7);
    assert(
      !!f7 && f7.nodeId === "node-json-7" && f7.variantGroupId === "gLj",
      "find: asset 7 → json_extract fallback hits node-json-7 (non-sync id shape)",
      JSON.stringify(f7),
    );
    assert(
      (await linkage.findCanvasNodeForAsset(db, 9999)) === null,
      "find: nonexistent asset row → null",
    );
    assert(
      (await linkage.findCanvasNodeForAsset(db, 9)) === null,
      "find: asset with NULL projectId → null (canvas nodes always belong to a project)",
    );
    assert(
      (await linkage.findCanvasNodeForAsset(db, 8)) === null,
      "find (T-49-12): same-id node under a FOREIGN project is invisible — lookup scoped to the asset's projectId",
    );

    // ── (a) selection migrates the group winner ─────────────────────────────
    console.log("\n=== SELECT-03 (a) asset-center selection → canvas group winner updated ===");
    let threw = false;
    try {
      await linkage.applyRegistrySelectionToCanvas(db, 3);
    } catch (e: any) {
      threw = true;
    }
    assert(!threw, "(a) applyRegistrySelectionToCanvas resolves without throwing");
    const ga: any = await groupRow("gL1", P);
    assert(ga.winner_node_id === "a-oasset-3", "(a) gL1.winner_node_id = a-oasset-3", `actual: ${ga.winner_node_id}`);
    const na2: any = await nodeRow("a-oasset-2", P);
    const na3: any = await nodeRow("a-oasset-3", P);
    assert(na2.is_winner === 0, "(a) old winner a-oasset-2 is_winner = false");
    assert(na3.is_winner === 1, "(a) new winner a-oasset-3 is_winner = true");

    // ── (b) re-selecting the sibling migrates the winner back ───────────────
    console.log("\n=== SELECT-03 (b) re-selection migrates the winner again ===");
    await linkage.applyRegistrySelectionToCanvas(db, 2);
    const gb: any = await groupRow("gL1", P);
    assert(gb.winner_node_id === "a-oasset-2", "(b) gL1.winner_node_id back to a-oasset-2", `actual: ${gb.winner_node_id}`);
    const nb2: any = await nodeRow("a-oasset-2", P);
    const nb3: any = await nodeRow("a-oasset-3", P);
    assert(nb2.is_winner === 1 && nb3.is_winner === 0, "(b) is_winner flags flipped back (2=true, 3=false)");

    // idempotent re-run of the same selection writes nothing (D-03 via 49-01)
    await new Promise((r) => setTimeout(r, 8)); // a WOULD-be new timestamp must differ
    await linkage.applyRegistrySelectionToCanvas(db, 2);
    const gb2: any = await groupRow("gL1", P);
    assert(
      gb2.winner_node_id === "a-oasset-2" && gb2.updated_at === gb.updated_at,
      "(b) idempotent re-selection: zero writes (winner + updated_at unchanged)",
    );

    // ── (c) node without a variant group → normal-path skip, zero writes ────
    console.log("\n=== SELECT-03 (c) node without variant_group_id → silent skip (normal path) ===");
    threw = false;
    try {
      await linkage.applyRegistrySelectionToCanvas(db, 4);
    } catch (e: any) {
      threw = true;
    }
    assert(!threw, "(c) no-group node → resolves without throwing");
    const nc4: any = await nodeRow("a-oasset-4", P);
    assert(
      nc4.updated_at === T0 && nc4.is_winner === 0,
      "(c) no-group node row untouched (updated_at/is_winner unchanged)",
    );
    const gc4: any = await groupRow("gL1", P);
    assert(gc4.winner_node_id === "a-oasset-2", "(c) unrelated group untouched");

    // ── (d) asset with no canvas node → silent skip ─────────────────────────
    console.log("\n=== SELECT-03 (d) asset without any canvas node → silent skip ===");
    threw = false;
    try {
      await linkage.applyRegistrySelectionToCanvas(db, 5);
    } catch (e: any) {
      threw = true;
    }
    assert(!threw, "(d) unmapped asset → resolves without throwing");
    const ghost: any = await nodeRow("a-oasset-5", P);
    const gd5: any = await groupRow("gL1", P);
    assert(
      !ghost && gd5.winner_node_id === "a-oasset-2",
      "(d) no node created, no group touched",
    );

    // ── (e) multi-mode group → info skip, zero writes ───────────────────────
    console.log("\n=== SELECT-03 (e) multi-mode group → info skip, zero writes ===");
    threw = false;
    try {
      await linkage.applyRegistrySelectionToCanvas(db, 6);
    } catch (e: any) {
      threw = true;
    }
    assert(!threw, "(e) multi group → resolves without throwing");
    const ge: any = await groupRow("gLm", P);
    const ne6: any = await nodeRow("a-oasset-6", P);
    assert(
      ge.winner_node_id === null && ge.updated_at === T0,
      "(e) multi group row untouched (winner still NULL, updated_at unchanged)",
    );
    assert(ne6.is_winner === 0 && ne6.updated_at === T0, "(e) multi group member node untouched");

    // ── (f) json_extract fallback end-to-end ────────────────────────────────
    console.log("\n=== SELECT-03 (f) json_extract fallback linkage ===");
    await linkage.applyRegistrySelectionToCanvas(db, 7);
    const gf: any = await groupRow("gLj", P);
    const nf7: any = await nodeRow("node-json-7", P);
    assert(gf.winner_node_id === "node-json-7", "(f) gLj.winner_node_id = node-json-7 via data.oAssetId fallback", `actual: ${gf.winner_node_id}`);
    assert(nf7.is_winner === 1, "(f) node-json-7 is_winner = true");

    // ── (xp) cross-project write guard (T-49-12) ────────────────────────────
    console.log("\n=== SELECT-03 (xp) cross-project guard ===");
    threw = false;
    try {
      await linkage.applyRegistrySelectionToCanvas(db, 8);
    } catch (e: any) {
      threw = true;
    }
    assert(!threw, "(xp) foreign-project asset → resolves without throwing");
    const gx: any = await groupRow("g8x", 202);
    const nx8: any = await nodeRow("a-oasset-8", 202);
    assert(
      gx.winner_node_id === null && gx.updated_at === T0 && nx8.is_winner === 0,
      "(xp) project-202 group/node untouched — an unscoped lookup would have written g8x here",
    );

    // ── (me) WR-04: one asset, several episodes — ALL groups updated ───────
    console.log("\n=== WR-04 (me) multi-episode mapping — every episode's group updated ===");
    threw = false;
    try {
      await linkage.applyRegistrySelectionToCanvas(db, 12);
    } catch (e: any) {
      threw = true;
    }
    assert(!threw, "(me) multi-episode selection resolves without throwing");
    const gEp1Row: any = await db("canvas_variant_groups").where({ id: "gEp1", project_id: P, episodes_id: 1 }).first();
    const gEp2Row: any = await db("canvas_variant_groups").where({ id: "gEp2", project_id: P, episodes_id: 2 }).first();
    assert(
      gEp1Row.winner_node_id === "a-oasset-12" && gEp2Row.winner_node_id === "a-oasset-12",
      "(me) BOTH episodes' groups moved the winner to a-oasset-12 (no stale sibling episode)",
      `ep1=${gEp1Row.winner_node_id} ep2=${gEp2Row.winner_node_id}`,
    );
    const n12e1: any = await db("canvas_nodes").where({ id: "a-oasset-12", project_id: P, episodes_id: 1 }).first();
    const n12e2: any = await db("canvas_nodes").where({ id: "a-oasset-12", project_id: P, episodes_id: 2 }).first();
    const n13e1: any = await db("canvas_nodes").where({ id: "a-oasset-13", project_id: P, episodes_id: 1 }).first();
    assert(
      n12e1.is_winner === 1 && n12e2.is_winner === 1 && n13e1.is_winner === 0,
      "(me) is_winner flags updated in BOTH episodes (new winner up, incumbent down)",
    );
    const f12s: any = await linkage.findCanvasNodeForAsset(db, 12);
    assert(
      !!f12s && f12s.episodesId === 1,
      "(me) singular lookup returns the LOWEST episodes_id deterministically (not scan order)",
      JSON.stringify(f12s),
    );
    const f12p: any = await linkage.findCanvasNodesForAsset(db, 12);
    assert(
      Array.isArray(f12p) && f12p.length === 2 &&
        f12p[0].episodesId === 1 && f12p[1].episodesId === 2,
      "(me) plural lookup returns ALL refs ordered episodes_id asc",
      JSON.stringify(f12p),
    );

    // ── (err) internal failure is swallowed — never throws outward (T-49-11) ─
    console.log("\n=== SELECT-03 (err) failure isolation ===");
    const failingDb = new Proxy(db, {
      apply(t: any, _thisArg: any, args: any[]) {
        if (args[0] === "o_assets") throw new Error("injected o_assets read failure");
        return Reflect.apply(t, t, args);
      },
      get(t: any, prop: string | symbol) {
        const v = Reflect.get(t, prop);
        return typeof v === "function" ? v.bind(t) : v;
      },
    });
    threw = false;
    try {
      await linkage.applyRegistrySelectionToCanvas(failingDb, 2);
    } catch (e: any) {
      threw = true;
    }
    assert(!threw, "(err) injected read failure swallowed by the top-level catch (exported fn never throws)");

    // ── (g) registry PATCH route source-shape assertions ────────────────────
    runRouteShapeAssertions();
  } finally {
    await db.destroy();
  }

  return summary();
}

// ─── Registry PATCH hook source-shape (Plan 49-03 Task 2, assertion g) ─────

function runRouteShapeAssertions(): void {
  console.log("\n=== SELECT-03 (g) registry PATCH hook source shape ===");
  const routeSrc = read("src/routes/v1/assets-registry/index.ts");

  const updatePos = routeSrc.indexOf('await u.db("o_assets").where("id", id).update(updates)');
  const hookPos = routeSrc.indexOf("applyRegistrySelectionToCanvas(u.db, id)");
  assert(
    updatePos >= 0 && hookPos > updatePos,
    "(g) hook invoked AFTER the o_assets update (registry write already persisted)",
    `updatePos=${updatePos}, hookPos=${hookPos}`,
  );
  const condPos = routeSrc.indexOf("updates.isPrimaryView === true");
  assert(
    condPos >= 0 && condPos < hookPos,
    "(g) hook guarded by updates.isPrimaryView === true BEFORE the call (selection event only — false is a deselect)",
    `condPos=${condPos}`,
  );
  assert(
    /void\s+applyRegistrySelectionToCanvas\(u\.db,\s*id\)\s*\.catch\(/.test(routeSrc),
    "(g) fire-and-forget: void prefix + .catch attached (T-49-11 failure isolation)",
  );
  assert(
    routeSrc.includes("[assets-registry] 选定联动画布失败(不影响资产更新)"),
    "(g) catch handler only warns — the PATCH response is unaffected",
  );
  assert(
    routeSrc.includes("success({ id, updated: Object.keys(updates) })"),
    "(g) PATCH 200 response shape unchanged (success({ id, updated }))",
  );
  assert(
    /import\s*\{\s*applyRegistrySelectionToCanvas\s*\}\s*from\s*"@\/lib\/canvasAssetLinkage"/.test(routeSrc),
    "(g) applyRegistrySelectionToCanvas imported from @/lib/canvasAssetLinkage",
  );
  assert(
    !read("src/routes/canvas/v2/select-winner.ts").includes("assets-registry"),
    "(g) loop prevention (T-49-13): select-winner endpoint (canvas→o_assets D-07 direct write) never calls assets-registry",
  );
  assert(
    read("package.json").includes('"verify:phase-49-linkage": "npx tsx scripts/verify-phase-49-linkage.ts"'),
    "(g) package.json entry registered by 49-01 intact (49-03 does not touch package.json)",
  );
}

// ─── Summary ────────────────────────────────────────────────────────────────
async function summary(): Promise<void> {
  const passed = results.filter((r) => r.pass).length;
  const total = results.length;
  const failed = total - passed;
  console.log(`\n=== Summary: ${passed}/${total} assertions passed, FAIL count = ${failed} ===`);
  if (passed === total) {
    console.log("✅ Phase 49 linkage verification PASSED (SELECT-03)");
    cleanup();
    process.exit(0);
  } else {
    console.log("❌ Phase 49 linkage verification FAILED");
    for (const r of results.filter((x) => !x.pass)) {
      console.log(`   FAIL: ${r.name}${r.detail ? " — " + r.detail : ""}`);
    }
    cleanup();
    process.exit(1);
  }
}

function cleanup(): void {
  try {
    fs.rmSync(ISOLATION_DIR, { recursive: true, force: true });
  } catch {
    // temp dir cleanup is best-effort; the isolation dir lives under os.tmpdir()
  }
}

main().catch((err) => {
  console.error("verify-phase-49-linkage.ts crashed:", err);
  cleanup();
  process.exit(2);
});
