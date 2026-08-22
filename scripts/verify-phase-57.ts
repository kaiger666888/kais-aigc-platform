#!/usr/bin/env tsx
/**
 * verify-phase-57.ts — Phase 57 (PORTAL-04) 三方 drift 契约测试:
 * movie-v1 phase_taxonomy(defaultSkill 内联常量)↔ PHASE_REGISTRY(55-D04 单一
 * 注册表)↔ GATE_CATALOG(54-D02 门快照)↔ khs gates.yaml(只读 js-yaml)。
 *
 * 真相源(只读,KAIS_HERMES_SKILLS_PATH 可覆盖;verify-phase-54 diffCatalogAgainst
 * 先例):/data/workspace/kais-hermes-skills/plugins/review_gates/gates.yaml
 *
 * 断言组(Part 1 taxonomy;57-08 加 Part 2 探活组):
 *   S 解析门 — gates.yaml 只读解析 0 条即 FAIL(脆弱即信号,55 纪律)
 *   T1 集合等价 — taxonomy id 集 ≡ PHASE_REGISTRY khsPrefix 集(双向 diff)
 *   T2 顺序 — taxonomy order 严格递增且与注册表 sortKey 升序同序(逐位比对)
 *   T3 门一致性 — review_gate 非空 ⇔ requires_review;非空值 ∈ GATE_CATALOG
 *       derivedGateId 集 且 ∈ gates.yaml 派生 id 集;gate 前缀 = 自身 khsPrefix
 *   T4 无门清单 — 9 个无门前缀恰为 review_gate 空;p13 红线子门不占条目
 *   T5 运行时链 — 常量每条 requires_review 与注册表有门性一致
 *       (phase-complete.ts 'phaseDecl?.requires_review ?? false' 暗礁反向断言)
 *   F forced-fail — 内存改坏一条 review_gate → 断言组必须红(能失败证明)
 *
 * 只读 fs + js-yaml,零子进程,零 khs 写(T-57-07c)。
 * Run: npm run verify:phase-57
 * Exit: 0 全绿 / 1 任一断言红 / 2 crash
 */

import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { MOVIE_V1_MANIFEST } from "../src/skills/defaultSkill";
import { PHASE_REGISTRY } from "../packages/infinite-canvas/src/constants/phaseRegistry";
import { GATE_CATALOG, EXPECTED_GATE_COUNT, deriveGateId } from "../src/lib/gateCatalog";

interface TestResult { name: string; pass: boolean; detail?: string }
const results: TestResult[] = [];
function assert(cond: boolean, name: string, detail?: string): void {
  results.push({ name, pass: cond, detail });
  console.log(`  ${cond ? "PASS" : "FAIL"}: ${name}${detail ? " — " + detail : ""}`);
}

const SIBLING_ROOT = process.env.KAIS_HERMES_SKILLS_PATH ?? "/data/workspace/kais-hermes-skills";
const GATES_YAML = path.join(SIBLING_ROOT, "plugins/review_gates/gates.yaml");

// ⚠️ 文件缺失/解析 0 条即 FAIL——脆弱性即契约漂移信号(verify-phase-55 同款纪律)。
function readGatesYaml(): Record<string, { default_mode?: unknown }> {
  if (!fs.existsSync(GATES_YAML)) {
    console.error(`FATAL: gates.yaml 不存在: ${GATES_YAML}`);
    process.exit(1);
  }
  const parsed = yaml.load(fs.readFileSync(GATES_YAML, "utf8")) as {
    gates?: Record<string, { default_mode?: unknown }>;
  };
  if (!parsed.gates || Object.keys(parsed.gates).length === 0) {
    console.error("FATAL: gates.yaml 解析出 0 条 gate(契约漂移或解析失效)");
    process.exit(1);
  }
  return parsed.gates;
}

// ─── Core consistency check, factored so F-forced-fail can re-run it on an
//     IN-MEMORY mutated taxonomy (never a mutated file/constant). ─────────────

