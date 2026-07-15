#!/usr/bin/env tsx
/**
 * verify-phase-47-backfill.ts — Phase 47 archival + post-run verifier.
 *
 * Confirms:
 *   - The backfill script was MOVED to scripts/oneoffs/ (original path absent)
 *   - The archived script has a [DEPRECATED header
 *   - The one-off convention README exists
 *   - Phase 46 contract gate still passes (no regression from the backfill)
 *   - The pre-apply DB backup exists (audit trail)
 *
 * Run: npx tsx scripts/verify-phase-47-backfill.ts
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
function read(rel: string): string {
  const p = path.join(REPO_ROOT, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
}

async function main(): Promise<void> {
  console.log("=== Phase 47 — verify-phase-47-backfill.ts ===\n");

  // 1. Archived script exists at the new path.
  const archivedPath = "scripts/oneoffs/backfill-asset-descriptions.py";
  assert(
    fs.existsSync(path.join(REPO_ROOT, archivedPath)),
    "BACKFILL-03: backfill script archived at scripts/oneoffs/",
  );

  // 2. Original path is absent (move, not copy).
  const originalPath = "scripts/backfill-asset-descriptions.py";
  assert(
    !fs.existsSync(path.join(REPO_ROOT, originalPath)),
    "BACKFILL-03: original path scripts/backfill-asset-descriptions.py removed",
  );

  // 3. Deprecation header present in the archived script.
  const archivedContent = read(archivedPath);
  assert(
    archivedContent.startsWith("#!/usr/bin/env python3\n\"\"\"\n[DEPRECATED"),
    "BACKFILL-03: archived script has [DEPRECATED header",
  );

  // 4. README documents the one-off convention.
  const readme = read("scripts/oneoffs/README.md");
  assert(
    readme.includes("Audit trail") && readme.includes("DO NOT") && readme.includes("backfill-asset-descriptions.py"),
    "BACKFILL-03: scripts/oneoffs/README.md documents convention + current list",
  );

  // 5. Phase 46 contract gate still passes (no regression from backfill).
  const verify46 = spawnSync("npm", ["run", "verify:phase-46-contracts"], {
    cwd: REPO_ROOT,
    encoding: "utf-8",
    timeout: 30_000,
  });
  assert(
    verify46.status === 0,
    "BACKFILL-01 (regression): Phase 46 contract gate still green after backfill",
    verify46.status === 0 ? undefined : `exit ${verify46.status}`,
  );

  // 6. Pre-apply DB backup exists (audit trail).
  const backupExists = fs.existsSync(path.join(REPO_ROOT, "data/db2-backup-pre-phase-47.sqlite"));
  assert(
    backupExists,
    "BACKFILL-01 (audit): pre-apply DB backup retained at data/db2-backup-pre-phase-47.sqlite",
  );

  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
