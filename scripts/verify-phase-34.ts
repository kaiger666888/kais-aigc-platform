#!/usr/bin/env tsx
/**
 * verify-phase-34.ts — Phase 34 (Skill Author Documentation) verification.
 *
 * Confirms DOCS-01 through DOCS-04:
 *   - DOCS-01: docs/skill-author-guide.md exists with field reference + examples + versioning
 *   - DOCS-02: deploy order documented (platform first → register → upgrade OpenClaw)
 *   - DOCS-03: "What NOT to do" section with explicit anti-features
 *   - DOCS-04: movie-v1.manifest.json example referenced inline with annotations
 */

import fs from "node:fs";
import path from "node:path";

interface TestResult { name: string; pass: boolean; detail?: string; }
const results: TestResult[] = [];
function assert(cond: boolean, name: string, detail?: string): void {
  results.push({ name, pass: cond, detail });
  console.log(`  ${cond ? "PASS" : "FAIL"}: ${name}${detail ? " — " + detail : ""}`);
}

const REPO_ROOT = path.resolve(__dirname, "..");
const guidePath = path.join(REPO_ROOT, "docs/skill-author-guide.md");
const guide = fs.existsSync(guidePath) ? fs.readFileSync(guidePath, "utf8") : "";

async function main(): Promise<void> {
  console.log("=== Phase 34 — verify-phase-34.ts ===\n");

  // DOCS-01: exists + field reference + examples + versioning
  console.log("=== DOCS-01: guide exists with required sections ===");
  assert(fs.existsSync(guidePath), "docs/skill-author-guide.md exists");
  assert(/## 2\. Manifest Field Reference/.test(guide), "field reference section present");
  assert(/skill_id|node_types|phase_taxonomy/.test(guide), "fields documented (skill_id/node_types/phase_taxonomy)");
  assert(/## 3\. Versioning/.test(guide), "versioning section present");
  assert(/major\.minor/.test(guide), "versioning rule (major.minor) documented");
  assert(/## 7\. Example/.test(guide), "examples section present");

  // DOCS-02: deploy order
  console.log("\n=== DOCS-02: deploy order documented ===");
  assert(/## 6\. Deploy Order/.test(guide), "deploy order section present");
  assert(/Platform first/i.test(guide), "step 1: platform first");
  assert(/Register your manifest/i.test(guide), "step 2: register via API");
  assert(/OpenClaw/i.test(guide), "step 3: upgrade OpenClaw-side skill");

  // DOCS-03: what NOT to do
  console.log("\n=== DOCS-03: 'What NOT to do' anti-features section ===");
  assert(/## 5\. What NOT to Do/.test(guide), "anti-features section present");
  assert(/No executable code/i.test(guide), "anti-feature: no executable code in manifest");
  assert(/No dynamic React component loading/i.test(guide), "anti-feature: no dynamic React loading");
  assert(/No sandboxing/i.test(guide), "anti-feature: no sandboxing/permission matrix");
  assert(/No bare node type IDs/i.test(guide), "anti-feature: no bare node type IDs");
  assert(/No patch versions/i.test(guide), "anti-feature: no patch versions");

  // DOCS-04: movie-v1.manifest.json example inline with annotations
  console.log("\n=== DOCS-04: movie-v1.manifest.json example inline with annotations ===");
  assert(/movie-v1\.manifest\.json/.test(guide), "guide references the movie-v1.manifest.json artifact");
  assert(/"skill_id": "movie-v1"/.test(guide), "guide shows skill_id example inline");
  assert(/"type": "movie-v1::script"/.test(guide), "guide shows namespaced node type example inline");
  assert(/"requires_review": (true|false)/.test(guide), "guide shows phase requires_review example inline");
  assert(/\/\/ .*namespaced|\/\/ .*0-based|\/\/ .*descriptive/.test(guide), "guide has inline annotated comments");

  // Bonus: link to actual artifact file
  assert(
    /\.\.\/skill-author-guide\/movie-v1\.manifest\.json|docs\/skill-author-guide\/movie-v1\.manifest\.json/.test(guide),
    "guide links to the actual movie-v1.manifest.json file",
  );

  // Summary
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n=== SUMMARY: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) {
    console.error("\nFAILED:");
    for (const r of results) if (!r.pass) console.error(`  - ${r.name}${r.detail ? " — " + r.detail : ""}`);
    process.exit(1);
  }
  console.log("OK Phase 34 verified");
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error("verify-phase-34.ts: uncaught exception");
  console.error(err);
  process.exit(2);
});
