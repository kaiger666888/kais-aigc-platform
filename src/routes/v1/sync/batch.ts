import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

// 批量同步画布事件
export default router.post(
  "/",
  validateFields({
    project_id: z.string(),
    client_seq: z.number().optional(),
    events: z.array(
      z.object({
        type: z.string(),
        node_id: z.string().optional(),
        payload: z.any().optional(),
        timestamp: z.number(),
      }),
    ),
  }),
  async (req, res) => {
    const { project_id, events } = req.body;

    const syncId = Date.now();
    const rows = events.map((ev: any, i: number) => ({
      id: syncId + i,
      projectId: project_id,
      type: ev.type,
      nodeId: ev.node_id || null,
      payload: typeof ev.payload === "string" ? ev.payload : JSON.stringify(ev.payload || {}),
      timestamp: ev.timestamp,
      createTime: Date.now(),
    }));

    await u.db("kv_syncEvent").insert(rows);

    res.status(200).send(
      success({
        syncId,
        count: rows.length,
        message: "批量同步成功",
      }),
    );
  },
);
