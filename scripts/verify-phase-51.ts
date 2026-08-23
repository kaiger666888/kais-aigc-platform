#!/usr/bin/env tsx
/**
 * verify-phase-51.ts — Phase 51 (Canonical Write Path + Coordination Guard)
 * aggregate contract gate: the single gate that folds every automated
 * verification of plans 51-01..51-04 plus COORD-01 into one run (GUARD
 * closing tradition, ROADMAP decision #7).
 *
 *   S1 WRITE-01 — save channel: canvasToFlowGraph 0 hits (source scope only,
 *     build artifacts under src/routes/canvas/static/** and data/web/**
 *     excluded per the 地雷 #5 discipline), v1 route gone, save-v2 wired in
 *     canvasApi, handleSave toast on failure, serialize.ts import-type-only
 *     (Phase 58 起: + 唯一一条 RECIPE_ROUNDTRIP_KEYS 纯常量运行时导入豁免)
 *     on @kais/flowgraph-v3, adapter error→failed normalization.
 *   S2 WRITE-02 — context-menu approve/delete: source-shape assertions on
 *     CanvasContextMenu.tsx + the "delete does not resurrect" REAL module
 *     integration assertion: construct a FlowGraphV2 → real saveFullGraph →
 *     real saveFullGraph (minus node X and its links, simulating a delete
 *     then save) → real loadFullGraph → X and its links are gone, every
 *     other node's data is byte-identical; plus an idempotency group
 *     (same graph saved twice → load shows no diff).
 *   S3 WRITE-03 — canonical writeback: MetaRenderer updateAssetMeta wiring
 *     (no flat data[field] overwrite left), FlowCanvas socket handlers call
 *     applySocketNodeState/applySocketNodePreview, canvasStore defines all
 *     three actions.
 *   S4 WRITE-04 — dead code & dependency: the 12 deleted files are gone,
 *     red-line live components (badges/NodeBadges, badges/ScoreMiniBar)
 *     still exist, the 4 legacy type names have 0 hits, and
 *     @kais/flowgraph-v3 is declared in packages/infinite-canvas
 *     dependencies.
 *   S5 COORD-01 — coordination spec exists with the 工作树干净 checklist
 *     clause, and ROADMAP.md references it.
 *   Forced-failure self-check — a set of must-fail assertions proving the
 *     gate can actually fail (50-02 precedent); an unexpected PASS here
 *     fails the whole run.
 *
 * Isolation guard (verify-phase-49 pattern, line-for-line): the S2
 * integration drives src/lib/canvasRelationalStore.saveFullGraph /
 * loadFullGraph, which bind the @/utils/db singleton — its import-time IIFE
 * resolves the sqlite file from process.cwd()/data. We mkdtemp + chdir into
 * a throwaway directory BEFORE the dynamic imports, so the boot creates an
 * isolated temp file database; the production database is never opened (its
 * filename appears nowhere in this file — grep gate per the verify-phase-50
 * convention). All grep sections read via absolute REPO_ROOT paths and are
 * unaffected by the chdir.
 *
 * No logic re-implementation: the integration section only calls the real
 * store functions; grep sections read files and match regular expressions.
 *
 * NOTE (e2e prerequisite, 51-02 deviation #4): the packages/infinite-canvas
 * e2e suite (npm run test:e2e) serves dist/, not source — always run
 * `npm run build` in packages/infinite-canvas before any e2e run. This gate
 * does not run e2e; it is documented here so the phase-51 verification
 * contract carries the prerequisite.
 *
 * Run: npm run verify:phase-51   (or: npx tsx scripts/verify-phase-51.ts)
 * Exit: 0 all sections pass + self-check behaves / 1 any failure / 2 crash
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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
function exists(rel: string): boolean {
  return fs.existsSync(path.join(REPO_ROOT, rel));
}

// ── Isolation chdir (see header) — MUST precede the dynamic imports ────────
const ISOLATION_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "verify-phase-51-"));
// Transitive module graph quirk: src/utils/writeVersion.ts parses package.json
// from process.cwd() at import time — stage a copy so the chdir stays safe.
fs.copyFileSync(path.join(REPO_ROOT, "package.json"), path.join(ISOLATION_DIR, "package.json"));
process.chdir(ISOLATION_DIR);

/**
 * Walk the live-source roots and return files containing `needle`.
 * Scope discipline (地雷 #5): only packages/infinite-canvas/src + src/, and
 * NEVER the build artifacts under src/routes/canvas/static/ or data/web/.
 */
