#!/usr/bin/env tsx
/**
 * verify-phase-50.ts — Phase 50 (Historical Backfill + Contract Guards)
 * verification: GUARD-01 contract group + GUARD-02 aggregate gate — the final
 * verify gate of the v2.0 → v2.1 milestone tradition.
 *
 * Section 1 — GUARD-01 contract group (D-07): the Phase 48 ingest grouping
 *   contract formalized permanently. Fixture batch → planGroups (plan level)
 *   → the REAL ingestImagesPayload on a temp :memory: sqlite → landed
 *   o_assets shape (exactly-one isPrimaryView per group, assetsId
 *   self-consistency, state domain, workflow_phase).
 * Section 2 — Backfill idempotency + D-05 red line (D-09 ②): seeded
 *   :memory: stock drives the REAL planBackfill/applyBackfill from
 *   scripts/backfill-candidate-groups.ts — apply → 0-diff re-plan →
 *   0-update re-apply, eliminated row byte-untouched, D-04 meta/meta
 *   .provenance phase priority, duplicate-path skip, pre-existing
 *   workflow_phase never rewritten (WR-02), archived-row state red line
 *   (WR-01: archived member groups with no state change; archived-primary
 *   family skipped whole + itemized).
 * Section 3 — Vocabulary no-drift (D-08/D-09 ③): assetTypes truth source
 *   consumed by identity (imports, never literal copies); legacy alias table
 *   has no orphans in either direction.
 * Section 4 — Phase 48/49 spot invariants (D-09 ④): existence + identifier
 *   checks ONLY — verify:phase-48/49 are never re-run from here.
 * Section 5 — SC-4 debt notice (D-11): exactly one WARN line, no assertion.
 *
 * All behavior comes from the REAL modules — nothing is re-implemented.
 * Every database in this file is ":memory:" only — the production database
 * file is never touched (and its filename appears nowhere in this file,
 * including comments; grep gate per the 48-02 convention). No app-server
 * code is imported; every knex pool is destroyed before exit.
 *
 * Run: npm run verify:phase-50
 */

import fs from "node:fs";
import path from "node:path";
import knex, { type Knex } from "knex";
// Truth-source imports — identity, never literal copies (Section 3).
import {
  CANONICAL_ASSET_TYPES,
  LEGACY_ASSET_TYPE_ALIASES,
  expandTypesForQuery,
} from "../src/lib/assetTypes";
// The real backfill core (50-01) — importing never self-executes (require.main guard).
import { planBackfill, applyBackfill } from "./backfill-candidate-groups";
import type { IngestImageInput, ManifestFrameEntry } from "../src/lib/candidateGrouping";

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

/** basename helper for expected-value comparisons (independent of the lib under test). */
function bn(p: string): string {
  return p.split("/").pop() || "";
}

/**
 * Fresh :memory: knex with the production o_assets/o_image DDL mirrored
 * column-for-column (src/lib/initDB.ts builders — identical to the
 * verify-phase-48 Part 2 mirror). NEVER a file-backed connection here.
 */
async function makeMemoryDb(): Promise<Knex> {
  const db = knex({
    client: "better-sqlite3",
    connection: { filename: ":memory:" }, // in-memory ONLY — production is never touched
    useNullAsDefault: true,
  });
  await db.schema.createTable("o_assets", (t) => {
    t.integer("id").notNullable();
    t.text("uuid");
    t.text("name");
    t.text("prompt");
    t.text("remark");
    t.text("type");
    t.text("describe");
    t.integer("scriptId");
    t.integer("imageId");
    t.integer("assetsId");
    t.integer("projectId");
    t.integer("flowId");
    t.integer("startTime");
    t.string("promptState");
    t.integer("audioBindState");
    t.text("characterId");
    t.string("viewAngle");
    t.boolean("isPrimaryView").defaultTo(false);
    t.string("model");
    t.text("tags");
    t.string("state").defaultTo("active");
    t.text("meta");
    t.integer("createdAt");
    t.string("createdBy");
    t.string("skill_id");
    t.string("workflow_phase");
    t.primary(["id"]);
  });
  await db.schema.createTable("o_image", (t) => {
    t.integer("id").notNullable();
    t.text("filePath");
    t.text("type");
    t.integer("assetsId");
    t.text("model");
    t.text("resolution");
    t.text("state");
    t.text("errorReason");
    t.primary(["id"]);
  });
  return db;
}

