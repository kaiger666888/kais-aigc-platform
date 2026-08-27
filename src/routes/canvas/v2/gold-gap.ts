import express from "express";
import { z } from "zod";
import { execFile } from "node:child_process";
import { promises as fsp } from "node:fs";
import os from "node:os";
import path from "node:path";
import { success, error } from "@/lib/responseFormat";
import { broadcastToProject } from "@/utils/ws";
import { db } from "@/utils/db";
import {
  selectWinnerInGroup,
  syncAssetPrimaryForWinner,
  demoteAssets,
} from "@/lib/canvasRelationalStore";
import {
  computeP09GoldGap,
  adaptMasterTimelineToKst,
  KstAdaptError,
  isSafeStandardName,
  isPathInsideRoot,
  GAP_PRODUCER,
  type GoldGapResult,
} from "@/lib/goldGap";
import { appendDecisionEvent } from "@/lib/blindVoteLedger";
import {
  enqueueManifestWriteback,
  getManifestTransport,
  replayManifestWriteback,
} from "@/lib/manifestWriteback";
import { ensureDrainStarted, drainOnce } from "@/lib/writebackQueue";
import { getGateStateService } from "@/lib/gateStateService";

const router = express.Router();

/**
 * POST /api/canvas/v2/gold-gap/score-p09 — 迭代平台 B 轨(金标准轨,M3)。
 *
 * 对候选 shot-list 清单逐一跑 KMC lab metrics.py(确定性指标,零 LLM),
 * 与金标 p09 实测分布过 computeP09GoldGap 算归一 gap,择 argmin 为
 * winnerLabel;可选 apply 把胜者转投 select-winner 的 updated 段最小闭环。
 *
 * body: { projectId, episodesId, candidateShotLists:[{label,filePath}],
 *         standardRef?, apply?:{groupId,winnerNodeId} }
 * → 200 { results:[{label, gap}], winnerLabel, applied, ... }
 *
 * 纪律(逐条对应 prompt GOLD-2):
 *  - standardRef 缺省 = 扫 $HOME/learning_sets/golden-standard-* 字典序最新;
 *    显式传入走白名单校验(isSafeStandardName + containment,目录穿越拒 400)。
 *  - 候选 filePath 白名单:KMC_EPISODES_ROOT(缺省 khs episodes 根)前缀 +
 *    词法 ".." 消解(isPathInsideRoot)+ realpath 符号链接逃逸复核。
 *  - python3 / metrics.py 缺失 → 500 带诊断信息;并发≤4,超时 30s/个。
 *  - APPLY 门(已知陷阱 manifestWriteback 注释):绝不用 HTTP self-call 复刻
 *    o_assets swap——canvasRelationalStore 函数直调是 select-winner D-07 先例;
 *    复刻的是 select-winner.ts updated 段最小闭环(资产置换 + manifest 回写 +
 *    gold_auto 账本 + ws 广播)。reviewBridge 有意不复刻:gold_auto 是自动
 *    择优,不得替人 approve 人工审核队列。
 *  - apply 被拒(not_found/not_in_group/multi_mode/locked)不改打分结果:
 *    HTTP 仍 200,applied:'rejected' + applyStatus 如实回传(内部工具面板
 *    需要保住打分表;4xx/5xx 只留给打分路径本身的失败)。LOCK 红线(WR-09)
 *    走 selectWinnerInGroup 原生 'locked' 分支,本端点不绕、不旁路。
 *  - KMC_MANIFEST_TRANSPORT 未开通时 apply 降级 applied:'deferred_to_client'
 *    (账本与 manifest 同一通道开关;面板提示走正常 selectWinner UI 通道)。
 */

// ─── Config / paths ────────────────────────────────────────────────────────

const METRICS_PY_DEFAULT =
  "/data/workspace/kais-hermes-skills/skills/kais-movie-pipeline/phase-ab-lab/metrics.py";
const EPISODES_ROOT_DEFAULT =
  "/data/workspace/kais-hermes-skills/skills/kais-movie-pipeline/episodes";
const PY_TIMEOUT_MS = 30_000;
const PY_POOL = 4; // 并发上限(prompt GOLD-2)
const MAX_CANDIDATES = 12;

function metricsPyPath(): string {
  return process.env.KMC_AB_METRICS_PY ?? METRICS_PY_DEFAULT;
}
function learningSetsRoot(): string {
  return (
    process.env.KMC_LEARNING_SETS_ROOT ??
    path.join(process.env.HOME ?? os.homedir(), "learning_sets")
  );
}
function episodesRoot(): string {
  return process.env.KMC_EPISODES_ROOT ?? EPISODES_ROOT_DEFAULT;
}

