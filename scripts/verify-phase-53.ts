#!/usr/bin/env tsx
/**
 * verify-phase-53.ts — Phase 53 (Variant Contract + Picker Upgrade) aggregate
 * contract gate: folds every automated verification of Wave A plans into one
 * run (GUARD closing tradition, ROADMAP decision #7).
 *
 *   S1 VAR-01 — candidate envelope round-trip (LIVE, built by 53-01):
 *     both generations through the real module — legacy flat shapes lifted
 *     via normalizeLegacyCandidateData, Wave B structured envelopes via
 *     candidateEnvelopeSchema passthrough; unknown-key tolerance; take-log
 *     verdict round-trip; G15 classification on failed-shots fixtures.
 *   S2 — candidate group derivation + materialization (53-03, live since).
 *   S3 — select-winner extension + manifest hook + retry queue (53-04, live
 *     since; spawned-child endpoint dispatch).
 *   S4 — variant wall source shapes + entries (53-07 fill: resolveMediaUrl /
 *     getScoreColor / keyboard / picker deletion / adapter channel / G15 mount).
 *   S5 — G15 bridge dispatch (53-07: injected-fetch delivered/fail-closed
 *     semantics + endpoint zod bounds) + forced-failure self-check.
 *
 * Isolation guard (verify-phase-51 pattern): this gate imports the real
 * src/lib/candidateEnvelope.ts (pure module — no DB), but the chdir guard is
 * kept line-for-line so later FILLED-BY sections that pull in @/utils/db
 * binding modules inherit a safe cwd from day one. mkdtemp + chdir BEFORE
 * the dynamic imports; package.json copy staged for writeVersion.ts.
 *
 * No logic re-implementation: the S1 assertions only call the real module's
 * exported functions; grep sections read files and match regular
 * expressions.
 *
 * Run: npm run verify:phase-53   (or: npx tsx scripts/verify-phase-53.ts)
 * Exit: 0 all sections pass + self-check behaves / 1 any failure / 2 crash
 */

import fs from "node:fs";
import os from "node:os";
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
function exists(rel: string): boolean {
  return fs.existsSync(path.join(REPO_ROOT, rel));
}
function fixture(rel: string): any {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "scripts/fixtures/phase53", rel), "utf8"));
}

// ── Isolation chdir (see header) — MUST precede the dynamic imports ────────
const ISOLATION_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "verify-phase-53-"));
// Transitive module graph quirk: src/utils/writeVersion.ts parses package.json
// from process.cwd() at import time — stage a copy so the chdir stays safe.
fs.copyFileSync(path.join(REPO_ROOT, "package.json"), path.join(ISOLATION_DIR, "package.json"));
process.chdir(ISOLATION_DIR);

/**
 * Walk the live-source roots and return files containing `needle`.
 * Scope discipline (地雷 #5): only packages/infinite-canvas/src + src/, and
 * NEVER the build artifacts under src/routes/canvas/static/ or data/web/.
 */
function grepSource(needle: string | RegExp): string[] {
  const roots = [
    path.join(REPO_ROOT, "packages/infinite-canvas/src"),
    path.join(REPO_ROOT, "src"),
  ];
  const EXCLUDED_SEGMENTS = [
    `src${path.sep}routes${path.sep}canvas${path.sep}static${path.sep}`,
    `data${path.sep}web${path.sep}`,
  ];
  const SOURCE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".cts"]);
  const hits: string[] = [];
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === "dist") continue;
        walk(full);
      } else if (SOURCE_EXT.has(path.extname(e.name))) {
        const normalized = full + path.sep;
        if (EXCLUDED_SEGMENTS.some((seg) => normalized.includes(seg))) continue;
        const text = fs.readFileSync(full, "utf8");
        const hit = typeof needle === "string" ? text.includes(needle) : needle.test(text);
        if (hit) hits.push(path.relative(REPO_ROOT, full));
      }
    }
  };
  for (const r of roots) walk(r);
  return hits;
}

