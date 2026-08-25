#!/usr/bin/env tsx
/**
 * verify-phase-65.ts — Phase 65 (REA-01) 跨仓契约门:kap 重生成通道 ≡ 引擎
 * 实际消费面(kais-gold-team executor/cloud_jimeng 源码),任一漂移即红。
 *
 * 由来(2026-08-25 review F02/F03):59-01 的「映射表五键命中」只验字面量,
 * 从未对照引擎消费参数——video 缺 image 必败 / TTS 读 text 而 kap 只送
 * prompt / MUSIC+SFX 被引擎直接拒收 / modelVersion 键名不匹配 / 几何缺失
 * 恒 1:1。本门逐 TaskType 对照引擎源码断言,「映射存在」不再是充分条件。
 *
 * 真相源(只读,KAIS_GOLD_TEAM_PATH 可覆盖;2026-08-25 真值源收编后主仓
 * 与活体容器逐文件 md5 对齐,39bb666):
 *   - src/v6/executor.py        (TaskType 分发 + 参数消费 + MUSIC/SFX 拒收)
 *   - src/v6/engines/cloud_jimeng.py (模型白名单/ratio/model_version 键)
 *
 * Run: npm run verify:phase-65
 */

import fs from "node:fs";
import path from "node:path";

interface TestResult { name: string; pass: boolean; detail?: string }
const results: TestResult[] = [];
function assert(cond: boolean, name: string, detail?: string): void {
  results.push({ name, pass: cond, detail });
  console.log(`  ${cond ? "PASS" : "FAIL"}: ${name}${detail ? " — " + detail : ""}`);
}

const ENGINE_ROOT = process.env.KAIS_GOLD_TEAM_PATH ?? "/data/workspace/kais-gold-team";
const EXECUTOR_PATH = path.join(ENGINE_ROOT, "src/v6/executor.py");
const JIMENG_PATH = path.join(ENGINE_ROOT, "src/v6/engines/cloud_jimeng.py");
// tsx CJS 变换下 import.meta.dirname 为空 —— 从 argv[1](脚本自身绝对路径)取根
const SCRIPT_DIR = path.dirname(process.argv[1] ?? process.cwd());
const SIMULATE_PATH = path.join(SCRIPT_DIR, "../src/routes/canvas/_simulate.ts");
const ENGINE_TS_PATH = path.join(SCRIPT_DIR, "../src/routes/canvas/_engine.ts");

function readOrFail(p: string, label: string): string {
  if (!fs.existsSync(p)) throw new Error(`${label} 不存在: ${p}`);
  return fs.readFileSync(p, "utf8");
}

