import express from "express";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { loadFullGraph } from "@/lib/canvasRelationalStore";

const router = express.Router();

/**
 * 加载画布图 (v1 — 前端实际调用入口)
 *
 * Returns FlowGraph in the v1 shape that the frontend expects
 * ({ nodes, links/edges, viewport }). Internally reads from relational
 * tables (canvas_nodes / canvas_links) and maps to v1 format.
 */
export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    episodesId: z.number(),
  }),
  async (req, res) => {
    const { projectId, episodesId } = req.body;

    try {
      const graph = await loadFullGraph({ projectId, episodesId });

      if (!graph) {
        return res.status(200).send(success(null));
      }

      // Map v2 → v1 shape for frontend compatibility
      // Frontend reads: { nodes, links (or edges), viewport }
      const v1Graph = {
        nodes: graph.nodes.map((n) => ({
          id: n.id,
          type: n.type,
          position: n.position,
          size: n.size,
          data: {
            ...n.data,
            label: n.data?.label || n.phaseName,
            state: n.state,
            phaseName: n.phaseName,
            phaseIndex: n.phaseIndex,
            branchId: n.branchId,
          },
          state: n.state,
          // v1 fields the frontend may read
          ...(n.reviewStatus && { reviewStatus: n.reviewStatus }),
          ...(n.aiScore != null && { aiScore: n.aiScore }),
        })),
        edges: graph.links.map((l) => ({
          id: l.id,
          source: l.source,
          target: l.target,
          type: "smoothstep",
          dataType: l.dataType,
          branchId: l.branchId,
        })),
        links: graph.links.map((l) => ({
          id: l.id,
          source: l.source,
          target: l.target,
          dataType: l.dataType,
          branchId: l.branchId,
        })),
        viewport: graph.meta.viewport,
      };

      return res.status(200).send(success(v1Graph));
    } catch (err) {
      console.error("[canvas:load] 加载画布失败:", err);
      return res.status(500).send(error("加载画布失败"));
    }
  },
);
