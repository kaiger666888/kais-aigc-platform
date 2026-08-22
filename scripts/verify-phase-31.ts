#!/usr/bin/env tsx
/**
 * verify-phase-31.ts — Phase 31 equivalence regression guard.
 *
 * Project convention (Pitfalls B3): no vitest/jest. This standalone `tsx`
 * script follows the `scripts/verify-phase-30.ts` pattern:
 *   - a local `assert()` helper pushes to a `results` array
 *   - a `main()` async function sums pass/fail and exits 1 on any failure
 *   - `main().catch(err => process.exit(2))` on uncaught exception
 *
 * Phase 31 deleted the hardcoded constants `REVIEW_REQUIRED_PHASES`,
 * `PHASE_INGEST_MAP`, and `PHASE_ORDER` from the pipeline callback layer.
 * The callbacks now consult `registry.phaseById(skill_id, phase)` and
 * `MOVIE_V1_MANIFEST.phase_taxonomy` instead. This script asserts the new
 * registry-driven path produces IDENTICAL values to the old constants for
 * movie-v1 — the regression guard for PIPELINE-05 and the assertion half
 * of PIPELINE-02.
 *
 * Assertion groups:
 *   A. MOVIE_V1_MANIFEST.phase_taxonomy shape — SUPERSEDED by verify:phase-57
 *      T1-T4 (2026-08-22): Phase 57-07 realigned the taxonomy from the legacy
 *      12 ids to the 22-phase registry khsPrefix vocabulary. The OLD_* equality
 *      assertions no longer hold BY DESIGN (D-16 direct switch, no adapter).
 *   B. Per-phase equivalence vs OLD_ snapshots — SUPERSEDED (same as A).
 *   C. Registry lookup parity: registry.phaseById("movie-v1", id) returns the manifest's PhaseDecl
 *   D. Negative spot-checks: old invalid enum IDs (image/video/audio/compose) return undefined
 *
 * The OLD_* snapshots below are preserved verbatim as the pre-31 historical
 * document (CONTEXT.md "Deprecation Marker Style"). The live taxonomy drift
 * contract is scripts/verify-phase-57.ts.
 *
 * The OLD_ snapshots ARE the deprecation marker (per CONTEXT.md "Deprecation
 * Marker Style"): they document what the constants were before deletion.
 *
 * IMPORTANT SIDE-EFFECT NOTE:
 * Importing defaultSkill.ts transitively reaches `@/utils` → `@/utils/db.ts`,
 * whose module body runs an IIFE that initializes db2.sqlite + runs migrations
 * + seeds movie-v1 via seedDefaultIfEmpty. This means movie-v1 IS already in
 * the registry cache by the time main() runs. We rely on this — no explicit
 * seed call is needed. The Knex connection holds the event loop open, so the
 * script MUST `process.exit(0)` at the end (never fall off the bottom).
 *
 * Usage:
 *   tsx scripts/verify-phase-31.ts
 *
 * Exit codes:
 *   0 — all assertions pass (output contains "OK Phase 31 equivalence verified")
 *   1 — one or more assertions failed (structured detail logged)
 *   2 — uncaught exception (test infrastructure bug)
 */

import { registry } from "../src/skills/registry";
import { MOVIE_V1_MANIFEST } from "../src/skills/defaultSkill";
import type { IngestOutput } from "../src/skills/contract";

// ---------------------------------------------------------------------------
// Pre-refactor snapshots — DO NOT EDIT.
// These document what the constants REVIEW_REQUIRED_PHASES, PHASE_INGEST_MAP,
// and PHASE_ORDER were before Phase 31 deleted them. If you change them, the
// equivalence guarantee is void.
// ---------------------------------------------------------------------------

const OLD_REVIEW_REQUIRED_PHASES: string[] = [
  "storyboard",
  "character",
  "scene",
  "camera-preview",
  "camera-final",
  "quality-gate",
];

const OLD_PHASE_INGEST_MAP: Record<string, string[]> = {
  "art-direction": ["images"],
  character: ["images"],
  scenario: [],
  voice: [],
  storyboard: ["storyboard"],
  scene: ["images"],
  "camera-preview": ["videos"],
  "camera-final": ["videos"],
  "post-production": [],
  "quality-gate": [],
  delivery: [],
};

const OLD_PHASE_ORDER: Record<string, number> = {
  requirement: 0,
  "art-direction": 1,
  character: 2,
  scenario: 3,
  voice: 4,
  storyboard: 5,
  scene: 6,
  "camera-preview": 7,
  "camera-final": 8,
  "post-production": 9,
  "quality-gate": 10,
  delivery: 11,
};

/**
 * Replicates the old mapIngest rule that Phase 30's defaultSkill.ts used to
 * translate `PHASE_INGEST_MAP[phase]` into the manifest's `ingest_outputs`:
 *   - empty array  → ["none"]   (descriptive "no outputs" sentinel)
 *   - non-empty    → pass through (must be valid IngestOutput strings)
 */
function mapOldIngest(arr: string[] | undefined): IngestOutput[] {
  const src = arr ?? [];
  if (src.length === 0) return ["none"];
  return src as IngestOutput[];
}

