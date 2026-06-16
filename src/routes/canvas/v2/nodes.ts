import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { broadcastToProject } from "@/utils/ws";
import type { FlowGraphV2, FlowNodeV2 } from "@/types/flowgraph-v2";
import { FlowGraphV2Schema } from "@/types/flowgraph-v2-schema";

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

/** 创建节点 */
router.post(
  "/",
  validateFields({
    projectId: z.number(),
    episodesId: z.number(),
    node: z.object({
      id: z.string().optional(),
      type: z.enum([
        "script", "asset", "storyboard", "video", "audio",
        "3d", "variant", "reference", "upscale", "face_restore",
        "suggestion",
      ]),
      branchId: z.string(),
      phaseIndex: z.number().int().min(0),
      phaseName: z.string(),
      position: z.object({ x: z.number(), y: z.number() }),
      size: z.object({ width: z.number(), height: z.number() }),
      data: z.record(z.string(), z.any()),
      state: z.enum(["idle", "pending", "running", "success", "error", "skipped"]),
      reviewStatus: z.enum(["pending", "approved", "rejected"]).optional(),
      aiScore: z.any().optional(),
      isWinner: z.boolean().optional(),
      rejectReason: z.string().optional(),
      suggestion: z.string().optional(),
      variantOf: z.string().optional(),
      variantGroupId: z.string().optional(),
    }),
  }),
  async (req, res) => {
    const { projectId, episodesId, node: nodeInput } = req.body;

    try {
      const graph = await loadGraph(projectId, episodesId);
      if (!graph) {
        return res.status(404).send(error("画布数据不存在，请先保存 v2 FlowGraph"));
      }

      const branchExists = graph.branches.some((b) => b.id === nodeInput.branchId);
      if (!branchExists) {
        return res.status(400).send(error(`分支 ${nodeInput.branchId} 不存在`));
      }

      const node: FlowNodeV2 = {
        ...nodeInput,
        id: nodeInput.id || `node-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      } as FlowNodeV2;

      if (graph.nodes.some((n) => n.id === node.id)) {
        return res.status(409).send(error(`节点 ${node.id} 已存在`));
      }

      graph.nodes.push(node);
      await saveGraph(projectId, episodesId, graph);

      broadcastToProject(projectId, "node:created", { node });
      return res.status(200).send(success({ node }));
    } catch (err) {
      console.error("[v2/canvas/nodes] 创建节点失败:", err);
      return res.status(500).send(error("创建节点失败"));
    }
  },
);

/** 批量创建/更新节点（upsert） */
router.patch(
  "/batch",
  validateFields({
    projectId: z.number(),
    episodesId: z.number(),
    nodes: z
      .array(
        z.object({
          id: z.string(),
          type: z.enum([
            "script", "asset", "storyboard", "video", "audio",
            "3d", "variant", "reference", "upscale", "face_restore",
            "suggestion",
          ]),
          branchId: z.string(),
          phaseIndex: z.number().int().min(0),
          phaseName: z.string(),
          position: z.object({ x: z.number(), y: z.number() }),
          size: z.object({ width: z.number(), height: z.number() }),
          data: z.record(z.string(), z.any()),
          state: z.enum(["idle", "pending", "running", "success", "error", "skipped"]),
          reviewStatus: z.enum(["pending", "approved", "rejected"]).optional(),
          aiScore: z.any().optional(),
          isWinner: z.boolean().optional(),
          rejectReason: z.string().optional(),
          suggestion: z.string().optional(),
          variantOf: z.string().optional(),
          variantGroupId: z.string().optional(),
        }),
      )
      .min(1),
  }),
  async (req, res) => {
    const { projectId, episodesId, nodes: nodeInputs } = req.body;

    try {
      const graph = await loadGraph(projectId, episodesId);
      if (!graph) {
        return res.status(404).send(error("画布数据不存在，请先保存 v2 FlowGraph"));
      }

      const branchIds = new Set(graph.branches.map((b) => b.id));
      for (const nodeInput of nodeInputs) {
        if (!branchIds.has(nodeInput.branchId)) {
          return res.status(400).send(error(`分支 ${nodeInput.branchId} 不存在`));
        }
      }

      const added: FlowNodeV2[] = [];
      const updated: FlowNodeV2[] = [];

      for (const nodeInput of nodeInputs) {
        const existingIdx = graph.nodes.findIndex((n) => n.id === nodeInput.id);
        if (existingIdx >= 0) {
          Object.assign(graph.nodes[existingIdx], nodeInput);
          updated.push(graph.nodes[existingIdx]);
          broadcastToProject(projectId, "node:updated", {
            node: graph.nodes[existingIdx],
            changedFields: Object.keys(nodeInput),
          });
        } else {
          const node: FlowNodeV2 = { ...nodeInput } as FlowNodeV2;
          graph.nodes.push(node);
          added.push(node);
          broadcastToProject(projectId, "node:created", { node });
        }
      }

      await saveGraph(projectId, episodesId, graph);

      return res.status(200).send(
        success({
          added: added.length,
          updated: updated.length,
          nodes: [...added, ...updated],
        }),
      );
    } catch (err) {
      console.error("[v2/canvas/nodes/batch] 批量操作失败:", err);
      return res.status(500).send(error("批量操作失败"));
    }
  },
);

/** 更新节点 */
router.patch(
  "/:nodeId",
  validateFields({
    projectId: z.number(),
    episodesId: z.number(),
    updates: z.record(z.string(), z.any()),
  }),
  async (req, res) => {
    const { projectId, episodesId, updates } = req.body;
    const { nodeId } = req.params;

    try {
      const graph = await loadGraph(projectId, episodesId);
      if (!graph) {
        return res.status(404).send(error("画布数据不存在"));
      }

      const nodeIdx = graph.nodes.findIndex((n) => n.id === nodeId);
      if (nodeIdx === -1) {
        return res.status(404).send(error(`节点 ${nodeId} 不存在`));
      }

      const changedFields = Object.keys(updates);
      Object.assign(graph.nodes[nodeIdx], updates);
      await saveGraph(projectId, episodesId, graph);

      broadcastToProject(projectId, "node:updated", {
        node: graph.nodes[nodeIdx],
        changedFields,
      });
      return res.status(200).send(success({ node: graph.nodes[nodeIdx] }));
    } catch (err) {
      console.error("[v2/canvas/nodes] 更新节点失败:", err);
      return res.status(500).send(error("更新节点失败"));
    }
  },
);

/** 删除节点（级联删除关联 links） */
router.delete(
  "/:nodeId",
  validateFields({
    projectId: z.number(),
    episodesId: z.number(),
  }, "query"),
  async (req, res) => {
    const projectId = Number(req.query.projectId);
    const episodesId = Number(req.query.episodesId);
    const { nodeId } = req.params;

    try {
      const graph = await loadGraph(projectId, episodesId);
      if (!graph) {
        return res.status(404).send(error("画布数据不存在"));
      }

      const nodeIdx = graph.nodes.findIndex((n) => n.id === nodeId);
      if (nodeIdx === -1) {
        return res.status(404).send(error(`节点 ${nodeId} 不存在`));
      }

      const removedLinkIds = graph.links
        .filter((l) => l.source === nodeId || l.target === nodeId)
        .map((l) => l.id);

      graph.nodes.splice(nodeIdx, 1);
      graph.links = graph.links.filter((l) => l.source !== nodeId && l.target !== nodeId);
      await saveGraph(projectId, episodesId, graph);

      broadcastToProject(projectId, "node:deleted", { nodeId, removedLinkIds });
      return res.status(200).send(success({ nodeId, removedLinkIds }));
    } catch (err) {
      console.error("[v2/canvas/nodes] 删除节点失败:", err);
      return res.status(500).send(error("删除节点失败"));
    }
  },
);

export default router;
