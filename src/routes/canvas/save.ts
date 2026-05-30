import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

/** 保存画布图（FlowGraph JSON） */
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
      // 在 o_agentWorkData 中以 canvasGraph key 保存
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
          data: JSON.stringify(graph),
        });
      } else {
        await u
          .db("o_agentWorkData")
          .where("id", existing.id)
          .update({
            data: JSON.stringify(graph),
            updateTime: Date.now(),
          });
      }

      return res.status(200).send(success());
    } catch (err) {
      console.error("[canvas:save] 保存画布失败:", err);
      return res.status(500).send(error("保存画布失败"));
    }
  },
);
