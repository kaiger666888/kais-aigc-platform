import express from "express";
import u from "@/utils";
import { success, error } from "@/lib/responseFormat";
const router = express.Router();

/** 获取所有项目列表（供画布项目选择器使用） */
export default router.post("/", async (_req, res) => {
  try {
    const projects = await u.db("o_project").select(
      "id", "name", "type", "mode", "intro", "artStyle",
      "imageModel", "videoModel", "createTime",
    );

    // 附带每个项目的剧本数量和资产数量
    const enriched = await Promise.all(
      projects.map(async (p) => {
        const scriptCount = (await u.db("o_script").where("projectId", p.id).count("id as cnt").first())?.cnt ?? 0;
        const assetCount = (await u.db("o_assets").where("projectId", p.id).whereNull("assetsId").count("id as cnt").first())?.cnt ?? 0;
        return { ...p, scriptCount, assetCount };
      }),
    );

    res.status(200).send(success(enriched));
  } catch (err) {
    console.error("[canvas:projects] 获取项目列表失败:", err);
    res.status(500).send(error("获取项目列表失败"));
  }
});
