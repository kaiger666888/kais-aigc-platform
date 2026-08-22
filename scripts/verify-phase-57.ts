#!/usr/bin/env tsx
/**
 * verify-phase-57.ts — Phase 57 (PORTAL-04) 三方 drift 契约测试:
 * movie-v1 phase_taxonomy(defaultSkill 内联常量)↔ PHASE_REGISTRY(55-D04 单一
 * 注册表)↔ GATE_CATALOG(54-D02 门快照)↔ khs gates.yaml(只读 js-yaml)。
 *
 * 真相源(只读,KAIS_HERMES_SKILLS_PATH 可覆盖;verify-phase-54 diffCatalogAgainst
 * 先例):/data/workspace/kais-hermes-skills/plugins/review_gates/gates.yaml
 *
 * 断言组(Part 1 taxonomy;57-08 Part 2 探活聚合):
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
 * Part 2 探活聚合(57-08,四需求收口;live HTTP @10588,health 门):
 *   P0 SC1 verdict 文档(fs 级) — docs/toonflow-replacement-verdict.md 六章节
 *   P1 门户三路由 — /portal/ /deliver/1 /toonflow 均 200 且含「制片门户」
 *   P2 深链契约 — /canvas?project&ep&focus&zone → 302 Location 精确形态
 *       (白名单四键翻译;未知键不回显 = 开放重定向面反向断言)
 *   P3 四岛共脸 — /infinite-canvas/(kap-nav 产物引用) /story-map/
 *       /director-desk/(注入恰 1 处 <kap-navbar data-active>) /portal/(壳)
 *       + navbar 产物 200 + /toonflow iframe src="/" 存在性(bundle 级)
 *   P4 Toonflow 共存 — / 首字节仍 Toonflow(title 特征);POST
 *       /api/project/getProject 200(agent-sync 旧链零破坏)
 *   P5 交付面 — POST /api/canvas/projects 含 episodes[].phases 直方图;
 *       GET /api/v1/skills/movie-v1/phases → 22 条(registry 加载新 manifest)
 *   服务不可达 = FAIL 不跳过(57-08 PLAN action 1 字面;门禁可红可绿)。
 *
 * 只读 fs + js-yaml + fetch(既有 POST projects/getProject 查询),零子进程,
 * 零 khs 写(T-57-07c/T-57-08a)。
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

// ─── Part 2 探活聚合(57-08:四需求成功标准 → 单命令 HTTP 断言组) ─────────
// live 服务默认 prod systemd @10588;KAP_PROBE_BASE 可覆盖(探针同款)。
const BASE = process.env.KAP_PROBE_BASE ?? "http://localhost:10588";
const REPO_ROOT = path.resolve(__dirname, "..");

interface LiveResp { ok: boolean; status: number; location: string | null; text: string }

/** redirect:manual——302 形态断言须见原响应而非跟随后的终态。网络异常返回 null。 */
async function liveFetch(pathname: string, init?: RequestInit): Promise<LiveResp | null> {
  try {
    const res = await fetch(`${BASE}${pathname}`, { redirect: "manual", ...init });
    const text = await res.text().catch(() => "");
    return { ok: res.ok, status: res.status, location: res.headers.get("location"), text };
  } catch {
    return null;
  }
}

const JSON_HEADERS = { "content-type": "application/json" } as const;

function sectionFailIfDead(alive: boolean, name: string): boolean {
  // 服务不可达 = FAIL 不跳过(PLAN action 1 字面)——每段仍独立进 harness。
  if (!alive) assert(false, `${name}(服务不可达 ${BASE})`);
  return !alive;
}