/** gold 轨 run id(账本 session_id;A 轨 bsess_ 同形不同前缀)。 */
function makeRunId(): string {
  const now = new Date(Date.now() + 8 * 3_600_000);
  const p2 = (n: number): string => String(n).padStart(2, "0");
  const stamp =
    `${now.getUTCFullYear()}${p2(now.getUTCMonth() + 1)}${p2(now.getUTCDate())}` +
    `T${p2(now.getUTCHours())}${p2(now.getUTCMinutes())}${p2(now.getUTCSeconds())}`;
  const rand = Math.floor(Math.random() * 0x10000).toString(16).padStart(4, "0");
  return `grun_${stamp}_${rand}`;
}

// ─── Error type(带 HTTP 状态的打分路径失败)───────────────────────────────

class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly data?: unknown,
  ) {
    super(message);
  }
}

// ─── python bridge(execFile 单发 + ≤4 并发池)─────────────────────────────

async function runPyMetrics(pyPath: string, filePath: string): Promise<Record<string, unknown>> {
  const stdout = await new Promise<string>((resolve, reject) => {
    execFile(
      "python3",
      [pyPath, filePath],
      { timeout: PY_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024, encoding: "utf8" },
      (err, out, stderr) => {
        if (err != null) {
          reject(
            new Error(
              `python3 metrics 失败: ${err.message}` +
                (stderr ? ` | stderr: ${String(stderr).slice(0, 400)}` : ""),
            ),
          );
        } else {
          resolve(out);
        }
      },
    );
  });
  try {
    const parsed: unknown = JSON.parse(stdout);
    if (parsed != null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    throw new Error("stdout 不是 JSON 对象");
  } catch (e) {
    throw new Error(`metrics 输出解析失败: ${(e as Error).message}`);
  }
}

/** 定长 worker 池(保持结果与输入同序;并发 ≤ limit)。 */
async function mapPool<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const idx = next++;
      if (idx >= items.length) return;
      out[idx] = await fn(items[idx]!);
    }
  });
  await Promise.all(workers);
  return out;
}

/** 打分前置自检:python3 可执行 + metrics.py 在盘。任一缺失 → 500 诊断。 */
async function preflightPython(pyPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    execFile("python3", ["--version"], { timeout: 10_000 }, (err) => {
      if (err != null) {
        reject(
          new HttpError(
            500,
            "python3 不可用(未安装或不在 PATH)——gold-gap 打分依赖 KMC lab metrics.py",
            { pythonError: String(err.message).slice(0, 300) },
          ),
        );
      } else {
        resolve();
      }
    });
  });
  try {
    await fsp.access(pyPath);
  } catch {
    throw new HttpError(500, `metrics.py 不存在: ${pyPath}(KMC_AB_METRICS_PY 可覆写)`);
  }
}

// ─── 标准集解析(缺省扫描 / 显式白名单)────────────────────────────────────

interface StandardRef {
  ref: string;
  p09Path: string;
}

async function resolveStandardRef(explicit?: string): Promise<StandardRef> {
  const root = learningSetsRoot();
  let ref: string | null = null;
  if (explicit != null) {
    if (!isSafeStandardName(explicit)) {
      throw new HttpError(400, `standardRef 非法(只允许 [A-Za-z0-9._-] 且不以 . 开头): ${explicit}`);
    }
    const dir = path.resolve(root, explicit);
    if (dir !== root && !dir.startsWith(`${root}${path.sep}`)) {
      throw new HttpError(400, `standardRef 越出 learning_sets 根: ${explicit}`);
    }
    ref = explicit;
  } else {
    let names: string[] = [];
    try {
      names = await fsp.readdir(root);
    } catch (e) {
      throw new HttpError(400, `learning_sets 根不可读: ${root}(${(e as Error).message})`);
    }
    const hits: Array<{ name: string; mtimeMs: number }> = [];
    for (const name of names) {
      if (!name.startsWith("golden-standard-")) continue;
      try {
        const st = await fsp.stat(path.join(root, name));
        if (st.isDirectory()) hits.push({ name, mtimeMs: st.mtimeMs });
      } catch { /* next */ }
    }
    // 字典序最新为主序,mtime 仅同名字段不可能出现——纯决胜无歧义。
    hits.sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : b.mtimeMs - a.mtimeMs));
    if (hits.length === 0) {
      throw new HttpError(400, `learning_sets 下未发现任何 golden-standard-* 标准集: ${root}`);
    }
    ref = hits[0]!.name;
  }
  const p09Path = path.join(root, ref, "p09_shot-list.json");
  try {
    await fsp.access(p09Path);
  } catch {
    throw new HttpError(400, `标准集 ${ref} 缺 p09_shot-list.json(M3 仅支持 P09 维度打分): ${p09Path}`);
  }
  return { ref, p09Path };
}

