import express from "express";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { broadcastToProject } from "@/utils/ws";
import { db } from "@/utils/db";
import {
  selectWinnerInGroup,
  syncAssetPrimaryForWinner,
  demoteAssets,
} from "@/lib/canvasRelationalStore";
import { resolveOpenReviewForSelection } from "@/lib/reviewBridge";

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
      try {
        if (result.winnerOAssetId != null) {
          result.swappedAssetIds = await syncAssetPrimaryForWinner(
            db,
            projectId,
            result.winnerOAssetId,
            result.memberOAssetIds,
          );
          if (result.swappedAssetIds.length === 0 && result.memberOAssetIds.length > 0) {
            // WR-03: the winner's own o_assets row could not be located under
            // this project (asset moved projects) — a silent no-op here would
            // leave the OLD winner's isPrimaryView = 1 forever. Run a
            // demotion-only pass over the mapped members (winner excluded) so
            // no stale primary survives, and make the divergence loud.
            const demoted = await demoteAssets(
              db,
              projectId,
              result.memberOAssetIds.filter((id) => id !== result.winnerOAssetId),
            );
            if (demoted.length > 0) {
              result.swappedAssetIds = demoted;
              console.warn(
                `[select-winner] winner 资产行不在项目 ${projectId} 内，已仅降级旧 primary ` +
                  `(o_assets ${demoted.join(",")}) — canvas 为真值源不回滚，资产中心需人工核对`,
              );
            }
          }
        } else if (result.memberOAssetIds.length > 0) {
          // WR-03: the new winner maps to no o_assets row, but the member set
          // is still known — demote mapped members (promote nothing) so the
          // previous winner's isPrimaryView does not silently stay 1 while
          // canvas already moved the winner.
          result.swappedAssetIds = await demoteAssets(
            db,
            projectId,
            result.memberOAssetIds,
          );
          console.warn(
            `[select-winner] winner 节点 ${winnerNodeId} 未映射 o_assets（组 ${groupId}），` +
              (result.swappedAssetIds.length > 0
                ? `已降级旧 primary o_assets ${result.swappedAssetIds.join(",")}`
                : "组内无仍置 primary 的映射成员") +
              "（canvas 为真值源不回滚）",
          );
        }
      } catch (err) {
        console.warn(
          "[select-winner] o_assets isPrimaryView 置换失败(不回滚 canvas):",
          err,
        );
      }

      // [49-02] review bridge hook mounts here — SELECT-04: best-effort
      // approve of the open (APPROVING) kmc review matching the winner's
      // phase. Fire-and-forget: never awaited (the response is not blocked)
      // and the bridge swallows internally; .catch is the second backstop.
      // The idempotent branch above deliberately does NOT reach this point.
      void resolveOpenReviewForSelection({
        projectId,
        episodesId,
        groupId,
        winnerNodeId,
        variantIndex: result.variantIndex,
        winnerPhaseName: result.winnerPhaseName,
      }).catch(() => {});

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
