import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { broadcastToProject } from "@/utils/ws";
import type { FlowGraphV2, FlowNodeV2, FlowBranchV2 } from "@/types/flowgraph-v2";

const router = express.Router();

// ─── 布局常量 ─────────────────────────────────────
const MARGIN_X = 80;
const MARGIN_Y = 80;
const PHASE_GAP_X = 400;
const BRANCH_GAP_Y = 300;
const NODE_GAP_Y = 200;
const NODE_GAP_X = 300;

/** 分层分列布局：可能性树 */
function applyTreeLayout(graph: FlowGraphV2): FlowGraphV2 {
  // 1. 收集所有阶段列
  const phaseSet = new Set(graph.nodes.map((n) => n.phaseIndex));
  const phases = [...phaseSet].sort((a, b) => a - b);
  const phaseX: Record<number, number> = {};
  phases.forEach((p, idx) => {
    phaseX[p] = MARGIN_X + idx * PHASE_GAP_X;
  });

  // 2. 构建分支树，递归分配行号
  const childrenMap: Record<string, string[]> = {};
  graph.branches.forEach((b) => {
    if (b.parentId) {
      if (!childrenMap[b.parentId]) childrenMap[b.parentId] = [];
      childrenMap[b.parentId].push(b.id);
    }
  });

  function countDescendants(branchId: string): number {
    const children = childrenMap[branchId] || [];
    let count = 0;
    for (const childId of children) {
      count += 1 + countDescendants(childId);
    }
    return count;
  }

  const branchRowMap: Record<string, number> = {};
  function assignRows(branchId: string, startRow: number): number {
    branchRowMap[branchId] = startRow;
    const children = childrenMap[branchId] || [];
    let currentRow = startRow + 1;
    for (const childId of children) {
      const desc = countDescendants(childId);
      assignRows(childId, currentRow);
      currentRow += desc + 1;
    }
    return currentRow;
  }

  const rootBranches = graph.branches.filter((b) => !b.parentId);
  let nextRow = 0;
  for (const root of rootBranches) {
    nextRow = assignRows(root.id, nextRow);
  }

  // 3. 节点定位
  for (const node of graph.nodes) {
    const row = branchRowMap[node.branchId] ?? 0;

    // 同分支同阶段的节点均匀分布
    const siblings = graph.nodes.filter(
      (n) => n.branchId === node.branchId && n.phaseIndex === node.phaseIndex,
    );
    const sibIdx = siblings.indexOf(node);
    const totalSiblings = siblings.length;

    const yOffset = totalSiblings > 1
      ? sibIdx * NODE_GAP_Y - ((totalSiblings - 1) * NODE_GAP_Y) / 2
      : 0;

    // 同阶段多分支的横向偏移
    const branchPhaseNodes = graph.nodes.filter(
      (n) => n.phaseIndex === node.phaseIndex,
    );
    const branchPhaseIdx = branchPhaseNodes.findIndex((n) => n.id === node.id);
    const xOffset = branchPhaseIdx > 0 ? branchPhaseIdx * NODE_GAP_X : 0;

    node.position = {
      x: phaseX[node.phaseIndex] ?? MARGIN_X + xOffset,
      y: MARGIN_Y + row * BRANCH_GAP_Y + yOffset,
    };
  }

  return graph;
}

/** 自动布局 */
export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    episodesId: z.number(),
  }),
  async (req, res) => {
    const { projectId, episodesId } = req.body;

    try {
      const row = await u
        .db("o_agentWorkData")
        .where("projectId", String(projectId))
        .andWhere("episodesId", String(episodesId))
        .andWhere("key", "canvasGraph")
        .first();

      if (!row?.data) {
        return res.status(404).send(error("画布数据不存在"));
      }

      const graph = JSON.parse(row.data) as FlowGraphV2;

      if (graph.meta?.version !== "2") {
        return res.status(400).send(error("仅支持 v2 格式的 FlowGraph 自动布局"));
      }

      applyTreeLayout(graph);
      graph.meta.updatedAt = Date.now();

      await u
        .db("o_agentWorkData")
        .where("id", row.id)
        .update({ data: JSON.stringify(graph), updateTime: Date.now() });

      broadcastToProject(projectId, "graph:layout", {
        nodes: graph.nodes.map((n) => ({ id: n.id, position: n.position })),
        timestamp: Date.now(),
      });

      return res.status(200).send(success({ nodes: graph.nodes.map((n) => ({ id: n.id, position: n.position })) }));
    } catch (err) {
      console.error("[v2/canvas/layout] 自动布局失败:", err);
      return res.status(500).send(error("自动布局失败"));
    }
  },
);
