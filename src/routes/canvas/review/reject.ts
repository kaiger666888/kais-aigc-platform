import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

/** 驳回节点 */
export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    episodesId: z.number(),
    nodeId: z.string(),
    reason: z.string(),
  }),
  async (req, res) => {
    const { projectId, episodesId, nodeId, reason } = req.body;

    try {
      const reviewKey = `reviewStatus-${episodesId}`;
      const row = await u
        .db("o_agentWorkData")
        .where("projectId", String(projectId))
        .andWhere("episodesId", String(episodesId))
        .andWhere("key", reviewKey)
        .first();

      let mapping: Record<string, any> = {};
      if (row?.data) {
        mapping = typeof row.data === "string" ? JSON.parse(row.data) : row.data;
      }

      // 更新该节点的驳回状态
      mapping[nodeId] = {
        ...(mapping[nodeId] || {}),
        reviewStatus: "rejected",
        rejectReason: reason,
      };

      if (!row) {
        await u.db("o_agentWorkData").insert({
          projectId,
          episodesId,
          key: reviewKey,
          data: JSON.stringify(mapping),
          createTime: Date.now(),
          updateTime: Date.now(),
        });
      } else {
        await u
          .db("o_agentWorkData")
          .where("id", row.id)
          .update({
            data: JSON.stringify(mapping),
            updateTime: Date.now(),
          });
      }

      return res.status(200).send(success());
    } catch (err) {
      console.error("[canvas:review/reject] 驳回失败:", err);
      return res.status(500).send(error("审核操作失败"));
    }
  },
);
