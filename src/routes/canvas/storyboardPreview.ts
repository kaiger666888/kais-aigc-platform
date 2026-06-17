import express from "express";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { broadcastToProject } from "@/utils/ws";

const router = express.Router();

/**
 * Phase 38 (Tier 2) — 分镜构图预览。
 *
 * 接收 {projectId, episodesId, nodeId},仅支持 storyboard-* 节点。
 * 当前为模拟实现(setImmediate + 4s delay);真正接入 gold-team IMAGE_DRAW
 * 引擎后,这里替换为调用 IMAGE_DRAW 路由并处理返回的资产 URL。
 *
 * 完成后通过现有 'node:preview' 通道广播 {nodeId, thumbnailUrl}。
 */
export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    episodesId: z.number(),
    nodeId: z.string(),
  }),
  async (req, res) => {
    const { projectId, nodeId } = req.body;

    if (!nodeId.startsWith("storyboard-")) {
      return res.status(400).send(error("仅分镜节点支持构图预览"));
    }

    res.status(200).send(success({ nodeId, status: "preview_triggered" }));

    setImmediate(async () => {
      try {
        // TODO(Phase 38 follow-up): 调用 gold-team IMAGE_DRAW 引擎
        //   入参: prompt (从 o_storyboard.prompt) + linkedAssetIds (作 IP-Adapter 参考)
        //   出参: 生成图片 URL → 设置到 thumbnailUrl
        // 当前模拟:4s 延迟 + 广播占位状态
        await new Promise((r) => setTimeout(r, 4000));

        broadcastToProject(projectId, "node:preview", {
          nodeId,
          // 真实环境下这里会是 /oss/<path> 的 URL
          // 当前为 null,前端将看到 thumbnailUrl 未更新,但事件已触发
          thumbnailUrl: null,
          state: "preview_ready",
        });

        broadcastToProject(projectId, "node:state", {
          nodeId,
          state: "idle",
        });
      } catch (err) {
        console.error("[canvas:storyboardPreview] 预览生成失败:", err);
        // 失败不阻塞主流程,仅日志
      }
    });
  },
);
