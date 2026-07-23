#!/usr/bin/env tsx
/**
 * verify-schema-roundtrip.ts — Phase 44 (Receiving-side Schema Strictness +
 * Import Validation) verification.
 * （脚本层重构：assert/结果收集/isScalar/fixture 发现/JSON 加载收敛至 lib/verify-harness.ts；
 *   fixture 发现由「sibling 优先二选一」统一为超集语义：in-repo scripts/fixtures/*.json
 *   全部 + sibling manifests/*.json 全部，覆盖面只增不减）
 *
 * Confirms SCHEMA-01..04:
 *   - SCHEMA-01: v2.0 field set declared in canvasAssetSchema.ts OR
 *                schema/generated/frontend-zod-extensions.ts (withYamlOptional
 *                merges from the latter into the former at runtime)
 *   - SCHEMA-02: import-from-dir.ts stamps __incomplete + __missing_fields
 *                with a [v2/import] warn when an incoming node lacks baseline
 *                expected params (node is still created — no silent drop)
 *   - SCHEMA-03: every scalar params.* key on a fixture manifest survives
 *                into the flattened node.data via the PRODUCTION flatten
 *                helper (imported directly from import-from-dir.ts — NOT a
 *                hand-mirrored copy; closes the replay-drift loophole)
 *   - SCHEMA-04: nodes.ts still wires validateNodeData and rejects batches
 *                with the 整批已拒绝 400 (contract intact — Phase 44's
 *                tightening is emergent from the schema expansion)
 *
 * Run: npx tsx scripts/verify-schema-roundtrip.ts
 */

import fs from "node:fs";
import path from "node:path";
import { flattenParamsToNodeData } from "../../src/routes/canvas/v2/import-from-dir";
import { createHarness, discoverFixtures, isScalar, loadJsonFile } from "./lib/verify-harness";

const { assert, summary } = createHarness();

