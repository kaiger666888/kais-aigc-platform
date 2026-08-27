/**
 * blindVoteLedger.ts — 迭代平台统一决策账本(M1/M2 盲选批,spec §2.1)。
 *
 * 双轨迭代平台(盲选 v2)的落账通道:人眼盲选(A 轨)/金标准择优(B 轨)的
 * 每一次「选定」以 decision/v1 事件 append 到 kmc episode 工作区的
 * `.pipeline-assets/blind-votes.jsonl`——与 canvas-takes.jsonl 同目录同纪律。
 *
 * 模式逐条复刻 appendCanvasTakeFlowback(manifestWriteback.ts COX-03):
 *   - never-throws:全函数体 try/catch 吞一切,失败只 console.warn 后丢弃
 *     (画布真值已在 select-winner 事务里,账本是 best-effort 留痕);
 *   - 通道未开通(KMC_MANIFEST_TRANSPORT≠fs)即 return——通道未开通 ≠ 故障,
 *     与 manifest 回写共用同一开关,不开第二条独立 env;
 *   - episodeRefs 探针解析 ep 目录(refs 缺省时 legacy 双形态
 *     `ep{id}` / 裸数字,解析不到静默返回——远端画布无从落账);
 *   - append 单行 JSON + "\n",从不改写已有行(翻案=新事件,revoked 语义
 *     由调用方表达,账本只追加)。
 *
 * 挂点纪律(D-09 同位收口):唯一调用方是 select-winner 端点
 * status==='updated' 段;本模块自身不读 db/不发网络。
 *
 * 消费侧:预定义聚合口径(spec §2.1)——人 vs AI 一致率按 source 分组 /
 * 位置效应(position==1 当选率)/ 翻案率 / B 轨 gap 收敛曲线,全部从本
 * JSONL 直接可算;score 快照进 selector(ai_scores_snapshot),不另建表。
 */

import { promises as fsp } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { getManifestTransport } from "./manifestWriteback";

// ─── Types ─────────────────────────────────────────────────────────────────

/**
 * select-winner body 的 blind 元数据(M1 wire 契约)。
 * 独立成 schema 而非内联在路由文件:路由模块带 db 副作用不可被单测 import,
 * 契约留在本纯模块(与 reviewBridge P1 同一纪律),路由只组合。
 */
export const blindMetaSchema = z.object({
  /** 盲选会话 id(bsess_*)或 gold run id;缺省由端点侧生成 bsess 前缀。 */
  sessionId: z.string().max(128).optional(),
  track: z.enum(["human_blind", "gold_auto", "gold_gated"]).default("human_blind"),
  /** 揭晓后改选的第二笔事件传 false(第一笔盲投为 true)。 */
  wasBlind: z.boolean().default(true),
  operatorNote: z.string().max(2000).optional(),
  reasonTags: z.array(z.string().max(32)).max(8).optional(),
});
export type BlindMeta = z.infer<typeof blindMetaSchema>;

/** decision/v1 事件(spec §2.1;vote_id/recorded_at 缺省时本模块生成)。 */
export interface DecisionEvent {
  schema: "decision/v1";
  /** 调用方生成;缺省时本函数生成 `bv_<ISO时间>_<4位随机>`。 */
  vote_id?: string;
  /** ISO+08:00;缺省时本函数取当前时刻。 */
  recorded_at?: string;
  project_id: number;
  episodes_id: number;
  /** episode 候选集(画布探针;缺省 legacy 双形态探针)。 */
  episode_refs?: string[];
  /** 盲选会话 id 或 gold run id。 */
  session_id?: string;
  track: "human_blind" | "gold_auto" | "gold_gated";
  /** 与 candidateGrouping 词表字节一致(cand: 机器前缀由调用方剥离)。 */
  group_key: string;
  /** candidateSourceSchema 枚举值;请求未携带时调用方传 "unknown" 占位。 */
  source: string;
  candidates_shown: Array<{ node_id: string; position: number }>;
  winner_node_id: string;
  was_blind: boolean;
  /** 自由快照区(operator_note/reason_tags/score_breakdown 等)。 */
  selector: Record<string, unknown>;
  revealed_after_vote?: boolean;
  /** 默认 false;翻案=追加新事件,旧行 revoke,从不物理删行。 */
  revoked?: boolean;
}