// ─── 候选路径白名单(episodes 根前缀 + 词法 + realpath 三道)────────────────

async function assertCandidatePath(p: string): Promise<string> {
  const root = episodesRoot();
  const abs = path.resolve(p);
  if (!isPathInsideRoot(root, abs)) {
    throw new HttpError(400, `候选 filePath 越出 episodes 根(白名单拒绝): ${p}`, { episodesRoot: root });
  }
  let realRoot: string;
  let realFile: string;
  try {
    [realRoot, realFile] = await Promise.all([fsp.realpath(root), fsp.realpath(abs)]);
  } catch (e) {
    throw new HttpError(400, `候选文件不可达: ${p}(${(e as Error).message})`);
  }
  const prefix = realRoot.endsWith(path.sep) ? realRoot : `${realRoot}${path.sep}`;
  if (realFile !== realRoot && !realFile.startsWith(prefix)) {
    throw new HttpError(400, `候选 filePath 经 realpath 后越出 episodes 根(符号链接逃逸): ${p}`);
  }
  return abs;
}

// ─── APPLY 门:select-winner updated 段最小闭环(canvasRelationalStore 直调)──

/** 回写 drain 单例(select-winner.ts bootWritebackDrain 同款;ensureDrainStarted
 *  本身进程级单例,先注册者赢——两处回调做同一件事,谁先挂上都正确)。 */
let drainBooted = false;
function bootWritebackDrain(): void {
  if (drainBooted) return;
  drainBooted = true;
  void (async () => {
    const { db: drainDb } = await import("@/utils/db");
    ensureDrainStarted(drainDb, async (d) => {
      const transport = getManifestTransport();
      if (transport == null) return;
      await drainOnce(d, (row) => replayManifestWriteback(row, transport));
    });
  })().catch(() => {
    drainBooted = false;
  });
}

export interface GoldApplyOutcome {
  applied: "applied" | "rejected" | "deferred_to_client";
  groupId?: string;
  winnerNodeId?: string;
  applyStatus?: string;
  reason?: string;
  swappedAssetIds?: number[];
}

/**
 * 复刻 select-winner.ts status==='updated' 段的最小闭环:
 * canvas 写直(selectWinnerInGroup,WR-09 locked 保护原生内建,不绕)→
 * o_assets isPrimaryView 置换(直调,失败不回滚 canvas)→ manifest 回写
 * (enqueue+drain,transport 未开通时调用方降级 deferred)→ gold_auto
 * 账本(never-throws)→ ws 广播。idempotent 不算失败:重复择优同一胜者
 * 无新信息(D-03 同款,applied:'rejected'/applyStatus:'idempotent' 回传)。
 */
