#!/usr/bin/env tsx
/**
 * verify-phase-45.ts — Phase 45 (Text Asset Mapping + UI Completeness)
 * verification.
 *
 * Confirms TEXT-01..03:
 *   - TEXT-01: import-from-dir.ts handles every .txt output (raised
 *              sidecar cap + standalone-.txt probe for script phase dirs)
 *   - TEXT-02: NodeDetailPanel renders multi-line description across all
 *              detail panels (ScriptDetail prompt fallback + StoryboardDetail
 *              description section + VideoDetail prompt/description/tags/provenance)
 *   - TEXT-03: FlowCanvas toolbar exposes a debounced search filter that
 *              toggles node visibility by substring match against label /
 *              description / prompt
 *
 * Run: npx tsx scripts/verify-phase-45.ts
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
function read(rel: string): string {
  const p = path.join(REPO_ROOT, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
}

async function main(): Promise<void> {
  console.log("=== Phase 45 — verify-phase-45.ts ===\n");

  // ─── TEXT-01: backend text-asset mapping ─────────────────────
  console.log("=== TEXT-01: import-from-dir sidecar + standalone .txt handling ===");
  const importContent = read("src/routes/canvas/v2/import-from-dir.ts");
  assert(importContent.includes("slice(0, 10000)"), "TEXT-01: sidecar cap raised to 10000");
  assert(!importContent.includes("slice(0, 500)"), "TEXT-01: old 500-char cap removed");
  assert(importContent.includes("artifactsFromScriptTextFiles"), "TEXT-01: artifactsFromScriptTextFiles helper defined");
  assert(importContent.includes("consumedBaselineSet"), "TEXT-01: dedupe set parameter present");
  assert(importContent.includes('canvasType === "script"'), "TEXT-01: probe gated on canvasType === script");

  // ─── TEXT-02: UI panel description rendering ─────────────────
  console.log("\n=== TEXT-02: NodeDetailPanel description rendering ===");
  const nodeDetailContent = read("packages/infinite-canvas/src/components/NodeDetailPanel.tsx");
  assert(
    nodeDetailContent.includes("(data.description as string) || (data.content as string) || (data.prompt as string)"),
    "TEXT-02: ScriptDetail fallback chain includes prompt",
  );
  const describeLabelCount = (nodeDetailContent.match(/<SectionLabel>描述<\/SectionLabel>/g) || []).length;
  assert(
    describeLabelCount >= 3,
    "TEXT-02: description SectionLabel appears >=3 times (AssetDetail + StoryboardDetail + VideoDetail)",
    `actual: ${describeLabelCount}`,
  );
  const videoDetailMatch = nodeDetailContent.match(/function VideoDetail[\s\S]*?\n}\n/) || [];
  const videoDetailBody = videoDetailMatch[0] || "";
  assert(
    videoDetailBody.includes("Prompt 描述"),
    "TEXT-02: VideoDetail contains Prompt 描述 block",
  );
  assert(
    videoDetailBody.includes("来源"),
    "TEXT-02: VideoDetail contains 来源 provenance block",
  );
  const preWrapCount = (nodeDetailContent.match(/pre-wrap/g) || []).length;
  assert(
    preWrapCount >= 6,
    "TEXT-02: pre-wrap appears >=6 times across all detail panels",
    `actual: ${preWrapCount}`,
  );

  // ─── TEXT-03: Tier 2 search filter ───────────────────────────
  console.log("\n=== TEXT-03: toolbar search filter ===");
  const flowCanvasContent = read("packages/infinite-canvas/src/components/FlowCanvas.tsx");
  assert(flowCanvasContent.includes("searchQuery"), "TEXT-03: searchQuery state declared");
  assert(flowCanvasContent.includes("hidden: !matches"), "TEXT-03: visibility-only filter (hidden: !matches)");
  assert(
    flowCanvasContent.includes('placeholder="搜索描述/标签..."'),
    "TEXT-03: search input has 搜索描述/标签... placeholder",
  );

  // ─── Summary ──────────────────────────────────────────────────
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
