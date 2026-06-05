import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

/** 节点类型元数据定义（供前端识别） */
const NODE_TYPES = [
  { type: "script", label: "剧本", icon: "📄", color: "#6366f1" },
  { type: "asset", label: "角色资产", icon: "🎨", color: "#8b5cf6" },
  { type: "3d", label: "3D 空间", icon: "🧊", color: "#06b6d4" },
  { type: "variant", label: "变体", icon: "🔀", color: "#a855f7" },
  { type: "storyboard", label: "分镜", icon: "🎬", color: "#ec4899" },
  { type: "reference", label: "参考图", icon: "📐", color: "#14b8a6" },
  { type: "video", label: "视频", icon: "🎥", color: "#f59e0b" },
  { type: "upscale", label: "超分", icon: "🔍", color: "#f97316" },
  { type: "face_restore", label: "面部修复", icon: "👤", color: "#ef4444" },
  { type: "audio", label: "音频", icon: "🔊", color: "#22c55e" },
];

/** 获取节点类型列表 */
router.get("/node-types", (_req, res) => {
  res.status(200).send(success(NODE_TYPES));
});

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
          const assetCount = Number(((await u.db("o_scriptAssets").where("scriptId", s.id).count("scriptId as cnt").first()) as any)?.cnt ?? 0);
          const storyboardCount = Number(((await u.db("o_storyboard").where("scriptId", s.id).count("id as cnt").first()) as any)?.cnt ?? 0);
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
