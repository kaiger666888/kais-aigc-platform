#!/usr/bin/env tsx
/**
 * verify-indextts25.ts — VoiceDesign→IndexTTS 2.5 链路验证 runner。
 *
 * Project convention (Pitfalls B3): no vitest/jest at repo root. This
 * standalone tsx script follows the `scripts/verify-phase-28.ts` pattern:
 * import the test functions from src/routes/production/indextts2/__tests__/
 * indextts25.test.ts, sum pass/fail, exit 1 on any failure.
 *
 * Usage:
 *   npx tsx scripts/verify-indextts25.ts
 *
 * Exit codes:
 *   0 — all assertions pass
 *   1 — one or more assertions failed
 *   2 — uncaught exception (test infrastructure bug)
 */

import {
  testConfigFields,
  testVoiceDesignStep1Direct,
  testVoiceDesignValidation,
  testSpeakV25Branch,
  testSpeakV2Preserved,
  testSpeakDualPathAppMount,
} from "../src/routes/production/indextts2/__tests__/indextts25.test";

interface TestResult {
  name: string;
  pass: boolean;
  detail?: string;
}

async function main(): Promise<void> {
  const all: TestResult[] = [];

  const suites: Array<[string, () => Promise<TestResult[]>]> = [
    ["config 字段", testConfigFields],
    ["voice-design Step1 直连 :5111", testVoiceDesignStep1Direct],
    ["voice-design 请求校验", testVoiceDesignValidation],
    ["speak v2.5 分支 (multipart 代理)", testSpeakV25Branch],
    ["speak version=2 legacy 保留", testSpeakV2Preserved],
    ["speak 单/双路径 app 级挂载", testSpeakDualPathAppMount],
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
  console.error("verify-indextts25: uncaught exception:", err);
  process.exit(2);
});
