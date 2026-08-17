/**
 * MiniMax Music3 — 文本到音乐生成
 *
 * POST /api/production/music3/generate
 *
 * 把请求代理到独立 diffusers HTTP server (:5112, /opt/music3-server.py)。
 * Music3 不走 ComfyUI (容器无节点), 故本路由是纯 HTTP 代理 + 异步/同步两种语义。
 *
 * Body (JSON):
 *   prompt              : string  (required — 音乐描述: genre / BPM / key / vocal / arrangement)
 *   lyrics              : string  (optional — 歌词, 带 [Verse]/[Chorus] 等结构标签, 各占一行)
 *   duration            : number  (optional — 秒, 1-360, 默认 30)
 *   seed                : number  (optional — -1=随机, 默认 7)
 *   num_inference_steps : number  (optional — int 1-100, flow-matching 每 chunk 步数, 默认 30)
 *   format              : string  (optional — "wav", 当前仅支持 wav)
 *   wait                : boolean (optional — true=同步等待完成; 默认 false=异步返回 taskId)
 *
 * 注: guidance_scale 1.7 是 pipe FrozenDict 冻结配置不可传; 无 negative_prompt 等参数。
 *
 * 异步 (默认, wait=false):
 *   → { taskId, status:"processing", statusUrl, audioUrl }
 *   客户端轮询 GET /api/production/music3/status/:taskId 直到 status="completed"
 *
 * 同步 (wait=true):
 *   → 轮询 server 直到完成 → { taskId, status:"completed", audioPath, audioUrl, durationSec, ... }
 *
 * VRAM 注意: Music3 ~22GB, 与 ComfyUI 主模型互斥。server 启动时已 POST ComfyUI /free。
 * 若 server 未运行, 本路由返回 503 + 启动提示。
 */

import express from "express";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { withGpuQueue } from "@/lib/gpuVramManager";
import { validateFields } from "@/middleware/middleware";
import { MUSIC3_CONFIG, MUSIC3_CONSTANTS, MUSIC3_DEFAULTS } from "./config";

const router = express.Router();

// ─── Helpers ────────────────────────────────────────────────────────────────

