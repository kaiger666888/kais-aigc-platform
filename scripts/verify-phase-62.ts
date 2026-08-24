#!/usr/bin/env tsx
/**
 * verify-phase-62.ts — Phase 62 (asset-hierarchy-selection) aggregate contract gate.
 * verify-phase-61.ts 同骨架: assert/read/exists/countOcc 收集 + 末尾失败计数 →
 * process.exit(0 全绿 / 1 任一失败 / 2 crash)。
 *
 * ⚠ 62-07 前置(wave-5 front-load)形态: 本文件当前只落 S 静态锁段(锁定对象均为
 * master 已有 62-01..03 产物);B 行为门 / F forced-failure 为显式 TODO stub,
 * 由 62-07 最终执行者(wave 5)按 62-07-PLAN Task 3 补全并挂 package.json
 * "verify:phase-62" 行(前置 executor 不碰 package.json)。
 *
 *   S 静态锁段(本次落地):
 *     S1 键面口径(62-02 RESEARCH F 漂移修正③): tsx 直接 import 前端常量表——
 *        GENERATION_CONFIG_KEYS 14 键 = 嵌套 11 + 扁平 3;preCap1 5;
 *        unwired 2;LOCKED reportAudit count 18(锁定区合计 19);
 *        'p09_shotlist.transition' 不在键集(27-02 单键裁决: transition 并入
 *        shot_list,无独立候选域)。
 *     S2 判定式单套(D-04 红线): getGroupKey / getGroupDisplayInfo /
 *        isAssetSelected / isAssetPending / isAssetEliminated 五式定义
 *        源码全域恰 1 处且仅在 groupCanvasLinkage.ts;AssetLibrary.tsx 从该
 *        文件 import 五式(62-01 纯移动消费面)。
 *     S3 双拷贝键集一致(62-02 裁定漂移锁): 服务端 generationConfigService.ts
 *        键集与前端 generationConfigKeys.ts 键集逐键相等(键集 + tier 逐键)。
 *     S4 覆盖层表在位(62-02 D-08①): initDB.ts relationalCanvasTables 数组内
 *        含 generation_config_overrides(boot 幂等建表);router.ts 挂载
 *        /api/canvas/v2/generation-config 路由。
 *     S5 锁定区文案: p10_voice.tts 双侧 phaseKey 相同且 reason 含「钉死 1」
 *        (TTS 首选即定);clampRedundancy 前端第一道 + 服务端兜底第二道双侧
 *        导出(D-10 khs resolver 逐字钳制)。
 *
 *   TODO(62-07 wave-5 最终执行者补全):
 *     B 行为门: 子进程链 npm run build → playwright 三 phase62 文件
 *        (hierarchy/selection/redundancy-config)→ 回归面五文件(phase52 三件套
 *        + phase55-nav + phase61-debt,17 用例),退出码逐一判(T-62-23)。
 *     F forced-failure: 前端常量表变异副本(删一键/改一 tier)必须使
 *        checkKeyTablesEqual 判不等(锁与自检同源——比较器已导出,直接复用;
 *        T-62-22 门自身假绿缓解)。
 *     S 补全两锚: 默认视图 assetView:'library'(canvasStore)+ model.ts
 *        candidates 公式行 total - selected - eliminated 在场(DAG 派生零改动);
 *        S2 内联负扫(`isPrimaryView &&` 于 assetManager 目录仅判定式文件命中
 *        —— 待 62-04/05/06 收敛 SceneShotManager/CharacterWardrobe 内联式后落锁);
 *        S5 clamp 越界 UI 文案(「数值越界: pre ≥ 1, final 需在 1..pre 之间」)。
 *
 * Run: npx tsx scripts/verify-phase-62.ts   (npm run verify:phase-62 — 62-07 收尾挂)
 * Exit: 0 S 全绿且 B/F 均为 deferred-stub / 1 任一 S 失败 / 2 crash
 */

import fs from "node:fs";
import path from "node:path";

