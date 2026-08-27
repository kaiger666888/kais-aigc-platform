#!/usr/bin/env tsx
/**
 * verify-h3-blockcache.ts — H3 block-cache (MiniMaxH3BlockCacheT8) 灰度注入验证 runner。
 *
 * Project convention (Pitfalls B3): no vitest/jest at repo root. This
 * standalone tsx script follows the `scripts/verify-qwen-tts.ts` pattern:
 * import the test functions from src/routes/production/minimax-h3/__tests__/
 * blockCache.test.ts, sum pass/fail, exit 1 on any failure.
 *
 * 被测对象 (任务: KAP H3 工作流注入 MiniMaxH3BlockCacheT8 开关, 默认关闭):
 * - config.ts H3_BLOCK_CACHE / parseH3BlockCacheFlag / resolveH3BlockCacheThreshold
 * - generate.ts buildH3WorkflowNative 注入 (12 → 12_blockcache → 21) + handler
 *   multipart 参数 blockCache / blockCacheThreshold + payload 元数据
 *
 * 契约:
 *  ① 默认无参图与改动前逐字节等价 (golden: __tests__/golden/*.json)
 *  ② blockCache=on (native-sage) → BC 节点 + 接线 + 阈值传递
 *  ③ 非法 blockCacheThreshold → 回落 0.4 + WARN
 *  ④ turbo/T8 拓扑传参也不含 BC (忽略不报错)
 *
 * Usage:
 *   npx tsx scripts/verify-h3-blockcache.ts
 *
 * Exit codes:
 *   0 — all assertions pass
 *   1 — one or more assertions failed
 *   2 — uncaught exception (test infrastructure bug)
 */

interface TestResult {
  name: string;
  pass: boolean;
  detail?: string;
}

// 本文件顶层无静态 import — 加 export {} 强制模块作用域,
// 否则 tsc 按全局脚本处理, `main` 与其他脚本文件 (diagnose-60-roundtrip.ts 等) 的
// 全局 main 冲突 → TS2393 duplicate function implementation。
export {};

async function main(): Promise<void> {
  // 动态 import — env (COMFYUI_URL/OUTPUT_DIR/KAP_*) 必须先注入,
  // config.ts 在模块加载时读 env; test 模块内部 setupCtx() 负责 stub + env。
  const {
    testFlagParsing,
    testThresholdResolution,
    testGoldenDefaultGraphs,
    testBlockCacheInjection,
    testTurboTopologyImmune,
    testHandlerE2e,
    teardownCtx,
  } = await import("../src/routes/production/minimax-h3/__tests__/blockCache.test");

  const all: TestResult[] = [];

  const suites: Array<[string, () => Promise<TestResult[]>]> = [
    ["开关解析 (on/true/1)", testFlagParsing],
    ["阈值解析 ([0,1] 浮点 / 非法 WARN 回落)", testThresholdResolution],
    ["默认无参图 golden 逐字节等价 (回归红线)", testGoldenDefaultGraphs],
    ["blockCache=on 注入 (节点/接线/阈值/最小 delta)", testBlockCacheInjection],
    ["turbo/T8 拓扑免疫 (传参忽略)", testTurboTopologyImmune],
    ["/generate handler e2e (stub ComfyUI)", testHandlerE2e],
  ];

  for (const [label, fn] of suites) {
    process.stdout.write(`\n── ${label} ──\n`);
    let results: TestResult[];
    try {
      results = await fn();
    } catch (err: any) {
      all.push({ name: `[suite ${label}] uncaught`, pass: false, detail: err?.stack || String(err) });
      continue;
    }
    for (const r of results) {
      process.stdout.write(`  ${r.pass ? "✓" : "✗"} ${r.name}${r.pass ? "" : ` — ${r.detail}`}\n`);
    }
    all.push(...results);
  }

  const passed = all.filter((r) => r.pass).length;
  const failed = all.length - passed;
  process.stdout.write(`\n${passed}/${all.length} assertions passed`);
  await teardownCtx(); // 关闭 stub/app server, 清空事件循环
  if (failed > 0) {
    process.stdout.write(`, ${failed} FAILED\n`);
    process.exit(1);
  }
  process.stdout.write("\n");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
