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
    project_id: z.string(),
    event_graph: z.any(), // 事件图谱 JSON
    character_assets: z.array(z.any()).optional(),
  }),
  async (req, res) => {
    const { project_id, event_graph, character_assets } = req.body;

    const batchId = Date.now();
    const graphJson = typeof event_graph === "string" ? event_graph : JSON.stringify(event_graph);

    // 存储 graphData 以便后续处理
    await u.db("kv_shotGraph").insert({
      id: batchId,
      projectId: project_id,
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
