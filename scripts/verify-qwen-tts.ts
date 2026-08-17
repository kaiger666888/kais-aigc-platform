#!/usr/bin/env tsx
/**
 * verify-qwen-tts.ts — qwenTts/v1-tts 两阶段异步 + GPU 队列预算/orphan 验证 runner。
 *
 * Project convention (Pitfalls B3): no vitest/jest at repo root. This
 * standalone tsx script follows the `scripts/verify-indextts25.ts` pattern:
 * import the test functions from src/routes/production/qwenTts/__tests__/
 * qwenTts.test.ts, sum pass/fail, exit 1 on any failure.
 *
 * 被测对象: commits 722ee985 (withGpuQueue) / d0480dbc (gpuVramManager +
 * pollTimeout 可配置) / 2da9d455 (queue wait 不计预算 + orphan cleanup +
 * TTS 两阶段) 的 qwenTts 与 v1/tts speak/status。
 *
 * Usage:
 *   npx tsx scripts/verify-qwen-tts.ts
 *
 * Exit codes:
 *   0 — all assertions pass
 *   1 — one or more assertions failed
 *   2 — uncaught exception (test infrastructure bug)
 */

import {
  testConfigContract,
  testGpuQueuePrimitives,
  testSpeakAsyncTwoPhase,
  testSpeakSyncPoll,
  testSpeakValidation,
  testStatusLifecycle,
  testAppMountTwoPhase,
  testV1TtsTwoPhase,
  testChildScenarios,
} from "../src/routes/production/qwenTts/__tests__/qwenTts.test";

interface TestResult {
  name: string;
  pass: boolean;
  detail?: string;
}

async function main(): Promise<void> {
  const all: TestResult[] = [];

  const suites: Array<[string, () => Promise<TestResult[]>]> = [
    ["config 契约 (pollTimeout 默认/需求表)", testConfigContract],
    ["GPU 队列原语 (withGpuQueueTimed/兼容签名)", testGpuQueuePrimitives],
    ["speak 两阶段 202 (async 提交即返回)", testSpeakAsyncTwoPhase],
    ["speak 同步轮询出片 (legacy 一阶段)", testSpeakSyncPoll],
    ["speak 入参校验", testSpeakValidation],
    ["status 轮询生命周期", testStatusLifecycle],
    ["app 挂载拓扑两阶段闭环 (status_url 活路径)", testAppMountTwoPhase],
    ["v1/tts 两阶段 (独立实现同款契约)", testV1TtsTwoPhase],
    ["child 场景 (预算排除排队/orphan/vram 503)", testChildScenarios],
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
  if (failed > 0) {
    process.stdout.write(`, ${failed} FAILED\n`);
    process.exit(1);
  }
  process.stdout.write("\n");
}

main().catch((err) => {
  console.error("verify-qwen-tts: uncaught exception:", err);
  process.exit(2);
});
