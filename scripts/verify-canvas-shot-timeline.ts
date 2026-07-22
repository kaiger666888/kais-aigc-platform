#!/usr/bin/env tsx
/**
 * verify-canvas-shot-timeline.ts — Phase 3 CANVAS-01/02/03 verify.
 *
 * Loads the downsampled golden fixture (scripts/fixtures/shot-timeline-ep01/),
 * runs it through the production extractShotTimelineArtifacts helper, and
 * asserts:
 *   A. CANVAS-01 structure: 1 zone + 1 summary + N storyboard + 3 audio + 1 video
 *   B. CANVAS-02 sequence edge count: N-1
 *   C. CANVAS-02 sequence edges form monotonic chain by shot_id
 *   D. CANVAS-03 per-type Zod: validateGraphNodes(allNodes).length === 0
 *   E. CANVAS-03 additive-only (frontend): packages/infinite-canvas/ diff empty
 *   E2. CANVAS-03 additive-only (schema): canvasAssetSchema.ts strictness preserved
 *       (.optional() / .nullable() counts not increased vs origin/master)
 *   F. Roundtrip: manifest fields survive into node.data (zone label,
 *      video duration_sec, audio engine, video resolution, storyboard shot_id)
 *
 * Run: npx tsx scripts/verify-canvas-shot-timeline.ts
 *
 * No backend / DB / HTTP required — imports production pure functions
 * (extractShotTimelineArtifacts, validateGraphNodes) directly.
 */

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { extractShotTimelineArtifacts, setWorkdirToOss } from "../src/routes/canvas/v2/import-from-dir";
import { validateGraphNodes } from "../src/lib/canvasAssetSchema";

interface TestResult { name: string; pass: boolean; detail?: string; }
const results: TestResult[] = [];
function assert(cond: boolean, name: string, detail?: string): void {
  results.push({ name, pass: cond, detail });
  console.log(`  ${cond ? "PASS" : "FAIL"}: ${name}${detail ? " — " + detail : ""}`);
}

const REPO_ROOT = path.resolve(__dirname, "..");
const FIXTURE = path.resolve(__dirname, "fixtures/shot-timeline-ep01");
const WORKTREE_CWD = REPO_ROOT;

