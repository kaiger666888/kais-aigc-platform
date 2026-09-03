#!/usr/bin/env tsx
/**
 * verify-breeze-tts.ts — Breeze TTS 2 契约 + 旧 indextts2 端点兼容性验证 runner。
 *
 * Project convention (Pitfalls B3): no vitest/jest at repo root. This
 * standalone tsx script follows the `scripts/verify-phase-28.ts` pattern:
 * import the test functions from src/routes/production/breezeTts/__tests__/
 * breezeTts.test.ts, sum pass/fail, exit 1 on any failure.
 *
 * 接替 scripts/verify-indextts25.ts (2026-09-04 feat/tts-breeze 引擎替换)。
 *
 * Usage:
 *   npx tsx scripts/verify-breeze-tts.ts
 *
 * Exit codes:
 *   0 — all assertions pass
 *   1 — one or more assertions failed
 *   2 — uncaught exception (test infrastructure bug)
 */

import {
  testConfigFields,
  testBreezeSpeakAppMount,
  testBreezeSpeakDualPath,
  testBreezeVoiceDesign,
  testVoiceDesignValidation,
  testOldSpeakV25Compat,
  testOldSpeakV2AlsoBreeze,
  testOldVoiceDesignCompat,
  testStatusCompat,
  testOldBatchCompat,
} from "../src/routes/production/breezeTts/__tests__/breezeTts.test";

interface TestResult {
  name: string;
  pass: boolean;
  detail?: string;
}

async function main(): Promise<void> {
  const all: TestResult[] = [];

  const suites: Array<[string, () => Promise<TestResult[]>]> = [
    ["config 字段", testConfigFields],
    ["breezeTts/speak multipart 代理 (app 级)", testBreezeSpeakAppMount],
    ["breezeTts/speak 单/双路径挂载", testBreezeSpeakDualPath],
    ["breezeTts/voice-design 单步代理", testBreezeVoiceDesign],
    ["voice-design 请求校验", testVoiceDesignValidation],
    ["旧端点 speak v2.5 兼容转调", testOldSpeakV25Compat],
    ["旧端点 speak version=2 同转调", testOldSpeakV2AlsoBreeze],
    ["旧端点 voice-design 兼容转调", testOldVoiceDesignCompat],
    ["旧端点 status + breeze status 探针", testStatusCompat],
    ["旧端点 batch 兼容", testOldBatchCompat],
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
  console.error("verify-breeze-tts: uncaught exception:", err);
  process.exit(2);
});
