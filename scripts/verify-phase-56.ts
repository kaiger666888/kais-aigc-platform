#!/usr/bin/env tsx
/**
 * verify-phase-56.ts — Phase 56 (创作环节可视化) GUARD 契约门
 * (GUARD 收尾传统,ROADMAP 架构决策 7)。
 *
 * 七 section(verify-phase-53/55 同范式:真实模块 import/源码锚点断言;
 * khs 只读 regex 对照经 KAIS_HERMES_SKILLS_PATH,零写入):
 *   S-socket-scored —— scored 死信修复链:applySocketScored 导出/归一表锁死
 *     ('scored' 不在 normalizeSocketNodeState)/onNodeScored 回调链
 *   S-vocabulary —— scoreVocabulary 维度集 ≡ khs python 维度 token(p03 五维/
 *     p14 八维);khs 新增维度未镜像 FAIL;khs 删除/改名 WARN 不 FAIL(未知回退
 *     语义本来就容删除——D-14 fail-soft 契约)
 *   S-badge —— NodeBadges 三态环词汇 + 眼/耳词表 + slots verdicts 通道
 *   S-theater —— TheaterShell 家族语法 + FlowCanvas theaterTargetOf 分支 +
 *     GroupViewTheater/G16 挂载;VariantWall 含 53 特征(零漂移)
 *   S-g16 —— g15-ops gate 白名单正则 + g15Bridge p11c-gate 缺省 +
 *     voiceAuditStore voice-audit/clips/nextPending 且无 requeue
 *   S-token —— 56 新文件零裸 6 位 hex(剥除 var(--cv-…,#fallback) 段后;fallback
 *     写法是 house style 允许——NodeBadges 等既有先例)
 *   S-lod —— useLod.ts 四阈值字面 0.22/0.6/0.03/0.4 在(本体零改动红线)
 *
 * Run: npm run verify:phase-56
 * Exit: 0 全 section 绿 / 1 任一失败 / 2 crash
 */

import fs from "node:fs";
import path from "node:path";
import { DIM_LABELS } from "../packages/infinite-canvas/src/utils/scoreVocabulary";

interface TestResult { name: string; pass: boolean; detail?: string; warn?: boolean }
const results: TestResult[] = [];
function assert(cond: boolean, name: string, detail?: string): void {
  results.push({ name, pass: cond, detail });
  console.log(`  ${cond ? "PASS" : "FAIL"}: ${name}${detail ? " — " + detail : ""}`);
}
function assertWarn(cond: boolean, name: string, detail?: string): void {
  results.push({ name, pass: true, detail, warn: !cond });
  console.log(`  ${cond ? "PASS" : "WARN"}: ${name}${detail ? " — " + detail : ""}`);
}

const REPO_ROOT = path.resolve(__dirname, "..");
const PKG = path.join(REPO_ROOT, "packages/infinite-canvas/src");
const KHS_ROOT = process.env.KAIS_HERMES_SKILLS_PATH ?? "/data/workspace/kais-hermes-skills";

function src(rel: string): string {
  const p = path.join(PKG, rel);
  assert(fs.existsSync(p), `file exists: ${rel}`);
  return fs.readFileSync(p, "utf8");
}
function rootSrc(rel: string): string {
  const p = path.join(REPO_ROOT, rel);
  assert(fs.existsSync(p), `file exists: ${rel}`);
  return fs.readFileSync(p, "utf8");
}

