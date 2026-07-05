import express from "express";
import { success, error } from "@/lib/responseFormat";
import { getAllScopes } from "@/lib/canvasRelationalStore";

const router = express.Router();

/**
 * GET /api/canvas/v2/health
 *
 * Canvas v2 health check. Reads from relational tables (canvas_graph_meta).
 * Returns per-project node/link counts instead of event counts.
 */
router.get("/", async (_req, res) => {
  const timestamp = Date.now();

  try {
    const scopes = await getAllScopes();
    const totalNodes = scopes.reduce((sum, s) => sum + s.nodeCount, 0);

    return res.status(200).send(
      success({
        timestamp,
        canvas: {
          totalScopes: scopes.length,
          totalNodes,
          scopes: scopes.map((s) => ({
            projectId: s.projectId,
            episodesId: s.episodesId,
            nodeCount: s.nodeCount,
            linkCount: s.linkCount,
            lastEventId: s.lastEventId,
            updatedAt: s.updatedAt,
          })),
        },
      }),
    );
  } catch (err) {
    console.error("[v2/canvas/health] 探活失败:", err);
    return res.status(503).send(error("画布服务不可用"));
  }
});

export default router;