export async function applyGoldWinner(opts: {
  projectId: number;
  episodesId: number;
  groupId: string;
  winnerNodeId: string;
  standardRef: string;
  winnerGap: GoldGapResult;
  winnerLabel: string;
  runId: string;
}): Promise<GoldApplyOutcome> {
  const { projectId, episodesId, groupId, winnerNodeId, standardRef, winnerGap, winnerLabel, runId } = opts;

  const result = await selectWinnerInGroup(db, { projectId, episodesId }, groupId, winnerNodeId);
  if (result.status === "not_found") {
    return { applied: "rejected", groupId, winnerNodeId, applyStatus: "not_found", reason: "变体组不存在" };
  }
  if (result.status === "not_in_group") {
    return { applied: "rejected", groupId, winnerNodeId, applyStatus: "not_in_group", reason: "winnerNodeId 不在组内" };
  }
  if (result.status === "multi_mode") {
    return { applied: "rejected", groupId, winnerNodeId, applyStatus: "multi_mode", reason: "仅 single 组支持选定" };
  }
  if (result.status === "locked") {
    // LOCK 红线(WR-09):含 curation:'locked' 成员的组永不自动选定。
    return { applied: "rejected", groupId, winnerNodeId, applyStatus: "locked", reason: "组含 curation:'locked' 成员,gold_auto 拒绝落地" };
  }
  if (result.status === "idempotent") {
    return { applied: "rejected", groupId, winnerNodeId, applyStatus: "idempotent", reason: "该胜者已是当前 winner(D-03,无新信息)" };
  }

  // status==='updated' — canvas 真值列已提交。D-07 资产置换直调(隔离
  // try/catch:失败不回滚 canvas,与 select-winner 同纪律)。
  let swappedAssetIds: number[] = [];
  try {
    if (result.winnerOAssetId != null) {
      swappedAssetIds = await syncAssetPrimaryForWinner(db, projectId, result.winnerOAssetId, result.memberOAssetIds);
      if (swappedAssetIds.length === 0 && result.memberOAssetIds.length > 0) {
        const demoted = await demoteAssets(db, projectId, result.memberOAssetIds.filter((id) => id !== result.winnerOAssetId));
        if (demoted.length > 0) swappedAssetIds = demoted;
      }
    } else if (result.memberOAssetIds.length > 0) {
      swappedAssetIds = await demoteAssets(db, projectId, result.memberOAssetIds);
    }
  } catch (err) {
    console.warn("[canvas:v2/gold-gap] o_assets isPrimaryView 置换失败(不回滚 canvas):", err);
  }

  // manifest 回写(KMC 工作区 FS 同步;transport 未开通 = 通道未开 ≠ 故障)。
  const transport = getManifestTransport();
  if (transport != null) {
    const scope = { projectId, episodesId };
    const svc = getGateStateService();
    svc.ensureScope(scope);
    const refs = svc.episodeRefsFor(scope) ?? new Set([`ep${episodesId}`, String(episodesId)]);
    bootWritebackDrain();
    void enqueueManifestWriteback({
      projectId,
      episodesId,
      groupId,
      winnerNodeId,
      variantIndex: result.variantNumber, // 70-02:manifest 消费真 v{N}
      source: "p09_shotlist",
      episodeRefs: [...refs],
    }).catch(() => {});
  } else {
    return {
      applied: "deferred_to_client",
      groupId,
      winnerNodeId,
      reason: "KMC_MANIFEST_TRANSPORT 未开通——canvas 已选定,请从正常 selectWinner UI 通道补落地",
    };
  }

  // gold_auto 账本(spec §2.1:score_breakdown 全量封存防事后污染;
  // B 轨不是盲投 → was_blind/revealed 均 false)。never-throws,void 不阻塞。
  void appendDecisionEvent({
    schema: "decision/v1",
    project_id: projectId,
    episodes_id: episodesId,
    session_id: runId,
    track: "gold_auto",
    group_key: groupId.startsWith("cand:") ? groupId.slice("cand:".length) : groupId,
    source: "p09_shotlist",
    // 文件候选非 canvas 节点,展示序不可考——winner 兜底单元素
    // (select-winner M1 同款注释);逐候选 gap 在 score_breakdown。
    candidates_shown: [{ node_id: winnerNodeId, position: 1 }],
    winner_node_id: winnerNodeId,
    was_blind: false,
    selector: {
      standard_ref: standardRef,
      winner_label: winnerLabel,
      score_breakdown: {
        producer: GAP_PRODUCER,
        overall_gap01: winnerGap.overall_gap01,
        per_metric: Object.fromEntries(winnerGap.per_metric.map((m) => [m.key, m.gap01])),
      },
    },
    revealed_after_vote: false,
  }).catch(() => {});

  broadcastToProject(projectId, "variant:selected", {
    projectId,
    episodesId,
    groupId,
    winnerNodeId,
    timestamp: Date.now(),
  });

  return { applied: "applied", groupId, winnerNodeId, swappedAssetIds };
}

// ─── Wire schema / endpoints ───────────────────────────────────────────────

const scoreP09Schema = z.object({
  projectId: z.number().int(),
  episodesId: z.number().int(),
  candidateShotLists: z
    .array(
      z.object({
        label: z.string().min(1).max(128),
        filePath: z.string().min(1).max(1024),
      }),
    )
    .min(1)
    .max(MAX_CANDIDATES),
  standardRef: z.string().max(128).optional(),
  apply: z
    .object({
      groupId: z.string().min(1).max(160),
      winnerNodeId: z.string().min(1).max(128),
    })
    .optional(),
});

