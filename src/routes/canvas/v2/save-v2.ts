import express from "express";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { broadcastToProject } from "@/utils/ws";
import { FlowGraphV2Schema } from "@/types/flowgraph-v2-schema";
import type { FlowGraphV2 } from "@/types/flowgraph-v2";
import { saveFullGraph } from "@/lib/canvasRelationalStore";
import { processGraphThumbnails } from "@/lib/thumbnail";
import { validateGraphNodes } from "@/lib/canvasAssetSchema";

const router = express.Router();

/**
 * 保存 v2 FlowGraph（全量替换）— relational storage
 *
 * Replaces the event-sourcing path (appendAndSync + bootstrap) with direct
 * relational UPSERT: each node/link is a row in canvas_nodes/canvas_links.
 * O(N) per save where N = node count. No event log, no recompute.
 *
 * **Structured params enforcement**: asset nodes (audio/video/asset/storyboard)
 * are validated against canvasAssetSchema. Missing required structured params
 * → HTTP 400 rejection. The pipeline MUST fill them.
 */
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

      // ─── Structured params enforcement ────────────────────
      // Validate asset nodes against per-type schemas. Missing required
      // structured params → 400 rejection.
      const validationErrors = validateGraphNodes(validGraph.nodes as any);
      if (validationErrors.length > 0) {
        const details = validationErrors.map(
          (e) => `node "${e.nodeId}": ${e.errors}`,
        );
        return res.status(400).send(error(
          "资产节点结构化参数校验失败 — 管线必须为每个资产节点填写必填参数",
          details,
        ));
      }

      // 自动为指向原图/原视频的 thumbnailUrl 生成压缩缩略图（幂等）
      try {
        await processGraphThumbnails(validGraph);
      } catch (thumbErr) {
        console.warn("[v2/canvas/save] 缩略图生成（部分）失败，继续保存:", thumbErr);
      }

      // ─── Relational UPSERT ────────────────────────────
      // Direct row-level write — no event log, no recompute, no O(N²)
      await saveFullGraph({ projectId, episodesId }, validGraph);

      broadcastToProject(projectId, "graph:saved", { projectId, episodesId, timestamp: Date.now() });
      return res.status(200).send(success());
    } catch (err) {
      console.error("[v2/canvas/save] 保存画布失败:", err);
      // B-6: 带 err.message（对齐 import-from-dir.ts / sync-assets.ts 口径）
      // —— KMC 盲退避 3 次后降级 envelope，无诊断信息的 500 让根因不可查。
      const message = err instanceof Error ? err.message : String(err);
      return res.status(500).send(error(`保存画布失败: ${message}`));
    }
  },
);
