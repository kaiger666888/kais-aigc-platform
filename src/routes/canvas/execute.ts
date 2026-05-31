import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { broadcastToProject } from "@/utils/ws";
const router = express.Router();

/** 随机延迟 5-15 秒 */
function randomDelay(): number {
  return 5000 + Math.floor(Math.random() * 10000);
}

/** 广播多步进度：0% → 30% → 60% → 90% → 100% */
async function simulateExecution(
  projectId: number,
  nodeId: string,
): Promise<void> {
  const steps = [0, 0.3, 0.6, 0.9, 1.0];
  const totalDuration = randomDelay();
  const stepDelay = Math.floor(totalDuration / steps.length);

  for (let i = 0; i < steps.length; i++) {
    await new Promise((r) => setTimeout(r, stepDelay));
    broadcastToProject(projectId, "execution:progress", {
      nodeId,
      state: "running",
      progress: steps[i],
    });
  }
}

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
        progress: 0,
      });

      // 根据节点类型触发对应的生成逻辑
      switch (nodeType) {
        case "asset": {
          const assetId = parseInt(nodeId.replace("asset-", ""), 10);
          if (!isNaN(assetId)) {
            setImmediate(async () => {
              try {
                await simulateExecution(projectId, nodeId);
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
          const sbId = parseInt(nodeId.replace("storyboard-", ""), 10);
          if (!isNaN(sbId)) {
            setImmediate(async () => {
              try {
                await simulateExecution(projectId, nodeId);
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
        case "video": {
          setImmediate(async () => {
            try {
              await simulateExecution(projectId, nodeId);
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
          break;
        }
        case "audio": {
          setImmediate(async () => {
            try {
              await simulateExecution(projectId, nodeId);
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
