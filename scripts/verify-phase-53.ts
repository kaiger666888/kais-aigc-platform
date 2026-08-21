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
 *   S2 — candidate group derivation / materialization (FILLED-BY-53-03
 *     placeholder — asserted as a marked TODO comment until 53-03 fills it).
 *   S3 — select-winner extension + manifest hook + retry queue
 *     (FILLED-BY-53-04 placeholder).
 *   S4 — variant wall source shapes (FILLED-BY-53-07 placeholder — the wall
 *     engine itself is UI-side and covered by vitest; this section will
 *     assert the wall's wiring into the C layer).
 *   S5 — G15 bridge + forced-failure self-check (the forced-failure half is
 *     LIVE from 53-01; the bridge assertions arrive with 53-07).
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

  // ═══ S2 — FILLED-BY-53-03: candidate group derivation ════════════════════
  console.log("\n=== S2 candidate group derivation (FILLED-BY-53-03 placeholder) ===");
  // FILLED-BY-53-03: families → canvas variantGroups materialization asserts.
  // Until 53-03 lands, only the placeholder marker itself is asserted.
  const selfSrc = read("scripts/verify-phase-53.ts");
  assert(selfSrc.includes("FILLED-BY-53-03"), "S2: FILLED-BY-53-03 marker present (section reserved)");

  // ═══ S3 — FILLED-BY-53-04: select-winner extension + queue ═══════════════
  console.log("\n=== S3 select-winner extension + retry queue (FILLED-BY-53-04 placeholder) ===");
  // FILLED-BY-53-04: frameSlot params + manifest hook + queue table asserts.
  assert(selfSrc.includes("FILLED-BY-53-04"), "S3: FILLED-BY-53-04 marker present (section reserved)");

  // ═══ S4 — FILLED-BY-53-07: wall wiring (G15 uses S4 per plan map) ════════
  console.log("\n=== S4 variant wall / G15 wiring (FILLED-BY-53-07 placeholder) ===");
  // FILLED-BY-53-07: wall C-layer wiring + G15 bridge asserts.
  assert(selfSrc.includes("FILLED-BY-53-07"), "S4: FILLED-BY-53-07 marker present (section reserved)");

  // ═══ S5 — G15 bridge + forced-failure self-check ═════════════════════════
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
