/**
 * canvasAssetLinkage.ts — 资产中心选定 → 画布变体组联动 (SELECT-03 / D-06).
 *
 * 联动方向 registry→canvas 单向：资产中心把某资产置为 isPrimaryView=true
 * （PATCH /api/v1/assets-registry/:id）成功后，把该资产映射到的画布节点
 * 选定为其所在变体组的 winner。选定逻辑复用 49-01 的 selectWinnerInGroup
 * （canvasRelationalStore），本模块不重写。
 *
 * Loop 预防（方向性设计，49-CONTEXT verified_facts #5 / T-49-13）：
 *   - 本模块只读 o_assets（仅 projectId 一列）、只写 canvas 表（且全部
 *     经 selectWinnerInGroup），绝不调用 registry 路由、select-winner
 *     HTTP 端点或任何 HTTP 客户端；
 *   - 反向（canvas→o_assets）由 49-01 select-winner 端点的 D-07
 *     syncAssetPrimaryForWinner 直写 o_assets 承担，不经 registry PATCH
 *     路由——两个半向各走各的写入面，不构成递归环。
 *
 * 静默跳过是常态（D-06）：sync-assets 建的节点 variant_group_id 为 NULL，
 * 只有用户在 UI 分组并保存后才有组——"资产映射不到节点 → 跳过" 与
 * "节点无组 → 跳过" 都是正常路径，只 info 不告警。
 *
 * 失败隔离（T-49-11）：导出的联动入口对外永不 throw——任何异常只
 * console.warn，绝不影响 registry 主流程的响应。
 *
 * db handle 是参数（同 ingestAssets / canvasRelationalStore 的 48-02 惯例），
 * 本模块不 import @/utils，verify 脚本可注入自己的 knex 实例。
 */

import { selectWinnerInGroup } from "./canvasRelationalStore";

// ─── Types ──────────────────────────────────────────────────────────────────

/** o_assets 行映射到的 canvas_nodes 行引用（含其组归属与 scope）。 */
export interface CanvasNodeRef {
  nodeId: string;
  projectId: number;
  episodesId: number;
  variantGroupId: string | null;
}

// ─── o_assets → canvas node 查找 ────────────────────────────────────────────

/**
 * 找出 o_assets 行映射到的画布节点（sync-assets.ts 建立的映射机制）：
 *
 *   ① 读 o_assets.projectId——行不存在或 projectId 为 NULL → []
 *      （画布节点必属于某 project，无 project 的资产映射不到）；
 *   ② 正查：确定性节点 id 等值 `a-oasset-{o_assets.id}`（sync-assets.ts:69
 *      的建点规则），限定 project_id = 资产 projectId（T-49-12 跨项目防护）。
 *      同一资产可在 project 的**多个 episodes** 各有一行（o_assets 无
 *      episodes 维度，而 canvas_nodes 复合主键含 episodes_id）——WR-04：
 *      返回**全部**行，按 episodes_id 升序（确定性），绝不 `.first()` 取
 *      任意行：联动会作用于每个 episode 的组，兄弟 episode 不再残留旧
 *      winner；
 *   ③ 兜底：json_extract(data,'$.oAssetId') 等值——命中非 sync 来源但带
 *      资产引用的节点。T-49-10：whereRaw 占位参数传 oAssetId，绝不拼接。
 *   ④ 仍无 → []。
 *
 * ② 优先于 ③：确定性 id 匹配不受 data JSON 形状影响。
 */
export async function findCanvasNodesForAsset(
  db: any,
  oAssetId: number,
): Promise<CanvasNodeRef[]> {
  const asset = await db("o_assets").where({ id: oAssetId }).select("projectId").first();
  if (!asset || asset.projectId == null) return [];
  const projectId: number = asset.projectId;

  let nodes: any[] = await db("canvas_nodes")
    .where({ id: `a-oasset-${oAssetId}`, project_id: projectId })
    .orderBy("episodes_id", "asc")
    .select("id", "episodes_id", "variant_group_id");
  if (nodes.length === 0) {
    nodes = await db("canvas_nodes")
      .where({ project_id: projectId })
      .whereRaw("json_extract(data, '$.oAssetId') = ?", [oAssetId])
      .orderBy("episodes_id", "asc")
      .select("id", "episodes_id", "variant_group_id");
  }

  // WR-04: ALL episodes' nodes, deterministic episodes_id asc order — the
  // caller applies the selection to every mapped group so sibling episodes
  // cannot keep a stale winner.
  return nodes.map((node: any) => ({
    nodeId: node.id,
    projectId,
    episodesId: node.episodes_id ?? 1, // sync-assets 默认 episodesId=1
    variantGroupId: node.variant_group_id ?? null,
  }));
}

