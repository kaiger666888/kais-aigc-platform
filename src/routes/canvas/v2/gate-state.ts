/**
 * gate-state.ts — GET /api/canvas/v2/gate-state(Phase 54-05, GATE-01)。
 *
 * gate 全量快照(新会话/断线兜底):16 门四态折叠后的展示模型 + degrade
 * 标志 + episodeRefs 诊断字段(socket 事件体不带诊断键)。
 *
 * stale(fetchedAt 距今超过 interval)时先 await pollNow(带超时保护——
 * 平台卡死不拖死本端点,超时回旧快照)。**不返回 503-on-degrade**:
 * degrade 是数据字段(fail-closed 展示),不是请求失败。
 */
import express from "express";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { getGateStateService } from "@/lib/gateStateService";

const router = express.Router();

const querySchema = z.object({
  projectId: z.coerce.number().int(),
  episodesId: z.coerce.number().int(),
  episodeRef: z.string().min(1).max(128).optional(),
});

const POLL_NOW_TIMEOUT_MS = 8000;

router.get("/", async (req, res) => {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json(error("参数校验失败", parsed.error.issues));
    return;
  }
  const { projectId, episodesId, episodeRef } = parsed.data;
  const service = getGateStateService();
  const scope = { projectId, episodesId };

  try {
    service.ensureScope(scope, { episodeRefOverride: episodeRef ?? null });
    const snapshot = service.getSnapshot(scope);
    const stale =
      snapshot == null || Date.now() - snapshot.fetchedAt > service.getIntervalMs();
    if (stale) {
      // 超时保护:平台卡死时回旧快照(degrade 语义),不让本端点挂死。
      await Promise.race([
        service.pollNow(scope).catch(() => undefined),
        new Promise((resolve) => setTimeout(resolve, POLL_NOW_TIMEOUT_MS)),
      ]);
    }
    const payload = service.getSnapshot(scope);
    if (payload == null) {
      res.status(500).json(error("gate 状态获取失败", { hint: "首轮拉取未完成且无旧快照" }));
      return;
    }
    const episodeRefs = service.episodeRefsFor(scope);
    res.json(success({ ...payload, ...(episodeRefs != null ? { episodeRefs: [...episodeRefs] } : {}) }));
  } catch (err) {
    console.error("[canvas:v2/gate-state] 失败", err);
    res.status(500).json(error("gate 状态获取失败", err instanceof Error ? err.message : String(err)));
  }
});

export default router;
