/**
 * GET  /api/production/gpu-queue              — GPU 全局串行队列状态 (可观测性, 无 token)
 * POST /api/production/gpu-queue/force-release — 强制释放服务级占用 (管理面, 需 token)
 * POST /api/production/gpu-queue/purge-waiters — 清空排队等待者 (管理面, 需 token)
 *
 * GET 返回:
 *   holders          — 每张 GPU 当前持锁引擎 (null = 空闲) + 持锁时长
 *   waitingByEngine  — 各引擎当前排队数
 *   engineOrder      — 锁获取顺序约定 (ENGINE_VRAM_REQUIREMENTS 键排序, 防死锁)
 *   recentEvents     — 最近 20 条队列事件 (enqueue/acquire/release/vram_retry/timeout/...)
 *   waiters          — 排队 waiter 明细 [{engine, gpuIndex, waitedMs, position}]
 *   occupancyWatches — 占用看门狗注册状态 [{engine, gpuIndex, healthUrl, fails, threshold}]
 *
 * 详见 src/lib/gpuVramManager.ts (withGpuQueue, 2026-08-16 二期; 管理原语, 2026-08-19 三期)。
 *
 * ⚠️ 安全 (2026-08-19 三期 P2-B): 服务监听 *:10588 (全接口), 管理端点会实际改变队列
 * 状态 (强放占位 / 驱逐等待者), 必须挂 KAP_ADMIN_TOKEN Bearer 校验:
 *   - env KAP_ADMIN_TOKEN 未设置 → POST 端点一律 404 (对外当不存在, 不暴露管理面)
 *   - 设置后要求 Authorization: Bearer <token>, 不匹配 → 401
 *   - GET / 为纯观测面, 只读不改状态, 不需要 token
 */

import express from "express";
import { success, error } from "@/lib/responseFormat";
import {
  getGpuQueueStatus,
  getGpuStatus,
  ENGINE_VRAM_REQUIREMENTS,
  forceReleaseOccupancy,
  purgeWaiters,
  secondaryEnabled,
  cachedAvailGpu2,
  secondaryComfyuiUrl,
  gpu2EngineAllowlist,
} from "@/lib/gpuVramManager";

const router = express.Router();

// ─── token 守卫 (2026-08-19 三期 P2-B) ───────────────────────────────────────
// 小型前置校验包装: KAP_ADMIN_TOKEN 未设置 → 404 当端点不存在 (服务绑 *:10588 全接口,
// 不能裸暴露管理原语); 设置后 Bearer 不匹配 → 401。
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

// body 公共校验: engine 缺省 = 任意引擎; gpuIndex 缺省 = 走 GPU_QUEUE_DEFAULT_INDEX 默认
function parseScope(body: any): { engine?: string; gpuIndex?: number } | "bad" {
  const { engine, gpuIndex } = body || {};
  if (engine !== undefined && typeof engine !== "string") return "bad";
  if (gpuIndex !== undefined && !Number.isInteger(gpuIndex)) return "bad";
  return { engine, gpuIndex };
}

router.get("/", async (_req, res) => {
  const queue = getGpuQueueStatus(); // waiters / occupancyWatches (三期新字段) 随 ...queue 透传
  const gpus = await getGpuStatus(); // 5s 缓存, 顺带带出各卡 free/used
  return res.status(200).send(success({
    ...queue,
    // M4 双实例可观测: secondary 策略态 + 探活缓存 (cachedAvailGpu2 是 30s 缓存的同步读, 不发网络请求)
    secondary: {
      enabled: secondaryEnabled(),
      avail: cachedAvailGpu2(),
      url: secondaryComfyuiUrl(),
      engines: gpu2EngineAllowlist(),
    },
    vramRequirements: ENGINE_VRAM_REQUIREMENTS,
    gpus: gpus.map(({ index, name, totalMiB, usedMiB, freeMiB }) => ({
      index, name, totalMiB, usedMiB, freeMiB,
    })),
  }));
});

// ─── POST /force-release — 强制释放服务级占用 (2026-08-19 三期, D7 管理面) ────
// body: { engine?: string; gpuIndex?: number }
// 只对服务级占用 (occupancy) holder 生效; 作业中的普通 holder 拒绝强放 (避免双引擎同卡)。
// released=false 是运维查询结果 (GPU 空闲 / 引擎不匹配 / 作业中不可强放), 不是服务端错误 → 200。
router.post("/force-release", withAdminToken(async (req, res) => {
  const scope = parseScope(req.body);
  if (scope === "bad") return res.status(400).send(error("engine 必须为 string, gpuIndex 必须为整数"));
  // gpuIndex 传 undefined → forceReleaseOccupancy 参数默认值 GPU_QUEUE_DEFAULT_INDEX
  const result = forceReleaseOccupancy(scope.engine, scope.gpuIndex);
  return res.status(200).send(success(result));
}));

// ─── POST /purge-waiters — 清空排队等待者 (2026-08-19 三期, D7 管理面) ────────
// body: { engine?: string; gpuIndex?: number }
// 幽灵等待者 (客户端断连/提交方已死) 的手术刀; 被驱逐的等待方收到 QueuePurgedError。
router.post("/purge-waiters", withAdminToken(async (req, res) => {
  const scope = parseScope(req.body);
  if (scope === "bad") return res.status(400).send(error("engine 必须为 string, gpuIndex 必须为整数"));
  const { purged } = purgeWaiters(scope.engine, scope.gpuIndex);
  return res.status(200).send(success({ purged }));
}));

export default router;
