#!/usr/bin/env tsx
/**
 * verify-phase-33.ts — Phase 33 (Compliance + E2E) runner.
 *
 * Project convention (Pitfalls B3 / COMPLIANCE-05): no vitest/jest. This
 * standalone `tsx` script follows the verify-phase-{28..32}.ts pattern. Each
 * assertion records one of three states:
 *
 *   - PASSED  (green)  — assertion ran and succeeded
 *   - SKIPPED (yellow) — assertion could not run (e.g., live Docker + GPU
 *                        required and unavailable in this environment)
 *   - FAILED  (red)    — assertion ran and failed
 *
 * No assertion silently skips — every skipped item logs its reason so
 * /gsd:audit-uat and downstream reviewers can see exactly what wasn't
 * exercised. COMPLIANCE-05.
 *
 * Phase 33 success criteria (from ROADMAP + plans):
 *   1. (SC #1) movie-v1.manifest.json exists at docs/skill-author-guide/ as
 *      an install-ready artifact (COMPLIANCE-01).
 *   2. (SC #2) movie-v1.manifest.json registers successfully via the
 *      register flow (validate → INSERT → registry.register) (COMPLIANCE-02).
 *   3. (SC #3) End-to-end: movie-v1 callbacks run without regression. Full
 *      E2E requires live Docker + GPU + a running pipeline — SKIPPED in CI
 *      mode, replaced with an in-memory callback smoke test (COMPLIANCE-03).
 *   4. (SC #4) Negative: registering a manifest with a phase declaring
 *      `requires_review: false, ingest_outputs: []` succeeds; the platform
 *      does not crash on an "unknown" phase ID — phases are descriptive
 *      (COMPLIANCE-04).
 *   5. (SC #5) Malformed manifest is rejected with a structured 400-style
 *      error and no partial mutation.
 *
 * Usage:
 *   tsx scripts/verify-phase-33.ts
 *
 * Exit codes:
 *   0 — no FAILED assertions (PASSED + SKIPPED allowed)
 *   1 — one or more FAILED assertions
 *   2 — uncaught exception
 */

import fs from "node:fs";
import path from "node:path";
import knex from "knex";
import { registry } from "../src/skills/registry";
import { validateManifest } from "../src/skills/validator";
import {
  seedDefaultIfEmpty,
  MOVIE_V1_MANIFEST,
} from "../src/skills/defaultSkill";
import type { SkillManifest, ManifestValidationError } from "../src/skills/contract";

type AssertionStatus = "passed" | "skipped" | "failed";

interface TestResult {
  name: string;
  status: AssertionStatus;
  detail?: string;
}

const results: TestResult[] = [];

function record(status: AssertionStatus, name: string, detail?: string): void {
  results.push({ name, status, detail });
  const symbol = status === "passed" ? "PASS" : status === "skipped" ? "SKIP" : "FAIL";
  console.log(`  ${symbol}: ${name}${detail ? " — " + detail : ""}`);
}

function assertPassed(cond: boolean, name: string, detail?: string): void {
  record(cond ? "passed" : "failed", name, detail);
}

