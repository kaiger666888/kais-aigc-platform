#!/usr/bin/env tsx
/**
 * verify-phase-48.ts — Phase 48 (Ingest Candidate Grouping + Enum Unification
 * + workflow_phase) verification.
 *
 * Part 1 (Plan 48-01 — pure contract layer):
 *   - INGEST-03: assetTypes.ts truth source — normalizeAssetType /
 *     expandTypesForQuery behaviors + registry enum consumes the truth source
 *   - INGEST-01/02: candidateGrouping.ts — parseVariantName, planGroups both
 *     channels (manifest incl. selected-variant + partial batch + fallback;
 *     naming with/without canonical), manifest-priority, standalone passthrough
 *   - PHASE-01: deriveWorkflowPhase (never guesses — null when underivable)
 *
 * Part 2 (Plan 48-02 — service behavior on a temp :memory: sqlite):
 *   - the REAL ingestImagesPayload writes grouped o_assets/o_image rows:
 *     assetsId=primary integer id, exactly-one-primary per group, state='active'
 *     everywhere, canonical type normalization, workflow_phase per D-08,
 *     manifest frame-prompt fallback, o_image back-pointer integrity
 *   - registry read-side compat: legacy type='role' row found via
 *     whereIn(expandTypesForQuery('character')); passthrough does not over-match
 *
 * All assertions import the REAL modules from src/lib (dynamic import) and the
 * kmc-shape fixture from scripts/fixtures/ — no re-implemented copies. The
 * temp DB is ":memory:" only — production db2.sqlite is never touched.
 *
 * Run: npm run verify:phase-48
 */

import fs from "node:fs";
import path from "node:path";
import knex from "knex";
// Type-only imports (erased at runtime — behaviors still come from the
// dynamic imports below, never from re-implemented copies).
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

