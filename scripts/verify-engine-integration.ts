/**
 * scripts/verify-engine-integration.ts — 引擎集成强制门禁
 *
 * 规范: docs/engine-integration-spec.md (与本脚本的 EXEMPT 清单成对维护)
 * 用法: npx tsx scripts/verify-engine-integration.ts
 *
 * 三类违规 FAIL:
 *   R1 队列调用点的 engineKey 未在 ENGINE_VRAM_REQUIREMENTS 注册 (含 typo/漏登记)
 *   R2 有 ComfyUI 提交特征却未过队列、且不在 EXEMPT 豁免清单 (新引擎绕过队列)
 *   R3 EXEMPT 条目指向不存在的文件 (豁免清单腐烂)
 *
 * 附带 WARN (不 FAIL):
 *   W1 ENGINE_GPU_INDEX 缺某键 (归属表未登记, 默认 fallback GPU1 — 合法但建议补)
 */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(__dirname, "..");
let failures = 0;
let warnings = 0;

function fail(msg: string): void {
  failures++;
  console.error(`  ❌ ${msg}`);
}
function warn(msg: string): void {
  warnings++;
  console.warn(`  ⚠️  ${msg}`);
}
function ok(msg: string): void {
  console.log(`  ✅ ${msg}`);
}

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf-8");
}

/** 递归收集 src/routes 下全部 .ts (排除 __tests__ 与 .test.) */
function walkRoutes(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "__tests__") continue;
      out.push(...walkRoutes(full));
    } else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

// ─── R0. 注册表提取 ────────────────────────────────────────────────────────

console.log("\n[0] 注册表 (src/lib/gpuVramManager.ts)");
const coreSrc = read("src/lib/gpuVramManager.ts");
const vramBlock = /ENGINE_VRAM_REQUIREMENTS[^=]*=\s*\{([\s\S]*?)\n\};/.exec(coreSrc)?.[1] ?? "";
const gpuIdxBlock = /ENGINE_GPU_INDEX[^=]*=\s*\{([\s\S]*?)\n\};/.exec(coreSrc)?.[1] ?? "";
const keyRe = /^\s*([a-z0-9_]+)\s*:/gm;
const vramKeys = new Set<string>();
for (const m of vramBlock.matchAll(keyRe)) vramKeys.add(m[1]);
const gpuIdxKeys = new Set<string>();
for (const m of gpuIdxBlock.matchAll(keyRe)) gpuIdxKeys.add(m[1]);
ok(`ENGINE_VRAM_REQUIREMENTS ${vramKeys.size} 键: ${Array.from(vramKeys).join(", ")}`);
for (const k of vramKeys) {
  if (!gpuIdxKeys.has(k)) warn(`W1: ENGINE_GPU_INDEX 缺 "${k}" (fallback GPU1, 建议补登记)`);
}

// ─── R1. 队列调用点 engineKey 全部已注册 ───────────────────────────────────

console.log("\n[1] 队列调用点 engineKey 注册校验 (R1)");
const routeFiles = walkRoutes(join(ROOT, "src/routes"));
const libFiles = ["src/lib/gpuVramManager.ts", "src/lib/gpuQueueCrossProc.ts"];
const allFiles = [...routeFiles.map((f) => relative(ROOT, f)), ...libFiles];

// 全仓 const 名 → 字符串值 映射 (engineKey 常量解析用, 如 QWEN_EYE_QUEUE_KEY)
const constMap = new Map<string, string>();
const constRe = /const\s+([A-Z_$][A-Z0-9_$]*)\s*=\s*"([^"]+)"/g;
for (const rel of allFiles) {
  for (const m of read(rel).matchAll(constRe)) constMap.set(m[1], m[2]);
}

const callRe = /\b(?:withGpuQueueTimed|withGpuQueue|withEngineLock|acquireEngineOccupancy)\s*\(\s*(?:"([^"]+)"|'([^']+)'|([A-Za-z_$][\w$]*))/g;
/** 剥注释 (JSDoc 模板示例里的 "${engineKey}" 会造成假阳性) */
function stripComments(src: string): string {
  return src.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}
let callSites = 0;
const unregistered = new Map<string, string[]>();
// 排除定义文件本身 (lib 内部是包装/委托, 不是业务调用点)
const callSiteFiles = allFiles.filter((f) => f !== "src/lib/gpuVramManager.ts");
for (const rel of callSiteFiles) {
  for (const m of stripComments(read(rel)).matchAll(callRe)) {
    const key = m[1] ?? m[2] ?? constMap.get(m[3] ?? "") ?? null;
    if (key === null) continue; // 解析不出 (非字面量非常量) — R2 的特征扫描兜底
    callSites++;
    if (!vramKeys.has(key)) {
      if (!unregistered.has(key)) unregistered.set(key, []);
      unregistered.get(key)!.push(rel);
    }
  }
}
if (unregistered.size === 0) {
  ok(`全部 ${callSites} 个调用点 engineKey 已注册`);
} else {
  for (const [key, files] of unregistered) {
    fail(`R1: engineKey "${key}" 未注册 (调用于: ${[...new Set(files)].slice(0, 3).join(", ")}${new Set(files).size > 3 ? " …" : ""})`);
  }
}

