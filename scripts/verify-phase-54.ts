#!/usr/bin/env tsx
/**
 * verify-phase-54.ts — Phase 54 (Gate Center + Blocking-State UX) aggregate
 * contract gate (GUARD closing tradition, ROADMAP decision #7).
 *
 *   S-catalog — D-02 zero-drift snapshot: parse the khs authority
 *     (plugins/review_gates/gates.yaml via KAIS_HERMES_SKILLS_PATH) with
 *     js-yaml and diff GATE_CATALOG field-by-field; any khs change to
 *     gates.yaml turns this red. Includes count=16, mode match (p11b
 *     webhook), deriveGateId round-trip per key, redline flags, legacy
 *     alias spot checks. Read-only — never writes khs files.
 *   S-fold — D-04 four-state folding: RESEARCH §E full table (9 branches)
 *     enumerated against foldDisplayState, including the legacy
 *     AUTO/HUMAN-without-decision → approve compat read.
 *   S-forced-fail — proves the gate can go red: mutates the IN-MEMORY parsed
 *     yaml (drop an entry / flip a mode) and re-runs the diff logic; the
 *     mutation MUST be detected. No khs file is ever touched.
 *   S-live / S-ops / S-poller — TODO placeholders, explicit SKIP lines
 *     (filled by 54-05 / 54-07).
 *
 * Self-contained discipline (P7): imports only gateCatalog + js-yaml —
 * no @/utils barrel, no db, no spawn of pytest.
 *
 * Run: npm run verify:phase-54   (or: npx tsx scripts/verify-phase-54.ts)
 * Exit: 0 all sections pass + self-check behaves / 1 any failure / 2 crash
 */

import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import {
  GATE_CATALOG,
  GATE_DISPLAY_NAMES,
  EXPECTED_GATE_COUNT,
  LEGACY_GATE_ID_TO_PHASE_ID,
  deriveGateId,
  foldDisplayState,
  type GateEntry,
} from "../src/lib/gateCatalog";

interface TestResult { name: string; pass: boolean; detail?: string; }
const results: TestResult[] = [];
function assert(cond: boolean, name: string, detail?: string): void {
  results.push({ name, pass: cond, detail });
  console.log(`  ${cond ? "PASS" : "FAIL"}: ${name}${detail ? " — " + detail : ""}`);
}

const REPO_ROOT = path.resolve(__dirname, "..");
const KHS_ROOT = process.env.KAIS_HERMES_SKILLS_PATH ?? "/data/workspace/kais-hermes-skills";
const GATES_YAML = path.join(KHS_ROOT, "plugins/review_gates/gates.yaml");

interface YamlGate {
  phase?: unknown
  asset_bus_slots_to_lock?: unknown
  reviewer_role?: unknown
  timeout_sec?: unknown
  callback_url?: unknown
  default_mode?: unknown
  retry_policy?: { max_retries?: unknown; backoff_sec?: unknown }
}

/** The S-catalog diff logic, factored so S-forced-fail can re-run it on a
 *  mutated IN-MEMORY copy (never a mutated file). */
