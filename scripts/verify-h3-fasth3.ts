#!/usr/bin/env tsx
/**
 * verify-h3-fasth3.ts — H3 FastH3 引擎臂 (profile="fasth3", dense 蒸馏 LoRA) 集成验证 runner。
 *
 * Project convention (Pitfalls B3): no vitest/jest at repo root. This
 * standalone tsx script follows the `scripts/verify-h3-vdn.ts` pattern:
 * import the test functions from src/routes/production/minimax-h3/__tests__/
 * fasth3Profile.test.ts, sum pass/fail, exit 1 on any failure.
 *
 * 被测对象 (任务: FastH3 5步档正式集成 KAP, 新增可选 profile fasth3, 不改现有 profile):
 * - config.ts   H3_FASTH3 / H3ProfileName / H3_PROFILES / H3_EXPOSED_PROFILES
 * - generate.ts loraShiftConfig fasth3 分支 (buildH3WorkflowLightX2V 泛化拓扑)
 * - t2va/i2va/ref2va.ts per-mode fasth3 400 拒绝 (d3eb69e0 模式)
 *
 * 契约:
 *  ① profile 校验接受 fasth3; H3_FASTH3 参数与 0909 A/B 获胜臂蓝图口径逐字一致
 *  ② 默认档红线: useCase / motion 路由不指向 fasth3; EXPOSED_USE_CASES 不动
 *  ③ 三模式构图: 12→14_shift(6/3)→15(LoRA 1.0)→30/31/33/34 (euler+simple+5步);
 *     无 VDN/T8/TESpeed; ref2va 点号键 + ref_image_size=match; stepsOverride 优先
 *  ④ /generate e2e: fasth3 路由分支命中 + vdn-8 共存 + 默认档 lightx2v-8-768p 回归
 *  ⑤ per-mode 三路由 fasth3 → 400 指引 /generate
 *
 * e2e 前置硬守卫 (baseUrl===stub + 回环标记端点探针), 守卫不过 → 整套 e2e SKIP
 * (输出 ◐ SKIP 行, 不计入总数, 不发任何越出回环的请求)。端到端验证由真实渲染
 * 冒烟承担 (operator 割接序列的 profile=fasth3 5s 短链, 0909 A/B 六条蓝图已背书拓扑)。
 *
 * Usage:
 *   npx tsx scripts/verify-h3-fasth3.ts
 *
 * Exit codes:
 *   0 — all assertions pass (SKIP 不算失败)
 *   1 — one or more assertions failed
 *   2 — uncaught exception (test infrastructure bug)
 */

interface TestResult {
  name: string;
  pass: boolean;
  detail?: string;
  /** SKIP — 非封闭环境下 e2e 整套跳过; 不计入总数、不算失败 */
  skip?: boolean;
}

// 本文件顶层无静态 import — 加 export {} 强制模块作用域 (同 verify-h3-vdn.ts,
// 否则 tsc 按全局脚本处理, 与其他脚本文件的全局 main 冲突 → TS2393)。
export {};

async function main(): Promise<void> {
  // 动态 import — env (COMFYUI_URL/OUTPUT_DIR/KAP_*) 必须先注入,
  // config.ts 在模块加载时读 env; test 模块内部 setupCtx() 负责 stub + env。
  const {
    testProfileConfig,
    testFasth3GraphBuilders,
    testHandlerE2e,
    teardownCtx,
  } = await import("../src/routes/production/minimax-h3/__tests__/fasth3Profile.test");

  const all: TestResult[] = [];

  const suites: Array<[string, () => Promise<TestResult[]>]> = [
    ["配置层 (白名单/preset/H3_FASTH3 蓝图一致性/默认档红线)", testProfileConfig],
    ["三模式构图断言 (SigmaShift+LoRA 链/互斥红线/采样链)", testFasth3GraphBuilders],
    ["/generate + per-mode handler e2e (路由分支 + 守卫 400, stub ComfyUI)", testHandlerE2e],
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
      if (r.skip) {
        process.stdout.write(`  ◐ SKIP ${r.name} — ${r.detail}\n`);
        continue;
      }
      process.stdout.write(`  ${r.pass ? "✓" : "✗"} ${r.name}${r.pass ? "" : ` — ${r.detail}`}\n`);
    }
    all.push(...results);
  }

  // SKIP 不计入总数也不算失败 — 但必须在汇总行显式披露 (诚实报告能力边界)
  const counted = all.filter((r) => !r.skip);
  const skipped = all.length - counted.length;
  const passed = counted.filter((r) => r.pass).length;
  const failed = counted.length - passed;
  process.stdout.write(`\n${passed}/${counted.length} assertions passed`);
  if (skipped > 0) process.stdout.write(` (+${skipped} SKIP — 见 ◐ 行)`);
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