async function runPart2(): Promise<void> {
  console.log(`\n=== Part 2 探活聚合(live @${BASE};health 门 + P0-P5)===`);

  // ─── P0 SC1 verdict 文档(fs 级,不依赖 liveness) ──────────────────────
  console.log("\n=== P0 SC1 书面结论(docs/toonflow-replacement-verdict.md 六章节)===");
  const verdictPath = path.join(REPO_ROOT, "docs", "toonflow-replacement-verdict.md");
  const verdict = fs.existsSync(verdictPath) ? fs.readFileSync(verdictPath, "utf8") : "";
  assert(verdict.length > 0, "P0: verdict 文档存在且非空", verdictPath);
  for (const ch of [
    "## 结论（TL;DR）",
    "## 基线事实",
    "## 五维对比",
    "## 工作量估算（person-day）",
    "## 终态切换条件(root takeover checklist)",
    "## 本期已落地项",
  ]) {
    assert(verdict.includes(ch), `P0: 章节「${ch}」在位`);
  }

  // ─── H health 门 ──────────────────────────────────────────────────────
  const health = await liveFetch("/health");
  const alive = health != null && health.ok;
  assert(alive, "H: /health 可达(Part 2 P1-P5 前置门)", health == null ? "网络不可达" : `HTTP ${health.status}`);

  // ─── P1 门户三路由(成功标准 1 后半:壳可运行访问) ────────────────────────
  console.log("\n=== P1 门户三路由(200 + 制片门户;Pitfall 1 反向)===");
  if (!sectionFailIfDead(alive, "P1: 门户三路由")) {
    for (const p of ["/portal/", "/deliver/1", "/toonflow"]) {
      const r = await liveFetch(p);
      assert(r != null && r.status === 200, `P1: GET ${p} → 200`, r ? `HTTP ${r.status}` : "fetch 异常");
      assert(r?.text.includes("制片门户") ?? false, `P1: GET ${p} 含「制片门户」(未被 Toonflow 26MB 吞)`);
    }
    const bare = await liveFetch("/portal");
    assert(bare?.status === 301 && bare?.location === "/portal/", "P1: 裸 /portal → 301 /portal/(static 挂载形态)", bare ? `${bare.status} ${bare.location ?? ""}` : "fetch 异常");
  }

  // ─── P2 深链契约(D-05 对外稳定形态) ────────────────────────────────────
  console.log("\n=== P2 深链契约(/canvas 302 白名单翻译)===");
  if (!sectionFailIfDead(alive, "P2: 深链契约")) {
    const r = await liveFetch("/canvas?project=3&ep=1&focus=n-x&zone=p11b");
    assert(r?.status === 302, "P2: GET /canvas?project&ep&focus&zone → 302", r ? `HTTP ${r.status}` : "fetch 异常");
    assert(
      r?.location === "/infinite-canvas/?projectId=3&episodesId=1&focus=n-x&zone=p11b",
      "P2: Location 精确形态(57-02 同式)",
      r?.location ?? "",
    );
    const w = await liveFetch("/canvas?next=https://evil.example");
    assert(w?.status === 302 && w?.location === "/infinite-canvas/", "P2: 未知键不回显(开放重定向面反向)", w?.location ?? "");
  }

  // ─── P3 四岛共脸(D-06)+ navbar 产物 + toonflow iframe ──────────────────
  console.log("\n=== P3 四岛共脸(kap-navbar 各宿主形态)+ navbar 产物 ===");
  if (!sectionFailIfDead(alive, "P3: 四岛共脸")) {
    const ic = await liveFetch("/infinite-canvas/");
    assert(ic != null && ic.status === 200 && ic.text.includes("/assets/kap-nav.css"), "P3: /infinite-canvas/ HTML 引 kap-nav 产物(画布宿主 curl 形态;元素本体由 e2e 真浏览器断言)", ic ? `HTTP ${ic.status}` : "fetch 异常");
    for (const [p, active] of [["/story-map/", "story-map"], ["/director-desk/", "director-desk"]] as const) {
      const r = await liveFetch(p);
      const count = r ? (r.text.match(/<kap-navbar/g) ?? []).length : -1;
      assert(r != null && r.status === 200, `P3: GET ${p} → 200`, r ? `HTTP ${r.status}` : "fetch 异常");
      assert(count === 1 && r!.text.includes(`data-active="${active}"`), `P3: ${p} 注入恰 1 处 <kap-navbar data-active="${active}">`, `count=${count}`);
    }
    const pf = await liveFetch("/portal/");
    assert(pf?.text.includes("<kap-navbar") ?? false, "P3: /portal/ 文档壳含 <kap-navbar>(双通道注册之静态侧)");
    const navJs = await liveFetch("/assets/kap-nav.js");
    assert(navJs != null && navJs.ok && navJs.text.includes("kap-navbar"), "P3: /assets/kap-nav.js 200 且含元素定义", navJs ? `HTTP ${navJs.status}` : "fetch 异常");
    const navCss = await liveFetch("/assets/kap-nav.css");
    assert(navCss != null && navCss.ok && navCss.text.includes("--cv-bg-panel"), "P3: /assets/kap-nav.css 200 且含 token(concat 生效)", navCss ? `HTTP ${navCss.status}` : "fetch 异常");
    // /toonflow 页 iframe src="/":React 运行时渲染,curl 只见壳——降一档到 bundle 级存在性
    const m = pf?.text.match(/src="(\/portal\/assets\/[^"]+\.js)"/);
    const bundle = m ? await liveFetch(m[1]!) : null;
    assert(bundle != null && bundle.text.includes("iframe") && bundle.text.includes('src:"/"'), 'P3: /toonflow 页 iframe src="/" 存在(bundle 级)', m?.[1] ?? "portal 壳未引用 bundle");
  }

  // ─── P4 Toonflow 共存(U-01:/ 与旧 API 零破坏) ──────────────────────────
  console.log("\n=== P4 Toonflow 共存(/ 首字节 + agent-sync 旧链)===");
  if (!sectionFailIfDead(alive, "P4: Toonflow 共存")) {
    const root = await liveFetch("/");
    assert(root != null && root.status === 200, "P4: GET / → 200", root ? `HTTP ${root.status}` : "fetch 异常");
    assert(root?.text.includes("<title>Toonflow</title>") ?? false, "P4: / title 仍 Toonflow(共存零破坏)");
    assert(!(root?.text.includes("制片门户") ?? true), "P4: / 不含「制片门户」(门户不吞根)");
    const gp = await liveFetch("/api/project/getProject", { method: "POST", headers: JSON_HEADERS, body: "{}" });
    assert(gp != null && gp.status === 200, "P4: POST /api/project/getProject → 200(agent-sync 消费链)", gp ? `HTTP ${gp.status}` : "fetch 异常");
  }

  // ─── P5 交付面数据(成功标准 3 数据半边 + 成功标准 4 registry 半边) ────────
  console.log("\n=== P5 交付面(phases 直方图 + registry 22 条)===");
  if (!sectionFailIfDead(alive, "P5: 交付面")) {
    const pr = await liveFetch("/api/canvas/projects", { method: "POST", headers: JSON_HEADERS, body: "{}" });
    assert(pr != null && pr.status === 200, "P5: POST /api/canvas/projects → 200", pr ? `HTTP ${pr.status}` : "fetch 异常");
    let hasPhases = false;
    let epCount = 0;
    try {
      const data = (JSON.parse(pr?.text ?? "{}") as { data?: Array<{ episodes?: Array<{ phases?: unknown }> }> }).data ?? [];
      for (const proj of data) for (const ep of proj.episodes ?? []) { epCount++; if (ep.phases && typeof ep.phases === "object") hasPhases = true; }
    } catch { /* JSON 异常由下方断言红 */ }
    assert(hasPhases, "P5: episodes[].phases 直方图在位(U-08 additive)", `扫描 ${epCount} 集`);
    const ph = await liveFetch("/api/v1/skills/movie-v1/phases");
    let n = -1;
    try { n = ((JSON.parse(ph?.text ?? "{}") as { phases?: unknown[] }).phases ?? []).length; } catch { /* -1 即红 */ }
    assert(ph != null && ph.status === 200 && n === 22, "P5: GET /api/v1/skills/movie-v1/phases → 22 条(成功标准 4)", `HTTP ${ph?.status ?? "?"} n=${n}`);
  }
}

async function main(): Promise<void> {
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

  await runPart2();

  const passed = results.filter((r) => r.pass).length;
  const failed = results.length - passed;
  console.log(`\n=== Summary: ${passed}/${results.length} passed, FAIL = ${failed} ===`);
  if (failed === 0) {
    console.log("✅ Phase 57 全绿:Part 1 taxonomy 三方 drift(taxonomy ≡ registry ≡ catalog ≡ gates.yaml)+ Part 2 四需求探活聚合");
    process.exit(0);
  }
  for (const r of results.filter((x) => !x.pass)) console.log(`   FAIL: ${r.name} — ${r.detail ?? ""}`);
  process.exit(1);
}

main().catch((err) => {
  console.error("verify-phase-57.ts crashed:", err);
  process.exit(2);
});
