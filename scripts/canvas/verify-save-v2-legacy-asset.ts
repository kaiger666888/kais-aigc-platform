#!/usr/bin/env tsx
/**
 * verify-save-v2-legacy-asset.ts — 52-UAT gap#1 行为锁(Phase 52-07,2026-08-22)。
 *
 * 根因:canvasAssetSchema 把 filePath/label/assetType(及 audio/video/storyboard/
 * script 各自的配方必填)设为硬必填,而 kmc sync 直写 DB 的真实图普遍含无媒体/
 * 无配方参数的节点——修前诊断回放(项目 1/2/2001/9999 load-v2 原图原样回发
 * save-v2)全 400,画布保存路径整体不可用。缺失形态实测全为 undefined/null,
 * 零空串——故宽容落点 = nullish 化(缺失/显式 null 放行),**字段在场时形状
 * 仍强制**(空串/负数照旧拒绝)。
 *
 * 本锁两层:
 *   1. 行为节(纯函数 validateNodeData/validateGraphNodes):
 *      - 存量宽容分支:各类型「字段缺失/显式 null」形态 → null 放行
 *      - 形状下限分支:字段在场但非法(空串/负数)→ 错误串(宽容不是无门)
 *   2. source 节(防门被拆):save-v2/nodes.ts 的校验门仍在;audio/video 段
 *      仍展开 universalRequired;asset 段不再展开(独立 nullish 三字段)。
 *
 * 注意:与 DEPRECATED 的 verify-save-gates.ts 不同名不同门——本锁锁的是
 * 52-07 之后的「存量宽容 + 在场形状强制」双分支契约。
 *
 * Run: npm run verify:save-v2-legacy
 * Exit: 0 全过 / 1 有失败 / 2 未捕获异常
 */

import fs from "node:fs";
import path from "node:path";
import { validateNodeData, validateGraphNodes } from "../../src/lib/canvasAssetSchema";
import { createHarness } from "./lib/verify-harness";

const { assert, section, summary } = createHarness();

const REPO_ROOT = path.resolve(__dirname, "..", "..");
function read(rel: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
}

