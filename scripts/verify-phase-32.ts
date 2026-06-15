#!/usr/bin/env tsx
/**
 * verify-phase-32.ts — Phase 32 (Canvas Node Type Registry Integration)
 * verification runner.
 *
 * Project convention (Pitfalls B3): no vitest/jest. This standalone `tsx`
 * script follows the `scripts/verify-phase-30.ts` / `verify-phase-31.ts`
 * pattern (local `assert()` + `results[]` + `main()` + `process.exit`).
 *
 * Phase 32 success criteria (from ROADMAP + plans):
 *   1. (SC #1) movie-v1 manifest declares the same 5 node types as the canvas
 *      previously hardcoded (script / asset / storyboard / video / audio) —
 *      no visual regression.
 *   2. (SC #2) A skill manifest declaring a 6th node type with an existing
 *      `default_renderer` is structurally supported (the renderer map covers
 *      it; no repack needed).
 *   3. (SC #3) Unknown `default_renderer` values land in FallbackNode (the
 *      `default` entry of the canvas's `nodeTypes` map).
 *   4. (SC #4) Built-in renderers remain platform primitives — FlowCanvas.tsx
 *      comment block explicitly attributes them as platform primitives, not
 *      movie-v1 properties.
 *   5. (SC #5) `src/routes/canvas/projectData.ts` no longer references a
 *      hardcoded `NODE_TYPES` constant.
 *
 * Usage:
 *   tsx scripts/verify-phase-32.ts
 *
 * Exit codes:
 *   0 — all assertions pass (output contains "OK Phase 32 verified")
 *   1 — one or more assertions failed
 *   2 — uncaught exception
 */

import fs from "node:fs";
import path from "node:path";
import { registry } from "../src/skills/registry";
import { MOVIE_V1_MANIFEST } from "../src/skills/defaultSkill";

// Ensure movie-v1 is in the registry (production boot path handles this; we
// register directly here to keep the test hermetic).
if (!registry.get(MOVIE_V1_MANIFEST.skill_id)) {
  registry.register(MOVIE_V1_MANIFEST);
}

interface TestResult {
  name: string;
  pass: boolean;
  detail?: string;
}

const results: TestResult[] = [];

function assert(cond: boolean, name: string, detail?: string): void {
  results.push({ name, pass: cond, detail });
  console.log(`  ${cond ? "PASS" : "FAIL"}: ${name}${detail ? " — " + detail : ""}`);
}

const REPO_ROOT = path.resolve(__dirname, "..");
function readRel(rel: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
}

