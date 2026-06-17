import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { broadcastToProject } from "@/utils/ws";
import { simulateExecution } from "./_simulate";
const router = express.Router();

/** 触发节点执行 */
export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    episodesId: z.number(),
    nodeId: z.string(),
    nodeType: z.string(),
  }),
  async (req, res) => {
    const { projectId, episodesId, nodeId, nodeType } = req.body;

    try {
      broadcastToProject(projectId, "node:state", {
        nodeId,
        state: "running",
        progress: 0,
      });

      const supportedTypes = [
        "asset", "storyboard", "video", "audio", "3d",
        "variant", "reference", "upscale", "face_restore", "script",
      ];
      if (!supportedTypes.includes(nodeType)) {
        console.log(`[canvas:execute] 未知节点类型: ${nodeType}`);
        return res.status(400).send(error(`不支持的节点类型: ${nodeType}`));
      }

      setImmediate(async () => {
        try {
          await simulateExecution(projectId, nodeId);
          broadcastToProject(projectId, "node:state", { nodeId, state: "success" });
        } catch (err) {
          broadcastToProject(projectId, "node:state", { nodeId, state: "error" });
        }
      });

      return res.status(200).send(success({ nodeId, status: "triggered" }));
    } catch (err) {
      console.error("[canvas:execute] 执行节点失败:", err);
      broadcastToProject(projectId, "node:state", { nodeId, state: "error" });
      return res.status(500).send(error("执行节点失败"));
    }
  },
);