function main(): void {
  console.log("=== Phase 52-07 — save-v2 存量宽容行为锁(52-UAT gap#1)===");

  // ─── 行为节 1:存量宽容分支(修前 400 → 修后放行) ─────────────
  section("行为:存量形态(undefined/null)放行");

  // a) asset 摘要卡形态:三字段全缺(sum-* 摘要卡/文本资产,9999 项目实测 43+9+3)
  assert(
    validateNodeData("asset", { prompt: "一段配方" }) === null,
    "asset 缺 filePath/label/assetType(undefined 形态)→ null 放行",
  );
  // a2) 显式 null 形态(修前回放实证 filePath null ×3)
  assert(
    validateNodeData("asset", { filePath: null, label: null, assetType: null }) === null,
    "asset 三字段显式 null → null 放行",
  );
  // b) asset 完整形态不受影响
  assert(
    validateNodeData("asset", { filePath: "/x/a.png", label: "主角", assetType: "character" }) === null,
    "asset 完整形态(filePath/label/assetType 齐)→ null",
  );
  // c) audio 存量形态:配方四字段全缺(9999 实测 72 节点)
  assert(
    validateNodeData("audio", {}) === null && validateNodeData("audio", { filePath: null, shot_id: null }) === null,
    "audio 缺 filePath/shot_id/engine/duration_sec(undefined/null)→ null 放行",
  );
  // c2) video 存量形态(2001 实测 15 节点四字段全缺)
  assert(
    validateNodeData("video", {}) === null,
    "video 四配方字段全缺 → null 放行",
  );
  // c3) storyboard 存量形态(9999 实测 40 shot_type 缺失);label 无缺失证据维持必填
  assert(
    validateNodeData("storyboard", { label: "分镜 1" }) === null,
    "storyboard 缺 shot_id/shot_type/duration_sec(label 在场)→ null 放行",
  );
  // c4) script 存量形态(9999 实测 127 缺 description;2001 实证 3 显式 null filePath)
  assert(
    validateNodeData("script", { label: "剧本" }) === null
      && validateNodeData("script", { label: "剧本", description: null, filePath: null }) === null,
    "script 缺 description / 显式 null filePath → null 放行",
  );
  // e) 混合图:zone + 无媒体 asset → 0 errors
  const graphErrs = validateGraphNodes([
    { type: "zone", id: "z1", data: { label: "z" } },
    { type: "asset", id: "sum-1", data: { prompt: "摘要" } },
    { type: "script", id: "s1", data: { label: "剧本" } },
  ]);
  assert(
    graphErrs.length === 0,
    "validateGraphNodes(zone + 无媒体 asset + 存量 script)→ 0 errors",
    JSON.stringify(graphErrs),
  );

  // ─── 行为节 2:形状下限分支(在场仍强制——宽容不是无门) ─────────
  section("行为:字段在场但非法 → 拒绝(形状下限)");

  const badAudioEmpty = validateNodeData("audio", { filePath: "" });
  assert(
    typeof badAudioEmpty === "string" && badAudioEmpty.includes("filePath"),
    "audio filePath 空串 → 错误串含 filePath",
    badAudioEmpty ?? "",
  );
  const badVideoRes = validateNodeData("video", { resolution: "" });
  assert(
    typeof badVideoRes === "string" && badVideoRes.includes("resolution"),
    "video resolution 空串 → 错误串含 resolution",
    badVideoRes ?? "",
  );
  const badDur = validateNodeData("audio", { duration_sec: -1 });
  assert(
    typeof badDur === "string" && badDur.includes("duration_sec"),
    "audio duration_sec 负数 → 错误串(min(0) 下限)",
    badDur ?? "",
  );
  const badAssetLabel = validateNodeData("asset", { label: "" });
  assert(
    typeof badAssetLabel === "string" && badAssetLabel.includes("label"),
    "asset label 空串 → 错误串(在场必非空)",
    badAssetLabel ?? "",
  );

  // ─── source 节:门不拆、结构不回退 ───────────────────────────
  section("source:校验门 + nullish 结构在位");

  const saveSrc = read("src/routes/canvas/v2/save-v2.ts");
  assert(
    saveSrc.includes("validateGraphNodes(validGraph.nodes"),
    "save-v2: validateGraphNodes 门仍在(拆门 ≠ 宽容)",
  );
  const nodesSrc = read("src/routes/canvas/v2/nodes.ts");
  assert(
    nodesSrc.includes("validateNodeData(merged.type"),
    "nodes.ts PATCH: merged 过 validateNodeData 门仍在",
  );
  const schemaSrc = read("src/lib/canvasAssetSchema.ts");
  const audioIdx = schemaSrc.indexOf('audio: withYamlOptional');
  const videoIdx = schemaSrc.indexOf('video: withYamlOptional');
  const assetIdx = schemaSrc.indexOf('asset: withYamlOptional');
  const sbIdx = schemaSrc.indexOf('storyboard: withYamlOptional');
  assert(
    schemaSrc.slice(audioIdx, videoIdx).includes("...universalRequired")
      && schemaSrc.slice(videoIdx, assetIdx).includes("...universalRequired"),
    "audio/video 段仍展开 universalRequired(filePath 单点宽容定义)",
  );
  assert(
    !schemaSrc.slice(assetIdx, sbIdx).includes("...universalRequired"),
    "asset 段不再展开 universalRequired(独立 nullish 三字段,52-07 结构)",
  );
  assert(
    (schemaSrc.match(/\.nullish\(\)/g) || []).length >= 15,
    "nullish 化覆盖面在位(≥15:asset3 + audio3 + video4 + storyboard3 + script2 - universal1)",
  );

  summary();
}

try {
  main();
} catch (err) {
  console.error("uncaught:", err);
  process.exit(2);
}
