import express from "express";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { broadcastToProject } from "@/utils/ws";
import u from "@/utils";
import { loadFullGraph } from "@/lib/canvasRelationalStore";
import { simulateExecution, NODE_TYPE_TOPOLOGY } from "./_simulate";

const router = express.Router();

/**
 * Phase 36 — 一键成片编排器。
 *
 * 接收 {projectId, episodesId, nodeIds?}:
 *  - 无 nodeIds → 全画布执行(按节点类型拓扑序)
 *  - 有 nodeIds → 仅执行指定节点子集(Phase 37 批量执行复用此入口)
 *
 * 编排器跳过 state === 'success' 或 'cached' 的节点,
 * 通过 /ws/projects 推送 orchestrate:start / progress / done 事件。
 */
export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    episodesId: z.number(),
    nodeIds: z.array(z.string()).optional(),
  }),
  async (req, res) => {
    const { projectId, episodesId, nodeIds } = req.body;
    const runId = `run-${Date.now()}`;
    const mode: "full" | "batch" = Array.isArray(nodeIds) && nodeIds.length > 0 ? "batch" : "full";

    try {
      // 59-02: 目标筛选数据源真化——关系表读(loadFullGraph)优先:52-02
      // stale-success 谓词自此在现代项目(save-v2/import 写关系表)的真数据源上
      // 生效,SC4「重跑下游→orchestrate 子集」真机链路打通。
      // 59-fix WR-01: 关系表返回 null(legacy-blob-only 项目——从未经 save-v2/
      // import 写关系表)时回退 legacy JSON blob 读取(canvasGraph 键):59-02 换读
      // 后该类项目在此恒 404,与 _simulate.ts「legacy-blob → simulateOnly 兜底」
      // 声明矛盾(经 orchestrate 的调用路径到不了 simulate)。旧查询原样保留为
      // fallback;两者皆无数据 → 404(原语义)。谓词逐字冻结,零级联结构:本文件
      // 不 import 级联纯函数、不消费重生成标记字段(SC3 架构性保证,59-02 + 59-04
      // 静态负向断言锁死)。
      const graph = await loadFullGraph({
        projectId: Number(projectId),
        episodesId: Number(episodesId),
      });

      // (cast 保谓词逐字冻结:FlowNodeV2.state 是 NodeState 联合,原行内形状
      // state?: string 才能让下述 "cached" 比较无 tsc2367;结构不变纯类型收窄)
      type OrchestrateNode = {
        id: string; type?: string; state?: string; data?: Record<string, unknown>;
      };
      let allNodes: OrchestrateNode[];

      if (graph) {
        allNodes = graph.nodes as OrchestrateNode[];
      } else {
        // 59-fix WR-01: legacy JSON blob 兜底(旧主查询,59-02 前行为保持)
        const row = await u
          .db("o_agentWorkData")
          .where("projectId", String(projectId))
          .andWhere("episodesId", String(episodesId))
          .andWhere("key", "canvasGraph")
          .first();
        if (!row?.data) {
          return res.status(404).send(error("画布数据不存在,请先保存"));
        }
        const blobGraph = JSON.parse(row.data) as { nodes?: OrchestrateNode[] };
        allNodes = blobGraph.nodes ?? [];
      }

      // Filter to specified subset (Phase 37 batch) or all (Phase 36 full)
      const filtered = Array.isArray(nodeIds) && nodeIds.length > 0
        ? allNodes.filter((n) => nodeIds.includes(n.id))
        : allNodes;

      // Skip nodes already done — 52-02: stale 即需重跑语义(REGEN-03 锁定决策):
      // success/cached 且【无】 stale 标记才跳过;带 stale 的 success 节点进入 targets。
      // 不加 force 参数;52-02 起 data.stale 随 wire 持久化(serializeGraphToV2)。
      const targets = filtered.filter(
        (n) => (n.state !== "success" && n.state !== "cached") || (n.data != null && n.data.stale != null),
      );

      // Sort by node-type topology (script → asset → storyboard → video → audio)
      targets.sort((a, b) => {
        const ai = a.type ? NODE_TYPE_TOPOLOGY.indexOf(a.type as typeof NODE_TYPE_TOPOLOGY[number]) : -1;
        const bi = b.type ? NODE_TYPE_TOPOLOGY.indexOf(b.type as typeof NODE_TYPE_TOPOLOGY[number]) : -1;
        return ai - bi;
      });

      const total = targets.length;
      const skipped = filtered.length - total;

      res.status(200).send(success({ runId, total, skipped, mode }));

      setImmediate(async () => {
        let completed = 0;
        let failed = 0;
        const failedNodes: string[] = [];

        broadcastToProject(projectId, "orchestrate:start", { runId, total, mode });

        for (const node of targets) {
          broadcastToProject(projectId, "orchestrate:progress", {
            runId,
            completed,
            total,
            failed,
            currentNodeId: node.id,
            mode,
          });
          broadcastToProject(projectId, "node:state", {
            nodeId: node.id,
            state: "running",
            progress: 0,
          });
          try {
            await simulateExecution(projectId, node.id, episodesId);
            broadcastToProject(projectId, "node:state", {
              nodeId: node.id,
              state: "success",
            });
            completed++;
          } catch (err) {
            broadcastToProject(projectId, "node:state", {
              nodeId: node.id,
              state: "error",
            });
            failed++;
            failedNodes.push(node.id);
          }
        }

        broadcastToProject(projectId, "orchestrate:done", {
          runId,
          completed,
          total,
          failed,
          failedNodes,
          mode,
        });
      });
    } catch (err) {
      console.error("[canvas:orchestrate] 编排失败:", err);
      return res.status(500).send(error("一键成片编排失败"));
    }
  },
);