async function main(): Promise<void> {
  // Dynamic imports of the REAL modules under test (same convention as
  // verify-phase-48; src/lib contract modules, never app-server code).
  const grouping = await import("../src/lib/candidateGrouping");
  const ingest = await import("../src/lib/ingestAssets");

  // ═══ Section 1 — GUARD-01 contract group (D-07) ═════════════════════════
  console.log("=== Section 1: GUARD-01 contract group — fixture → planGroups → landed o_assets shape ===");

  // ── 1(a) Plan level ─────────────────────────────────────────────────────
  const fixtureRaw = read("scripts/fixtures/phase48-p11-manifest.fixture.json");
  let fixtureManifests: ManifestFrameEntry[] = [];
  try {
    fixtureManifests = JSON.parse(fixtureRaw);
  } catch { /* handled by the assertion below */ }
  assert(fixtureManifests.length === 2, "fixture parses as 2 ManifestFrameEntry rows");

  // 17-image batch, exactly the verify-phase-48 Part 2 shape: 10 manifest
  // frames (OSS-style paths preserving iframes_{shot} so the manifest
  // channel's dirBase matching resolves) + turnaround canonical+_v1..v3 +
  // scene pair + standalone.
  const PROJ = "/oss/1785508691757";
  const PROJ_ID = 1785508691757;
  const batch: IngestImageInput[] = [
    ...(["v1", "v2", "v3"] as const).map(
      (v) => ({ filePath: `${PROJ}/p11/iframes_S01_B01/first_frame_${v}.png`, assetName: `S01_B01 first ${v}`, assetType: "scene" }),
    ),
    ...(["v1", "v2", "v3"] as const).map(
      (v) => ({ filePath: `${PROJ}/p11/iframes_S01_B01/last_frame_${v}.png`, assetName: `S01_B01 last ${v}`, assetType: "scene" }),
    ),
    ...(["v1", "v2"] as const).map(
      (v) => ({ filePath: `${PROJ}/p11/iframes_S02_B01/first_frame_${v}.png`, assetName: `S02_B01 first ${v}`, assetType: "scene" }),
    ),
    ...(["v1", "v2"] as const).map(
      (v) => ({ filePath: `${PROJ}/p11/iframes_S02_B01/last_frame_${v}.png`, assetName: `S02_B01 last ${v}`, assetType: "scene" }),
    ),
    ...(["", "_v1", "_v2", "_v3"] as const).map(
      (s) => ({ filePath: `${PROJ}/p04/turnaround_sheets/base_turnaround_chengyu${s}.png`, assetName: `程屿 Turnaround${s || " canonical"}`, assetType: "role" }),
    ),
    { filePath: "/oss/manual/scene_S07_v1.png", assetName: "场景 S07 v1", assetType: "scene" },
    { filePath: "/oss/manual/scene_S07_v2.png", assetName: "场景 S07 v2", assetType: "scene" },
    { filePath: "/oss/manual/hero.png", assetName: "hero", assetType: "tool" },
  ];
  assert(batch.length === 17, "batch = 17 images (10 manifest frames + 4 turnaround + 2 scene pair + 1 standalone)", `actual: ${batch.length}`);

  const plan = grouping.planGroups(batch, fixtureManifests);
  assert(
    plan.groups.length === 6,
    "GUARD-01 plan level: 6 groups total (4 manifest + turnaround + scene pair)",
    `actual: ${plan.groups.length}`,
  );
  const planKeys = plan.groups.map((g) => g.groupKey);
  const manifestGroupKeys = ["shot:S01_B01:first", "shot:S01_B01:last", "shot:S02_B01:first", "shot:S02_B01:last"];
  assert(
    manifestGroupKeys.every((k) => planKeys.includes(k)),
    "the 4 manifest groupKeys (shot:S01_B01:first|last, shot:S02_B01:first|last) are present — subset of the 6",
    JSON.stringify(planKeys),
  );
  assert(
    planKeys.filter((k) => k.startsWith("shot:")).length === 4,
    "exactly 4 manifest-shot groups — the naming channel never re-claims a manifest member",
  );
  for (const g of plan.groups) {
    assert(
      !!g.primaryFilePath && g.memberFilePaths.includes(g.primaryFilePath),
      `${g.groupKey}: exactly one primaryFilePath and it is a group member`,
    );
  }
  const expectedPrimaryBn: Record<string, string> = {
    "shot:S01_B01:first": "first_frame_v2.png", // selected_first_variant=2
    "shot:S01_B01:last": "last_frame_v1.png",   // selected=null → first present
    "shot:S02_B01:first": "first_frame_v1.png", // selected=null → v1 fallback
    "shot:S02_B01:last": "last_frame_v2.png",   // selected_last_variant=2
    "name:turnaround_sheets/base_turnaround_chengyu": "base_turnaround_chengyu.png", // canonical
    "name:manual/scene_S07": "scene_S07_v1.png", // no canonical → lowest variant
  };
  for (const g of plan.groups) {
    assert(
      bn(g.primaryFilePath) === expectedPrimaryBn[g.groupKey],
      `${g.groupKey}: primary = ${expectedPrimaryBn[g.groupKey]}`,
      `actual: ${bn(g.primaryFilePath)}`,
    );
  }
  const expectedMembers: Record<string, number> = {
    "shot:S01_B01:first": 3,
    "shot:S01_B01:last": 3,
    "shot:S02_B01:first": 2,
    "shot:S02_B01:last": 2,
    "name:turnaround_sheets/base_turnaround_chengyu": 4,
    "name:manual/scene_S07": 2,
  };
  for (const g of plan.groups) {
    assert(
      g.memberFilePaths.length === expectedMembers[g.groupKey],
      `${g.groupKey}: ${expectedMembers[g.groupKey]} members`,
      `actual: ${g.memberFilePaths.length}`,
    );
  }
  assert(
    plan.ungroupedFilePaths.length === 1 && plan.ungroupedFilePaths[0] === "/oss/manual/hero.png",
    "only the standalone image stays ungrouped",
    JSON.stringify(plan.ungroupedFilePaths),
  );

  // ── 1(b) Landed shape via the REAL ingestImagesPayload ──────────────────
  const tempDb = await makeMemoryDb();
  try {
    const result = await ingest.ingestImagesPayload(tempDb, {
      projectId: PROJ_ID,
      phase: "p11",
      images: batch,
      manifests: fixtureManifests,
    });
    assert(result.count === 17, "landed: result.count = 17", `actual: ${result.count}`);
    assert(result.groups.length === 6, "landed: 6 groups", `actual: ${result.groups.length}`);
    const assetRows: any[] = await tempDb("o_assets");
    assert(assetRows.length === 17, "landed: o_assets has 17 rows", `actual: ${assetRows.length}`);

    for (const g of result.groups) {
      const rows: any[] = await tempDb("o_assets").whereIn("id", g.memberAssetIds);
      const primaries = rows.filter((r) => Number(r.isPrimaryView) === 1);
      assert(
        primaries.length === 1 && primaries[0]?.id === g.primaryAssetId,
        `${g.groupKey}: exactly one isPrimaryView=1 row and it IS the planned primary`,
        `actual primaries: [${primaries.map((r) => r.id).join(",")}]`,
      );
      const primary: any = primaries[0];
      assert(
        primary?.assetsId == null,
        `${g.groupKey}: primary row assetsId NULL`,
      );
      const members = rows.filter((r) => r.id !== g.primaryAssetId);
      assert(
        members.length > 0 && members.every((m) => m.assetsId === g.primaryAssetId),
        `${g.groupKey}: every member's assetsId = primary id (self-consistency, no orphans)`,
      );
      assert(
        members.every((m) => Number(m.isPrimaryView) !== 1),
        `${g.groupKey}: zero member rows carry isPrimaryView=1`,
      );
    }
    assert(
      assetRows.every((r) => r.state === "active"),
      "state domain: zero rows with state outside 'active'",
      [...new Set(assetRows.map((r) => r.state))].join(","),
    );
    const manifestRows: any[] = await tempDb("o_assets as a")
      .join("o_image as img", "a.imageId", "img.id")
      .where("img.filePath", "like", "%/iframes_%")
      .select("a.workflow_phase");
    assert(
      manifestRows.length === 10 && manifestRows.every((r) => r.workflow_phase === "p11"),
      "all 10 manifest rows workflow_phase='p11'",
    );
    assert(
      assetRows.filter((r) => Number(r.isPrimaryView) === 1).length === 6,
      "exactly 6 isPrimaryView=1 rows across the whole landed batch",
    );
  } finally {
    await tempDb.destroy();
  }

  // ═══ Section 2 — Backfill idempotency + D-05 red line (D-09 ②) ══════════
  console.log("\n=== Section 2: backfill idempotency + red line on seeded :memory: stock ===");
  interface SeedRow {
    id: number;
    filePath: string;
    state: string;
    isPrimaryView: number;
    assetsId: number | null;
    meta: string | null;
    /** WR-02: pre-existing workflow_phase value (omitted → seeded NULL). */
    workflowPhase?: string;
  }
  const seeds: SeedRow[] = [
    // p04 family: canonical + v1..v3, assetsId all NULL, isPrimaryView mixed 1/1/1/0
    { id: 1, filePath: "/oss/1/p04/sheets/hero.png", state: "active", isPrimaryView: 1, assetsId: null, meta: null },
    { id: 2, filePath: "/oss/1/p04/sheets/hero_v1.png", state: "active", isPrimaryView: 1, assetsId: null, meta: null },
    { id: 3, filePath: "/oss/1/p04/sheets/hero_v2.png", state: "active", isPrimaryView: 1, assetsId: null, meta: null },
    { id: 4, filePath: "/oss/1/p04/sheets/hero_v3.png", state: "active", isPrimaryView: 0, assetsId: null, meta: null },
    // p07 family: v1..v3 only (no canonical), all isPrimaryView=0
    { id: 5, filePath: "/oss/1/p07/sheets/env_v1.png", state: "active", isPrimaryView: 0, assetsId: null, meta: null },
    { id: 6, filePath: "/oss/1/p07/sheets/env_v2.png", state: "active", isPrimaryView: 0, assetsId: null, meta: null },
    { id: 7, filePath: "/oss/1/p07/sheets/env_v3.png", state: "active", isPrimaryView: 0, assetsId: null, meta: null },
    // (i) eliminated row whose filePath would join the p07 family — red line
    { id: 8, filePath: "/oss/1/p07/sheets/env_v4.png", state: "eliminated", isPrimaryView: 0, assetsId: null, meta: null },
    // (ii) D-04 meta-wins: meta.phase="p05_x" on a /p07/ path
    { id: 9, filePath: "/oss/1/p07/sheets/refboard.png", state: "active", isPrimaryView: 0, assetsId: null, meta: JSON.stringify({ phase: "p05_x" }) },
    // (ii-b) BL-1 nested provenance: meta.provenance.phase on a path-underivable file
    { id: 10, filePath: "/oss/pipeline/c267871b/S1_0000.wav", state: "active", isPrimaryView: 0, assetsId: null, meta: JSON.stringify({ provenance: { phase: "p10_voice" } }) },
    // (iii) no phase signal at all
    { id: 11, filePath: "/oss/manual/readme.png", state: "active", isPrimaryView: 0, assetsId: null, meta: null },
    // (iv) duplicate-path pair (CR-01 shape): two o_assets rows for one
    // physical file — deterministically skipped from grouping and reported
    { id: 12, filePath: "/oss/1/p09/boards/twin_ref.png", state: "active", isPrimaryView: 0, assetsId: null, meta: null },
    { id: 13, filePath: "/oss/1/p09/boards/twin_ref.png", state: "active", isPrimaryView: 0, assetsId: null, meta: null },
    // (v) WR-02: pre-existing workflow_phase the backfill would derive
    // DIFFERENTLY (/p08/ path → 'p08') — the invariant says NEVER rewrite it
    { id: 14, filePath: "/oss/1/p08/sheets/locked.png", state: "active", isPrimaryView: 0, assetsId: null, meta: null, workflowPhase: "p08_custom" },
    // (vi) WR-01/WR-02: archived member of the p07 v-only family — grouping
    // needs NO state change, so it joins (assetsId/isPrimaryView only) and
    // its state='archived' must survive applyBackfill untouched
    { id: 15, filePath: "/oss/1/p07/sheets/env_v4.png", state: "archived", isPrimaryView: 0, assetsId: null, meta: null },
    // (vii) WR-01: family whose planGroups-chosen primary (the canonical,
    // row 16) is archived — grouping WOULD need a state write, so the whole
    // group is skipped + itemized and neither row is grouped/linked
    { id: 16, filePath: "/oss/1/p06/sheets/board.png", state: "archived", isPrimaryView: 0, assetsId: null, meta: null },
    { id: 17, filePath: "/oss/1/p06/sheets/board_v1.png", state: "active", isPrimaryView: 0, assetsId: null, meta: null },
  ];
  const stockDb = await makeMemoryDb();
  try {
    for (const s of seeds) {
      await stockDb("o_image").insert({ id: 100 + s.id, filePath: s.filePath, type: "pipeline", assetsId: s.id, state: "active" });
      await stockDb("o_assets").insert({
        id: s.id,
        uuid: `seed-ast-${s.id}`,
        name: bn(s.filePath),
        type: "character",
        imageId: 100 + s.id,
        projectId: 1,
        assetsId: s.assetsId,
        isPrimaryView: s.isPrimaryView,
        state: s.state,
        meta: s.meta,
        workflow_phase: s.workflowPhase ?? null,
        createdAt: 1,
        createdBy: "seed",
      });
    }
    const eliminatedBefore: any = await stockDb("o_assets").where("id", 8).first();

    const plan1 = await planBackfill(stockDb, ":memory:");
    assert(plan1.totalRows === 17, "seeded stock: 17 o_assets rows counted first (D-06)", `actual: ${plan1.totalRows}`);
    assert(plan1.excludedEliminated === 1, "1 eliminated row excluded at SELECT level (D-05 — never planned)");
    assert(plan1.scanned === 16, "16 non-eliminated rows scanned", `actual: ${plan1.scanned}`);
    assert(
      plan1.groups.length === 2,
      "2 groups planned (p04 canonical family + p07 v-only family) — the p06 board family is NOT planned: its canonical primary is archived (WR-01 skip)",
      `actual: ${plan1.groups.length} — ${JSON.stringify(plan1.groups.map((g) => g.groupKey))}`,
    );
    assert(plan1.standaloneRows === 4, "4 standalone rows (refboard + wav + readme + locked)", `actual: ${plan1.standaloneRows}`);
    assert(plan1.diffs.length > 0, "planned diffs > 0 before apply");
    assert(plan1.diffs.length === 14, "14 diff rows planned (grouping 7 rows + wf-only 7 rows)", `actual: ${plan1.diffs.length}`);
    assert(
      plan1.diffs.filter((d) => d.assetsId !== undefined).length === 6,
      "6 member assetsId writes planned (3 hero + 2 env + 1 archived env member — its state column is NOT written)",
      `actual: ${plan1.diffs.filter((d) => d.assetsId !== undefined).length}`,
    );
    const heroGroup = plan1.groups.find((g) => g.groupKey === "name:sheets/hero");
    assert(
      !!heroGroup && heroGroup.primaryFlipsFrom.length === 2,
      "p04 group lists both 1→0 primary demotions (convergence decision recorded)",
      JSON.stringify(heroGroup?.primaryFlipsFrom ?? []),
    );
    assert(
      plan1.diffs.filter((d) => d.isPrimaryView === 1).length === 1,
      "1 promotion planned (p07 v1 → primary)",
    );
    assert(
      plan1.duplicatePathSkipped === 2 && plan1.duplicatePaths.length === 1,
      "duplicate-path pair skipped from grouping and reported",
      `skipped=${plan1.duplicatePathSkipped} paths=${JSON.stringify(plan1.duplicatePaths)}`,
    );
    assert(plan1.wfFromMeta === 2, "wf attribution: 2 values from meta (p05_x + nested p10_voice)", `actual: ${plan1.wfFromMeta}`);
    assert(plan1.wfFromPath === 12, "wf attribution: 12 values from path (incl. archived rows 15/16/17 — wf needs no state change)", `actual: ${plan1.wfFromPath}`);
    assert(plan1.wfUnderivable === 1, "wf attribution: 1 underivable row stays NULL", `actual: ${plan1.wfUnderivable}`);
    assert(plan1.wfAlreadySet === 1, "wf idempotency: row 14's pre-existing workflow_phase counted as already-set — NEVER rewritten", `actual: ${plan1.wfAlreadySet}`);
    assert(
      plan1.diffs.filter((d) => d.state !== undefined).length === 0,
      "WR-01: zero state writes planned — archived seeds (rows 15, 16) are never coerced to 'active'",
      `actual: ${plan1.diffs.filter((d) => d.state !== undefined).length}`,
    );
    assert(
      plan1.archivedPrimarySkips.length === 1 &&
        plan1.archivedPrimarySkips[0].includes("name:sheets/board") &&
        plan1.archivedPrimarySkips[0].includes("row 16"),
      "WR-01: the archived-primary board family is skipped whole and itemized",
      JSON.stringify(plan1.archivedPrimarySkips),
    );
    const envGroup = plan1.groups.find((g) => g.groupKey === "name:sheets/env");
    assert(
      !!envGroup && envGroup.primaryRowId === 5 && envGroup.memberRowIds.length === 4 && envGroup.memberRowIds.includes(15),
      "WR-01: archived member (row 15) still participates in its family grouping (active primary row 5, 4 members — no state change required)",
      JSON.stringify(envGroup?.memberRowIds ?? []),
    );
    const boardDiffs = plan1.diffs.filter((d) => d.id === 16 || d.id === 17);
    assert(
      boardDiffs.length === 2 &&
        boardDiffs.every((d) => d.assetsId === undefined && d.isPrimaryView === undefined && d.state === undefined),
      "WR-01: skipped board rows get workflow_phase targets ONLY — zero grouping/state columns planned",
      JSON.stringify(boardDiffs),
    );

    const { executedUpdates } = await applyBackfill(stockDb, plan1);
    assert(
      executedUpdates === plan1.diffs.length,
      `apply executed ALL planned diffs (${plan1.diffs.length})`,
      `actual: ${executedUpdates}`,
    );

    // SQL re-asserts — same landed-shape checks as Section 1(b)
    for (const g of plan1.groups) {
      const rows: any[] = await stockDb("o_assets").whereIn("id", g.memberRowIds);
      const primaries = rows.filter((r) => Number(r.isPrimaryView) === 1);
      assert(
        primaries.length === 1 && primaries[0]?.id === g.primaryRowId,
        `post-apply ${g.groupKey}: exactly one isPrimaryView=1 = planned primary`,
      );
      assert(
        rows.filter((r) => r.id !== g.primaryRowId).every((r) => r.assetsId === g.primaryRowId),
        `post-apply ${g.groupKey}: every member linked to the primary`,
      );
    }

    const plan2 = await planBackfill(stockDb, ":memory:");
    assert(plan2.diffs.length === 0, "idempotency: re-plan after apply → 0 diffs", `actual: ${plan2.diffs.length}`);
    const second = await applyBackfill(stockDb, plan2);
    assert(second.executedUpdates === 0, "idempotency: second apply → 0 executed updates", `actual: ${second.executedUpdates}`);

    const eliminatedAfter: any = await stockDb("o_assets").where("id", 8).first();
    assert(
      JSON.stringify(eliminatedAfter) === JSON.stringify(eliminatedBefore),
      "red line: the eliminated row is byte-untouched by plan + 2 applies",
    );
    const metaRow: any = await stockDb("o_assets").where("id", 9).first();
    assert(
      metaRow.workflow_phase === "p05",
      "D-04 priority: meta.phase='p05_x' beats /p07/ path → workflow_phase 'p05'",
      `actual: ${JSON.stringify(metaRow.workflow_phase)}`,
    );
    const nestedRow: any = await stockDb("o_assets").where("id", 10).first();
    assert(
      nestedRow.workflow_phase === "p10",
      "D-04 BL-1: nested meta.provenance.phase='p10_voice' on a path-underivable file → workflow_phase 'p10'",
      `actual: ${JSON.stringify(nestedRow.workflow_phase)}`,
    );
    const noSignalRow: any = await stockDb("o_assets").where("id", 11).first();
    assert(
      noSignalRow.workflow_phase == null,
      "no phase signal → workflow_phase stays NULL (never guessed)",
    );
    const dupRows: any[] = await stockDb("o_assets").whereIn("id", [12, 13]);
    assert(
      dupRows.every((r) => r.assetsId == null && Number(r.isPrimaryView) === 0),
      "duplicate-path rows still ungrouped after apply (grouping columns untouched)",
    );
    const lockedRow: any = await stockDb("o_assets").where("id", 14).first();
    assert(
      lockedRow.workflow_phase === "p08_custom",
      "wf idempotency: pre-existing workflow_phase 'p08_custom' NOT rewritten to the path-derived 'p08'",
      `actual: ${JSON.stringify(lockedRow.workflow_phase)}`,
    );
    const archivedMemberRow: any = await stockDb("o_assets").where("id", 15).first();
    assert(
      archivedMemberRow.state === "archived",
      "WR-01: archived family member keeps state='archived' after apply (never resurrected to 'active')",
      `actual: ${JSON.stringify(archivedMemberRow.state)}`,
    );
    assert(
      archivedMemberRow.assetsId === 5 && Number(archivedMemberRow.isPrimaryView) === 0 && archivedMemberRow.workflow_phase === "p07",
      "WR-01: archived member still grouped — assetsId → active primary 5, isPrimaryView 0, workflow_phase 'p07' (grouping with no state change)",
      `assetsId=${JSON.stringify(archivedMemberRow.assetsId)} isPrimaryView=${archivedMemberRow.isPrimaryView} wf=${JSON.stringify(archivedMemberRow.workflow_phase)}`,
    );
    const archivedPrimaryRow: any = await stockDb("o_assets").where("id", 16).first();
    assert(
      archivedPrimaryRow.state === "archived" && archivedPrimaryRow.assetsId == null && Number(archivedPrimaryRow.isPrimaryView) === 0,
      "WR-01: archived would-be primary (row 16) never promoted, never linked, state preserved",
      JSON.stringify({ state: archivedPrimaryRow.state, assetsId: archivedPrimaryRow.assetsId, isPrimaryView: archivedPrimaryRow.isPrimaryView }),
    );
    const boardSiblingRow: any = await stockDb("o_assets").where("id", 17).first();
    assert(
      boardSiblingRow.state === "active" && boardSiblingRow.assetsId == null && Number(boardSiblingRow.isPrimaryView) === 0,
      "WR-01: active sibling (row 17) NOT linked onto the archived primary — the group is skipped whole",
      JSON.stringify({ state: boardSiblingRow.state, assetsId: boardSiblingRow.assetsId, isPrimaryView: boardSiblingRow.isPrimaryView }),
    );
  } finally {
    await stockDb.destroy();
  }

  // ═══ Section 3 — Vocabulary no-drift (D-08/D-09 ③) ═════════════════════
  console.log("\n=== Section 3: vocabulary no-drift — truth source consumed by identity ===");
  const registrySrc = read("src/routes/v1/assets-registry/index.ts");
  assert(
    /from\s+"@\/lib\/assetTypes"/.test(registrySrc),
    "assets-registry imports the truth source (@/lib/assetTypes)",
  );
  assert(
    /type:\s*z\.enum\(CANONICAL_ASSET_TYPES\)/.test(registrySrc),
    "assets-registry type enum = z.enum(CANONICAL_ASSET_TYPES) — value-for-value by construction",
  );
  assert(
    !/type:\s*z\.enum\(\[\s*"/.test(registrySrc),
    "assets-registry inline type-enum literal is gone (delete-not-wrap)",
  );
  const ingestRouteSrc = read("src/routes/v1/pipeline/ingest/images.ts");
  assert(
    /from\s+"@\/lib\/assetTypes"/.test(ingestRouteSrc),
    "ingest route imports the truth source (@/lib/assetTypes)",
  );
  assert(
    !/z\.enum\(\[[^\]]*"(?:role|tool)"/.test(ingestRouteSrc),
    "ingest route: inline legacy role/tool enum literal is absent",
  );
  const canonical = CANONICAL_ASSET_TYPES as readonly string[];
  const aliasEntries = Object.entries(LEGACY_ASSET_TYPE_ALIASES);
  assert(aliasEntries.length >= 2, "legacy alias table non-empty (role/tool)", `actual: ${aliasEntries.length}`);
  for (const [alias, target] of aliasEntries) {
    assert(
      !canonical.includes(alias),
      `alias key '${alias}' is NOT a canonical value (no shadowing)`,
    );
    assert(
      canonical.includes(target),
      `alias target '${target}' IS canonical (no dangling target)`,
    );
    const expansion = expandTypesForQuery(target);
    assert(
      expansion.includes(target) && expansion.includes(alias),
      `expandTypesForQuery('${target}') covers both '${target}' and '${alias}' — no orphans in either direction`,
      JSON.stringify(expansion),
    );
  }

  // ═══ Section 4 — Phase 48/49 spot invariants (D-09 ④) ══════════════════
  console.log("\n=== Section 4: Phase 48/49 spot invariants (existence + identifiers only) ===");
  const spotFiles = [
    "src/routes/canvas/v2/select-winner.ts",
    "src/lib/canvasRelationalStore.ts",
    "src/lib/reviewBridge.ts",
    "src/lib/canvasAssetLinkage.ts",
    "src/lib/ingestAssets.ts",
    "src/lib/candidateGrouping.ts",
    "src/lib/assetTypes.ts",
  ];
  for (const f of spotFiles) {
    assert(fs.existsSync(path.join(REPO_ROOT, f)), `exists: ${f}`);
  }
  const selectWinnerSrc = read("src/routes/canvas/v2/select-winner.ts");
  assert(
    selectWinnerSrc.includes("void resolveOpenReviewForSelection("),
    "select-winner: fire-and-forget review resolution (void resolveOpenReviewForSelection()",
  );
  assert(
    selectWinnerSrc.includes("syncAssetPrimaryForWinner"),
    "select-winner: asset-center primary write-back (syncAssetPrimaryForWinner)",
  );
  assert(
    /export\s+(?:async\s+)?function\s+selectWinnerInGroup\b/.test(read("src/lib/canvasRelationalStore.ts")),
    "canvasRelationalStore exports selectWinnerInGroup",
  );
  assert(
    /export\s+(?:async\s+)?function\s+resolveOpenReviewForSelection\b/.test(read("src/lib/reviewBridge.ts")),
    "reviewBridge exports resolveOpenReviewForSelection",
  );
  assert(
    /export\s+(?:async\s+)?function\s+applyRegistrySelectionToCanvas\b/.test(read("src/lib/canvasAssetLinkage.ts")),
    "canvasAssetLinkage exports applyRegistrySelectionToCanvas",
  );

  // ═══ Section 5 — SC-4 consumer-side debt notice (D-11) ══════════════════
  console.log("\n=== Section 5: SC-4 debt notice (D-11 — warn only, no assertion) ===");
  console.log(
    "[WARN] SC-4 consumer-side half-loop debt: the kmc 30s poller still reads an un-normalized vocabulary — " +
      "cross-repo (kmc / review-platform) and out of scope for Phase 50; tracked as G-1 in " +
      ".planning/phases/49-*/49-HUMAN-UAT.md.",
  );

  // ═══ Summary ═════════════════════════════════════════════════════════════
  const passed = results.filter((r) => r.pass).length;
  const total = results.length;
  console.log(`\n=== Summary: ${passed}/${total} assertions passed ===`);
  if (passed === total) {
    console.log("✅ Phase 50 verification PASSED (GUARD-01 + GUARD-02 — v2.1 milestone gates green: 48 ✓ 49 ✓ 50 ✓)");
    process.exit(0);
  } else {
    console.log("❌ Phase 50 verification FAILED");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("verify-phase-50.ts crashed:", err);
  process.exit(2);
});