/**
 * 双仓常量表加载: tsx 运行时 require(编译加载真表,非正则解析——62-07「tsx 直接
 * import 双仓常量表」之运行时等价形)。刻意不用静态 import: 根 tsconfig exclude 了
 * packages/ 且 moduleResolution: Node 解析不了 @kais/flowgraph-v3,静态 import 会把
 * 前端源码图拽进根 tsc --noEmit 程序面(B1 行为门红线)——require 在 tsc 下为 any,
 * 不加程序边,tsx 下照常编译加载。
 */
interface KeyDef {
  phaseKey: string;
  tier: string;
  preCap1?: true;
  unwired?: true;
}
interface LockedConst {
  tts: { phaseKey: string; reason: string };
  reportAudit: { count: number; reason: string };
}
const FE_TABLES = require("../packages/infinite-canvas/src/components/assetManager/generationConfigKeys") as {
  GENERATION_CONFIG_KEYS: readonly KeyDef[];
  LOCKED_CONFIG_KEYS: LockedConst;
  LOCKED_KEYS_TOTAL: number;
  clampRedundancy: (pre: number, final: number) => { pre: number; final: number };
};
const BE_TABLES = require("../src/lib/generationConfigService") as {
  GENERATION_CONFIG_KEYS: readonly KeyDef[];
  LOCKED_CONFIG_KEYS: LockedConst;
  clampRedundancy: (pre: number, final: number) => { pre: number; final: number };
};
const FE_KEYS = FE_TABLES.GENERATION_CONFIG_KEYS;
const FE_LOCKED = FE_TABLES.LOCKED_CONFIG_KEYS;
const FE_LOCKED_TOTAL = FE_TABLES.LOCKED_KEYS_TOTAL;
const feClampRedundancy = FE_TABLES.clampRedundancy;
const BE_KEYS = BE_TABLES.GENERATION_CONFIG_KEYS;
const BE_LOCKED = BE_TABLES.LOCKED_CONFIG_KEYS;
const beClampRedundancy = BE_TABLES.clampRedundancy;

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

/** 字面量子串计数(indexOf 循环,非正则——避免元字符歧义;61 同款)。 */
function countOcc(text: string, needle: string): number {
  let n = 0;
  let i = text.indexOf(needle);
  while (i >= 0) { n += 1; i = text.indexOf(needle, i + needle.length); }
  return n;
}

// ── 可复用锁检查函数(F 段变异自检将对同函数跑样本——锁与自检同源,非两套逻辑) ──

interface LockOutcome { ok: boolean; detail: string; }

/** 键面行最小结构(前端 GenerationConfigKey / 服务端 GenerationConfigKeyDef 共形)。 */
interface KeyLike {
  phaseKey: string;
  tier: string;
  preCap1?: true;
  unwired?: true;
}

/** 锁定区结构(tts 单列 + reportAudit 汇总;双侧 as const 共形)。 */
interface LockedLike {
  tts: { phaseKey: string; reason: string };
  reportAudit: { count: number; reason: string };
}

/**
 * S1 键面口径锁(纯函数: 输入前端常量表)。14 键 = 嵌套 11 + 扁平 3;
 * preCap1 5 / unwired 2;reportAudit count 18;p09_shotlist.transition 不在键集。
 */
export function checkFrontendKeyProfile(keys: readonly KeyLike[], locked: LockedLike): LockOutcome {
  const nested = keys.filter((k) => k.phaseKey.includes(".")).length;
  const flat = keys.length - nested;
  const preCap1 = keys.filter((k) => k.preCap1 === true).length;
  const unwired = keys.filter((k) => k.unwired === true).length;
  const transitionAbsent = !keys.some((k) => k.phaseKey === "p09_shotlist.transition");
  const ok =
    keys.length === 14 && nested === 11 && flat === 3 && preCap1 === 5 &&
    unwired === 2 && locked.reportAudit.count === 18 && transitionAbsent;
  return {
    ok,
    detail: `total=${keys.length}==14 nested=${nested}==11 flat=${flat}==3 preCap1=${preCap1}==5 unwired=${unwired}==2 reportAudit=${locked.reportAudit.count}==18 transitionAbsent=${transitionAbsent}`,
  };
}

