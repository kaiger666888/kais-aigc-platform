#!/usr/bin/env tsx
/**
 * verify-phase-62.ts — Phase 62 (asset-hierarchy-selection) aggregate contract gate.
 * verify-phase-61.ts 同骨架: assert/read/exists/countOcc/runCmd 收集 + 末尾失败计数 →
 * process.exit(0 全绿 / 1 任一失败 / 2 crash)。
 *
 *   S 静态锁段(S1-S5 62-07 前置已落地 + 62-07 收尾补全三锚):
 *     S1 键面口径(62-02 RESEARCH F 漂移修正③): tsx 直接 import 前端常量表——
 *        GENERATION_CONFIG_KEYS 14 键 = 嵌套 11 + 扁平 3;preCap1 5;
 *        unwired 2;LOCKED reportAudit count 18(锁定区合计 19);
 *        'p09_shotlist.transition' 不在键集(27-02 单键裁决: transition 并入
 *        shot_list,无独立候选域)。
 *     S2 判定式单套(D-04 红线): getGroupKey / getGroupDisplayInfo /
 *        isAssetSelected / isAssetPending / isAssetEliminated 五式定义
 *        源码全域恰 1 处且仅在 groupCanvasLinkage.ts;AssetLibrary.tsx 从该
 *        文件 import 五式(62-01 纯移动消费面)。62-07 补:内联负扫——完整三态
 *        判定式字串 `isPrimaryView && d.state !== 'eliminated'` 于 assetManager
 *        源码目录(除 __tests__)仅判定式文件命中(第二套内联式即红)。
 *     S3 双拷贝键集一致(62-02 裁定漂移锁): 服务端 generationConfigService.ts
 *        键集与前端 generationConfigKeys.ts 键集逐键相等(键集 + tier 逐键)。
 *     S4 覆盖层表在位(62-02 D-08①): initDB.ts relationalCanvasTables 数组内
 *        含 generation_config_overrides(boot 幂等建表);router.ts 挂载
 *        /api/canvas/v2/generation-config 路由。
 *     S5 锁定区文案: p10_voice.tts 双侧 phaseKey 相同且 reason 含「钉死 1」
 *        (TTS 首选即定);clampRedundancy 前端第一道 + 服务端兜底第二道双侧
 *        导出(D-10 khs resolver 逐字钳制)。62-07 补:clamp 越界 UI 文案锚
 *        (RedundancyConfigRail「数值越界：pre ≥ 1，final 需在 1..pre 之间」)。
 *     S6(62-07 补) 两静态锚: 默认视图 assetView:'library'(canvasStore 初始值
 *        未变——62 资产层零扰动库默认视图)+ model.ts DAG candidates 公式行
 *        `total - selected - eliminated` 在场(D-04 DAG 派生零改动)。
 *   B 行为门段(spawn 子进程,61 runCmd 同款;退出码逐一判 T-62-23 固定命令链):
 *     B1 infinite-canvas npm run build(dist 纪律: e2e 跑 build 产物)
 *     B2-B4 playwright 三 phase62 文件(hierarchy/selection/redundancy-config)
 *     B5-B9 回归面五文件(phase52-regen/reroll/stale-panel + phase55-nav +
 *     phase61-debt,17 用例)。
 *   F forced-failure 自检段(T-62-22 假绿缓解,61 F1-F3 形态): 三个内存变异
 *     样本(删一键→checkKeyTablesEqual / 删 preCap1 键→checkFrontendKeyProfile /
 *     删 tts reason 关键词→checkTtsLockPair)对同一检查函数必须判 false——
 *     锁与自检同源,非两套逻辑;变异样本不写任何真实文件。
 *
 * Run: npm run verify:phase-62
 * Exit: 0 S+B+F 全绿 / 1 任一失败 / 2 crash
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

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

// ── B/F 段(62-07 收尾落地: B 子进程命令链 + F 变异自检;61 同款基建) ──

/** B 段命令门: cwd + 命令,tail 摘要;非零 exit 红(59/60/61 同款)。 */
function runCmd(name: string, cwdRel: string, cmd: string, tailLines = 3): void {
  const res = spawnSync(cmd, {
    cwd: path.join(REPO_ROOT, cwdRel),
    shell: true,
    encoding: "utf8",
    timeout: 300_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  const out = (res.stdout ?? "") + (res.stderr ?? "");
  const tail = out.split("\n").filter((l) => l.trim().length > 0).slice(-tailLines).join(" | ");
  assert(
    res.status === 0,
    `cmd: ${name} (exit ${res.status})`,
    res.status === 0 ? tail.slice(0, 160) : tail.slice(-300),
  );
}

/** 子串扫描: assetManager 源码目录(.ts/.tsx,排除 __tests__)含 needle 的文件清单。
 *  S2 内联负扫用——测试文件合法引用/引用式断言不计入源码域。 */
function scanAssetManagerSources(needle: string): string[] {
  const hits: string[] = [];
  const walk = (absDir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const abs = path.join(absDir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === "__tests__") continue;
        walk(abs);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(ent.name)) continue;
      try {
        const txt = fs.readFileSync(abs, "utf8");
        if (txt.includes(needle)) hits.push(path.relative(REPO_ROOT, abs));
      } catch { /* unreadable: skip */ }
    }
  };
  walk(path.join(REPO_ROOT, "packages", "infinite-canvas", "src", "components", "assetManager"));
  return hits;
}

