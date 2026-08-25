#!/usr/bin/env tsx
/**
 * verify-phase-55.ts — Phase 55 (NAV-01) 契约测试:kap PHASE_REGISTRY(23 phase
 * 单一注册表;2026-08-25 p11a5 跟进后 22→23)≡ khs 三真相源,任一漂移即红
 * (D-01 镜像纪律,verify-schema-drift 第三次复刻)。
 *
 * 真相源(只读,KAIS_HERMES_SKILLS_PATH 可覆盖):
 *   - plugins/kais_aigc/canvas_sync.py  _PHASE_INDEX_MAP   (prefix → phaseIndex)
 *   - plugins/kais_aigc/canvas_sync.py  _PHASE_TYPE_MAP    (prefix → canvas/asset type; PRG-03)
 *   - plugins/kais_aigc/canvas_graph.py ZONE_PHASES        (有序 prefix,label,group)
 *   - skills/kais-movie-pipeline/pipeline/phases/__init__.py PHASE_REGISTRY (23 活跃 id)
 *
 * 断言组:
 *   A 集合等价(khs id 前缀集 ↔ kap khsPrefix 集,双向 diff)
 *   B 编号(_PHASE_INDEX_MAP 逐条;p11a0 不在 map → 断言与 p11a 同 phaseIndex)
 *   C 归组(ZONE_PHASES group ↔ registry group;无 zone 条目前缀跳过)
 *   D 顺序(ZONE 活跃序列 ↔ registry sortKey 升序同前缀子序列逐一相等)
 *   E 注销(DEREGISTERED 前缀不在 registry)
 *   F 类型(_PHASE_TYPE_MAP ↔ registry canvasType/assetType;2026-08-25 PRG-03
 *     新增——此前 6/22 条目分叉且无门可测,review F24)
 *
 * 只读 fs + TS regex 解析,零子进程调用(T-55-01)。
 * Run: npm run verify:phase-55
 */

import fs from "node:fs";
import path from "node:path";
import {
  PHASE_REGISTRY,
  DEREGISTERED_PHASE_PREFIXES,
} from "../packages/infinite-canvas/src/constants/phaseRegistry";

interface TestResult { name: string; pass: boolean; detail?: string }
const results: TestResult[] = [];
function assert(cond: boolean, name: string, detail?: string): void {
  results.push({ name, pass: cond, detail });
  console.log(`  ${cond ? "PASS" : "FAIL"}: ${name}${detail ? " — " + detail : ""}`);
}

const SIBLING_ROOT = process.env.KAIS_HERMES_SKILLS_PATH ?? "/data/workspace/kais-hermes-skills";
const PHASE_INDEX_MAP_PATH = path.join(SIBLING_ROOT, "plugins/kais_aigc/canvas_sync.py");
const ZONE_PHASES_PATH = path.join(SIBLING_ROOT, "plugins/kais_aigc/canvas_graph.py");
const PHASE_REGISTRY_PATH = path.join(SIBLING_ROOT, "skills/kais-movie-pipeline/pipeline/phases/__init__.py");

// ⚠️ 正则解析的脆弱性是有意的契约漂移信号(verify-schema-drift 同款纪律):
// 解析到 0 条即 FAIL —— khs 改写法导致解析失效本身就是「契约漂移」告警。
// 不要「修复」为更健壮的解析器。
function readOrFail(p: string, label: string): string {
  if (!fs.existsSync(p)) {
    console.error(`FATAL: ${label} 不存在: ${p}`);
    process.exit(1);
  }
  return fs.readFileSync(p, "utf8");
}

/** 深度计数提取:自 startIdx 起,到配对 closeCh 的闭合处(含)。 */
function extractBlock(source: string, startIdx: number, openCh: string, closeCh: string): string {
  let depth = 0;
  for (let i = startIdx; i < source.length; i++) {
    if (source[i] === openCh) depth++;
    else if (source[i] === closeCh) {
      depth--;
      if (depth === 0) return source.slice(startIdx, i + 1);
    }
  }
  return source.slice(startIdx);
}

