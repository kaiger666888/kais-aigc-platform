import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

/** 加载画布图 */
export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    episodesId: z.number(),
  }),
  async (req, res) => {
    const { projectId, episodesId } = req.body;

    try {
      const row = await u
        .db("o_agentWorkData")
        .where("projectId", String(projectId))
        .andWhere("episodesId", String(episodesId))
        .andWhere("key", "canvasGraph")
        .first();

      if (!row?.data) {
        return res.status(200).send(success(null));
      }

      const graph = JSON.parse(row.data);
      return res.status(200).send(success(graph));
    } catch (err) {
      console.error("[canvas:load] 加载画布失败:", err);
      return res.status(500).send(error("加载画布失败"));
    }
  },
);
