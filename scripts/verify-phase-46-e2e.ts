#!/usr/bin/env tsx
/**
 * verify-phase-46-e2e.ts — Phase 46 VERIFY-03 (env-gated docker E2E).
 *
 * Receiver-side end-to-end test:
 *   1. Drops a known p04 fixture manifest into a test project's OSS dir
 *   2. Triggers canvas_sync (via the sibling-repo Python subscriber)
 *   3. Polls GET /api/v2/canvas/nodes
 *   4. Asserts every fixture node appears in the canvas API with:
 *      - description.length >= 20 (Phase 42 MIN_DESCRIPTION_LEN)
 *      - At least one of {archetype, role, era} present (Phase 44 import
 *        stamping + Phase 45 UI rendering contract)
 *
 * Env-gated. The master `verify:phase-46-contracts` script does NOT set
 * this gate — operators must explicitly opt in.
 *
 * Run: PHASE46_RUN_E2E=1 npx tsx scripts/verify-phase-46-e2e.ts
 *
 * Env vars:
 *   PHASE46_RUN_E2E        — must be "1" to do anything (gate; default: unset = SKIP)
 *   KAIS_HERMES_SKILLS_PATH— sibling repo root (default: /data/workspace/kais-hermes-skills)
 *   PHASE46_API_PORT       — canvas API port (default: 3000)
 *   PHASE46_PROJECT_ID     — test project ID (default: 1)
 *   PHASE46_EPISODES_ID    — test episodes ID (default: 1)
 *   PHASE46_OSS_DIR        — fixture-drop parent dir
 *                             (default: <repo>/data/oss/e2e-test/p04)
 *   PHASE46_API_HOST       — canvas API host (default: localhost)
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

interface TestResult { name: string; pass: boolean; detail?: string; }
const results: TestResult[] = [];
function assert(cond: boolean, name: string, detail?: string): void {
  results.push({ name, pass: cond, detail });
  console.log(`  ${cond ? "PASS" : "FAIL"}: ${name}${detail ? " — " + detail : ""}`);
}

const REPO_ROOT = path.resolve(__dirname, "..");
const SIBLING_ROOT = process.env.KAIS_HERMES_SKILLS_PATH ?? "/data/workspace/kais-hermes-skills";
const FIXTURE_PATH = path.join(REPO_ROOT, "scripts/fixtures/p04-canvas-e2e-manifest.json");
const DEFAULT_OSS_DIR = path.join(REPO_ROOT, "data/oss/e2e-test/p04");
const OSS_DIR = process.env.PHASE46_OSS_DIR ?? DEFAULT_OSS_DIR;
const API_HOST = process.env.PHASE46_API_HOST ?? "localhost";
const API_PORT = process.env.PHASE46_API_PORT ?? "3000";
const PROJECT_ID = process.env.PHASE46_PROJECT_ID ?? "1";
const EPISODES_ID = process.env.PHASE46_EPISODES_ID ?? "1";
const MIN_DESCRIPTION_LEN = 20;
const REQUIRED_PARAM_KEYS = ["archetype", "role", "era"];

function skip(message: string): void {
  console.log(`\nSKIP: ${message}`);
  process.exit(0);
}

async function main(): Promise<void> {
  console.log("=== Phase 46 VERIFY-03 — verify-phase-46-e2e.ts ===\n");

  // Gate 1: env-var opt-in.
  if (process.env.PHASE46_RUN_E2E !== "1") {
    skip("PHASE46_RUN_E2E=1 not set (manual E2E only; master verify:phase-46-contracts does NOT trigger this).");
    return;
  }

  // Gate 2: fixture present.
  if (!fs.existsSync(FIXTURE_PATH)) {
    assert(false, "VERIFY-03: fixture present", FIXTURE_PATH);
    finish();
    return;
  }

  // Gate 3: docker available.
  const dockerInfo = spawnSync("docker", ["info"], { encoding: "utf-8" });
  if (dockerInfo.status !== 0) {
    console.log("\n⚠ CHECKPOINT: docker daemon not available.");
    console.log("  Start docker compose v9, then re-run with PHASE46_RUN_E2E=1.");
    console.log("    docker compose -f docker-compose.v9.yml up -d");
    process.exit(0);
  }

  // Gate 4: docker compose v9 services running.
  const composePs = spawnSync(
    "docker",
    ["compose", "-f", "docker-compose.v9.yml", "ps", "--format", "json"],
    { cwd: REPO_ROOT, encoding: "utf-8" },
  );
  if (composePs.status !== 0) {
    console.log("\n⚠ CHECKPOINT: docker compose v9 services not running.");
    console.log("  Start them, then re-run:");
    console.log("    docker compose -f docker-compose.v9.yml up -d");
    process.exit(0);
  }

  // Gate 5: sibling repo present.
  if (!fs.existsSync(SIBLING_ROOT)) {
    assert(false, "VERIFY-03: sibling repo present", `not found at ${SIBLING_ROOT}`);
    finish();
    return;
  }

  // Step 1: drop fixture.
  fs.mkdirSync(OSS_DIR, { recursive: true });
  const fixtureDest = path.join(OSS_DIR, "manifest.json");
  fs.copyFileSync(FIXTURE_PATH, fixtureDest);
  console.log(`  fixture dropped: ${fixtureDest}`);

  // Step 2: trigger canvas_sync. Try the canvas_sync CLI first; fall
  // back to a CHECKPOINT asking the operator to trigger manually.
  console.log(`  triggering canvas_sync via sibling repo: ${SIBLING_ROOT}`);
  const syncResult = spawnSync(
    "python3",
    ["-m", "plugins.kais_aigc.canvas_sync", "--project", PROJECT_ID, "--phase", "p04"],
    { cwd: SIBLING_ROOT, encoding: "utf-8", timeout: 30_000 },
  );
  if (syncResult.error || syncResult.status !== 0) {
    console.log("\n⚠ CHECKPOINT: canvas_sync CLI invocation failed or not implemented.");
    console.log("  Trigger canvas_sync manually, then re-run within 30s:");
    console.log(`    cwd: ${SIBLING_ROOT}`);
    console.log("    cmd: python3 -m plugins.kais_aigc.canvas_sync (or whatever the production trigger is)");
    if (syncResult.stderr) console.log(`  stderr: ${syncResult.stderr.slice(0, 200)}`);
    // Don't exit — try the API poll anyway in case the trigger happened
    // through some other mechanism (e.g. hermes-agent subscriber).
  }

  // Step 3: poll the canvas API for up to 30 seconds.
  const apiUrl = `http://${API_HOST}:${API_PORT}/api/v2/canvas/nodes?projectId=${PROJECT_ID}&episodesId=${EPISODES_ID}`;
  console.log(`  polling: ${apiUrl}`);
  type CanvasNode = { id?: string; type?: string; data?: Record<string, unknown> };
  let matched: CanvasNode[] = [];
  const pollDeadline = Date.now() + 30_000;
  while (Date.now() < pollDeadline) {
    try {
      const resp = await fetch(apiUrl);
      if (resp.ok) {
        const body = (await resp.json()) as { nodes?: CanvasNode[] } | CanvasNode[];
        const nodes: CanvasNode[] = Array.isArray(body) ? body : (body?.nodes ?? []);
        matched = nodes.filter((n) => {
          const id = String(n.id ?? "");
          return id.startsWith("p04/char-e2e-");
        });
        if (matched.length >= 3) break;
      }
    } catch {
      // network blip — retry
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  assert(matched.length === 3, `VERIFY-03: 3 fixture nodes appeared in canvas API`, `found: ${matched.length}`);

  for (const node of matched) {
    const id = String(node.id ?? "(no-id)");
    const data = node.data ?? {};
    const description = String(data.description ?? "");
    const descLen = description.trim().length;
    assert(
      descLen >= MIN_DESCRIPTION_LEN,
      `VERIFY-03: ${id} description ≥ ${MIN_DESCRIPTION_LEN} chars`,
      `actual: ${descLen}`,
    );

    const present = REQUIRED_PARAM_KEYS.filter((k) => {
      const v = data[k];
      return v != null && String(v).trim() !== "";
    });
    assert(
      present.length >= 1,
      `VERIFY-03: ${id} has ≥1 of {${REQUIRED_PARAM_KEYS.join(", ")}}`,
      present.length === 0 ? "all absent" : `present: ${present.join(", ")}`,
    );
  }

  // Cleanup on success.
  if (results.every((r) => r.pass)) {
    try {
      fs.unlinkSync(fixtureDest);
      console.log(`  cleanup: removed ${fixtureDest}`);
    } catch {
      // non-fatal
    }
  }

  finish();
}

function finish(): void {
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
