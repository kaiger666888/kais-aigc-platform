/**
 * goldGap.ts — 迭代平台 B 轨(金标准轨)gap 打分纯计算模块(M3)。
 *
 * 职责边界(prompt GOLD-1):只接受已 parse 的指标 dict(类型松散
 * Record<string,unknown>),无 fs/db/network——真正调 KMC lab metrics.py 的
 * 活在 gold-gap 路由(Node child_process execFile)。纯 → 可 node:test 单测。
 *
 * 打分语义(spec §3 ① 确定性类):P09 镜头清单用 KMC lab 的确定性分布指标
 * 对金标实测分布算归一化距离;方向无关比 |a-b|/max(|ref|,ε) 后 clamp 到
 * [0,1]——候选比金标"更密/更碎"与"更稀"同权(金标是参照不是上限)。
 * 绝对计数(short_punches_total / max_near_equal_run)必须先各除以自己的
 * n_shots 归一再比,否则镜数不同的候选/金标会假性拉爆。
 *
 * 防漂移条款(spec §6):LLM 判读不得冒充客观分——本模块产出的每一项
 * per_metric 都标注 producer:"kmc-lab-metrics"(确定性生产者),聚合统计
 * 时与 agent 判读分分开。score_breakdown 全量封存进决策账本 selector。
 */

// ─── Types ─────────────────────────────────────────────────────────────────

/** 单指标归一化 gap。gap01 ∈ [0,1],ref/cand 为归一化后的可比值。 */
export interface MetricGap {
  key: string;
  ref: number;
  cand: number;
  gap01: number;
  weight: number;
  /** spec §6 防漂移:逐项生产者标注,固定常量(见 GAP_PRODUCER)。 */
  producer: string;
}

export interface GoldGapResult {
  per_metric: MetricGap[];
  /** 加权合计,四舍五入到 4 位(见 overallGap01 的缺项语义注释)。 */
  overall_gap01: number;
  /** 金标集名,如 golden-standard-xiaojianghu-ep01(spec §2.1 standard_ref)。 */
  standard_ref: string;
  /** ISO 时刻。 */
  scored_at: string;
}

// ─── Constants ─────────────────────────────────────────────────────────────

/** per_metric 逐项生产者标注(spec §6 确定性维度强制)。 */
export const GAP_PRODUCER = "kmc-lab-metrics";

/**
 * P09 打分权重表(M3 定死常量;权重和必须=1,goldGap.test.ts 锁此表)。
 * 依据(prompt GOLD-1 + xiaojianghu 实测):节奏三主指标——中位时长
 * (金标 2.5s vs 管线 5.5s 的核心差)0.30、短切存在感(punches 38 vs 0)
 * 0.25、场景 punch 覆盖(1/1 vs 0/5)0.25 三者合计 0.80;等长 run 与
 * 平三件套是次级形状指标各 0.10。后续新增指标只许在保持 Σ=1 前提下
 * 改表,不许旁路加权。
 */
export const P09_WEIGHTS: Record<string, number> = {
  duration_median: 0.3,
  short_punches_total: 0.25,
  scene_punch_coverage: 0.25,
  max_near_equal_run: 0.1,
  flat_trio_pct: 0.1,
};

/** 相对距离分母下限:ref  legit 为 0(punches=0/coverage=0)时不除以 0。 */
const EPS = 1e-9;

// ─── Numeric helpers ───────────────────────────────────────────────────────

function round4(x: number): number {
  return Math.round(x * 10_000) / 10_000;
}

/** 方向无关归一化比,clamp 到 [0,1]。 */
function relGap01(ref: number, cand: number): number {
  const gap = Math.abs(ref - cand) / Math.max(Math.abs(ref), EPS);
  return Math.min(1, Math.max(0, gap));
}