// ─── Timestamp / id helpers(+08:00 定死,与 spec 样例同一口径)───────────

function wallClock0800(now: Date): Date {
  return new Date(now.getTime() + 8 * 3_600_000);
}

function iso0800(now: Date): string {
  return wallClock0800(now).toISOString().replace("Z", "+08:00");
}

function compactStamp(now: Date): string {
  const t = wallClock0800(now);
  const p2 = (n: number): string => String(n).padStart(2, "0");
  return (
    `${t.getUTCFullYear()}${p2(t.getUTCMonth() + 1)}${p2(t.getUTCDate())}` +
    `T${p2(t.getUTCHours())}${p2(t.getUTCMinutes())}${p2(t.getUTCSeconds())}`
  );
}

function makeVoteId(now: Date): string {
  const rand = Math.floor(Math.random() * 0x10000)
    .toString(16)
    .padStart(4, "0");
  return `bv_${compactStamp(now)}_${rand}`;
}

// ─── appendDecisionEvent(never-throws,canvas-takes 同款)─────────────────

const DEFAULT_EPISODES_ROOT =
  "/data/workspace/kais-hermes-skills/skills/kais-movie-pipeline/episodes";

/**
 * Append one decision/v1 line to `<epDir>/.pipeline-assets/blind-votes.jsonl`.
 * Any failure warns and is dropped — the canvas truth is already committed in
 * the select-winner transaction; this ledger is best-effort audit trail.
 */
export async function appendDecisionEvent(entry: DecisionEvent): Promise<void> {
  try {
    const transport = getManifestTransport();
    if (transport == null) return; // 通道未开通 ≠ 故障
    const root = process.env.KMC_EPISODES_ROOT ?? DEFAULT_EPISODES_ROOT;
    const refs = entry.episode_refs ?? [`ep${entry.episodes_id}`, String(entry.episodes_id)];
    let epDir: string | null = null;
    for (const ref of refs) {
      if (!/^[A-Za-z0-9_-]+$/.test(ref)) continue; // 路径安全:目录名单词
      const dir = path.join(root, ref);
      try {
        const st = await fsp.stat(dir);
        if (st.isDirectory()) { epDir = dir; break; }
      } catch { /* next */ }
    }
    if (epDir == null) return; // episode 不在本机(远端画布)——无从落账,静默
    const file = path.join(epDir, ".pipeline-assets", "blind-votes.jsonl");
    // khs episode 从 p00 起就有 .pipeline-assets;mkdir 兜底让账本自足
    // (appendFile 对缺失父目录直接 ENOENT——cwd 迁移时不至于整批丢票)。
    await fsp.mkdir(path.dirname(file), { recursive: true });
    const now = new Date();
    const line = JSON.stringify({
      schema: "decision/v1",
      vote_id: entry.vote_id ?? makeVoteId(now),
      recorded_at: entry.recorded_at ?? iso0800(now),
      project_id: entry.project_id,
      episodes_id: entry.episodes_id,
      ...(entry.episode_refs != null ? { episode_refs: entry.episode_refs } : {}),
      ...(entry.session_id != null ? { session_id: entry.session_id } : {}),
      track: entry.track,
      group_key: entry.group_key,
      source: entry.source,
      candidates_shown: entry.candidates_shown,
      winner_node_id: entry.winner_node_id,
      was_blind: entry.was_blind,
      selector: entry.selector,
      ...(entry.revealed_after_vote != null
        ? { revealed_after_vote: entry.revealed_after_vote }
        : {}),
      revoked: entry.revoked ?? false,
    });
    await fsp.appendFile(file, line + "\n", "utf8");
  } catch (err) {
    console.warn("[blindVoteLedger] 决策事件落账失败(降级丢弃):", err);
  }
}
