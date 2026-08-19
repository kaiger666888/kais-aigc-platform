import express from "express";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { broadcastToProject } from "@/utils/ws";
import { db } from "@/utils/db";
import {
  selectWinnerInGroup,
  syncAssetPrimaryForWinner,
} from "@/lib/canvasRelationalStore";

const router = express.Router();

/**
 * POST /api/canvas/v2/variant-groups/:groupId/select-winner
 *
 * Persist a variant-group winner selection (SELECT-01). This endpoint is the
 * landing of the selectWinner.ts plan in docs/canvas-next-steps.md:428-545
 * (Phase 3.2) and the Phase 49 decisions:
 *   - D-01: transactional write of canvas_variant_groups.winner_node_id +
 *     per-member canvas_nodes.is_winner (selectWinnerInGroup)
 *   - D-02: persistence goes through canvasRelationalStore, mounted via the
 *     existing src/router.ts registration table
 *   - D-03: re-selecting the current winner is a 200 no-op (applied:false)
 *   - D-07: reverse linkage — when the winner maps to an o_assets row, swap
 *     isPrimaryView directly in the DB (never via an HTTP self-call to the
 *     registry route, and never via 49-03's applyRegistrySelectionToCanvas —
 *     both would loop). Failure only warns: canvas is this endpoint's truth
 *     source and is already committed.
 *
 * body: { projectId: number, episodesId: number, winnerNodeId: string }
 * → 200 { groupId, winnerNodeId, applied: true|false }
 * → 404 group not found | 409 winner outside the group / select_mode != single
 */
const selectWinnerSchema = z.object({
  projectId: z.number(),
  episodesId: z.number(),
  winnerNodeId: z.string().min(1).max(128), // T-49-01: no oversized ids into the DB
});

router.post(
  "/:groupId/select-winner",
  async (req, res) => {
    const parse = selectWinnerSchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).send(error("参数校验失败", parse.error.issues));
    }
    const { projectId, episodesId, winnerNodeId } = parse.data;
    const groupId = req.params.groupId;

    try {
      const result = await selectWinnerInGroup(
        db,
        { projectId, episodesId },
        groupId,
        winnerNodeId,
      );

      if (result.status === "not_found") {
        return res.status(404).send(error("变体组不存在", { groupId }));
      }
      if (result.status === "not_in_group") {
        return res
          .status(409)
          .send(error("winnerNodeId 不在组内", { groupId, winnerNodeId }));
      }
      if (result.status === "multi_mode") {
        return res
          .status(409)
          .send(error("仅 single 组支持选定", { groupId, selectMode: "multi" }));
      }
      if (result.status === "idempotent") {
        // D-03: re-selecting the current winner carries no new information —
        // no o_assets swap, no broadcast, no bridge.
        return res
          .status(200)
          .send(success({ groupId, winnerNodeId, applied: false }));
      }

      // status === "updated" — canvas truth columns are committed.
      // D-07 reverse linkage: swap o_assets isPrimaryView for the group's
      // candidates. Isolated on purpose: a failure here must NOT roll back or
      // fail the canvas selection above.
      if (result.winnerOAssetId != null) {
        try {
          result.swappedAssetIds = await syncAssetPrimaryForWinner(
            db,
            projectId,
            result.winnerOAssetId,
            result.memberOAssetIds,
          );
        } catch (err) {
          console.warn(
            "[select-winner] o_assets isPrimaryView 置换失败(不回滚 canvas):",
            err,
          );
        }
      }

      // [49-02] review bridge hook mounts here (fire-and-forget)

      broadcastToProject(projectId, "variant:selected", {
        projectId,
        episodesId,
        groupId,
        winnerNodeId,
        timestamp: Date.now(),
      });

      return res
        .status(200)
        .send(success({ groupId, winnerNodeId, applied: true }));
    } catch (err) {
      console.error("[canvas:v2/select-winner] 选定失败:", err);
      return res.status(500).send(error("选定操作失败"));
    }
  },
);

export default router;
