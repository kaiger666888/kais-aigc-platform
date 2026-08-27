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
import { candidateSourceSchema } from "@/lib/candidateEnvelope";
import {
  enqueueManifestWriteback,
  getManifestTransport,
  replayManifestWriteback,
} from "@/lib/manifestWriteback";
import { appendDecisionEvent, blindMetaSchema } from "@/lib/blindVoteLedger";
import { ensureDrainStarted, drainOnce } from "@/lib/writebackQueue";
import { getGateStateService } from "@/lib/gateStateService";

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
 * → 404 group not found | 409 winner outside the group / select_mode != single /
 *   409 group contains a curation:'locked' member (WR-09)
 */
const selectWinnerSchema = z.object({
  projectId: z.number(),
  episodesId: z.number(),
  winnerNodeId: z.string().min(1).max(128), // T-49-01: no oversized ids into the DB
  // 53-04 VAR-03: G13 首尾分选参数面(D-11)——两字段均可选,缺省行为与
  // Phase 49 逐字节一致(向后兼容)。source 为候选 5 源 enum(53-01 契约)。
  frameSlot: z.enum(["first", "last"]).optional(),
  source: candidateSourceSchema.optional(),
  // 迭代平台 v2 盲选批(M1):blind 元数据在场 → status==='updated' 段追加
  // decision/v1 账本事件;缺省(不带 blind 字段)行为逐字节不变。schema
  // 本体在 blindVoteLedger.ts(纯模块可单测),此处只组合。
  blind: blindMetaSchema.optional(),
});

// 53-04 D-10:回写队列消费者(进程内单例 30s 串行 drain)。transport 为 null
// 时 drain 回调直接空转(processed 0),不误标 failed——通道未开通 ≠ 故障。
let drainBooted = false;
function bootWritebackDrain(): void {
  if (drainBooted) return;
  drainBooted = true;
  void (async () => {
    const { db } = await import("@/utils/db");
    ensureDrainStarted(db, async (d) => {
      const transport = getManifestTransport();
      if (transport == null) return; // 通道未开通——空转
      await drainOnce(d, (row) => replayManifestWriteback(row, transport));
    });
  })().catch(() => {
    drainBooted = false; // boot 失败允许下次重试
  });
}

router.post(
  "/:groupId/select-winner",
  async (req, res) => {
    const parse = selectWinnerSchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).send(error("参数校验失败", parse.error.issues));
    }
    const { projectId, episodesId, winnerNodeId, frameSlot, source, blind } = parse.data;
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
      if (result.status === "locked") {
        // WR-09: mirror the client's selectVariant §11 guard server-side —
        // a group containing a curation:'locked' member can never be
        // overwritten, not even via the direct API or the registry linkage.
        return res
          .status(409)
          .send(error("组含 curation:'locked' 成员，不可选定", { groupId }));
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
      // 70-01/70-02 (v3.2 F08):variantNumber(真 v{N})+ shotId/frameSlot
      // (cand:shot:{sid}:{slot} 组 id 解析)——choose 载荷按 phase id 空间
      // 构造,不再裸 v{数组位置}。
      const _shotMatch = /^cand:shot:([^:]+):(first|last)$/.exec(groupId);
      void resolveOpenReviewForSelection({
        projectId,
        episodesId,
        groupId,
        winnerNodeId,
        variantIndex: result.variantIndex,
        variantNumber: result.variantNumber,
        winnerPhaseName: result.winnerPhaseName,
        shotId: _shotMatch?.[1],
        frameSlot: frameSlot ?? (_shotMatch?.[2] as "first" | "last" | undefined) ?? null,
      }).catch(() => {});

      // [53-04] manifest writeback hook — VAR-03 kap half (D-09 same-slot
      // extension, D-10 best-effort, D-11 first/last field mapping). Same
      // discipline as the bridge above: void + never-throws internally +
      // .catch backstop. Idempotent branch above does NOT reach here either
      // (Pitfall 5 — re-selecting the current winner carries no new info).
      // 69-01 (WBI-01):episodeRefs 从 gateStateService 画布探针解析(FS
      // transport 定位真实剧集目录;未解析时 legacy 双形态兜底)。
      const _wbScope = { projectId, episodesId };
      const _wbSvc = getGateStateService();
      _wbSvc.ensureScope(_wbScope);
      const _wbRefs =
        _wbSvc.episodeRefsFor(_wbScope) ?? new Set([`ep${episodesId}`, String(episodesId)]);
      bootWritebackDrain();
      void enqueueManifestWriteback({
        projectId,
        episodesId,
        groupId,
        winnerNodeId,
        // 70-02 (F08-②):manifest 消费 p11a0/p11b 的 int N = 真 v{N} 编号,
        // 非 variantIndex 数组位置(成员缺失时错位)。
        variantIndex: result.variantNumber,
        frameSlot,
        source,
        episodeRefs: [..._wbRefs],
      }).catch(() => {});

      // [盲选批 M1] decision/v1 账本挂钩(D-09 同位收口;只在请求携带
      // blind 元数据时落账,不带该字段的既有调用行为逐字节不变)。本端点
      // 不掌握完整候选展示序,candidates_shown 以 winner 兜底单元素——
      // 盲选 overlay 侧的完整展示序由会话事件补齐(P10 通道,M2 后续)。
      // best-effort:appendDecisionEvent 自身 never-throws,void 不阻塞响应
      // (与上方 bridge/writeback 同一控制流纪律)。
      if (blind != null) {
        void appendDecisionEvent({
          schema: "decision/v1",
          project_id: projectId,
          episodes_id: episodesId,
          episode_refs: [..._wbRefs],
          session_id: blind.sessionId,
          track: blind.track,
          group_key: groupId.startsWith("cand:") ? groupId.slice("cand:".length) : groupId,
          source: source ?? "unknown",
          candidates_shown: [{ node_id: winnerNodeId, position: 1 }],
          winner_node_id: winnerNodeId,
          was_blind: blind.wasBlind,
          selector: {
            ...(blind.operatorNote != null ? { operator_note: blind.operatorNote } : {}),
            ...(blind.reasonTags != null ? { reason_tags: blind.reasonTags } : {}),
          },
          revealed_after_vote: true,
        }).catch(() => {});
      }

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