async function main(): Promise<void> {
  console.log("=== Phase 48 — verify-phase-48.ts (Part 1) ===\n");

  // Dynamic import of the REAL modules under test
  const assetTypes = await import("../src/lib/assetTypes");
  const grouping = await import("../src/lib/candidateGrouping");

  // ─── INGEST-03: assetTypes truth source ────────────────────────────────
  console.log("=== INGEST-03: normalizeAssetType ===");
  assert(assetTypes.normalizeAssetType("role") === "character", 'normalizeAssetType("role") → "character"');
  assert(assetTypes.normalizeAssetType("tool") === "prop", 'normalizeAssetType("tool") → "prop"');
  assert(assetTypes.normalizeAssetType("scene") === "scene", 'normalizeAssetType("scene") → "scene" (canonical identity)');
  assert(assetTypes.normalizeAssetType("character") === "character", 'normalizeAssetType("character") → "character" (canonical identity)');
  assert(assetTypes.normalizeAssetType("keyframe") === null, 'normalizeAssetType("keyframe") → null (unknown)');
  assert(assetTypes.normalizeAssetType("") === null, 'normalizeAssetType("") → null');

  console.log("\n=== INGEST-03: expandTypesForQuery (legacy read-side compat) ===");
  assert(
    JSON.stringify(assetTypes.expandTypesForQuery("character")) === JSON.stringify(["character", "role"]),
    'expandTypesForQuery("character") → ["character","role"]',
  );
  assert(
    JSON.stringify(assetTypes.expandTypesForQuery("prop")) === JSON.stringify(["prop", "tool"]),
    'expandTypesForQuery("prop") → ["prop","tool"]',
  );
  assert(
    JSON.stringify(assetTypes.expandTypesForQuery("scene")) === JSON.stringify(["scene"]),
    'expandTypesForQuery("scene") → ["scene"] (no aliases)',
  );
  assert(
    JSON.stringify(assetTypes.expandTypesForQuery("delivery")) === JSON.stringify(["delivery"]),
    'expandTypesForQuery("delivery") → ["delivery"] (no aliases)',
  );
  assert(
    JSON.stringify(assetTypes.expandTypesForQuery("bogus")) === JSON.stringify(["bogus"]),
    'expandTypesForQuery("bogus") → ["bogus"] (passthrough, no crash)',
  );

  console.log("\n=== INGEST-03: registry enum consumes the truth source (Plan 48-02) ===");
  const registrySrc = read("src/routes/v1/assets-registry/index.ts");
  assert(
    /type:\s*z\.enum\(CANONICAL_ASSET_TYPES\)/.test(registrySrc),
    "registry createSchema type = z.enum(CANONICAL_ASSET_TYPES) — truth source imported (value-for-value by construction)",
  );
  assert(
    !/type:\s*z\.enum\(\[\s*"character"/.test(registrySrc),
    "registry inline 11-value enum literal is gone (delete-not-wrap)",
  );
  assert(
    assetTypes.CANONICAL_ASSET_TYPES.length === 11,
    "CANONICAL_ASSET_TYPES has exactly 11 values",
    `actual: ${assetTypes.CANONICAL_ASSET_TYPES.length}`,
  );
  assert(
    assetTypes.INGEST_INPUT_ASSET_TYPES.length === 13,
    "INGEST_INPUT_ASSET_TYPES = 11 canonical + 2 legacy aliases = 13",
    `actual: ${assetTypes.INGEST_INPUT_ASSET_TYPES.length}`,
  );
  assert(
    assetTypes.INGEST_INPUT_ASSET_TYPES.includes("role") && assetTypes.INGEST_INPUT_ASSET_TYPES.includes("tool"),
    "INGEST_INPUT_ASSET_TYPES accepts legacy words role/tool",
  );

  // ─── parseVariantName ──────────────────────────────────────────────────
  console.log("\n=== parseVariantName ===");
  const pv2 = grouping.parseVariantName("/oss/1/p04/turnaround_sheets/base_turnaround_chengyu_v2.png");
  assert(
    !!pv2 && pv2.base === "base_turnaround_chengyu" && pv2.variant === 2,
    "…_v2.png → { base: base_turnaround_chengyu, variant: 2 }",
    JSON.stringify(pv2),
  );
  assert(
    grouping.parseVariantName("/oss/1/p04/turnaround_sheets/base_turnaround_chengyu.png") === null,
    "canonical no-suffix file → null",
  );
  assert(
    grouping.parseVariantName("/oss/1/p04/turnaround_sheets/base_turnaround_guhongyuan.1.png") === null,
    "legacy oddity base_turnaround_guhongyuan.1.png → null (standalone)",
  );

  // ─── INGEST-01/02: manifest-channel grouping (kmc-shape fixture) ───────
  console.log("\n=== INGEST-01/02: planGroups manifest channel (fixture round-trip) ===");
  const fixtureRaw = read("scripts/fixtures/phase48-p11-manifest.fixture.json");
  let manifests: ManifestFrameEntry[] = [];
  try {
    manifests = JSON.parse(fixtureRaw);
  } catch { /* handled by assertion below */ }
  assert(manifests.length === 2, "fixture parses as JSON array of 2 ManifestFrameEntry-shaped objects");

  const PROJ = "/oss/1785508691757";
  const images: IngestImageInput[] = [
    ...(["v1", "v2", "v3"] as const).map(
      (v) => ({ filePath: `${PROJ}/p11/iframes_S01_B01/first_frame_${v}.png`, assetName: `S01_B01 first ${v}` }),
    ),
    ...(["v1", "v2", "v3"] as const).map(
      (v) => ({ filePath: `${PROJ}/p11/iframes_S01_B01/last_frame_${v}.png`, assetName: `S01_B01 last ${v}` }),
    ),
    ...(["v1", "v2"] as const).map(
      (v) => ({ filePath: `${PROJ}/p11/iframes_S02_B01/first_frame_${v}.png`, assetName: `S02_B01 first ${v}` }),
    ),
    ...(["v1", "v2"] as const).map(
      (v) => ({ filePath: `${PROJ}/p11/iframes_S02_B01/last_frame_${v}.png`, assetName: `S02_B01 last ${v}` }),
    ),
  ];
  const plan = grouping.planGroups(images, manifests);

  assert(plan.groups.length === 4, "exactly 4 manifest groups (2 shots × first/last)", `actual: ${plan.groups.length}`);
  const keys = plan.groups.map((g) => g.groupKey);
  assert(
    JSON.stringify(keys) === JSON.stringify([
      "shot:S01_B01:first", "shot:S01_B01:last", "shot:S02_B01:first", "shot:S02_B01:last",
    ]),
    "groupKeys exact + sorted: shot:S01_B01:first / :last / shot:S02_B01:first / :last",
    JSON.stringify(keys),
  );
  const expectedPrimaries: Record<string, { count: number; primary: string }> = {
    "shot:S01_B01:first": { count: 3, primary: "first_frame_v2.png" }, // selected_first_variant=2 → v2
    "shot:S01_B01:last": { count: 3, primary: "last_frame_v1.png" },   // selected_last_variant=null → fallback first present
    "shot:S02_B01:first": { count: 2, primary: "first_frame_v1.png" }, // selected_first_variant=null → fallback v1
    "shot:S02_B01:last": { count: 2, primary: "last_frame_v2.png" },   // selected_last_variant=2 → v2
  };
  for (const g of plan.groups) {
    const exp = expectedPrimaries[g.groupKey];
    assert(!!exp && g.memberFilePaths.length === exp?.count, `${g.groupKey}: ${exp?.count} members`, `actual: ${g.memberFilePaths.length}`);
    assert(
      !!exp && bn(g.primaryFilePath) === exp?.primary,
      `${g.groupKey}: primary = ${exp?.primary}`,
      `actual: ${bn(g.primaryFilePath)}`,
    );
    assert(g.source === "manifest", `${g.groupKey}: source=manifest`);
    assert(g.memberFilePaths.includes(g.primaryFilePath), `${g.groupKey}: primary is a member`);
  }
  assert(
    plan.groups.every((g) => !g.groupKey.startsWith("name:")),
    "priority: no naming group re-claims manifest members (all _v frames already claimed)",
  );
  assert(plan.ungroupedFilePaths.length === 0, "no ungrouped images in full manifest run");

  console.log("\n=== INGEST-01/02: manifest channel, partial batch ===");
  const partialImages = images.filter((img) => img.filePath !== `${PROJ}/p11/iframes_S01_B01/first_frame_v2.png`);
  const partialPlan = grouping.planGroups(partialImages, manifests);
  const partialFirst = partialPlan.groups.find((g) => g.groupKey === "shot:S01_B01:first");
  assert(!!partialFirst && partialFirst.memberFilePaths.length === 2, "S01 first group has 2 members when v2 absent");
  assert(
    !!partialFirst
      && bn(partialFirst.primaryFilePath) === "first_frame_v1.png"
      && partialFirst.memberFilePaths[0] !== undefined
      && bn(partialFirst.memberFilePaths[0]) === "first_frame_v1.png",
    "selected index points at absent path → primary = first present member in all_*_frames order (v1)",
    partialFirst ? bn(partialFirst.primaryFilePath) : "group missing",
  );

  // ─── INGEST-01/02: naming-channel grouping ─────────────────────────────
  console.log("\n=== INGEST-01/02: planGroups naming channel ===");
  const namingImages: IngestImageInput[] = [
    { filePath: `${PROJ}/p04/turnaround_sheets/base_turnaround_chengyu.png`, assetName: "程屿 灰底Turnaround" },
    { filePath: `${PROJ}/p04/turnaround_sheets/base_turnaround_chengyu_v1.png`, assetName: "程屿 灰底Turnaround v1" },
    { filePath: `${PROJ}/p04/turnaround_sheets/base_turnaround_chengyu_v2.png`, assetName: "程屿 灰底Turnaround v2" },
    { filePath: `${PROJ}/p04/turnaround_sheets/base_turnaround_chengyu_v3.png`, assetName: "程屿 灰底Turnaround v3" },
    { filePath: "/oss/manual/scene_S07_v1.png", assetName: "场景 S07 v1" },
    { filePath: "/oss/manual/scene_S07_v2.png", assetName: "场景 S07 v2" },
  ];
  const namingPlan = grouping.planGroups(namingImages);
  assert(namingPlan.groups.length === 2, "2 naming groups (turnaround family + scene family)", `actual: ${namingPlan.groups.length}`);
  const trGroup = namingPlan.groups.find((g) => g.groupKey === "name:turnaround_sheets/base_turnaround_chengyu");
  assert(!!trGroup, "groupKey name:turnaround_sheets/base_turnaround_chengyu (dir-aware, WR-03)");
  assert(
    !!trGroup && bn(trGroup.primaryFilePath) === "base_turnaround_chengyu.png",
    "canonical no-suffix file present → primary = canonical",
    trGroup ? bn(trGroup.primaryFilePath) : "group missing",
  );
  assert(
    !!trGroup && trGroup.memberFilePaths.length === 4,
    "turnaround group has 4 members (canonical + v1..v3)",
  );
  assert(
    !!trGroup && trGroup.characterId === "chengyu",
    "turnaround base → characterId extracted from trailing turnaround_([a-z0-9]+)",
    trGroup?.characterId,
  );
  assert(
    !!trGroup && trGroup.metaSubtype === "turnaround_sheet",
    "turnaround base → metaSubtype=turnaround_sheet (register_turnaround_b2.py shape)",
    trGroup?.metaSubtype,
  );
  const sceneGroup = namingPlan.groups.find((g) => g.groupKey === "name:manual/scene_S07");
  assert(!!sceneGroup, "groupKey name:manual/scene_S07 (dir-aware, WR-03)");
  assert(
    !!sceneGroup && bn(sceneGroup.primaryFilePath) === "scene_S07_v1.png",
    "no canonical → primary = lowest variant number (v1)",
    sceneGroup ? bn(sceneGroup.primaryFilePath) : "group missing",
  );
  assert(namingPlan.ungroupedFilePaths.length === 0, "all naming-channel images grouped");

  console.log("\n=== INGEST-01/02: naming channel — input characterId wins ===");
  const inputCharPlan = grouping.planGroups([
    { filePath: `${PROJ}/p04/turnaround_sheets/base_turnaround_chengyu_v1.png`, assetName: "v1", characterId: "custom-id" },
    { filePath: `${PROJ}/p04/turnaround_sheets/base_turnaround_chengyu_v2.png`, assetName: "v2" },
  ]);
  const inputCharGroup = inputCharPlan.groups.find((g) => g.groupKey === "name:turnaround_sheets/base_turnaround_chengyu");
  assert(
    !!inputCharGroup && inputCharGroup.characterId === "custom-id",
    "member input characterId wins over name-derived",
    inputCharGroup?.characterId,
  );

  // ─── D-03: manifest priority over naming channel ───────────────────────
  console.log("\n=== D-03 priority: manifest claims beat naming inference ===");
  const prioPlan = grouping.planGroups(
    [
      { filePath: `${PROJ}/p11/iframes_S09_B01/hero_v1.png`, assetName: "hero v1" },
      { filePath: `${PROJ}/p11/iframes_S09_B01/hero_v2.png`, assetName: "hero v2" },
    ],
    [{ shot_id: "S09_B01", all_first_frames: ["assets/P11/iframes_S09_B01/hero_v1.png", "assets/P11/iframes_S09_B01/hero_v2.png"], selected_first_variant: 1 }],
  );
  assert(prioPlan.groups.length === 1, "only 1 group for _v-named manifest members");
  assert(
    prioPlan.groups[0] !== undefined && prioPlan.groups[0].groupKey === "shot:S09_B01:first",
    "claimed by manifest group shot:S09_B01:first",
    prioPlan.groups[0]?.groupKey,
  );
  assert(
    prioPlan.groups.every((g) => !g.groupKey.startsWith("name:")),
    "no name:hero group — image never re-claimed by naming channel",
  );

  // ─── CR-02: duplicate shot_id (same side) across manifest entries ──────
  console.log("\n=== CR-02: duplicate shot_id manifests → planGroups throws ===");
  const cr02Images: IngestImageInput[] = [
    { filePath: `${PROJ}/p11/iframes_S1/f_v1.png`, assetName: "f1" },
    { filePath: `${PROJ}/p11/iframes_S1/f_v2.png`, assetName: "f2" },
    { filePath: `${PROJ}/p11/iframes_S2/g_v1.png`, assetName: "g1" },
    { filePath: `${PROJ}/p11/iframes_S2/g_v2.png`, assetName: "g2" },
  ];
  const cr02Manifests: ManifestFrameEntry[] = [
    { shot_id: "S1_B1", all_first_frames: ["assets/P11/iframes_S1/f_v1.png", "assets/P11/iframes_S1/f_v2.png"] },
    { shot_id: "S1_B1", all_first_frames: ["assets/P11/iframes_S2/g_v1.png", "assets/P11/iframes_S2/g_v2.png"] },
  ];
  let cr02PureThrew = false;
  let cr02PureMsg = "";
  try {
    grouping.planGroups(cr02Images, cr02Manifests);
  } catch (err: any) {
    cr02PureThrew = true;
    cr02PureMsg = String(err?.message ?? err);
  }
  assert(
    cr02PureThrew,
    "CR-02 regression: colliding groupKeys make planGroups throw (was: two silent groups with one key + cross-linked members)",
  );
  assert(
    cr02PureThrew && /groupKey/.test(cr02PureMsg) && /S1_B1/.test(cr02PureMsg),
    "CR-02 regression: error names the colliding groupKey",
    cr02PureMsg,
  );
  // No false positive: first+last of the SAME shot are two valid distinct groups
  const cr02SidesPlan = grouping.planGroups(cr02Images, [
    { shot_id: "S1_B1", all_first_frames: ["assets/P11/iframes_S1/f_v1.png"] },
    { shot_id: "S1_B1", all_last_frames: ["assets/P11/iframes_S2/g_v1.png"] },
  ]);
  const cr02SideKeys = cr02SidesPlan.groups.map((g) => g.groupKey);
  assert(
    cr02SideKeys.includes("shot:S1_B1:first") && cr02SideKeys.includes("shot:S1_B1:last"),
    "CR-02: same shot_id first+last sides still both plan (no false positive)",
    JSON.stringify(cr02SideKeys),
  );

  // ─── WR-01: non-string manifest entry at the selected index ────────────
  console.log("\n=== WR-01: non-string at selected index no longer crashes ===");
  const wr01List: any[] = ["assets/P11/iframes_S9_B1/first_frame_v1.png", 42];
  let wr01Plan: ReturnType<typeof grouping.planGroups> | null = null;
  let wr01Err = "";
  try {
    wr01Plan = grouping.planGroups(
      [{ filePath: `${PROJ}/p11/iframes_S9_B1/first_frame_v1.png`, assetName: "v1" }],
      [{ shot_id: "S9_B1", all_first_frames: wr01List, selected_first_variant: 2 }],
    );
  } catch (err: any) {
    wr01Err = String(err?.message ?? err);
  }
  assert(!!wr01Plan && wr01Err === "", "WR-01 regression: manifest [str, 42] + selected=2 does not throw", wr01Err);
  assert(
    !!wr01Plan
      && wr01Plan.groups.length === 1
      && wr01Plan.groups[0] !== undefined
      && bn(wr01Plan.groups[0].primaryFilePath) === "first_frame_v1.png",
    "WR-01: unresolved selected index falls back to first present member",
    wr01Plan ? bn(wr01Plan.groups[0]?.primaryFilePath ?? "") : "no plan",
  );

  // ─── WR-03: same stem in different directories never merges ────────────
  console.log("\n=== WR-03: dir-aware naming channel ===");
  const wr03Plan = grouping.planGroups([
    { filePath: "/oss/projA/p04/turnaround_sheets/hero_v1.png", assetName: "a1" },
    { filePath: "/oss/projA/p04/turnaround_sheets/hero_v2.png", assetName: "a2" },
    { filePath: "/oss/projB/p09/fanart/hero_v1.png", assetName: "b1" },
    { filePath: "/oss/projB/p09/fanart/hero_v2.png", assetName: "b2" },
  ]);
  assert(
    wr03Plan.groups.length === 2,
    "WR-03 regression: same stem in two dirs → 2 groups (was: 1 merged cross-dir group)",
    `actual: ${wr03Plan.groups.length}`,
  );
  assert(
    wr03Plan.groups.every((g) => g.memberFilePaths.length === 2),
    "WR-03: each dir-family keeps its own 2 members (no cross-family assetsId links)",
  );
  const wr03Keys = wr03Plan.groups.map((g) => g.groupKey).sort();
  assert(
    JSON.stringify(wr03Keys) === JSON.stringify(["name:fanart/hero", "name:turnaround_sheets/hero"]),
    "WR-03: naming groupKeys are parent-disambiguated",
    JSON.stringify(wr03Keys),
  );
  // Canonical only claims variants from its OWN directory (WR-03 minimal
  // requirement from the review): cross-dir variant forms its own group.
  const wr03Canon = grouping.planGroups([
    { filePath: "/oss/projA/sheets/hero.png", assetName: "canonical in A" },
    { filePath: "/oss/projA/sheets/hero_v1.png", assetName: "a1" },
    { filePath: "/oss/projB/other/hero_v2.png", assetName: "b2" },
  ]);
  const wr03CanonKeys = wr03Canon.groups.map((g) => g.groupKey).sort();
  assert(
    JSON.stringify(wr03CanonKeys) === JSON.stringify(["name:other/hero", "name:sheets/hero"]),
    "WR-03: canonical joins only same-directory variants",
    JSON.stringify(wr03CanonKeys),
  );

  // ─── WR-05: basename-fallback degradation surfaced, not silent ─────────
  console.log("\n=== WR-05: basename-fallback warnings ===");
  const wr05Plan = grouping.planGroups(
    [{ filePath: "/oss/x/flat/first_frame_v1.png", assetName: "f1" }],
    [
      { shot_id: "SA", all_first_frames: ["assets/P11/iframes_SA/first_frame_v1.png"] },
      { shot_id: "SB", all_first_frames: ["assets/P11/iframes_SB/first_frame_v1.png"] },
    ],
  );
  assert(
    wr05Plan.warnings.length >= 1,
    "WR-05 regression: skipped/stolen basename-fallback entries produce warnings (was: silent drop)",
    JSON.stringify(wr05Plan.warnings),
  );
  assert(
    wr05Plan.warnings.some((w) => w.includes("SB")),
    "WR-05: the skipped sibling entry (SB) is named in a warning",
  );
  assert(
    wr05Plan.groups.length === 1 && wr05Plan.groups[0]?.groupKey === "shot:SA:first",
    "WR-05: first entry still claims the shared basename (documented kmc behavior, now audible)",
  );
  // dirBase mode (dirs preserved) with a partially-absent batch must NOT warn —
  // absent frames are the normal partial-batch case, not degradation.
  const partialNoWarn = grouping.planGroups(
    [
      { filePath: `${PROJ}/p11/iframes_S01_B01/first_frame_v1.png`, assetName: "v1" },
      { filePath: `${PROJ}/p11/iframes_S01_B01/first_frame_v3.png`, assetName: "v3" },
    ],
    [
      {
        shot_id: "S01_B01",
        all_first_frames: [
          "assets/P11/iframes_S01_B01/first_frame_v1.png",
          "assets/P11/iframes_S01_B01/first_frame_v2.png",
          "assets/P11/iframes_S01_B01/first_frame_v3.png",
        ],
      },
    ],
  );
  assert(
    partialNoWarn.warnings.length === 0,
    "WR-05: dirBase-mode partial batch stays warning-free (absent frames are normal)",
    JSON.stringify(partialNoWarn.warnings),
  );

  // ─── Standalone passthrough (D-03: 维持现状, no error) ─────────────────
  console.log("\n=== standalone passthrough ===");
  const soloPlan = grouping.planGroups([{ filePath: "/oss/manual/hero.png", assetName: "hero" }]);
  assert(soloPlan.groups.length === 0, "no groups for a plain standalone image");
  assert(
    JSON.stringify(soloPlan.ungroupedFilePaths) === JSON.stringify(["/oss/manual/hero.png"]),
    "/oss/manual/hero.png listed in ungroupedFilePaths",
  );

  // ─── PHASE-01: deriveWorkflowPhase — never guesses ─────────────────────
  console.log("\n=== PHASE-01: deriveWorkflowPhase ===");
  assert(grouping.deriveWorkflowPhase("p11", "/oss/manual/hero.png") === "p11", '("p11", …) → "p11"');
  assert(grouping.deriveWorkflowPhase("P04", "/oss/manual/hero.png") === "p04", '("P04", …) → "p04" (case-insensitive, zero-padded)');
  assert(
    grouping.deriveWorkflowPhase("p04_turnaround", "/oss/manual/hero.png") === "p04",
    '("p04_turnaround", …) → "p04" (suffix after digits does not block match)',
  );
  assert(
    grouping.deriveWorkflowPhase(undefined, `${PROJ}/p04/turnaround_sheets/base_turnaround_chengyu_v1.png`) === "p04",
    "(undefined, /oss/{proj}/p04/…) → p04 from OSS path segment",
  );
  assert(
    grouping.deriveWorkflowPhase(undefined, "assets/P11/iframes_S01_B01/first_frame_v1.png") === "p11",
    "(undefined, assets/P11/…) → p11 from kmc-relative path segment",
  );
  assert(
    grouping.deriveWorkflowPhase("pipeline", "/oss/manual/hero.png") === null,
    '("pipeline", no p-segment path) → null (never guesses)',
  );
  assert(
    grouping.deriveWorkflowPhase("4", "/oss/manual/hero.png") === null,
    '("4", …) → null (no p prefix — never guesses)',
  );

  // ─── Part 2 (Plan 48-02): ingestImagesPayload on temp :memory: sqlite ──
  console.log("\n=== Part 2: ingestImagesPayload on temp :memory: sqlite ===");
  const ingest = await import("../src/lib/ingestAssets");
  const tempDb = knex({
    client: "better-sqlite3",
    connection: { filename: ":memory:" }, // NEVER data/db2.sqlite
    useNullAsDefault: true,
  });
  // Mirror the production DDL column-for-column (src/lib/initDB.ts o_assets /
  // o_image builders) — same column names/types, primary keys included.
  await tempDb.schema.createTable("o_assets", (t) => {
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
  await tempDb.schema.createTable("o_image", (t) => {
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

  try {
    // ── Fixture batch: manifest frames + turnaround + scene pair + standalone
    const PROJ_ID = 1785508691757;
    const batch: IngestImageInput[] = [
      // P11 manifest frames (both shots, both sides; assetType 'scene'; NO
      // prompts of their own → manifest frame prompts must fill in)
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
      // P04 turnaround set — canonical + v1..v3, legacy assetType 'role'
      ...(["", "_v1", "_v2", "_v3"] as const).map(
        (s) => ({ filePath: `${PROJ}/p04/turnaround_sheets/base_turnaround_chengyu${s}.png`, assetName: `程屿 Turnaround${s || " canonical"}`, assetType: "role" }),
      ),
      // Scene pair under /oss/manual/ — naming channel, no canonical
      { filePath: "/oss/manual/scene_S07_v1.png", assetName: "场景 S07 v1", assetType: "scene" },
      { filePath: "/oss/manual/scene_S07_v2.png", assetName: "场景 S07 v2", assetType: "scene" },
      // Standalone — legacy assetType 'tool'
      { filePath: "/oss/manual/hero.png", assetName: "hero", assetType: "tool" },
    ];
    // NOTE: no top-level `phase` — workflow_phase must derive from paths (D-08).
    const result = await ingest.ingestImagesPayload(tempDb, {
      projectId: PROJ_ID,
      images: batch,
      manifests,
    });

    // ── Result-level shape
    assert(result.count === 17, "result.count = 17 (total images)", `actual: ${result.count}`);
    assert(result.assets.length === 17, "result.assets.length = 17", `actual: ${result.assets.length}`);
    assert(result.groups.length === 6, "6 groups (4 manifest + turnaround + scene pair)", `actual: ${result.groups.length}`);
    assert(
      JSON.stringify(result.groups.map((g) => g.groupKey).sort()) === JSON.stringify([
        "name:turnaround_sheets/base_turnaround_chengyu", "name:manual/scene_S07",
        "shot:S01_B01:first", "shot:S01_B01:last",
        "shot:S02_B01:first", "shot:S02_B01:last",
      ].sort()),
      "groupKeys exact set: 2 naming + 4 manifest",
      JSON.stringify(result.groups.map((g) => g.groupKey)),
    );
    assert(
      result.groups.every((g) => g.memberAssetIds.includes(g.primaryAssetId)),
      "primaryAssetId is among memberAssetIds for every group",
    );
    assert(
      result.assets.filter((a) => a.isPrimary).length === 6,
      "exactly 6 result entries flagged isPrimary",
    );

    // ── DB row counts + o_image shape
    const assetRows: any[] = await tempDb("o_assets");
    const imageRows: any[] = await tempDb("o_image");
    assert(assetRows.length === 17, "o_assets has 17 rows", `actual: ${assetRows.length}`);
    assert(imageRows.length === 17, "o_image has 17 rows (one per image)", `actual: ${imageRows.length}`);
    assert(
      imageRows.every((r) => r.type === "pipeline"),
      "o_image.type = 'pipeline' when payload.phase absent",
    );
    assert(
      imageRows.every((ir) => assetRows.some((ar) => ar.id === ir.assetsId && ar.imageId === ir.id)),
      "o_image.assetsId = paired o_assets.id for every row (back-pointer, register_turnaround_b2.py shape)",
    );

    // ── Group shape on disk (INGEST-01/02, D-01/D-04)
    const primaries = assetRows.filter((r) => r.isPrimaryView === 1);
    assert(primaries.length === 6, "exactly 6 rows with isPrimaryView=1 (one per group)", `actual: ${primaries.length}`);
    assert(
      primaries.every((p) => p.assetsId == null),
      "every primary row has assetsId NULL",
    );
    const memberRows = assetRows.filter((r) => r.assetsId != null);
    assert(memberRows.length === 10, "10 non-primary member rows (17 - 6 primaries - 1 standalone)", `actual: ${memberRows.length}`);
    assert(
      memberRows.every((m) => m.isPrimaryView !== 1),
      "no non-primary member carries isPrimaryView=1",
    );
    const primaryIdSet = new Set(result.groups.map((g) => g.primaryAssetId));
    assert(
      memberRows.every((m) => primaryIdSet.has(m.assetsId)),
      "every member's assetsId is a group primary id from this batch (self-consistency, no orphans)",
    );
    const memberCountByPrimary = new Map<number, number>();
    for (const m of memberRows) {
      memberCountByPrimary.set(m.assetsId, (memberCountByPrimary.get(m.assetsId) ?? 0) + 1);
    }
    assert(
      result.groups.every((g) => (memberCountByPrimary.get(g.primaryAssetId) ?? 0) === g.memberAssetIds.length - 1),
      "per-group on-disk member count = plan members minus primary",
    );

    // ── state domain (D-05)
    assert(
      assetRows.every((r) => r.state === "active"),
      "all 17 rows state='active' (ingest never writes archived/eliminated)",
    );

    // ── Primary landing per group (D-04: selected_*_variant > canonical > v1)
    const expectedPrimaryByGroup: Record<string, string> = {
      "shot:S01_B01:first": "first_frame_v2.png", // selected_first_variant=2
      "shot:S01_B01:last": "last_frame_v1.png",   // selected=null → first present
      "shot:S02_B01:first": "first_frame_v1.png", // selected=null → v1
      "shot:S02_B01:last": "last_frame_v2.png",   // selected_last_variant=2
      "name:turnaround_sheets/base_turnaround_chengyu": "base_turnaround_chengyu.png", // canonical
      "name:manual/scene_S07": "scene_S07_v1.png", // no canonical → lowest variant
    };
    for (const g of result.groups) {
      const primaryAsset = await tempDb("o_assets").where("id", g.primaryAssetId).first();
      const primaryImg = await tempDb("o_image").where("id", primaryAsset.imageId).first();
      const expected = expectedPrimaryByGroup[g.groupKey];
      assert(
        bn(primaryImg.filePath) === expected,
        `${g.groupKey}: primary lands on ${expected}`,
        `actual: ${bn(primaryImg.filePath)}`,
      );
      assert(primaryAsset.isPrimaryView === 1, `${g.groupKey}: primary row isPrimaryView=1`);
      assert(primaryAsset.assetsId == null, `${g.groupKey}: primary row assetsId NULL`);
    }

    // ── Type normalization (INGEST-03, D-06)
    const trAssets: any[] = await tempDb("o_assets as a")
      .join("o_image as img", "a.imageId", "img.id")
      .where("img.filePath", "like", "%/turnaround_sheets/%")
      .select("a.*");
    assert(trAssets.length === 4, "4 turnaround rows", `actual: ${trAssets.length}`);
    assert(
      trAssets.every((r) => r.type === "character"),
      "input 'role' written as type='character'",
    );
    assert(
      trAssets.every((r) => r.characterId === "chengyu"),
      "turnaround rows characterId='chengyu'",
    );
    assert(
      trAssets.every((r) => {
        try { return JSON.parse(r.meta).subtype === "turnaround_sheet"; } catch { return false; }
      }),
      "turnaround rows meta JSON contains subtype='turnaround_sheet'",
    );
    const heroAsset: any = await tempDb("o_assets as a")
      .join("o_image as img", "a.imageId", "img.id")
      .where("img.filePath", "/oss/manual/hero.png")
      .first("a.*");
    assert(heroAsset.type === "prop", "input 'tool' written as type='prop'", `actual: ${heroAsset.type}`);
    assert(
      heroAsset.assetsId == null && heroAsset.isPrimaryView !== 1,
      "standalone: assetsId NULL, isPrimaryView=0",
    );
    assert(heroAsset.state === "active", "standalone state='active'");

    // ── workflow_phase (PHASE-01, D-08)
    const nullPhaseRows: any[] = await tempDb("o_assets").whereNull("workflow_phase");
    assert(
      nullPhaseRows.length === 3,
      "workflow_phase NULL = exactly the 3 underivable rows (scene pair + standalone)",
      `actual: ${nullPhaseRows.length}`,
    );
    const p11Rows: any[] = await tempDb("o_assets as a")
      .join("o_image as img", "a.imageId", "img.id")
      .where("img.filePath", "like", "%/p11/%")
      .select("a.workflow_phase");
    assert(
      p11Rows.length === 10 && p11Rows.every((r) => r.workflow_phase === "p11"),
      "10 frame rows workflow_phase='p11' (derived from /p11/ path segment)",
    );
    const p04Rows: any[] = await tempDb("o_assets as a")
      .join("o_image as img", "a.imageId", "img.id")
      .where("img.filePath", "like", "%/p04/%")
      .select("a.workflow_phase");
    assert(
      p04Rows.length === 4 && p04Rows.every((r) => r.workflow_phase === "p04"),
      "4 turnaround rows workflow_phase='p04'",
    );

    // ── Manifest frame-prompt fallback (kmc prompts are the richest source)
    const s01FirstRows: any[] = await tempDb("o_assets as a")
      .join("o_image as img", "a.imageId", "img.id")
      .where("img.filePath", "like", "%/iframes_S01_B01/first_frame_%")
      .select("a.prompt");
    const fixtureS01 = manifests[0];
    assert(
      !!fixtureS01
        && s01FirstRows.length === 3
        && s01FirstRows.every((r) => r.prompt === fixtureS01.first_frame_prompt),
      "member rows without own prompt take the manifest first_frame_prompt",
      JSON.stringify(s01FirstRows.map((r) => r.prompt)),
    );

    // ── Empty payload: no-op, no writes
    const countBeforeRow: any = await tempDb("o_assets").count("* as n").first();
    const countBefore = Number(countBeforeRow?.n ?? 0);
    const emptyResult = await ingest.ingestImagesPayload(tempDb, { projectId: PROJ_ID, images: [] });
    assert(
      JSON.stringify(emptyResult) === JSON.stringify({ count: 0, assets: [], groups: [] }),
      "empty images array → {count:0, assets:[], groups:[]}",
      JSON.stringify(emptyResult),
    );
    const countAfterRow: any = await tempDb("o_assets").count("* as n").first();
    const countAfter = Number(countAfterRow?.n ?? 0);
    assert(countBefore === countAfter, "empty payload writes nothing to DB");

    // ── Registry read-side compat (INGEST-03, D-07)
    await tempDb("o_assets").insert({
      id: 9999, uuid: "ast-legacy-role-row", name: "legacy role row", type: "role", state: "active",
    });
    const compatRows: any[] = await tempDb("o_assets").whereIn("type", assetTypes.expandTypesForQuery("character"));
    assert(
      compatRows.some((r) => r.id === 9999),
      "legacy type='role' row found by whereIn(expandTypesForQuery('character')) — /search compat",
    );
    const voiceRows: any[] = await tempDb("o_assets").whereIn("type", assetTypes.expandTypesForQuery("voice"));
    assert(
      !voiceRows.some((r) => r.id === 9999),
      "expansion passthrough: whereIn(expand('voice')) does NOT match the role row",
    );

    // ── CR-01 regression: duplicate filePath batch must be rejected, not
    //    silently corrupt (reviewer repro: [hero.png, hero_v1.png,
    //    hero_v1.png, hero.png] used to commit a second invisible primary).
    const cr01CountBefore = Number((await tempDb("o_assets").count("* as n").first() as any)?.n ?? 0);
    let cr01Threw = false;
    let cr01Msg = "";
    try {
      await ingest.ingestImagesPayload(tempDb, {
        projectId: PROJ_ID,
        images: [
          { filePath: "/oss/manual/hero.png", assetName: "hero", assetType: "character" },
          { filePath: "/oss/manual/hero_v1.png", assetName: "hero v1", assetType: "character" },
          { filePath: "/oss/manual/hero_v1.png", assetName: "hero v1 (dup)", assetType: "character" },
          { filePath: "/oss/manual/hero.png", assetName: "hero (dup)", assetType: "character" },
        ],
      });
    } catch (err: any) {
      cr01Threw = true;
      cr01Msg = String(err?.message ?? err);
    }
    assert(cr01Threw, "CR-01 regression: duplicate filePath batch throws (was: 200 OK + second primary row)");
    assert(
      cr01Threw && /filePath/.test(cr01Msg) && /重复/.test(cr01Msg),
      "CR-01 regression: error names the offending filePaths",
      cr01Msg,
    );
    const cr01CountAfter = Number((await tempDb("o_assets").count("* as n").first() as any)?.n ?? 0);
    assert(
      cr01CountBefore === cr01CountAfter,
      "CR-01 regression: rejected batch wrote 0 rows (17 batch + 1 compat row unchanged)",
      `before=${cr01CountBefore} after=${cr01CountAfter}`,
    );

    // ── CR-02 regression: duplicate shot_id manifest batch rolls back clean
    //    (reviewer repro: two S1_B1/first entries with disjoint frames used
    //    to commit group 1's members pointing at group 2's primary).
    let cr02Threw = false;
    let cr02Msg = "";
    try {
      await ingest.ingestImagesPayload(tempDb, {
        projectId: PROJ_ID,
        images: cr02Images.map((im) => ({ ...im, assetType: "scene" })),
        manifests: cr02Manifests,
      });
    } catch (err: any) {
      cr02Threw = true;
      cr02Msg = String(err?.message ?? err);
    }
    assert(
      cr02Threw,
      "CR-02 regression: duplicate shot_id manifest batch throws (was: 200 OK + cross-linked groups)",
    );
    assert(cr02Threw && /groupKey/.test(cr02Msg), "CR-02 regression: error names the colliding groupKey", cr02Msg);
    const cr02CountAfter = Number((await tempDb("o_assets").count("* as n").first() as any)?.n ?? 0);
    assert(
      cr02CountAfter === cr01CountAfter,
      "CR-02 regression: rejected batch wrote 0 rows (transaction rolled back)",
      `actual: ${cr02CountAfter}`,
    );

    // ── WR-02 regression: unknown assetType token never passed through raw
    //    (reviewer repro: assetType "keyframe" used to land verbatim in
    //    o_assets.type, invisible to expandTypesForQuery forever).
    const wr02Result = await ingest.ingestImagesPayload(tempDb, {
      projectId: PROJ_ID,
      images: [
        { filePath: "/oss/manual/wr02_keyframe.png", assetName: "wr02", assetType: "keyframe" },
      ],
    });
    assert(wr02Result.count === 1, "WR-02 regression: batch with unknown token still ingests (token → NULL)");
    const wr02Row: any = await tempDb("o_assets as a")
      .join("o_image as img", "a.imageId", "img.id")
      .where("img.filePath", "/oss/manual/wr02_keyframe.png")
      .first("a.*");
    assert(
      wr02Row.type === null,
      "WR-02 regression: unknown token 'keyframe' written as NULL (was: raw 'keyframe')",
      `actual: ${JSON.stringify(wr02Row.type)}`,
    );
  } finally {
    await tempDb.destroy();
  }

  // ─── Summary ────────────────────────────────────────────────────────────
  const passed = results.filter((r) => r.pass).length;
  const total = results.length;
  console.log(`\n=== Summary: ${passed}/${total} assertions passed (Part 1 + Part 2) ===`);
  if (passed === total) {
    console.log("✅ Phase 48 verification PASSED (Part 1 + Part 2)");
    process.exit(0);
  } else {
    console.log("❌ Phase 48 verification FAILED");
    process.exit(1);
  }

  // ────────────────────────────────────────────────────────────────────────
}

main().catch((err) => {
  console.error("verify-phase-48.ts crashed:", err);
  process.exit(2);
});