function parsePhaseIndexMap(source: string): Map<string, number> {
  const out = new Map<string, number>();
  const m = source.match(/^\s*_PHASE_INDEX_MAP[^{]*\{/m);
  if (!m || m.index === undefined) return out;
  const body = extractBlock(source, m.index + m[0].length - 1, "{", "}");
  for (const e of body.matchAll(/"([^"]+)"\s*:\s*(\d+)/g)) {
    out.set(e[1]!, Number(e[2]));
  }
  return out;
}

/** PRG-03(2026-08-25): prefix → (canvas_type, asset_type),与 _PHASE_TYPE_MAP 逐条。 */
function parsePhaseTypeMap(source: string): Map<string, [string, string]> {
  const out = new Map<string, [string, string]>();
  const m = source.match(/^\s*_PHASE_TYPE_MAP[^{]*\{/m);
  if (!m || m.index === undefined) return out;
  const body = extractBlock(source, m.index + m[0].length - 1, "{", "}");
  for (const e of body.matchAll(/"([^"]+)"\s*:\s*\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\)/g)) {
    out.set(e[1]!, [e[2]!, e[3]!]);
  }
  return out;
}

interface ZoneEntry { prefix: string; label: string; group: string }

function parseZonePhases(source: string): ZoneEntry[] {
  const out: ZoneEntry[] = [];
  // 类型注解里的 `list[tuple[...]]` 含中括号,定位必须跳过赋值号后的真列表体。
  const m = source.match(/^\s*ZONE_PHASES[^=]*=\s*\[/m);
  if (!m || m.index === undefined) return out;
  const body = extractBlock(source, m.index + m[0].length - 1, "[", "]");
  for (const e of body.matchAll(/\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\)/g)) {
    out.push({ prefix: e[1]!, label: e[2]!, group: e[3]! });
  }
  return out;
}

function parseKhsPhaseRegistry(source: string): string[] {
  const out: string[] = [];
  const m = source.match(/^\s*PHASE_REGISTRY[^=]*=\s*\[/m);
  if (!m || m.index === undefined) return out;
  const body = extractBlock(source, m.index + m[0].length - 1, "[", "]");
  for (const e of body.matchAll(/"id"\s*:\s*"([^"]+)"/g)) {
    out.push(e[1]!);
  }
  return out;
}

function main(): void {
  console.log("=== Phase 55 — verify-phase-55.ts (NAV-01 契约:kap 注册表 ≡ khs 三真相源) ===\n");

  const mapSource = readOrFail(PHASE_INDEX_MAP_PATH, "canvas_sync.py");
  const zoneSource = readOrFail(ZONE_PHASES_PATH, "canvas_graph.py");
  const regSource = readOrFail(PHASE_REGISTRY_PATH, "phases/__init__.py");

  const indexMap = parsePhaseIndexMap(mapSource);
  const typeMap = parsePhaseTypeMap(mapSource);
  const zones = parseZonePhases(zoneSource);
  const khsIds = parseKhsPhaseRegistry(regSource);

  console.log("=== 解析门(0 条即 FAIL — 脆弱性即契约信号) ===");
  assert(indexMap.size >= 20, `S-parse: _PHASE_INDEX_MAP ${indexMap.size} 条`, [...indexMap.entries()].slice(0, 3).map(([k, v]) => `${k}=${v}`).join(","));
  assert(typeMap.size >= 20, `S-parse: _PHASE_TYPE_MAP ${typeMap.size} 条`, [...typeMap.keys()].slice(0, 3).join(","));
  assert(zones.length >= 20, `S-parse: ZONE_PHASES ${zones.length} 条`, zones.slice(0, 2).map((z) => z.prefix).join(","));
  assert(khsIds.length === 24, `S-parse: khs PHASE_REGISTRY 24 活跃 id (2026-08-25 +p11a5, ICA M2 +p036)`, String(khsIds.length));

  const khsPrefixOfId = (id: string): string => id.match(/^p\d+[a-z0-9]*/)?.[0] ?? "";
  const khsActive = new Set(khsIds.map(khsPrefixOfId).filter(Boolean));
  const kapKhs = new Set(PHASE_REGISTRY.map((p) => p.khsPrefix));
  const byKhs = new Map(PHASE_REGISTRY.map((p) => [p.khsPrefix, p]));

  console.log("\n=== A 集合等价(双向 diff) ===");
  const onlyInKap = [...kapKhs].filter((x) => !khsActive.has(x)).sort();
  const onlyInKhs = [...khsActive].filter((x) => !kapKhs.has(x)).sort();
  assert(onlyInKap.length === 0, `A: 无 only-in-kap`, onlyInKap.join(",") || undefined);
  assert(onlyInKhs.length === 0, `A: 无 only-in-khs`, onlyInKhs.join(",") || undefined);
  assert(PHASE_REGISTRY.length === 24, `A: kap 注册表恰 24 条 (+p11a5, ICA M2 8839d49b +p036)`, String(PHASE_REGISTRY.length));

  console.log("\n=== B 编号(_PHASE_INDEX_MAP 逐条) ===");
  const mismatches: string[] = [];
  for (const [pfx, idx] of indexMap) {
    const entry = byKhs.get(pfx);
    if (entry == null) continue; // 注销单体(p05/p10b/p11/p12)不在 kap 注册表,E 组守护
    if (entry.phaseIndex !== idx) mismatches.push(`${pfx}: kap=${entry.phaseIndex} khs=${idx}`);
  }
  assert(mismatches.length === 0, "B: 全部 phaseIndex 与 _PHASE_INDEX_MAP 等值", mismatches.slice(0, 4).join("; ") || undefined);
  assert(!indexMap.has("p11a0"), "B: p11a0 不在 _PHASE_INDEX_MAP(本会话已验证的 khs 现实)");
  const a0 = byKhs.get("p11a0");
  const a = byKhs.get("p11a");
  assert(a0 != null && a != null && a0.phaseIndex === a.phaseIndex, "B: p11a0.phaseIndex === p11a.phaseIndex(折叠)", `${a0?.phaseIndex} vs ${a?.phaseIndex}`);

  console.log("\n=== C 归组(ZONE_PHASES group 权威) ===");
  const groupDrift: string[] = [];
  const zoneByPrefix = new Map(zones.map((z) => [z.prefix, z]));
  for (const entry of PHASE_REGISTRY) {
    // khsPrefix 自有 zone 条目才比对(p11a0 无条目——折叠进 p11a lane,跳过)。
    const z = zoneByPrefix.get(entry.khsPrefix);
    if (z == null) continue;
    if (z.group !== entry.group) groupDrift.push(`${entry.khsPrefix}: kap=${entry.group} zone=${z.group}`);
  }
  assert(groupDrift.length === 0, "C: 全部 group 与 ZONE_PHASES 等值", groupDrift.slice(0, 4).join("; ") || undefined);
  const labelDrift: string[] = [];
  for (const entry of PHASE_REGISTRY) {
    const z = zoneByPrefix.get(entry.khsPrefix);
    if (z == null) continue; // p11a0:合成 label,无 zone 条目
    if (z.label !== entry.label) labelDrift.push(`${entry.khsPrefix}: "${entry.label}" vs "${z.label}"`);
  }
  assert(labelDrift.length === 0, "C: 全部 label 与 ZONE_PHASES 文案一致", labelDrift.slice(0, 3).join("; ") || undefined);

  console.log("\n=== D 顺序(lane 内 ZONE 活跃序列 = sortKey 升序子序列) ===");
  const dereg = new Set<string>(DEREGISTERED_PHASE_PREFIXES);
  const zoneActive = zones.filter((z) => !dereg.has(z.prefix)).map((z) => z.prefix);
  const sortedKap = [...PHASE_REGISTRY].sort((x, y) => x.sortKey - y.sortKey).map((p) => p.khsPrefix);
  const zoneSubseq = sortedKap.filter((p) => zoneActive.includes(p));
  assert(
    JSON.stringify(zoneSubseq) === JSON.stringify(zoneActive),
    "D: ZONE 活跃序列与 sortKey 升序同前缀子序列逐项相等",
    `kap:[${zoneSubseq.join(",")}] zone:[${zoneActive.join(",")}]`,
  );

  console.log("\n=== E 注销 ===");
  const liveKap = PHASE_REGISTRY.map((p) => p.khsPrefix);
  assert(!dereg.has("p11a0"), "E: p11a0 不是注销前缀");
  assert(liveKap.every((p) => !dereg.has(p)), "E: 注销前缀(p05/p10b/p11/p12)零存活", liveKap.filter((p) => dereg.has(p)).join(",") || undefined);

  console.log("\n=== F 类型(_PHASE_TYPE_MAP ↔ canvasType/assetType;PRG-03) ===");
  // p11a0 折叠进 p11a(无独立 TYPE_MAP 条目)→ 跳过;其余注册条目必须逐条等值。
  // 2026-08-25 前的旧门只查 id/index/zone/顺序,canvasType/assetType 6/22 分叉
  // 测不出(review F24)——此组即防复发。
  const typeDrift: string[] = [];
  for (const entry of PHASE_REGISTRY) {
    const t = typeMap.get(entry.khsPrefix);
    if (t == null) continue;
    if (t[0] !== entry.canvasType || t[1] !== entry.assetType) {
      typeDrift.push(`${entry.khsPrefix}: kap=${entry.canvasType}/${entry.assetType} khs=${t[0]}/${t[1]}`);
    }
  }
  assert(typeDrift.length === 0, "F: 全部 canvasType/assetType 与 _PHASE_TYPE_MAP 等值", typeDrift.slice(0, 4).join("; ") || undefined);
  assert(typeMap.has("p11a5"), "F: p11a5 已入 _PHASE_TYPE_MAP(p11a5 跟进核心项)");
  assert(!typeMap.has("p11a0"), "F: p11a0 仍折叠(无 TYPE_MAP 条目,A2 裁定)");

  const passed = results.filter((r) => r.pass).length;
  const failed = results.length - passed;
  console.log(`\n=== Summary: ${passed}/${results.length} passed, FAIL = ${failed} ===`);
  if (failed === 0) {
    console.log("✅ Phase 55 NAV-01 契约全绿(kap PHASE_REGISTRY ≡ khs 三真相源)");
    process.exit(0);
  }
  for (const r of results.filter((x) => !x.pass)) console.log(`   FAIL: ${r.name} — ${r.detail ?? ""}`);
  process.exit(1);
}

try {
  main();
} catch (err) {
  console.error("verify-phase-55.ts crashed:", err);
  process.exit(2);
}
