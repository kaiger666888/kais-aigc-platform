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
    // projectId: canvas-UI sends number; IterationEngine sends number OR string.
    projectId: z.union([z.number(), z.string()]),
    // episodesId: canvas-UI sends number; IterationEngine omits entirely.
    episodesId: z.number().optional(),
    nodeId: z.string().min(1),
    // nodeType: canvas-UI sends a string; IterationEngine omits (defaults to 'script').
    nodeType: z.string().optional(),
    // prompt + branchId: IterationEngine sends these for single-node regeneration.
    prompt: z.string().optional(),
    branchId: z.string().optional(),
    // 52-02: params(配方袋,REGEN-02 换 seed 提交通道)。validateFields 只校验不回写
    // (middleware safeParse 后 next(),extra key 本就原样穿透无行为变化)——此字段为
    // 契约诚实 + 防未来有人给 middleware 加 strip 回写踩雷。模拟器语义不变:
    // handler 不把 prompt/params 传给 simulateExecution(归宿 = 接受并忽略)。
    params: z.record(z.string(), z.unknown()).optional(),
  }),
  async (req, res) => {
    const { projectId, episodesId, nodeId, nodeType, prompt, branchId } = req.body;

    try {
      broadcastToProject(projectId, "node:state", {
        nodeId,
        state: "running",
        progress: 0,
      });

      // IterationEngine path: caller omits episodesId (single-node regeneration
      // via _callEngine). Return a structured queued response — engine dispatch
      // will be wired in a follow-up. This closes the 400-validation-breakpoint
      // without disturbing the canvas-UI simulateExecution flow.
      if (episodesId === undefined || episodesId === null) {
        return res.status(200).send(success({
          status: "queued",
          nodeId,
          branchId: branchId || null,
          message: `Regeneration queued for node ${nodeId}`,
        }));
      }

      const effectiveType = nodeType || "script";
      const supportedTypes = [
        "asset", "storyboard", "video", "audio", "3d",
        "variant", "reference", "upscale", "face_restore", "script",
      ];
      if (!supportedTypes.includes(effectiveType)) {
        console.log(`[canvas:execute] 未知节点类型: ${effectiveType}`);
        return res.status(400).send(error(`不支持的节点类型: ${effectiveType}`));
      }

      setImmediate(async () => {
        try {
          await simulateExecution(projectId, nodeId, episodesId);
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
