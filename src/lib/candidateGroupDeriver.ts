/**
 * candidateGroupDeriver.ts — kmc 候选 → canvas variantGroups 推导/物化
 * (Phase 53-03 / VAR-01+VAR-03 前置,53-RESEARCH Critical Gap 的解)。
 *
 * kmc 候选节点不在 canvas variantGroups 里(khs canvas_sync 从不写组,
 * canvasAssetLinkage 确认 variant_group_id NULL),而 select-winner 端点/
 * 前端守卫/variant:selected 广播全以组为操作单元——本模块在图加载路径上
 * 把候选族物化成机器组:
 *
 * 推导两通道(derive 纯函数,无 IO):
 *   A. envelope:parseCandidateEnvelope(node.data) 出非空 groupKey 的信封
 *      (今日 = a-flf 条件帧 `{sid}_{slot}` 归一化为 `shot:{sid}:first|last`;
 *      Wave B 结构化 groupKey 到流后同一入口自动生效);
 *   B. 命名:`*_v{N}` 文件 + 同 dir 同 base 的 canonical 无后缀兄弟在节点集内
 *      → `name:{parentDir}/{base}`(Phase 48 WR-03 dir-aware 词表)。
 *   groupKey 词表与 candidateGrouping.ts L16-20 逐字节一致;首帧/尾帧 = 两个组
 *   (Pitfall 6/D-11)。
 *
 * 物化约定:
 *   - 组 id = `cand:{groupKey}`(确定性幂等);id >128 记 skipped 拒绝(列宽
 *     string(128),绝不截断造碰撞);
 *   - 只写 `cand:` 前缀行——用户手工建的组(非 cand: 前缀)永不触碰;
 *   - 既有 winner 不被覆盖(NULL 时才落 derived winner);
 *   - 机器组成员随现实自愈(variant_node_ids 每次更新为推导集);
 *   - 成员 <2 的组丢弃(单成员无墙义);全程不 throw。
 *
 * Pure/best-effort split:deriveCandidateGroups 纯函数;
 * materializeCandidateGroups 走 db-as-parameter(P4)+ 单事务,参数化 SQL
 * 零拼接(upsertVariantGroup raw 形状)。
 */

import type { Knex } from "knex";
import type { VariantGroupV2 } from "@/types/flowgraph-v2";
import { parseCandidateEnvelope, type CandidateSource } from "./candidateEnvelope";
import { parseVariantName } from "./candidateGrouping";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface DerivedGroup {
  id: string;
  groupKey: string;
  selectMode: "single";
  variantNodeIds: string[];
  winnerNodeId?: string;
  source: CandidateSource;
}

export interface DeriveResult {
  groups: DerivedGroup[];
  skipped: Array<{ nodeId: string; reason: string }>;
}

export interface DeriveNode {
  id: string;
  type: string;
  data: Record<string, unknown>;
}

const ID_PREFIX = "cand:";
const MAX_ID_LEN = 128; // canvas_variant_groups.id string(128)

// ─── Channel B helpers(命名通道)──────────────────────────────────────────

function splitPath(fp: string): { dir: string; stem: string; ext: string } {
  const slash = fp.lastIndexOf("/");
  const dir = slash >= 0 ? fp.slice(0, slash) : "";
  const file = slash >= 0 ? fp.slice(slash + 1) : fp;
  const dot = file.lastIndexOf(".");
  const stem = dot > 0 ? file.slice(0, dot) : file;
  const ext = dot > 0 ? file.slice(dot) : "";
  return { dir, stem, ext };
}

// ─── deriveCandidateGroups(纯函数)────────────────────────────────────────

