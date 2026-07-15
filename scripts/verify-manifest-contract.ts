#!/usr/bin/env tsx
/**
 * verify-manifest-contract.ts — Phase 46 VERIFY-01.
 *
 * Spawns pytest cross-repo against Phase 42's source-side manifest
 * contract suite (132 tests across 3 files). Exits 0 when the suite
 * is green; non-zero on any test failure or environment problem.
 *
 * Run: npx tsx scripts/verify-manifest-contract.ts
 *
 * Env vars:
 *   KAIS_HERMES_SKILLS_PATH — sibling repo root
 *                            (default: /data/workspace/kais-hermes-skills)
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

const SIBLING_ROOT = process.env.KAIS_HERMES_SKILLS_PATH ?? "/data/workspace/kais-hermes-skills";
const TEST_FILES = [
  "skills/kais-movie-pipeline/tests/test_manifest_schema.py",
  "skills/kais-movie-pipeline/tests/test_manifest_phase_required.py",
  "skills/kais-movie-pipeline/tests/test_manifest_golden.py",
];

async function main(): Promise<void> {
  console.log("=== Phase 46 VERIFY-01 — verify-manifest-contract.ts ===\n");
  console.log(`  sibling repo: ${SIBLING_ROOT}`);

  // Gate 1: sibling repo exists.
  if (!fs.existsSync(SIBLING_ROOT) || !fs.statSync(SIBLING_ROOT).isDirectory()) {
    assert(false, "VERIFY-01: sibling repo present", `not found at ${SIBLING_ROOT}`);
    finish();
    return;
  }

  // Gate 2: every test file exists.
  const missingFiles = TEST_FILES.filter((rel) => !fs.existsSync(path.join(SIBLING_ROOT, rel)));
  if (missingFiles.length > 0) {
    assert(false, "VERIFY-01: Phase 42 test files present", `missing: ${missingFiles.join(", ")}`);
    finish();
    return;
  }

  // Gate 3: python3 on PATH.
  const pythonCheck = spawnSync("python3", ["--version"], { encoding: "utf-8" });
  if (pythonCheck.status !== 0) {
    assert(false, "VERIFY-01: python3 on PATH", pythonCheck.stderr || "python3 not found");
    finish();
    return;
  }

  // Run pytest against the 3 sibling-repo test files.
  const args = ["-m", "pytest", ...TEST_FILES, "--no-header", "-q"];
  const result = spawnSync("python3", args, {
    cwd: SIBLING_ROOT,
    encoding: "utf-8",
    timeout: 60_000,
  });

  const tail = (result.stdout || "").trimEnd().split("\n").slice(-20).join("\n");

  if (result.status === 0) {
    assert(true, "VERIFY-01: Phase 42 manifest contract suite (132 tests) passes", tail.split("\n").pop());
  } else {
    assert(false, "VERIFY-01: Phase 42 manifest contract suite (132 tests) passes", tail);
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
