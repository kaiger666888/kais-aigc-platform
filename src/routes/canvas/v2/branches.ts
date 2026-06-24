import express from "express";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { broadcastToProject } from "@/utils/ws";
import type { FlowBranchV2 } from "@/types/flowgraph-v2";
import { appendAndSync, ensureBootstrap, loadGraph as loadGraphFromStore } from "@/lib/canvasEventStore";

const router = express.Router();

function legacyClientId(operation: string, projectId: number, episodesId: number): string {
  return `legacy:branches:${operation}:${projectId}:${episodesId}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
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
      await ensureBootstrap(projectId, episodesId);
      const graph = await loadGraphFromStore(projectId, episodesId);
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

      const { id, ...payload } = branch;
      await appendAndSync({
        projectId,
        episodesId,
        clientId: legacyClientId("create", projectId, episodesId),
        source: "canvas-ui",
        events: [{ type: "branch_upsert", nodeId: id, payload }],
      });

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
    const branchId = String(req.params.branchId);

    try {
      await ensureBootstrap(projectId, episodesId);
      const graph = await loadGraphFromStore(projectId, episodesId);
      if (!graph) {
        return res.status(404).send(error("画布数据不存在"));
      }

      const existing = graph.branches.find((b) => b.id === branchId);
      if (!existing) {
        return res.status(404).send(error(`分支 ${branchId} 不存在`));
      }

      const changedFields = Object.keys(updates);
      const payload = { ...updates, updatedAt: Date.now() };
      await appendAndSync({
        projectId,
        episodesId,
        clientId: legacyClientId("update", projectId, episodesId),
        source: "canvas-ui",
        events: [{ type: "branch_upsert", nodeId: branchId, payload }],
      });

      const merged = { ...existing, ...payload } as FlowBranchV2;
      broadcastToProject(projectId, "branch:updated", {
        branch: merged,
        changedFields,
      });
      return res.status(200).send(success({ branch: merged }));
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
    const branchId = String(req.params.branchId);

    try {
      await ensureBootstrap(projectId, episodesId);
      const graph = await loadGraphFromStore(projectId, episodesId);
      if (!graph) {
        return res.status(404).send(error("画布数据不存在"));
      }

      if (!graph.branches.some((b) => b.id === branchId)) {
        return res.status(404).send(error(`分支 ${branchId} 不存在`));
      }

      if (branchId === "main") {
        return res.status(400).send(error("不能删除 main 分支"));
      }

      const removedNodeIds = graph.nodes.filter((n) => n.branchId === branchId).map((n) => n.id);
      const removedLinkIds = graph.links.filter((l) => l.branchId === branchId).map((l) => l.id);

      const events = [
        { type: "branch_delete" as const, nodeId: branchId, payload: null },
        ...removedNodeIds.map((id: string) => ({ type: "node_delete" as const, nodeId: id, payload: null })),
        ...removedLinkIds.map((id: string) => ({ type: "link_delete" as const, nodeId: id, payload: null })),
      ];

      await appendAndSync({
        projectId,
        episodesId,
        clientId: legacyClientId("delete", projectId, episodesId),
        source: "canvas-ui",
        events,
      });

      broadcastToProject(projectId, "branch:deleted", { branchId, removedNodeIds, removedLinkIds });
      return res.status(200).send(success({ branchId, removedNodeIds, removedLinkIds }));
    } catch (err) {
      console.error("[v2/canvas/branches] 删除分支失败:", err);
      return res.status(500).send(error("删除分支失败"));
    }
  },
);

export default router;
