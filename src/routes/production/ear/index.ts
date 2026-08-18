/**
 * qwen-ear (Qwen3-Omni-30B-A3B 本地音频判定引擎) — GPU 调度入口
 *
 * 对标 /api/production/llm (qwen-eye)。qwen-ear = 音频模态 (听), llama-server :8126,
 * Q4_K_M 18.56GB + mmproj 1.33GB ≈ 19.9GB → 3090 近独占, 与 qwen-eye 互斥
 * (allocate 时 GpuScheduler.ensureVram 自动驱逐对方, 先到先得)。
 *
 * POST /api/production/ear/allocate — 经 GpuScheduler 拉起/确认 qwen-ear 服务
 *   body: { caller?: string, autoRelease?: boolean }   (单档位 Q4_K_M, 无 variantId)
 *   返回 AllocationResult (granted / accessUrl / evictedServices / ...) + engine 字段
 *   幂等: qwen_ear 已持 GPU 占位且 :8126 健康时直接 granted (快速路径, 不重排队)。
 *
 * POST /api/production/ear/release — 显式释放 (空闲释放之外的兜底)
 *   body: { caller?: string }  → { ok: true }
 *
 * GET /api/production/ear/status — 调度器全量状态 + :8126 直连健康探测。
 *   不走 kap-ear.sh status (其 pgrep -f 判定有自匹配误报, 2026-08-18 实测复现;
 *   health 探测才是权威)。
 *
 * 推理直连 :8126 (OpenAI 兼容 /v1/chat/completions, input_audio), 与 qwen-eye
 * 的消费方模式一致 — 本路由只管 GPU 生命周期, 不代理推理。
 *
 * GPU 全局串行队列: 与 llm/index.ts 同款 — allocate 排队等 GPU1 锁, 拉起成功后
 * acquireEngineOccupancy 转服务级占用 (横跨多个 HTTP 请求直到 /release 或 idle)。
 * 已知残留 (与 qwen-eye 相同): GpuScheduler idle/驱逐停服不会回调本模块释放占位,
 * 故本路由 allocate 前先自愈 — 持占位但 :8126 已死 → 视为残留, 释放后走正常路径。
 */

import express from "express";
import axios from "axios";
import { success, error } from "@/lib/responseFormat";
import {
  withGpuQueue,
  acquireEngineOccupancy,
  releaseEngineOccupancy,
  getGpuQueueStatus,
  GPU_QUEUE_DEFAULT_INDEX,
} from "@/lib/gpuVramManager";
import { getGpuSchedulerAsync } from "@/services/gpu";

const EAR_SERVICE_ID = "qwen-ear";
// qwen-ear 统一引擎标识 — 消费方 (KMC p10c / KST audio_semantic) 返回 payload 用同一值
const QWEN_EAR_ENGINE = "qwen-ear" as const;
const QWEN_EAR_MODEL = "Qwen3-Omni-30B-A3B (mmproj audio, llama.cpp :8126)" as const;
// qwen_ear 在 withGpuQueue 体系内的引擎键 (ENGINE_VRAM_REQUIREMENTS: 21.5GB)
const QWEN_EAR_QUEUE_KEY = "qwen_ear";

const EAR_HEALTH_URL = "http://127.0.0.1:8126/health";

const router = express.Router();

/** :8126 健康探测 (3s) — server 在跑的唯一权威判据 */
async function earHealthOk(): Promise<boolean> {
  try {
    await axios.get(EAR_HEALTH_URL, { timeout: 3_000 });
    return true;
  } catch {
    return false;
  }
}

router.post("/allocate", async (req, res) => {
  const { caller, autoRelease } = req.body || {};
  try {
    const scheduler = await getGpuSchedulerAsync();
    const callerId = typeof caller === "string" && caller ? caller : "api:ear/allocate";

    // ─── 幂等/自愈快速路径: GPU1 占位已在 qwen_ear 手上 ───
    // 跨请求重复 allocate 不能再进 withGpuQueue (会在自家服务级占位后排队能挂死,
    // 队列等待无超时)。占位 + 健康 → 直接 granted; 占位 + 已死 → 残留, 释放再排队。
    const holder = getGpuQueueStatus().holders[GPU_QUEUE_DEFAULT_INDEX];
    if (holder?.engine === QWEN_EAR_QUEUE_KEY) {
      if (await earHealthOk()) {
        // scheduler.allocate 对 healthy 态是快速确认 (刷新 lastRequestAt/idle 钟)
        const result = await scheduler.allocate({
          serviceId: EAR_SERVICE_ID,
          caller: callerId,
          autoRelease,
        });
        return res.status(200).send(success({
          ...result,
          engine: QWEN_EAR_ENGINE,
          model: QWEN_EAR_MODEL,
          fastPath: "already-occupied",
        }));
      }
      console.warn("[ear] qwen_ear 服务级占位残留 (:8126 已死) — 自动释放后走正常拉起路径");
      releaseEngineOccupancy(QWEN_EAR_QUEUE_KEY, GPU_QUEUE_DEFAULT_INDEX);
    }

    // ─── GPU 全局串行队列 (withGpuQueue 体系, 同 llm 路由) ───
    // skipVram: GpuScheduler.ensureVram 自带驱逐; 拉起前 free ≥21.5GB 几乎必假
    // (music3 常驻 6.7GB / qwen-eye 未退场时), 走预检只会白白 fail-fast。
    const result = await withGpuQueue(
      QWEN_EAR_QUEUE_KEY,
      async () => {
        const result = await scheduler.allocate({
          serviceId: EAR_SERVICE_ID,
          caller: callerId,
          autoRelease,
        });
        if (result.granted) {
          // 拉起成功 → 服务级占用 (幂等), 直到 /release 或服务被外部停止。
          // 外层 withGpuQueue 返回时锁已转交本占用 → release 变 no-op。
          await acquireEngineOccupancy(QWEN_EAR_QUEUE_KEY, GPU_QUEUE_DEFAULT_INDEX);
        }
        return result;
      },
      { gpuIndex: GPU_QUEUE_DEFAULT_INDEX, skipVram: true },
    );

    return res.status(200).send(success({
      ...result,
      engine: QWEN_EAR_ENGINE,
      model: QWEN_EAR_MODEL,
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
    releaseEngineOccupancy(QWEN_EAR_QUEUE_KEY, GPU_QUEUE_DEFAULT_INDEX);
    await scheduler.release(EAR_SERVICE_ID, typeof caller === "string" && caller ? caller : "api:ear/release");
    return res.status(200).send(success({ ok: true }));
  } catch (err: any) {
    return res.status(500).send(error(err?.message || String(err)));
  }
});

router.get("/status", async (_req, res) => {
  const scheduler = await getGpuSchedulerAsync();
  const state = await scheduler.getState();

  // 直连 health 探测 (不走 kap-ear.sh status — pgrep -f 自匹配误报, 见文件头)
  const healthy = await earHealthOk();

  return res.status(200).send(success({
    scheduler: state,
    ear: { running: healthy, port: 8126, health: healthy ? "ok" : "unreachable" },
    engine: QWEN_EAR_ENGINE,
    model: QWEN_EAR_MODEL,
  }));
});

export default router;