router.post("/score-p09", async (req, res) => {
  const parse = scoreP09Schema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).send(error("参数校验失败", parse.error.issues));
  }
  const { projectId, episodesId, candidateShotLists, standardRef, apply } = parse.data;

  try {
    // 1) 标准集解析(显式白名单 / 缺省扫描)+ P09 在场校验。
    const standard = await resolveStandardRef(standardRef);
    // 2) python3 + metrics.py 前置自检(缺失 → 500 带诊断)。
    const pyPath = metricsPyPath();
    await preflightPython(pyPath);
    // 3) 候选路径白名单(全部先验,失败一个整批不打半场分)。
    const absPaths: string[] = [];
    for (const c of candidateShotLists) {
      absPaths.push(await assertCandidatePath(c.filePath));
    }
    // 4) 金标 + 候选 metrics(python,并发≤4,30s/个;absPaths 与请求同序)。
    const refMetrics = await runPyMetrics(pyPath, standard.p09Path);
    const candMetrics = await mapPool(absPaths, PY_POOL, (abs) => runPyMetrics(pyPath, abs));
    // 5) gap 计算(纯模块)+ argmin winner。
    const runId = makeRunId();
    const results = candidateShotLists.map((c, i) => ({
      label: c.label,
      gap: computeP09GoldGap(standard.ref, refMetrics, candMetrics[i]!, new Date()),
    }));
    let winnerIdx = 0;
    for (let i = 1; i < results.length; i++) {
      if (results[i]!.gap.overall_gap01 < results[winnerIdx]!.gap.overall_gap01) winnerIdx = i;
    }
    const winnerLabel = results[winnerIdx]!.label;

    // 6) APPLY 门(可选):胜者转投 select-winner 最小闭环。
    let applyOutcome: GoldApplyOutcome | null = null;
    if (apply != null) {
      applyOutcome = await applyGoldWinner({
        projectId,
        episodesId,
        groupId: apply.groupId,
        winnerNodeId: apply.winnerNodeId,
        standardRef: standard.ref,
        winnerGap: results[winnerIdx]!.gap,
        winnerLabel,
        runId,
      });
    }

    return res.status(200).send(
      success({
        results,
        winnerLabel,
        standardRef: standard.ref,
        runId,
        applied: applyOutcome?.applied ?? "not_requested",
        ...(applyOutcome ?? {}),
      }),
    );
  } catch (err) {
    if (err instanceof HttpError) {
      return res.status(err.status).send(error(err.message, err.data ?? null));
    }
    console.error("[canvas:v2/gold-gap] score-p09 失败:", err);
    return res.status(500).send(error("gold-gap 打分失败", { detail: String((err as Error).message).slice(0, 400) }));
  }
});

/**
 * GET /api/canvas/v2/gold-gap/default-standard — 当前缺省金标集名
 * (GoldPanel 标准集下拉 M3 只展示默认;M4 多集入库后扩展列表)。
 */
router.get("/default-standard", async (_req, res) => {
  try {
    const standard = await resolveStandardRef();
    return res.status(200).send(success({ standardRef: standard.ref, p09Path: standard.p09Path }));
  } catch (err) {
    if (err instanceof HttpError) {
      return res.status(err.status).send(error(err.message, err.data ?? null));
    }
    return res.status(500).send(error("标准集解析失败"));
  }
});

/**
 * GET /api/canvas/v2/gold-gap/standards — learning_sets 下全部 golden-standard-*
 * 目录(M4:GoldPanel 标准集下拉真实数据化)。空目录/缺 p09_shot-list.json 也
 * 列出但 hasP09=false(如实反映在库状态,不做静默过滤);排序与
 * resolveStandardRef 主序一致(字典序最新在前),面板首位即缺省选集。
 */
router.get("/standards", async (_req, res) => {
  try {
    const root = learningSetsRoot();
    let names: string[];
    try {
      names = await fsp.readdir(root);
    } catch (e) {
      throw new HttpError(400, `learning_sets 根不可读: ${root}(${(e as Error).message})`);
    }
    const standards: Array<{ name: string; mtime: string; hasP09: boolean }> = [];
    for (const name of names) {
      if (!name.startsWith("golden-standard-")) continue;
      try {
        const st = await fsp.stat(path.join(root, name));
        if (!st.isDirectory()) continue;
        let hasP09 = false;
        try {
          await fsp.access(path.join(root, name, "p09_shot-list.json"));
          hasP09 = true;
        } catch { /* 缺 p09 → hasP09=false 照常列出 */ }
        standards.push({ name, mtime: new Date(st.mtimeMs).toISOString(), hasP09 });
      } catch { /* stat 失败的条目跳过,不整表失败 */ }
    }
    standards.sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
    return res.status(200).send(success({ standards }));
  } catch (err) {
    if (err instanceof HttpError) {
      return res.status(err.status).send(error(err.message, err.data ?? null));
    }
    console.error("[canvas:v2/gold-gap] standards 列举失败:", err);
    return res.status(500).send(error("标准集列举失败"));
  }
});

