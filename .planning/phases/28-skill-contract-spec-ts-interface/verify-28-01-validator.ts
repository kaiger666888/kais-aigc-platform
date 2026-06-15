/**
 * Phase 28 Plan 01 — Task 2 behavior verification (RED/GREEN harness)
 *
 * Project convention (Pitfalls B3): no vitest/jest. This is a standalone
 * `tsx` script that asserts the <behavior> block from 28-01-PLAN.md.
 *
 * Run: npx tsx .planning/phases/28-skill-contract-spec-ts-interface/verify-28-01-validator.ts
 *
 * Each assertion maps 1:1 to a line in the plan's <behavior> section.
 */
import { validateManifest } from "../../../src/skills/validator";
import type { SkillManifest } from "../../../src/skills/contract";

let pass = 0;
let fail = 0;

function check(label: string, cond: boolean, extra = ""): void {
  if (cond) {
    pass++;
    console.log(`  PASS: ${label}`);
  } else {
    fail++;
    console.log(`  FAIL: ${label}${extra ? " — " + extra : ""}`);
  }
}

/** A minimal well-formed manifest base. Mutate copies per-test. */
function validBase(): SkillManifest {
  return {
    skill_id: "movie-v1",
    version: "1.0",
    display_name: "Movie",
    description: "desc",
    media_types: ["video", "image", "audio", "3d"],
    node_types: [
      {
        type: "movie-v1::script",
        label: "Script",
        icon: "p",
        color: "#fff",
        data_schema_uri: "https://example.com/s",
        default_renderer: "script",
      },
    ],
    phase_taxonomy: [
      { id: "requirement", order: 0, label: "Req", requires_review: false, ingest_outputs: ["none"] },
    ],
    asset_categories: [{ id: "char", label: "Character" }],
    review_criteria: { auto_threshold: 0.8, human_threshold: 0.6 },
    engine_task_types: ["IMAGE_DRAW"],
    runtime: { type: "external-http", endpoint: "http://x" },
  };
}

function ruleIds(errors: { ruleId: string }[]): string[] {
  return errors.map((e) => e.ruleId);
}

// --- Behavior assertions from 28-01-PLAN.md ---

console.log("\n[1] missing skill_id → MANIFEST_REQUIRED_FIELD");
{
  const m = validBase() as unknown as Record<string, unknown>;
  delete m.skill_id;
  const r = validateManifest(m);
  check("ok === false", r.ok === false);
  if (!r.ok) check("errors[0].ruleId === MANIFEST_REQUIRED_FIELD", ruleIds(r.errors).includes("MANIFEST_REQUIRED_FIELD"), JSON.stringify(ruleIds(r.errors)));
}

console.log("\n[2] skill_id is number → MANIFEST_TYPE_MISMATCH");
{
  const m = validBase() as unknown as Record<string, unknown>;
  m.skill_id = 123;
  const r = validateManifest(m);
  check("ok === false", r.ok === false);
  if (!r.ok) check("ruleId includes MANIFEST_TYPE_MISMATCH", ruleIds(r.errors).includes("MANIFEST_TYPE_MISMATCH"), JSON.stringify(ruleIds(r.errors)));
}

console.log("\n[3] version '1.0.0' (has patch) → MANIFEST_VERSION_FORMAT");
{
  const m = validBase();
  m.version = "1.0.0";
  const r = validateManifest(m);
  check("ok === false", r.ok === false);
  if (!r.ok) check("ruleId includes MANIFEST_VERSION_FORMAT", ruleIds(r.errors).includes("MANIFEST_VERSION_FORMAT"), JSON.stringify(ruleIds(r.errors)));
}

console.log("\n[4] version 'v1' → MANIFEST_VERSION_FORMAT");
{
  const m = validBase();
  m.version = "v1";
  const r = validateManifest(m);
  check("ok === false", r.ok === false);
  if (!r.ok) check("ruleId includes MANIFEST_VERSION_FORMAT", ruleIds(r.errors).includes("MANIFEST_VERSION_FORMAT"), JSON.stringify(ruleIds(r.errors)));
}

console.log("\n[5] version '1.0' → accepted");
{
  const m = validBase();
  m.version = "1.0";
  const r = validateManifest(m);
  check("ok === true", r.ok === true, r.ok ? "" : JSON.stringify(ruleIds(r.errors)));
}

console.log("\n[6] version '2.5' → accepted (major gating is runtime concern)");
{
  const m = validBase();
  m.version = "2.5";
  const r = validateManifest(m);
  check("ok === true", r.ok === true, r.ok ? "" : JSON.stringify(ruleIds(r.errors)));
}

console.log("\n[7] node_types[0].type === 'script' (bare) → NODE_ID_NAMESPACING");
{
  const m = validBase();
  m.node_types[0].type = "script";
  const r = validateManifest(m);
  check("ok === false", r.ok === false);
  if (!r.ok) check("ruleId includes NODE_ID_NAMESPACING", ruleIds(r.errors).includes("NODE_ID_NAMESPACING"), JSON.stringify(ruleIds(r.errors)));
}

console.log("\n[8] node_types[0].type === 'movie-v1::script' → accepted");
{
  const m = validBase();
  m.node_types[0].type = "movie-v1::script";
  const r = validateManifest(m);
  check("ok === true", r.ok === true, r.ok ? "" : JSON.stringify(ruleIds(r.errors)));
}

console.log("\n[9] unknown top-level key 'foobar' → MANIFEST_UNKNOWN_FIELD");
{
  const m = validBase() as unknown as Record<string, unknown>;
  m.foobar = 1;
  const r = validateManifest(m);
  check("ok === false", r.ok === false);
  if (!r.ok) check("ruleId includes MANIFEST_UNKNOWN_FIELD", ruleIds(r.errors).includes("MANIFEST_UNKNOWN_FIELD"), JSON.stringify(ruleIds(r.errors)));
}

console.log("\n[10] well-formed manifest → { ok: true, value }");
{
  const r = validateManifest(validBase());
  check("ok === true", r.ok === true);
  if (r.ok) check("value.skill_id === 'movie-v1'", r.value.skill_id === "movie-v1");
}

console.log("\n[11] uppercase namespaced id rejected → NODE_ID_NAMESPACING");
{
  const m = validBase();
  m.node_types[0].type = "Movie-V1::Script";
  const r = validateManifest(m);
  check("ok === false", r.ok === false);
  if (!r.ok) check("ruleId includes NODE_ID_NAMESPACING", ruleIds(r.errors).includes("NODE_ID_NAMESPACING"), JSON.stringify(ruleIds(r.errors)));
}

console.log("\n[12] version '1' (single number) → MANIFEST_VERSION_FORMAT");
{
  const m = validBase();
  m.version = "1";
  const r = validateManifest(m);
  check("ok === false", r.ok === false);
  if (!r.ok) check("ruleId includes MANIFEST_VERSION_FORMAT", ruleIds(r.errors).includes("MANIFEST_VERSION_FORMAT"), JSON.stringify(ruleIds(r.errors)));
}

console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
if (fail > 0) {
  process.exit(1);
}
