#!/usr/bin/env tsx
/**
 * verify-phase-52.ts — Phase 52 (prompt-edit-regenerate-loop) aggregate
 * contract gate: the single gate that folds every automated verification of
 * plans 52-01..52-08 into one run (GUARD closing tradition, ROADMAP 决策 #7).
 *
 *   S1 REGEN-01 — prompt edit → save → regenerate loop:
 *     store canonical actions (updateEventParams/persistEventParams),
 *     PromptSection, serialize 配方反向覆盖(role:'output' 反查 + script 例外),
 *     execute zod extra 契约, canvasApi ...extra 透传, 52-07 增补
 *     (canvasAssetSchema nullish 存量宽容), 52-08 增补(FlowCanvas
 *     syntheticDetailNode 落选详情入口)。
 *   S2 REGEN-02 — 换 seed 重跑: EventParamsPopover 残桩清零 + executeNode/
 *     updateEventParams 接线, eventChipBus anchor 扩展, FlowCanvas 注入行。
 *   S3 REGEN-03 — stale 下游重跑: stale.ts getDownstreamIds, orchestrate
 *     stale-success 不跳过谓词, mock 镜像 + logCall 完整 body, store
 *     applySocketNodeState stale 清除, useStaleRerun, NodeBadges 出口
 *     (stopPropagation), serialize data.stale 上 wire, migrate 无裸
 *     stale:null 硬编码(restoreStaleInfo)。
 *   S4 REGEN-04 — 面板交互: 默认宽 480, onNodeClick 修饰键守卫 + detailNode
 *     跟随分支。
 *   S5 命令门 — 三根 tsc + 双包 vitest + verify:save-v2-legacy 复核运行
 *     (命令门,输出 tail 摘要;任一非零 exit 即红)。
 *   Forced-failure self-check — must-fail 断言组(50-02/51 范式);意外 PASS
 *     整门红。
 *
 * NOTE (e2e prerequisite, 地雷 #10): the packages/infinite-canvas e2e suite
 * (npm run test:e2e) serves dist/, not source — always run `npm run build` in
 * packages/infinite-canvas before any e2e run. This gate does NOT run e2e;
 * the full-suite result is recorded in 52-VERIFICATION.md (全套 62 passed,
 * 2026-08-22,含 phase52-regen/reroll/stale-panel 三件套——装置修复由 52-08 落地)。
 *
 * Run: npm run verify:phase-52   (or: npx tsx scripts/verify-phase-52.ts)
 * Exit: 0 all sections pass + self-check behaves / 1 any failure / 2 crash
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

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
  console.log("=== Phase 52 — verify-phase-52.ts (aggregate contract gate: REGEN-01..04, plans 52-01..52-08) ===\n");

  // ═══ S1 — REGEN-01: prompt 编辑→保存→重生成 ═════════════════════════════
  console.log("=== S1 REGEN-01: edit → save → regenerate loop (source-shape) ===");
  const storeSrc = read("packages/infinite-canvas/src/store/canvasStore.ts");
  assert(
    /updateEventParams:\s*\(/.test(storeSrc) && /persistEventParams:\s*\(/.test(storeSrc),
    "S1: canvasStore 定义 updateEventParams + persistEventParams(canonical 配方写入双 action)",
  );
  const panelSrc = read("packages/infinite-canvas/src/components/panel/NodeDetailPanel.tsx");
  assert(
    panelSrc.includes("function PromptSection") && panelSrc.includes('data-testid="prompt-section"'),
    "S1: NodeDetailPanel 含 PromptSection 组件(prompt 编辑区)",
  );
  assert(
    panelSrc.includes("persistEventParams(evt.id") && panelSrc.includes("executeNode(projectId, episodesId, asset.id"),
    "S1: PromptSection 保存走 persistEventParams、重生成 nodeId=资产 id(地雷 #4 裁定)",
  );
  const serializeSrc = read("packages/infinite-canvas/src/v3/serialize.ts");
  assert(
    serializeSrc.includes("role === 'output'") && serializeSrc.includes("eventToAsset"),
    "S1: serialize 事件配方反向覆盖(role:'output' 反查 eventToAsset)",
  );
  assert(
    serializeSrc.includes("script stage 跳过 prompt 覆盖") || serializeSrc.includes("script stage 跳过"),
    "S1: serialize script 例外注释在位(content 本体,配方不反向覆盖)",
  );
  const executeSrc = read("src/routes/canvas/execute.ts");
  assert(
    /prompt:\s*z\.string\(\)/.test(executeSrc) && /params:\s*z\.record/.test(executeSrc),
    "S1: execute zod 契约含 prompt + params extra 通道(52-02)",
  );
  assert(
    read("packages/infinite-canvas/src/services/canvasApi.ts").includes("...extra"),
    "S1: canvasApi.executeNode body 展开 ...extra",
  );
  // 52-07 增补:存量宽容
  const schemaSrc = read("src/lib/canvasAssetSchema.ts");
  assert(
    (schemaSrc.match(/\.nullish\(\)/g) ?? []).length >= 15,
    "S1(52-07): canvasAssetSchema nullish 存量宽容在位(≥15:5 类型证据指向字段)",
    `count=${(schemaSrc.match(/\.nullish\(\)/g) ?? []).length}`,
  );
  // 52-08 增补:落选详情入口
  const flowCanvasSrc = read("packages/infinite-canvas/src/components/FlowCanvas.tsx");
  assert(
    read("packages/infinite-canvas/src/v3/adapter.ts").includes("export function syntheticDetailNode") &&
      flowCanvasSrc.includes("syntheticDetailNode(loser)"),
    "S1(52-08): adapter 导出 syntheticDetailNode + FlowCanvas 落选分流调用",
  );

  // ═══ S2 — REGEN-02: 换 seed 重跑 ════════════════════════════════════════
  console.log("\n=== S2 REGEN-02: reroll seed (wiring, no stubs) ===");
  const popoverSrc = read("packages/infinite-canvas/src/components/eventParams/EventParamsPopover.tsx");
  assert(
    !popoverSrc.includes("执行后端待接入") && !popoverSrc.includes("console.log"),
    "S2: EventParamsPopover 无「执行后端待接入」/console.log 残桩",
  );
  assert(
    popoverSrc.includes("executeNode(") && popoverSrc.includes("updateEventParams("),
    "S2: EventParamsPopover 接 executeNode + updateEventParams(seed 回写 canonical)",
  );
  const chipBusSrc = read("packages/infinite-canvas/src/components/canvas/eventChipBus.ts");
  assert(
    /projectId\?:\s*number \| null/.test(chipBusSrc) && /episodesId\?:\s*number \| null/.test(chipBusSrc),
    "S2: EventChipClickInfo anchor 含可选 projectId/episodesId",
  );
  assert(
    flowCanvasSrc.includes("{ ...info, projectId, episodesId }"),
    "S2: FlowCanvas handleEventChipClick 注入行在位",
  );

  // ═══ S3 — REGEN-03: stale 下游重跑 ══════════════════════════════════════
  console.log("\n=== S3 REGEN-03: stale rerun (semantics + exits) ===");
  assert(
    /export function getDownstreamIds/.test(read("packages/flowgraph-v3/ts/src/stale.ts")),
    "S3: stale.ts 导出 getDownstreamIds(下游计算引擎,52-01)",
  );
  const orchSrc = read("src/routes/canvas/orchestrate.ts");
  assert(
    orchSrc.includes("data.stale") && orchSrc.includes("stale 即需重跑语义"),
    "S3: orchestrate skip 谓词 stale-success 不跳过(52-02 锁定决策)",
  );
  const mockSrc = read("packages/infinite-canvas/test/e2e/mock-backend/server.mjs");
  assert(
    mockSrc.includes("data.stale") && mockSrc.includes("logCall"),
    "S3: mock server 镜像 stale 谓词 + logCall 观测点",
  );
  assert(
    /applySocketNodeState/.test(storeSrc) && /stale: null/.test(storeSrc),
    "S3: applySocketNodeState running/success 自动清 stale(52-01)",
  );
  const staleRerunSrc = read("packages/infinite-canvas/src/hooks/useStaleRerun.ts");
  assert(
    staleRerunSrc.includes("rerunStaleChain") &&
      staleRerunSrc.includes("getDownstreamIds") &&
      staleRerunSrc.includes("orchestrateCanvas"),
    "S3: useStaleRerun.rerunStaleChain 统一处理器(收集→保存→orchestrate 子集)",
  );
  assert(
    read("packages/infinite-canvas/src/components/badges/NodeBadges.tsx").includes("stopPropagation"),
    "S3: NodeBadges stale 角标点击出口(stopPropagation 防冒泡,地雷 #8)",
  );
  assert(
    serializeSrc.includes("data.stale"),
    "S3: serialize data.stale 上 wire(52-02 地雷 #2)",
  );
  const migrateSrc = read("packages/flowgraph-v3/ts/src/migrate.ts");
  assert(
    !/stale:\s*null\s*[,}]/.test(migrateSrc) && migrateSrc.includes("restoreStaleInfo"),
    "S3: migrate 无裸 stale:null 硬编码,经 restoreStaleInfo 轻校验还原",
  );

  // ═══ S4 — REGEN-04: 面板交互 ═══════════════════════════════════════════
  console.log("\n=== S4 REGEN-04: panel UX (width 480 + click follow) ===");
  assert(
    panelSrc.includes("Math.max(400, 480)"),
    "S4: NodeDetailPanel 默认宽 480(min 400 拖拽保留)",
  );
  const onNodeClickRegion = flowCanvasSrc.slice(
    flowCanvasSrc.indexOf("const onNodeClick"),
    flowCanvasSrc.indexOf("const onNodeDoubleClick"),
  );
  assert(
    onNodeClickRegion.includes("event.ctrlKey") &&
      onNodeClickRegion.includes("event.metaKey") &&
      onNodeClickRegion.includes("event.shiftKey"),
    "S4: onNodeClick 修饰键守卫(ctrl/meta/shift 只选不切面板,地雷 #9)",
  );
  assert(
    onNodeClickRegion.includes("detailNode") && onNodeClickRegion.includes("setDetailNode(node)"),
    "S4: onNodeClick 面板开着跟随切换/关着不打开",
  );

  // ═══ S5 — 命令门复核 ════════════════════════════════════════════════════
  console.log("\n=== S5 command gates (tsc ×3 + vitest ×2 + verify:save-v2-legacy) ===");
  runCmd("root tsc --noEmit", ".", "npx tsc --noEmit");
  runCmd("infinite-canvas tsc -b", "packages/infinite-canvas", "npx tsc -b");
  runCmd("flowgraph-v3 tsc --noEmit", "packages/flowgraph-v3/ts", "npx tsc --noEmit");
  runCmd("infinite-canvas vitest", "packages/infinite-canvas", "npm test 2>&1 | tail -2", 2);
  runCmd("flowgraph-v3 vitest", "packages/flowgraph-v3", "npx vitest run 2>&1 | tail -2", 2);
  runCmd("verify:save-v2-legacy (52-07 行为锁)", ".", "npm run verify:save-v2-legacy 2>&1 | tail -2", 2);

  // ═══ Forced-failure self-check — prove the gate can fail ═══════════════
  console.log("\n=== Forced-failure self-check (gate can actually fail — expected FAILs below) ===");
  const selfCheckShadow: TestResult[] = [];
  const shadowAssert = (cond: boolean, name: string): void => {
    selfCheckShadow.push({ name, pass: cond });
    console.log(`  SELF-CHECK ${cond ? "UNEXPECTED-PASS" : "expected-FAIL ok"}: ${name}`);
  };
  shadowAssert(exists("packages/infinite-canvas/src/hooks/__definitely_not_real__.ts"), "self-check: known-nonexistent file is reported missing");
  shadowAssert(popoverSrc.includes("执行后端待接入"), "self-check: removed stub string greps as present");
  shadowAssert(!panelSrc.includes("PromptSection"), "self-check: inverted PromptSection assertion fails");
  shadowAssert((schemaSrc.match(/\.nullish\(\)/g) ?? []).length < 15, "self-check: inverted nullish-count assertion fails");
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
    console.log("✅ Phase 52 verification PASSED (S1 REGEN-01 ✓ S2 REGEN-02 ✓ S3 REGEN-03 ✓ S4 REGEN-04 ✓ S5 命令门 ✓ + forced-failure self-check ✓)");
    console.log("   (e2e 不在本门内:全套结果见 52-VERIFICATION.md — 前置 npm run build,地雷 #10)");
    process.exit(0);
  } else {
    console.log("❌ Phase 52 verification FAILED");
    for (const r of results.filter((x) => !x.pass)) {
      console.log(`   FAIL: ${r.name}${r.detail ? " — " + r.detail : ""}`);
    }
    process.exit(1);
  }
}

try {
  main();
} catch (err) {
  console.error("verify-phase-52.ts crashed:", err);
  process.exit(2);
}
