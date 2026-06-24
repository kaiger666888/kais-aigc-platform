import express from "express";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { broadcastToProject } from "@/utils/ws";
import type { FlowLinkV2 } from "@/types/flowgraph-v2";
import { appendAndSync, ensureBootstrap, loadGraph as loadGraphFromStore } from "@/lib/canvasEventStore";

const router = express.Router();

function legacyClientId(operation: string, projectId: number, episodesId: number): string {
  return `legacy:links:${operation}:${projectId}:${episodesId}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
}

const linkInputSchema = z.object({
  id: z.string().optional(),
  source: z.string(),
  target: z.string(),
  branchId: z.string(),
  dataType: z.string(),
  isExplore: z.boolean().optional(),
  isInactive: z.boolean().optional(),
});

/** 创建连线 */
router.post(
  "/",
  validateFields({
    projectId: z.number(),
    episodesId: z.number(),
    link: linkInputSchema,
  }),
  async (req, res) => {
    const { projectId, episodesId, link: linkInput } = req.body;

    try {
      await ensureBootstrap(projectId, episodesId);
      const graph = await loadGraphFromStore(projectId, episodesId);
      if (!graph) {
        return res.status(404).send(error("画布数据不存在，请先保存 v2 FlowGraph"));
      }

      const sourceNode = graph.nodes.find((n) => n.id === linkInput.source);
      const targetNode = graph.nodes.find((n) => n.id === linkInput.target);
      if (!sourceNode) {
        return res.status(400).send(error(`源节点 ${linkInput.source} 不存在`));
      }
      if (!targetNode) {
        return res.status(400).send(error(`目标节点 ${linkInput.target} 不存在`));
      }

      const link: FlowLinkV2 = {
        ...linkInput,
        id: linkInput.id || `link-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      } as FlowLinkV2;

      if (graph.links.some((l) => l.id === link.id)) {
        return res.status(409).send(error(`连线 ${link.id} 已存在`));
      }

      const { id, ...payload } = link;
      await appendAndSync({
        projectId,
        episodesId,
        clientId: legacyClientId("create", projectId, episodesId),
        source: "canvas-ui",
        events: [{ type: "link_upsert", nodeId: id, payload }],
      });

      broadcastToProject(projectId, "link:created", { link });
      return res.status(200).send(success({ link }));
    } catch (err) {
      console.error("[v2/canvas/links] 创建连线失败:", err);
      return res.status(500).send(error("创建连线失败"));
    }
  },
);

/** 删除连线 */
router.delete(
  "/:linkId",
  validateFields({
    projectId: z.number(),
    episodesId: z.number(),
  }, "query"),
  async (req, res) => {
    const projectId = Number(req.query.projectId);
    const episodesId = Number(req.query.episodesId);
    const linkId = String(req.params.linkId);

    try {
      await ensureBootstrap(projectId, episodesId);
      const graph = await loadGraphFromStore(projectId, episodesId);
      if (!graph) {
        return res.status(404).send(error("画布数据不存在"));
      }

      if (!graph.links.some((l) => l.id === linkId)) {
        return res.status(404).send(error(`连线 ${linkId} 不存在`));
      }

      await appendAndSync({
        projectId,
        episodesId,
        clientId: legacyClientId("delete", projectId, episodesId),
        source: "canvas-ui",
        events: [{ type: "link_delete", nodeId: linkId, payload: null }],
      });

      broadcastToProject(projectId, "link:deleted", { linkId });
      return res.status(200).send(success({ linkId }));
    } catch (err) {
      console.error("[v2/canvas/links] 删除连线失败:", err);
      return res.status(500).send(error("删除连线失败"));
    }
  },
);

export default router;