/**
 * 单数便捷形式：映射的**第一个**节点引用（episodes_id 升序的首行，
 * 确定性）或 null。联动入口用复数版本（findCanvasNodesForAsset）——
 * 一个资产可映射到多个 episode 的节点。
 */
export async function findCanvasNodeForAsset(
  db: any,
  oAssetId: number,
): Promise<CanvasNodeRef | null> {
  const nodes = await findCanvasNodesForAsset(db, oAssetId);
  return nodes.length > 0 ? nodes[0] : null;
}

// ─── registry→canvas 联动入口 ───────────────────────────────────────────────

/**
 * D-06 联动入口：资产中心选定（PATCH 置 isPrimaryView=true）成功后调用；
 * 把资产映射到的画布节点选定为其所在变体组的 winner。
 *
 * WR-04：资产可映射到同一 project **多个 episodes** 的节点——对每个
 * (episode, group) 引用都执行一次 selectWinnerInGroup，保证所有 episode
 * 的组同步换选，兄弟 episode 不再残留旧 winner；多 episode 映射本身会
 * warn 提示（数据信号：一个资产被多集复用）。
 *
 * 全部常态路径只 info、非异常：
 *   - 资产未映射画布节点 → 跳过（资产中心大量资产从未 sync 到画布）；
 *   - 节点不在任何变体组 → 跳过（sync 建点默认无组，D-06 明文的常态）；
 *   - selectWinnerInGroup 返回非 updated status（not_found / multi_mode /
 *     not_in_group / locked / idempotent）→ 跳过——canvas 组可能 multi 或
 *     含锁定成员，registry 侧无法预知；idempotent 说明画布已是该
 *     winner，无事可做。
 *
 * 对外永不 throw（T-49-11）：顶层 try/catch 兜底，异常只 warn，绝不影响
 * registry 主流程（调用方另以 void + .catch fire-and-forget，双保险）。
 */
export async function applyRegistrySelectionToCanvas(
  db: any,
  oAssetId: number,
): Promise<void> {
  try {
    const nodes = await findCanvasNodesForAsset(db, oAssetId);
    if (nodes.length === 0) {
      console.info(`[canvasAssetLinkage] 资产 ${oAssetId} 未映射画布节点，跳过联动`);
      return;
    }
    for (const node of nodes) {
      if (!node.variantGroupId) {
        console.info(`[canvasAssetLinkage] 节点 ${node.nodeId} 不在变体组，跳过联动`);
        continue;
      }
      const result = await selectWinnerInGroup(
        db,
        { projectId: node.projectId, episodesId: node.episodesId },
        node.variantGroupId,
        node.nodeId,
      );
      if (result.status === "updated") {
        console.info(
          `[canvasAssetLinkage] 资产 ${oAssetId} 选定 → 画布组 ${node.variantGroupId} ` +
            `(episode ${node.episodesId}) winner = ${node.nodeId}`,
        );
      } else {
        console.info(
          `[canvasAssetLinkage] 画布组 ${node.variantGroupId} 选定未应用 (status=${result.status})，跳过联动`,
        );
      }
    }
    if (nodes.length > 1) {
      console.warn(
        `[canvasAssetLinkage] 资产 ${oAssetId} 映射到 ${nodes.length} 个 episode 的节点` +
          `（${nodes.map((n) => `ep${n.episodesId}:${n.variantGroupId ?? "无组"}`).join(", ")}）` +
          `— 已对全部组执行联动 (WR-04)，防止兄弟 episode 组残留旧 winner`,
      );
    }
  } catch (err) {
    console.warn("[canvasAssetLinkage] 联动失败(不影响 registry 主流程):", err);
  }
}
