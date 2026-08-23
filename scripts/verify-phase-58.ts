#!/usr/bin/env tsx
/**
 * verify-phase-58.ts — Phase 58 (full-recipe-persistence) aggregate contract
 * gate (RECIPE-04 anti-drift): folds every automated verification of plans
 * 58-01..58-04 into one run (Phase 50/51/52 aggregate-gate tradition).
 *
 *   S1 三方集合相等 (planner 裁决 4 construction):
 *     常量侧 recipe.ts RECIPE_EDITABLE_FIELDS(零依赖相对 import,tsx 直连)
 *     ↔ schema 侧 canvasAssetSchema assetDataSchemas(同仓 zod v4 import,
 *       五分支 shape 键各含五配方键且互相相等)
 *     ↔ 高级子集 = RECIPE_ROUNDTRIP_KEYS p 侧去掉 prompt/negative/seed/
 *       modelVersion——三串排序字符串严格相等;任一侧新增字段未同步另一侧
 *       即红。另锁 modelVersion↔engine 唯一非恒等映射(禁裸字符串数组回潮)。
 *   S2 九键交叉验证 — zod.ts generationParamsSchema 九键 regex 文本提取 ↔
 *     RECIPE_ROUNDTRIP_KEYS p 侧。**不 import zod 对象**:三包 zod 版本分裂
 *     (根仓 4.3.5 / infinite-canvas 3.25.76 / flowgraph-v3 3.23.8,
 *     RESEARCH Pitfall 4)——只共享字符串键集。
 *   S3 消费证据 — migrate.ts 映射表驱动提取(import + 循环消费,禁手写键
 *     列表回潮) + serialize.ts 运行时 import @kais/flowgraph-v3 + delete
 *     传播行 + script stage prompt 例外(52-02 保留)。
 *   S4 nullish/optional 计数锁 — canvasAssetSchema 五配方键声明计数
 *     (每键 ×5 分支,防分支漏声明)。
 *   S5 命令门 — 三根 tsc + 双包 vitest(不经 shell 管道——管道尾 exit code 会
 *     掩蔽 vitest 失败,WR-01;tail 摘要在 JS 侧切;任一非零 exit 即红)。
 *   Forced-failure self-check — must-fail 断言组(含 sampler 必然失败项:
 *     A1 裁定 sampler 不存在,可编辑字段集已锁定五键);意外 PASS 整门红。
 *
 * NOTE: e2e (phase58-recipe.mjs, :9876 mock) 与真机探针 (probe-58-real.mjs,
 * :10588) 不在本门内——e2e 全量结果与探针零足迹记录见 58-03/58-04 SUMMARY;
 * 探针前置纪律 build → deploy-canvas.sh → build:server → restart(地雷 #10)。
 *
 * Run: npm run verify:phase-58   (or: npx tsx scripts/verify-phase-58.ts)
 * Exit: 0 all sections pass + self-check behaves / 1 any failure / 2 crash
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
// 常量侧:recipe.ts 零 import 纯常量模块,相对路径直连(58-01 锁定前提)。
import {
  RECIPE_ROUNDTRIP_KEYS,
  RECIPE_EDITABLE_FIELDS,
} from "../packages/flowgraph-v3/ts/src/recipe";
// schema 侧:同仓 zod v4(根仓 node_modules),无跨包 zod 对象 import(Pitfall 4)。
import { assetDataSchemas } from "../src/lib/canvasAssetSchema";

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

/** S5 命令门:cwd + 命令,tail 摘要;非零 exit 红。 */
function runCmd(name: string, cwdRel: string, cmd: string, tailLines = 3): void {
  const res = spawnSync(cmd, {
    cwd: path.join(REPO_ROOT, cwdRel),
    shell: true,
    encoding: "utf8",
    timeout: 300_000,
    // WR-01: 命令不再经 shell 管道,stdout/stderr 全量捕获——默认 1MB maxBuffer
    // 会被 vitest 全量输出撑爆(res.error=ENOBUFS 之外 status=null 假红),放大到 16MB。
    maxBuffer: 16 * 1024 * 1024,
  });
  const out = (res.stdout ?? "") + (res.stderr ?? "");
  const tail = out.split("\n").filter((l) => l.trim().length > 0).slice(-tailLines).join(" | ");
  assert(
    res.status === 0,
    `S5 cmd: ${name} (exit ${res.status})`,
    res.status === 0 ? tail.slice(0, 160) : tail.slice(-300),
  );
}

