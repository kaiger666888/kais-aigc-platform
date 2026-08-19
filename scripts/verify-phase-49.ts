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
 * Endpoint dispatch (Task 2) runs in a SPAWNED CHILD PROCESS for the same
 * isolation reason plus a knex pool quirk: sharing one process between the
 * long-running :memory: store section and the app-db boot leaves the appDb
 * pool corrupted (insert connections never settle; standalone probe
 * processes boot + insert fine in ~1.3s). The child generates, runs, and
 * reports CHILD_RESULT lines this parent folds into the results table.
 *
 * Run: npm run verify:phase-49   (or: npx tsx scripts/verify-phase-49.ts)
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
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

  // Import-order guard: mirror the app's module-graph root (@/utils barrel)
  // BEFORE anything that transitively imports @/utils/db. Rooting the graph
  // at canvasRelationalStore instead leaves the barrel's `db` re-export
  // undefined (circular db.ts ↔ barrel ↔ fixDB CJS evaluation order) and the
  // isolated boot dies inside fixDB with "u.db is not a function".
  const utilsBarrel: any = await import("../src/utils");
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
    runEndpointSemantics();
  } finally {
    await db.destroy();
  }

  return summary();
}

// ─── Endpoint semantics via the real express router (Task 2) ────────────────
//
// The live dispatch runs in a SPAWNED CHILD PROCESS. Sharing one process
// between the long-running :memory: store section above and the app-db boot
// (src/utils/db import-time IIFE) leaves the appDb knex pool corrupted —
// insert connections open but never settle (standalone probe processes boot
// and insert fine in ~1.3s, so the code under test is sound; the corruption
// is a tsx/isolated-boot environment artifact). The child performs its own
// mkdtemp/chdir isolation, boots the real db against a temp file, seeds the
// fixture, dispatches every endpoint case through the real express router,
// and reports tab-separated CHILD_RESULT lines the parent folds into the
// shared results table. The generated script is written INSIDE scripts/
// (tsx only resolves the repo's @/ aliases for files inside the repo tree)
// and deleted after every run.

