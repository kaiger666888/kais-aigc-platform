/**
 * qwen-eye (Qwen3.8-27B 本地 VL 视觉判定引擎) — GPU 调度入口
 *
 * POST /api/production/llm/allocate — 经 GpuScheduler 拉起/确认 qwen-llm 服务
 *   body: { variantId?: "q3"|"q4", caller?: string, autoRelease?: boolean }
 *   返回 AllocationResult (granted / accessUrl / evictedServices / ...) + engine 字段
 *
 * POST /api/production/llm/release — 显式释放 qwen-llm (空闲释放之外的兜底)
 *   body: { caller?: string }  → { ok: true }
 *
 * GET /api/production/llm/status — 调度器全量状态 + kap-llm.sh status 的 JSON 输出
 *   子进程失败时 llm 字段置 null, scheduler 部分照常返回 (含 engine/model 标识)。
 *
 * GPU 全局串行队列接入 (2026-08-16 二期):
 *   qwen-eye (llama-server ~14.7G) 走 GpuScheduler, 与 gpuVramManager 互不知情
 *   → 20:47 撞车根因 (TTS 预检放行 → qwen-eye 拉起 → TTS 合成时 vram_insufficient)。
 *   现在 allocate 排队等 GPU1 锁, 拉起成功后把锁转为「服务级占用」
 *   (acquireEngineOccupancy) — 横跨多个 HTTP 请求直到 /release 或 idle 超时,
 *   期间 TTS/H3/music3 提交会在队列里等待。GpuScheduler 的 idle 停服路径
 *   (30min) 无法回调本模块, 故释放以 /release 为主; 服务被 idle 停掉后
 *   下一次 allocate 的占位是幂等的 (同 engine 重复 acquire 为 no-op)。
 */

import express from "express";
import { execFile } from "child_process";
import { promisify } from "util";
import { success, error } from "@/lib/responseFormat";
import {
  withGpuQueue,
  acquireEngineOccupancy,
  releaseEngineOccupancy,
  GPU_QUEUE_DEFAULT_INDEX,
} from "@/lib/gpuVramManager";
import { getGpuSchedulerAsync } from "@/services/gpu";

const execFileAsync = promisify(execFile);

const KAP_LLM_SCRIPT = "/opt/qwen-llm/kap-llm.sh";
const LLM_SERVICE_ID = "qwen-llm";
// qwen-eye 统一引擎标识 — caller 侧 (KMC vision_verify / p04 / p11c) 的
// 返回 payload 均带同一 engine 值。
const QWEN_EYE_ENGINE = "qwen-eye" as const;
const QWEN_EYE_MODEL = "Qwen3.8-27B (mmproj VL, llama.cpp :8125)" as const;
// qwen_eye 在 withGpuQueue 体系内的引擎键 (ENGINE_VRAM_REQUIREMENTS: 14GB)
const QWEN_EYE_QUEUE_KEY = "qwen_eye";

const router = express.Router();

router.post("/allocate", async (req, res) => {
  const { variantId, caller, autoRelease } = req.body || {};
  if (variantId !== undefined && variantId !== "q3" && variantId !== "q4") {
    return res.status(400).send(error('variantId 只支持 "q3" 或 "q4"'));
  }
  try {
    const scheduler = await getGpuSchedulerAsync();
    const callerId = typeof caller === "string" && caller ? caller : "api:llm/allocate";

    // ─── GPU 全局串行队列 (withGpuQueue 体系) ───
    // 排队等 GPU1 轮到 qwen_eye → GpuScheduler 拉起/确认服务 → 拉起成功则
    // 转服务级占用。skipVram: GpuScheduler.ensureVram 自带驱逐, 拉起前 free
    // 低于 14G (上一模型未卸载) 是常态, 不走 ensureVram 的重试环。
    const result = await withGpuQueue(
      QWEN_EYE_QUEUE_KEY,
      async () => {
        const result = await scheduler.allocate({
          serviceId: LLM_SERVICE_ID,
          variantId,
          caller: callerId,
          autoRelease,
        });
        if (result.granted) {
          // 拉起/确认成功 → 持有 GPU1 服务级占用 (幂等: 已持有则 no-op),
          // 直到 /release 或服务被外部停止。withGpuQueue fn 返回即释放本轮锁,
          // acquireEngineOccupancy 在释放前抢先把锁转交给自己 → 队列无缝。
          await acquireEngineOccupancy(QWEN_EYE_QUEUE_KEY, GPU_QUEUE_DEFAULT_INDEX);
        }
        return result;
      },
      { gpuIndex: GPU_QUEUE_DEFAULT_INDEX, skipVram: true },
    );

    return res.status(200).send(success({
      ...result,
      engine: QWEN_EYE_ENGINE,
      model: QWEN_EYE_MODEL,
    }));
  } catch (err: any) {
    return res.status(500).send(error(err?.message || String(err)));
  }
});

router.post("/release", async (req, res) => {
  const { caller } = req.body || {};
  try {
    const scheduler = await getGpuSchedulerAsync();
    // 先解除 GPU 队列的服务级占用 (唤醒排队中的重型引擎), 再停服务
    releaseEngineOccupancy(QWEN_EYE_QUEUE_KEY, GPU_QUEUE_DEFAULT_INDEX);
    await scheduler.release(LLM_SERVICE_ID, typeof caller === "string" && caller ? caller : "api:llm/release");
    return res.status(200).send(success({ ok: true }));
  } catch (err: any) {
    return res.status(500).send(error(err?.message || String(err)));
  }
});

router.get("/status", async (_req, res) => {
  const scheduler = await getGpuSchedulerAsync();
  const state = await scheduler.getState();

  let llm: any = null;
  try {
    const { stdout } = await execFileAsync("bash", [KAP_LLM_SCRIPT, "status"], { timeout: 15_000 });
    llm = JSON.parse(stdout);
  } catch (err: any) {
    llm = null; // 子进程失败 (脚本缺失/输出非 JSON) 不阻塞 scheduler 部分
  }

  return res.status(200).send(success({
    scheduler: state,
    llm,
    engine: QWEN_EYE_ENGINE,
    model: QWEN_EYE_MODEL,
  }));
});

export default router;
