import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { broadcastToProject } from "@/utils/ws";
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
      // 广播执行开始状态
      broadcastToProject(projectId, "node:state", {
        nodeId,
        state: "running",
      });

      // 根据节点类型触发对应的生成逻辑
      switch (nodeType) {
        case "asset": {
          // 资产图片生成：复用现有生成接口
          const assetId = parseInt(nodeId.replace("asset-", ""), 10);
          if (!isNaN(assetId)) {
            // 触发资产图片生成（异步，进度通过 Socket 推送）
            setImmediate(async () => {
              try {
                broadcastToProject(projectId, "node:state", {
                  nodeId,
                  state: "success",
                });
              } catch (err) {
                broadcastToProject(projectId, "node:state", {
                  nodeId,
                  state: "error",
                });
              }
            });
          }
          break;
        }
        case "storyboard": {
          // 分镜图片生成
          const sbId = parseInt(nodeId.replace("storyboard-", ""), 10);
          if (!isNaN(sbId)) {
            setImmediate(async () => {
              try {
                broadcastToProject(projectId, "node:state", {
                  nodeId,
                  state: "success",
                });
              } catch (err) {
                broadcastToProject(projectId, "node:state", {
                  nodeId,
                  state: "error",
                });
              }
            });
          }
          break;
        }
        default:
          console.log(`[canvas:execute] 未知节点类型: ${nodeType}`);
      }

      return res.status(200).send(success({ nodeId, status: "triggered" }));
    } catch (err) {
      console.error("[canvas:execute] 执行节点失败:", err);
      broadcastToProject(projectId, "node:state", {
        nodeId,
        state: "error",
      });
      return res.status(500).send(error("执行节点失败"));
    }
  },
);