const REPO_ROOT = path.resolve(__dirname, "..", "..");
function read(rel: string): string {
  const p = path.join(REPO_ROOT, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
}

async function main(): Promise<void> {
  console.log("=== Phase 44 — verify-schema-roundtrip.ts ===\n");

  // ─── SCHEMA-01: schema-declaration ────────────────────────────
  console.log("=== SCHEMA-01: v2.0 field set declared in schema ===");
  const canvasAssetContent = read("src/lib/canvasAssetSchema.ts");
  const zodExtContent = read("schema/generated/frontend-zod-extensions.ts");
  // v2.0 field set — names use the canvas_key form (what the receiver-side
  // actually declares). `role` is intentionally absent on the receiving
  // side: Python's `derive_archetype` transform collapses role → archetype
  // at manifest-write time, so `archetype` (already in the list) IS the
  // receiver-side form of `role` (44-01-PLAN.md Task 1 "Do NOT add role").
  // `murchGrade` is the camelCase canvas_key (the python_key `murch_grade`
  // is source-side only).
  const v2Fields = [
    "era", "genre", "tone", "total_duration_sec",
    "archetype", "murchGrade",
    "shot_type", "scene_id", "duration_sec", "engine", "resolution",
  ];
  for (const field of v2Fields) {
    // Match either `"field"` (quoted string literal — covers zod-extensions
    // values AND canvasAssetSchema quoted-object-key forms) OR `field:` /
    // `field :` (bare identifier as TypeScript object key — covers
    // declarations like `scene_id: z.string().optional()`).
    const pattern = new RegExp(`"${field}"|\\b${field}\\b\\s*:`);
    const declared = pattern.test(canvasAssetContent) || pattern.test(zodExtContent);
    assert(
      declared,
      `SCHEMA-01: field ${field} declared in canvasAssetSchema.ts or frontend-zod-extensions.ts`,
    );
  }

  // ─── SCHEMA-02: incomplete-stamping ───────────────────────────
  console.log("\n=== SCHEMA-02: import-from-dir.ts warn + stamp ===");
  const importContent = read("src/routes/canvas/v2/import-from-dir.ts");
  assert(
    importContent.includes("EXPECTED_PARAM_FIELDS_BY_TYPE"),
    "SCHEMA-02: EXPECTED_PARAM_FIELDS_BY_TYPE imported in import-from-dir.ts",
  );
  assert(
    importContent.includes("__incomplete"),
    "SCHEMA-02: __incomplete stamp present",
  );
  assert(
    importContent.includes("__missing_fields"),
    "SCHEMA-02: __missing_fields stamp present",
  );
  assert(
    importContent.includes("[v2/import]"),
    "SCHEMA-02: [v2/import] console.warn prefix present",
  );

  // ─── SCHEMA-03: params-roundtrip (exercises production helper) ─
  console.log("\n=== SCHEMA-03: scalar params.* round-trip via flattenParamsToNodeData ===");
  const SIBLING_FIXTURES = path.resolve(
    __dirname,
    "../../../kais-hermes-skills/skills/kais-movie-pipeline/tests/fixtures/manifests",
  );
  const INREPO_FIXTURES = path.resolve(__dirname, "fixtures");
  // 超集语义：两个来源全部纳入（目录不存在则跳过），label 区分来源。
  const fixtureDirs = [
    { path: INREPO_FIXTURES, label: "in-repo fixtures" },
    { path: SIBLING_FIXTURES, label: "cross-repo" },
  ];
  console.log(`  fixture dirs: ${fixtureDirs.map((d) => d.path).join(" , ")}`);

  const fixtures = discoverFixtures(fixtureDirs);
  assert(
    fixtures.length > 0,
    "SCHEMA-03: at least one fixture manifest available",
    `found ${fixtures.length}`,
  );

  let totalParamsKeys = 0;
  let nodesWithParams = 0;

  for (const { path: filePath, label } of fixtures) {
    const loaded = loadJsonFile(filePath);
    if (!loaded.ok) {
      assert(false, `SCHEMA-03: ${label} parses as JSON`, loaded.error);
      continue;
    }
    const manifest: any = loaded.value;

    const nodes: any[] = Array.isArray(manifest?.nodes) ? manifest.nodes : [];
    for (const node of nodes) {
      const params = node?.params;
      if (!params || typeof params !== "object" || Array.isArray(params)) continue;

      const scalarKeys = Object.keys(params).filter((k) => isScalar(params[k]) && params[k] != null);
      if (scalarKeys.length === 0) continue;
      nodesWithParams += 1;

      const flattened: Record<string, any> = {};
      if (node && typeof node === "object") {
        for (const [k, v] of Object.entries(node)) {
          if (isScalar(v) && v != null) flattened[k] = v;
        }
      }

      flattenParamsToNodeData(params, flattened);

      const missing = scalarKeys.filter((k) => !(k in flattened));
      const allPresent = missing.length === 0;
      assert(
        allPresent,
        `SCHEMA-03: ${label} node ${node.id ?? "(no-id)"}: ${scalarKeys.length}/${scalarKeys.length} scalar params.* keys round-trip via flattenParamsToNodeData`,
        allPresent ? undefined : `missing: ${missing.join(", ")}`,
      );
      totalParamsKeys += scalarKeys.length;
    }
  }

  assert(
    totalParamsKeys > 0,
    "SCHEMA-03: at least one scalar params.* key survives across all fixtures",
    `total surviving keys: ${totalParamsKeys}`,
  );
  assert(
    nodesWithParams > 0,
    "SCHEMA-03: at least one fixture node carries scalar params.* fields",
    `nodes with params: ${nodesWithParams}`,
  );

  // ─── SCHEMA-04: batch-rejection contract intact ───────────────
  console.log("\n=== SCHEMA-04: nodes.ts batch-rejection contract ===");
  const nodesContent = read("src/routes/canvas/v2/nodes.ts");
  assert(
    nodesContent.includes("validateNodeData(nodeInput.type"),
    "SCHEMA-04: nodes.ts wires validateNodeData against each node in batch",
  );
  assert(
    nodesContent.includes("整批已拒绝"),
    "SCHEMA-04: nodes.ts rejects whole batch with 整批已拒绝 on validation failure",
  );

  // ─── Summary ──────────────────────────────────────────────────
  summary();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