const CHILD_SRC = String.raw`
// GENERATED at runtime by scripts/verify-phase-49.ts — do not commit.
// Endpoint dispatch for Phase 49 SELECT-01, isolated in a child process.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..");
const ISO = fs.mkdtempSync(path.join(os.tmpdir(), "verify-phase-49-ep-"));
// writeVersion.ts parses package.json from process.cwd() at import time.
fs.copyFileSync(path.join(REPO_ROOT, "package.json"), path.join(ISO, "package.json"));
process.chdir(ISO);

function emit(pass: boolean, name: string, detail?: string): void {
  process.stdout.write("CHILD_RESULT\t" + (pass ? "1" : "0") + "\t" + name + (detail ? "\t" + detail : "") + "\n");
}

/** Minimal Node-style req/res pair sufficient for an express.Router dispatch. */
async function callEndpoint(
  routerFn: any,
  method: string,
  urlPath: string,
  body: unknown,
): Promise<{ status: number; payload: any }> {
  const req: any = {
    method,
    url: urlPath,
    headers: {},
    body,
    params: {},
    query: {},
    socket: { remoteAddress: "127.0.0.1" },
    connection: { remoteAddress: "127.0.0.1" },
  };
  const res: any = {
    statusCode: 200,
    headersSent: false,
    payload: undefined,
    status(code: number) { this.statusCode = code; return this; },
    send(payload: any) { this.payload = payload; this.headersSent = true; settle(); return this; },
    json(payload: any) { this.payload = payload; this.headersSent = true; settle(); return this; },
    end() { this.headersSent = true; settle(); return this; },
    setHeader() { return this; },
    getHeader() { return undefined; },
    removeHeader() { return this; },
    write() { return true; },
    writeHead(code: number) { this.statusCode = code; settle(); return this; },
  };
  // A handler that responds via res.send()/json()/end() does NOT call next() —
  // settle on the FIRST response method instead of waiting for next().
  let settle: () => void = () => undefined;
  await new Promise<void>((resolve, reject) => {
    settle = resolve;
    routerFn(req, res, (err: any) => (err ? reject(err) : resolve()));
  });
  return { status: res.statusCode, payload: res.payload };
}

async function main(): Promise<void> {
  // Import-order guard: root the module graph at the @/utils barrel first
  // (circular db.ts <-> barrel <-> fixDB evaluation order; see parent script).
  await import("../src/utils");
  const routeMod: any = await import("../src/routes/canvas/v2/select-winner");
  const dbMod: any = await import("../src/utils/db");
  await Promise.race([
    dbMod.bootReady,
    new Promise((_, rej) => setTimeout(() => rej(new Error("bootReady timed out after 60s")), 60000)),
  ]);
  const appDb = dbMod.db;

  // Fixture inside the isolated app db (full production schema, project 777).
  const T0 = 1700000000000;
  // NOTE: batch inserts (knex compound UNION-ALL SELECT) never settle on the
  // appDb pool in this isolated-boot context — seed row-per-row.
  for (const row of [
    { id: 9000, projectId: 777, assetsId: null, isPrimaryView: 1, state: "active" },
    { id: 9001, projectId: 777, assetsId: 9000, isPrimaryView: 0, state: "active" },
    { id: 9002, projectId: 777, assetsId: 9000, isPrimaryView: 0, state: "active" },
  ]) {
    await appDb("o_assets").insert(row);
  }
  const epNode = (id: string, oAssetId: number, groupName: string) => ({
    id, project_id: 777, episodes_id: 1, type: "asset", branch_id: "main",
    phase_index: 11, phase_name: "p11_first_last_frames",
    position_x: 0, position_y: 0, size_width: 260, size_height: 180,
    data: JSON.stringify({ oAssetId }), state: "idle", is_winner: 0,
    variant_group_id: groupName, created_at: T0, updated_at: T0,
  });
  for (const n of [
    epNode("ep-a", 9001, "gE1"),
    epNode("ep-b", 9002, "gE1"),
    epNode("ep-solo", 9000, "none"),
  ]) {
    await appDb("canvas_nodes").insert(n);
  }
  const groupRow = (id: string, mode: string) => ({
    id, project_id: 777, episodes_id: 1, phase_index: 11, branch_id: "main",
    variant_node_ids: JSON.stringify(["ep-a", "ep-b"]), winner_node_id: null,
    select_mode: mode, created_at: T0, updated_at: T0,
  });
  for (const g of [groupRow("gE1", "single"), groupRow("gE2", "multi")]) {
    await appDb("canvas_variant_groups").insert(g);
  }

  const post = (groupId: string, body: unknown) =>
    callEndpoint(routeMod.default, "POST", "/" + groupId + "/select-winner", body);
  const okBody = { projectId: 777, episodesId: 1, winnerNodeId: "ep-b" };

  // 404 — group does not exist
  const r404 = await post("g-unknown", okBody);
  emit(r404.status === 404, "endpoint: unknown group → HTTP 404", "actual: " + r404.status);
  emit(
    !!r404.payload && r404.payload.message === "变体组不存在",
    "endpoint: 404 payload message = 变体组不存在",
    JSON.stringify(r404.payload && r404.payload.message),
  );

  // 409 — winner not in group
  const r409i = await post("gE1", { ...okBody, winnerNodeId: "ep-solo" });
  emit(r409i.status === 409, "endpoint: winner outside the group → HTTP 409", "actual: " + r409i.status);
  emit(
    !!r409i.payload && r409i.payload.message === "winnerNodeId 不在组内",
    "endpoint: 409 not-in-group message",
    JSON.stringify(r409i.payload && r409i.payload.message),
  );

  // 409 — multi group
  const r409m = await post("gE2", okBody);
  emit(r409m.status === 409, "endpoint: select_mode='multi' → HTTP 409", "actual: " + r409m.status);
  emit(
    !!r409m.payload && r409m.payload.message === "仅 single 组支持选定",
    "endpoint: 409 multi message",
    JSON.stringify(r409m.payload && r409m.payload.message),
  );

  // 400 — zod validation (missing field / wrong type / oversized id)
  const r400a = await post("gE1", { projectId: 777, episodesId: 1 });
  emit(r400a.status === 400, "endpoint: missing winnerNodeId → HTTP 400", "actual: " + r400a.status);
  const r400b = await post("gE1", { projectId: "777", episodesId: 1, winnerNodeId: "ep-b" });
  emit(r400b.status === 400, "endpoint: projectId as string → HTTP 400 (T-49-01)", "actual: " + r400b.status);
  const r400c = await post("gE1", { ...okBody, winnerNodeId: "x".repeat(129) });
  emit(r400c.status === 400, "endpoint: 129-char winnerNodeId → HTTP 400 (maxLength 128)", "actual: " + r400c.status);

  // 200 — updated selection + D-07 swap inside the endpoint
  const r200 = await post("gE1", okBody);
  emit(r200.status === 200, "endpoint: valid selection → HTTP 200", "actual: " + r200.status);
  emit(
    !!r200.payload && r200.payload.data && r200.payload.data.applied === true && r200.payload.data.groupId === "gE1",
    "endpoint: 200 payload { groupId, winnerNodeId, applied: true }",
    JSON.stringify(r200.payload && r200.payload.data),
  );
  const egRow: any = await appDb("canvas_variant_groups").where({ id: "gE1", project_id: 777, episodes_id: 1 }).first();
  emit(egRow.winner_node_id === "ep-b", "endpoint: DB winner_node_id persisted (= ep-b)", "actual: " + egRow.winner_node_id);
  const epA: any = await appDb("canvas_nodes").where({ id: "ep-a", project_id: 777, episodes_id: 1 }).first();
  const epB: any = await appDb("canvas_nodes").where({ id: "ep-b", project_id: 777, episodes_id: 1 }).first();
  emit(epA.is_winner === 0 && epB.is_winner === 1, "endpoint: DB is_winner false/true persisted");
  const a9000: any = await appDb("o_assets").where({ id: 9000 }).first();
  const a9002: any = await appDb("o_assets").where({ id: 9002 }).first();
  emit(a9002.isPrimaryView === 1, "endpoint D-07: winner asset 9002 isPrimaryView = 1");
  emit(a9000.isPrimaryView === 0, "endpoint D-07: old primary 9000 demoted to 0");

  // 200 — idempotent re-selection (applied:false, zero writes)
  await new Promise((r) => setTimeout(r, 8));
  const egRowTs = egRow.updated_at;
  const r200i = await post("gE1", okBody);
  emit(r200i.status === 200, "endpoint: re-select same winner → HTTP 200 (not 409)", "actual: " + r200i.status);
  emit(
    !!r200i.payload && r200i.payload.data && r200i.payload.data.applied === false,
    "endpoint: idempotent payload applied: false",
    JSON.stringify(r200i.payload && r200i.payload.data),
  );
  const egRow2: any = await appDb("canvas_variant_groups").where({ id: "gE1", project_id: 777, episodes_id: 1 }).first();
  emit(egRow2.updated_at === egRowTs, "endpoint: idempotent call wrote nothing (updated_at unchanged)");

  await appDb.destroy();
}

let exitCode = 0;
main().catch((err: any) => {
  exitCode = 1;
  console.error("endpoint child crashed:", err);
  process.stdout.write("CHILD_CRASHED\t" + String(err && err.message ? err.message : err).split("\n")[0] + "\n");
}).finally(() => {
  try { fs.rmSync(ISO, { recursive: true, force: true }); } catch { /* best effort */ }
  process.stdout.write("CHILD_DONE\t" + exitCode + "\n");
  process.exitCode = exitCode;
  setTimeout(() => process.exit(exitCode), 500).unref();
});
`;

