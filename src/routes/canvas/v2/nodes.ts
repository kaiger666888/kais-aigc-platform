import express from "express";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { broadcastToProject } from "@/utils/ws";
import type { FlowNodeV2 } from "@/types/flowgraph-v2";
import { appendAndSync, ensureBootstrap, loadGraph as loadGraphFromStore } from "@/lib/canvasEventStore";
import { processNodePayloadThumbnail } from "@/lib/thumbnail";

const router = express.Router();

function legacyClientId(operation: string, projectId: number, episodesId: number): string {
  return `legacy:nodes:${operation}:${projectId}:${episodesId}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
}

const NODE_TYPE_ENUM = [
  "script", "asset", "storyboard", "video", "audio",
  "3d", "variant", "reference", "upscale", "face_restore",
  "suggestion",
] as const;

const NODE_STATE_ENUM = ["idle", "pending", "running", "success", "error", "skipped"] as const;
const REVIEW_STATUS_ENUM = ["pending", "approved", "rejected"] as const;

const nodeInputSchema = z.object({
  id: z.string(),
  type: z.enum(NODE_TYPE_ENUM),
  branchId: z.string(),
  phaseIndex: z.number().int().min(0),
  phaseName: z.string(),
  position: z.object({ x: z.number(), y: z.number() }),
  size: z.object({ width: z.number(), height: z.number() }),
  data: z.record(z.string(), z.any()),
  state: z.enum(NODE_STATE_ENUM),
  reviewStatus: z.enum(REVIEW_STATUS_ENUM).optional(),
  aiScore: z.any().optional(),
  isWinner: z.boolean().optional(),
  rejectReason: z.string().optional(),
  suggestion: z.string().optional(),
  variantOf: z.string().optional(),
  variantGroupId: z.string().optional(),
});

/** 创建节点 */
router.post(
  "/",
  validateFields({
    projectId: z.number(),
    episodesId: z.number(),
    node: nodeInputSchema.extend({ id: z.string().optional() }),
  }),
  async (req, res) => {
    const { projectId, episodesId, node: nodeInput } = req.body;

    try {
      await ensureBootstrap(projectId, episodesId);
      const graph = await loadGraphFromStore(projectId, episodesId);
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

      const { id, ...payload } = node;
      // 自动为指向原图的 thumbnailUrl 生成压缩缩略图（幂等）
      try {
        await processNodePayloadThumbnail(payload as unknown as Record<string, unknown>);
      } catch (thumbErr) {
        console.warn("[v2/canvas/nodes] 缩略图生成失败，继续:", thumbErr);
      }
      await appendAndSync({
        projectId,
        episodesId,
        clientId: legacyClientId("create", projectId, episodesId),
        source: "canvas-ui",
        events: [{ type: "node_upsert", nodeId: id, payload }],
      });

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
    nodes: z.array(nodeInputSchema).min(1),
  }),
  async (req, res) => {
    const { projectId, episodesId, nodes: nodeInputs } = req.body;

    try {
      await ensureBootstrap(projectId, episodesId);
      const graph = await loadGraphFromStore(projectId, episodesId);
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
      const events = nodeInputs.map((nodeInput: FlowNodeV2) => {
        const existing = graph.nodes.find((n) => n.id === nodeInput.id);
        const { id, ...payload } = nodeInput;
        if (existing) {
          updated.push({ ...existing, ...nodeInput });
        } else {
          added.push(nodeInput);
        }
        return { type: "node_upsert" as const, nodeId: id, payload };
      });

      // 自动为每个节点生成压缩缩略图（幂等；源文件缺失则跳过）
      for (const ev of events) {
        try {
          await processNodePayloadThumbnail(ev.payload as Record<string, unknown>);
        } catch {
          /* 单个节点失败不影响整体保存 */
        }
      }

      await appendAndSync({
        projectId,
        episodesId,
        clientId: legacyClientId("batch", projectId, episodesId),
        source: "canvas-ui",
        events,
      });

      for (const node of added) {
        broadcastToProject(projectId, "node:created", { node });
      }
      for (const node of updated) {
        broadcastToProject(projectId, "node:updated", { node });
      }

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
    const nodeId = String(req.params.nodeId);

    try {
      await ensureBootstrap(projectId, episodesId);
      const graph = await loadGraphFromStore(projectId, episodesId);
      if (!graph) {
        return res.status(404).send(error("画布数据不存在"));
      }

      const existing = graph.nodes.find((n) => n.id === nodeId);
      if (!existing) {
        return res.status(404).send(error(`节点 ${nodeId} 不存在`));
      }

      // 自动为指向原图的 thumbnailUrl 生成压缩缩略图（幂等）
      try {
        await processNodePayloadThumbnail(updates);
      } catch (thumbErr) {
        console.warn("[v2/canvas/nodes] 缩略图生成失败，继续:", thumbErr);
      }

      await appendAndSync({
        projectId,
        episodesId,
        clientId: legacyClientId("update", projectId, episodesId),
        source: "canvas-ui",
        events: [{ type: "node_upsert", nodeId, payload: updates }],
      });

      const merged = { ...existing, ...updates } as FlowNodeV2;
      broadcastToProject(projectId, "node:updated", {
        node: merged,
        changedFields: Object.keys(updates),
      });
      return res.status(200).send(success({ node: merged }));
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
    const nodeId = String(req.params.nodeId);

    try {
      await ensureBootstrap(projectId, episodesId);
      const graph = await loadGraphFromStore(projectId, episodesId);
      if (!graph) {
        return res.status(404).send(error("画布数据不存在"));
      }

      if (!graph.nodes.some((n) => n.id === nodeId)) {
        return res.status(404).send(error(`节点 ${nodeId} 不存在`));
      }

      const removedLinkIds = graph.links
        .filter((l) => l.source === nodeId || l.target === nodeId)
        .map((l) => l.id);

      await appendAndSync({
        projectId,
        episodesId,
        clientId: legacyClientId("delete", projectId, episodesId),
        source: "canvas-ui",
        events: [{ type: "node_delete", nodeId, payload: null }],
      });

      broadcastToProject(projectId, "node:deleted", { nodeId, removedLinkIds });
      return res.status(200).send(success({ nodeId, removedLinkIds }));
    } catch (err) {
      console.error("[v2/canvas/nodes] 删除节点失败:", err);
      return res.status(500).send(error("删除节点失败"));
    }
  },
);

export default router;