function checkTaxonomy(
  taxonomy: Array<{ id: string; order: number; requires_review: boolean; review_gate?: string }>,
  catalogDerivedIds: Set<string>,
  yamlDerivedIds: Set<string>,
  byKhs: Map<string, (typeof PHASE_REGISTRY)[number]>,
): string[] {
  const problems: string[] = [];
  if (taxonomy.length !== 22) problems.push(`taxonomy length ${taxonomy.length} !== 22`);

  const taxIds = taxonomy.map((p) => p.id);
  const regKhs = new Set(PHASE_REGISTRY.map((p) => p.khsPrefix));
  for (const id of taxIds) if (!regKhs.has(id)) problems.push(`id ${id} not in PHASE_REGISTRY khsPrefix set`);
  for (const khs of regKhs) if (!taxIds.includes(khs)) problems.push(`khsPrefix ${khs} missing from taxonomy`);

  // T2 order: strictly ascending AND same sequence as registry sortKey ascending.
  const sortedRegistry = [...PHASE_REGISTRY].sort((a, b) => a.sortKey - b.sortKey).map((p) => p.khsPrefix);
  const byId = new Map(taxonomy.map((p) => [p.id, p]));
  let prev = -1;
  taxonomy.forEach((p, i) => {
    if (p.order !== i) problems.push(`${p.id}: order ${p.order} !== array index ${i}`);
    if (p.order <= prev) problems.push(`${p.id}: order not strictly ascending (${prev} → ${p.order})`);
    prev = p.order;
    if (sortedRegistry[i] !== p.id) problems.push(`order seq[${i}] = ${p.id} but sortKey asc = ${sortedRegistry[i]}`);
  });

  // T3 gate consistency (three-way core).
  for (const p of taxonomy) {
    const gate = p.review_gate ?? "";
    if (gate !== "") {
      if (!p.requires_review) problems.push(`${p.id}: review_gate '${gate}' set but requires_review false`);
      if (!catalogDerivedIds.has(gate)) problems.push(`${p.id}: review_gate '${gate}' not in GATE_CATALOG derivedGateId set`);
      if (!yamlDerivedIds.has(gate)) problems.push(`${p.id}: review_gate '${gate}' not in gates.yaml derived id set`);
      if (gate !== `${p.id}-gate`) problems.push(`${p.id}: review_gate '${gate}' prefix mismatch (expected '${p.id}-gate')`);
    } else if (p.requires_review) {
      problems.push(`${p.id}: requires_review true but review_gate empty`);
    }
    // T5 runtime-chain reef: constant's requires_review must match registry
    // gated-ness (phase-complete.ts defaults unknown ids to false — silent drop).
    const def = byKhs.get(p.id);
    const regGated = def != null && catalogDerivedIds.has(`${p.id}-gate`);
    if (p.requires_review !== regGated) {
      problems.push(`${p.id}: requires_review ${p.requires_review} vs registry gated ${regGated}`);
    }
  }
  return problems;
}

