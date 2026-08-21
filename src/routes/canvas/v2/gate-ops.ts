/**
 * gate-ops.ts — POST /api/canvas/v2/gate-ops(Phase 54-05, GATE-03 kap 侧)。
 *
 * 人工门决策主通道:approve/reject/waive 三操作 **await 主操作**(非
 * fire-and-forget),经 kap 桥接 review-platform 对应端点(54-02 R1 已
 * 部署)。前端不直连平台(D-03 拓扑隐藏)。
 *
 * fail-closed 对象级授权(T-54-05-01 wrong-approve):reviewId 必须属于
 * 当前 (projectId, episodesId) scope 的候选集(episode refs + phase token
 * 等值三维匹配)——不命中 422,绝不转发。409 = 幂等成功(applied:false,
 * cause:"already-resolved",P4),不当错误弹。
 *
 * body: { projectId, episodesId, reviewId, action, reason?, selected? }
 * → 200 { applied, cause?, gateId }
 * → 400 参数校验失败 / 422 review 不属于当前剧集 / 502 平台调用失败
 */
import express from "express";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { getGateStateService, fullPhaseTokenOfItem } from "@/lib/gateStateService";

const router = express.Router();

const gateOpsSchema = z
  .object({
    projectId: z.number(),
    episodesId: z.number(),
    reviewId: z.number().int(),
    action: z.enum(["approve", "reject", "waive"]),
    reason: z.string().min(1).max(500).optional(),
    selected: z.array(z.number().int()).max(20).optional(),
  })
  // reject/waive 是驳回/豁免裁决,reason 必填(镜像平台 Reject/WaiveRequest)。
  .superRefine((v, ctx) => {
    if ((v.action === "reject" || v.action === "waive") && (v.reason == null || v.reason === "")) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["reason"], message: "reject/waive 必须携带 reason" });
    }
  });

const LOG_PREFIX = "[canvas:v2/gate-ops]";

router.post("/", async (req, res) => {
  const parsed = gateOpsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(error("参数校验失败", parsed.error.issues));
    return;
  }
  const { projectId, episodesId, reviewId, action, reason, selected } = parsed.data;
  const service = getGateStateService();
  const scope = { projectId, episodesId };

  try {
    // 新鲜候选集(即时拉取):reviewId 必须 ∈ 本 scope 候选(fail-closed)。
    await service.pollNow(scope);
    const candidates = service.candidatesFor(scope);
    const target = candidates.find((c) => Number(c.id) === reviewId);
    if (target == null) {
      res.status(422).json(error("review 不属于当前剧集", { reviewId, candidateCount: candidates.length }));
      return;
    }
    const gateToken = fullPhaseTokenOfItem(target);

    // 平台端点(approve 携 selected 作为机器选片;reject/waive 携 reason)。
    const baseUrl = service.getPlatformBaseUrl();
    const path =
      action === "approve" ? "approve" : action === "reject" ? "reject" : "waive";
    const body =
      action === "approve"
        ? { ...(selected != null ? { result: { selected } } : {}) }
        : { reason: reason ?? "" };
    const resp = await fetch(`${baseUrl}/api/v1/reviews/${reviewId}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(service.getTimeoutMs()),
    });

    if (resp.status === 409) {
      // P4 幂等成功:已被别处 resolve,不当作错误弹。
      void service.pollNow(scope).catch(() => {});
      res.json(success({ applied: false, cause: "already-resolved", gateId: gateToken }));
      return;
    }
    if (!resp.ok) {
      console.error(`${LOG_PREFIX} 平台 ${action} 失败: HTTP ${resp.status}`);
      res.status(502).json(error("审核平台调用失败", { status: resp.status }));
      return;
    }

    // 成功后即时 re-poll(fire-and-forget 唯一处:gate:state 广播由 diff 驱动)。
    void service.pollNow(scope).catch(() => {});
    res.json(success({ applied: true, gateId: gateToken }));
  } catch (err) {
    console.error(`${LOG_PREFIX} 失败`, err);
    res.status(502).json(error("审核平台调用失败", err instanceof Error ? err.message : String(err)));
  }
});

export default router;
