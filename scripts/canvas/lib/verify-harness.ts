#!/usr/bin/env tsx
/**
 * lib/verify-harness.ts — verify-* 脚本共享测试骨架（脚本层重构收敛产物）
 *
 * 原 4 份 verify 脚本各自复制了同一套样板：
 *   - TestResult / results / assert / summary 结果收集与汇总退出
 *   - arg() 命令行参数解析（verify-canvas-resync）
 *   - isScalar() 标量判断（verify-import-roundtrip / verify-schema-roundtrip）
 *   - fixture 发现（原一脚本 in-repo 优先、一脚本 sibling 优先，语义不一致）
 *   - JSON 加载 try/catch 样板
 * 全部收敛到本文件。verify 脚本仍以 `npx tsx scripts/verify-*.ts` 直跑，零新依赖。
 *
 * fixture 发现统一为「超集语义」：in-repo scripts/fixtures/*.json 全部
 * + sibling kais-hermes-skills/.../fixtures/manifests/*.json 全部
 * （目录不存在则跳过），覆盖面只增不减，label 区分来源。
 */

import fs from "node:fs";
import path from "node:path";
import { argv } from "node:process";

export interface TestResult { name: string; pass: boolean; detail?: string }

export interface Harness {
  results: TestResult[];
  assert(cond: boolean, name: string, detail?: string): void; // 打印 PASS/FAIL
  section(title: string): void; // \n=== title ===
  summary(exitCode?: boolean): { passed: number; failed: number }; // 打印汇总，默认 failed>0 → exit(1)
}

export interface HarnessOptions {
  /**
   * 汇总输出格式（保留各脚本原有输出，行为等价）：
   *   "tally" → "\n=== 总结 ===\nPASS: x  FAIL: y"（verify-canvas-resync 原格式）
   *   "words" → "\nx passed, y failed"（其余三脚本原格式，默认）
   */
  summaryFormat?: "tally" | "words";
}

export function createHarness(options: HarnessOptions = {}): Harness {
  const results: TestResult[] = [];
  const format = options.summaryFormat ?? "words";
  return {
    results,
    assert(cond: boolean, name: string, detail?: string): void {
      results.push({ name, pass: cond, detail });
      console.log(`  ${cond ? "PASS" : "FAIL"}: ${name}${detail ? " — " + detail : ""}`);
    },
    section(title: string): void {
      console.log(`\n=== ${title} ===`);
    },
    summary(exitCode = true): { passed: number; failed: number } {
      const passed = results.filter((r) => r.pass).length;
      const failed = results.filter((r) => !r.pass).length;
      if (format === "tally") {
        console.log("\n=== 总结 ===");
        console.log(`PASS: ${passed}  FAIL: ${failed}`);
      } else {
        console.log(`\n${passed} passed, ${failed} failed`);
      }
      if (exitCode) process.exit(failed > 0 ? 1 : 0);
      return { passed, failed };
    },
  };
}

/** --name value 解析（缺省回退 fallback） */
export function arg(name: string, fallback: string): string {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback;
}

export function isScalar(v: unknown): v is string | number | boolean {
  return typeof v === "string" || typeof v === "number" || typeof v === "boolean";
}

export function loadJsonFile(fp: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(fs.readFileSync(fp, "utf8")) };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/**
 * 展开各目录下全部 *.json；跳过不存在路径；返回按路径排序后的列表。
 * label 逐文件带上来源前缀，便于断言文案区分 in-repo / cross-repo。
 */
export function discoverFixtures(
  dirs: Array<{ path: string; label: string }>,
): Array<{ path: string; label: string }> {
  const out: Array<{ path: string; label: string }> = [];
  for (const dir of dirs) {
    if (!fs.existsSync(dir.path)) continue;
    const stat = fs.statSync(dir.path);
    if (stat.isDirectory()) {
      for (const f of fs.readdirSync(dir.path)) {
        if (f.endsWith(".json")) {
          out.push({ path: path.join(dir.path, f), label: `${dir.label} ${f}` });
        }
      }
    } else if (stat.isFile() && dir.path.endsWith(".json")) {
      out.push({ path: dir.path, label: dir.label });
    }
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}