function runEndpointSemantics(): void {
  console.log("\n=== SELECT-01 endpoint semantics (real router, isolated child process) ===");

  // Source-shape assertions first (cheap, independent of the live dispatch)
  const routeSrc = read("src/routes/canvas/v2/select-winner.ts");
  const routerSrc = read("src/router.ts");
  assert(
    !routeSrc.includes("assets-registry"),
    "endpoint: no assets-registry reference in the route file (D-07 loop prevention)",
  );
  assert(
    /try\s*\{[\s\S]*?await syncAssetPrimaryForWinner[\s\S]*?\}\s*catch[\s\S]*?console\.warn[\s\S]*?不回滚 canvas/.test(routeSrc),
    "endpoint: syncAssetPrimaryForWinner wrapped in try/catch whose catch only warns (D-07 failure isolation)",
  );
  assert(
    routeSrc.indexOf("applied: false") < routeSrc.indexOf("broadcastToProject(projectId"),
    "endpoint: idempotent branch returns BEFORE any broadcast (code path order)",
  );
  assert(
    routeSrc.includes("[49-02] review bridge hook mounts here"),
    "endpoint: 49-02 bridge seam comment present",
  );
  assert(
    /import route167 from "\.\/routes\/canvas\/v2\/select-winner"/.test(routerSrc)
      && /app\.use\("\/api\/canvas\/v2\/variant-groups", route167\)/.test(routerSrc),
    "router.ts: select-winner mounted at /api/canvas/v2/variant-groups (route167)",
  );

  // Live dispatch in the spawned child (see the comment block above CHILD_SRC)
  const childRel = "scripts/.verify-phase-49-endpoint.tmp.ts";
  const childPath = path.join(REPO_ROOT, childRel);
  try {
    fs.writeFileSync(childPath, CHILD_SRC, "utf8");
    const spawned = spawnSync("npx", ["tsx", childRel], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: 120000,
      killSignal: "SIGKILL",
      env: process.env,
      maxBuffer: 16 * 1024 * 1024,
    });
    const childOut = `${spawned.stdout || ""}\n[stderr]\n${spawned.stderr || ""}`;
    let childDone = false;
    let childExit: string = spawned.error
      ? `spawn error: ${spawned.error.message}`
      : spawned.status === null
        ? `killed by signal ${spawned.signal ?? "?"} (timeout?)`
        : String(spawned.status);
    for (const line of childOut.split("\n")) {
      if (line.startsWith("CHILD_RESULT\t")) {
        const parts = line.split("\t");
        const pass = parts[1] === "1";
        const name = parts[2] ?? "";
        const detail = parts.slice(3).join("\t");
        assert(pass, name, detail || undefined);
      } else if (line.startsWith("CHILD_DONE\t")) {
        childDone = true;
        childExit = line.slice("CHILD_DONE\t".length);
      }
    }
    console.log(`  [endpoint-child] exit=${childExit}`);
    assert(
      childDone && childExit === "0",
      "endpoint: child dispatch completed cleanly (CHILD_DONE 0)",
      `exit=${childExit}`,
    );
    if (!childDone || childExit !== "0") {
      // surface the child's own diagnostics when it did not finish cleanly
      for (const line of childOut.split("\n")) {
        if (line && !line.startsWith("CHILD_RESULT\t") && !line.startsWith("CHILD_DONE\t")) {
          console.log(`    │ ${line}`);
        }
      }
    }
  } finally {
    try { fs.rmSync(childPath, { force: true }); } catch { /* best effort */ }
  }
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
