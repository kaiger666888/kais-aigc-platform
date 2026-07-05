import express from "express";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { broadcastToProject } from "@/utils/ws";
import { saveFullGraph } from "@/lib/canvasRelationalStore";
import type { FlowGraphV2, FlowNodeV2, FlowLinkV2 } from "@/types/flowgraph-v2";

const router = express.Router();

/**
 * 保存画布图 (v1 — 前端实际调用入口)
 *
 * Accepts v1 format graph ({ nodes, links/edges }) and normalizes to v2
 * before writing to relational tables. Maintains backward compatibility
 * with the frontend while using the new relational backend.
 */
export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    episodesId: z.number(),
    graph: z.any(),
  }),
  async (req, res) => {
    const { projectId, episodesId, graph } = req.body;

    try {
      const now = Date.now();

      // Normalize v1 → v2
      const v1Nodes = graph.nodes || [];
      const v1Links = graph.links || graph.edges || [];

      const nodes: FlowNodeV2[] = v1Nodes.map((n: any) => ({
        id: n.id,
        type: (n.type || "script") as FlowNodeV2["type"],
        branchId: n.branchId || n.data?.branchId || "main",
        phaseIndex: n.phaseIndex ?? 0,
        phaseName: n.phaseName ?? n.data?.phaseName ?? "",
        position: n.position || { x: 0, y: 0 },
        size: n.size || { width: 260, height: 180 },
        data: n.data || {},
        state: (n.state || n.data?.state || "idle") as FlowNodeV2["state"],
      }));

      const links: FlowLinkV2[] = v1Links.map((l: any) => ({
        id: l.id,
        source: l.source,
        target: l.target,
        branchId: l.branchId || "main",
        dataType: l.dataType || l.type || "text",
      }));

      const v2Graph: FlowGraphV2 = {
        meta: {
          version: "2",
          projectId,
          episodesId,
          createdAt: now,
          updatedAt: now,
        },
        nodes,
        links,
        branches: [{
          id: "main",
          label: "主线",
          status: "active" as const,
          createdAt: now,
          updatedAt: now,
        }],
        variantGroups: [],
      };

      await saveFullGraph({ projectId, episodesId }, v2Graph);

      broadcastToProject(projectId, "graph:saved", { projectId, episodesId, timestamp: now });
      return res.status(200).send(success());
    } catch (err) {
      console.error("[canvas:save] 保存画布失败:", err);
      return res.status(500).send(error("保存画布失败"));
    }
  },
);