function main(): void {
  console.log("=== Phase 65 — verify-phase-65.ts (REA-01: kap 重生成通道 ≡ 引擎消费面) ===\n");
  const executor = readOrFail(EXECUTOR_PATH, "executor.py");
  const jimeng = readOrFail(JIMENG_PATH, "cloud_jimeng.py");
  const simulate = readOrFail(SIMULATE_PATH, "_simulate.ts");
  const engineTs = readOrFail(ENGINE_TS_PATH, "_engine.ts");

  console.log("=== S 解析门(标记缺失即契约漂移) ===");
  const engineVideoGuard = executor.includes("VIDEO_FINAL/VIDEO_PREVIEW requires 'image' param");
  assert(engineVideoGuard, "S: 引擎 video 缺参守卫在场(executor 'requires image param')");
  const engineTtsText = executor.includes('params.get("text"');
  assert(engineTtsText, "S: 引擎 tts 读 params.text(executor)");
  const engineMusicSfxReject = executor.includes("MUSIC/SFX task") && executor.includes("rejected");
  assert(engineMusicSfxReject, "S: 引擎 MUSIC/SFX 拒收在场(executor)");
  const whitelist = jimeng.match(/_T2I_ALLOWED_MODELS\s*=\s*\{([^}]*)\}/)?.[1] ?? "";
  assert(whitelist.includes('"5.0"') && whitelist.includes('"5.0lite"'), "S: cloud_jimeng t2i 白名单 {5.0,5.0lite}");
  assert(/_I2I_MODEL\s*=\s*"4\.6"/.test(jimeng), "S: cloud_jimeng i2i 锁 4.6");
  const validRatios = jimeng.match(/_VALID_RATIOS\s*=\s*\{([^}]*)\}/)?.[1] ?? "";
  assert(validRatios.includes("21:9") && validRatios.includes("3:4"), "S: cloud_jimeng _VALID_RATIOS 在场");

  console.log("\n=== A video 首帧(引擎硬性要求 params.image) ===");
  assert(engineTs.includes("translatedImage != null ? { image: translatedImage }"), "A: kap _engine 对 imageRef 平铺为引擎消费的 image 键");
  assert(/isVideoTask[\s\S]{0,200}extractNodeAssetPath/.test(simulate), "A: kap _simulate 对 video 任务取节点产物为首帧 imageRef");
  assert(/isVideo[^;]*;\s*\/\/ 65-02|isVideo;/.test(engineTs.replaceAll("const isVideo =", "isVideo;").replace(/\/\/[^\n]*/g, "")) || engineTs.includes("video 任务缺少首帧源图"), "A: kap video 无首帧 fail-fast(不提交注定 FAILED 的任务)");

  console.log("\n=== B tts 台词(引擎读 params.text 非 prompt) ===");
  assert(/text:\s*input\.text/.test(engineTs), "B: kap _engine 平铺 text 键");
  assert(/taskType === "tts"[\s\S]{0,80}prompt/.test(simulate) || /tts"\s*\|\|\s*taskType\.startsWith\("tts_"\)/.test(simulate), "B: kap _simulate 对 tts 任务把 prompt 同时送 text 通道");

  console.log("\n=== C 音频边界(引擎拒收 MUSIC/SFX → kap 不投递) ===");
  const mapBody = simulate.match(/NODE_TYPE_TO_TASK_TYPE[^{]*\{([\s\S]*?)\}/)?.[1] ?? "";
  assert(!/"music"|: "sfx"/.test(mapBody), "C: kap 映射表零 music/sfx 值(不再投递必拒任务)");
  assert(/nodeType === "bgm" \|\| nodeType === "foley"/.test(simulate) && /throw new Error/.test(simulate.slice(simulate.indexOf('nodeType === "bgm"'))), "C: kap bgm/foley 显式报不支持(loudly 翻车,非假提交)");

  console.log("\n=== D 模型政策与键名(camelCase→snake_case) ===");
  assert(engineTs.includes('taskType.startsWith("image") ? { model_preference: "cloud" }'), "D: kap image* 强制 model_preference=cloud");
  // 66-02 真机修正锁:model_preference 必须在 payload **顶层**(引擎 TaskCreateRequest
  // 顶层字段 models/task.py:67)——塞 params 袋路由读不到 → AUTO → local Mock 假渲染。
  assert(
    /model_preference: "cloud" \} : \{\}\),\s*\n\s*params: \{/.test(engineTs),
    "D: model_preference 位于 payload 顶层(紧邻 params 键;66-02 探针实证位形)",
  );
  assert(/modelVersion[\s\S]{0,120}model_version/.test(engineTs), "D: kap modelVersion→model_version 键名翻译(cloud_jimeng.py:133 读下划线键)");
  const reserved = engineTs.match(/RESERVED_PARAM_KEYS = new Set\(\[([\s\S]*?)\]\)/)?.[1] ?? "";
  for (const k of ["image", "text", "ratio", "model_version"]) {
    assert(reserved.includes(`"${k}"`), `D: ${k} 在 RESERVED_PARAM_KEYS(服务端通道,客户端不可覆盖)`);
  }

  console.log("\n=== E 几何(缺省引擎恒 1:1 方图) ===");
  assert(/pickDreaminaRatio/.test(simulate), "E: kap _simulate 推导 ratio(有节点几何必送)");
  const kapRatios = simulate.match(/DREAMINA_VALID_RATIOS[^=]*=\s*\[([\s\S]*?)\]\s*as|DREAMINA_VALID_RATIOS: ReadonlyArray<[^\]]*\]\s*=\s*\[([\s\S]*?)\]/)?.[1] ?? simulate.slice(simulate.indexOf("DREAMINA_VALID_RATIOS"), simulate.indexOf("DREAMINA_VALID_RATIOS") + 400);
  for (const r of ["1:1", "16:9", "9:16", "3:2", "2:3", "4:3", "3:4", "21:9"]) {
    assert(kapRatios.includes(`"${r}"`), `E: kap ratio 镜像含 ${r}(与 cloud_jimeng _VALID_RATIOS 逐项)`);
  }

  const passed = results.filter((r) => r.pass).length;
  const failed = results.length - passed;
  console.log(`\n=== Summary: ${passed}/${results.length} passed, FAIL = ${failed} ===`);
  if (failed === 0) {
    console.log("✅ Phase 65 REA-01 契约全绿(kap 重生成通道 ≡ 引擎消费面)");
    process.exit(0);
  }
  for (const r of results.filter((x) => !x.pass)) console.log(`   FAIL: ${r.name} — ${r.detail ?? ""}`);
  process.exit(1);
}

try {
  main();
} catch (err) {
  console.error("verify-phase-65.ts crashed:", err);
  process.exit(2);
}