/**
 * S3 双拷贝键集一致锁(纯函数,62-02 漂移锁)。长度相等 + 键集双向相等 +
 * tier 逐键相等(前端 generationConfigKeys.ts ↔ 服务端 generationConfigService.ts)。
 */
export function checkKeyTablesEqual(fe: readonly KeyLike[], be: readonly KeyLike[]): LockOutcome {
  if (fe.length !== be.length) {
    return { ok: false, detail: `长度不等: fe=${fe.length} be=${be.length}` };
  }
  const feMap = new Map(fe.map((k) => [k.phaseKey, k.tier]));
  const beMap = new Map(be.map((k) => [k.phaseKey, k.tier]));
  const missingInBE = [...feMap.keys()].filter((k) => !beMap.has(k));
  const missingInFE = [...beMap.keys()].filter((k) => !feMap.has(k));
  const tierMismatch = [...feMap.keys()].filter(
    (k) => beMap.has(k) && beMap.get(k) !== feMap.get(k),
  );
  const ok = missingInBE.length === 0 && missingInFE.length === 0 && tierMismatch.length === 0;
  return {
    ok,
    detail: ok
      ? `键集+tier 逐键相等(${fe.length} 键)`
      : `missingInBE=[${missingInBE.join(",")}] missingInFE=[${missingInFE.join(",")}] tierMismatch=[${tierMismatch
          .map((k) => `${k}: fe=${feMap.get(k)} be=${beMap.get(k)}`)
          .join("; ")}]`,
  };
}

/**
 * S5 锁定区文案锁(纯函数)。p10_voice.tts 双侧 phaseKey 相同且 reason 含
 * 「钉死 1」;reportAudit 汇总计数双侧同值 18。
 */
export function checkTtsLockPair(fe: LockedLike, be: LockedLike): LockOutcome {
  const phaseOk = fe.tts.phaseKey === "p10_voice.tts" && be.tts.phaseKey === "p10_voice.tts";
  const reasonFe = fe.tts.reason.includes("钉死 1");
  const reasonBe = be.tts.reason.includes("钉死 1");
  const countOk = fe.reportAudit.count === be.reportAudit.count && fe.reportAudit.count === 18;
  return {
    ok: phaseOk && reasonFe && reasonBe && countOk,
    detail: `phaseKey 双侧 p10_voice.tts=${phaseOk} reason 含「钉死 1」fe=${reasonFe}/be=${reasonBe} reportAudit 双侧 18=${countOk}`,
  };
}

// ── S2 判定式单套扫描(源码全域 .ts/.tsx 递归;61 S3 扫法同款) ──

/** 三态判定式 + 分组轴五式——定义唯一性对象(D-04 红线: 禁第二套)。 */
const PREDICATE_FUNCS = [
  "getGroupKey",
  "getGroupDisplayInfo",
  "isAssetSelected",
  "isAssetPending",
  "isAssetEliminated",
] as const;

const LINKAGE_FILE = path.join("packages", "infinite-canvas", "src", "components", "assetManager", "groupCanvasLinkage.ts");

/** 扫描根: 前端包源码 + 根服务端源码(两源码域 = 本仓全部 .ts/.tsx 源)。 */
const SCAN_DIRS = [path.join("packages", "infinite-canvas", "src"), "src"];

/** 函数定义命中(`function NAME(` 或 `NAME =` 赋值形——箭头函数定义覆盖)。 */
function scanDefinitionSites(relDirs: readonly string[], funcName: string): string[] {
  const needles = [`function ${funcName}(`, `${funcName} =`];
  const hits: string[] = [];
  const walk = (absDir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
      return; // 目录不存在/不可读: 跳过
    }
    for (const ent of entries) {
      const abs = path.join(absDir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === "node_modules" || ent.name === "dist" || ent.name === "build") continue;
        walk(abs);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(ent.name)) continue;
      try {
        const txt = fs.readFileSync(abs, "utf8");
        if (needles.some((t) => txt.includes(t))) hits.push(path.relative(REPO_ROOT, abs));
      } catch { /* unreadable: skip */ }
    }
  };
  for (const rel of relDirs) walk(path.join(REPO_ROOT, rel));
  return hits;
}

