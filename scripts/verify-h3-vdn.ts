#!/usr/bin/env tsx
/**
 * verify-h3-vdn.ts — H3 VDN 引擎臂 (profile="vdn-8", ApplyVDNH3) 集成验证 runner。
 *
 * Project convention (Pitfalls B3): no vitest/jest at repo root. This
 * standalone tsx script follows the `scripts/verify-h3-blockcache.ts` pattern:
 * import the test functions from src/routes/production/minimax-h3/__tests__/
 * vdnProfile.test.ts, sum pass/fail, exit 1 on any failure.
 *
 * 被测对象 (任务: VDN 引擎臂正式集成 KAP, 新增可选 profile vdn-8, 不改现有 profile):
 * - config.ts   H3_VDN / H3ProfileName / H3_PROFILES / H3_EXPOSED_PROFILES
 * - generate.ts buildH3WorkflowVDN + vdn-8 路由分支 + 241f 硬边界/互斥语义守卫
 * - ref2va.ts   per-mode vdn-8 400 拒绝 (d3eb69e0 模式)
 *
 * 契约:
 *  ① profile 校验接受 vdn-8; H3_VDN 参数与 0907 获胜臂蓝图逐字一致
 *  ② 三模式构图: ApplyVDNH3 参数正确 / 无 LoRA loader / 基模 int8_convrot /
 *     er_sde+beta+8步 / ref2va 点号键 + ref_image_size=match
 *  ③ length > 241 (对齐后) → 400; 226 最大网格值放行
 *  ④ vdn-8 + 显式 turbo/native → 400 互斥
 *  ⑤ 默认档回归: 无 profile 仍 lightx2v-8-768p; per-mode 路由 400 指引
 *
 * e2e 前置硬守卫 (baseUrl===stub + 回环标记端点探针), 守卫不过 → 整套 e2e SKIP
 * (输出 ◐ SKIP 行, 不计入总数, 不发任何越出回环的请求)。端到端验证由真实渲染
 * 冒烟承担 (0907 蓝图 prompt_id=5d732d1e 已背书拓扑)。
 *
 * Usage:
 *   npx tsx scripts/verify-h3-vdn.ts
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

// 本文件顶层无静态 import — 加 export {} 强制模块作用域 (同 verify-h3-blockcache.ts,
// 否则 tsc 按全局脚本处理, 与其他脚本文件的全局 main 冲突 → TS2393)。
export {};

async function main(): Promise<void> {
  // 动态 import — env (COMFYUI_URL/OUTPUT_DIR/KAP_*) 必须先注入,
  // config.ts 在模块加载时读 env; test 模块内部 setupCtx() 负责 stub + env。
  const {
    testProfileConfig,
    testVdnGraphBuilders,
    testHandlerE2e,
    teardownCtx,
  } = await import("../src/routes/production/minimax-h3/__tests__/vdnProfile.test");

  const all: TestResult[] = [];

  const suites: Array<[string, () => Promise<TestResult[]>]> = [
    ["配置层 (白名单/preset/H3_VDN 蓝图一致性)", testProfileConfig],
    ["三模式构图断言 (ApplyVDNH3/互斥红线/采样链)", testVdnGraphBuilders],
    ["/generate handler e2e (守卫 400 + 路由, stub ComfyUI)", testHandlerE2e],
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
