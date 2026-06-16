import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { broadcastToProject } from "@/utils/ws";
import { FlowGraphV2Schema } from "@/types/flowgraph-v2-schema";
import type { FlowGraphV2 } from "@/types/flowgraph-v2";

const router = express.Router();

/** 保存 v2 FlowGraph（全量覆盖） */
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
      const parseResult = FlowGraphV2Schema.safeParse(graph);
      if (!parseResult.success) {
        return res.status(400).send(error("FlowGraph v2 格式校验失败", parseResult.error.issues));
      }

      const validGraph = parseResult.data as FlowGraphV2;
      validGraph.meta.projectId = projectId;
      validGraph.meta.episodesId = episodesId;
      validGraph.meta.updatedAt = Date.now();

      const existing = await u
        .db("o_agentWorkData")
        .where("projectId", String(projectId))
        .andWhere("episodesId", String(episodesId))
        .andWhere("key", "canvasGraph")
        .first();

      if (!existing) {
        await u.db("o_agentWorkData").insert({
          projectId,
          episodesId,
          key: "canvasGraph",
          data: JSON.stringify(validGraph),
        });
      } else {
        await u
          .db("o_agentWorkData")
          .where("id", existing.id)
          .update({ data: JSON.stringify(validGraph), updateTime: Date.now() });
      }

      broadcastToProject(projectId, "graph:saved", { projectId, episodesId, timestamp: Date.now() });
      return res.status(200).send(success());
    } catch (err) {
      console.error("[v2/canvas/save] 保存画布失败:", err);
      return res.status(500).send(error("保存画布失败"));
    }
  },
);