async function main(): Promise<void> {
  console.log("=== Phase 3 verify-canvas-shot-timeline (CANVAS-01/02/03) ===\n");

  // ── Step 1: read manifest from fixture ──────────────────────────
  const manifestPath = path.join(FIXTURE, "asset.json");
  let manifest: any;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (err) {
    assert(false, "fixture asset.json parses as JSON", (err as Error).message);
    finish();
    return;
  }

  // ── Step 2: run the production helper ───────────────────────────
  // WR-07: extractShotTimelineArtifacts internally calls fsToOssUrl, which
  // depends on the module-level _workdirToOss global. Production sets it
  // inside scanAndBuildTree at request scope; calling the helper in
  // isolation would leave it null and fsToOssUrl would fall through every
  // branch, yielding non-production-realistic filePath values (raw abs paths
  // instead of /oss/{slug}/...). Set it here to mirror production.
  const workdirBase = path.basename(FIXTURE.replace(/\/$/, ""));
  setWorkdirToOss({ workdir: FIXTURE, ossPrefix: `/oss/${workdirBase}` });

  let nodes: any[];
  let links: any[];
  try {
    const out = await extractShotTimelineArtifacts(manifest, FIXTURE, manifestPath);
    nodes = out.nodes;
    links = out.links;
  } catch (err) {
    assert(false, "extractShotTimelineArtifacts runs without throwing", (err as Error).message);
    finish();
    return;
  }

  // ── Step 3: classify nodes ──────────────────────────────────────
  // Zone + summary are structural parents (their `.type` reflects the phase's
  // renderer for visual consistency, but their `data` is not media-bearing).
  // Plan SC CANVAS-03 validates "全部子节点" (all child nodes) — the actual
  // media-bearing artifact children. Filter zone + summary out of both the
  // type-classification AND the per-type Zod assertion (Step D) to match
  // that intent.
  const zones = nodes.filter((n) => n.type === "zone");
  const summaries = nodes.filter((n) => n.id.startsWith("sum-"));
  const childNodes = nodes.filter((n) => n.type !== "zone" && !n.id.startsWith("sum-"));
  const storyboards = childNodes.filter((n) => n.type === "storyboard");
  const audios = childNodes.filter((n) => n.type === "audio");
  const videos = childNodes.filter((n) => n.type === "video");
  const seqEdges = links.filter((l: any) => l.data?.linkType === "sequence");

  // ── Assert A: CANVAS-01 structure ───────────────────────────────
  assert(zones.length === 1, "CANVAS-01: exactly 1 zone node", `got ${zones.length}`);
  assert(summaries.length === 1, "CANVAS-01: exactly 1 summary node", `got ${summaries.length}`);
  assert(
    audios.length === 3,
    "CANVAS-01: exactly 3 audio stems (vocals/drums/other)",
    `ids=${audios.map((n) => n.id).join(",")}`,
  );
  assert(videos.length === 1, "CANVAS-01: exactly 1 master video", `got ${videos.length}`);
  assert(storyboards.length >= 1, "CANVAS-01: ≥1 storyboard child", `got ${storyboards.length}`);
  // shots.json is the real ep01 (93 shots, copied verbatim — see fixtures)
  assert(
    storyboards.length === 93,
    "CANVAS-01: exactly 93 storyboard children (matches real ep01 shots.json)",
    `got ${storyboards.length}`,
  );

  // ── Assert B: CANVAS-02 sequence edge count ─────────────────────
  assert(
    seqEdges.length === storyboards.length - 1,
    `CANVAS-02: ${storyboards.length - 1} sequence edges (N-1)`,
    `got ${seqEdges.length} expected ${storyboards.length - 1}`,
  );

  // ── Assert C: CANVAS-02 sequence edges form monotonic chain ─────
  // (c1) every seq edge's source/target shot_id is strictly increasing
  let monotonicOk = true;
  let monotonicDetail: string | undefined;
  for (const edge of seqEdges) {
    const sNode = nodes.find((n) => n.id === edge.source);
    const tNode = nodes.find((n) => n.id === edge.target);
    const sId = Number(sNode?.data?.shot_id);
    const tId = Number(tNode?.data?.shot_id);
    if (!(Number.isFinite(sId) && Number.isFinite(tId) && sId < tId)) {
      monotonicOk = false;
      monotonicDetail = `edge ${edge.source}(${sId}) -> ${edge.target}(${tId}) not strictly increasing`;
      break;
    }
  }
  assert(monotonicOk, "CANVAS-02: every seq edge strictly increases shot_id", monotonicDetail);

  // (c2) consecutive seq edges form a chain (prev.target === next.source).
  // Sort by source's shot_id ascending to get linear order.
  const seqEdgesSorted = [...seqEdges].sort((a: any, b: any) => {
    const as = Number(nodes.find((n) => n.id === a.source)?.data?.shot_id ?? 0);
    const bs = Number(nodes.find((n) => n.id === b.source)?.data?.shot_id ?? 0);
    return as - bs;
  });
  let chainOk = true;
  let chainDetail: string | undefined;
  for (let i = 1; i < seqEdgesSorted.length; i++) {
    if (seqEdgesSorted[i - 1].target !== seqEdgesSorted[i].source) {
      chainOk = false;
      chainDetail = `break at index ${i}: ${seqEdgesSorted[i - 1].id}.target=${seqEdgesSorted[i - 1].target} != ${seqEdgesSorted[i].id}.source=${seqEdgesSorted[i].source}`;
      break;
    }
  }
  assert(chainOk, "CANVAS-02: seq edges form a single chain (prev.target === next.source)", chainDetail);

  // ── Assert D: CANVAS-03 per-type Zod validation ─────────────────
  // Validates media-bearing child nodes only (storyboard/audio/video).
  // Zone + summary are structural: their `.type` field reflects the phase's
  // renderer choice but they don't carry media fields, so per-type Zod does
  // not apply. This matches plan SC "全部子节点通过 validateGraphNodes" intent.
  const errors = validateGraphNodes(childNodes);
  assert(
    errors.length === 0,
    "CANVAS-03: all child nodes pass per-type Zod (validateGraphNodes returns 0 errors)",
    errors.length === 0 ? undefined : errors.map((e) => `${e.nodeId}: ${e.errors}`).join(" | "),
  );

  // ── Assert E: additive-only — frontend zero-touch ───────────────
  let treeDiff = "";
  try {
    treeDiff = execSync(
      "git diff --name-only origin/master..HEAD -- packages/infinite-canvas/",
      { cwd: WORKTREE_CWD, encoding: "utf8" },
    ).trim();
  } catch (err) {
    // origin/master may be missing in some env — fall back to HEAD's parent.
    treeDiff = `(git diff failed: ${(err as Error).message})`;
  }
  assert(
    treeDiff === "",
    "CANVAS-03 additive-only: packages/infinite-canvas/ diff is empty",
    treeDiff || "(empty)",
  );

  // ── Assert E2: additive-only — Zod strictness preserved ─────────
  // Count-based compare (more robust than regex-on-diff — diff noise friendly).
  // WR-08: previously, when origin/master was missing (fresh shallow clone,
  // CI without --fetch-depth=full, detached-HEAD builder), execSync threw →
  // all four counters stayed at -1 → assertion `-1 <= -1 && -1 <= -1` evaluated
  // to true → the additive-only invariant PASSED VACUOUSLY. The detail string
  // said '(compare failed: ...)' but the assert was recorded as PASS and the
  // script exited 0. Track schemaCompareOk explicitly: null = couldn't compare
  // (must FAIL, not pass vacuously); true = compared and invariant holds;
  // false = compared and regression detected.
  let masterOpt = -1, headOpt = -1, masterNull = -1, headNull = -1;
  let schemaDiffStatus = "";
  let schemaCompareOk: boolean | null = null;
  try {
    const masterSrc = execSync(
      "git show origin/master:src/lib/canvasAssetSchema.ts",
      { cwd: WORKTREE_CWD, encoding: "utf8" },
    );
    const headSrc = fs.readFileSync(
      path.join(REPO_ROOT, "src/lib/canvasAssetSchema.ts"),
      "utf8",
    );
    masterOpt = (masterSrc.match(/\.optional\(\)/g) || []).length;
    headOpt = (headSrc.match(/\.optional\(\)/g) || []).length;
    masterNull = (masterSrc.match(/\.nullable\(\)/g) || []).length;
    headNull = (headSrc.match(/\.nullable\(\)/g) || []).length;
    schemaCompareOk = headOpt <= masterOpt && headNull <= masterNull;
  } catch (err) {
    schemaDiffStatus = `(compare failed: ${(err as Error).message})`;
    schemaCompareOk = null;
  }
  assert(
    schemaCompareOk === true,
    "CANVAS-03 additive-only: canvasAssetSchema.ts strictness preserved",
    schemaDiffStatus ||
      `.optional() master=${masterOpt} head=${headOpt}; .nullable() master=${masterNull} head=${headNull}`,
  );

  // ── Assert F: Roundtrip — manifest fields survive into node.data ─
  assert(
    zones[0]?.data?.label === manifest.source.video_filename,
    "F: zone.data.label === manifest.source.video_filename",
    `got '${zones[0]?.data?.label}'`,
  );
  assert(
    Number(videos[0]?.data?.duration_sec) === Number(manifest.source.duration_sec),
    "F: video.data.duration_sec === manifest.source.duration_sec",
    `got '${videos[0]?.data?.duration_sec}'`,
  );
  assert(
    audios.every((a) => a.data?.engine === "shot-timeline"),
    "F: every audio.data.engine === 'shot-timeline'",
    `got ${audios.map((a) => a.data?.engine).join(",")}`,
  );
  assert(
    typeof videos[0]?.data?.resolution === "string" && videos[0].data.resolution.length >= 3,
    "F: video.data.resolution synthesized (>= '0x0')",
    `got '${videos[0]?.data?.resolution}'`,
  );
  assert(
    storyboards.every((s) => typeof s.data?.shot_id === "string" && s.data.shot_id.length >= 1),
    "F: every storyboard.data.shot_id is a non-empty string",
    undefined,
  );

  // ── Assert F2: WR-07 — fsToOssUrl synthesizes production-realistic filePath
  // values. Without _workdirToOss set, audio+video children would carry raw
  // absolute filesystem paths instead of /oss/{slug}/... URLs. Assert the
  // prefix to confirm the verify harness actually exercises the URL synthesis
  // code path (regression catch for any future fsToOssUrl workdir-branch bug).
  const expectedFilePrefix = `/oss/${workdirBase}/`;
  assert(
    audios.every((a) => typeof a.data?.filePath === "string" && a.data.filePath.startsWith(expectedFilePrefix)),
    "F2 (WR-07): every audio.data.filePath synthesized as /oss/{slug}/... (production-realistic)",
    `expected prefix '${expectedFilePrefix}'; got ${audios.map((a) => a.data?.filePath).join(", ")}`,
  );
  assert(
    typeof videos[0]?.data?.filePath === "string" && videos[0].data.filePath.startsWith(expectedFilePrefix),
    "F2 (WR-07): video.data.filePath synthesized as /oss/{slug}/... (production-realistic)",
    `expected prefix '${expectedFilePrefix}'; got '${videos[0]?.data?.filePath}'`,
  );

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
