import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

// 创建项目 JSON 快照
router.post(
  "/",
  validateFields({
    project_id: z.string(),
    label: z.string().optional(),
  }),
  async (req, res) => {
    const { project_id, label } = req.body;
    const id = Date.now();

    // 收集项目关键数据序列化为快照
    const [project, assets, storyboards] = await Promise.all([
      u.db("o_project").where("id", project_id).first(),
      u.db("o_assets").where("projectId", project_id).select("*"),
      u.db("o_storyboard").where("projectId", project_id).select("*"),
    ]);

    const snapshotData = JSON.stringify({ project, assets, storyboards, timestamp: Date.now() });

    await u.db("kv_snapshot").insert({
      id,
      projectId: project_id,
      label: label || `snapshot-${id}`,
      data: snapshotData,
      createTime: Date.now(),
    });

    res.status(200).send(success({ id, message: "快照创建成功" }));
  },
);

// 获取快照列表
router.get("/:projectId", async (req, res) => {
  const { projectId } = req.params;

  const snapshots = await u.db("kv_snapshot")
    .where("projectId", Number(projectId))
    .orderBy("createTime", "desc")
    .select("id", "projectId", "label", "createTime");

  res.status(200).send(success({ snapshots }));
});

export default router;
