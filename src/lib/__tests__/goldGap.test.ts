/**
 * src/lib/__tests__/goldGap.test.ts — 迭代平台 M3 金标轨 gap 计算回归锁。
 *
 * 运行: cd /data/workspace/kais-aigc-platform && node --import tsx --test src/lib/__tests__/goldGap.test.ts
 *
 * 纯模块纪律(blindVoteLedger.test 同款):零 fs/零网络/零 db——路由模块
 * (gold-gap.ts)带 db/ws 副作用不被本文件 import;路径守卫是纯函数所以
 * 目录穿越拒收在 lib 层即可锁死(realpath 复核在路由层,不进单测)。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeP09GoldGap,
  parseCoverageRatio,
  isSafeStandardName,
  isPathInsideRoot,
  P09_WEIGHTS,
  GAP_PRODUCER,
} from "../goldGap";

const REF = "golden-standard-xiaojianghu-ep01";

// ─── 1. 权重归一 gap 计算正确性 ────────────────────────────────────────────

test("绝对计数按各自 n_shots 归一:38/90 vs 0/26 → overall≈0.25(容差断言)", () => {
  const ref = { n_shots: 90, short_punches_total: 38 };
  const cand = { n_shots: 26, short_punches_total: 0 };
  const r = computeP09GoldGap(REF, ref, cand);
  // 归一率 0.4222 vs 0 → 单项 gap01=1(不归一则是 |38-0|/38 同值,但
  // 换 0/26 候选时归一与否分母全不同——此处锁"归一后再比"契约);
  // 缺项不重归一分母 → overall = 0.25×1 = 0.25。
  assert.ok(
    Math.abs(r.overall_gap01 - 0.25) < 1e-6,
    `overall 应≈0.25,实际 ${r.overall_gap01}`,
  );
  const punch = r.per_metric.find((m) => m.key === "short_punches_total")!;
  assert.equal(punch.ref, 0.4222, "ref 侧须为 38/90 归一值(4位)");
  assert.equal(punch.cand, 0);
  assert.equal(punch.gap01, 1);
});

test("归一消解镜数差:同率不同量 → gap≈0(38/90 vs 11/26 同率不假性拉爆)", () => {
  const ref = { n_shots: 90, short_punches_total: 38 };
  const cand = { n_shots: 26, short_punches_total: 11 }; // 0.4231 vs 0.4222
  const r = computeP09GoldGap(REF, ref, cand);
  const punch = r.per_metric.find((m) => m.key === "short_punches_total")!;
  assert.ok(punch.gap01 < 0.01, `同率应≈0,实际 ${punch.gap01}`);
});

test("五指标全在场的确定性 overall(xiaojianghu 量级实测差,逐项手算)", () => {
  const ref = {
    n_shots: 100, duration_median: 2.5, short_punches_total: 10,
    scene_punch_coverage: "1/2", max_near_equal_run: 10, flat_trio_pct: 0.2,
  };
  const cand = {
    n_shots: 100, duration_median: 3.0, short_punches_total: 5,
    scene_punch_coverage: "1/4", max_near_equal_run: 5, flat_trio_pct: 0.1,
  };
  const r = computeP09GoldGap(REF, ref, cand);
  // median |0.5|/2.5=0.2→0.06 | punches 0.1vs0.05→0.5→0.125
  // coverage 0.5vs0.25→0.5→0.125 | run 0.1vs0.05→0.5→0.05 | flat 0.5→0.05
  assert.ok(Math.abs(r.overall_gap01 - 0.41) < 1e-6, `应=0.41,实际 ${r.overall_gap01}`);
});

test("方向无关 clamp:候选指标反超金标时 gap 封顶 1 不爆表", () => {
  const r = computeP09GoldGap(REF, { n_shots: 90, duration_median: 2.5 }, { n_shots: 90, duration_median: 25 });
  const m = r.per_metric.find((x) => x.key === "duration_median")!;
  assert.equal(m.gap01, 1, "9×时长差必须 clamp 到 1");
});

// ─── 2. scene_punch_coverage 字符串解析 ───────────────────────────────────

test('scene_punch_coverage "1/1" vs "0/5" 解析正确(金标 1.0 vs 管线 0)', () => {
  const r = computeP09GoldGap(REF, { scene_punch_coverage: "1/1" }, { scene_punch_coverage: "0/5" });
  const m = r.per_metric.find((x) => x.key === "scene_punch_coverage")!;
  assert.equal(m.ref, 1);
  assert.equal(m.cand, 0);
  assert.equal(m.gap01, 1);
  assert.equal(m.weight, 0.25);
});

test("parseCoverageRatio 边界:b=0 无定义判废,非 a/b 形态判废,数字直传限 [0,1]", () => {
  assert.equal(parseCoverageRatio("1/1"), 1);
  assert.equal(parseCoverageRatio("0/5"), 0);
  assert.equal(parseCoverageRatio("3/4"), 0.75);
  assert.equal(parseCoverageRatio(" 2 / 4 "), 0.5, "容忍空白");
  assert.equal(parseCoverageRatio("0/0"), null, "b=0 覆盖率无定义 → 跳过");
  assert.equal(parseCoverageRatio("abc"), null);
  assert.equal(parseCoverageRatio("1/"), null);
  assert.equal(parseCoverageRatio(0.5), 0.5, "已解析数字直传");
  assert.equal(parseCoverageRatio(1.5), null, "越界数字判废");
  assert.equal(parseCoverageRatio(null), null);
});

// ─── 3. 缺位/字段缺失单项跳过不崩 ─────────────────────────────────────────

test("金标缺位/字段缺失单项跳过不崩(缺 camera_movement 等场外字段)", () => {
  // 候选 dict 只带部分指标 + 场外字段(metrics.py 输出本就无 camera_movement)
  const ref = { n_shots: 90, duration_median: 2.5, scene_punch_coverage: "1/1", flat_trio_pct: 0.05 };
  const cand = { n_shots: 26, duration_median: 5.5, camera_movement: "固定", static_pct: 0.4 };
  const r = computeP09GoldGap(REF, ref, cand);
  // punches 双侧缺 → skip;coverage 候选缺 → skip;flat 金标有候选缺 → skip
  assert.deepEqual(
    r.per_metric.map((m) => m.key),
    ["duration_median"],
    "只有双侧在场的 duration_median 计入",
  );
  assert.ok(Math.abs(r.overall_gap01 - 0.3) < 1e-6, "0.30×1(clamp)= 0.3");
});

test("metrics.py 空表退化值(null median / 0/0 coverage / n_shots 0)全部安全跳过", () => {
  const r = computeP09GoldGap(REF, { n_shots: 0, duration_median: null, scene_punch_coverage: "0/0" }, { n_shots: 0, duration_median: null, scene_punch_coverage: "0/0" });
  assert.equal(r.per_metric.length, 0);
  assert.equal(r.overall_gap01, 0);
  assert.equal(typeof r.overall_gap01, "number");
});

test("overall=Σ(weight×gap) 不重归一分母(缺项记 0 贡献,跨候选严格可比)", () => {
  // 仅 flat_trio_pct 在场:0.2 vs 0.1 → gap 0.5 → overall=0.10×0.5=0.05
  const r = computeP09GoldGap(REF, { flat_trio_pct: 0.2 }, { flat_trio_pct: 0.1 });
  assert.ok(Math.abs(r.overall_gap01 - 0.05) < 1e-6);
});

// ─── 4. 目录穿越输入被拒 ──────────────────────────────────────────────────

test("目录穿越形态全部拒收(../ 序列 / 纯 .. / 前导点 / 含斜杠)", () => {
  assert.equal(isSafeStandardName("../golden-standard-x"), false, "../ 序列含斜杠必须拒");
  assert.equal(isSafeStandardName(".."), false);
  assert.equal(isSafeStandardName("..etc"), false, "前导点目录拒");
  assert.equal(isSafeStandardName("golden-standard-x/../../etc"), false);
  assert.equal(isSafeStandardName(""), false);
  assert.equal(isSafeStandardName("golden-standard-xiaojianghu-ep01"), true);
  assert.equal(isSafeStandardName("golden-standard-v1.2-beta"), true, "点在词中合法");
});

test("候选路径词法归一后越出根即拒(裸 startsWith 骗不过的 .. 消解)", () => {
  const root = "/data/workspace/kais-hermes-skills/skills/kais-movie-pipeline/episodes";
  assert.equal(
    isPathInsideRoot(root, `${root}/ep-xiaojianghu-demo1/.pipeline-assets/shot-list.json`),
    true,
    "根内正常路径放行",
  );
  assert.equal(
    isPathInsideRoot(root, `${root}/../../etc/passwd`),
    false,
    ".. 消解后落 /etc → 拒",
  );
  assert.equal(isPathInsideRoot(root, root), false, "根自身不算内");
  assert.equal(isPathInsideRoot(root, "/etc/passwd"), false);
  assert.equal(isPathInsideRoot(root, "/data/workspace/kais-hermes-skills/skills/kais-movie-pipeline/episodes-sibling/x.json"), false, "同名前缀目录不算内");
});

// ─── 5. 权重表锁 + 元数据 ─────────────────────────────────────────────────

test("P09 权重表和=1 且逐项为正(锁常量表,改表须显式重审)", () => {
  const keys = Object.keys(P09_WEIGHTS);
  assert.deepEqual(
    keys.sort(),
    ["duration_median", "flat_trio_pct", "max_near_equal_run", "scene_punch_coverage", "short_punches_total"],
  );
  const sum = Object.values(P09_WEIGHTS).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9, `权重和必须=1,实际 ${sum}`);
  assert.ok(Object.values(P09_WEIGHTS).every((w) => w > 0 && w < 1));
});

test("GoldGapResult 元数据:standard_ref 透传 / scored_at ISO / producer 逐项标注", () => {
  const fixed = new Date("2026-08-27T12:00:00.000Z");
  const r = computeP09GoldGap(REF, { duration_median: 2.5 }, { duration_median: 3.0 }, fixed);
  assert.equal(r.standard_ref, REF);
  assert.equal(r.scored_at, "2026-08-27T12:00:00.000Z");
  assert.ok(r.per_metric.length > 0);
  for (const m of r.per_metric) {
    assert.equal(m.producer, GAP_PRODUCER, "spec §6 防漂移:逐项生产者标注");
  }
  // 4 位四舍五入
  const r2 = computeP09GoldGap(REF, { duration_median: 3 }, { duration_median: 3.00004 });
  const m2 = r2.per_metric[0]!;
  assert.ok(
    Number.isInteger(Math.round(m2.gap01 * 10_000)),
    "gap01 须 4 位小数粒度",
  );
});
