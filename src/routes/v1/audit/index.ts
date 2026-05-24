import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

// 写入审核记录
router.post(
  "/",
  validateFields({
    project_id: z.string(),
    action: z.string(),
    result: z.string(),
    phase: z.string().optional(),
    detail: z.string().optional(),
  }),
  async (req, res) => {
    const { project_id, action, result, phase, detail } = req.body;
    const id = Date.now();

    await u.db("kv_audit").insert({
      id,
      projectId: project_id,
      action,
      result,
      detail: detail || phase ? `${phase ? `[${phase}] ` : ""}${detail || ""}` : "",
      createTime: Date.now(),
    });

    res.status(200).send(success({ id, message: "审核记录已写入" }));
  },
);

// 获取审核历史
router.get("/:projectId", async (req, res) => {
  const { projectId } = req.params;

  const records = await u.db("kv_audit")
    .where("projectId", Number(projectId))
    .orderBy("createTime", "desc")
    .select("*");

  res.status(200).send(success({ records }));
});

export default router;