// ─── M4:成片节奏保真度复测轨(kst 外环,测量≠选择决策)─────────────────────

const scoreKstSchema = z.object({
  candidatePath: z.string().min(1).max(1024),
  standardRef: z.string().max(128).optional(),
});

/**
 * POST /api/canvas/v2/gold-gap/score-kst — 成片节奏保真度复测(M4 / kst 外环)。
 *
 * 对真实成片时间轴(master-timeline EDL 或 kst 成片镜头表)跑既有 metrics.py,
 * 与金标 p09 过同一 computeP09GoldGap:gold=p09 意图分布,kst=成片实测——
 * 量的是「成片相对金标意图的节奏漂移」,为复测轨,不做 argmin 择优。
 *
 * 纪律:
 *  - candidatePath 走既有 assertCandidatePath 三道白名单(episodes 根 +
 *    词法 + realpath),与 score-p09 同一收口;
 *  - kst 适配是纯函数(adaptMasterTimelineToKst),非法形状/空 edl → 400 明确
 *    报错;适配结果写 os.tmpdir() 临时文件(mkdtemp + finally 随手清理);
 *  - **不写决策账本**(测量≠选择决策;score-p09 的 applyGoldWinner 不复用);
 *  - 无 DB 写、无新依赖;metrics.py 复用既有单发 + 前置自检。
 *
 * → 200 { gap: GoldGapResult, candidate_kind, standardRef, n_shots, candidatePath }
 */
router.post("/score-kst", async (req, res) => {
  const parse = scoreKstSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).send(error("参数校验失败", parse.error.issues));
  }
  const { candidatePath, standardRef } = parse.data;

  let tmpDir: string | null = null;
  try {
    // 1) 金标解析 + python 前置自检(与 score-p09 同序同语义)。
    const standard = await resolveStandardRef(standardRef);
    const pyPath = metricsPyPath();
    await preflightPython(pyPath);
    // 2) 成片文件白名单(episodes 根内)。
    const abs = await assertCandidatePath(candidatePath);
    // 3) 读 JSON + kst 适配(纯函数;非法形状 → 400 明确报错)。
    let raw: unknown;
    try {
      raw = JSON.parse(await fsp.readFile(abs, "utf8"));
    } catch (e) {
      throw new HttpError(400, `成片文件不是合法 JSON: ${candidatePath}(${(e as Error).message})`);
    }
    let adapted: ReturnType<typeof adaptMasterTimelineToKst>;
    try {
      adapted = adaptMasterTimelineToKst(raw);
    } catch (e) {
      if (e instanceof KstAdaptError) throw new HttpError(400, e.message);
      throw e;
    }
    // 4) 临时 kst 文件 + metrics.py 单发(复用既有桥,不再开并发池——单文件)。
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "kst-score-"));
    const tmpKst = path.join(tmpDir, "kst.json");
    await fsp.writeFile(tmpKst, JSON.stringify(adapted.shots), "utf8");
    const refMetrics = await runPyMetrics(pyPath, standard.p09Path);
    const kstMetrics = await runPyMetrics(pyPath, tmpKst);
    // 5) gap 计算(gold=p09 意图,kst=成片实测;不写账本)。
    const gap = computeP09GoldGap(standard.ref, refMetrics, kstMetrics, new Date());
    return res.status(200).send(
      success({
        gap,
        candidate_kind: adapted.candidateKind,
        standardRef: standard.ref,
        n_shots: adapted.shots.length,
        candidatePath: abs,
      }),
    );
  } catch (err) {
    if (err instanceof HttpError) {
      return res.status(err.status).send(error(err.message, err.data ?? null));
    }
    console.error("[canvas:v2/gold-gap] score-kst 失败:", err);
    return res.status(500).send(error("成片保真度打分失败", { detail: String((err as Error).message).slice(0, 400) }));
  } finally {
    if (tmpDir != null) {
      await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }
});

export default router;