/** 有限数提取:null/undefined/非数/NaN/±∞ → null(单项跳过的统一入口)。 */
function asFinite(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * scene_punch_coverage 解析:"a/b" 字符串取比例 a/b;b<=0(无 ≥4 镜场景,
 * 覆盖率无定义)→ null 跳过。数字直传(防御上游已解析形态),越界 [0,1] 判废。
 */
export function parseCoverageRatio(v: unknown): number | null {
  if (typeof v === "number") {
    return Number.isFinite(v) && v >= 0 && v <= 1 ? v : null;
  }
  if (typeof v !== "string") return null;
  const m = /^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/.exec(v.trim());
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (!(b > 0)) return null;
  return a / b;
}

/** 绝对计数按各自 n_shots 归一;n 缺失/非正 → null 跳过。 */
function normalizedPerShot(metrics: Record<string, unknown>, key: string): number | null {
  const v = asFinite(metrics[key]);
  const n = asFinite(metrics.n_shots);
  if (v == null || n == null || n <= 0) return null;
  return v / n;
}

/**
 * 单指标归一 gap 项。任一侧取值缺失 → null(该权重不计入,见下)。
 * short_punches_total / max_near_equal_run 在此完成除以各自 n_shots。
 */
function metricGapOf(key: string, ref: Record<string, unknown>, cand: Record<string, unknown>): { ref: number; cand: number } | null {
  switch (key) {
    case "short_punches_total":
    case "max_near_equal_run": {
      const r = normalizedPerShot(ref, key);
      const c = normalizedPerShot(cand, key);
      return r == null || c == null ? null : { ref: r, cand: c };
    }
    case "scene_punch_coverage": {
      const r = parseCoverageRatio(ref[key]);
      const c = parseCoverageRatio(cand[key]);
      return r == null || c == null ? null : { ref: r, cand: c };
    }
    default: {
      const r = asFinite(ref[key]);
      const c = asFinite(cand[key]);
      return r == null || c == null ? null : { ref: r, cand: c };
    }
  }
}

// ─── kst 适配(迭代平台 M4:成片节奏保真度复测轨)──────────────────────────

/** kst(kais-shot-timeline)成片镜头行 — metrics.py kst 检测格式的最小形态。 */
export interface KstShot {
  id: string;
  start_sec: number;
  end_sec: number;
  duration: number;
}

/** 适配来源标注(score-kst 响应 candidate_kind 原样透传)。 */
export type KstCandidateKind = "master_timeline_edl" | "kst_shots";

export interface KstAdaptResult {
  shots: KstShot[];
  candidateKind: KstCandidateKind;
}

/** 适配失败(score-kst 路由映射 400;消息面向内部工具面板,中文明确)。 */
export class KstAdaptError extends Error {}

/**
 * 把两种成片时间轴输入归一为 kst 镜头行(metrics.py L37-44 自检格式的上游):
 *   ① master-timeline:{value:{edl:[{clip_id, duration_sec, …}]}} — 按 edl
 *      顺序累计 start_sec(duration 直通,end=start+duration),candidate_kind
 *      = "master_timeline_edl";
 *   ② kst 数组直通:顶层 [{id, start_sec, …}] 已是成片镜头表,candidate_kind
 *      = "kst_shots"(end_sec 缺失时以 start+duration 补齐,duration 缺失时以
 *      end−start 补齐——metrics.py kst 识别键是 duration,直通也要保它在场)。
 * 两者都不是 / edl 或数组为空 / 关键字段缺数值 → KstAdaptError(路由层 400)。
 * 纯函数:无 fs/db/network。
 */
export function adaptMasterTimelineToKst(parsed: unknown): KstAdaptResult {
  // ① master-timeline EDL 形状
  if (parsed != null && typeof parsed === "object" && !Array.isArray(parsed)) {
    const value = (parsed as Record<string, unknown>).value;
    if (value != null && typeof value === "object" && !Array.isArray(value)) {
      const edl = (value as Record<string, unknown>).edl;
      if (Array.isArray(edl)) {
        if (edl.length === 0) {
          throw new KstAdaptError("master-timeline edl 为空数组——无成片镜头可测");
        }
        const shots: KstShot[] = [];
        let cursor = 0;
        for (let i = 0; i < edl.length; i++) {
          const rec = edl[i] as Record<string, unknown> | null;
          if (rec == null || typeof rec !== "object") {
            throw new KstAdaptError(`edl 第 ${i + 1} 项不是对象`);
          }
          const id = typeof rec.clip_id === "string" && rec.clip_id !== "" ? rec.clip_id : null;
          if (id == null) {
            throw new KstAdaptError(`edl 第 ${i + 1} 项缺 clip_id(字符串)`);
          }
          const duration = asFinite(rec.duration_sec);
          if (duration == null) {
            throw new KstAdaptError(`edl 第 ${i + 1} 项(${id})缺 duration_sec(数值)`);
          }
          shots.push({ id, start_sec: cursor, end_sec: cursor + duration, duration });
          cursor += duration;
        }
        return { shots, candidateKind: "master_timeline_edl" };
      }
    }
  }
  // ② kst 数组直通(识别:首元素有 id + start_sec)
  if (Array.isArray(parsed)) {
    if (parsed.length === 0) {
      throw new KstAdaptError("kst 空数组——无成片镜头可测");
    }
    const first = parsed[0] as Record<string, unknown> | null;
    const kstShape =
      first != null &&
      typeof first === "object" &&
      first.id != null &&
      typeof first.start_sec === "number";
    if (!kstShape) {
      throw new KstAdaptError("输入既非 {value:{edl:[…]}} 也非 kst [{id,start_sec,…}] 数组");
    }
    const shots: KstShot[] = [];
    for (let i = 0; i < parsed.length; i++) {
      const row = parsed[i] as Record<string, unknown>;
      if (row == null || typeof row !== "object") {
        throw new KstAdaptError(`kst 第 ${i + 1} 行不是对象`);
      }
      const start = asFinite(row.start_sec);
      const duration = asFinite(row.duration);
      const end = asFinite(row.end_sec);
      if (typeof row.id !== "string" || start == null || (duration == null && end == null)) {
        throw new KstAdaptError(`kst 第 ${i + 1} 行缺 id/start_sec/duration(或 end_sec)数值字段`);
      }
      const dur = duration ?? end! - start;
      shots.push({
        id: row.id,
        start_sec: start,
        end_sec: end ?? start + dur,
        duration: dur,
      });
    }
    return { shots, candidateKind: "kst_shots" };
  }
  throw new KstAdaptError("输入既非 {value:{edl:[…]}} 也非 kst [{id,start_sec,…}] 数组");
}

// ─── Path guards(纯字符串形态校验;realpath/存在性检查在路由层)────────────

/**
 * 金标集名单词校验(GOLD-2 标准集白名单的一半):只允许
 * [A-Za-z0-9._-] 且不得以 "." 开头(掐掉 ".."/隐藏目录形态;含 "/"
 * 的 ../ 序列直接 false)。存在性与 realpath 落在路由层(需 fs)。
 */
export function isSafeStandardName(ref: string): boolean {
  if (!/^[A-Za-z0-9._-]+$/.test(ref)) return false;
  return !ref.startsWith(".");
}

/**
 * 候选文件路径白名单的一半(纯前缀半):词法归一(含 ".." 逐级消解)后
 * 必须落在 root 内(root 自身不算)。realpath 符号链接逃逸检查在路由层
 * (需 fs)。注意必须先消解 ".." 再比前缀——裸字符串 startsWith 会被
 * `<root>/../../etc` 这类形态骗过。
 */
export function isPathInsideRoot(root: string, p: string): boolean {
  const resolved = lexResolve(p);
  const resolvedRoot = lexResolve(root);
  const rootPrefix = resolvedRoot === "/" ? "/" : `${resolvedRoot}/`;
  return resolved.startsWith(rootPrefix);
}

/**
 * POSIX 词法 resolve(纯字符串,无 fs;与 node:path.resolve 同语义的
 * 子集:绝对化 + "."/".."/空段消解 + 尾斜杠剥离)。Windows 容器不在
 * 本仓部署面内。
 */
function lexResolve(p: string): string {
  const abs = p.startsWith("/");
  const out: string[] = [];
  for (const seg of p.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (out.length > 0) out.pop();
      continue; // 越过根的 ".." 就地吞掉(与 path.resolve 一致)
    }
    out.push(seg);
  }
  const joined = `/${out.join("/")}`;
  return abs ? (joined.length > 1 ? joined : "/") : joined;
}