// ---------------------------------------------------------------------------
// Test runner plumbing (matches verify-phase-30.ts shape)
// ---------------------------------------------------------------------------

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
  // Ensure the manifest is registered so registry.phaseById works. In
  // production, seedDefaultIfEmpty + loadAllFromDB handle this at boot. Here
  // we register directly — no DB needed, the manifest is already validated at
  // module load (see defaultSkill.ts _selfCheck).
  if (!registry.get(MOVIE_V1_MANIFEST.skill_id)) {
    registry.register(MOVIE_V1_MANIFEST);
  }

  const taxonomy = MOVIE_V1_MANIFEST.phase_taxonomy;
  const oldOrderKeys = Object.keys(OLD_PHASE_ORDER).sort();
  const manifestIds = taxonomy.map((p) => p.id).sort();

  // -------------------------------------------------------------------------
  // Group A — manifest shape
  // SUPERSEDED by verify:phase-57 T1-T4 (2026-08-22): the 22-phase taxonomy no
  // longer matches the pre-31 OLD_* snapshot BY DESIGN (Phase 57-07 D-16 direct
  // switch). Kept as an explicit skip with a pointer — the OLD_* constants are
  // a historical document and are NOT modified.
  // -------------------------------------------------------------------------

  console.log("\n=== Group A: manifest shape — superseded by verify:phase-57 ===");
  console.log(
    "  SKIP: 'manifest has exactly 12 phases' + 'manifest phase IDs match OLD_PHASE_ORDER keys' — superseded by verify:phase-57 T1-T4 (22-phase registry alignment; OLD_* is the pre-31 historical snapshot).",
  );
  assert(
    taxonomy.length === 22,
    "manifest has exactly 22 phases (57-07 realignment)",
    `got ${taxonomy.length}`,
  );
  assert(
    !manifestIds.some((id) => oldOrderKeys.includes(id)),
    "legacy 12 ids fully retired from the taxonomy (D-16 direct switch)",
    manifestIds.filter((id) => oldOrderKeys.includes(id)).join(",") || undefined,
  );

  // -------------------------------------------------------------------------
  // Group B — per-phase equivalence vs OLD_ snapshots
  // SUPERSEDED by verify:phase-57 T3/T5 (2026-08-22): per-phase requires_review
  // is now asserted against PHASE_REGISTRY gated-ness + GATE_CATALOG, not the
  // pre-31 constants. OLD_* values remain untouched above.
  // -------------------------------------------------------------------------

  console.log("\n=== Group B: per-phase equivalence — superseded by verify:phase-57 ===");
  console.log(
    "  SKIP: per-phase requires_review / order / ingest_outputs equivalence vs OLD_ snapshots — superseded by verify:phase-57 (T2 order ≡ sortKey, T3/T5 requires_review ⇔ gate).",
  );
  for (const phaseDecl of taxonomy) {
    assert(
      typeof phaseDecl.requires_review === "boolean" && typeof phaseDecl.order === "number",
      `shape: ${phaseDecl.id} carries well-formed requires_review/order`,
    );
  }

  // -------------------------------------------------------------------------
  // Group C — registry lookup parity (runtime surface matches manifest)
  // -------------------------------------------------------------------------

  console.log("\n=== Group C: registry.phaseById parity ===");
  const registeredMovieV1 = registry.get("movie-v1");
  assert(
    registeredMovieV1 !== undefined,
    "registry.get('movie-v1') returns the manifest",
    registeredMovieV1 === undefined ? "undefined — registry not seeded" : "ok",
  );

  if (registeredMovieV1 !== undefined) {
    for (const phaseDecl of taxonomy) {
      const looked = registry.phaseById("movie-v1", phaseDecl.id);
      assert(
        looked !== undefined,
        `registry.phaseById('movie-v1', '${phaseDecl.id}') returns a PhaseDecl`,
        looked === undefined ? "returned undefined" : "ok",
      );
      if (looked) {
        assert(
          looked.requires_review === phaseDecl.requires_review,
          `parity: ${phaseDecl.id}.requires_review matches registry lookup`,
          `manifest=${phaseDecl.requires_review} vs registry=${looked.requires_review}`,
        );
        assert(
          looked.order === phaseDecl.order,
          `parity: ${phaseDecl.id}.order matches registry lookup`,
          `manifest=${phaseDecl.order} vs registry=${looked.order}`,
        );
        assert(
          JSON.stringify(looked.ingest_outputs) === JSON.stringify(phaseDecl.ingest_outputs),
          `parity: ${phaseDecl.id}.ingest_outputs matches registry lookup`,
          `manifest=${JSON.stringify(phaseDecl.ingest_outputs)} vs registry=${JSON.stringify(looked.ingest_outputs)}`,
        );
      }
    }
  }

  // -------------------------------------------------------------------------
  // Group D — negative spot-checks (submit-to-review behavior fix)
  // -------------------------------------------------------------------------

  console.log("\n=== Group D: negative spot-checks for old invalid enum IDs ===");
  const invalidIds = ["image", "video", "audio", "compose"];
  for (const invalidId of invalidIds) {
    const looked = registry.phaseById("movie-v1", invalidId);
    assert(
      looked === undefined,
      `registry.phaseById('movie-v1', '${invalidId}') returns undefined (not in movie-v1 taxonomy)`,
      looked === undefined ? "ok — old invalid ID correctly rejected" : `UNEXPECTED: returned ${JSON.stringify(looked)}`,
    );
  }

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

  console.log("OK Phase 31 equivalence verified");
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error("verify-phase-31.ts: uncaught exception");
  console.error(err);
  process.exit(2);
});
