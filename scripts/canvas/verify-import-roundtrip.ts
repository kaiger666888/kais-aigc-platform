#!/usr/bin/env tsx
/**
 * verify-import-roundtrip.ts — Phase 46 VERIFY-02.
 * （脚本层重构：assert/结果收集/isScalar/fixture 发现/JSON 加载收敛至 lib/verify-harness.ts；
 *   fixture 发现统一为超集语义：in-repo scripts/fixtures/*.json 全部
 *   + sibling manifests/*.json 全部，覆盖面只增不减）
 *
 * Loads fixture manifests, runs each node through the production
 * flattenParamsToNodeData helper, and asserts:
 *   - Every scalar params.* key round-trips into the flattened output
 *   - For content-bearing types (asset/script/storyboard/video), the
 *     description field is non-empty AND ≥20 chars (Phase 42 contract)
 *
 * Run: npx tsx scripts/verify-import-roundtrip.ts
 *
 * Env vars:
 *   KAIS_HERMES_SKILLS_PATH — sibling repo root (default: /data/workspace/kais-hermes-skills)
 *     When set AND the cross-repo fixtures exist, they're verified too.
 */

import path from "node:path";
import { flattenParamsToNodeData } from "../../src/routes/canvas/v2/import-from-dir";
import { createHarness, discoverFixtures, isScalar, loadJsonFile } from "./lib/verify-harness";

const { assert, summary } = createHarness();

const SIBLING_ROOT = process.env.KAIS_HERMES_SKILLS_PATH ?? "/data/workspace/kais-hermes-skills";
const MIN_DESCRIPTION_LEN = 20; // Phase 42 contract
const CONTENT_BEARING_TYPES = new Set(["asset", "script", "storyboard", "video"]);

interface NodeShape {
  id?: string;
  type?: string;
  label?: string;
  params?: Record<string, unknown>;
  description?: string;
  [k: string]: unknown;
}

interface ManifestShape {
  phase_id?: string;
  phase?: string;
  nodes?: NodeShape[];
}

async function main(): Promise<void> {
  console.log("=== Phase 46 VERIFY-02 — verify-import-roundtrip.ts ===\n");

  let totalNodes = 0;
  let contentBearingNodes = 0;

  const fixtures = discoverFixtures([
    // Always-include in-repo fixtures（全部 *.json）。
    { path: path.join(__dirname, "fixtures"), label: "in-repo fixtures" },
    // Cross-repo fixtures, when available（全部 *.json）。
    {
      path: path.join(SIBLING_ROOT, "skills/kais-movie-pipeline/tests/fixtures/manifests"),
      label: "cross-repo",
    },
  ]);

  for (const { path: fp, label } of fixtures) {
    const loaded = loadJsonFile(fp);
    if (!loaded.ok) {
      assert(false, `VERIFY-02: ${label} parses as JSON`, loaded.error);
      continue;
    }
    const manifest = loaded.value as ManifestShape;
    const nodes = Array.isArray(manifest.nodes) ? manifest.nodes : [];
    if (nodes.length === 0) continue;

    for (const node of nodes) {
      const params = node.params;
      if (!params || typeof params !== "object" || Array.isArray(params)) continue;

      const scalarKeys = Object.keys(params).filter((k) => isScalar(params[k]) && params[k] != null);
      if (scalarKeys.length === 0) continue;
      totalNodes += 1;

      const id = node.id ?? "(no-id)";
      const type = (node.type ?? "").toString();

      // Replay the production flatten logic against a fresh accumulator.
      const flattened: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node)) {
        if (k === "params") continue;
        if (isScalar(v) && v != null) flattened[k] = v;
      }
      flattenParamsToNodeData(params, flattened);

      // Assertion A: every scalar params.* key survives.
      const missing = scalarKeys.filter((k) => !(k in flattened));
      assert(
        missing.length === 0,
        `VERIFY-02: ${label} node ${id}: ${scalarKeys.length}/${scalarKeys.length} scalar params.* round-trip`,
        missing.length === 0 ? undefined : `missing: ${missing.join(", ")}`,
      );

      // Assertion B: content-bearing types have description ≥ 20 chars.
      if (CONTENT_BEARING_TYPES.has(type)) {
        contentBearingNodes += 1;
        const desc = (flattened.description as string | undefined) ?? "";
        const len = desc.trim().length;
        assert(
          len >= MIN_DESCRIPTION_LEN,
          `VERIFY-02: ${label} node ${id} (${type}): description ≥ ${MIN_DESCRIPTION_LEN} chars`,
          `actual: ${len} — "${desc.slice(0, 50)}${desc.length > 50 ? "..." : ""}"`,
        );
      }
    }
  }

  assert(totalNodes > 0, "VERIFY-02: at least one fixture node exercised", `nodes: ${totalNodes}`);
  assert(contentBearingNodes > 0, "VERIFY-02: at least one content-bearing node exercised", `nodes: ${contentBearingNodes}`);

  summary();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