const REPO_ROOT = path.resolve(__dirname, "..");
function readRel(rel: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/**
 * Build a manifest with a custom phase declaring the minimum safe shape
 * (requires_review: false, ingest_outputs: []). Used for the negative test
 * (COMPLIANCE-04 — platform accepts an "unknown" phase ID because phases
 * are descriptive metadata).
 */
function buildManifestWithUnknownPhase(): SkillManifest {
  return {
    ...MOVIE_V1_MANIFEST,
    skill_id: "test-unknown-phase",
    display_name: "Test Skill (unknown phase)",
    description: "Phase 33 fixture — declares a phase not in movie-v1's taxonomy",
    node_types: [
      {
        type: "test-unknown-phase::script",
        label: "Script",
        icon: "page",
        color: "#000000",
        data_schema_uri: "",
        default_renderer: "script",
      },
    ],
    phase_taxonomy: [
      // An "unknown" phase ID — but manifest is descriptive, so the platform
      // MUST accept it. requires_review: false + ingest_outputs: [] is the
      // safe minimum per COMPLIANCE-04.
      {
        id: "exotic-new-phase",
        order: 0,
        label: "Exotic New Phase",
        requires_review: false,
        ingest_outputs: ["none"],
      },
    ],
  };
}

/**
 * Build a malformed manifest (bare node type ID, no namespacing). Mirrors
 * the verify-phase-29 / verify-phase-30 negative fixtures. MUST be rejected
 * by the validator.
 */
function buildMalformedManifest(): unknown {
  return {
    skill_id: "test-malformed",
    version: "1.0",
    display_name: "Malformed",
    description: "should be rejected",
    media_types: ["video"],
    node_types: [
      {
        type: "script", // bare — missing <skill_id>:: prefix → NODE_ID_NAMESPACING
        label: "Script",
        icon: "x",
        color: "#fff",
        data_schema_uri: "x",
        default_renderer: "script",
      },
    ],
    phase_taxonomy: [
      { id: "p1", order: 0, label: "P", requires_review: false, ingest_outputs: ["none"] },
    ],
    asset_categories: [{ id: "asset", label: "Asset" }],
    review_criteria: { auto_threshold: 0.8, human_threshold: 0.6 },
    engine_task_types: ["IMAGE_DRAW"],
    runtime: { type: "external-http", endpoint: "http://example.com" },
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("=== Phase 33 — verify-phase-33.ts ===\n");

  // -------------------------------------------------------------------------
  // Group A — install-ready manifest artifact exists (COMPLIANCE-01)
  // -------------------------------------------------------------------------

  console.log("=== Group A: install-ready manifest artifact (COMPLIANCE-01) ===");
  const artifactPath = path.join(REPO_ROOT, "docs/skill-author-guide/movie-v1.manifest.json");
  assertPassed(
    fs.existsSync(artifactPath),
    "docs/skill-author-guide/movie-v1.manifest.json exists",
    artifactPath,
  );

  let parsedArtifact: SkillManifest | null = null;
  try {
    parsedArtifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
    assertPassed(true, "artifact parses as valid JSON");
  } catch (err) {
    assertPassed(false, "artifact parses as valid JSON", (err as Error).message);
  }

  if (parsedArtifact) {
    assertPassed(
      parsedArtifact.skill_id === MOVIE_V1_MANIFEST.skill_id,
      "artifact skill_id matches MOVIE_V1_MANIFEST",
      `artifact=${parsedArtifact.skill_id} vs source=${MOVIE_V1_MANIFEST.skill_id}`,
    );
    assertPassed(
      parsedArtifact.version === MOVIE_V1_MANIFEST.version,
      "artifact version matches MOVIE_V1_MANIFEST",
      `artifact=${parsedArtifact.version} vs source=${MOVIE_V1_MANIFEST.version}`,
    );
    assertPassed(
      parsedArtifact.node_types.length === MOVIE_V1_MANIFEST.node_types.length,
      "artifact node_types count matches source",
      `artifact=${parsedArtifact.node_types.length} vs source=${MOVIE_V1_MANIFEST.node_types.length}`,
    );
    assertPassed(
      JSON.stringify(parsedArtifact.phase_taxonomy) === JSON.stringify(MOVIE_V1_MANIFEST.phase_taxonomy),
      "artifact phase_taxonomy matches source verbatim",
    );

    // Round-trip: the parsed artifact must pass the validator on its own
    // (no platform-side fixup needed).
    const revalidate = validateManifest(parsedArtifact);
    assertPassed(
      revalidate.ok === true,
      "artifact re-validates via the platform zod validator",
      revalidate.ok === false ? `ruleId=${revalidate.errors[0]?.ruleId}` : "ok",
    );
  }

  // -------------------------------------------------------------------------
  // Group B — artifact registers via the real register flow (COMPLIANCE-02)
  // -------------------------------------------------------------------------

  console.log("\n=== Group B: artifact registers via register flow (COMPLIANCE-02) ===");
  // Use a transient in-memory SQLite (same pattern as verify-phase-30).
  const transientDb = knex({
    client: "better-sqlite3",
    connection: { filename: ":memory:" },
    useNullAsDefault: true,
  });
  // Recreate o_skillRegistry schema (mirrors Phase 29 initDB migration).
  await transientDb.schema.createTable("o_skillRegistry", (t) => {
    t.string("skill_id").primary();
    t.string("version").notNullable();
    t.text("manifest_json").notNullable();
    t.integer("active").defaultTo(1);
    t.bigInteger("registered_at").notNullable();
  });

  try {
    if (parsedArtifact) {
      // Replicate the register handler's flow: validate → INSERT → registry.register.
      const regResult = validateManifest(parsedArtifact);
      assertPassed(
        regResult.ok === true,
        "register flow: validateManifest(artifact) succeeds",
        regResult.ok === false ? `ruleId=${regResult.errors[0]?.ruleId}` : "ok",
      );

      if (regResult.ok === true) {
        const now = Date.now();
        await transientDb("o_skillRegistry").insert({
          skill_id: parsedArtifact.skill_id,
          version: parsedArtifact.version,
          manifest_json: JSON.stringify(parsedArtifact),
          active: 1,
          registered_at: now,
        });
        const row = await transientDb("o_skillRegistry")
          .where({ skill_id: parsedArtifact.skill_id })
          .first();
        assertPassed(row != null, "register flow: row persisted to o_skillRegistry");

        registry.register(parsedArtifact);
        const looked = registry.get(parsedArtifact.skill_id);
        assertPassed(
          looked != null,
          "register flow: registry.get(skill_id) returns the manifest post-register",
        );
        if (looked) {
          assertPassed(
            looked.phase_taxonomy.length === parsedArtifact.phase_taxonomy.length,
            "register flow: registry phase_taxonomy length matches artifact",
          );
        }
      }
    }
  } finally {
    await transientDb.destroy();
  }

  // -------------------------------------------------------------------------
  // Group C — golden-path callback exercise (COMPLIANCE-03)
  // -------------------------------------------------------------------------

  console.log("\n=== Group C: golden-path callback smoke test (COMPLIANCE-03) ===");
  // Full E2E (live Docker + GPU + a real pipeline run) is out of scope for
  // CI mode. We exercise the registry lookup surface that the refactored
  // callbacks (phase-complete.ts, resume.ts, submit-to-review.ts) consult,
  // and verify movie-v1 is queryable end-to-end. Anything beyond this
  // (e.g., invoking the actual Express handler against a live platform)
  // is SKIPPED with an explicit reason.
  if (!registry.get("movie-v1")) {
    registry.register(MOVIE_V1_MANIFEST);
  }
  const movieManifest = registry.get("movie-v1");
  assertPassed(
    movieManifest !== undefined,
    "golden-path: registry.get('movie-v1') is hydrated",
  );

  // Sample phase lookups matching what phase-complete / resume / submit-to-review
  // perform. Phase 57-07 superseded the legacy 12 ids with the 22-phase registry
  // khsPrefix vocabulary — samples now span gated (p03/p09c/p11c/p13) and
  // gate-less (p15) phases. Zero-drift taxonomy contract lives in verify-phase-57.
  const samplePhases = ["p03", "p09c", "p11c", "p13", "p15"];
  for (const p of samplePhases) {
    const decl = registry.phaseById("movie-v1", p);
    assertPassed(
      decl !== undefined && typeof decl.requires_review === "boolean" && typeof decl.order === "number",
      `golden-path: registry.phaseById('movie-v1', '${p}') returns well-formed PhaseDecl`,
      decl === undefined ? "undefined" : `requires_review=${decl.requires_review}, order=${decl.order}`,
    );
  }

  // Live Docker + GPU golden path (full pipeline run) — SKIPPED with reason
  record(
    "skipped",
    "golden-path: live Docker + GPU pipeline run through refactored callbacks",
    "requires live platform + GPU + a real movie-v1 project; CI runs the registry-lookup smoke test above. Re-run in a live environment to exercise the full callback path.",
  );

  // -------------------------------------------------------------------------
  // Group D — negative: unknown phase registers fine (COMPLIANCE-04)
  // -------------------------------------------------------------------------

  console.log("\n=== Group D: negative — unknown phase registers (COMPLIANCE-04) ===");
  const unknownPhaseManifest = buildManifestWithUnknownPhase();
  const unknownResult = validateManifest(unknownPhaseManifest);
  assertPassed(
    unknownResult.ok === true,
    "validateManifest accepts a manifest declaring an 'unknown' phase ID (phases are descriptive)",
    unknownResult.ok === false ? `ruleId=${unknownResult.errors[0]?.ruleId}` : "ok",
  );
  if (unknownResult.ok === true) {
    // Register and verify the platform doesn't crash on the unknown phase
    try {
      registry.register(unknownPhaseManifest);
      const looked = registry.phaseById("test-unknown-phase", "exotic-new-phase");
      assertPassed(
        looked !== undefined && looked.requires_review === false,
        "registry.phaseById returns the unknown phase with requires_review=false (no crash)",
      );
      // Clean up — remove the test skill
      registry.delete("test-unknown-phase");
      assertPassed(
        registry.get("test-unknown-phase") === undefined,
        "cleanup: test-unknown-phase removed from registry",
      );
    } catch (err) {
      assertPassed(false, "registry.register(unknown phase manifest) does not throw", (err as Error).message);
    }
  }

  // -------------------------------------------------------------------------
  // Group E — negative: malformed manifest rejected (SC #5)
  // -------------------------------------------------------------------------

  console.log("\n=== Group E: negative — malformed manifest rejected (SC #5) ===");
  const malformed = buildMalformedManifest();
  const malformedResult = validateManifest(malformed as SkillManifest);
  assertPassed(
    malformedResult.ok === false,
    "validateManifest rejects a malformed manifest (bare node type ID)",
    malformedResult.ok === true ? "unexpectedly accepted" : `ruleId=${malformedResult.errors[0]?.ruleId}`,
  );
  if (malformedResult.ok === false) {
    const firstErr: ManifestValidationError = malformedResult.errors[0];
    assertPassed(
      typeof firstErr.ruleId === "string" && firstErr.ruleId.length > 0,
      "rejection carries a structured ruleId",
      `ruleId=${firstErr.ruleId}`,
    );
    assertPassed(
      typeof firstErr.field === "string",
      "rejection carries a field path",
      `field=${firstErr.field}`,
    );
  }

  // -------------------------------------------------------------------------
  // Summary (COMPLIANCE-05 — explicit pass/skip/fail counts)
  // -------------------------------------------------------------------------

  const counts = {
    passed: results.filter((r) => r.status === "passed").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    failed: results.filter((r) => r.status === "failed").length,
  };
  console.log(`\n=== SUMMARY: ${counts.passed} passed, ${counts.skipped} skipped, ${counts.failed} failed ===`);

  if (counts.failed > 0) {
    console.error("\nFAILED ASSERTIONS:");
    for (const r of results) {
      if (r.status === "failed") {
        console.error(`  - ${r.name}${r.detail ? " — " + r.detail : ""}`);
      }
    }
    process.exit(1);
  }

  if (counts.skipped > 0) {
    console.warn("\nSKIPPED ASSERTIONS (review before sign-off):");
    for (const r of results) {
      if (r.status === "skipped") {
        console.warn(`  - ${r.name}${r.detail ? " — " + r.detail : ""}`);
      }
    }
  }

  console.log("OK Phase 33 verified (with explicit skipped items — see SUMMARY above)");
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error("verify-phase-33.ts: uncaught exception");
  console.error(err);
  process.exit(2);
});
