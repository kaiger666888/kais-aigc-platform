import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import type { FlowGraphV2, FlowNodeV2, FlowLinkV2, FlowBranchV2 } from "@/types/flowgraph-v2";
import {
  ensureBootstrap,
  getLastEventId,
  listEvents,
} from "@/lib/canvasEventStore";

const router = express.Router();

/** phaseIndex 推断规则（v1 → v2 懒迁移使用） */
const PHASE_INDEX_MAP: Record<string, number> = {
  script: 0,
  asset: 1,
  "3d": 1,
  storyboard: 2,
  video: 3,
  audio: 4,
  variant: 1,
  reference: 1,
  upscale: 3,
  face_restore: 3,
  suggestion: 0,
};

const PHASE_NAME_MAP: Record<string, string> = {
  script: "剧本",
  asset: "资产生成",
  "3d": "3D 空间",
  storyboard: "分镜",
  video: "视频生成",
  audio: "音频生成",
  variant: "变体生成",
  reference: "参考图",
  upscale: "超分处理",
  face_restore: "面部修复",
  suggestion: "AI 建议",
};

/** 加载 v2 FlowGraph（自动迁移 v1，支持 since 增量订阅） */
export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    episodesId: z.number(),
    since: z.number().int().optional(),
  }),
  async (req, res) => {
    const { projectId, episodesId, since } = req.body;

    try {
      await ensureBootstrap(projectId, episodesId);
      const lastEventId = await getLastEventId(projectId, episodesId);

      if (since !== undefined) {
        const events = await listEvents(projectId, episodesId, since);
        return res.status(200).send(success({ events, lastEventId }));
      }

      const row = await u
        .db("o_agentWorkData")
        .where("projectId", String(projectId))
        .andWhere("episodesId", String(episodesId))
        .andWhere("key", "canvasGraph")
        .first();

      if (!row?.data) {
        return res.status(200).send(success(null));
      }

      const parsed = JSON.parse(row.data);

      if (parsed.meta?.version === "2") {
        if (parsed.meta.lastEventId === undefined) parsed.meta.lastEventId = lastEventId;
        return res.status(200).send(success(parsed));
      }

      // ─── v1 → v2 懒迁移 ──────────────────────────
      const now = Date.now();

      const mainBranch: FlowBranchV2 = {
        id: "main",
        label: "主线",
        status: "active",
        createdAt: now,
        updatedAt: now,
      };

      const nodes: FlowNodeV2[] = (parsed.nodes || []).map((n: any) => {
        const nodeType = n.type || "script";
        return {
          id: n.id,
          type: nodeType,
          branchId: "main",
          phaseIndex: PHASE_INDEX_MAP[nodeType] ?? 0,
          phaseName: PHASE_NAME_MAP[nodeType] ?? "未知",
          position: n.position || { x: 0, y: 0 },
          size: n.size || { width: 260, height: 180 },
          data: n.data || {},
          state: n.state || "idle",
          reviewStatus: n.reviewStatus,
          aiScore: n.aiScore,
          isWinner: n.isWinner,
          rejectReason: (n.data && n.data.rejectReason) || undefined,
          suggestion: undefined,
          variantOf: (n.data && n.data.variantOf) || undefined,
          variantGroupId: (n.data && n.data.variantGroupId) || undefined,
        } as FlowNodeV2;
      });

      const links: FlowLinkV2[] = (parsed.links || []).map((l: any) => ({
        id: l.id,
        source: l.source,
        target: l.target,
        branchId: "main",
        dataType: l.dataType || "text",
      }));

      const graph: FlowGraphV2 = {
        meta: {
          version: "2",
          projectId,
          episodesId,
          createdAt: now,
          updatedAt: now,
          viewport: parsed.viewport || undefined,
          lastEventId,
        } as any,
        nodes,
        links,
        branches: [mainBranch],
        variantGroups: [],
      };

      return res.status(200).send(success(graph));
    } catch (err) {
      console.error("[v2/canvas/load] 加载画布失败:", err);
      return res.status(500).send(error("加载画布失败"));
    }
  },
);
