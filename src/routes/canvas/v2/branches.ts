import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { broadcastToProject } from "@/utils/ws";
import type { FlowGraphV2, FlowBranchV2 } from "@/types/flowgraph-v2";

const router = express.Router();

async function loadGraph(projectId: number, episodesId: number): Promise<FlowGraphV2 | null> {
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

async function saveGraph(projectId: number, episodesId: number, graph: FlowGraphV2): Promise<void> {
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
    });
  } else {
    await u
      .db("o_agentWorkData")
      .where("id", existing.id)
      .update({ data: JSON.stringify(graph), updateTime: Date.now() });
  }
}

/** 创建分支 */
router.post(
  "/",
  validateFields({
    projectId: z.number(),
    episodesId: z.number(),
    branch: z.object({
      id: z.string().optional(),
      label: z.string(),
      parentId: z.string().optional(),
      parentNodeId: z.string().optional(),
      forkReason: z.string().optional(),
    }),
  }),
  async (req, res) => {
    const { projectId, episodesId, branch: branchInput } = req.body;

    try {
      const graph = await loadGraph(projectId, episodesId);
      if (!graph) {
        return res.status(404).send(error("画布数据不存在，请先保存 v2 FlowGraph"));
      }

      const now = Date.now();
      const branch: FlowBranchV2 = {
        id: branchInput.id || `branch-${now}-${Math.random().toString(36).slice(2, 8)}`,
        label: branchInput.label,
        parentId: branchInput.parentId || graph.branches[0]?.id,
        parentNodeId: branchInput.parentNodeId,
        status: "draft",
        forkReason: branchInput.forkReason,
        createdAt: now,
        updatedAt: now,
      };

      if (branch.parentId) {
        const parentExists = graph.branches.some((b) => b.id === branch.parentId);
        if (!parentExists) {
          return res.status(400).send(error(`父分支 ${branch.parentId} 不存在`));
        }
      }

      if (graph.branches.some((b) => b.id === branch.id)) {
        return res.status(409).send(error(`分支 ${branch.id} 已存在`));
      }

      graph.branches.push(branch);
      await saveGraph(projectId, episodesId, graph);

      broadcastToProject(projectId, "branch:created", { branch });
      return res.status(200).send(success({ branch }));
    } catch (err) {
      console.error("[v2/canvas/branches] 创建分支失败:", err);
      return res.status(500).send(error("创建分支失败"));
    }
  },
);

/** 更新分支状态 */
router.patch(
  "/:branchId",
  validateFields({
    projectId: z.number(),
    episodesId: z.number(),
    updates: z.object({
      label: z.string().optional(),
      status: z.enum(["draft", "active", "paused", "completed", "archived", "rejected"]).optional(),
      forkReason: z.string().optional(),
      metadata: z.record(z.string(), z.any()).optional(),
    }),
  }),
  async (req, res) => {
    const { projectId, episodesId, updates } = req.body;
    const { branchId } = req.params;

    try {
      const graph = await loadGraph(projectId, episodesId);
      if (!graph) {
        return res.status(404).send(error("画布数据不存在"));
      }

      const branchIdx = graph.branches.findIndex((b) => b.id === branchId);
      if (branchIdx === -1) {
        return res.status(404).send(error(`分支 ${branchId} 不存在`));
      }

      const changedFields = Object.keys(updates);
      Object.assign(graph.branches[branchIdx], updates, { updatedAt: Date.now() });
      await saveGraph(projectId, episodesId, graph);

      broadcastToProject(projectId, "branch:updated", {
        branch: graph.branches[branchIdx],
        changedFields,
      });
      return res.status(200).send(success({ branch: graph.branches[branchIdx] }));
    } catch (err) {
      console.error("[v2/canvas/branches] 更新分支失败:", err);
      return res.status(500).send(error("更新分支失败"));
    }
  },
);

/** 删除分支（级联删除 nodes + links） */
router.delete(
  "/:branchId",
  validateFields({
    projectId: z.number(),
    episodesId: z.number(),
  }, "query"),
  async (req, res) => {
    const projectId = Number(req.query.projectId);
    const episodesId = Number(req.query.episodesId);
    const { branchId } = req.params;

    try {
      const graph = await loadGraph(projectId, episodesId);
      if (!graph) {
        return res.status(404).send(error("画布数据不存在"));
      }

      const branchIdx = graph.branches.findIndex((b) => b.id === branchId);
      if (branchIdx === -1) {
        return res.status(404).send(error(`分支 ${branchId} 不存在`));
      }

      if (branchId === "main") {
        return res.status(400).send(error("不能删除 main 分支"));
      }

      const removedNodeIds = graph.nodes.filter((n) => n.branchId === branchId).map((n) => n.id);
      const removedLinkIds = graph.links.filter((l) => l.branchId === branchId).map((l) => l.id);

      graph.branches.splice(branchIdx, 1);
      graph.nodes = graph.nodes.filter((n) => n.branchId !== branchId);
      graph.links = graph.links.filter((l) => l.branchId !== branchId);
      await saveGraph(projectId, episodesId, graph);

      broadcastToProject(projectId, "branch:deleted", { branchId, removedNodeIds, removedLinkIds });
      return res.status(200).send(success({ branchId, removedNodeIds, removedLinkIds }));
    } catch (err) {
      console.error("[v2/canvas/branches] 删除分支失败:", err);
      return res.status(500).send(error("删除分支失败"));
    }
  },
);

export default router;