async function main(): Promise<void> {
  console.log("=== Phase 32 — verify-phase-32.ts ===\n");

  // -------------------------------------------------------------------------
  // Group A — movie-v1 manifest declares the 5 built-in renderers
  // -------------------------------------------------------------------------

  console.log("=== Group A: movie-v1 manifest node type coverage (SC #1, #4) ===");
  const movieNodeTypes = MOVIE_V1_MANIFEST.node_types;
  const movieRenderers = movieNodeTypes.map((nt) => nt.default_renderer).sort();
  const expectedBuiltIns = ["asset", "audio", "script", "storyboard", "video"];

  assert(
    movieNodeTypes.length === 5,
    "movie-v1 manifest declares exactly 5 node types",
    `got ${movieNodeTypes.length}: ${movieRenderers.join(",")}`,
  );

  assert(
    JSON.stringify(movieRenderers) === JSON.stringify(expectedBuiltIns),
    "movie-v1 declares the 5 built-in renderers (script/asset/storyboard/video/audio)",
    `manifest=[${movieRenderers.join(",")}] vs expected=[${expectedBuiltIns.join(",")}]`,
  );

  // Built-in renderers keyed by namespaced ID (CANVAS-02 — namespacing intact)
  for (const nt of movieNodeTypes) {
    assert(
      nt.type.startsWith("movie-v1::"),
      `node type '${nt.type}' is namespaced as movie-v1::<bare>`,
      `type=${nt.type}`,
    );
    assert(
      nt.default_renderer === nt.type.split("::")[1],
      `node type '${nt.type}' default_renderer matches bare name`,
      `default_renderer=${nt.default_renderer} vs bare=${nt.type.split("::")[1]}`,
    );
  }

  // -------------------------------------------------------------------------
  // Group B — registry lookup parity (runtime lookup matches manifest)
  // -------------------------------------------------------------------------

  console.log("\n=== Group B: registry.nodeTypeById parity ===");
  for (const nt of movieNodeTypes) {
    const looked = registry.nodeTypeById("movie-v1", nt.type);
    assert(
      looked !== undefined,
      `registry.nodeTypeById('movie-v1', '${nt.type}') returns a declaration`,
      looked === undefined ? "returned undefined" : "ok",
    );
    if (looked) {
      assert(
        looked.default_renderer === nt.default_renderer,
        `parity: '${nt.type}' default_renderer matches`,
        `manifest=${nt.default_renderer} vs registry=${looked.default_renderer}`,
      );
    }
  }

  // -------------------------------------------------------------------------
  // Group C — FallbackNode is wired as the `default` renderer (SC #3)
  // -------------------------------------------------------------------------

  console.log("\n=== Group C: FallbackNode wired as default renderer (SC #3) ===");
  const flowCanvasSrc = readRel("packages/infinite-canvas/src/components/FlowCanvas.tsx");
  assert(
    flowCanvasSrc.includes("import FallbackNodeComponent"),
    "FlowCanvas.tsx imports FallbackNodeComponent",
  );
  assert(
    /default:\s*FallbackNodeComponent/.test(flowCanvasSrc),
    "FlowCanvas.tsx registers FallbackNode as the `default` entry in nodeTypes map",
  );
  assert(
    fs.existsSync(
      path.join(REPO_ROOT, "packages/infinite-canvas/src/components/nodes/FallbackNode.tsx"),
    ),
    "FallbackNode.tsx exists at packages/infinite-canvas/src/components/nodes/",
  );

  // The 5 built-in renderers remain in the nodeTypes map (no regression)
  for (const r of expectedBuiltIns) {
    assert(
      new RegExp(`${r}:\\s*\\w+NodeComponent`).test(flowCanvasSrc),
      `FlowCanvas.tsx registers built-in renderer '${r}'`,
    );
  }

  // -------------------------------------------------------------------------
  // Group D — Built-in renderers attributed as platform primitives (SC #4)
  // -------------------------------------------------------------------------

  console.log("\n=== Group D: Built-in renderers attributed as platform primitives (SC #4) ===");
  assert(
    flowCanvasSrc.includes("PLATFORM PRIMITIVES") || flowCanvasSrc.includes("platform primitives"),
    "FlowCanvas.tsx comment block explicitly attributes renderers as platform primitives",
  );
  assert(
    !/movie-v1\s+properties|properties\s+of\s+movie-v1/i.test(flowCanvasSrc),
    "FlowCanvas.tsx does NOT attribute built-in renderers as movie-v1 properties",
  );

  // -------------------------------------------------------------------------
  // Group E — projectData.ts no longer hardcodes NODE_TYPES (SC #5)
  // -------------------------------------------------------------------------

  console.log("\n=== Group E: projectData.ts no longer hardcodes NODE_TYPES (SC #5) ===");
  const projectDataSrc = readRel("src/routes/canvas/projectData.ts");
  // Active usage patterns (const / export / value reference) — historical
  // mentions in JSDoc comments are allowed for documentation continuity.
  assert(
    !/(const|export\s+const|let|var)\s+NODE_TYPES\b/.test(projectDataSrc),
    "projectData.ts does NOT declare a NODE_TYPES constant",
  );
  assert(
    !/router\.get\(\s*['"]\/node-types['"]/.test(projectDataSrc),
    "projectData.ts does NOT expose a /node-types GET handler (Phase 30 endpoint owns this)",
  );
  assert(
    !/script.*asset.*storyboard.*video.*audio/s.test(projectDataSrc.replace(/\s+/g, "")),
    "projectData.ts does NOT contain the old hardcoded node type list",
  );

  // -------------------------------------------------------------------------
  // Group F — fetchSkillNodeTypes wired into the canvas API surface (SC #2 setup)
  // -------------------------------------------------------------------------

  console.log("\n=== Group F: canvas API surface for skill node types (SC #2 setup) ===");
  const canvasApiSrc = readRel("packages/infinite-canvas/src/services/canvasApi.ts");
  assert(
    canvasApiSrc.includes("export async function fetchSkillNodeTypes"),
    "canvasApi.ts exports fetchSkillNodeTypes",
  );
  assert(
    canvasApiSrc.includes("/v1/skills/") && canvasApiSrc.includes("/node-types"),
    "fetchSkillNodeTypes targets the /v1/skills/:skillId/node-types endpoint",
  );

  const canvasStoreSrc = readRel("packages/infinite-canvas/src/store/canvasStore.ts");
  assert(
    canvasStoreSrc.includes("declaredNodeTypes") && canvasStoreSrc.includes("setDeclaredNodeTypes"),
    "canvasStore exposes declaredNodeTypes + setter (Phase 32 metadata plumbing)",
  );
  assert(
    flowCanvasSrc.includes("fetchSkillNodeTypes(activeSkillId)"),
    "FlowCanvas.tsx pulls declared node types on mount",
  );

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------

  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n=== SUMMARY: ${passed} passed, ${failed} failed ===`);

  if (failed > 0) {
    console.error("\nFAILED ASSERTIONS:");
    for (const r of results) {
      if (!r.pass) {
        console.error(`  - ${r.name}${r.detail ? " — " + r.detail : ""}`);
      }
    }
    process.exit(1);
  }

  console.log("OK Phase 32 verified");
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error("verify-phase-32.ts: uncaught exception");
  console.error(err);
  process.exit(2);
});