function grepSource(needle: string | RegExp): string[] {
  const roots = [
    path.join(REPO_ROOT, "packages/infinite-canvas/src"),
    path.join(REPO_ROOT, "src"),
  ];
  const EXCLUDED_SEGMENTS = [
    `src${path.sep}routes${path.sep}canvas${path.sep}static${path.sep}`,
    `data${path.sep}web${path.sep}`,
  ];
  const SOURCE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".cts"]);
  const hits: string[] = [];
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === "dist") continue;
        walk(full);
      } else if (SOURCE_EXT.has(path.extname(e.name))) {
        const normalized = full + path.sep;
        if (EXCLUDED_SEGMENTS.some((seg) => normalized.includes(seg))) continue;
        const text = fs.readFileSync(full, "utf8");
        const hit = typeof needle === "string" ? text.includes(needle) : needle.test(text);
        if (hit) hits.push(path.relative(REPO_ROOT, full));
      }
    }
  };
  for (const r of roots) walk(r);
  return hits;
}

/** Extract a source region between two markers (empty string when absent). */
function region(src: string, startMarker: string, endMarker: string): string {
  const start = src.indexOf(startMarker);
  if (start < 0) return "";
  const end = src.indexOf(endMarker, start + startMarker.length);
  return end < 0 ? src.slice(start) : src.slice(start, end);
}

