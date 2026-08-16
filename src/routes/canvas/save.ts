import express from "express";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { broadcastToProject } from "@/utils/ws";
import { saveFullGraph } from "@/lib/canvasRelationalStore";
import { FlowGraphV2Schema } from "@/types/flowgraph-v2-schema";
import { validateGraphNodes } from "@/lib/canvasAssetSchema";
import type { FlowGraphV2, FlowNodeV2, FlowLinkV2 } from "@/types/flowgraph-v2";

const router = express.Router();

/**
 * 保存画布图 (v1 — 前端实际调用入口)
 *
 * Accepts v1 format graph ({ nodes, links/edges }) and normalizes to v2
 * before writing to relational tables. Maintains backward compatibility
 * with the frontend while using the new relational backend.
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
      const now = Date.now();

      // Normalize v1 → v2
      const v1Nodes = graph.nodes || [];
      const v1Links = graph.links || graph.edges || [];

      const nodes: FlowNodeV2[] = v1Nodes.map((n: any) => ({
        id: n.id,
        type: (n.type || "script") as FlowNodeV2["type"],
        branchId: n.branchId || n.data?.branchId || "main",
        phaseIndex: n.phaseIndex ?? 0,
        phaseName: n.phaseName ?? n.data?.phaseName ?? "",
        position: n.position || { x: 0, y: 0 },
        size: n.size || { width: 260, height: 180 },
        data: n.data || {},
        state: (n.state || n.data?.state || "idle") as FlowNodeV2["state"],
      }));

      const links: FlowLinkV2[] = v1Links.map((l: any) => ({
        id: l.id,
        source: l.source,
        target: l.target,
        branchId: l.branchId || "main",
        dataType: l.dataType || l.type || "text",
      }));

      const v2Graph: FlowGraphV2 = {
        meta: {
          version: "2",
          projectId,
          episodesId,
          createdAt: now,
          updatedAt: now,
        },
        nodes,
        links,
        branches: [{
          id: "main",
          label: "主线",
          status: "active" as const,
          createdAt: now,
          updatedAt: now,
        }],
        variantGroups: [],
      };

      // B-4: v1 入口此前无任何校验直接落共享表（任意 state/type 可写入，
      // 实测 DB 已有 13 行非法 state='completed'——它们会让 KMC 下次全量
      // save-v2 整图被 Zod 400 拒绝）。对齐 save-v2 的同一校验门：
      // FlowGraphV2Schema parse + per-type 结构化参数校验，失败 400 带明细。
      const parseResult = FlowGraphV2Schema.safeParse(v2Graph);
      if (!parseResult.success) {
        return res.status(400).send(
          error("FlowGraph v2 格式校验失败", parseResult.error.issues),
        );
      }
      const validGraph = parseResult.data as FlowGraphV2;
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

      await saveFullGraph({ projectId, episodesId }, validGraph);

      broadcastToProject(projectId, "graph:saved", { projectId, episodesId, timestamp: now });
      return res.status(200).send(success());
    } catch (err) {
      console.error("[canvas:save] 保存画布失败:", err);
      return res.status(500).send(error("保存画布失败"));
    }
  },
);