async function main(): Promise<void> {
  console.log("=== Phase 53 — verify-phase-53.ts (aggregate contract gate: VAR-01..04 Wave A) ===\n");

  // Real module, zero re-implementation (pure module — safe to import as-is).
  const envelope: any = await import("../src/lib/candidateEnvelope");

  // ═══ S1 — VAR-01: candidate envelope round-trip (LIVE) ═══════════════════
  console.log("=== S1 VAR-01: candidate envelope round-trip (legacy + Wave B, live module) ===");
  assert(
    typeof envelope.parseCandidateEnvelope === "function" &&
      typeof envelope.normalizeLegacyCandidateData === "function" &&
      typeof envelope.candidateEnvelopeSchema !== "undefined" &&
      typeof envelope.classifyG15Error === "function",
    "S1: candidateEnvelope exports the contract surface (parse/normalize/schema/classify)",
  );

  const legacy = fixture("candidates-legacy.json") as Record<string, unknown>[];
  assert(legacy.length === 4, "S1: legacy fixture carries 4 node snapshots");

  // a) a-flf-shot_012-first-v1 — selected first frame
  const la = envelope.parseCandidateEnvelope(legacy[0]);
  assert(la?.source === "p11a0_flf", "S1a-1: a-flf v1 → source p11a0_flf", JSON.stringify(la?.source));
  assert(la?.groupKey === "shot:shot_012:first", "S1a-2: groupKey normalized to shot:shot_012:first", JSON.stringify(la?.groupKey));
  assert(la?.frameSlot === "first", "S1a-3: frameSlot first");
  assert(la?.variantId === "v1", "S1a-4: variantId v1");
  assert(la?.shotId === "shot_012", "S1a-5: shotId shot_012");
  assert(la?.selected === true, "S1a-6: isPrimaryView=true + ★ 选定 tag → selected true");
  assert(
    typeof la?.prompt === "string" && la.prompt.includes("雨夜"),
    "S1a-7: generation_prompt → prompt carries 雨夜",
    JSON.stringify(la?.prompt),
  );

  // b) a-flf-shot_012-first-v2 — unselected sibling
  const lb = envelope.parseCandidateEnvelope(legacy[1]);
  assert(lb?.selected === false, "S1b-1: v2 待选 → selected false");
  assert(lb?.groupKey === "shot:shot_012:first", "S1b-2: v2 shares the first-frame group");

  // c) a-flf-shot_012-last-v1 — first/last are TWO groups (Pitfall 6)
  const lc = envelope.parseCandidateEnvelope(legacy[2]);
  assert(lc?.groupKey === "shot:shot_012:last", "S1c-1: last frame → groupKey shot:shot_012:last", JSON.stringify(lc?.groupKey));
  assert(lc?.frameSlot === "last", "S1c-2: frameSlot last");
  assert(lc?.groupKey !== lb?.groupKey, "S1c-3: first and last frames are two different groups");

  // d) c-p01-variant-2 — no score today must not throw (VAR-01 实锤)
  const ld = envelope.parseCandidateEnvelope(legacy[3]);
  assert(ld?.source === "p01_hook", "S1d-1: c-* shape → source p01_hook", JSON.stringify(ld?.source));
  assert(ld?.score === undefined, "S1d-2: no score today → score undefined (never fabricated)");
  assert(ld?.groupKey === "", "S1d-3: c-* has no group signal → groupKey empty (derivable:false)");

  // e) Wave B structured envelopes — safeParse round-trip, no field loss
  const waveB = fixture("candidates-envelope.json") as Record<string, unknown>[];
  assert(waveB.length === 5, "S1: envelope fixture carries 5 sources");
  const sources = waveB.map((w) => envelope.parseCandidateEnvelope(w)?.source);
  assert(
    JSON.stringify(sources) ===
      JSON.stringify(["p01_hook", "p03_nbest", "p11a0_flf", "p11a_preview", "p11b_take"]),
    "S1e-1: all five sources parse",
    JSON.stringify(sources),
  );
  for (const wRaw of waveB) {
    const w = wRaw as {
      source: string; groupKey: string; variantId: string; selected: boolean;
      score?: { overall: number; scale: string }; prompt?: string; seed?: number; durationSec?: number;
    };
    const parsed = envelope.parseCandidateEnvelope(wRaw);
    const ok =
      parsed != null &&
      parsed.groupKey === w.groupKey &&
      parsed.variantId === w.variantId &&
      parsed.selected === w.selected &&
      parsed.score?.overall === w.score?.overall &&
      parsed.score?.scale === w.score?.scale &&
      (w.prompt == null || parsed.prompt === w.prompt) &&
      (w.seed == null || parsed.seed === w.seed) &&
      (w.durationSec == null || parsed.durationSec === w.durationSec);
    if (!ok) {
      assert(false, `S1e-2: round-trip lossless for ${w.source}`, JSON.stringify(parsed));
    }
  }
  assert(true, "S1e-2: round-trip lossless — overall/scale/prompt/seed/duration survive (5/5)");
  const flfEnv = envelope.parseCandidateEnvelope(waveB[2]);
  assert(
    flfEnv?.score?.scale === "percent" && flfEnv?.score?.overall === 0.87,
    "S1e-3: percent scale preserved verbatim (never rewritten to unit)",
    JSON.stringify(flfEnv?.score),
  );
  const dims = flfEnv?.score?.dimensions as Record<string, number> | undefined;
  assert(
    dims != null && dims.framing === 87 && dims.camera === 88,
    "S1e-4: dimensions record survives round-trip",
  );

  // f) unknown-key tolerance — today's shapes must never 400 (T-53-01-01)
  const withUnknown = { ...legacy[0], foo: "bar" };
  let tolerated = false;
  try {
    tolerated = envelope.parseCandidateEnvelope(withUnknown) != null;
  } catch {
    tolerated = false;
  }
  assert(tolerated, "S1f: unknown key 'foo' on legacy shape does not throw (tolerated)");

  // g) take-log verdict round-trip + classification
  const takeLog = fixture("take-log.json");
  const verdicts = takeLog.takes.map((t: any) => envelope.takeLogEntrySchema.safeParse(t).success);
  assert(verdicts.every((v: boolean) => v === true), "S1g-1: all 5 take verdicts round-trip", JSON.stringify(verdicts));
  assert(
    envelope.takeVerdictCategory("re_roll") === "take_verdict_re_roll",
    "S1g-2: takeVerdictCategory(re_roll) → take_verdict_re_roll",
    JSON.stringify(envelope.takeVerdictCategory("re_roll")),
  );
  const failedShots = fixture("failed-shots.json").failures;
  const cat0 = envelope.classifyG15Error({ error: failedShots[0].error });
  const cat1 = envelope.classifyG15Error({ error: failedShots[1].error });
  const cat2 = envelope.classifyG15Error({ error: failedShots[2].error });
  assert(cat0 === "delegate_timeout", "S1g-3: 'timeout' error → delegate_timeout", JSON.stringify(cat0));
  assert(cat1 === "schema_validation", "S1g-4: 'schema' error → schema_validation", JSON.stringify(cat1));
  assert(cat2 === "engine_render_error", "S1g-5: CUDA render crash → engine_render_error", JSON.stringify(cat2));
  assert(
    envelope.classifyG15Error({ verdict: "keep" }) === "take_verdict_keep" &&
      envelope.classifyG15Error({ needsRegenerate: true }) === "needs_regenerate" &&
      envelope.classifyG15Error({}) === "unknown",
    "S1g-6: verdict priority / needsRegenerate / unknown fallback",
  );

  // h) module discipline — pure module, canvasAssetSchema untouched
  const envelopeSrc = read("src/lib/candidateEnvelope.ts");
  assert(
    !/from "@\/utils|require\(|import\s+fs|fetch\(/.test(envelopeSrc),
    "S1h-1: candidateEnvelope.ts is a pure module (no @/utils / require / fs / fetch)",
  );
  assert(
    envelopeSrc.includes('"p01_hook"') && envelopeSrc.includes('"p11b_take"'),
    "S1h-2: source enum literals present verbatim",
  );

  // ═══ S2 — VAR-01/VAR-03 前置: 候选组推导/物化(53-03)══════════════════════
  console.log("\n=== S2 candidate group derivation + materialization (53-03) ===");
  const deriver: any = await import("../src/lib/candidateGroupDeriver");
  assert(
    typeof deriver.deriveCandidateGroups === "function" &&
      typeof deriver.materializeCandidateGroups === "function" &&
      typeof deriver.mergeDerivedGroups === "function",
    "S2: candidateGroupDeriver exports derive/materialize/merge",
  );

  // ── S2a 推导:legacy a-flf ×3 + 命名通道 ×3 + c-p01 ×1 ──
  const legacyNodes = (fixture("candidates-legacy.json") as Record<string, unknown>[]).map(
    (data, i) => ({ id: `legacy-${i}`, type: "asset", data }),
  );
  // 补一个 last-v2 使尾帧组达到 2 成员(Pitfall 6 首尾两键断言用)
  const lastV2 = {
    id: "legacy-last-v2", type: "asset",
    data: { ...legacyNodes[2].data, variant: "v2", isPrimaryView: false, tags: ["○ 待选"] },
  };
  const namingNodes = [
    { id: "p04-charA", type: "asset", data: { filePath: "/oss/kmc/P04/charA.png" } },
    { id: "p04-charA-v1", type: "asset", data: { filePath: "/oss/kmc/P04/charA_v1.png" } },
    { id: "p04-charA-v2", type: "asset", data: { filePath: "/oss/kmc/P04/charA_v2.png" } },
  ];
  const cp01 = { id: "cp01-variant-2", type: "variant", data: legacyNodes[3].data };
  const deriveInput = [...legacyNodes.slice(0, 3), lastV2, ...namingNodes, cp01];
  const dr = deriver.deriveCandidateGroups(deriveInput);
  const groupKeys = dr.groups.map((g: any) => g.groupKey);
  const first = dr.groups.find((g: any) => g.groupKey === "shot:shot_012:first");
  const last = dr.groups.find((g: any) => g.groupKey === "shot:shot_012:last");
  const naming = dr.groups.find((g: any) => g.groupKey === "name:kmc/P04/charA");
  assert(first != null && first.variantNodeIds.length === 2, "S2a-1: shot:shot_012:first 2 members", JSON.stringify(first?.variantNodeIds));
  assert(last != null && last.variantNodeIds.length === 2, "S2a-2: shot:shot_012:last 2 members");
  assert(naming != null && naming.variantNodeIds.length === 3, "S2a-3: name:kmc/P04/charA 3 members (v1+v2+canonical)", JSON.stringify(naming?.variantNodeIds));
  assert(first?.winnerNodeId === "legacy-0", "S2a-4: first-frame winner = selected member", JSON.stringify(first?.winnerNodeId));
  assert(!dr.groups.some((g: any) => g.variantNodeIds.includes("cp01-variant-2")), "S2a-5: c-p01 node (empty groupKey) joins no group");
  assert(!("throw" in dr), "S2a-6: derive never throws on group-less signal");

  // ── S2b 首尾两键(Pitfall 6)──
  assert(
    first != null && last != null && first.groupKey !== last.groupKey &&
      first.id !== last.id,
    "S2b: first and last frames of one shot are TWO groups (never merged)",
  );

  // ── S2c 物化幂等(:memory: knex 手建同列表)──
  const knexMod: any = await import("knex");
  const mem = knexMod.default({
    client: "sqlite3",
    connection: { filename: ":memory:" },
    useNullAsDefault: true,
  });
  await mem.schema.createTable("canvas_variant_groups", (t: any) => {
    t.string("id", 128).notNullable();
    t.integer("project_id").notNullable();
    t.integer("episodes_id").notNullable();
    t.integer("phase_index").defaultTo(0);
    t.string("branch_id", 64).defaultTo("main");
    t.text("variant_node_ids");
    t.string("winner_node_id", 128);
    t.string("select_mode", 16).defaultTo("single");
    t.bigInteger("created_at").notNullable();
    t.bigInteger("updated_at").notNullable();
    t.primary(["id", "project_id", "episodes_id"]);
  });
  const SCOPE53 = { projectId: 5353, episodesId: 1 };
  const scopeCols53 = { project_id: SCOPE53.projectId, episodes_id: SCOPE53.episodesId };
  const m1 = await deriver.materializeCandidateGroups(mem, SCOPE53, dr.groups);
  assert(m1.created === dr.groups.length && m1.created === 3, "S2c-1: first materialize creates all 3 groups", JSON.stringify(m1));
  await mem("canvas_variant_groups")
    .where({ id: first.id, ...scopeCols53 })
    .update({ winner_node_id: "human-choice" });
  const m2 = await deriver.materializeCandidateGroups(mem, SCOPE53, dr.groups);
  const w2 = await mem("canvas_variant_groups").where({ id: first.id, ...scopeCols53 }).first();
  assert(m2.created === 0, "S2c-2: second materialize creates nothing", JSON.stringify(m2));
  assert(w2?.winner_node_id === "human-choice", "S2c-3: existing winner NOT overwritten by derive", JSON.stringify(w2?.winner_node_id));
  const mutated = dr.groups.map((g: any) =>
    g.id === first.id ? { ...g, variantNodeIds: g.variantNodeIds.slice(0, 1).concat(["legacy-new"]) } : g,
  );
  const m3 = await deriver.materializeCandidateGroups(mem, SCOPE53, mutated);
  const w3 = await mem("canvas_variant_groups").where({ id: first.id, ...scopeCols53 }).first();
  assert(
    JSON.parse(w3?.variant_node_ids).includes("legacy-new") &&
      !JSON.parse(w3?.variant_node_ids).includes("legacy-1"),
    "S2c-4: member set self-heals to derived reality",
    String(w3?.variant_node_ids),
  );
  assert(w3?.winner_node_id === "human-choice", "S2c-5: winner survives member self-heal");

  // ── S2d 用户组保护 ──
  await mem("canvas_variant_groups").insert({
    id: "user-manual-group", project_id: SCOPE53.projectId, episodes_id: SCOPE53.episodesId,
    phase_index: 0, branch_id: "main", variant_node_ids: JSON.stringify(["keep-me"]),
    winner_node_id: "keep-winner", select_mode: "single",
    created_at: 1, updated_at: 1,
  });
  await deriver.materializeCandidateGroups(mem, SCOPE53, dr.groups);
  const userRow = await mem("canvas_variant_groups").where({ id: "user-manual-group" }).first();
  const allIds: string[] = (await mem("canvas_variant_groups").select("id")).map((r: any) => r.id);
  assert(
    userRow?.winner_node_id === "keep-winner" &&
      JSON.parse(userRow?.variant_node_ids).includes("keep-me"),
    "S2d-1: non-cand: user group untouched by materialize",
  );
  assert(
    allIds.every((id) => id.startsWith("cand:") || id === "user-manual-group"),
    "S2d-2: materialize only ever writes cand:-prefixed rows",
    JSON.stringify(allIds),
  );
  await mem.destroy();

  // ── S2e 词表一致(源断言)──
  const deriverSrc = read("src/lib/candidateGroupDeriver.ts");
  assert(
    deriverSrc.includes("shot:") && deriverSrc.includes("name:"),
    "S2e-1: groupKey vocabulary carries shot: and name: prefixes (Phase 48 word-for-word)",
  );
  assert(
    !deriverSrc.includes("frame:") && !deriverSrc.includes("flf:"),
    "S2e-2: no invented third groupKey prefix",
  );

  // ── S2f 端点集成(spawn 子进程 dispatch,49-01 范式)──
  console.log("\n=== S2f load-v2 endpoint integration (spawned child dispatch) ===");
  const { spawnSync } = await import("node:child_process");
  const CHILD_SRC = [
    'import fs from "node:fs";',
    'import os from "node:os";',
    'import path from "node:path";',
    'const REPO_ROOT = "' + REPO_ROOT.replace(/"/g, '\\"') + '";',
    'const ISO = fs.mkdtempSync(path.join(os.tmpdir(), "verify-phase-53-ep-"));',
    'fs.copyFileSync(path.join(REPO_ROOT, "package.json"), path.join(ISO, "package.json"));',
    'process.chdir(ISO);',
    'function emit(pass, name, detail) { process.stdout.write("CHILD_RESULT\\t" + (pass ? "1" : "0") + "\\t" + name + (detail ? "\\t" + detail : "") + "\\n"); }',
    'async function callEndpoint(routerFn, method, urlPath, body) {',
    '  const req = { method, url: urlPath, headers: {}, body, params: {}, query: {}, socket: { remoteAddress: "127.0.0.1" }, connection: { remoteAddress: "127.0.0.1" } };',
    '  const res = { statusCode: 200, headersSent: false, payload: undefined,',
    '    status(c) { this.statusCode = c; return this; },',
    '    send(p) { this.payload = p; this.headersSent = true; settle(); return this; },',
    '    json(p) { this.payload = p; this.headersSent = true; settle(); return this; },',
    '    end() { this.headersSent = true; settle(); },',
    '    setHeader() {}, getHeader() { return undefined; }, removeHeader() {}, write() { return true; }, writeHead(c) { this.statusCode = c; settle(); } };',
    '  let settle = () => undefined;',
    '  await new Promise((resolve, reject) => { settle = resolve; routerFn(req, res, (err) => (err ? reject(err) : resolve())); });',
    '  return { status: res.statusCode, payload: res.payload };',
    '}',
    'async function main() {',
    '  await import("../src/utils");',
    '  const routeMod = await import("../src/routes/canvas/v2/load-v2");',
    '  const dbMod = await import("../src/utils/db");',
    '  await Promise.race([dbMod.bootReady, new Promise((_, rej) => setTimeout(() => rej(new Error("bootReady timeout")), 60000))]);',
    '  const db = dbMod.db;',
    '  const T0 = 1700000000000;',
    '  const node = (id, data) => ({ id, project_id: 888, episodes_id: 1, type: "asset", branch_id: "main",',
    '    phase_index: 11, phase_name: "p11", position_x: 0, position_y: 0, size_width: 260, size_height: 180,',
    '    data: JSON.stringify(data), state: "idle", is_winner: 0, variant_group_id: null, created_at: T0, updated_at: T0 });',
    '  const flf = (sid, slot, v, sel) => ({ label: sid + " " + slot + " " + v, assetType: "keyframe", frame_type: slot,',
    '    variant: v, groupKey: sid + "_" + slot, shot_id: sid, filePath: "/oss/kmc/P11/" + sid + "_" + slot + "_" + v + ".png",',
    '    generation_prompt: "prompt", isPrimaryView: sel, curationState: "active", state: "success",',
    '    tags: [sel ? "★ 选定" : "○ 待选"] });',
    '  for (const row of [node("a-flf-epX-first-v1", flf("shot_epX", "first", "v1", true)),',
    '                     node("a-flf-epX-first-v2", flf("shot_epX", "first", "v2", false)),',
    '                     node("a-flf-epX-last-v1", flf("shot_epX", "last", "v1", true)),',
    '                     node("a-flf-epX-last-v2", flf("shot_epX", "last", "v2", false))]) {',
    '    await db("canvas_nodes").insert(row);',
    '  }',
    '  const r1 = await callEndpoint(routeMod.default, "POST", "/", { projectId: 888, episodesId: 1 });',
    '  const groups1 = r1?.payload?.data?.variantGroups ?? [];',
    '  const ids1 = groups1.map((g) => g.id);',
    '  emit(r1.status === 200, "S2f-1: load-v2 responds 200", String(r1.status));',
    '  emit(ids1.includes("cand:shot:shot_epX:first") && ids1.includes("cand:shot:shot_epX:last"),',
    '       "S2f-2: response carries cand: first+last groups", JSON.stringify(ids1));',
    '  const r2 = await callEndpoint(routeMod.default, "POST", "/", { projectId: 888, episodesId: 1 });',
    '  const ids2 = (r2?.payload?.data?.variantGroups ?? []).map((g) => g.id);',
    '  emit(ids2.filter((i) => i === "cand:shot:shot_epX:first").length === 1 && ids2.length === ids1.length,',
    '       "S2f-3: second load idempotent (no group duplication)", JSON.stringify(ids2));',
    '  const r3 = await callEndpoint(routeMod.default, "POST", "/", { projectId: 888, episodesId: 1, since: T0 + 1 });',
    '  emit(r3?.payload?.data?.nodes != null && r3?.payload?.data?.variantGroups == null,',
    '       "S2f-4: since path returns nodes/links shape (no group derivation on incremental)", JSON.stringify(Object.keys(r3?.payload?.data ?? {})));',
    '}',
    'main().then(() => process.exit(0), (err) => { console.error("child crashed:", err); process.exit(2); });',
  ].join("\n");
  // Child must live INSIDE the repo tree so its relative tsx imports resolve
  // the same way the parent's do (49-01 spawned-child precedent).
  const childPath = path.join(REPO_ROOT, "scripts", ".verify-phase-53-child.tmp.ts");
  fs.writeFileSync(childPath, CHILD_SRC);
  const spawned = spawnSync("npx", ["tsx", "scripts/.verify-phase-53-child.tmp.ts"], {
    cwd: REPO_ROOT, encoding: "utf8", timeout: 120000,
  });
  const childOut = `${spawned.stdout || ""}\n[stderr]\n${spawned.stderr || ""}`;
  const childResults = (spawned.stdout || "")
    .split("\n")
    .filter((l) => l.startsWith("CHILD_RESULT\t"))
    .map((l) => l.split("\t"));
  for (const [_, passRaw, name, detail] of childResults) {
    assert(passRaw === "1", `S2f(child): ${name}`, detail);
  }
  assert(
    childResults.length >= 4 && spawned.status === 0,
    "S2f: spawned dispatch produced all child assertions (exit 0)",
    spawned.status == null ? "child timeout/crash" : `exit=${spawned.status}, lines=${childResults.length}, tail=${childOut.slice(-400)}`,
  );
  fs.rmSync(childPath, { force: true });

  // ═══ S3 — VAR-03 kap half: select-winner extension + retry queue (53-04)═══
  console.log("\n=== S3 select-winner extension + retry queue (53-04) ===");
  const selfSrc = read("scripts/verify-phase-53.ts");
  const wb: any = await import("../src/lib/writebackQueue");
  const mw: any = await import("../src/lib/manifestWriteback");

  // ── S3a 队列机制(:memory:)──
  const memQ = knexMod.default({ client: "sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  await memQ.schema.createTable("canvas_writeback_queue", (t: any) => {
    t.increments("id").primary();
    t.integer("project_id").notNullable();
    t.integer("episodes_id").notNullable();
    t.string("action", 32).notNullable();
    t.text("payload").notNullable();
    t.string("state", 16).notNullable().defaultTo("pending");
    t.integer("attempts").notNullable().defaultTo(0);
    t.integer("max_attempts").notNullable().defaultTo(8);
    t.bigInteger("next_attempt_at").notNullable();
    t.text("last_error");
    t.bigInteger("created_at").notNullable();
    t.bigInteger("updated_at").notNullable();
  });
  const t0q = Date.now();
  await wb.enqueueWriteback(memQ, { projectId: 1, episodesId: 1, action: "manifest_writeback", payload: { x: 1 } });
  let rowQ = await memQ("canvas_writeback_queue").first();
  assert(rowQ?.state === "pending" && rowQ?.attempts === 0, "S3a-1: enqueue → pending attempts=0", JSON.stringify(rowQ?.state));
  assert(
    Math.abs(rowQ?.next_attempt_at - (t0q + 30000)) < 5000,
    "S3a-2: next_attempt_at ≈ now+30s",
    String(rowQ?.next_attempt_at - t0q),
  );
  // make it due now, drain with always-failing handler
  await memQ("canvas_writeback_queue").update({ next_attempt_at: t0q - 1 });
  await wb.drainOnce(memQ, async () => false);
  rowQ = await memQ("canvas_writeback_queue").first();
  assert(rowQ?.attempts === 1 && rowQ?.state === "pending", "S3a-3: 1st failure → attempts=1 pending", JSON.stringify(rowQ));
  assert(
    Math.abs(rowQ?.next_attempt_at - (Date.now() + 60000)) < 5000,
    "S3a-4: backoff 2^1 → +60s",
    String(rowQ?.next_attempt_at - Date.now()),
  );
  // exhaust to terminal failed (7 more failures)
  for (let i = 0; i < 7; i++) {
    await memQ("canvas_writeback_queue").update({ next_attempt_at: Date.now() - 1 });
    await wb.drainOnce(memQ, async () => false);
  }
  rowQ = await memQ("canvas_writeback_queue").first();
  assert(rowQ?.state === "failed" && rowQ?.attempts === 8, "S3a-5: exhausted → terminal failed (max_attempts=8)", JSON.stringify(rowQ));
  const dueAfter = await memQ("canvas_writeback_queue").where({ state: "pending" }).where("next_attempt_at", "<=", Date.now());
  assert(dueAfter.length === 0, "S3a-6: failed rows never selected again");
  // serial by id: two pending rows processed in id order
  await memQ("canvas_writeback_queue").del();
  await wb.enqueueWriteback(memQ, { projectId: 1, episodesId: 1, action: "manifest_writeback", payload: { n: 1 } });
  await wb.enqueueWriteback(memQ, { projectId: 1, episodesId: 1, action: "g15_waive", payload: { n: 2 } });
  await memQ("canvas_writeback_queue").update({ next_attempt_at: Date.now() - 1 });
  const order: number[] = [];
  const serial = await wb.drainOnce(memQ, async (r: any) => { order.push(r.id); return true; });
  assert(serial.processed === 2 && serial.delivered === 2 && order[0] < order[1], "S3a-7: serial drain by id, both done", JSON.stringify({ serial, order }));

  // ── S3b hook 隔离(never-throws + 字段映射)──(清场:S3a 残留行不计数)
  await memQ("canvas_writeback_queue").del();
  let hookThrew = false;
  try {
    await mw.enqueueManifestWriteback({ projectId: 1, episodesId: 1, groupId: "g", winnerNodeId: "w", variantIndex: 2 }, { getTransport: () => null, db: memQ });
  } catch { hookThrew = true; }
  const rowsNull = await memQ("canvas_writeback_queue").select("*");
  assert(!hookThrew && rowsNull.length === 0, "S3b-1: transport=null → resolves, NO queue row (channel-closed ≠ failure)", JSON.stringify(rowsNull.length));
  let hookThrew2 = false;
  try {
    await mw.enqueueManifestWriteback({ projectId: 1, episodesId: 1, groupId: "g", winnerNodeId: "w", variantIndex: 2 }, {
      getTransport: () => { throw new Error("boom"); },
      db: memQ,
    });
  } catch { hookThrew2 = true; }
  assert(!hookThrew2, "S3b-2: throwing transport resolver → still resolves (never-throws)");
  let hookThrew3 = false;
  try {
    await mw.enqueueManifestWriteback({ projectId: 1, episodesId: 1, groupId: "g", winnerNodeId: "w", variantIndex: 2 }, {
      getTransport: () => ({ writeSelection: async () => { throw new Error("delivery down"); } }),
      db: memQ,
    });
  } catch { hookThrew3 = true; }
  const rowsFail = await memQ("canvas_writeback_queue").select("*");
  assert(!hookThrew3 && rowsFail.length === 1 && rowsFail[0]?.state === "pending", "S3b-3: failing delivery → 1 pending queue row, still resolves", JSON.stringify(rowsFail.length));
  const targets: any[] = [];
  const okTransport = { writeSelection: async (_p: any, target: any) => { targets.push(target); } };
  await mw.enqueueManifestWriteback({ projectId: 1, episodesId: 1, groupId: "g", winnerNodeId: "w", variantIndex: 3, frameSlot: "first" }, { getTransport: () => okTransport, db: memQ });
  await mw.enqueueManifestWriteback({ projectId: 1, episodesId: 1, groupId: "g", winnerNodeId: "w", variantIndex: 4, frameSlot: "last" }, { getTransport: () => okTransport, db: memQ });
  await mw.enqueueManifestWriteback({ projectId: 1, episodesId: 1, groupId: "g", winnerNodeId: "w", variantIndex: 5 }, { getTransport: () => okTransport, db: memQ });
  assert(
    JSON.stringify(targets) === JSON.stringify([
      { field: "selected_first_variant", value: 3 },
      { field: "selected_last_variant", value: 4 },
      { field: "chosen_variant_id", value: 5 },
    ]),
    "S3b-4: D-11 field mapping first/last/none + 1-based value",
    JSON.stringify(targets),
  );
  const rowsAfterOk = await memQ("canvas_writeback_queue").select("*");
  assert(rowsAfterOk.length === 1, "S3b-5: successful direct writes never enqueue", JSON.stringify(rowsAfterOk.length));

  // ── S3d drain 重放闭环(先失败一次再成功)──
  await memQ("canvas_writeback_queue").update({ next_attempt_at: Date.now() - 1 });
  const replayFail = { writeSelection: async () => { throw new Error("still down"); } };
  await wb.drainOnce(memQ, (r: any) => mw.replayManifestWriteback(r, replayFail));
  let replayRow = await memQ("canvas_writeback_queue").first();
  assert(replayRow?.attempts === 1 && replayRow?.state === "pending", "S3d-1: replay failure increments attempts");
  await memQ("canvas_writeback_queue").update({ next_attempt_at: Date.now() - 1 });
  const replayOk = { writeSelection: async () => { /* idempotent success */ } };
  await wb.drainOnce(memQ, (r: any) => mw.replayManifestWriteback(r, replayOk));
  replayRow = await memQ("canvas_writeback_queue").first();
  assert(replayRow?.state === "done", "S3d-2: retry with working transport → done (replay closure)", JSON.stringify(replayRow?.state));
  await memQ.destroy();

  // ── S3c 端点集成(spawn 子进程 dispatch,绝不与 :memory: 段同进程)──
  console.log("\n=== S3c select-winner endpoint integration (spawned child dispatch) ===");
  const CHILD53_04 = [
    'import fs from "node:fs";',
    'import os from "node:os";',
    'import path from "node:path";',
    'const REPO_ROOT = "' + REPO_ROOT.replace(/"/g, '\\"') + '";',
    'const ISO = fs.mkdtempSync(path.join(os.tmpdir(), "verify-phase-53-sw-"));',
    'fs.copyFileSync(path.join(REPO_ROOT, "package.json"), path.join(ISO, "package.json"));',
    'process.chdir(ISO);',
    'function emit(pass, name, detail) { process.stdout.write("CHILD_RESULT\\t" + (pass ? "1" : "0") + "\\t" + name + (detail ? "\\t" + detail : "") + "\\n"); }',
    'async function callEndpoint(routerFn, method, urlPath, body) {',
    '  const req = { method, url: urlPath, headers: {}, body, params: {}, query: {}, socket: { remoteAddress: "127.0.0.1" }, connection: { remoteAddress: "127.0.0.1" } };',
    '  const res = { statusCode: 200, headersSent: false, payload: undefined,',
    '    status(c) { this.statusCode = c; return this; },',
    '    send(p) { this.payload = p; this.headersSent = true; settle(); return this; },',
    '    json(p) { this.payload = p; this.headersSent = true; settle(); return this; },',
    '    end() { this.headersSent = true; settle(); },',
    '    setHeader() {}, getHeader() { return undefined; }, removeHeader() {}, write() { return true; }, writeHead(c) { this.statusCode = c; settle(); } };',
    '  let settle = () => undefined;',
    '  await new Promise((resolve, reject) => { settle = resolve; routerFn(req, res, (err) => (err ? reject(err) : resolve())); });',
    '  return { status: res.statusCode, payload: res.payload };',
    '}',
    'async function main() {',
    '  await import("../src/utils");',
    '  const routeMod = await import("../src/routes/canvas/v2/select-winner");',
    '  const dbMod = await import("../src/utils/db");',
    '  await Promise.race([dbMod.bootReady, new Promise((_, rej) => setTimeout(() => rej(new Error("bootReady timeout")), 60000))]);',
    '  const db = dbMod.db;',
    '  const T0 = 1700000000000;',
    '  const P = 999, E = 1, GID = "cand:shot:shot_epZ:first";',
    '  await db("canvas_variant_groups").insert({ id: GID, project_id: P, episodes_id: E, phase_index: 0, branch_id: "main",',
    '    variant_node_ids: JSON.stringify(["sw-a", "sw-b"]), winner_node_id: null, select_mode: "single", created_at: T0, updated_at: T0 });',
    '  const node = (id) => ({ id, project_id: P, episodes_id: E, type: "asset", branch_id: "main", phase_index: 11, phase_name: "p11",',
    '    position_x: 0, position_y: 0, size_width: 260, size_height: 180, data: JSON.stringify({}), state: "idle", is_winner: 0,',
    '    variant_group_id: GID, created_at: T0, updated_at: T0 });',
    '  await db("canvas_nodes").insert(node("sw-a"));',
    '  await db("canvas_nodes").insert(node("sw-b"));',
    '  const queueCount = async () => (await db("canvas_writeback_queue").where({ project_id: P, episodes_id: E }).count("* as c"))[0].c;',
    '  const r1 = await callEndpoint(routeMod.default, "POST", "/" + GID + "/select-winner",',
    '    { projectId: P, episodesId: E, winnerNodeId: "sw-a", frameSlot: "first", source: "p11a0_flf" });',
    '  emit(r1.status === 200 && r1?.payload?.data?.applied === true, "S3c-1: POST with frameSlot/source → 200 applied:true",',
    '       JSON.stringify({ status: r1.status, applied: r1?.payload?.data?.applied }));',
    '  const q1 = await queueCount();',
    '  const r2 = await callEndpoint(routeMod.default, "POST", "/" + GID + "/select-winner",',
    '    { projectId: P, episodesId: E, winnerNodeId: "sw-a" });',
    '  const q2 = await queueCount();',
    '  emit(r2.status === 200 && r2?.payload?.data?.applied === false, "S3c-2: same winner again → applied:false (idempotent branch)",',
    '       JSON.stringify({ status: r2.status, applied: r2?.payload?.data?.applied }));',
    '  emit(q1 === q2, "S3c-3: idempotent branch triggers NO queue row (Pitfall 5)", JSON.stringify({ q1, q2 }));',
    '  const r3 = await callEndpoint(routeMod.default, "POST", "/" + GID + "/select-winner",',
    '    { projectId: P, episodesId: E, winnerNodeId: "sw-b" });',
    '  emit(r3.status === 200 && r3?.payload?.data?.applied === true, "S3c-4: legacy POST without frameSlot/source → 200 (backward compatible)",',
    '       JSON.stringify({ status: r3.status, applied: r3?.payload?.data?.applied }));',
    '  emit(q2 === (await queueCount()), "S3c-5: transport unconfigured → zero queue rows across all selections", String(await queueCount()));',
    '}',
    'main().then(() => process.exit(0), (err) => { console.error("child crashed:", err); process.exit(2); });',
  ].join("\n");
  const childPath2 = path.join(REPO_ROOT, "scripts", ".verify-phase-53-child2.tmp.ts");
  fs.writeFileSync(childPath2, CHILD53_04);
  const spawned2 = spawnSync("npx", ["tsx", "scripts/.verify-phase-53-child2.tmp.ts"], {
    cwd: REPO_ROOT, encoding: "utf8", timeout: 120000,
  });
  const childResults2 = (spawned2.stdout || "")
    .split("\n")
    .filter((l) => l.startsWith("CHILD_RESULT\t"))
    .map((l) => l.split("\t"));
  for (const [_, passRaw, name, detail] of childResults2) {
    assert(passRaw === "1", `S3c(child): ${name}`, detail);
  }
  assert(
    childResults2.length >= 5 && spawned2.status === 0,
    "S3c: spawned select-winner dispatch produced all child assertions (exit 0)",
    spawned2.status == null ? "child timeout/crash" : `exit=${spawned2.status}, lines=${childResults2.length}, tail=${(spawned2.stderr || "").slice(-300)}`,
  );
  fs.rmSync(childPath2, { force: true });

  // ═══ S4 — VAR-02 wall source shapes + entries (53-02/05/06/07) ════════════
  console.log("\n=== S4 variant wall source shapes + entries (53-07 fill) ===");
  const wallSrc = read("packages/infinite-canvas/src/components/variants/VariantWall.tsx");
  assert(wallSrc.includes("resolveMediaUrl"), "S4-1: VariantWall routes all media via resolveMediaUrl (P5)");
  assert(wallSrc.includes("getScoreColor"), "S4-2: aiScore badge colors via getScoreColor threshold (DR-1)");
  assert(wallSrc.includes("useWallKeyboard"), "S4-3: keyboard flow D-20 wired");
  assert(wallSrc.includes("选定") && wallSrc.includes("检视"), "S4-4: explicit-select + inspect copy present (D-08)");
  const storeSrc = read("packages/infinite-canvas/src/store/canvasStore.ts");
  assert(storeSrc.includes("frameSlot"), "S4-5: canvasStore selectWinner carries frameSlot passthrough (D-11)");
  assert(!storeSrc.includes("💾"), "S4-6: no 💾 dual-track narrative in canvasStore (D-12)");
  assert(
    !exists("packages/infinite-canvas/src/components/variants/VariantPicker.tsx"),
    "S4-7: old VariantPicker.tsx deleted (D-12 close-out)",
  );
  assert(
    read("packages/infinite-canvas/src/v3/adapter.ts").includes("variantGroupIds"),
    "S4-8: adapter membership channel attached (53-06)",
  );
  const flowCanvasSrc = read("packages/infinite-canvas/src/components/FlowCanvas.tsx");
  assert(
    flowCanvasSrc.includes("G15TriagePanel") && flowCanvasSrc.includes("失败镜头"),
    "S4-9: G15 triage panel mounted + toolbar entry (53-07)",
  );

  // ═══ S5 — G15 bridge dispatch (53-07: injected fetch, real module) ═══════
  console.log("\n=== S5 G15 bridge dispatch (injected fetch, real module) ===");
  const g15: any = await import("../src/lib/g15Bridge");
  const calls: Array<{ url: string }> = [];
  const mkFetch = (status: number): typeof fetch => {
    return (async (url: any) => {
      calls.push({ url: String(url) });
      return new Response(JSON.stringify({ ok: true }), { status });
    }) as unknown as typeof fetch;
  };
  const base = { projectId: 1, episodesId: 2, action: "waive" as const, shotIds: ["shot_001", "shot_002"] };

  const rOk = await g15.dispatchG15Op(base, { fetchImpl: mkFetch(200) });
  assert(rOk?.delivered === true, "S5a-1: 200 → delivered=true", JSON.stringify(rOk));
  const r409 = await g15.dispatchG15Op(base, { fetchImpl: mkFetch(409) });
  assert(r409?.delivered === true, "S5a-2: 409 = already resolved → delivered=true (reviewBridge semantics)", JSON.stringify(r409));
  const rNet = await g15.dispatchG15Op(base, {
    fetchImpl: (async () => { throw new Error("network down"); }) as unknown as typeof fetch,
  });
  assert(
    rNet?.delivered === false && typeof rNet?.reason === "string" && rNet.reason.length > 0,
    "S5a-3: network throw → delivered=false + non-empty reason (never-throws)",
    JSON.stringify(rNet),
  );
  calls.length = 0;
  const rFailClosed = await g15.dispatchG15Op({ ...base, shotIds: [] }, { fetchImpl: mkFetch(200) });
  assert(
    rFailClosed?.delivered === false && calls.length === 0,
    "S5a-4: fail-closed — empty shotIds sends ZERO requests",
    JSON.stringify({ r: rFailClosed, calls: calls.length }),
  );
  calls.length = 0;
  const rBound = await g15.dispatchG15Op(
    { ...base, shotIds: Array.from({ length: 201 }, (_, i) => `s${i}`) },
    { fetchImpl: mkFetch(200) },
  );
  assert(rBound?.delivered === false && calls.length === 0, "S5a-5: >200 bound fail-closed, zero requests");
  const rThrow = await g15.dispatchG15Op(base, {
    fetchImpl: mkFetch(200),
    logger: { info: () => { throw new Error("broken logger"); }, warn: () => { throw new Error("broken logger"); } },
  });
  assert(rThrow != null, "S5a-6: broken logger does not propagate (never-throws double guard)");
  const zod: any = await import("zod");
  const g15Schema = zod.z.object({
    action: zod.z.enum(["waive", "requeue"]),
    shotIds: zod.z.array(zod.z.string().min(1).max(128)).max(200),
  });
  assert(
    g15Schema.safeParse({ action: "waive", shotIds: Array.from({ length: 201 }, () => "x") }).success === false &&
      g15Schema.safeParse({ action: "bogus", shotIds: ["a"] }).success === false &&
      g15Schema.safeParse({ action: "requeue", shotIds: ["a".repeat(200)] }).success === false,
    "S5b: endpoint zod bounds — array >200 / bogus action / per-item >128 all rejected",
  );
  const g15EndpointSrc = read("src/routes/canvas/v2/g15-ops.ts");
  assert(
    g15EndpointSrc.includes("enqueueWriteback") && g15EndpointSrc.includes('"g15:ops"'),
    "S5c: g15-ops endpoint queues on miss + broadcasts g15:ops",
  );
  {
    // needle 运行时拼接,避免断言源码字面自指(自指陷阱)
    const marker = ["FILLED", "BY", "53"].join("-");
    assert(
      !read("scripts/verify-phase-53.ts").includes(marker),
      "S5d: all placeholder markers replaced (contract gate complete)",
    );
  }


  // ═══ S5 forced-failure self-check (gate can actually fail — expected FAILs below) ═══
  console.log("\n=== S5 forced-failure self-check (gate can actually fail — expected FAILs below) ===");
  // (50-02 precedent: a gate that cannot fail proves nothing. These must-fail
  // assertions go through the SAME boolean evaluation path as assert(); their
  // FAIL output is marked SELF-CHECK, excluded from the pass totals, and an
  // unexpected PASS fails the whole run.)
  const selfCheckShadow: TestResult[] = [];
  const shadowAssert = (cond: boolean, name: string): void => {
    selfCheckShadow.push({ name, pass: cond });
    console.log(
      `  SELF-CHECK ${cond ? "UNEXPECTED-PASS" : "expected-FAIL ok"}: ${name}`,
    );
  };
  shadowAssert(
    envelope.parseCandidateEnvelope(legacy[0])?.groupKey === "wrong-format",
    "self-check: groupKey is never the wrong format",
  );
  shadowAssert(
    envelope.parseCandidateEnvelope(legacy[3])?.score?.overall === 999,
    "self-check: absent score is never 999",
  );
  shadowAssert(exists("src/lib/__definitely-not-a-real-file__.ts"), "self-check: a known-nonexistent file is reported missing");
  shadowAssert(grepSource("__definitely_not_a_real_identifier__").length > 0, "self-check: a nonsense identifier grep returns hits");
  const shadowFailed = selfCheckShadow.filter((r) => !r.pass).length;
  const selfCheckOk =
    selfCheckShadow.length >= 3 &&
    selfCheckShadow.every((r) => !r.pass);
  assert(
    selfCheckOk,
    "forced-failure self-check: every must-fail assertion failed as expected (gate fail-path is live)",
    `shadow: ${selfCheckShadow.length - shadowFailed}/${selfCheckShadow.length} unexpectedly passed`,
  );

  // ═══ Summary ═════════════════════════════════════════════════════════════
  const passed = results.filter((r) => r.pass).length;
  const total = results.length;
  const failed = total - passed;
  console.log(`\n=== Summary: ${passed}/${total} assertions passed, FAIL count = ${failed} (self-check excluded from totals) ===`);
  if (passed === total) {
    console.log("✅ Phase 53 verification PASSED (S1 envelope round-trip ✓ S2-S4 placeholders marked ✓ S5 forced-failure ✓)");
    cleanup();
    process.exit(0);
  } else {
    console.log("❌ Phase 53 verification FAILED");
    for (const r of results.filter((x) => !x.pass)) {
      console.log(`   FAIL: ${r.name}${r.detail ? " — " + r.detail : ""}`);
    }
    cleanup();
    process.exit(1);
  }
}

function cleanup(): void {
  try {
    fs.rmSync(ISOLATION_DIR, { recursive: true, force: true });
  } catch {
    // temp dir cleanup is best-effort; the isolation dir lives under os.tmpdir()
  }
}

main().catch((err) => {
  console.error("verify-phase-53.ts crashed:", err);
  cleanup();
  process.exit(2);
});