async function main(): Promise<void> {
  console.log("=== Phase 51 — verify-phase-51.ts (aggregate contract gate: WRITE-01..04 + COORD-01) ===\n");

  // ═══ S1 — WRITE-01: save channel ═══════════════════════════════════════
  console.log("=== S1 WRITE-01: save channel (serializeGraphToV2 → save-v2, v1 route gone) ===");
  const c2fHits = grepSource("canvasToFlowGraph");
  assert(
    c2fHits.length === 0,
    "S1: canvasToFlowGraph 0 hits in packages/infinite-canvas/src + src/ (static/ + data/web/ build artifacts excluded)",
    c2fHits.length > 0 ? `hits: ${c2fHits.join(", ")}` : undefined,
  );
  assert(!exists("src/routes/canvas/save.ts"), "S1: v1 route src/routes/canvas/save.ts deleted");
  assert(
    !read("src/router.ts").includes('routes/canvas/save"'),
    "S1: src/router.ts has no 'routes/canvas/save\"' import/mount",
  );
  assert(
    read("packages/infinite-canvas/src/services/canvasApi.ts").includes("'/canvas/v2/save-v2'"),
    "S1: canvasApi.saveCanvasGraph points at '/canvas/v2/save-v2'",
  );
  const flowCanvasSrc = read("packages/infinite-canvas/src/components/FlowCanvas.tsx");
  const handleSaveRegion = region(flowCanvasSrc, "const handleSave", "const handleAutoLayout");
  assert(
    handleSaveRegion.includes("serializeGraphToV2") && handleSaveRegion.includes("showToast"),
    "S1: FlowCanvas handleSave region serializes via serializeGraphToV2 and shows a toast on failure",
  );
  const serializeSrc = read("packages/infinite-canvas/src/v3/serialize.ts");
  assert(serializeSrc.length > 0, "S1: packages/infinite-canvas/src/v3/serialize.ts exists");
  const fgv3ImportLines = serializeSrc
    .split("\n")
    .filter((l) => l.includes("from '@kais/flowgraph-v3'") || l.includes('from "@kais/flowgraph-v3"'));
  // Phase 58：serialize.ts 引入唯一一条运行时常量导入（RECIPE_ROUNDTRIP_KEYS，
  // 纯常量 recipe.ts 零 import——tsx 直连链不受影响）；其余行仍须 import type。
  const runtimeImportLines = fgv3ImportLines.filter((l) => !/\bimport\s+type\b/.test(l));
  assert(
    fgv3ImportLines.length > 0 &&
      runtimeImportLines.length === 1 &&
      /\bimport\s*\{\s*RECIPE_ROUNDTRIP_KEYS\s*\}\s*from/.test(runtimeImportLines[0] ?? ""),
    "S1: @kais/flowgraph-v3 imports in serialize.ts are `import type` except exactly one runtime import of RECIPE_ROUNDTRIP_KEYS (Phase 58: runtime import allowed for pure-constant recipe.ts only)",
    `import lines: ${fgv3ImportLines.length}, runtime imports: ${runtimeImportLines.length}`,
  );
  assert(
    read("packages/infinite-canvas/src/v3/adapter.ts").includes("case 'error'"),
    "S1: adapter normalizeNodeState maps error → failed (failed nodes stay failed across save/reload)",
  );

  // ═══ S2 — WRITE-02: context-menu approve/delete ════════════════════════
  console.log("\n=== S2 WRITE-02: context-menu approve/delete (source-shape + delete-does-not-resurrect integration) ===");
  const menuSrc = read("packages/infinite-canvas/src/components/CanvasContextMenu.tsx");
  const canvasApiImportLine =
    menuSrc.split("\n").find((l) => l.includes("services/canvasApi")) ?? "";
  assert(
    canvasApiImportLine.length > 0 &&
      !canvasApiImportLine.includes("approveNode") &&
      !canvasApiImportLine.includes("rejectNode"),
    "S2: CanvasContextMenu canvasApi import carries no approveNode/rejectNode symbols (store actions own review writes)",
    canvasApiImportLine.trim(),
  );
  assert(
    /s\.deleteNode/.test(menuSrc) && menuSrc.includes("storeDeleteNode"),
    "S2: CanvasContextMenu consumes store.deleteNode via the store hook",
  );
  assert(
    menuSrc.includes("showDeletePrompt"),
    "S2: delete has an in-canvas confirmation state (showDeletePrompt)",
  );
  assert(
    !menuSrc.includes("confirm("),
    "S2: no browser-native confirm( anywhere in CanvasContextMenu.tsx",
  );

  // ── S2 integration: REAL saveFullGraph → saveFullGraph(minus X) → loadFullGraph ──
  // Import-order guard (verify-phase-49 pattern): root the module graph at the
  // @/utils barrel BEFORE anything that transitively imports @/utils/db.
  const utilsBarrel: any = await import("../src/utils");
  void utilsBarrel;
  const store: any = await import("../src/lib/canvasRelationalStore");
  const dbMod: any = await import("../src/utils/db");
  await Promise.race([
    dbMod.bootReady,
    new Promise((_, rej) => setTimeout(() => rej(new Error("bootReady timed out after 60s")), 60000)),
  ]);
  assert(
    typeof store.saveFullGraph === "function" && typeof store.loadFullGraph === "function",
    "S2: canvasRelationalStore exports saveFullGraph/loadFullGraph (real modules, zero re-implementation)",
  );

  const SCOPE = { projectId: 5151, episodesId: 1 };
  const mkNode = (id: string, x: number) => ({
    id,
    type: "asset",
    branchId: "main",
    phaseIndex: 0,
    phaseName: "",
    position: { x, y: 0 },
    size: { width: 260, height: 180 },
    data: { label: `label-${id}`, filePath: `/oss/fixture/${id}.png` },
    state: "idle",
  });
  const nodeA = mkNode("node-a", 0);
  const nodeB = mkNode("node-b", 300);
  const nodeX = mkNode("node-x", 600);
  const linkAB = { id: "link-ab", source: "node-a", target: "node-b", branchId: "main", dataType: "text" };
  const linkAX = { id: "link-ax", source: "node-a", target: "node-x", branchId: "main", dataType: "text" };
  const mkMeta = () => ({
    version: "2" as const,
    projectId: SCOPE.projectId,
    episodesId: SCOPE.episodesId,
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  });
  const graphWithX: any = {
    meta: mkMeta(),
    nodes: [nodeA, nodeB, nodeX],
    links: [linkAB, linkAX],
    branches: [],
    variantGroups: [],
  };
  const graphSansX: any = {
    meta: mkMeta(),
    nodes: [nodeA, nodeB],
    links: [linkAB],
    branches: [],
    variantGroups: [],
  };

  try {
    await store.saveFullGraph(SCOPE, graphWithX);
    // Simulate "delete node X in the canvas, then save" — save-v2 full-replace
    // semantics ARE the delete semantics (51-03: no dedicated delete endpoint).
    await store.saveFullGraph(SCOPE, graphSansX);
    const loaded: any = await store.loadFullGraph(SCOPE);
    assert(loaded !== null, "S2 integration: loadFullGraph returns a graph after two saves");
    const loadedIds = (loaded?.nodes ?? []).map((n: any) => n.id);
    assert(
      !loadedIds.includes("node-x"),
      "S2 integration: deleted node X does NOT resurrect after save → load",
      `loaded: ${loadedIds.join(",")}`,
    );
    const loadedLinkIds = (loaded?.links ?? []).map((l: any) => l.id);
    assert(
      !loadedLinkIds.includes("link-ax"),
      "S2 integration: the deleted node's link does NOT resurrect either",
      `loaded: ${loadedLinkIds.join(",")}`,
    );
    assert(
      loadedIds.includes("node-a") && loadedIds.includes("node-b") && loadedLinkIds.includes("link-ab"),
      "S2 integration: untouched nodes and their link survive the delete-save",
    );
    const loadedA = (loaded?.nodes ?? []).find((n: any) => n.id === "node-a");
    const loadedB = (loaded?.nodes ?? []).find((n: any) => n.id === "node-b");
    assert(
      JSON.stringify(loadedA?.data) === JSON.stringify(nodeA.data) &&
        JSON.stringify(loadedB?.data) === JSON.stringify(nodeB.data),
      "S2 integration: surviving nodes' data is byte-identical (no collateral mutation)",
      `a=${JSON.stringify(loadedA?.data)} b=${JSON.stringify(loadedB?.data)}`,
    );
    const loadedAB = (loaded?.links ?? []).find((l: any) => l.id === "link-ab");
    assert(
      loadedAB?.source === "node-a" && loadedAB?.target === "node-b" && loadedAB?.dataType === "text",
      "S2 integration: surviving link fields byte-identical",
    );

    // ── Idempotency: same graph saved twice → load shows no diff ──
    await store.saveFullGraph(SCOPE, graphSansX);
    const loaded2: any = await store.loadFullGraph(SCOPE);
    const strip = (g: any) =>
      JSON.stringify({
        nodes: g?.nodes ?? [],
        links: g?.links ?? [],
        variantGroups: g?.variantGroups ?? [],
      });
    assert(
      strip(loaded2) === strip(loaded),
      "S2 integration: idempotent re-save — second saveFullGraph of the same graph produces zero load diff",
    );
  } finally {
    try {
      await dbMod.db.destroy();
    } catch {
      // best effort; the process exits right after the summary
    }
  }

  // ═══ S3 — WRITE-03: canonical writeback ════════════════════════════════
  console.log("\n=== S3 WRITE-03: canonical writeback (MetaRenderer + socket + store actions) ===");
  const metaRendererSrc = read("packages/infinite-canvas/src/components/panel/MetaRenderer.tsx");
  assert(
    metaRendererSrc.includes("updateAssetMeta("),
    "S3: MetaRenderer writes via store.updateAssetMeta (canonical field-level patch)",
  );
  const setFieldRegion = region(metaRendererSrc, "const setField", "\n  }");
  assert(
    setFieldRegion.includes("updateAssetMeta") &&
      !/setNodes\s*\(/.test(setFieldRegion) &&
      !/data\s*\[\s*field\s*\]\s*=/.test(metaRendererSrc),
    "S3: MetadataEditor setField has no flat data[field] / setNodes derived-cache overwrite left",
  );
  assert(
    flowCanvasSrc.includes("applySocketNodeState(") && flowCanvasSrc.includes("applySocketNodePreview("),
    "S3: FlowCanvas socket handlers call applySocketNodeState( / applySocketNodePreview(",
  );
  const storeSrc = read("packages/infinite-canvas/src/store/canvasStore.ts");
  assert(
    /updateAssetMeta:\s*\(/.test(storeSrc) &&
      /applySocketNodeState:\s*\(/.test(storeSrc) &&
      /applySocketNodePreview:\s*\(/.test(storeSrc),
    "S3: canvasStore defines all three canonical writeback actions",
  );

  // ═══ S4 — WRITE-04: dead code & dependency ═════════════════════════════
  console.log("\n=== S4 WRITE-04: dead code removal + @kais/flowgraph-v3 dependency ===");
  const deadFiles = [
    "packages/infinite-canvas/src/components/nodes/ScriptNode.tsx",
    "packages/infinite-canvas/src/components/nodes/VideoNode.tsx",
    "packages/infinite-canvas/src/components/nodes/AudioNode.tsx",
    "packages/infinite-canvas/src/components/nodes/StoryboardNode.tsx",
    "packages/infinite-canvas/src/components/nodes/AssetNode.tsx",
    "packages/infinite-canvas/src/components/VariantGroupDetail.tsx",
    // Phase 58 注记：BranchPanel 已从 dead list 移除——Phase 55-06 (NAV-06) 将其重写为
    // 活组件（FlowCanvas.tsx 消费，commit 912eda85），51-04 的「已删除」事实随之过期。
    "packages/infinite-canvas/src/components/StructuredFieldPanel.tsx",
    "packages/infinite-canvas/src/components/ScoreBadge.tsx",
    "packages/infinite-canvas/src/components/VariantBadge.tsx",
    "packages/infinite-canvas/src/components/FeedbackBadge.tsx",
    "packages/infinite-canvas/src/utils/flowDataMapper.ts",
  ];
  for (const f of deadFiles) {
    assert(!exists(f), `S4: dead file gone — ${path.basename(f)}`);
  }
  assert(
    exists("packages/infinite-canvas/src/components/badges/NodeBadges.tsx") &&
      exists("packages/infinite-canvas/src/components/badges/ScoreMiniBar.tsx"),
    "S4: red-line live components badges/NodeBadges.tsx + badges/ScoreMiniBar.tsx still exist (C-layer, consumed by AssetCardNode)",
  );
  for (const legacyType of ["ScriptNodeData", "StoryboardNodeData", "VideoNodeData", "AudioNodeData"]) {
    const hits = grepSource(new RegExp(`\\b${legacyType}\\b`));
    assert(
      hits.length === 0,
      `S4: legacy type ${legacyType} 0 hits in live source`,
      hits.length > 0 ? `hits: ${hits.join(", ")}` : undefined,
    );
  }
  let fgv3Declared = false;
  try {
    const pkg = JSON.parse(read("packages/infinite-canvas/package.json"));
    fgv3Declared = typeof pkg?.dependencies?.["@kais/flowgraph-v3"] === "string";
  } catch {
    /* handled by the assertion below */
  }
  assert(
    fgv3Declared,
    "S4: packages/infinite-canvas package.json dependencies declare @kais/flowgraph-v3 (ghost dependency eliminated)",
  );

  // ═══ S5 — COORD-01: coordination spec ══════════════════════════════════
  console.log("\n=== S5 COORD-01: khs2 parallel-coordination spec + ROADMAP reference ===");
  const specRel = ".planning/specs/COORD-01-khs2-parallel-coordination.md";
  const specSrc = read(specRel);
  assert(specSrc.length > 0, "S5: .planning/specs/COORD-01-khs2-parallel-coordination.md exists");
  assert(
    specSrc.includes("工作树干净") && specSrc.includes("kais-hermes-skills"),
    "S5: COORD-01 spec carries the plan-kickoff checklist with the 工作树干净 (clean worktree) clause",
  );
  assert(
    read(".planning/ROADMAP.md").includes("COORD-01-khs2-parallel-coordination") ||
      read(".planning/milestones/v3.0-ROADMAP.md").includes("COORD-01-khs2-parallel-coordination"),
    "S5: ROADMAP.md (or its v3.0 milestone archive) architecture decision #4 references the COORD-01 spec (Phase 58 注记: v3.1 ROADMAP 重写后引用移至归档)",
  );

  // ═══ Forced-failure self-check — prove the gate can fail ═══════════════
  // (50-02 precedent: a gate that cannot fail proves nothing. These must-fail
  // assertions go through the SAME boolean evaluation path as assert(); their
  // FAIL output is marked SELF-CHECK, excluded from the pass totals, and an
  // unexpected PASS fails the whole run.)
  console.log("\n=== Forced-failure self-check (gate can actually fail — expected FAILs below) ===");
  const selfCheckShadow: TestResult[] = [];
  const shadowAssert = (cond: boolean, name: string): void => {
    selfCheckShadow.push({ name, pass: cond });
    console.log(
      `  SELF-CHECK ${cond ? "UNEXPECTED-PASS" : "expected-FAIL ok"}: ${name}`,
    );
  };
  shadowAssert(exists("src/routes/canvas/__definitely-not-a-real-file__.ts"), "self-check: a known-nonexistent file is reported missing");
  shadowAssert(grepSource("__definitely_not_a_real_identifier__").length > 0, "self-check: a nonsense identifier grep returns hits");
  shadowAssert(!specSrc.includes("工作树干净"), "self-check: inverted COORD-01 clause assertion fails");
  const shadowFailed = selfCheckShadow.filter((r) => !r.pass).length;
  const shadowWouldExitNonZero = shadowFailed > 0;
  const selfCheckOk =
    selfCheckShadow.length >= 3 &&
    selfCheckShadow.every((r) => !r.pass) &&
    shadowWouldExitNonZero;
  assert(
    selfCheckOk,
    "forced-failure self-check: every must-fail assertion failed as expected (gate fail-path is live)",
    `shadow: ${selfCheckShadow.length - shadowFailed}/${selfCheckShadow.length} unexpectedly passed`,
  );

  // ═══ Summary ═══════════════════════════════════════════════════════════
  const passed = results.filter((r) => r.pass).length;
  const total = results.length;
  const failed = total - passed;
  console.log(`\n=== Summary: ${passed}/${total} assertions passed, FAIL count = ${failed} (self-check excluded from totals) ===`);
  if (passed === total) {
    console.log("✅ Phase 51 verification PASSED (S1 save channel ✓ S2 approve/delete ✓ S3 canonical writeback ✓ S4 dead code/deps ✓ S5 COORD-01 ✓ + forced-failure self-check ✓)");
    cleanup();
    process.exit(0);
  } else {
    console.log("❌ Phase 51 verification FAILED");
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
  console.error("verify-phase-51.ts crashed:", err);
  cleanup();
  process.exit(2);
});
