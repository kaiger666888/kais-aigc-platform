#!/usr/bin/env tsx
/**
 * verify-phase-48.ts — Phase 48 (Ingest Candidate Grouping + Enum Unification
 * + workflow_phase) verification.
 *
 * Part 1 (Plan 48-01 — pure contract layer):
 *   - INGEST-03: assetTypes.ts truth source — normalizeAssetType /
 *     expandTypesForQuery behaviors + value-for-value registry enum parity
 *   - INGEST-01/02: candidateGrouping.ts — parseVariantName, planGroups both
 *     channels (manifest incl. selected-variant + partial batch + fallback;
 *     naming with/without canonical), manifest-priority, standalone passthrough
 *   - PHASE-01: deriveWorkflowPhase (never guesses — null when underivable)
 *
 * All assertions import the REAL modules from src/lib (dynamic import) and the
 * kmc-shape fixture from scripts/fixtures/ — no re-implemented copies.
 *
 * Run: npm run verify:phase-48
 */

import fs from "node:fs";
import path from "node:path";
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

  console.log("\n=== INGEST-03: CANONICAL_ASSET_TYPES = registry enum, value-for-value ===");
  const registrySrc = read("src/routes/v1/assets-registry/index.ts");
  const enumMatch = registrySrc.match(/type:\s*z\.enum\(\[([^\]]+)\]\)/);
  const registryValues = enumMatch
    ? enumMatch[1].split(",").map((s) => s.trim().replace(/["']/g, "")).filter(Boolean)
    : [];
  assert(registryValues.length === 11, `registry enum extracted (${registryValues.length} values)`, registryValues.join(","));
  assert(
    assetTypes.CANONICAL_ASSET_TYPES.length === 11,
    "CANONICAL_ASSET_TYPES has exactly 11 values",
    `actual: ${assetTypes.CANONICAL_ASSET_TYPES.length}`,
  );
  assert(
    JSON.stringify([...assetTypes.CANONICAL_ASSET_TYPES].sort()) === JSON.stringify([...registryValues].sort()),
    "CANONICAL_ASSET_TYPES set-equals the registry z.enum (no more, no less)",
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
  const trGroup = namingPlan.groups.find((g) => g.groupKey === "name:base_turnaround_chengyu");
  assert(!!trGroup, "groupKey name:base_turnaround_chengyu");
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
  const sceneGroup = namingPlan.groups.find((g) => g.groupKey === "name:scene_S07");
  assert(!!sceneGroup, "groupKey name:scene_S07");
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
  const inputCharGroup = inputCharPlan.groups.find((g) => g.groupKey === "name:base_turnaround_chengyu");
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

  // ─── Summary ────────────────────────────────────────────────────────────
  const passed = results.filter((r) => r.pass).length;
  const total = results.length;
  console.log(`\n=== Summary: ${passed}/${total} assertions passed ===`);
  if (passed === total) {
    console.log("✅ Phase 48 Part 1 verification PASSED");
    process.exit(0);
  } else {
    console.log("❌ Phase 48 Part 1 verification FAILED");
    process.exit(1);
  }

  // ────────────────────────────────────────────────────────────────────────
}

main().catch((err) => {
  console.error("verify-phase-48.ts crashed:", err);
  process.exit(2);
});

// ────────────────────────────────────────────────────────────────────────────
// Part 2 (Plan 48-02): ingest behavior on temp sqlite — route rewrite +
//   registry compat + o_assets group-shape writes (assetsId/isPrimaryView/
//   state='active'/workflow_phase) asserted against a throwaway DB.
//   Placeholder — Plan 48-02 extends this script below this line.
// ────────────────────────────────────────────────────────────────────────────
