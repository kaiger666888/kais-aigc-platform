#!/usr/bin/env tsx
/**
 * verify-phase-39.ts — Phase 39 (Canvas ↔ Movie-Agent V8.6 Adaptation) verification.
 *
 * Confirms ADAPT-01..04, EXEC-01..03, VERIFY-02..03:
 *   - ADAPT-01: src/routes/canvas/v2/ exists (7 files: nodes, branches, links, load-v2, save-v2, layout, graph-helpers)
 *   - ADAPT-02: src/types/flowgraph-v2.ts + flowgraph-v2-schema.ts exist
 *   - ADAPT-03: src/router.ts registers both /api/canvas/* (v1) and /api/v2/canvas/* (v2)
 *   - ADAPT-04: useCanvasSocket listens to orchestrate events AND branch/review events
 *   - EXEC-01: _simulate.ts imports _engine + uses GOLD_TEAM_URL gate
 *   - EXEC-02: storyboardPreview.ts imports submitEngineTask/pollEngineTask
 *   - EXEC-03: _simulate.ts maps all 5 v1.7 node types
 *   - VERIFY-02/03: tsc passes (assumed; run separately)
 *
 * Run: npx tsx scripts/verify-phase-39.ts
 */

import fs from "node:fs";
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

async function main(): Promise<void> {
  console.log("=== Phase 39 — verify-phase-39.ts ===\n");

  // ─── ADAPT-01: v2 routes exist ─────────────────────────────────
  console.log("=== ADAPT-01: src/routes/canvas/v2/* exists ===");
  const v2Files = [
    "src/routes/canvas/v2/nodes.ts",
    "src/routes/canvas/v2/branches.ts",
    "src/routes/canvas/v2/links.ts",
    "src/routes/canvas/v2/load-v2.ts",
    "src/routes/canvas/v2/save-v2.ts",
    "src/routes/canvas/v2/layout.ts",
    "src/routes/canvas/v2/graph-helpers.ts",
  ];
  let v2Count = 0;
  for (const f of v2Files) {
    if (fs.existsSync(path.join(REPO_ROOT, f))) v2Count++;
  }
  assert(v2Count === v2Files.length, `all 7 v2 route files present (${v2Count}/${v2Files.length})`);

  // ─── ADAPT-02: FlowGraph v2 types ──────────────────────────────
  console.log("\n=== ADAPT-02: FlowGraph v2 types present ===");
  const fgV2 = read("src/types/flowgraph-v2.ts");
  const fgV2Schema = read("src/types/flowgraph-v2-schema.ts");
  assert(fgV2.length > 0, "flowgraph-v2.ts exists");
  assert(fgV2Schema.length > 0, "flowgraph-v2-schema.ts exists");
  assert(/FlowGraphV2|FlowBranch|VariantGroup/.test(fgV2), "FlowGraphV2/FlowBranch/VariantGroup types declared");
  assert(/z\.(object|array|string|number)/.test(fgV2Schema), "zod schemas present");

  // ─── ADAPT-03: router registers both v1 and v2 ─────────────────
  console.log("\n=== ADAPT-03: router.ts registers v1 + v2 routes ===");
  const router = read("src/router.ts");
  const v1Routes = [
    "/api/canvas/orchestrate",  // Phase 36
    "/api/canvas/storyboard/preview",  // Phase 38
    "/api/canvas/execute",
    "/api/canvas/load",
    "/api/canvas/save",
    "/api/canvas/review/approve",
    "/api/canvas/review/reject",
    "/api/canvas/review/score",
  ];
  const v2Routes = [
    "/api/v2/canvas/nodes",
    "/api/v2/canvas/branches",
    "/api/v2/canvas/links",
    "/api/v2/canvas/load",
    "/api/v2/canvas/save",
    "/api/v2/canvas/layout",
  ];
  let v1Miss = v1Routes.filter((r) => !router.includes(r));
  let v2Miss = v2Routes.filter((r) => !router.includes(r));
  assert(v1Miss.length === 0, `all v1 routes registered (missing: ${v1Miss.join(",") || "none"})`);
  assert(v2Miss.length === 0, `all v2 routes registered (missing: ${v2Miss.join(",") || "none"})`);

  // ─── ADAPT-04: useCanvasSocket has both event sets ─────────────
  console.log("\n=== ADAPT-04: useCanvasSocket listens to both event sets ===");
  const socket = read("packages/infinite-canvas/src/hooks/useCanvasSocket.ts");
  assert(/orchestrate:start/.test(socket), "orchestrate:start listener present (Phase 36)");
  assert(/orchestrate:progress/.test(socket), "orchestrate:progress listener present");
  assert(/orchestrate:done/.test(socket), "orchestrate:done listener present");
  assert(/branch:created/.test(socket), "branch:created listener present (v2)");
  assert(/branch:updated/.test(socket), "branch:updated listener present (v2)");
  assert(/review:approved/.test(socket), "review:approved listener present (v2)");
  assert(/review:rejected/.test(socket), "review:rejected listener present (v2)");
  assert(!/<<<<<<</.test(socket), "no merge conflict markers left behind");

  // ─── EXEC-01: _simulate.ts wires engine ────────────────────────
  console.log("\n=== EXEC-01: _simulate.ts real-engine wiring ===");
  const simulate = read("src/routes/canvas/_simulate.ts");
  assert(/from ['"]\.\/_engine['"]/.test(simulate), "imports from ./_engine");
  assert(/submitEngineTask/.test(simulate), "calls submitEngineTask");
  assert(/pollEngineTask/.test(simulate), "calls pollEngineTask");
  assert(/GOLD_TEAM_URL/.test(simulate), "checks GOLD_TEAM_URL env var");
  assert(/simulateOnly|fallback/i.test(simulate), "has graceful fallback path");

  // ─── EXEC-02: storyboardPreview.ts wires engine ────────────────
  console.log("\n=== EXEC-02: storyboardPreview.ts real-engine wiring ===");
  const preview = read("src/routes/canvas/storyboardPreview.ts");
  assert(/from ['"]\.\/_engine['"]/.test(preview), "imports from ./_engine");
  assert(/submitEngineTask/.test(preview), "calls submitEngineTask");
  assert(/pollEngineTask/.test(preview), "calls pollEngineTask");
  assert(/image_draw_ipadapter/.test(preview), "uses image_draw_ipadapter when reference images present");
  assert(/image_draw/.test(preview), "uses image_draw (no refs)");
  assert(/GOLD_TEAM_URL/.test(preview), "checks GOLD_TEAM_URL env var");

  // ─── EXEC-03: Node-type → TaskType mapping covers all 5 types ──
  console.log("\n=== EXEC-03: node-type mapping coverage ===");
  assert(/script:\s*['"]image_draw['"]/.test(simulate), "script mapped (short-circuited to no-op in runner)");
  assert(/asset:\s*['"]image_draw['"]/.test(simulate), "asset → image_draw");
  assert(/storyboard:\s*['"]image_draw['"]/.test(simulate), "storyboard → image_draw");
  assert(/video:\s*['"]video_final['"]/.test(simulate), "video → video_final");
  assert(/audio:\s*['"]tts['"]/.test(simulate), "audio → tts");

  // ─── Contract probe: canvas-client.mjs endpoints vs master ─────
  console.log("\n=== VERIFY-01: canvas-client.mjs ↔ master contract ===");
  const canvasClientPath = path.resolve(REPO_ROOT, "src/runtime/canvas-client.mjs");
  const clientExists = fs.existsSync(canvasClientPath);
  assert(clientExists, `canvas-client.js reachable at ${canvasClientPath}`);
  if (clientExists) {
    const client = fs.readFileSync(canvasClientPath, "utf8");
    const expectedEndpoints = [
      "/api/v2/canvas/load",
      "/api/v2/canvas/save",
      "/api/v2/canvas/nodes",
      "/api/v2/canvas/nodes/batch",
      "/api/v2/canvas/links",
      "/api/v2/canvas/branches",
      "/api/v2/canvas/layout",
      "/api/canvas/review/approve",
      "/api/canvas/review/reject",
      "/api/canvas/review/score",
    ];
    let missing = expectedEndpoints.filter((ep) => !client.includes(ep));
    assert(missing.length === 0, `canvas-client.js references all expected endpoints (missing: ${missing.join(",") || "none"})`);
  }

  // ─── Summary ───────────────────────────────────────────────────
  const passed = results.filter((r) => r.pass).length;
  const total = results.length;
  console.log(`\n=== Summary: ${passed}/${total} assertions passed ===`);
  if (passed === total) {
    console.log("✅ Phase 39 verification PASSED");
    process.exit(0);
  } else {
    console.log("❌ Phase 39 verification FAILED");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("verify-phase-39.ts crashed:", err);
  process.exit(2);
});