function main(): void {
  console.log("=== Phase 62 — verify-phase-62.ts (asset-hierarchy-selection aggregate gate: S 静态锁 + B 行为门 + F forced-failure) ===");
  console.log("=== S1-S5 静态锁 + 62-07 补全锚(S2 内联负扫/S5 clamp 文案/S6 默认视图+DAG 公式);B 子进程命令链;F 变异自检 ===\n");

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
  // S2 内联负扫(62-07 补): 完整三态判定式字串(selected/pending 两式共尾串)于
  // assetManager 源码目录(排除 __tests__)仅判定式文件命中——SceneShotManager/
  // CharacterWardrobe 的近似内联式(状态回退形/取反变量形)不等于完整式,不误伤;
  // 真出现第二套完整内联式即此处红。
  {
    const inlineHits = scanAssetManagerSources("isPrimaryView && d.state !== 'eliminated'");
    const onlyLinkage = inlineHits.length === 1 && inlineHits[0] === LINKAGE_FILE;
    assert(
      onlyLinkage,
      "S2 (D-04): 内联负扫——完整判定式字串 `isPrimaryView && d.state !== 'eliminated'` 于 assetManager 源码(除 __tests__)仅 groupCanvasLinkage.ts 命中",
      onlyLinkage ? "" : `命中文件: [${inlineHits.join(", ")}]`,
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
  // S5 补(62-07): clamp 越界 UI 文案锚——前端道同函数驱动的行内文案逐字在场
  // (CLAMP_ERROR_TEXT 常量;后端 400 toast 同串由 e2e phase62-redundancy-config 锁)。
  {
    const railSrc = read(path.join("packages", "infinite-canvas", "src", "components", "assetManager", "RedundancyConfigRail.tsx"));
    assert(
      railSrc.includes("数值越界：pre ≥ 1，final 需在 1..pre 之间"),
      "S5 (D-10): RedundancyConfigRail clamp 越界文案「数值越界：pre ≥ 1，final 需在 1..pre 之间」逐字在场",
    );
  }

  // S6(62-07 补) 两静态锚: 默认视图 + DAG candidates 公式行
  {
    const storeSrc = read(path.join("packages", "infinite-canvas", "src", "store", "canvasStore.ts"));
    // 初始值行锚(非类型联合行): /^\s*assetView: 'library',\s*$/m —— 62 资产层
    // 零扰动库默认视图(UI-SPEC Layout 裁定:默认视图资产管理中心=library)。
    const defaultViewInit = /^\s*assetView: 'library',\s*$/m.test(storeSrc);
    assert(
      defaultViewInit,
      "S6: canvasStore 默认视图 assetView: 'library' 初始值未变(62 资产层级为第 5 Tab 非默认视图)",
    );
    const modelSrc = read(path.join("packages", "infinite-canvas", "src", "components", "pipeline", "model.ts"));
    // DAG 派生公式行(D-04 裁定: 两侧派生代码零改动——公式行逐字在场,恰 1 处代码行
    // (另 1 处为 :813 注释,不计))。
    const formulaCount = countOcc(modelSrc, "const candidates = Math.max(0, total - selected - eliminated)");
    assert(
      formulaCount === 1,
      "S6: model.ts DAG candidates 公式行 `const candidates = Math.max(0, total - selected - eliminated)` 恰 1 处代码行(:937,D-04 跨源契约的图侧派生零改动)",
      `count=${formulaCount}`,
    );
  }

  // ═══ B — 行为门段(spawn 子进程命令链,61 runCmd 同款;T-62-23 固定链不选择性执行) ═
  // e2e 命令统一 --retries=1:phase55-nav 为 STATE 已记录的负载噪音 flaky 文件
  // (61-01 先例:个别用例红 → 隔离重跑判 flake;本机链式连跑时 52/55/61 面均观测到
  // 跨 run 不重叠的环境红,基线源码复测同红——非 62 回归)。playwright retries 语义:
  // 复现性红(重试仍红)→ exit 1 照红;单次环境红 → 记 flaky 后绿,reporter 全程留痕。
  console.log("\n=== B 行为门: infinite-canvas build(dist 纪律) → phase62 三文件 e2e → 回归面五文件 e2e ===");
  runCmd(
    "B1 infinite-canvas build(dist 纪律: e2e 跑 build 产物非源码)",
    "packages/infinite-canvas",
    "npm run build",
    3,
  );
  runCmd(
    "B2 phase62-hierarchy e2e(8 用例)",
    "packages/infinite-canvas",
    "npx playwright test --retries=1 test/e2e/tests/phase62-hierarchy.mjs",
    3,
  );
  runCmd(
    "B3 phase62-selection e2e(7 用例)",
    "packages/infinite-canvas",
    "npx playwright test --retries=1 test/e2e/tests/phase62-selection.mjs",
    3,
  );
  runCmd(
    "B4 phase62-redundancy-config e2e(7 用例)",
    "packages/infinite-canvas",
    "npx playwright test --retries=1 test/e2e/tests/phase62-redundancy-config.mjs",
    3,
  );
  runCmd(
    "B5 回归 phase52-regen",
    "packages/infinite-canvas",
    "npx playwright test --retries=1 test/e2e/tests/phase52-regen.mjs",
    3,
  );
  runCmd(
    "B6 回归 phase52-reroll",
    "packages/infinite-canvas",
    "npx playwright test --retries=1 test/e2e/tests/phase52-reroll.mjs",
    3,
  );
  runCmd(
    "B7 回归 phase52-stale-panel",
    "packages/infinite-canvas",
    "npx playwright test --retries=1 test/e2e/tests/phase52-stale-panel.mjs",
    3,
  );
  runCmd(
    "B8 回归 phase55-nav",
    "packages/infinite-canvas",
    "npx playwright test --retries=1 test/e2e/tests/phase55-nav.mjs",
    3,
  );
  runCmd(
    "B9 回归 phase61-debt",
    "packages/infinite-canvas",
    "npx playwright test --retries=1 test/e2e/tests/phase61-debt.mjs",
    3,
  );

  // ═══ F — forced-failure 自检段(T-62-22 门自身假绿缓解;61 F1-F3 形态) ════════
  // 三个内存变异样本(不写任何真实文件)对各自检查函数必须判 false——锁与自检
  // 同源(同一导出比较器),任一变异样本被判 true(锁恒真)→ 整门 exit 1。
  console.log("\n=== Forced-failure self-check (gate can actually fail — expected FAILs below; 变异样本不写真实文件) ===");
  const selfCheckShadow: { name: string; pass: boolean }[] = [];
  const shadowAssert = (cond: boolean, name: string): void => {
    selfCheckShadow.push({ name, pass: cond });
    console.log(`  SELF-CHECK ${cond ? "UNEXPECTED-PASS" : "expected-FAIL ok"}: ${name}`);
  };

  // F1 变异: 删一键(前端表副本)——checkKeyTablesEqual 对「fe 缺键」必须判不等
  const feMinusOne = FE_KEYS.filter((k) => k.phaseKey !== "p01_hook.topic_kernel");
  shadowAssert(
    checkKeyTablesEqual(feMinusOne, BE_KEYS).ok,
    "F1 变异样本(删一键 p01_hook.topic_kernel)必须使 S3 checkKeyTablesEqual 判 false",
  );

  // F2 变异: 删 preCap1 键——checkFrontendKeyProfile 键数/preCap1 计数双破,必须判 false
  const feMinusPreCap1 = FE_KEYS.filter((k) => k.phaseKey !== "p07_style.style_vector");
  shadowAssert(
    checkFrontendKeyProfile(feMinusPreCap1, FE_LOCKED).ok,
    "F2 变异样本(删 preCap1 键 p07_style.style_vector)必须使 S1 checkFrontendKeyProfile 判 false",
  );

  // F3 变异: tts reason 删「钉死 1」关键词——checkTtsLockPair 必须判 false
  const lockedMutant = {
    tts: { phaseKey: FE_LOCKED.tts.phaseKey, reason: "TTS 首选即定（防铺轨污染）· pre 固定 1" },
    reportAudit: FE_LOCKED.reportAudit,
  };
  shadowAssert(
    checkTtsLockPair(lockedMutant, BE_LOCKED).ok,
    "F3 变异样本(tts reason 钉死 1→固定 1)必须使 S5 checkTtsLockPair 判 false",
  );

  assert(
    selfCheckShadow.length >= 3 && selfCheckShadow.every((r) => !r.pass),
    "forced-failure self-check: 三个变异样本全部被对应比较器判 false(锁非恒真,门能红)",
    `shadow: ${selfCheckShadow.filter((r) => r.pass).length}/${selfCheckShadow.length} unexpectedly passed`,
  );

  // ═══ Summary ═══════════════════════════════════════════════════════════════
  const passed = results.filter((r) => r.pass).length;
  const total = results.length;
  const failed = total - passed;
  console.log(`\n=== Summary: ${passed}/${total} assertions passed (S 静态锁 + B 行为门), FAIL count = ${failed} (self-check excluded) ===`);
  if (failed === 0) {
    console.log("✅ Phase 62 verification PASSED (S 静态锁 S1-S6 ✓ B 行为门 B1-B9 ✓ + forced-failure self-check ✓)");
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