// ── B/F 段: 62-07 前置显式 TODO stub(deferred → 计 skipped,不计 FAIL) ──

const deferredSections: string[] = [];
function deferGate(section: string, todo: string): void {
  deferredSections.push(section);
  console.log(`\n=== ${section}: deferred to 62-07 final executor (wave 5) — counted as SKIPPED ===`);
  console.log(`    TODO: ${todo}`);
}

function main(): void {
  console.log("=== Phase 62 — verify-phase-62.ts (asset-hierarchy-selection aggregate gate: S 静态锁 + B 行为门 + F forced-failure) ===");
  console.log("=== 62-07 前置形态: S1-S5 现已落地;B/F 为 TODO stub(见文首 TODO 注释)===\n");

  // ═══ S — 静态锁段 ═════════════════════════════════════════════════════════
  console.log("=== S 静态锁: S1 键面口径 / S2 判定式单套 / S3 双拷贝键集一致 / S4 覆盖层表+路由 / S5 tts 钉死文案 ===");

  // S1 键面口径(检查函数与未来 F1 变异自检同源)
  const s1 = checkFrontendKeyProfile(FE_KEYS, FE_LOCKED);
  assert(
    s1.ok,
    "S1: 前端键面常量表口径——14 键(嵌套 11 + 扁平 3)/ preCap1 5 / unwired 2 / reportAudit 18 / transition 不在键集",
    s1.detail,
  );
  assert(
    FE_LOCKED_TOTAL === 19,
    "S1: LOCKED_KEYS_TOTAL = 19(tts 单列 1 + reportAudit 汇总 18,UI-SPEC 漂移修正③口径)",
    `total=${FE_LOCKED_TOTAL}`,
  );

  // S2 判定式单套(D-04 红线: 定义全域唯一,仅 groupCanvasLinkage.ts)
  for (const fn of PREDICATE_FUNCS) {
    const defSites = scanDefinitionSites(SCAN_DIRS, fn);
    const onlyInLinkage =
      defSites.length === 1 && defSites[0] === LINKAGE_FILE;
    assert(
      onlyInLinkage,
      `S2 (D-04): ${fn} 定义全仓恰 1 处且仅在 groupCanvasLinkage.ts(判定式单套)`,
      onlyInLinkage ? "" : `def sites: [${defSites.join(", ")}]`,
    );
  }
  {
    const libSrc = read(path.join("packages", "infinite-canvas", "src", "components", "assetManager", "AssetLibrary.tsx"));
    const fromIdx = libSrc.indexOf("from './groupCanvasLinkage'");
    const blockStart = fromIdx >= 0 ? libSrc.lastIndexOf("import {", fromIdx) : -1;
    const importBlock = blockStart >= 0 ? libSrc.slice(blockStart, fromIdx) : "";
    const allFive = PREDICATE_FUNCS.every((fn) => importBlock.includes(fn));
    assert(
      fromIdx >= 0 && allFive,
      "S2 (D-04): AssetLibrary 五式全部 import 自 './groupCanvasLinkage'(62-01 纯移动消费面)",
      fromIdx < 0 ? "import 语句不在场" : allFive ? "" : `import 块缺: ${PREDICATE_FUNCS.filter((fn) => !importBlock.includes(fn)).join(", ")}`,
    );
  }

  // S3 双拷贝键集一致(62-02 漂移锁;检查函数与未来 F 变异自检同源)
  const s3 = checkKeyTablesEqual(FE_KEYS, BE_KEYS);
  assert(
    s3.ok,
    "S3: 服务端 generationConfigService.ts 键集 + tier 与前端 generationConfigKeys.ts 逐键相等(双拷贝漂移锁)",
    s3.detail,
  );

  // S4 覆盖层表在位 + 路由挂载(initDB relationalCanvasTables 内含表 + router mount)
  {
    const initDbSrc = read(path.join("src", "lib", "initDB.ts"));
    const declIdx = initDbSrc.indexOf("const relationalCanvasTables");
    const tableIdx = initDbSrc.indexOf('name: "generation_config_overrides"');
    const useIdx = initDbSrc.indexOf("for (const t of relationalCanvasTables)");
    const inArray = declIdx >= 0 && tableIdx > declIdx && useIdx > tableIdx;
    assert(
      inArray,
      'S4: initDB.ts relationalCanvasTables 数组内含 generation_config_overrides 表(62-02 D-08① kap 权威覆盖层)',
      inArray
        ? `decl@${declIdx} < table@${tableIdx} < 遍历@${useIdx}`
        : `decl@${declIdx} table@${tableIdx} 遍历@${useIdx}(三者需依序在场)`,
    );
    const routerSrc = read(path.join("src", "router.ts"));
    assert(
      routerSrc.includes("./routes/canvas/v2/generation-config") &&
        routerSrc.includes('app.use("/api/canvas/v2/generation-config"'),
      'S4: router.ts 挂载 /api/canvas/v2/generation-config 路由(route171 import + app.use)',
    );
  }

  // S5 tts 钉死文案 + clamp 双道(检查函数与未来 F 变异自检同源)
  const s5 = checkTtsLockPair(FE_LOCKED, BE_LOCKED);
  assert(
    s5.ok,
    "S5: p10_voice.tts 双侧 phaseKey 一致且 reason 含「钉死 1」+ reportAudit 双侧 18(锁定区文案锁)",
    s5.detail,
  );
  assert(
    typeof feClampRedundancy === "function" && typeof beClampRedundancy === "function",
    "S5: clampRedundancy 前端第一道 + 服务端兜底第二道双侧导出(D-10 khs resolver 逐字钳制)",
  );

  // ═══ B — 行为门段(TODO stub: 62-07 wave-5 最终执行者补全) ══════════════════
  deferGate(
    "B 行为门",
    "spawn 子进程链: infinite-canvas npm run build(dist 纪律)→ playwright 三 phase62 文件" +
      "(hierarchy/selection/redundancy-config)→ 回归面五文件(phase52-regen/reroll/stale-panel + phase55-nav + " +
      "phase61-debt,17 用例),退出码逐一判(T-62-23 固定命令链);挂 package.json verify:phase-62 行",
  );

  // ═══ F — forced-failure 自检段(TODO stub: 62-07 wave-5 最终执行者补全) ══════
  deferGate(
    "F forced-failure 自检",
    "前端常量表变异副本(删一键/改一 tier)必须使已导出的 checkKeyTablesEqual 判不等" +
      "(锁与自检同源,T-62-22 假绿缓解);S1/S5 变异样本同式对 checkFrontendKeyProfile/checkTtsLockPair",
  );

  // ═══ Summary ═══════════════════════════════════════════════════════════════
  const passed = results.filter((r) => r.pass).length;
  const total = results.length;
  const failed = total - passed;
  console.log(
    `\n=== Summary: ${passed}/${total} S assertions passed, FAIL count = ${failed}, deferred B/F stubs = ${deferredSections.length} (skipped) ===`,
  );
  if (failed === 0 && deferredSections.length === 2) {
    console.log("✅ Phase 62 verification PASSED (62-07 前置: S 静态锁 S1-S5 ✓; B/F deferred to 62-07 final executor — wave 5)");
    process.exit(0);
  } else {
    console.log("❌ Phase 62 verification FAILED");
    for (const r of results.filter((x) => !x.pass)) {
      console.log(`   FAIL: ${r.name}${r.detail ? " — " + r.detail : ""}`);
    }
    process.exit(1);
  }
}

try {
  main();
} catch (err) {
  console.error("verify-phase-62.ts crashed:", err);
  process.exit(2);
}
