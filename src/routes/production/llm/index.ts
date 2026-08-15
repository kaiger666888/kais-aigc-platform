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
 */

import express from "express";
import { execFile } from "child_process";
import { promisify } from "util";
import { success, error } from "@/lib/responseFormat";
import { getGpuSchedulerAsync } from "@/services/gpu";

const execFileAsync = promisify(execFile);

const KAP_LLM_SCRIPT = "/opt/qwen-llm/kap-llm.sh";
const LLM_SERVICE_ID = "qwen-llm";
// qwen-eye 统一引擎标识 — caller 侧 (KMC vision_verify / p04 / p11c) 的
// 返回 payload 均带同一 engine 值。
const QWEN_EYE_ENGINE = "qwen-eye" as const;
const QWEN_EYE_MODEL = "Qwen3.8-27B (mmproj VL, llama.cpp :8125)" as const;

const router = express.Router();

router.post("/allocate", async (req, res) => {
  const { variantId, caller, autoRelease } = req.body || {};
  if (variantId !== undefined && variantId !== "q3" && variantId !== "q4") {
    return res.status(400).send(error('variantId 只支持 "q3" 或 "q4"'));
  }
  try {
    const scheduler = await getGpuSchedulerAsync();
    const result = await scheduler.allocate({
      serviceId: LLM_SERVICE_ID,
      variantId,
      caller: typeof caller === "string" && caller ? caller : "api:llm/allocate",
      autoRelease,
    });
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