function diffCatalogAgainst(yamlGates: Record<string, YamlGate>): string[] {
  const problems: string[] = [];
  const keys = Object.keys(yamlGates);
  if (keys.length !== EXPECTED_GATE_COUNT) {
    problems.push(`yaml entry count ${keys.length} !== EXPECTED_GATE_COUNT ${EXPECTED_GATE_COUNT}`);
  }
  if (GATE_CATALOG.length !== EXPECTED_GATE_COUNT) {
    problems.push(`GATE_CATALOG length ${GATE_CATALOG.length} !== ${EXPECTED_GATE_COUNT}`);
  }
  const byPhaseId = new Map(GATE_CATALOG.map((g) => [g.phaseId, g]));
  for (const key of keys) {
    const snap = byPhaseId.get(key);
    if (snap == null) {
      problems.push(`yaml key ${key} missing from GATE_CATALOG snapshot`);
      continue;
    }
    const y = yamlGates[key];
    if (String(y.default_mode) !== snap.mode) {
      problems.push(`${key}: mode yaml=${String(y.default_mode)} snap=${snap.mode}`);
    }
    if (deriveGateId(key) !== snap.derivedGateId) {
      problems.push(`${key}: deriveGateId round-trip ${deriveGateId(key)} !== snap ${snap.derivedGateId}`);
    }
    const slots = Array.isArray(y.asset_bus_slots_to_lock)
      ? (y.asset_bus_slots_to_lock as unknown[]).map(String)
      : [];
    if (JSON.stringify(slots) !== JSON.stringify(snap.assetBusSlotsToLock)) {
      problems.push(`${key}: asset_bus_slots_to_lock drift`);
    }
    const roles = Array.isArray(y.reviewer_role)
      ? (y.reviewer_role as unknown[]).map(String)
      : y.reviewer_role != null
        ? [String(y.reviewer_role)]
        : [];
    if (JSON.stringify(roles) !== JSON.stringify(snap.reviewerRole)) {
      problems.push(`${key}: reviewer_role drift`);
    }
    if (Number(y.timeout_sec) !== snap.timeoutSec) {
      problems.push(`${key}: timeout_sec drift (${String(y.timeout_sec)} vs ${snap.timeoutSec})`);
    }
    const retry = `${Number(y.retry_policy?.max_retries)}/${Number(y.retry_policy?.backoff_sec)}`;
    const snapRetry = `${snap.retryPolicy.maxRetries}/${snap.retryPolicy.backoffSec}`;
    if (retry !== snapRetry) {
      problems.push(`${key}: retry_policy drift (${retry} vs ${snapRetry})`);
    }
  }
  for (const g of GATE_CATALOG) {
    if (!(g.phaseId in yamlGates)) problems.push(`snapshot entry ${g.phaseId} missing from yaml`);
  }
  return problems;
}

