/**
 * Asset History — 资产变更审计与回退
 *
 * 每次 PATCH / update-meta 自动记录旧值快照到 o_asset_history 表，
 * 支持查询历史和一键回退。
 */

import u from "@/utils";

/** 需要审计的字段（与 PATCH allowed 列表一致） */
const TRACKED_FIELDS = [
  "name", "prompt", "describe", "characterId", "viewAngle",
  "isPrimaryView", "model", "tags", "state", "imageId", "meta",
];

export interface AssetRow {
  id: number;
  name: string | null;
  type: string | null;
  prompt: string | null;
  describe: string | null;
  projectId: number | null;
  scriptId: number | null;
  imageId: number | null;
  assetsId: number | null;
  characterId: string | null;
  viewAngle: string | null;
  isPrimaryView: number | boolean | null;
  model: string | null;
  tags: string | null;
  state: string | null;
  meta: string | null;
  createdAt: number | null;
  createdBy: string | null;
}

export interface HistoryRecord {
  id: number;
  assetId: number;
  projectId: number | null;
  action: string;
  changes: Record<string, { old: any; new: any }>;
  snapshot: AssetRow;
  source: string;
  createTime: number;
}

/**
 * 对比旧值和新值，记录变更并写入历史。
 *
 * @param existing  变更前的完整资产行
 * @param updates   本次变更的字段
 * @param action    触发来源 (patch | update-meta | revert)
 * @param source    调用来源 (api | pipeline | manual)
 * @returns 写入的历史记录 id，如果无变更返回 null
 */
export async function recordAssetHistory(
  existing: AssetRow,
  updates: Record<string, any>,
  action: string,
  source: string = "api",
): Promise<number | null> {
  // 计算 diff
  const changes: Record<string, { old: any; new: any }> = {};
  for (const field of TRACKED_FIELDS) {
    if (updates[field] === undefined) continue;
    const oldVal = (existing as any)[field];
    const newVal = updates[field];

    // meta 是 JSON 字符串 — 做语义比较
    if (field === "meta") {
      const oldStr = typeof oldVal === "string" ? oldVal : JSON.stringify(oldVal ?? {});
      const newStr = typeof newVal === "string" ? newVal : JSON.stringify(newVal ?? {});
      if (oldStr === newStr) continue;
    } else {
      // isPrimaryView 可能是 number(0/1) vs boolean — 统一为 boolean 比较
      const o = field === "isPrimaryView" ? !!oldVal : oldVal;
      const n = field === "isPrimaryView" ? !!newVal : newVal;
      if (o === n || (o == null && n == null)) continue;
    }

    changes[field] = {
      old: field === "isPrimaryView" ? !!oldVal : oldVal,
      new: field === "isPrimaryView" ? !!newVal : newVal,
    };
  }

  // 无实际变更则不记录
  if (Object.keys(changes).length === 0) return null;

  const id = Date.now();
  const snapshot: AssetRow = { ...existing };

  await u.db("o_asset_history").insert({
    id,
    assetId: existing.id,
    projectId: existing.projectId ?? null,
    action,
    changes: JSON.stringify(changes),
    snapshot: JSON.stringify(snapshot),
    source,
    createTime: id,
  });

  return id;
}

/**
 * 查询资产的变更历史（最新在前）。
 */
export async function getAssetHistory(assetId: number, limit: number = 50): Promise<HistoryRecord[]> {
  const rows = await u.db("o_asset_history")
    .where("assetId", assetId)
    .orderBy("createTime", "desc")
    .limit(limit);

  return rows.map((r: any) => ({
    ...r,
    changes: typeof r.changes === "string" ? JSON.parse(r.changes) : r.changes,
    snapshot: typeof r.snapshot === "string" ? JSON.parse(r.snapshot) : r.snapshot,
  }));
}

/**
 * 回退资产到指定历史记录的状态。
 *
 * @param assetId   资产 ID
 * @param historyId 历史记录 ID（将恢复到该记录保存的快照）
 * @returns 更新的字段列表
 */
export async function revertAssetToHistory(
  assetId: number,
  historyId: number,
): Promise<{ updated: string[]; revertedFrom: HistoryRecord }> {
  const target = await u.db("o_asset_history").where("id", historyId).first();
  if (!target) throw new Error(`历史记录 ${historyId} 不存在`);

  const snapshot: AssetRow =
    typeof target.snapshot === "string" ? JSON.parse(target.snapshot) : target.snapshot;

  // 恢复所有可追踪字段
  const restored: Record<string, any> = {};
  for (const field of TRACKED_FIELDS) {
    const val = (snapshot as any)[field];
    if (val !== undefined) {
      restored[field] = val;
    }
  }

  // 先记录当前状态到历史（以便撤销回退）
  const current = await u.db("o_assets").where("id", assetId).first();
  if (current) {
    await recordAssetHistory(current as AssetRow, restored, "revert", "api");
  }

  // 执行回退
  await u.db("o_assets").where("id", assetId).update(restored);

  const result: HistoryRecord = {
    ...target,
    changes: typeof target.changes === "string" ? JSON.parse(target.changes) : target.changes,
    snapshot,
  };

  return { updated: Object.keys(restored), revertedFrom: result };
}
