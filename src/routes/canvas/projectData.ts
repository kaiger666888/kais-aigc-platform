import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

/** 获取项目的剧本列表（供画布选择剧本用） */
export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
  }),
  async (req, res) => {
    const { projectId } = req.body;

    try {
      // 获取项目下所有剧本
      const scripts = await u.db("o_script")
        .where("projectId", projectId)
        .select("id", "name", "content", "extractState", "createTime");

      // 获取每个剧本的资产数和分镜数
      const enriched = await Promise.all(
        scripts.map(async (s) => {
          const assetCount = (await u.db("o_scriptAssets").where("scriptId", s.id).count("* as cnt").first())?.cnt ?? 0;
          const storyboardCount = (await u.db("o_storyboard").where("scriptId", s.id).count("id as cnt").first())?.cnt ?? 0;
          return {
            ...s,
            assetCount,
            storyboardCount,
          };
        }),
      );

      res.status(200).send(success(enriched));
    } catch (err) {
      console.error("[canvas:projectData] 获取项目数据失败:", err);
      res.status(500).send(error("获取项目数据失败"));
    }
  },
);