// ─── Entry ─────────────────────────────────────────────────────────────────

/**
 * 对一对(金标, 候选)metrics dict 计算 P09 gold-gap。
 *
 * 缺项语义:权重表中的指标任一侧缺失(metrics.py 对空镜头表会吐
 * duration_median:null、coverage "0/0" 等)→ 该项跳过、不崩;overall 为
 * 在场项的 Σ(weight×gap)——分母不重归一,保持常量表总权 1,缺项记 0 贡献,
 * 使同一 gold 基准下跨候选的 overall 严格可比,且退化场景(仅一项在场)
 * 数值=weight×gap 可直读。全部指标在场时 Σw=1,Σ(weight×gap) 即加权平均。
 */
export function computeP09GoldGap(
  standardRef: string,
  refMetrics: Record<string, unknown>,
  candMetrics: Record<string, unknown>,
  now: Date = new Date(),
): GoldGapResult {
  const per_metric: MetricGap[] = [];
  let overall = 0;
  for (const [key, weight] of Object.entries(P09_WEIGHTS)) {
    const pair = metricGapOf(key, refMetrics, candMetrics);
    if (pair == null) continue; // 单项跳过,不崩(prompt GOLD-3 #3)
    const gap01 = round4(relGap01(pair.ref, pair.cand));
    per_metric.push({
      key,
      ref: round4(pair.ref),
      cand: round4(pair.cand),
      gap01,
      weight,
      producer: GAP_PRODUCER,
    });
    overall += weight * gap01;
  }
  return {
    per_metric,
    overall_gap01: round4(overall),
    standard_ref: standardRef,
    scored_at: now.toISOString(),
  };
}