function main(): void {
  console.log("=== Phase 58 — verify-phase-58.ts (RECIPE-04 aggregate gate: 全配方持久化三方防漂移, plans 58-01..58-04) ===\n");

  // ═══ S1 — 三方集合相等(常量侧 ↔ schema 侧 ↔ 高级子集) ═══════════════════
  console.log("=== S1 三方集合相等: RECIPE_EDITABLE_FIELDS ↔ canvasAssetSchema ↔ ROUNDTRIP 高级子集 ===");
  const editableSorted = [...RECIPE_EDITABLE_FIELDS].sort().join(",");
  const BRANCHES = ["script", "asset", "storyboard", "video", "audio"] as const;

  // schema 侧:每分支 shape 键包含五配方键,且五分支配方键集合互相相等
  function recipeKeysOfBranch(t: string): string[] {
    const s = assetDataSchemas[t] as unknown as { shape?: Record<string, unknown> };
    return s && s.shape
      ? Object.keys(s.shape).filter((k) => (RECIPE_EDITABLE_FIELDS as readonly string[]).includes(k))
      : [];
  }
  assert(
    BRANCHES.every((t) => t in assetDataSchemas),
    "S1: assetDataSchemas 五类型键齐全(script/asset/storyboard/video/audio)",
  );
  const branchSets = BRANCHES.map((t) => recipeKeysOfBranch(t).sort().join(","));
  assert(
    branchSets.every((s) => s === editableSorted),
    "S1: 五分支各声明配方五键(EDITABLE ⊆ shape,不多不少)且互相相等",
    branchSets.map((s, i) => `${BRANCHES[i]}=[${s}]`).join(" "),
  );

  // 常量侧内部锁:九对映射、modelVersion↔engine 唯一非恒等、无重复键
  const pSide = RECIPE_ROUNDTRIP_KEYS.map((k) => k.p);
  assert(
    RECIPE_ROUNDTRIP_KEYS.length === 9 && new Set(pSide).size === 9,
    "S1: RECIPE_ROUNDTRIP_KEYS 恰九对且 p 侧无重复",
    `pairs=${RECIPE_ROUNDTRIP_KEYS.length}, uniqP=${new Set(pSide).size}`,
  );
  const nonIdentity = RECIPE_ROUNDTRIP_KEYS.filter((k) => k.p !== k.d);
  assert(
    nonIdentity.length === 1 &&
      nonIdentity[0]!.p === "modelVersion" &&
      nonIdentity[0]!.d === "engine",
    "S1: modelVersion↔engine 是唯一非恒等映射(禁裸字符串数组当键集,Pattern 1)",
    `nonIdentity=[${nonIdentity.map((k) => `${k.p}↔${k.d}`).join(",")}]`,
  );

  // 三方严格相等(三串排序字符串)
  const advancedSubsetSorted = pSide
    .filter((p) => !["prompt", "negative", "seed", "modelVersion"].includes(p))
    .sort()
    .join(",");
  const schemaSorted = branchSets[0] ?? "";
  assert(
    editableSorted === schemaSorted && schemaSorted === advancedSubsetSorted,
    "S1 三方集合相等: EDITABLE ↔ canvasAssetSchema 配方键 ↔ ROUNDTRIP p 侧高级子集(任一侧漂移即红)",
    `editable=[${editableSorted}] schema=[${schemaSorted}] advanced=[${advancedSubsetSorted}]`,
  );

  // ═══ S2 — 九键交叉验证(regex 文本提取,不 import zod 对象) ═══════════════
  console.log("\n=== S2 九键交叉验证: zod.ts generationParamsSchema(regex 提取,不 import zod 对象) ===");
  const zodSrc = read("packages/flowgraph-v3/ts/src/zod.ts");
  const gpStart = zodSrc.indexOf("export const generationParamsSchema");
  const gpEnd = zodSrc.indexOf(".catchall", gpStart);
  assert(
    gpStart >= 0 && gpEnd > gpStart,
    "S2: zod.ts generationParamsSchema 块可定位(...→ .catchall)",
  );
  const gpBlock = gpStart >= 0 ? zodSrc.slice(gpStart, gpEnd) : "";
  const zodKeys = [...gpBlock.matchAll(/^[ \t]+([A-Za-z_$][\w$]*):\s*z\./gm)].map((m) => m[1]!);
  const zodSorted = [...zodKeys].sort().join(",");
  const pSideSorted = [...pSide].sort().join(",");
  assert(
    zodKeys.length === 9 && zodSorted === pSideSorted,
    "S2: generationParamsSchema 九键字面量 ↔ RECIPE_ROUNDTRIP_KEYS p 侧严格相等",
    `zod=[${zodSorted}] pSide=[${pSideSorted}]`,
  );

  // ═══ S3 — 消费证据(migrate 映射表驱动 + serialize 反向覆盖/delete 传播) ══
  console.log("\n=== S3 消费证据: migrate 映射表驱动提取 + serialize 反向覆盖/delete 传播 ===");
  const migrateSrc = read("packages/flowgraph-v3/ts/src/migrate.ts");
  assert(
    /import \{ RECIPE_ROUNDTRIP_KEYS \} from '\.\/recipe\.js'/.test(migrateSrc) &&
      migrateSrc.includes("RECIPE_ROUNDTRIP_KEYS"),
    "S3: migrate.ts import + 消费 RECIPE_ROUNDTRIP_KEYS(提取集与常量同源)",
  );
  const rpStart = migrateSrc.indexOf("function recipeParams");
  const rpClose = migrateSrc.indexOf("\n}", rpStart);
  const rpRegion = rpStart >= 0 && rpClose > rpStart ? migrateSrc.slice(rpStart, rpClose) : "";
  assert(
    rpRegion.includes("RECIPE_ROUNDTRIP_KEYS") && rpRegion.includes("for (const"),
    "S3: migrate recipeParams 映射表驱动循环(手写三 if 窄通道已解除)",
  );
  assert(
    !/d\.[A-Za-z_$][\w$]*\s*!=\s*null/.test(rpRegion),
    "S3: migrate recipeParams 无旧式手写键 if 回潮(d.steps != null 等独立判断)",
  );
  const hasRecipeRegion = migrateSrc.slice(
    migrateSrc.indexOf("function hasRecipe"),
    migrateSrc.indexOf("\n}", migrateSrc.indexOf("function hasRecipe")),
  );
  assert(
    hasRecipeRegion.includes("RECIPE_ROUNDTRIP_KEYS"),
    "S3: migrate hasRecipe 查映射表任意键在场(Pitfall 8 拓宽保持)",
  );

  const serializeSrc = read("packages/infinite-canvas/src/v3/serialize.ts");
  assert(
    /import \{ RECIPE_ROUNDTRIP_KEYS \} from '@kais\/flowgraph-v3'/.test(serializeSrc),
    "S3: serialize 运行时 import RECIPE_ROUNDTRIP_KEYS from '@kais/flowgraph-v3'(路线 A,唯一一条)",
  );
  assert(
    serializeSrc.includes("delete data[dk]"),
    "S3: serialize delete 传播行(params 缺键 → wire 同步删,防 rawData 陈旧值复活)",
  );
  assert(
    serializeSrc.includes("n.stage === 'script' && pk === 'prompt'"),
    "S3: serialize script stage prompt 例外保留(52-02:真值是 content)",
  );

  // ═══ S4 — nullish/optional 计数锁(五配方键 ×5 分支) ══════════════════════
  console.log("\n=== S4 计数锁: canvasAssetSchema 五配方键声明计数(每键 ×5 分支) ===");
  const schemaSrc = read("src/lib/canvasAssetSchema.ts");
  const countOf = (lit: string): number => schemaSrc.split(lit).length - 1;
  const countLits: Array<[string, string]> = [
    ["steps", "steps: z.number().optional()"],
    ["cfg", "cfg: z.number().optional()"],
    ["quant", "quant: z.string().optional()"],
    ["sageAttention", "sageAttention: z.boolean().optional()"],
    [
      "lora",
      "lora: z.array(z.object({ name: z.string(), strength: z.number() }).strict()).optional()",
    ],
  ];
  for (const [key, lit] of countLits) {
    const n = countOf(lit);
    assert(
      n === 5,
      `S4: canvasAssetSchema「${key}: …optional()」声明恰 5 处(五分支各一,漏声明即红)`,
      `count=${n}`,
    );
  }

  // ═══ S5 — 命令门复核 ══════════════════════════════════════════════════════
  console.log("\n=== S5 command gates (tsc ×3 + vitest ×2) ===");
  runCmd("root tsc --noEmit", ".", "npx tsc --noEmit");
  runCmd("infinite-canvas tsc -b", "packages/infinite-canvas", "npx tsc -b");
  runCmd("flowgraph-v3 tsc --noEmit", "packages/flowgraph-v3/ts", "npx tsc --noEmit");
  // WR-01: vitest 门禁不经 shell 管道——`... | tail -2` 下 res.status 是管道尾
  // (tail) 的退出码,vitest 全红仍 exit 0 → 断言恒 PASS(假绿)。tail 摘要由
  // runCmd 在 JS 侧 slice 完成,管道纯属多余;命令真实退出码 = vitest 退出码。
  runCmd("infinite-canvas vitest", "packages/infinite-canvas", "npm test", 2);
  runCmd("flowgraph-v3 vitest", "packages/flowgraph-v3", "npx vitest run", 2);

  // ═══ Forced-failure self-check — prove the gate can fail ═════════════════
  console.log("\n=== Forced-failure self-check (gate can actually fail — expected FAILs below) ===");
  const selfCheckShadow: TestResult[] = [];
  const shadowAssert = (cond: boolean, name: string): void => {
    selfCheckShadow.push({ name, pass: cond });
    console.log(`  SELF-CHECK ${cond ? "UNEXPECTED-PASS" : "expected-FAIL ok"}: ${name}`);
  };
  shadowAssert(
    (RECIPE_EDITABLE_FIELDS as readonly string[]).includes("sampler"),
    "self-check: sampler not in EDITABLE (A1: sampler 不存在,字段集已锁定五键)",
  );
  shadowAssert(
    exists("packages/flowgraph-v3/ts/src/__definitely_not_real__.ts"),
    "self-check: known-nonexistent file is reported missing",
  );
  shadowAssert(
    advancedSubsetSorted !== editableSorted || editableSorted !== schemaSorted,
    "self-check: inverted three-way equality assertion fails",
  );
  shadowAssert(
    zodSorted !== pSideSorted,
    "self-check: inverted nine-key cross-validation assertion fails",
  );
  shadowAssert(
    countOf("sageAttention: z.boolean().optional()") !== 5,
    "self-check: inverted sageAttention count-lock assertion fails",
  );
  const shadowFailed = selfCheckShadow.filter((r) => !r.pass).length;
  assert(
    selfCheckShadow.length >= 3 && selfCheckShadow.every((r) => !r.pass),
    "forced-failure self-check: every must-fail assertion failed as expected (gate fail-path is live)",
    `shadow: ${selfCheckShadow.length - shadowFailed}/${selfCheckShadow.length} unexpectedly passed`,
  );

  // ═══ Summary ═════════════════════════════════════════════════════════════
  const passed = results.filter((r) => r.pass).length;
  const total = results.length;
  const failed = total - passed;
  console.log(`\n=== Summary: ${passed}/${total} assertions passed, FAIL count = ${failed} (self-check excluded from totals) ===`);
  if (passed === total) {
    console.log("✅ Phase 58 verification PASSED (S1 三方集合相等 ✓ S2 九键交叉 ✓ S3 消费证据 ✓ S4 计数锁 ✓ S5 命令门 ✓ + forced-failure self-check ✓)");
    console.log("   (e2e 与真机探针不在本门内:结果记录在 58-03/58-04 SUMMARY — 探针前置 build → deploy-canvas.sh → build:server → restart)");
    process.exit(0);
  } else {
    console.log("❌ Phase 58 verification FAILED");
    for (const r of results.filter((x) => !x.pass)) {
      console.log(`   FAIL: ${r.name}${r.detail ? " — " + r.detail : ""}`);
    }
    process.exit(1);
  }
}

try {
  main();
} catch (err) {
  console.error("verify-phase-58.ts crashed:", err);
  process.exit(2);
}
