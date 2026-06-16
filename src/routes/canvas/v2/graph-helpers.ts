/**
 * FlowGraph 读写辅助 — reject/approve 等审核路由与 v2 CRUD 共用
 *
 * 集中 loadGraph / saveGraph / patchNodeInGraph 三个核心操作，
 * 避免每个路由文件重复 DB 查询逻辑。
 */

import u from "@/utils";
import type { FlowGraphV2, FlowNodeV2 } from "@/types/flowgraph-v2";

/**
 * 加载 v2 FlowGraph（仅 v2，v1 走 load-v2 路由的懒迁移）
 */
export async function loadGraph(projectId: number, episodesId: number): Promise<FlowGraphV2 | null> {
  const row = await u
    .db("o_agentWorkData")
    .where("projectId", String(projectId))
    .andWhere("episodesId", String(episodesId))
    .andWhere("key", "canvasGraph")
    .first();

  if (!row?.data) return null;
  const parsed = JSON.parse(row.data);
  if (parsed.meta?.version === "2") {
    return parsed as FlowGraphV2;
  }
  return null;
}

/**
 * 保存 v2 FlowGraph（全量覆写）
 */
export async function saveGraph(projectId: number, episodesId: number, graph: FlowGraphV2): Promise<void> {
  const existing = await u
    .db("o_agentWorkData")
    .where("projectId", String(projectId))
    .andWhere("episodesId", String(episodesId))
    .andWhere("key", "canvasGraph")
    .first();

  graph.meta.updatedAt = Date.now();

  if (!existing) {
    await u.db("o_agentWorkData").insert({
      projectId,
      episodesId,
      key: "canvasGraph",
      data: JSON.stringify(graph),
      createTime: Date.now(),
      updateTime: Date.now(),
    });
  } else {
    await u
      .db("o_agentWorkData")
      .where("id", existing.id)
      .update({ data: JSON.stringify(graph), updateTime: Date.now() });
  }
}

/**
 * 在 FlowGraph 中 patch 单个节点字段，并保存
 *
 * @returns 更新后的节点，如果图或节点不存在返回 null
 */
export async function patchNodeInGraph(
  projectId: number,
  episodesId: number,
  nodeId: string,
  updates: Partial<FlowNodeV2>,
): Promise<FlowNodeV2 | null> {
  const graph = await loadGraph(projectId, episodesId);
  if (!graph) return null;

  const nodeIdx = graph.nodes.findIndex((n) => n.id === nodeId);
  if (nodeIdx === -1) return null;

  Object.assign(graph.nodes[nodeIdx], updates);
  await saveGraph(projectId, episodesId, graph);
  return graph.nodes[nodeIdx];
}
