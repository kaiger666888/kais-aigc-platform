#!/usr/bin/env tsx
/**
 * verify-import-roundtrip.ts — Phase 46 VERIFY-02.
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

import fs from "node:fs";
import path from "node:path";
import { flattenParamsToNodeData } from "../src/routes/canvas/v2/import-from-dir";

interface TestResult { name: string; pass: boolean; detail?: string; }
const results: TestResult[] = [];
function assert(cond: boolean, name: string, detail?: string): void {
  results.push({ name, pass: cond, detail });
  console.log(`  ${cond ? "PASS" : "FAIL"}: ${name}${detail ? " — " + detail : ""}`);
}

const REPO_ROOT = path.resolve(__dirname, "..");
const SIBLING_ROOT = process.env.KAIS_HERMES_SKILLS_PATH ?? "/data/workspace/kais-hermes-skills";
const MIN_DESCRIPTION_LEN = 20; // Phase 42 contract
const CONTENT_BEARING_TYPES = new Set(["asset", "script", "storyboard", "video"]);

function isScalar(v: unknown): boolean {
  return typeof v === "string" || typeof v === "number" || typeof v === "boolean";
}

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

function* fixtureFiles(): Generator<{ path: string; label: string }> {
  // Always-include in-repo fallback fixture.
  const inRepoFixture = path.join(REPO_ROOT, "scripts/fixtures/sample-manifest.json");
  if (fs.existsSync(inRepoFixture)) {
    yield { path: inRepoFixture, label: "in-repo fixtures/sample-manifest.json" };
  }
  // Cross-repo fixtures, when available.
  const crossRepoDir = path.join(SIBLING_ROOT, "skills/kais-movie-pipeline/tests/fixtures/manifests");
  if (fs.existsSync(crossRepoDir) && fs.statSync(crossRepoDir).isDirectory()) {
    for (const f of fs.readdirSync(crossRepoDir)) {
      if (f.endsWith(".json")) {
        yield { path: path.join(crossRepoDir, f), label: `cross-repo ${f}` };
      }
    }
  }
}

async function main(): Promise<void> {
  console.log("=== Phase 46 VERIFY-02 — verify-import-roundtrip.ts ===\n");

  let totalNodes = 0;
  let contentBearingNodes = 0;

  for (const { path: fp, label } of fixtureFiles()) {
    let manifest: ManifestShape;
    try {
      manifest = JSON.parse(fs.readFileSync(fp, "utf8"));
    } catch (err) {
      assert(false, `VERIFY-02: ${label} parses as JSON`, (err as Error).message);
      continue;
    }
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

  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
