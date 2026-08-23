import express from "express";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import type { FlowGraphV2, FlowNodeV2, FlowLinkV2, FlowBranchV2 } from "@/types/flowgraph-v2";
import {
  loadFullGraph,
  getMeta,
  listNodes,
  listLinks,
} from "@/lib/canvasRelationalStore";
import {
  deriveCandidateGroups,
  materializeCandidateGroups,
  mergeDerivedGroups,
} from "@/lib/candidateGroupDeriver";

const router = express.Router();

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

/**
 * 加载 v2 FlowGraph — relational storage
 *
 * Direct SELECT from canvas_nodes/canvas_links/... — no replay, no reducer.
 * Returns null when no data exists for the scope.
 *
 * Supports optional `since` param for incremental polling: returns only
 * nodes/links updated after the given timestamp.
 */
export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    episodesId: z.number(),
    since: z.number().optional(),
  }),
  async (req, res) => {
    const { projectId, episodesId, since } = req.body;

    try {
      // Full load — relational SELECT
      const graph = await loadFullGraph({ projectId, episodesId });

      if (!graph) {
        return res.status(200).send(success(null));
      }

      const meta = await getMeta({ projectId, episodesId });
      if (graph.meta.lastEventId === undefined && meta) {
        graph.meta.lastEventId = meta.lastEventId;
      }

      // Incremental: filter by since timestamp if provided
      if (since !== undefined) {
        const [allNodes, allLinks] = await Promise.all([
          listNodes({ projectId, episodesId }),
          listLinks({ projectId, episodesId }),
        ]);
        // Return nodes/links that were updated after `since`
        // For relational tables, we can filter directly in SQL
        const { db } = await import("@/utils/db");
        const [changedNodes, changedLinks] = await Promise.all([
          db("canvas_nodes")
            .where({ project_id: projectId, episodes_id: episodesId })
            .where("updated_at", ">", since)
            .select("*"),
          db("canvas_links")
            .where({ project_id: projectId, episodes_id: episodesId })
            .where("updated_at", ">", since)
            .select("*"),
        ]);

        return res.status(200).send(success({
          nodes: changedNodes.map(rowToNode),
          links: changedLinks.map(rowToLink),
          lastEventId: meta?.lastEventId ?? 0,
        }));
      }

      // Full load only (since === undefined): best-effort candidate-group
      // materialization (53-03). kmc candidate nodes arrive group-less; derive
      // cand: groups + persist + merge into the response. Never fails the load.
      try {
        const derived = deriveCandidateGroups(
          graph.nodes.map((n) => ({
            id: n.id,
            type: n.type,
            data: (n.data ?? {}) as Record<string, unknown>,
          })),
        );
        if (derived.groups.length > 0) {
          const { db } = await import("@/utils/db");
          await materializeCandidateGroups(db, { projectId, episodesId }, derived.groups);
          graph.variantGroups = mergeDerivedGroups(graph.variantGroups ?? [], derived);
        }
      } catch (deriveErr) {
        console.warn("[load-v2] 候选组推导失败(不影响加载):", deriveErr);
      }

      return res.status(200).send(success(graph));
    } catch (err) {
      console.error("[v2/canvas/load] 加载画布失败:", err);
      return res.status(500).send(error("加载画布失败"));
    }
  },
);

function rowToNode(r: any): FlowNodeV2 {
  return {
    id: r.id,
    type: r.type,
    branchId: r.branch_id,
    phaseIndex: r.phase_index,
    phaseName: r.phase_name,
    position: { x: r.position_x, y: r.position_y },
    size: { width: r.size_width, height: r.size_height },
    data: r.data ? JSON.parse(r.data) : {},
    state: r.state,
  };
}

function rowToLink(r: any): FlowLinkV2 {
  return {
    id: r.id,
    source: r.source_id,
    target: r.target_id,
    branchId: r.branch_id,
    dataType: r.data_type,
  };
}