function main(): void {
  console.log("=== Phase 54 — verify-phase-54.ts (aggregate contract gate: GATE-01..03) ===\n");

  // ═══ S-catalog — D-02 snapshot zero-drift vs khs authority ═══════════════
  console.log("=== S-catalog: gates.yaml snapshot diff (D-02 zero-drift) ===");
  const yamlText = fs.readFileSync(GATES_YAML, "utf8");
  const parsed = yaml.load(yamlText) as { version?: number; gates?: Record<string, YamlGate> };
  const yamlGates = parsed.gates ?? {};
  assert(parsed.version === 2, "S-catalog: gates.yaml version === 2", String(parsed.version));
  const problems = diffCatalogAgainst(yamlGates);
  assert(problems.length === 0, `S-catalog: field-by-field diff clean (${EXPECTED_GATE_COUNT} entries)`, problems.slice(0, 3).join("; ") || undefined);
  const redlines = GATE_CATALOG.filter((g) => g.isRedline);
  assert(
    redlines.length === 3 && redlines.every((g) => g.platformInvisible),
    "S-catalog: 3 redline keys flagged isRedline + platformInvisible (never submit_review)",
  );
  const webhook = GATE_CATALOG.filter((g) => g.mode === "webhook");
  assert(
    webhook.length === 1 && webhook[0]?.phaseId === "p11b_final_render",
    "S-catalog: exactly one webhook-mode gate (p11b_final_render)",
  );
  assert(
    deriveGateId("p11a0_iframe_qc") === "p11a0-gate",
    "S-catalog: full sub-phase token derivation (p11a0 → p11a0-gate, not p11-gate)",
    deriveGateId("p11a0_iframe_qc"),
  );
  assert(
    deriveGateId("p13_delivery_redline_emotion") === "p13-gate",
    "S-catalog: redline suffix stripped before derivation (→ p13-gate)",
  );
  const aliasChecks: Array<[string, string]> = [
    ["p11-gate", "p11b_final_render"],
    ["topic-gate", "p01_hook_topic"],
    ["delivery-gate", "p13_delivery"],
  ];
  for (const [legacy, phase] of aliasChecks) {
    assert(
      LEGACY_GATE_ID_TO_PHASE_ID[legacy] === phase,
      `S-catalog: legacy alias ${legacy} → ${phase}`,
      String(LEGACY_GATE_ID_TO_PHASE_ID[legacy]),
    );
  }
  assert(
    Object.keys(GATE_DISPLAY_NAMES).length === EXPECTED_GATE_COUNT,
    `S-catalog: GATE_DISPLAY_NAMES covers all ${EXPECTED_GATE_COUNT} (U-06)`,
    String(Object.keys(GATE_DISPLAY_NAMES).length),
  );

  // ═══ S-fold — D-04 §E full table ═════════════════════════════════════════
  console.log("\n=== S-fold: foldDisplayState §E full table (D-04) ===");
  const table: Array<[string, string | null, { decision?: string } | null, string, string]> = [
    ["PENDING", "HUMAN", null, "pending", "PENDING → pending"],
    ["POLICY_EVAL", "AUTO", null, "pending", "POLICY_EVAL → pending"],
    ["APPROVING", "HUMAN", null, "pending", "APPROVING (主路径:人工门停在此) → pending"],
    ["COMPLETE", "HUMAN", { decision: "approve" }, "approve", "COMPLETE+decision approve"],
    ["COMPLETE", "HUMAN", { decision: "reject" }, "reject", "COMPLETE+decision reject"],
    ["COMPLETE", "HUMAN", { decision: "waive" }, "waive", "COMPLETE+decision waive"],
    ["COMPLETE", "BLOCK", null, "reject", "COMPLETE+BLOCK 无 decision → reject(系统拦截)"],
    ["COMPLETE", "AUTO", null, "approve", "COMPLETE+AUTO 无 decision → approve(legacy)"],
    ["COMPLETE", "HUMAN", null, "approve", "COMPLETE+HUMAN 无 decision → approve(legacy 兼容)"],
  ];
  for (const [state, disposition, result, expected, label] of table) {
    const got = foldDisplayState(state, disposition, result);
    assert(got === expected, `S-fold: ${label}`, `got ${got}`);
  }

  // ═══ S-forced-fail — prove the gate can go red (in-memory mutation) ═════
  console.log("\n=== S-forced-fail: in-memory yaml mutation MUST be detected ===");
  const dropped = { ...yamlGates };
  delete dropped["p10c_voice_audit"];
  const p1 = diffCatalogAgainst(dropped);
  assert(p1.some((x) => x.includes("count") || x.includes("p10c")), "forced-fail: dropped entry detected", p1[0]);
  const flipped = { ...yamlGates, p11b_final_render: { ...yamlGates["p11b_final_render"]!, default_mode: "blocking" } };
  const p2 = diffCatalogAgainst(flipped);
  assert(p2.some((x) => x.includes("p11b_final_render") && x.includes("mode")), "forced-fail: flipped mode detected", p2.find((x) => x.includes("p11b")));
  assert(fs.readFileSync(GATES_YAML, "utf8") === yamlText, "forced-fail: khs file untouched (in-memory only)");

  // ═══ Placeholders (filled by 54-05 / 54-07) ══════════════════════════════
  console.log("\n=== S-live / S-ops / S-poller: placeholders ===");
  console.log("SKIP: FILLED-BY-54-05 (S-live — GateStateService poll + socket broadcast)");
  console.log("SKIP: FILLED-BY-54-05 (S-ops — gate-ops endpoint dispatch)");
  console.log("SKIP: FILLED-BY-54-05 (S-poller — poller/liveness asserts; khs R2/R3 covered by its own pytest)");

  // ═══ Summary ═════════════════════════════════════════════════════════════
  const passed = results.filter((r) => r.pass).length;
  const total = results.length;
  const failed = total - passed;
  console.log(`\n=== Summary: ${passed}/${total} assertions passed, FAIL count = ${failed} ===`);
  if (passed === total) {
    console.log("✅ Phase 54 verification PASSED (S-catalog ✓ S-fold ✓ S-forced-fail ✓; S-live/S-ops/S-poller placeholders)");
    process.exit(0);
  } else {
    for (const r of results.filter((x) => !x.pass)) {
      console.log(`   FAIL: ${r.name}${r.detail ? " — " + r.detail : ""}`);
    }
    console.log("❌ Phase 54 verification FAILED");
    process.exit(1);
  }
}

try {
  main();
} catch (err) {
  console.error("verify-phase-54.ts crashed:", err);
  process.exit(2);
}
