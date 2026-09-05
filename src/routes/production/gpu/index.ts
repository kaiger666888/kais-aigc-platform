/**
 * GET  /api/production/gpu/scheduling        — per-GPU 调度快照 (观测面, 无 token)
 * POST /api/production/gpu/scheduling/renew  — dev-P0 TTL 续期 (管理面, 需 token)
 * POST /api/production/gpu/scheduling/release— 手动归还 dev 占用 (管理面, 需 token)
 * POST /api/production/gpu/preempt           — 手动强制打断 (T2, dev-P0 语义, 需 token)
 * GET  /api/production/gpu/persona           — GPU2 双人格状态+事件 (观测面, 无 token)
 * POST /api/production/gpu/persona           — 手动人格切换 (dev-P0 语义, 需 token)
 * POST /api/production/gpu/persona/dry-run   — 切换计划 dry-run (零副作用, 需 token)
 *
 * M1+M2 双卡调度 (docs/gpu-scheduling-architecture.md §2.5 可观测 API):
 *   - scheduling: per-GPU 队列深度/在跑/优先级分布/dev-TTL 剩余/preempt 态 + 事件环
 *   - persona:    当前人格/期望人格/切换历史; POST 记录期望态 (dev-P0 语义)
 *
 * ⚠️ 安全: 与 gpu-queue 同款守卫 — 服务绑 *:10588 全接口, 管理端点 (会实际改变
 * 调度状态: 硬杀/占卡/切人格) 必须挂 KAP_ADMIN_TOKEN Bearer 校验:
 *   - env KAP_ADMIN_TOKEN 未设置 → POST 端点一律 404 (对外当不存在)
 *   - 设置后要求 Authorization: Bearer <token>, 不匹配 → 401
 *   - GET 为纯观测面, 只读不改状态, 不需要 token
 *
 * 全响应走 KAP 信封 {code, data, message} (success/error, 见 @/lib/responseFormat)。
 */

import express from "express";
import { success, error } from "@/lib/responseFormat";
import { getGpuSchedulerAsync, getPersonaArbiterAsync } from "@/services/gpu";

const router = express.Router();

// ─── token 守卫 (仿 gpu-queue/index.ts withAdminToken) ──────────────────────
type AdminHandler = (req: express.Request, res: express.Response) => unknown;

function withAdminToken(handler: AdminHandler): express.RequestHandler {
  return async (req, res) => {
    const expected = process.env.KAP_ADMIN_TOKEN;
    if (!expected) {
      res.status(404).send(error("Not Found"));
      return;
    }
    if (req.headers.authorization !== `Bearer ${expected}`) {
      res.status(401).send(error("无效的管理 token"));
      return;
    }
    await handler(req, res);
  };
}

// ─── body 公共校验 ──────────────────────────────────────────────────────────
function parseGpuIndex(v: unknown): number | "bad" {
  if (!Number.isInteger(v)) return "bad";
  return v as number;
}
function parseOptionalTtlMin(v: unknown): number | "bad" | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== "number" || !Number.isFinite(v) || v < 1 || v > 480) return "bad";
  return v;
}
function parseOptionalRequester(v: unknown): string | undefined | "bad" {
  if (v === undefined) return undefined;
  if (typeof v !== "string" || !v.trim()) return "bad";
  return v.trim();
}

// ─── M1: scheduling ─────────────────────────────────────────────────────────

router.get("/scheduling", async (_req, res) => {
  try {
    const scheduler = await getGpuSchedulerAsync();
    const snapshot = await scheduler.getSchedulingState();
    return res.status(200).send(success(snapshot));
  } catch (err: any) {
    return res.status(500).send(error(err?.message || String(err)));
  }
});

// POST /scheduling/renew — dev-P0 续期 (重置 TTL 计时)
// body: { gpuIndex: number, ttlMin?: number (1-480, 缺省沿用原授予值), requester?: string }
router.post("/scheduling/renew", withAdminToken(async (req, res) => {
  const gpuIndex = parseGpuIndex(req.body?.gpuIndex);
  if (gpuIndex === "bad") return res.status(400).send(error("gpuIndex 必须为整数"));
  const ttlMin = parseOptionalTtlMin(req.body?.ttlMin);
  if (ttlMin === "bad") return res.status(400).send(error("ttlMin 必须为 1-480 的分钟数"));
  const requester = parseOptionalRequester(req.body?.requester);
  if (requester === "bad") return res.status(400).send(error("requester 必须为非空字符串"));
  try {
    const scheduler = await getGpuSchedulerAsync();
    const result = await scheduler.renewDevTtl(gpuIndex, { ttlMin, requester });
    if (!result.ok) return res.status(409).send(error(result.error));
    return res.status(200).send(success(result.ttl));
  } catch (err: any) {
    return res.status(500).send(error(err?.message || String(err)));
  }
}));