export function deriveCandidateGroups(nodes: DeriveNode[]): DeriveResult {
  const skipped: DeriveResult["skipped"] = [];
  // groupKey → 成员(保留入序);groupKey → 源;groupKey → winner 候选
  const members = new Map<string, string[]>();
  const sourceOf = new Map<string, CandidateSource>();
  const winnerOf = new Map<string, { nodeId: string; picked: boolean }>();

  const claim = (groupKey: string, nodeId: string, source: CandidateSource, isWinner: boolean): void => {
    const arr = members.get(groupKey) ?? [];
    if (!arr.includes(nodeId)) arr.push(nodeId);
    members.set(groupKey, arr);
    if (!sourceOf.has(groupKey)) sourceOf.set(groupKey, source);
    if (isWinner) {
      const cur = winnerOf.get(groupKey);
      if (cur == null) {
        winnerOf.set(groupKey, { nodeId, picked: true });
      } else if (cur.nodeId !== nodeId) {
        skipped.push({ nodeId, reason: "multi-selected-winner, first kept" });
      }
    }
  };

  // ── 通道 A:envelope ──
  const channelAclaimed = new Set<string>();
  for (const node of nodes) {
    let envelope: ReturnType<typeof parseCandidateEnvelope> = null;
    try {
      envelope = parseCandidateEnvelope(node.data);
    } catch {
      continue; // 推导永不 throw
    }
    if (envelope == null || envelope.groupKey === "") continue; // 无组信号 = 维持现状
    claim(envelope.groupKey, node.id, envelope.source, envelope.selected === true);
    channelAclaimed.add(node.id);
  }

  // ── 通道 B:命名(_v{N} + canonical 兄弟在集内)──
  // 先建 filePath 索引供 canonical 兄弟查找
  const filePathIndex = new Set<string>();
  const filePathOwner = new Map<string, string>();
  for (const node of nodes) {
    const fp = typeof node.data?.filePath === "string" ? (node.data.filePath as string) : null;
    if (fp) {
      filePathIndex.add(fp);
      if (!filePathOwner.has(fp)) filePathOwner.set(fp, node.id);
    }
  }
  for (const node of nodes) {
    if (channelAclaimed.has(node.id)) continue;
    const fp = typeof node.data?.filePath === "string" ? (node.data.filePath as string) : null;
    if (!fp) continue;
    const parsed = parseVariantName(fp);
    if (!parsed) continue;
    const { dir, ext } = splitPath(fp);
    const canonical = dir.length > 0 ? `${dir}/${parsed.base}${ext}` : `${parsed.base}${ext}`;
    if (!filePathIndex.has(canonical)) continue; // canonical 兄弟不在节点集 → 不成组
    // /oss/ 是 kap 媒体根——命名通道 groupKey 相对媒体根(Phase 48 同构)
    const relDir = dir.startsWith("/oss/") ? dir.slice("/oss/".length) : dir;
    const groupKey = `name:${relDir}/${parsed.base}`;
    claim(groupKey, node.id, "p03_nbest", false); // 命名通道无 selected 信号
    // canonical 兄弟本身也是组成员(无后缀原版 = Phase 48 命名通道默认成员)
    const canonicalOwner = filePathOwner.get(canonical);
    if (canonicalOwner) claim(groupKey, canonicalOwner, "p03_nbest", false);
  }

  // ── 共同规则 → 输出 ──
  const groups: DerivedGroup[] = [];
  for (const [groupKey, ids] of members) {
    if (ids.length < 2) {
      for (const id of ids) skipped.push({ nodeId: id, reason: "single-member" });
      continue;
    }
    const id = `${ID_PREFIX}${groupKey}`;
    if (id.length > MAX_ID_LEN) {
      for (const nid of ids) skipped.push({ nodeId: nid, reason: "id-too-long" });
      continue;
    }
    const winner = winnerOf.get(groupKey);
    groups.push({
      id,
      groupKey,
      selectMode: "single",
      variantNodeIds: ids,
      ...(winner ? { winnerNodeId: winner.nodeId } : {}),
      source: sourceOf.get(groupKey) ?? "p03_nbest",
    });
  }
  return { groups, skipped };
}

// ─── materializeCandidateGroups(事务物化,db-as-parameter P4)─────────────

export interface MaterializeOutcome {
  created: number;
  updated: number;
  unchanged: number;
  warnings: string[];
}

export async function materializeCandidateGroups(
  db: Knex,
  scope: { projectId: number; episodesId: number },
  derived: DerivedGroup[],
): Promise<MaterializeOutcome> {
  const out: MaterializeOutcome = { created: 0, updated: 0, unchanged: 0, warnings: [] };
  const ts = Date.now();

  await db.transaction(async (trx) => {
    for (const g of derived) {
      const rows: Array<Record<string, unknown>> = await trx("canvas_variant_groups")
        .where({ id: g.id, project_id: scope.projectId, episodes_id: scope.episodesId })
        .select("id", "winner_node_id", "variant_node_ids");
      const existing = rows[0];
      if (existing == null) {
        await trx.raw(
          `INSERT INTO canvas_variant_groups
             (id, project_id, episodes_id, phase_index, branch_id,
              variant_node_ids, winner_node_id, select_mode, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            g.id,
            scope.projectId,
            scope.episodesId,
            0,
            "main",
            JSON.stringify(g.variantNodeIds),
            g.winnerNodeId ?? null,
            g.selectMode,
            ts,
            ts,
          ],
        );
        out.created++;
        continue;
      }
      // 用户组保护:非 cand: 前缀行(手工组撞 id)永不触碰
      if (typeof existing.id === "string" && !existing.id.startsWith(ID_PREFIX)) {
        out.warnings.push(`user-group collision skipped: ${g.id}`);
        continue;
      }
      const existingWinner = (existing.winner_node_id as string | null) ?? null;
      const existingMembers: string[] = existing.variant_node_ids
        ? JSON.parse(String(existing.variant_node_ids))
        : [];
      const sameMembers =
        JSON.stringify(existingMembers) === JSON.stringify(g.variantNodeIds);
      const nextWinner = existingWinner ?? g.winnerNodeId ?? null; // 既有 winner 不被覆盖
      if (sameMembers && existingWinner === nextWinner) {
        out.unchanged++;
        continue;
      }
      await trx("canvas_variant_groups")
        .where({ id: g.id, project_id: scope.projectId, episodes_id: scope.episodesId })
        .update({
          variant_node_ids: JSON.stringify(g.variantNodeIds),
          winner_node_id: nextWinner,
          updated_at: ts,
        });
      out.updated++;
    }
  });
  return out;
}

// ─── mergeDerivedGroups(响应合并,纯函数)────────────────────────────────

/** 既有组优先,derived 只补缺(load 路径合并响应用)。 */
export function mergeDerivedGroups(
  existing: VariantGroupV2[],
  derived: DerivedGroup[] | DeriveResult,
): VariantGroupV2[] {
  const groups = Array.isArray(derived) ? derived : derived.groups;
  const have = new Set(existing.map((g) => g.id));
  const additions: VariantGroupV2[] = groups
    .filter((g) => !have.has(g.id))
    .map((g) => ({
      id: g.id,
      phaseIndex: 0,
      branchId: "main",
      variantNodeIds: g.variantNodeIds,
      ...(g.winnerNodeId ? { winnerNodeId: g.winnerNodeId } : {}),
      selectMode: g.selectMode,
    }));
  return [...existing, ...additions];
}