/** 剥除 var(--cv-…, #fallback) 段后的裸 hex 命中数(house style 豁免)。 */
function bareHexCount(source: string): number {
  const stripped = source.replace(/var\([^)]*\)/g, "")
  return (stripped.match(/#[0-9A-Fa-f]{6}/g) ?? []).length;
}

function main(): void {
  console.log("=== Phase 56 — verify-phase-56.ts (VIZ-01/02/03 GUARD 契约门) ===\n");

  // ═══ S-socket-scored ════════════════════════════════════════════════════
  console.log("=== S-socket-scored: scored 死信修复链 ===");
  const store = src("store/canvasStore.ts");
  assert(store.includes("applySocketScored"), "S-socket: canvasStore 含 applySocketScored");
  const normMatch = store.match(/function normalizeSocketNodeState[\s\S]*?\n}/);
  assert(normMatch != null && !normMatch[0].includes("'scored'"), "S-socket: normalizeSocketNodeState 归一表零 scored(锁死)");
  const sock = src("hooks/useCanvasSocket.ts");
  assert(sock.includes("onNodeScored") && sock.includes("payload.state === 'scored'"), "S-socket: socket onNodeScored 拦截链");
  const flow = src("components/FlowCanvas.tsx");
  assert(flow.includes("applySocketScored"), "S-socket: FlowCanvas 接线");

  // ═══ S-vocabulary(khs 零漂移对照) ══════════════════════════════════════
  console.log("\n=== S-vocabulary: scoreVocabulary ≡ khs 维度 token ===");
  // 72-03 (v3.2 F29) 修真:不再硬编码维度清单 + substring 恒真匹配——
  // 改为从 khs 源码的 prompt/JSON 模板提取真实维度键,提取不到即 FAIL
  // (锚点漂移本身是信号)。旧 substring 法让 social_resonance 永远命中
  // social_resonance_depth、requirement_conformance 被后缀过滤漏掉,
  // 词表漂了门仍绿。
  const khsP03 = path.join(KHS_ROOT, "skills/kais-movie-pipeline/pipeline/phases/p03_script_audit.py");
  const khsP14 = path.join(KHS_ROOT, "skills/kais-movie-pipeline/pipeline/phases/p14_quality_audit.py");
  assert(fs.existsSync(khsP03) && fs.existsSync(khsP14), "S-vocab: khs p03/p14 源可达(KAIS_HERMES_SKILLS_PATH)");
  const p03Src = fs.readFileSync(khsP03, "utf8");
  const p14Src = fs.readFileSync(khsP14, "utf8");
  // p03:scores 四维(prompt 行 braces 内逗号 token)+ D6/D7 顶层维
  // ('"reversal_depth": (0-1' 形锚点)
  const scoresLine = p03Src.match(/"scores":\s*\{([^}]*)\}/)?.[1] ?? "";
  const p03Scores = [...scoresLine.matchAll(/([a-z_]+)\s+\(0-1/g)].map((m) => m[1]!);
  assert(p03Scores.length >= 4, `S-vocab: p03 scores 四维提取命中(锚点漂移=红) — ${p03Scores.join(",")}`);
  const p03Top = [...p03Src.matchAll(/"([a-z_]+)":\s*\(0-1/g)].map((m) => m[1]!)
    // total_score 是加权聚合量(p03 prompt 第二行),非雷达维度
    .filter((k) => k !== "total_score");;
  // p14:JSON 模板维度键('"dim":{"score":0' 形)
  const p14Dims = [...p14Src.matchAll(/"([a-z_]+)":\s*\{"score"/g)].map((m) => m[1]!);
  assert(p14Dims.length >= 8, `S-vocab: p14 八维提取命中(锚点漂移=红) — ${p14Dims.join(",")}`);
  for (const k of [...p03Scores, ...p03Top, ...p14Dims]) {
    assert(k in DIM_LABELS, `S-vocab: 包内镜像含 ${k}(khs 新增/改名维度未镜像)`, DIM_LABELS[k]);
  }
  // 反向:镜像里 khs 已不产的 p14 维度键 → WARN(保留派生键 master/overall 豁免)
  for (const k of Object.keys(DIM_LABELS)) {
    if (["master", "overall", "social_resonance"].includes(k)) continue;
    if (k.startsWith("hook_") || k.endsWith("_quality") || k.endsWith("_design") || k.endsWith("_conformance")) {
      assertWarn(p14Src.includes(`"${k}"`), `S-vocab: khs p14 已不含 ${k}(删除?镜像待清)`, undefined);
    }
  }
  // F32:verdict 五值闭集(must_fix 为画布 QC 槽真实值;PARSE_FAIL 为 p11c)
  const vocabSrc = fs.readFileSync(path.join(PKG, "utils/scoreVocabulary.ts"), "utf8");
  for (const v of ["PASS", "WARN", "FAIL", "ERROR", "SKIPPED", "MUST_FIX", "PARSE_FAIL"]) {
    assert(vocabSrc.includes(`${v}: `), `S-vocab: VERDICT_LABELS 含 ${v}(五值+解析失败,非三值闭集)`);
  }

  // ═══ S-badge ════════════════════════════════════════════════════════════
  console.log("\n=== S-badge: verdict 角标词汇 ===");
  const badges = src("components/badges/NodeBadges.tsx");
  assert(badges.includes("signal.approved") && badges.includes("signal.rejected") && badges.includes("signal.running"), "S-badge: 三态 signal 词汇");
  assert(badges.includes("眼审") && badges.includes("耳审"), "S-badge: 眼/耳词表");
  assert(badges.includes("strokeDasharray"), "S-badge: WARN 虚线");
  const slots = src("components/canvas/slots.ts");
  assert(slots.includes("verdicts"), "S-badge: slots NodeBadgesProps verdicts 通道");
  const pop = src("components/badges/ScorePopover.tsx");
  assert(pop.includes("size={128}") && pop.includes("pointerEvents: 'none'") && pop.includes("dimLabel"), "S-badge: ScorePopover 规格");
  assert(fs.readFileSync(path.join(PKG, "components/panel/ScoreRadar.tsx"), "utf8").length > 0, "S-badge: ScoreRadar 本体在");

  // ═══ S-theater ══════════════════════════════════════════════════════════
  console.log("\n=== S-theater: 剧场家族语法 ===");
  const shell = src("components/theater/TheaterShell.tsx");
  assert(shell.includes("lightboxOverlay") && shell.includes("theaterBtnStyle"), "S-theater: TheaterShell 家族语法");
  const wall = src("components/variants/VariantWall.tsx");
  assert(wall.includes("wall-sync-play") || wall.includes("同播"), "S-theater: VariantWall 53 特征在(未动)");
  assert(flow.includes("theaterTargetOf") && flow.includes("GroupViewTheater") && flow.includes("G16VoiceWorkbench"), "S-theater: FlowCanvas 双击改道 + 两剧场挂载");

  // ═══ S-g16 ══════════════════════════════════════════════════════════════
  console.log("\n=== S-g16: 桥白名单 + 听审存储 ===");
  const route = rootSrc("src/routes/canvas/v2/g15-ops.ts");
  assert(route.includes("^p") && route.includes("-gate$") && route.includes("regex"), "S-g16: gate 白名单正则");
  const bridge = rootSrc("src/lib/g15Bridge.ts");
  assert(bridge.includes("p11c-gate"), "S-g16: g15Bridge p11c-gate 缺省");
  const vs = src("components/g16/voiceAuditStore.ts");
  assert(vs.includes("voice-audit") && vs.includes("clips") && vs.includes("nextPending"), "S-g16: voiceAuditStore 词汇齐");
  assert(!vs.includes("requeue"), "S-g16: G16 无重渲语义(零 requeue)");

  // ═══ S-token(零裸 hex) ═════════════════════════════════════════════════
  console.log("\n=== S-token: 56 新文件零裸 hex(fallback 豁免) ===");
  const newFiles = [
    "components/theater/TheaterShell.tsx",
    "components/theater/groupMembership.ts",
    "components/theater/GroupViewTheater.tsx",
    "components/theater/TurnaroundView.tsx",
    "components/theater/SceneGallery.tsx",
    "components/theater/VoiceProfileBoard.tsx",
    "components/badges/ScorePopover.tsx",
    "components/g16/G16VoiceWorkbench.tsx",
    "components/g16/voiceAuditStore.ts",
    "components/g16/useVoiceKeyboard.ts",
    "utils/scoreVocabulary.ts",
    "utils/audioPeaks.ts",
    "utils/transcriptAlign.ts",
    "store/qcVerdict.ts",
  ];
  for (const f of newFiles) {
    const n = bareHexCount(src(f));
    assert(n === 0, `S-token: ${f} 裸 hex 0`, n > 0 ? `命中 ${n}` : undefined);
  }

  // ═══ S-lod(红线) ═══════════════════════════════════════════════════════
  console.log("\n=== S-lod: LOD 本体零改动红线 ===");
  const lod = src("hooks/useLod.ts");
  // 行锚断言(值与声明位绑定——同值文本散落在注释里不算)
  const lodAnchors: Array<[string, string]> = [
    ["LOD_L0_MAX", "0.22"], ["LOD_L1_MAX", "0.6"], ["LOD_HYSTERESIS", "0.03"], ["FITVIEW_MIN_ZOOM", "0.4"],
  ];
  for (const [name, value] of lodAnchors) {
    const m = new RegExp(`const ${name} = ([0-9.]+)`).exec(lod);
    assert(m?.[1] === value, `S-lod: ${name} = ${value}`, m ? `got ${m[1]}` : "missing");
  }

  // ═══ Summary ════════════════════════════════════════════════════════════
  const passed = results.filter((r) => r.pass).length;
  const failed = results.length - passed;
  const warns = results.filter((r) => r.warn).length;
  console.log(`\n=== Summary: ${passed}/${results.length} passed, FAIL = ${failed}, WARN = ${warns} ===`);
  if (failed === 0) {
    console.log(`✅ Phase 56 verification PASSED (S-socket ✓ S-vocabulary ✓ S-badge ✓ S-theater ✓ S-g16 ✓ S-token ✓ S-lod ✓${warns > 0 ? `, ${warns} WARN 提示` : ""})`);
    process.exit(0);
  }
  for (const r of results.filter((x) => !x.pass)) console.log(`   FAIL: ${r.name} — ${r.detail ?? ""}`);
  process.exit(1);
}

try {
  main();
} catch (err) {
  console.error("verify-phase-56.ts crashed:", err);
  process.exit(2);
}
