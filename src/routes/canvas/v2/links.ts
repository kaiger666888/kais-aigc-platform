import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { broadcastToProject } from "@/utils/ws";
import type { FlowGraphV2, FlowLinkV2 } from "@/types/flowgraph-v2";

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

/** 创建连线 */
router.post(
  "/",
  validateFields({
    projectId: z.number(),
    episodesId: z.number(),
    link: z.object({
      id: z.string().optional(),
      source: z.string(),
      target: z.string(),
      branchId: z.string(),
      dataType: z.string(),
      isExplore: z.boolean().optional(),
      isInactive: z.boolean().optional(),
    }),
  }),
  async (req, res) => {
    const { projectId, episodesId, link: linkInput } = req.body;

    try {
      const graph = await loadGraph(projectId, episodesId);
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

      graph.links.push(link);
      await saveGraph(projectId, episodesId, graph);

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
    const { linkId } = req.params;

    try {
      const graph = await loadGraph(projectId, episodesId);
      if (!graph) {
        return res.status(404).send(error("画布数据不存在"));
      }

      const linkIdx = graph.links.findIndex((l) => l.id === linkId);
      if (linkIdx === -1) {
        return res.status(404).send(error(`连线 ${linkId} 不存在`));
      }

      graph.links.splice(linkIdx, 1);
      await saveGraph(projectId, episodesId, graph);

      broadcastToProject(projectId, "link:deleted", { linkId });
      return res.status(200).send(success({ linkId }));
    } catch (err) {
      console.error("[v2/canvas/links] 删除连线失败:", err);
      return res.status(500).send(error("删除连线失败"));
    }
  },
);

export default router;