/** 健康检查 music3 server 是否在线 */
async function serverUp(): Promise<boolean> {
  try {
    const r = await fetch(`${MUSIC3_CONFIG.serverUrl}/health`, { signal: AbortSignal.timeout(3000) });
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * VRAM 预检需求覆盖 (2026-08-17 结构性死锁修复):
 *
 * 根因: ENGINE_VRAM_REQUIREMENTS.music3 = 22528MiB (满卡) 是「首次加载」的需求;
 * 但 music3-server 是常驻进程 —— 模型加载后权重经 MUSIC3_CPU_OFFLOAD 驻留,
 * server 自身只占 GPU ~256MiB, 生成峰值增量也只需 ~6GB。server 常驻时若仍按
 * 22528 预检, free 永远 < 22528 (别的进程/残留总占着卡), m3 任务 100% 排队
 * 1800s 后 vram_insufficient (实证: free 5158MiB < need 22528MiB 死循环)。
 *
 * 修正: 锁前查 /health ——
 *   model_loaded=true  (模型已驻留) → 按增量 6144MiB 预检
 *   model_loaded=false (server 空载) → 维持表值 22528MiB (首次加载需满卡)
 *   health 查询失败            → 保守按表值 22528MiB
 * 覆盖后的预检天然处理「其他引擎占卡」: free < 6GB 仍会排队等待。
 */
const MUSIC3_WARM_REQUIRE_VRAM_MIB = 6144; // server 常驻时生成峰值增量 ~6GB

async function resolveRequireVramMiB(): Promise<number | undefined> {
  try {
    const r = await fetch(`${MUSIC3_CONFIG.serverUrl}/health`, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) return undefined; // 查询失败 → 保守按表值
    const h = (await r.json()) as { model_loaded?: boolean };
    return h.model_loaded === true ? MUSIC3_WARM_REQUIRE_VRAM_MIB : undefined;
  } catch {
    return undefined; // 查询失败 → 保守按表值
  }
}

/** 提交生成任务 → 返回 task_id */
async function submitTask(body: {
  prompt: string;
  lyrics: string;
  duration: number;
  seed: number;
  num_inference_steps: number;
}): Promise<{ task_id: string; state: string }> {
  const resp = await fetch(`${MUSIC3_CONFIG.serverUrl}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error(`music3 server rejected (${resp.status}): ${txt.slice(0, 500)}`);
  }
  return (await resp.json()) as { task_id: string; state: string };
}

/** 单次查询任务状态 */
async function queryStatus(taskId: string): Promise<Record<string, any>> {
  const resp = await fetch(`${MUSIC3_CONFIG.serverUrl}/status/${taskId}`);
  if (!resp.ok) throw new Error(`status query failed (${resp.status})`);
  return (await resp.json()) as Record<string, any>;
}

/** 同步轮询直到 done/error/timeout */
async function pollUntilDone(taskId: string): Promise<Record<string, any>> {
  const deadline = Date.now() + MUSIC3_CONFIG.pollTimeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, MUSIC3_CONFIG.pollIntervalMs));
    const st = await queryStatus(taskId);
    if (st.state === "done" || st.state === "error") return st;
  }
  throw new Error(`timeout after ${MUSIC3_CONFIG.pollTimeoutMs / 1000}s — 仍可用 status 端点查询`);
}

function publicFileUrl(taskId: string): string {
  return `${MUSIC3_CONFIG.publicServerUrl}/file/${taskId}`;
}

// ─── Handler ────────────────────────────────────────────────────────────────

export default router.post(
  "/",
  validateFields({
    prompt: z.string().min(1, "音乐描述不能为空"),
    lyrics: z.string().optional(),
    duration: z.coerce.number().min(1).max(MUSIC3_CONSTANTS.MAX_DURATION).optional(),
    seed: z.coerce.number().optional(),
    num_inference_steps: z.coerce.number().int().min(1).max(MUSIC3_CONSTANTS.MAX_STEPS).optional(),
    format: z.literal("wav").optional(),
    wait: z.coerce.boolean().optional(),
  }),
  async (req, res) => {
    try {
      // server 在线预检
      if (!(await serverUp())) {
        return res.status(503).json(
          error(
            `Music3 server 未运行 (${MUSIC3_CONFIG.serverUrl})。` +
            `启动: cd /opt && nohup /opt/music3-env/bin/python /opt/music3-server.py > /tmp/music3-server.log 2>&1 &`,
          ),
        );
      }

      const prompt = req.body.prompt as string;
      const lyrics = (req.body.lyrics as string) || "";
      const duration = req.body.duration ?? MUSIC3_DEFAULTS.duration;
      const seed = req.body.seed ?? MUSIC3_DEFAULTS.seed;
      const numInferenceSteps = req.body.num_inference_steps ?? MUSIC3_DEFAULTS.numInferenceSteps;

      // ─── GPU 全局串行队列 (gpuVramManager withGpuQueue, 2026-08-16 二期) ───
      // Music3 ~22GB (近乎满卡), 与 ComfyUI 各引擎互斥。锁内「提交+同步等待完成」;
      // 异步模式锁只罩提交 (server 单任务串行, 提交返回即代表 GPU 已排他接管)。
      // requireVramMiB: server 常驻 (model_loaded) 时按增量 6GB 预检, 否则表值 22528
      // —— 见 resolveRequireVramMiB 注释 (结构性死锁根因)。
      const { taskId, finalState } = await withGpuQueue(
        "music3",
        async () => {
          const submitted = await submitTask({
            prompt,
            lyrics,
            duration,
            seed,
            num_inference_steps: numInferenceSteps,
          });
          const taskId = submitted.task_id;
          // 同步模式: 轮询直到完成 (持锁); 异步模式: 只提交
          const finalState = req.body.wait ? await pollUntilDone(taskId) : null;
          return { taskId, finalState };
        },
        { gpuIndex: 1, requireVramMiB: await resolveRequireVramMiB() },
      );

      // 异步模式: 立即返回 taskId
      if (!finalState) {
        return res.json(
          success(
            {
              taskId,
              status: "processing",
              // req.baseUrl 别名感知: m3 入口返回 /api/production/m3/status/...,
              // music3 入口返回 /api/production/music3/status/...
              statusUrl: `${req.baseUrl.replace(/\/generate$/, "")}/status/${taskId}`,
              audioUrl: publicFileUrl(taskId),
              duration,
              seed,
              numInferenceSteps,
            },
            "任务已提交",
          ),
        );
      }

      // 同步模式: 轮询结果已在锁内拿到
      if (finalState.state === "error") {
        return res.status(500).json(error(`生成失败: ${finalState.error || "unknown"}`));
      }
      return res.json(
        success(
          {
            taskId,
            status: "completed",
            audioPath: finalState.path,
            audioUrl: publicFileUrl(taskId),
            durationSec: finalState.duration_sec,
            sampleRate: finalState.sample_rate,
            seedUsed: finalState.seed_used,
            numInferenceSteps,
            genSeconds: finalState.gen_seconds,
          },
          "生成完成",
        ),
      );
    } catch (err: any) {
      return res.status(500).json(error(err.message || "Internal error"));
    }
  },
);
