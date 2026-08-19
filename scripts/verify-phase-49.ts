#!/usr/bin/env tsx
/**
 * verify-phase-49.ts — Phase 49 (Selection Write-back) behavioral gate.
 *
 * Plan 49-01 (SELECT-01): the select-winner backend endpoint and its
 * transactional store functions. This script imports the REAL modules from
 * src (never re-implemented copies) and asserts every error semantic,
 * idempotency, transaction atomicity, and the D-07 o_assets isPrimaryView
 * swap on a temp :memory: sqlite database.
 *
 * Isolation guard: the module under test (src/lib/canvasRelationalStore)
 * transitively imports the app db boot (src/utils/db), whose import-time
 * IIFE resolves its sqlite file from process.cwd()/data. We chdir into a
 * throwaway temp directory BEFORE the dynamic import so the boot writes an
 * isolated temp file — the production sqlite database is never opened.
 *
 * Run: npm run verify:phase-49   (or: npx tsx scripts/verify-phase-49.ts)
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
const ISOLATION_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "verify-phase-49-"));
// Transitive module graph quirk: src/utils/writeVersion.ts parses package.json
// from process.cwd() at import time — stage a copy so the chdir stays safe.
fs.copyFileSync(path.join(REPO_ROOT, "package.json"), path.join(ISOLATION_DIR, "package.json"));
process.chdir(ISOLATION_DIR);

async function main(): Promise<void> {
  console.log("=== Phase 49 — verify-phase-49.ts (SELECT-01 store behavior) ===\n");

  const store: any = await import("../src/lib/canvasRelationalStore");

  // ── Export gate (TDD RED pivot: everything below needs these exports) ────
  const hasSelect = typeof store.selectWinnerInGroup === "function";
  const hasSync = typeof store.syncAssetPrimaryForWinner === "function";
  assert(hasSelect, "SELECT-01: canvasRelationalStore exports selectWinnerInGroup");
  assert(hasSync, "SELECT-01: canvasRelationalStore exports syncAssetPrimaryForWinner");

  // ── Source-shape assertion: no string-concatenated UPDATE SQL (T-49-02) ──
  const storeSrc = read("src/lib/canvasRelationalStore.ts");
  assert(
    !/\bUPDATE\s+canvas_/i.test(storeSrc),
    "T-49-02: no raw 'UPDATE canvas_…' SQL string in canvasRelationalStore.ts (parameterized builders only)",
  );

  if (!hasSelect || !hasSync) {
    return summary();
  }

  // ─── Temp :memory: sqlite (NEVER the production file) ────────────────────
  const db = knex({
    client: "better-sqlite3",
    connection: { filename: ":memory:" },
    useNullAsDefault: true,
  });

  // Mirror the production DDL column-for-column for the three tables the
  // selection path touches (src/lib/initDB.ts canvas_nodes / canvas_variant_groups
  // builders; o_assets minimal columns per Plan 49-01 Task 3).
  await db.schema.createTable("canvas_nodes", (t) => {
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
  await db.schema.createTable("canvas_variant_groups", (t) => {
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
  await db.schema.createTable("o_assets", (t) => {
    t.increments("id").primary();
    t.integer("projectId");
    t.integer("assetsId").nullable();
    t.boolean("isPrimaryView").defaultTo(false);
  });

  try {
    // ── Fixture ────────────────────────────────────────────────────────────
    const SCOPE = { projectId: 101, episodesId: 1 };
    const T0 = 1700000000000;

    // o_assets mirror of the g1 candidate group: 1 primary + 2 members sharing
    // its assetsId, plus a cross-project primary that must never be touched.
    await db("o_assets").insert([
      { id: 1, projectId: 101, assetsId: null, isPrimaryView: 1 }, // p1 old primary
      { id: 2, projectId: 101, assetsId: 1, isPrimaryView: 0 },    // m1 — node A
      { id: 3, projectId: 101, assetsId: 1, isPrimaryView: 0 },    // m2 — node B
      { id: 4, projectId: 999, assetsId: 1, isPrimaryView: 1 },    // px cross-project guard
      { id: 77, projectId: 101, assetsId: null, isPrimaryView: 0 },// prefix-parsed target (g3)
    ]);

    const node = (id: string, data: Record<string, unknown>, groupName: string | null, phaseName: string) => ({
      id, project_id: SCOPE.projectId, episodes_id: SCOPE.episodesId,
      type: "asset", branch_id: "main", phase_index: 11, phase_name: phaseName,
      position_x: 0, position_y: 0, size_width: 260, size_height: 180,
      data: JSON.stringify(data), state: "idle",
      is_winner: 0, variant_group_id: groupName,
      created_at: T0, updated_at: T0,
    });
    // g1 members: A, B exist; C is a DANGLING variant_node_ids entry (no row).
    await db("canvas_nodes").insert([
      node("node-a", { oAssetId: 2 }, "g1", "p11_first_last_frames"),
      node("node-b", { oAssetId: 3 }, "g1", "p11_first_last_frames"),
      node("node-x", {}, "g3", "p04_character_design"),          // id NOT a-oasset-*; no oAssetId
      node("a-oasset-77", { label: "prefix only" }, "g3", "p04_character_design"), // prefix-mapped
      node("node-solo", {}, null, "manual_sync"),                 // exists but in no group
    ]);
    const group = (id: string, members: string[], mode: string, winner: string | null) => ({
      id, project_id: SCOPE.projectId, episodes_id: SCOPE.episodesId,
      phase_index: 11, branch_id: "main",
      variant_node_ids: JSON.stringify(members),
      winner_node_id: winner, select_mode: mode,
      created_at: T0, updated_at: T0,
    });
    await db("canvas_variant_groups").insert([
      group("g1", ["node-a", "node-b", "node-c"], "single", null), // node-c dangling
      group("g2", ["node-a", "node-b"], "multi", null),
      group("g3", ["node-x", "a-oasset-77"], "single", "node-x"),
    ]);

    // ── updated: select node-b in g1 ───────────────────────────────────────
    console.log("\n=== SELECT-01 updated (transactional winner write) ===");
    const r1 = await store.selectWinnerInGroup(db, SCOPE, "g1", "node-b");
    assert(r1.status === "updated", "updated: status === 'updated'", `actual: ${r1.status}`);
    assert(r1.groupId === "g1" && r1.winnerNodeId === "node-b", "updated: echoes groupId + winnerNodeId");
    assert(r1.variantIndex === 2, "updated: variantIndex = 2 (1-based position of node-b)", `actual: ${r1.variantIndex}`);
    assert(r1.winnerPhaseName === "p11_first_last_frames", "updated: winnerPhaseName extracted from member row", `actual: ${r1.winnerPhaseName}`);
    assert(r1.winnerOAssetId === 3, "updated: winnerOAssetId = 3 via data.oAssetId", `actual: ${r1.winnerOAssetId}`);
    assert(
      JSON.stringify(r1.memberOAssetIds) === JSON.stringify([2, 3]),
      "updated: memberOAssetIds = [2,3] (dangling node-c contributes nothing)",
      JSON.stringify(r1.memberOAssetIds),
    );
    const g1Row: any = await db("canvas_variant_groups").where({ id: "g1", project_id: 101, episodes_id: 1 }).first();
    assert(g1Row.winner_node_id === "node-b", "updated: canvas_variant_groups.winner_node_id = node-b", `actual: ${g1Row.winner_node_id}`);
    assert(g1Row.updated_at > T0, "updated: group updated_at bumped");
    const aRow: any = await db("canvas_nodes").where({ id: "node-a", project_id: 101, episodes_id: 1 }).first();
    const bRow: any = await db("canvas_nodes").where({ id: "node-b", project_id: 101, episodes_id: 1 }).first();
    assert(aRow.is_winner === 0, "updated: member node-a is_winner = false");
    assert(bRow.is_winner === 1, "updated: winner node-b is_winner = true");
    assert(aRow.updated_at > T0 && bRow.updated_at > T0, "updated: member rows updated_at bumped");

    // ── idempotent: re-select the same winner — zero writes (D-03) ─────────
    console.log("\n=== SELECT-01 idempotent no-op (D-03) ===");
    await new Promise((r) => setTimeout(r, 8)); // guarantee a WOULD-be new timestamp differs
    const r2 = await store.selectWinnerInGroup(db, SCOPE, "g1", "node-b");
    assert(r2.status === "idempotent", "idempotent: status === 'idempotent' (no 409)", `actual: ${r2.status}`);
    assert(r2.variantIndex === 2, "idempotent: variantIndex still meaningful (= 2)");
    const g1Row2: any = await db("canvas_variant_groups").where({ id: "g1", project_id: 101, episodes_id: 1 }).first();
    const bRow2: any = await db("canvas_nodes").where({ id: "node-b", project_id: 101, episodes_id: 1 }).first();
    assert(g1Row2.updated_at === g1Row.updated_at, "idempotent: group updated_at UNCHANGED (zero writes)", `before=${g1Row.updated_at} after=${g1Row2.updated_at}`);
    assert(bRow2.updated_at === bRow.updated_at, "idempotent: winner row updated_at UNCHANGED (zero writes)");

    // ── re-select the dangling member as winner — tolerated, no crash ──────
    console.log("\n=== SELECT-01 dangling member tolerance ===");
    const r3 = await store.selectWinnerInGroup(db, SCOPE, "g1", "node-c");
    assert(r3.status === "updated", "dangling winner: status still 'updated' (missing row does not block)", `actual: ${r3.status}`);
    const g1Row3: any = await db("canvas_variant_groups").where({ id: "g1", project_id: 101, episodes_id: 1 }).first();
    assert(g1Row3.winner_node_id === "node-c", "dangling winner: group winner_node_id = node-c (truth lives in the column)");
    const aRow3: any = await db("canvas_nodes").where({ id: "node-a", project_id: 101, episodes_id: 1 }).first();
    const bRow3: any = await db("canvas_nodes").where({ id: "node-b", project_id: 101, episodes_id: 1 }).first();
    assert(aRow3.is_winner === 0 && bRow3.is_winner === 0, "dangling winner: existing members is_winner reset to false");
    assert(r3.winnerPhaseName === null && r3.winnerOAssetId === null, "dangling winner: winnerPhaseName/winnerOAssetId = null (no row to read)");
    // restore node-b as winner for the transaction test below
    await store.selectWinnerInGroup(db, SCOPE, "g1", "node-b");

    // ── error semantics: not_found / not_in_group / multi_mode ─────────────
    console.log("\n=== SELECT-01 error semantics (404/409/409 sources) ===");
    const rn = await store.selectWinnerInGroup(db, SCOPE, "g-unknown", "node-a");
    assert(rn.status === "not_found" && rn.variantIndex === 0, "not_found: unknown group → status 'not_found', variantIndex 0", `actual: ${rn.status}`);
    const ri = await store.selectWinnerInGroup(db, SCOPE, "g1", "node-solo");
    assert(ri.status === "not_in_group", "not_in_group: existing node outside the group → 'not_in_group'", `actual: ${ri.status}`);
    const rz = await store.selectWinnerInGroup(db, SCOPE, "g1", "totally-unknown-node");
    assert(rz.status === "not_in_group", "not_in_group: unknown node id → 'not_in_group'", `actual: ${rz.status}`);
    const rm = await store.selectWinnerInGroup(db, SCOPE, "g2", "node-a");
    assert(rm.status === "multi_mode", "multi_mode: select_mode='multi' group refuses a single winner", `actual: ${rm.status}`);
    const g2Row: any = await db("canvas_variant_groups").where({ id: "g2", project_id: 101, episodes_id: 1 }).first();
    assert(g2Row.winner_node_id === null && g2Row.updated_at === T0, "multi_mode: rejected group row untouched (no writes)");
    const wrongScope = await store.selectWinnerInGroup(db, { projectId: 202, episodesId: 1 }, "g1", "node-a");
    assert(wrongScope.status === "not_found", "not_found: same group id under a different scope is invisible (composite PK honored)");

    // ── a-oasset- prefix fallback (verified_fact 1 reverse mapping) ────────
    console.log("\n=== SELECT-01 oAssetId prefix fallback ===");
    const r4 = await store.selectWinnerInGroup(db, SCOPE, "g3", "a-oasset-77");
    assert(r4.status === "updated", "prefix: selecting the a-oasset-77 node succeeds", `actual: ${r4.status}`);
    assert(r4.winnerOAssetId === 77, "prefix: winnerOAssetId = 77 parsed from the a-oasset- id prefix (no data.oAssetId)", `actual: ${r4.winnerOAssetId}`);
    assert(
      JSON.stringify(r4.memberOAssetIds) === JSON.stringify([77]),
      "prefix: memberOAssetIds = [77] (node-x has no mapping and is excluded)",
      JSON.stringify(r4.memberOAssetIds),
    );

    // ── D-07: syncAssetPrimaryForWinner swap ───────────────────────────────
    console.log("\n=== D-07 o_assets isPrimaryView swap ===");
    // g1 winner is node-b → o_assets 3; members [2,3]; old primary is 1.
    const swapped = await store.syncAssetPrimaryForWinner(db, 101, 3, [2, 3]);
    const m2After: any = await db("o_assets").where({ id: 3 }).first();
    const p1After: any = await db("o_assets").where({ id: 1 }).first();
    const m1After: any = await db("o_assets").where({ id: 2 }).first();
    const pxAfter: any = await db("o_assets").where({ id: 4 }).first();
    assert(m2After.isPrimaryView === 1, "D-07: winner asset 3 isPrimaryView = 1");
    assert(p1After.isPrimaryView === 0, "D-07: old primary asset 1 demoted to 0 (same assetsId family)");
    assert(m1After.isPrimaryView === 0, "D-07: sibling member asset 2 stays 0");
    assert(pxAfter.isPrimaryView === 1, "D-07: cross-project primary (projectId 999) UNTOUCHED", `actual: ${pxAfter.isPrimaryView}`);
    assert(
      JSON.stringify([...swapped].sort((x: number, y: number) => x - y)) === JSON.stringify([1, 3]),
      "D-07: returns the changed asset ids [1,3]",
      JSON.stringify(swapped),
    );

    const swappedEmpty = await store.syncAssetPrimaryForWinner(db, 101, null as any, [2, 3]);
    assert(
      Array.isArray(swappedEmpty) && swappedEmpty.length === 0,
      "D-07: winnerOAssetId null (canvas node maps to no o_assets) → [] no-op",
    );
    const swappedMissing = await store.syncAssetPrimaryForWinner(db, 101, 424242, [2, 3]);
    assert(
      Array.isArray(swappedMissing) && swappedMissing.length === 0,
      "D-07: winner o_assets row does not exist → [] no-op",
    );

    // ── transaction atomicity: injected mid-transaction failure rolls back ──
    console.log("\n=== SELECT-01 transaction atomicity (no half-writes) ===");
    const g1BeforeFail: any = await db("canvas_variant_groups").where({ id: "g1", project_id: 101, episodes_id: 1 }).first();
    const aBeforeFail: any = await db("canvas_nodes").where({ id: "node-a", project_id: 101, episodes_id: 1 }).first();
    let txThrew = false;
    let txErrMsg = "";
    try {
      // Proxy the injected db so that, INSIDE the transaction, any
      // canvas_nodes UPDATE throws — the group-table UPDATE that ran first
      // must be rolled back with it.
      const failingTrxFor = (trx: any) =>
        new Proxy(trx, {
          apply(t: any, _thisArg: any, args: any[]) {
            const builder: any = Reflect.apply(t, t, args);
            if (args[0] !== "canvas_nodes") return builder;
            const pb: any = new Proxy(builder, {
              get(b: any, prop: string | symbol) {
                if (prop === "update") {
                  return () => { throw new Error("injected canvas_nodes update failure"); };
                }
                const v = Reflect.get(b, prop, b);
                if (typeof v !== "function") return v;
                return (...inner: any[]) => {
                  const r = v.apply(b, inner);
                  return r === b ? pb : r;
                };
              },
            });
            return pb;
          },
          get(t: any, prop: string | symbol) {
            const v = Reflect.get(t, prop);
            return typeof v === "function" ? v.bind(t) : v;
          },
        });
      const failingDb = new Proxy(db, {
        apply(t: any, _thisArg: any, args: any[]) {
          return Reflect.apply(t, t, args);
        },
        get(t: any, prop: string | symbol) {
          if (prop === "transaction") {
            const orig = t.transaction.bind(t);
            return (cb: any) => orig(async (trx: any) => cb(failingTrxFor(trx)));
          }
          const v = Reflect.get(t, prop);
          return typeof v === "function" ? v.bind(t) : v;
        },
      });
      await store.selectWinnerInGroup(failingDb, SCOPE, "g1", "node-a");
    } catch (err: any) {
      txThrew = true;
      txErrMsg = String(err?.message ?? err);
    }
    assert(txThrew, "atomicity: mid-transaction canvas_nodes failure propagates", txErrMsg);
    const g1AfterFail: any = await db("canvas_variant_groups").where({ id: "g1", project_id: 101, episodes_id: 1 }).first();
    const aAfterFail: any = await db("canvas_nodes").where({ id: "node-a", project_id: 101, episodes_id: 1 }).first();
    assert(
      g1AfterFail.winner_node_id === g1BeforeFail.winner_node_id,
      "atomicity: group winner_node_id rolled back (no half-write)",
      `before=${g1BeforeFail.winner_node_id} after=${g1AfterFail.winner_node_id}`,
    );
    assert(
      aAfterFail.is_winner === aBeforeFail.is_winner && aAfterFail.updated_at === aBeforeFail.updated_at,
      "atomicity: member row is_winner/updated_at rolled back",
    );

    // ── handler-level endpoint semantics (Plan 49-01 Task 2) ───────────────
    await runEndpointSemantics(store);
  } finally {
    await db.destroy();
  }

  return summary();
}

// ─── Endpoint semantics via the real express router (Task 2) ────────────────
async function runEndpointSemantics(_store: any): Promise<void> {
  // [49-01 Task 2] handler-level 404/409/400/200 assertions are appended here
  // when src/routes/canvas/v2/select-winner.ts lands.
}

// ─── Summary ────────────────────────────────────────────────────────────────
async function summary(): Promise<void> {
  const passed = results.filter((r) => r.pass).length;
  const total = results.length;
  const failed = total - passed;
  console.log(`\n=== Summary: ${passed}/${total} assertions passed, FAIL count = ${failed} ===`);
  if (passed === total) {
    console.log("✅ Phase 49 verification PASSED (SELECT-01)");
    cleanup();
    process.exit(0);
  } else {
    console.log("❌ Phase 49 verification FAILED");
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
  console.error("verify-phase-49.ts crashed:", err);
  cleanup();
  process.exit(2);
});
