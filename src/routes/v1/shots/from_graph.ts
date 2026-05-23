import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

// 从事件图谱生成分镜
export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    graphData: z.any(), // 事件图谱 JSON
  }),
  async (req, res) => {
    const { projectId, graphData } = req.body;

    const batchId = Date.now();
    const graphJson = typeof graphData === "string" ? graphData : JSON.stringify(graphData);

    // 存储 graphData 以便后续处理
    await u.db("kv_shotGraph").insert({
      id: batchId,
      projectId,
      graphData: graphJson,
      state: "pending",
      createTime: Date.now(),
    });

    res.status(200).send(
      success({
        batchId,
        state: "pending",
        message: "分镜任务已提交",
      }),
    );
  },
);
