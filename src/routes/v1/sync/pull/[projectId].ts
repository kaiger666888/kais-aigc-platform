import express from "express";
import u from "@/utils";
import { success } from "@/lib/responseFormat";
const router = express.Router();

// 拉取后端变更
export default router.get("/:projectId", async (req, res) => {
  const { projectId } = req.params;
  const since = Number(req.query.since) || 0;

  const events = await u.db("kv_syncEvent")
    .where("projectId", Number(projectId))
    .andWhere("timestamp", ">", since)
    .orderBy("timestamp", "asc")
    .select("*");

  // payload 反序列化
  const result = events.map((e: any) => ({
    ...e,
    payload: typeof e.payload === "string" ? JSON.parse(e.payload) : e.payload,
  }));

  res.status(200).send(success({ events: result }));
});
