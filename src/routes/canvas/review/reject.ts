import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { broadcastToProject } from "@/utils/ws";
import { patchNodeInGraph } from "../v2/graph-helpers";
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

      // 同步回写 FlowGraph node（v2 数据一致性）
      try {
        await patchNodeInGraph(projectId, episodesId, nodeId, {
          reviewStatus: "rejected",
          suggestion: reason,
          rejectReason: reason,
        });
      } catch (graphErr) {
        console.warn("[canvas:review/reject] FlowGraph 回写失败（reviewStatus 表已写入）:", graphErr);
      }

      // 写入 kv_assetFeedback 表（闭环必须）—— collectFeedback() 从此表读取，
      // 不写则 reject 信号无法传播到 iteration engine。
      try {
        const fbId = `fb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        await u.db("kv_assetFeedback").insert({
          id: fbId,
          assetId: nodeId,
          projectId,
          score: null,
          verdict: "reject",
          content: reason,
          tags: JSON.stringify(["canvas-reject"]),
          source: "human",
          reviewer: "canvas-user",
          context: JSON.stringify({ episodesId, reviewStatus: "rejected" }),
          status: "open",
          createdAt: Date.now(),
          resolvedAt: null,
        });
      } catch (fbErr) {
        console.warn("[canvas:review/reject] kv_assetFeedback 写入失败（reviewStatus 已写入）:", fbErr);
      }

      broadcastToProject(projectId, "review:rejected", {
        nodeId,
        reason,
        timestamp: Date.now(),
      });

      return res.status(200).send(success());
    } catch (err) {
      console.error("[canvas:review/reject] 驳回失败:", err);
      return res.status(500).send(error("审核操作失败"));
    }
  },
);