// ─── R2. ComfyUI 提交特征必须过队列 (或显式豁免) ────────────────────────────

console.log("\n[2] 提交特征 × 队列接入 × 豁免清单 (R2)");

/** 豁免清单 — 与 docs/engine-integration-spec.md §4 成对维护, 条目必须写理由 */
const EXEMPT: Record<string, string> = {
  "src/routes/production/flux/config.ts": "查询/配置",
  "src/routes/production/flux/status.ts": "查询/配置",
  "src/routes/production/indextts2/config.ts": "查询/配置",
  "src/routes/production/indextts2/status.ts": "查询/配置",
  "src/routes/production/ltx/config.ts": "查询/配置",
  "src/routes/production/minimax-h3/config.ts": "查询/配置",
  "src/routes/production/minimax-h3/status.ts": "查询/配置",
  "src/routes/production/minimax-h3/replace-audio.ts": "纯 CPU 音频替换",
  "src/routes/production/postprocess/_shared/config.ts": "查询/配置/_shared",
  "src/routes/production/postprocess/status.ts": "查询/配置",
  "src/routes/production/qwenTts/config.ts": "查询/配置",
  "src/routes/production/qwenTts/status.ts": "查询/配置",
  "src/routes/production/qwenTts/voiceId.ts": "音色查询",
  "src/routes/production/shot-analysis/_shared/config.ts": "查询/配置/_shared",
  "src/routes/production/shot-analysis/index.ts": "代理外部 gold-team 任务服务(自带调度); 若落本机 GPU 需重评",
  "src/routes/production/wan21/scail2/status.ts": "查询/配置",
  "src/routes/production/wan21/_shared/scail2-config.ts": "查询/配置/_shared",
  "src/routes/production/wan22/_shared/config.ts": "查询/配置/_shared",
  "src/routes/v1/ace/_shared/asyncCallback.ts": "回调接收",
  "src/routes/v1/ace/cancel.ts": "取消",
  "src/routes/v1/ace/config.ts": "查询/配置",
  "src/routes/v1/ace/models.ts": "模型列表",
  "src/routes/v1/ace/status.ts": "查询/配置",
  "src/routes/v1/stableaudio/config.ts": "查询/配置",
  "src/routes/v1/stableaudio/models.ts": "模型列表",
  "src/routes/v1/stableaudio/prompt-guide.ts": "文档",
  "src/routes/v1/stableaudio/shared.ts": "_shared 工具",
  "src/routes/v1/trellis2/config.ts": "查询/配置",
  "src/routes/v1/trellis2/delete.ts": "删除",
  "src/routes/v1/trellis2/status.ts": "查询/配置",
  "src/routes/v1/tts/config.ts": "查询/配置",
  "src/routes/v1/tts/health.ts": "健康检查",
  "src/routes/v1/tts/status.ts": "查询/配置",
  "src/routes/assets/addAssets.ts": "/prompt 命中为注释误报",
  "src/routes/canvas/v2/import-from-dir.ts": "/prompt 命中为注释误报",
  "src/routes/production/gpu-queue/index.ts": "观测/管理面本身",
};

// 提交特征: URL 含 /prompt (排除注释行), 或 comfyuiUrl 配置引用
const submitFeature = (src: string): boolean => {
  const noComments = src.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  return /["'`][^"'`]*\/prompt\b/.test(noComments) || /comfyuiUrl/i.test(noComments);
};

let flagged = 0;
for (const rel of routeFiles.map((f) => relative(ROOT, f))) {
  const src = read(rel);
  if (!submitFeature(src)) continue;
  if (/withGpuQueue|acquireEngineOccupancy/.test(src)) continue;
  if (EXEMPT[rel]) continue;
  flagged++;
  fail(`R2: ${rel} 有 ComfyUI 提交特征但未过队列且未豁免 — 按 docs/engine-integration-spec.md M2 接入, 或在 EXEMPT+规范 §4 登记理由`);
}
if (flagged === 0) ok("全部提交特征文件已过队列或显式豁免");

// ─── R3. 豁免清单健康度 ────────────────────────────────────────────────────

console.log("\n[3] 豁免清单健康度 (R3)");
let stale = 0;
for (const [rel] of Object.entries(EXEMPT)) {
  if (!existsSync(join(ROOT, rel))) {
    stale++;
    fail(`R3: EXEMPT 条目失效 (文件不存在): ${rel} — 从脚本与规范 §4 同步删除`);
  }
}
if (stale === 0) ok(`EXEMPT ${Object.keys(EXEMPT).length} 条全部有效`);

// ─── 汇总 ─────────────────────────────────────────────────────────────────

console.log(
  `\n${failures === 0 ? "✅ ENGINE-INTEGRATION: 合规" : `❌ ENGINE-INTEGRATION: ${failures} 项违规`} (warn ${warnings})\n`,
);
process.exit(failures === 0 ? 0 : 1);
