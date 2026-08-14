/**
 * MiniMax Music3 — 任务状态轮询
 *
 * GET /api/production/music3/status/:taskId
 *
 * 透传 music3 server (:5112) 的 /status/<task_id>, 单次查询 (非阻塞长轮询),
 * 客户端按需反复调用。返回:
 *   - pending   : 排队中 (模型加载 / 等待 GPU 锁)
 *   - running   : 生成中
 *   - completed : 完成, data.audioUrl / data.audioPath 可用
 *   - error     : 失败, data.error 含错误信息
 *
 * 状态语义与 minimax-h3 status (ComfyUI /history 透传) 一致。
 */

import express from "express";
import { success, error } from "@/lib/responseFormat";
import { MUSIC3_CONFIG } from "./config";

const router = express.Router();

router.get("/:taskId", async (req, res) => {
  const taskId = req.params.taskId;
  if (!taskId) {
    return res.status(400).send(error("taskId is required"));
  }

  try {
    const resp = await fetch(`${MUSIC3_CONFIG.serverUrl}/status/${taskId}`, {
      signal: AbortSignal.timeout(10_000),
    });

    if (resp.status === 404) {
      return res.send(success({ taskId, status: "unknown" }, "未知任务 (server 已重启或 taskId 无效)"));
    }
    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      return res.status(502).send(error(`music3 server 状态查询失败 (${resp.status}): ${txt.slice(0, 300)}`));
    }

    const st = (await resp.json()) as Record<string, any>;

    // 把 server 内部 state (pending/running/done/error) 归一为 KAP 语义
    const stateMap: Record<string, string> = {
      pending: "pending",
      running: "running",
      done: "completed",
      error: "error",
    };
    const status = stateMap[st.state] || st.state || "unknown";

    return res.send(
      success(
        {
          taskId,
          status,
          audioPath: st.path || null,
          audioUrl: st.state === "done" ? `${MUSIC3_CONFIG.publicServerUrl}/file/${taskId}` : null,
          durationSec: st.duration_sec ?? null,
          sampleRate: st.sample_rate ?? null,
          seedUsed: st.seed_used ?? null,
          genSeconds: st.gen_seconds ?? null,
          error: st.error || null,
        },
        status === "completed"
          ? "生成完成"
          : status === "error"
            ? "生成失败"
            : "任务进行中",
      ),
    );
  } catch (err: any) {
    const msg = err.message || String(err);
    // server 离线
    if (/fetch failed|network|ECONN|timeout/i.test(msg)) {
      return res.status(503).send(error(`Music3 server 不可达 (${MUSIC3_CONFIG.serverUrl}): ${msg}`));
    }
    return res.status(500).send(error(`状态查询异常: ${msg}`));
  }
});

export default router;
