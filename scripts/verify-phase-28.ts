#!/usr/bin/env tsx
/**
 * verify-phase-28.ts — Phase 28 (Plan 01 + Plan 02) verification runner.
 *
 * Project convention (Pitfalls B3): no vitest/jest. This standalone `tsx`
 * script follows the v1.5 `scripts/verify-phase-23.ts` pattern:
 *   - import the test functions from src/skills/__tests__/contract.test
 *   - a local `assert()` helper pushes to a `results` array
 *   - a `main()` async function sums pass/fail and exits 1 on any failure
 *   - `main().catch(err => process.exit(2))` on uncaught exception
 *
 * Phase 28 Plan 02 success criteria:
 *   1. Field-equality drift test passes (spec ↔ zod agree field-for-field in
 *      both directions, required-flags match).
 *   2. Negative validator tests cover all five ruleIds (MANIFEST_REQUIRED_FIELD,
 *      MANIFEST_TYPE_MISMATCH, MANIFEST_VERSION_FORMAT, NODE_ID_NAMESPACING,
 *      MANIFEST_UNKNOWN_FIELD).
 *   3. Happy-path fixture returns ok:true.
 *
 * Usage:
 *   tsx scripts/verify-phase-28.ts
 *
 * Exit codes:
 *   0 — all assertions pass
 *   1 — one or more assertions failed (the structured failure detail is logged)
 *   2 — uncaught exception (test infrastructure bug)
 */

import { testFieldEqualityDrift, testNegativeInputs } from "../src/skills/__tests__/contract.test";

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

async function main(): Promise<void> {
  console.log("=== Phase 28 Plan 02 — verify-phase-28.ts ===");
  console.log("Running testFieldEqualityDrift()...");
  const driftSummary = await testFieldEqualityDrift();
  console.log(
    `  → drift test summary: ${driftSummary.passed} passed, ${driftSummary.failed} failed`,
  );

  console.log("\nRunning testNegativeInputs()...");
  const negSummary = await testNegativeInputs();
  console.log(
    `  → negative test summary: ${negSummary.passed} passed, ${negSummary.failed} failed`,
  );

  // Aggregate. Each test function returns a { passed, failed, failures[] }.
  // We surface each individual failure line as a top-level failing assertion
  // so the runner's exit-1 signal is unambiguous.
  const totalPassed = driftSummary.passed + negSummary.passed;
  const totalFailed = driftSummary.failed + negSummary.failed;

  assert(
    driftSummary.failed === 0,
    "drift test: zero failures (spec ↔ zod agree field-for-field)",
    driftSummary.failures.length > 0 ? driftSummary.failures.join("; ") : undefined,
  );

  assert(
    negSummary.failed === 0,
    "negative tests: zero failures (all 5 ruleIds + happy path)",
    negSummary.failures.length > 0 ? negSummary.failures.join("; ") : undefined,
  );

  assert(
    totalFailed === 0,
    "phase 28 plan 02 overall: no failures",
  );

  console.log(
    `\n=== SUMMARY: ${totalPassed} passed, ${totalFailed} failed (${results.filter((r) => !r.pass).length} gate assertions) ===`,
  );

  if (totalFailed > 0 || results.some((r) => !r.pass)) {
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error("verify-phase-28.ts: uncaught exception");
  console.error(err);
  process.exit(2);
});
