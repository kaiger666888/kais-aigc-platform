import express from "express";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { broadcastToProject } from "@/utils/ws";
import { FlowGraphV2Schema } from "@/types/flowgraph-v2-schema";
import type { FlowGraphV2 } from "@/types/flowgraph-v2";
import { appendAndSync, ensureBootstrap } from "@/lib/canvasEventStore";
import { processGraphThumbnails } from "@/lib/thumbnail";

const router = express.Router();

/** 保存 v2 FlowGraph（全量替换）— Wave 2: 经 bootstrap 事件落到事件日志，行为对 caller 不变 */
export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    episodesId: z.number(),
    graph: z.any(),
  }),
  async (req, res) => {
    const { projectId, episodesId, graph } = req.body;

    try {
      const parseResult = FlowGraphV2Schema.safeParse(graph);
      if (!parseResult.success) {
        return res.status(400).send(error("FlowGraph v2 格式校验失败", parseResult.error.issues));
      }

      const validGraph = parseResult.data as FlowGraphV2;
      validGraph.meta.projectId = projectId;
      validGraph.meta.episodesId = episodesId;
      validGraph.meta.updatedAt = Date.now();

      // 自动为指向原图/原视频的 thumbnailUrl 生成压缩缩略图（幂等）
      // 生成后将原路径保存到 filePath，详情面板会用 filePath 展示原图
      try {
        await processGraphThumbnails(validGraph);
      } catch (thumbErr) {
        console.warn("[v2/canvas/save] 缩略图生成（部分）失败，继续保存:", thumbErr);
      }

      await ensureBootstrap(projectId, episodesId);

      const clientId = `legacy:save-v2:${projectId}:${episodesId}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
      await appendAndSync({
        projectId,
        episodesId,
        clientId,
        source: "canvas-ui",
        events: [
          {
            type: "bootstrap",
            nodeId: undefined,
            payload: { graph: validGraph },
          },
        ],
      });

      broadcastToProject(projectId, "graph:saved", { projectId, episodesId, timestamp: Date.now() });
      return res.status(200).send(success());
    } catch (err) {
      console.error("[v2/canvas/save] 保存画布失败:", err);
      return res.status(500).send(error("保存画布失败"));
    }
  },
);