function main(): void {
  console.log("=== Phase 57 — verify-phase-57.ts (PORTAL-04 三方 drift: taxonomy ↔ registry ↔ gates) ===\n");

  const yamlGates = readGatesYaml();
  const taxonomy = MOVIE_V1_MANIFEST.phase_taxonomy;

  // ─── S 解析门 ────────────────────────────────────────────────────────────
  console.log("=== S 解析门(0 条即 FAIL — 脆弱性即契约信号) ===");
  assert(Object.keys(yamlGates).length === EXPECTED_GATE_COUNT, `S: gates.yaml 恰 ${EXPECTED_GATE_COUNT} 条`, String(Object.keys(yamlGates).length));
  assert(GATE_CATALOG.length === EXPECTED_GATE_COUNT, `S: GATE_CATALOG 恰 ${EXPECTED_GATE_COUNT} 条`, String(GATE_CATALOG.length));

  // Derived id sets (redline entries included in the yaml set — derivation strips
  // the _redline_* suffix; the 13 non-redline catalog ids are the review surface).
  const catalogDerivedIds = new Set(GATE_CATALOG.map((g) => g.derivedGateId));
  const yamlDerivedIds = new Set(Object.keys(yamlGates).map((k) => deriveGateId(k)));
  const catalogNonRedline = new Set(GATE_CATALOG.filter((g) => !g.isRedline).map((g) => g.derivedGateId));
  const byKhs = new Map(PHASE_REGISTRY.map((p) => [p.khsPrefix, p]));

  // ─── T1-T5 (computed once via checkTaxonomy, reported per-group) ─────────
  console.log("\n=== T1-T5 taxonomy ↔ PHASE_REGISTRY ↔ GATE_CATALOG ↔ gates.yaml ===");
  const problems = checkTaxonomy(taxonomy, catalogDerivedIds, yamlDerivedIds, byKhs);
  const t1 = problems.filter((x) => x.includes("not in PHASE_REGISTRY") || x.includes("missing from taxonomy"));
  const t2 = problems.filter((x) => x.includes("order") && !x.includes("review_gate"));
  const t3 = problems.filter((x) => x.includes("review_gate") || x.includes("requires_review") || x.includes("gated"));
  assert(taxonomy.length === 22, `T1: taxonomy 恰 22 条`, String(taxonomy.length));
  assert(t1.length === 0, "T1: id 集 ≡ khsPrefix 集(双向)", t1.slice(0, 4).join("; ") || undefined);
  assert(t2.length === 0, "T2: order 严格递增 ≡ sortKey 升序同序", t2.slice(0, 4).join("; ") || undefined);
  assert(t3.length === 0, "T3: review_gate 非空 ⇔ requires_review,值 ∈ 双 derivedGateId 集,前缀=自身", t3.slice(0, 4).join("; ") || undefined);

  console.log("\n=== T4 无门清单(9 前缀恰为 review_gate 空;红线子门不占条目) ===");
  const gateless = ["p035", "p08", "p09", "p09b", "p10", "p12a", "p12b", "p14", "p15"];
  const actualGateless = taxonomy.filter((p) => !p.review_gate).map((p) => p.id).sort();
  assert(JSON.stringify(actualGateless) === JSON.stringify([...gateless].sort()), "T4: 无门 9 前缀清单恰为 review_gate 空", actualGateless.join(","));
  assert(taxonomy.filter((p) => p.review_gate).length === 13, "T4: 13 条带 review_gate(= 非红线门数)", String(taxonomy.filter((p) => p.review_gate).length));
  assert(!taxonomy.some((p) => p.id.includes("redline")), "T4: 红线子门不占 taxonomy 条目(platformInvisible)");
  assert(catalogNonRedline.size === 13, "T4: 非红线 catalog 门恰 13", String(catalogNonRedline.size));

  console.log("\n=== T5 运行时链(phase-complete 暗礁反向断言) ===");
  const t5 = problems.filter((x) => x.includes("vs registry gated"));
  assert(t5.length === 0, "T5: 常量 requires_review 与注册表有门性逐条一致", t5.slice(0, 4).join("; ") || undefined);

  // ─── F forced-fail — 内存突变必须被检出 ──────────────────────────────────
  console.log("\n=== F forced-fail: 内存改坏一条 → 必须红 ===");
  const mutated = taxonomy.map((p) => ({ ...p }));
  const idx = mutated.findIndex((p) => p.id === "p03");
  mutated[idx]!.review_gate = "p99-gate"; // 不存在的门 id
  const f1 = checkTaxonomy(mutated, catalogDerivedIds, yamlDerivedIds, byKhs);
  assert(f1.some((x) => x.includes("p99-gate")), "F: 改坏 review_gate 值被检出", f1.find((x) => x.includes("p03")));
  const mutated2 = taxonomy.map((p) => ({ ...p }));
  const idx2 = mutated2.findIndex((p) => p.id === "p035");
  mutated2[idx2]!.requires_review = true; // 无门 phase 被标需审
  const f2 = checkTaxonomy(mutated2, catalogDerivedIds, yamlDerivedIds, byKhs);
  assert(f2.some((x) => x.includes("p035")), "F: 无门 phase 虚标 requires_review 被检出", f2.find((x) => x.includes("p035")));
  assert(MOVIE_V1_MANIFEST.phase_taxonomy.every((p, i) => p === taxonomy[i]), "F: 原常量未被改动(仅内存突变)");

  const passed = results.filter((r) => r.pass).length;
  const failed = results.length - passed;
  console.log(`\n=== Summary: ${passed}/${results.length} passed, FAIL = ${failed} ===`);
  if (failed === 0) {
    console.log("✅ Phase 57 PORTAL-04 三方 drift 契约全绿(taxonomy ≡ registry ≡ catalog ≡ gates.yaml)");
    process.exit(0);
  }
  for (const r of results.filter((x) => !x.pass)) console.log(`   FAIL: ${r.name} — ${r.detail ?? ""}`);
  process.exit(1);
}

try {
  main();
} catch (err) {
  console.error("verify-phase-57.ts crashed:", err);
  process.exit(2);
}