// POST /scheduling/release — 手动归还 dev 占用 (TTL 到期自动归还的人工对应)
// body: { gpuIndex: number, requester?: string }
router.post("/scheduling/release", withAdminToken(async (req, res) => {
  const gpuIndex = parseGpuIndex(req.body?.gpuIndex);
  if (gpuIndex === "bad") return res.status(400).send(error("gpuIndex 必须为整数"));
  const requester = parseOptionalRequester(req.body?.requester);
  if (requester === "bad") return res.status(400).send(error("requester 必须为非空字符串"));
  try {
    const scheduler = await getGpuSchedulerAsync();
    const result = await scheduler.releaseDevOccupation(gpuIndex, requester);
    if (!result.ok) return res.status(409).send(error(result.error));
    return res.status(200).send(success({ ok: true }));
  } catch (err: any) {
    return res.status(500).send(error(err?.message || String(err)));
  }
}));

// POST /preempt — 手动强制打断 (T2 硬杀 + 占卡起算 TTL; dev-P0 专属)
// body: { gpuIndex: number, requester: string, ttlMin?: number, priorityClass?: "dev-P0" }
router.post("/preempt", withAdminToken(async (req, res) => {
  const gpuIndex = parseGpuIndex(req.body?.gpuIndex);
  if (gpuIndex === "bad") return res.status(400).send(error("gpuIndex 必须为整数"));
  const ttlMin = parseOptionalTtlMin(req.body?.ttlMin);
  if (ttlMin === "bad") return res.status(400).send(error("ttlMin 必须为 1-480 的分钟数"));
  const priorityClass = req.body?.priorityClass;
  if (priorityClass !== undefined && priorityClass !== "dev-P0") {
    return res.status(400).send(error("手动强制打断是 dev-P0 语义 (force 与其他优先级类为非法组合)"));
  }
  const requester = typeof req.body?.requester === "string" ? req.body.requester.trim() : "";
  try {
    const scheduler = await getGpuSchedulerAsync();
    const result = await scheduler.forcePreempt(gpuIndex, {
      requester,
      ttlMin,
      priorityClass: priorityClass === "dev-P0" ? "dev-P0" : undefined,
    });
    if (!result.ok) return res.status(400).send(error(result.error));
    return res.status(200).send(success(result));
  } catch (err: any) {
    return res.status(500).send(error(err?.message || String(err)));
  }
}));

// ─── M2: persona ────────────────────────────────────────────────────────────

router.get("/persona", async (_req, res) => {
  try {
    const arbiter = await getPersonaArbiterAsync();
    const state = await arbiter.getState();
    return res.status(200).send(success({
      ...state,
      events: arbiter.getEvents(),
      executor: "dry-run-only (TODO M3: 真实执行器 — 停 QC 服务序列/起容器)",
    }));
  } catch (err: any) {
    return res.status(500).send(error(err?.message || String(err)));
  }
});

// POST /persona — 手动切换请求 (dev-P0 语义, 记录期望态并逻辑生效)
// body: { to: "A"|"B", requester?: string, priorityClass?: "dev-P0" }
router.post("/persona", withAdminToken(async (req, res) => {
  const { to } = req.body || {};
  if (to !== "A" && to !== "B") return res.status(400).send(error('to 只支持 "A" (QC 驻留) 或 "B" (渲染溢出)'));
  const priorityClass = req.body?.priorityClass;
  if (priorityClass !== undefined && priorityClass !== "dev-P0") {
    return res.status(400).send(error("手动人格切换是 dev-P0 语义"));
  }
  const requester = parseOptionalRequester(req.body?.requester);
  if (requester === "bad") return res.status(400).send(error("requester 必须为非空字符串"));
  try {
    const arbiter = await getPersonaArbiterAsync();
    const result = await arbiter.requestPersona(to, { requester, priorityClass: priorityClass === "dev-P0" ? "dev-P0" : undefined });
    if (!result.ok) return res.status(400).send(error(result.error));
    return res.status(200).send(success({ state: result.state, plan: result.plan }));
  } catch (err: any) {
    return res.status(500).send(error(err?.message || String(err)));
  }
}));

// POST /persona/dry-run — 切换计划预览 (零副作用; 本批交付的 dry-run 实现)
// body: { to: "A"|"B" }
router.post("/persona/dry-run", withAdminToken(async (req, res) => {
  const { to } = req.body || {};
  if (to !== "A" && to !== "B") return res.status(400).send(error('to 只支持 "A" (QC 驻留) 或 "B" (渲染溢出)'));
  try {
    const arbiter = await getPersonaArbiterAsync();
    const plan = arbiter.buildSwitchPlan(to);
    return res.status(200).send(success({ plan, note: "dry-run 零副作用; 真实执行器属 M3" }));
  } catch (err: any) {
    return res.status(500).send(error(err?.message || String(err)));
  }
}));

export default router;
