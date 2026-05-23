import express from "express";
import u from "@/utils";
import { success } from "@/lib/responseFormat";
const router = express.Router();

// 获取分镜列表
export default router.get("/:projectId", async (req, res) => {
  const { projectId } = req.params;

  const shots = await u.db("kv_shot")
    .where("projectId", Number(projectId))
    .orderBy("shotIndex", "asc")
    .select("*");

  res.status(200).send(success({ shots }));
});
