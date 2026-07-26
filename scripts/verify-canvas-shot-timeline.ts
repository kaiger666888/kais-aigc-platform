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
 *   E. CANVAS-03 additive-only (frontend): packages/infinite-canvas/ diff scoped
 *      to AssetNode.tsx typeIcons only (PRESENT-05 v1.1 relaxation; baseline
 *      HEAD~1..HEAD isolates the Phase 9 commit — origin/master advanced past
 *      the branch tip so origin/master..HEAD carried ~56 pre-existing files).
 *   E2. CANVAS-03 additive-only (schema): canvasAssetSchema.ts strictness preserved
 *       (.optional() / .nullable() counts not increased vs origin/master)
 *   F. Roundtrip: manifest fields survive into node.data (zone label,
 *      video duration_sec, audio engine, video resolution, storyboard shot_id)
 *   Phase 9 (PRESENT-04/05): a second run against the v1.1 fixture asserts 2
 *   character + 1 prop asset nodes (assetType character/prop, NOT delivery),
 *   OSS-synthesized thumbnailUrl, output_key char_NNN/prop_NNN patterns, zero
 *   delivery leaks (§7 post-process), and graceful-degrade on the v1.0 fixture.
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
// Phase 9 (PRESENT-04/05): v1.1 fixture with character/prop registry_snapshot.
const V11_FIXTURE = path.resolve(__dirname, "fixtures/shot-timeline-v1.1");
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
  // Phase 9 (PRESENT-04): character/prop asset nodes (v1.1 registry). v1.0 ep01
  // has no registry → these stay 0 (graceful-degrade, D-PRESENT-04-Q3 gate).
  const characters = childNodes.filter((n) => n.type === "asset" && (n.data as any)?.assetType === "character");
  const props = childNodes.filter((n) => n.type === "asset" && (n.data as any)?.assetType === "prop");
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
  // PRESENT-04 graceful-degrade regression: v1.0 ep01 has no registry_snapshot
  // and no data.characters/props → MUST emit zero character/prop nodes.
  assert(
    characters.length === 0 && props.length === 0,
    "PRESENT-04 graceful-degrade: v1.0 ep01 (no registry) emits 0 character/prop nodes",
    `got characters=${characters.length} props=${props.length}`,
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

  // ── Assert E: additive-only — frontend scoped relaxation (PRESENT-05) ──
  // v1.0 invariant was "packages/infinite-canvas/ diff empty". PRESENT-05
  // intentionally relaxes this for v1.1's cosmetic AssetNode.tsx typeIcons
  // addition (character:'🧑' / prop:'🔧') — a sanctioned additive map extension.
  // SPIRIT preserved: no new components, no renderer structural changes, no
  // custom renderer. The scoped allowlist IS the relaxation.
  //
  // WR-01: baseline against `git merge-base origin/master HEAD` (the actual
  // divergence point) instead of the prior `HEAD~1..HEAD`. merge-base is stable
  // across future commits on this branch (adding commit N+1 doesn't shift it),
  // whereas HEAD~1 is commit-structure-dependent — a follow-up unrelated commit
  // would make HEAD~1..HEAD carry only that commit, and the gate would pass
  // vacuously while an offending packages/infinite-canvas/ file lives in the
  // tree. mergeBase + baselineCompareOk are reused by WR-02 (AssetNode.tsx
  // hunk-content check below). Fail loud if origin/master is missing (shallow
  // clone / CI) per the WR-08 pattern — never pass vacuously.
  let mergeBase = "";
  let baselineCompareOk: boolean | null = null;
  let baselineDiffStatus = "";
  try {
    mergeBase = execSync("git merge-base origin/master HEAD", {
      cwd: WORKTREE_CWD,
      encoding: "utf8",
    }).trim();
    if (!mergeBase) {
      baselineDiffStatus = "(merge-base returned empty — origin/master missing?)";
      baselineCompareOk = null;
    } else {
      baselineCompareOk = true;
    }
  } catch (err) {
    baselineDiffStatus = `(merge-base failed: ${(err as Error).message}). Shallow clone? Run: git fetch origin master:master`;
    baselineCompareOk = null;
  }

  let treeDiff = "";
  if (baselineCompareOk === true) {
    try {
      treeDiff = execSync(
        `git diff --name-only ${mergeBase}..HEAD -- packages/infinite-canvas/`,
        { cwd: WORKTREE_CWD, encoding: "utf8" },
      ).trim();
    } catch (err) {
      treeDiff = `(git diff failed: ${(err as Error).message})`;
    }
  }
  const allowedFrontendFiles = new Set([
    "packages/infinite-canvas/src/components/nodes/AssetNode.tsx",
  ]);
  const diffFiles = treeDiff === "" ? [] : treeDiff.split("\n").map((s) => s.trim()).filter(Boolean);
  const violationFiles = diffFiles.filter((f) => !allowedFrontendFiles.has(f));
  assert(
    baselineCompareOk === true && violationFiles.length === 0,
    "CANVAS-03 additive-only: packages/infinite-canvas/ diff (merge-base..HEAD) limited to AssetNode.tsx (PRESENT-05)",
    baselineDiffStatus ||
      (violationFiles.length === 0
        ? (diffFiles.length === 0 ? "(empty)" : diffFiles.join(", "))
        : `violations: ${violationFiles.join(", ")}`),
  );

  // ── WR-02: tighten AssetNode.tsx allowlist to "typeIcons map additions only" ──
  // The file-level allowlist above passes for ANY change to AssetNode.tsx. The
  // PRESENT-05 SPIRIT is "cosmetic typeIcons emoji-map extension only" — a future
  // dangerouslySetInnerHTML / new render branch / inline <script> / new import
  // would also pass the file allowlist and silently widen the frontend attack
  // surface. Verify the AssetNode.tsx diff (merge-base..HEAD) is PURELY ADDITIVE
  // (no removed content lines) AND every added line is a typeIcons map entry
  // (`key:'emoji'` tuples, possibly several per line) or a `//` comment. Any
  // non-conforming addition fails loud. Reuses mergeBase/baselineCompareOk above.
  const assetNodeRel = "packages/infinite-canvas/src/components/nodes/AssetNode.tsx";
  let assetNodeDiff = "";
  if (baselineCompareOk === true) {
    try {
      assetNodeDiff = execSync(
        `git diff ${mergeBase}..HEAD -- ${assetNodeRel}`,
        { cwd: WORKTREE_CWD, encoding: "utf8" },
      );
    } catch (err) {
      assetNodeDiff = "";
    }
  }
  const assetDiffLines = assetNodeDiff ? assetNodeDiff.split("\n") : [];
  const addedLines = assetDiffLines.filter((l) => l.startsWith("+") && !l.startsWith("+++"));
  const removedLines = assetDiffLines.filter((l) => l.startsWith("-") && !l.startsWith("---"));
  // Allowed added line: blank, `//` comment, or one-or-more `key: 'value',` map
  // tuples (e.g. `character: '🧑', prop: '🔧',`). Rejects `const `, `import `,
  // `dangerouslySetInnerHTML`, `return (`, `<script`, new JSX, etc.
  const isAllowedTypeIconsAddition = (line: string): boolean => {
    const body = line.slice(1); // strip leading '+'
    const trimmed = body.trim();
    if (trimmed === "") return true;
    if (trimmed.startsWith("//")) return true;
    return /^(\w+:\s*'[^']*',?\s*)+$/.test(trimmed);
  };
  const badAdditions = addedLines.filter((l) => !isAllowedTypeIconsAddition(l));
  assert(
    baselineCompareOk === true &&
      removedLines.length === 0 &&
      badAdditions.length === 0 &&
      addedLines.length > 0,
    "CANVAS-03 additive-only: AssetNode.tsx diff limited to typeIcons map additions (PRESENT-05 spirit)",
    baselineDiffStatus ||
      (removedLines.length > 0
        ? `removed lines (non-additive): ${removedLines.slice(0, 5).join(" | ")}`
        : badAdditions.length > 0
          ? `non-map additions: ${badAdditions.slice(0, 5).join(" | ")}`
          : addedLines.length === 0
            ? "(no AssetNode.tsx diff — expected at least the typeIcons additions)"
            : "ok"),
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

  // ═══════════════════════════════════════════════════════════════════
  // Phase 9 (PRESENT-04/05): v1.1 fixture — character/prop registry emission
  // ═══════════════════════════════════════════════════════════════════
  // The v1.0 ep01 assertions above are the regression gate (must stay green).
  // Below: a SECOND run against the v1.1 fixture (schema_version "1.1" with a
  // generator.registry_snapshot of 2 characters + 1 prop) exercising the §7
  // post-process that overwrites assetType from the seeded "delivery" to
  // "character"/"prop" + synthesizes thumbnailUrl via fsToOssUrl.
  console.log("\n=== Phase 9 v1.1 fixture (PRESENT-04/05) ===\n");

  const v11ManifestPath = path.join(V11_FIXTURE, "asset.json");
  const v11Manifest = JSON.parse(fs.readFileSync(v11ManifestPath, "utf8"));
  const v11WorkdirBase = path.basename(V11_FIXTURE.replace(/\/$/, ""));
  setWorkdirToOss({ workdir: V11_FIXTURE, ossPrefix: `/oss/${v11WorkdirBase}` });

  const v11Out = await extractShotTimelineArtifacts(v11Manifest, V11_FIXTURE, v11ManifestPath);
  const v11Nodes = v11Out.nodes;
  const v11Chars = v11Nodes.filter((n: any) => n.type === "asset" && (n.data as any)?.assetType === "character");
  const v11Props = v11Nodes.filter((n: any) => n.type === "asset" && (n.data as any)?.assetType === "prop");
  const v11Delivery = v11Nodes.filter((n: any) => n.type === "asset" && (n.data as any)?.assetType === "delivery");

  assert(
    v11Chars.length === 2,
    "PRESENT-04: exactly 2 character nodes from v1.1 fixture registry",
    `got ${v11Chars.length}`,
  );
  assert(
    v11Props.length === 1,
    "PRESENT-04: exactly 1 prop node from v1.1 fixture registry",
    `got ${v11Props.length}`,
  );
  assert(
    v11Chars.every((n: any) => {
      const u = (n.data as any)?.thumbnailUrl;
      return typeof u === "string" && u.startsWith("/oss/");
    }),
    "PRESENT-04 §7 post-process: every character node carries an OSS-synthesized thumbnailUrl",
    `got ${v11Chars.map((n: any) => (n.data as any)?.thumbnailUrl).join(", ")}`,
  );
  assert(
    v11Props.every((n: any) => {
      const u = (n.data as any)?.thumbnailUrl;
      return typeof u === "string" && u.startsWith("/oss/");
    }),
    "PRESENT-04 §7 post-process: every prop node carries an OSS-synthesized thumbnailUrl",
    `got ${v11Props.map((n: any) => (n.data as any)?.thumbnailUrl).join(", ")}`,
  );
  assert(
    v11Chars.every((n: any) => /^char_\d{3}$/.test(String((n.data as any)?.output_key))),
    "PRESENT-04 Q5: character output_key is the stable registry id char_NNN",
    `got ${v11Chars.map((n: any) => (n.data as any)?.output_key).join(", ")}`,
  );
  assert(
    v11Props.every((n: any) => /^prop_\d{3}$/.test(String((n.data as any)?.output_key))),
    "PRESENT-04 Q5: prop output_key is the stable registry id prop_NNN",
    `got ${v11Props.map((n: any) => (n.data as any)?.output_key).join(", ")}`,
  );
  assert(
    v11Delivery.length === 0,
    "PRESENT-04 §7: zero asset nodes leak as assetType=delivery (post-process overrode the seed)",
    `got ${v11Delivery.length} delivery asset nodes`,
  );

  // ── WR-03: validateGraphNodes on v1.1 child nodes (CR-01 regression catch) ──
  // The v1.0 ep01 run asserts validateGraphNodes(childNodes).length === 0 (Step D
  // above) — the canonical regression catch for save-v2 per-type Zod failures.
  // The v1.1 fixture run ORIGINALLY SKIPPED this, which is precisely why CR-01
  // (character/prop asset nodes lacking the universalRequired `filePath`) slipped
  // through: the v1.1 assertions checked counts/thumbnailUrl/output_key but
  // never re-ran per-type Zod, so the missing filePath was invisible. Mirror
  // Step D here so any future regression on character/prop asset nodes
  // (filePath / label / assetType) fails loud at verify time, not at the next
  // save-v2 HTTP 400.
  const v11ChildNodes = v11Nodes.filter((n: any) => n.type !== "zone" && !n.id.startsWith("sum-"));
  const v11Errors = validateGraphNodes(v11ChildNodes);
  assert(
    v11Errors.length === 0,
    "PRESENT-04 CANVAS-03: all v1.1 child nodes pass per-type Zod (regression catch for missing filePath / label)",
    v11Errors.length === 0
      ? undefined
      : v11Errors.map((e) => `${e.nodeId}: ${e.errors}`).join(" | "),
  );

  // ═══════════════════════════════════════════════════════════════════
  // Phase 17 (CONSUMER-01): v1.2 fixture — dialogue/music/sfx audio child emission
  // ═══════════════════════════════════════════════════════════════════
  // The v1.0 + v1.1 sections above are the regression gate (must stay green).
  // This THIRD run against the v1.2 fixture (schema_version "1.2" + audio_semantic
  // sidecar with dialogue/music/sfx modalities) exercises the §7 post-process
  // that overrides assetType from the seeded "delivery" to "dialogue"/"music"
  // /"sfx". Gated on KNOWN_VERSIONS.has("1.2") (Task 1) — older consumers
  // skip emission entirely (T-17-01 graceful-degrade contract).
  console.log("\n=== Phase 17 v1.2 fixture (CONSUMER-01) ===\n");

  const V12_FIXTURE = path.resolve(__dirname, "fixtures/shot-timeline-v1.2");
  const v12ManifestPath = path.join(V12_FIXTURE, "asset.json");
  const v12Manifest = JSON.parse(fs.readFileSync(v12ManifestPath, "utf8"));
  const v12WorkdirBase = path.basename(V12_FIXTURE.replace(/\/$/, ""));
  setWorkdirToOss({ workdir: V12_FIXTURE, ossPrefix: `/oss/${v12WorkdirBase}` });

  const v12Out = await extractShotTimelineArtifacts(v12Manifest, V12_FIXTURE, v12ManifestPath);
  const v12Nodes = v12Out.nodes;

  // Classify audio children by assetType (set by §7 post-process override).
  const v12Dialogue = v12Nodes.filter((n: any) => n.type === "asset" && (n.data as any)?.assetType === "dialogue");
  const v12Music = v12Nodes.filter((n: any) => n.type === "asset" && (n.data as any)?.assetType === "music");
  const v12Sfx = v12Nodes.filter((n: any) => n.type === "asset" && (n.data as any)?.assetType === "sfx");
  const v12Delivery = v12Nodes.filter((n: any) => n.type === "asset" && (n.data as any)?.assetType === "delivery");
  // Confirm v1.1 character/prop children still emit on the v1.2 fixture
  // (registry_snapshot carried verbatim — zero-regression proof).
  const v12Chars = v12Nodes.filter((n: any) => n.type === "asset" && (n.data as any)?.assetType === "character");
  const v12Props = v12Nodes.filter((n: any) => n.type === "asset" && (n.data as any)?.assetType === "prop");

  // (a) fixture: Shot 1 has dialogue + sfx + reproduction.music_gen non-null
  //     (3 children); Shot 2 has dialogue only (1 child). Total = 2 dialogue +
  //     1 music + 1 sfx = 4 audio children.
  assert(
    v12Dialogue.length === 2,
    "CONSUMER-01: exactly 2 dialogue children (one per shot with non-null dialogue)",
    `got ${v12Dialogue.length}`,
  );
  assert(
    v12Music.length === 1,
    "CONSUMER-01: exactly 1 music child (Shot 1 only — reproduction.music_gen non-null)",
    `got ${v12Music.length}`,
  );
  assert(
    v12Sfx.length === 1,
    "CONSUMER-01: exactly 1 sfx child (Shot 1 only — sfx.description non-empty)",
    `got ${v12Sfx.length}`,
  );

  // (b) §7 post-process overrode the seeded "delivery" → zero assetType=delivery leak
  //     (character/prop from v1.1 layer also non-delivery after their (e.2) override).
  assert(
    v12Delivery.length === 0,
    "CONSUMER-01 §7: zero asset nodes leak as assetType=delivery (post-process overrode the seed)",
    `got ${v12Delivery.length} delivery asset nodes`,
  );

  // (c) stable output_key pattern — audio children use audio_{dia,mus,sfx}_{shot_id}
  assert(
    v12Dialogue.every((n: any) => /^audio_dia_\d+$/.test(String((n.data as any)?.output_key))),
    "CONSUMER-01: dialogue output_key matches ^audio_dia_\\d+$",
    `got ${v12Dialogue.map((n: any) => (n.data as any)?.output_key).join(", ")}`,
  );
  assert(
    v12Music.every((n: any) => /^audio_mus_\d+$/.test(String((n.data as any)?.output_key))),
    "CONSUMER-01: music output_key matches ^audio_mus_\\d+$",
    `got ${v12Music.map((n: any) => (n.data as any)?.output_key).join(", ")}`,
  );
  assert(
    v12Sfx.every((n: any) => /^audio_sfx_\d+$/.test(String((n.data as any)?.output_key))),
    "CONSUMER-01: sfx output_key matches ^audio_sfx_\\d+$",
    `got ${v12Sfx.map((n: any) => (n.data as any)?.output_key).join(", ")}`,
  );

  // (d) MUS-04 LOCKED — zero audio children carry an instruments field.
  //     T-17-02 mitigation: music child carries ONLY reproduction.music_gen
  //     payload; tempo/mood/key/VA + instruments fields DO NOT EXIST in v1.2.
  const allV12AssetNodes = v12Nodes.filter((n: any) => n.type === "asset");
  const instrumentsLeaks = allV12AssetNodes.filter((n: any) =>
    (n.data as any)?.instruments != null || (n.data as any)?.instrument != null,
  );
  assert(
    instrumentsLeaks.length === 0,
    "CONSUMER-01 MUS-04: zero audio children carry an instruments field (deferred v1.3)",
    `got ${instrumentsLeaks.length} instruments leaks`,
  );

  // (e) v1.1 regression — character/prop children still emit on the v1.2 fixture
  //     (registry_snapshot carried verbatim from v1.1 fixture).
  assert(
    v12Chars.length === 2,
    "CONSUMER-01 regression: v1.1 character children still emit on v1.2 fixture (registry carried)",
    `got ${v12Chars.length}`,
  );
  assert(
    v12Props.length === 1,
    "CONSUMER-01 regression: v1.1 prop children still emit on v1.2 fixture (registry carried)",
    `got ${v12Props.length}`,
  );

  // (f) per-type Zod green on ALL v1.2 child nodes (CR-01 regression catch,
  //     mirror v1.1 WR-03 at :449-457). Catches missing filePath / label on
  //     any future audio child regression.
  const v12ChildNodes = v12Nodes.filter((n: any) => n.type !== "zone" && !n.id.startsWith("sum-"));
  const v12Errors = validateGraphNodes(v12ChildNodes);
  assert(
    v12Errors.length === 0,
    "CONSUMER-01 CANVAS-03: all v1.2 child nodes pass per-type Zod (regression catch for missing filePath / label / assetType)",
    v12Errors.length === 0
      ? undefined
      : v12Errors.map((e) => `${e.nodeId}: ${e.errors}`).join(" | "),
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
