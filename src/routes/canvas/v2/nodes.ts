import express from "express";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { broadcastToProject } from "@/utils/ws";
import type { FlowNodeV2 } from "@/types/flowgraph-v2";
import {
  upsertNode,
  deleteNode,
  listNodes,
  touchMeta,
  ensureMeta,
} from "@/lib/canvasRelationalStore";
import { processNodePayloadThumbnail } from "@/lib/thumbnail";
import { validateNodeData } from "@/lib/canvasAssetSchema";

const router = express.Router();

const NODE_TYPE_ENUM = [
  "script", "asset", "storyboard", "video", "audio",
  "3d", "variant", "reference", "upscale", "face_restore",
  "suggestion", "zone", "phase",
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

/** 创建节点 — relational UPSERT (O(1) single row) */
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
      await ensureMeta({ projectId, episodesId });

      const node: FlowNodeV2 = {
        ...nodeInput,
        id: nodeInput.id || `node-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      } as FlowNodeV2;

      // Structured params enforcement
      const validationError = validateNodeData(node.type, node.data || {});
      if (validationError) {
        return res.status(400).send(error(
          `节点 ${node.id} 结构化参数不完整: ${validationError}`,
        ));
      }

      // Check for existing
      const existing = await listNodes({ projectId, episodesId });
      if (existing.some((n) => n.id === node.id)) {
        return res.status(409).send(error(`节点 ${node.id} 已存在`));
      }

      // 缩略图
      try {
        await processNodePayloadThumbnail(node.data as Record<string, unknown>);
      } catch (thumbErr) {
        console.warn("[v2/canvas/nodes] 缩略图生成失败，继续:", thumbErr);
      }

      await upsertNode({ projectId, episodesId }, node);
      await touchMeta({ projectId, episodesId });

      broadcastToProject(projectId, "node:created", { node });
      return res.status(200).send(success({ node }));
    } catch (err) {
      console.error("[v2/canvas/nodes] 创建节点失败:", err);
      return res.status(500).send(error("创建节点失败"));
    }
  },
);

/** 批量创建/更新节点 — each node is a single-row UPSERT */
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
      await ensureMeta({ projectId, episodesId });
      const existing = await listNodes({ projectId, episodesId });
      const existingIds = new Set(existing.map((n) => n.id));

      const added: FlowNodeV2[] = [];
      const updated: FlowNodeV2[] = [];

      for (const nodeInput of nodeInputs) {
        // 缩略图
        try {
          await processNodePayloadThumbnail(nodeInput.data as Record<string, unknown>);
        } catch {
          /* skip */
        }
        await upsertNode({ projectId, episodesId }, nodeInput as FlowNodeV2);
        if (existingIds.has(nodeInput.id)) {
          updated.push(nodeInput as FlowNodeV2);
        } else {
          added.push(nodeInput as FlowNodeV2);
        }
      }

      await touchMeta({ projectId, episodesId });

      for (const node of added) broadcastToProject(projectId, "node:created", { node });
      for (const node of updated) broadcastToProject(projectId, "node:updated", { node });

      return res.status(200).send(
        success({ added: added.length, updated: updated.length, nodes: [...added, ...updated] }),
      );
    } catch (err) {
      console.error("[v2/canvas/nodes/batch] 批量操作失败:", err);
      return res.status(500).send(error("批量操作失败"));
    }
  },
);

/** 更新节点 — single-row UPDATE (no full-graph load needed) */
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
      await ensureMeta({ projectId, episodesId });
      const existing = await listNodes({ projectId, episodesId });
      const node = existing.find((n) => n.id === nodeId);
      if (!node) {
        return res.status(404).send(error(`节点 ${nodeId} 不存在`));
      }

      // Merge updates into the node
      try {
        await processNodePayloadThumbnail(updates);
      } catch (thumbErr) {
        console.warn("[v2/canvas/nodes] 缩略图生成失败，继续:", thumbErr);
      }

      const merged = { ...node, ...updates } as FlowNodeV2;
      await upsertNode({ projectId, episodesId }, merged);
      await touchMeta({ projectId, episodesId });

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

/** 删除节点（级联删除关联 links） — single-row DELETE */
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
      await ensureMeta({ projectId, episodesId });
      const existing = await listNodes({ projectId, episodesId });
      if (!existing.some((n) => n.id === nodeId)) {
        return res.status(404).send(error(`节点 ${nodeId} 不存在`));
      }

      await deleteNode({ projectId, episodesId }, nodeId);
      await touchMeta({ projectId, episodesId });

      broadcastToProject(projectId, "node:deleted", { nodeId });
      return res.status(200).send(success({ nodeId }));
    } catch (err) {
      console.error("[v2/canvas/nodes] 删除节点失败:", err);
      return res.status(500).send(error("删除节点失败"));
    }
  },
);

export default router;
