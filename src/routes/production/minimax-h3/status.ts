/**
 * MiniMax H3 — 任务状态轮询
 *
 * GET /api/production/minimax-h3/status/:promptId
 *
 * 单次查询 ComfyUI /history/{promptId} 并返回当前状态,
 * 客户端按需反复调用(非阻塞长轮询)。返回:
 *   - queued     : 还没入队 / 正在排队(/history 里尚无该 promptId)
 *   - executing  : 执行中(status_str 非 success/error)
 *   - success    : 完成,data.outputs 含 ComfyUI 输出(webm 等)
 *   - error      : 失败,data.error 含错误信息
 */

import express from "express";
import axios from "axios";
import { success, error } from "@/lib/responseFormat";
import { H3_CONFIG } from "./config";

const router = express.Router();

router.get("/:promptId", async (req, res) => {
  const promptId = req.params.promptId;
  if (!promptId) {
    return res.status(400).send(error("promptId is required"));
  }

  try {
    const resp = await axios.get(`${H3_CONFIG.comfyuiUrl}/history/${promptId}`, {
      timeout: 10_000,
    });

    const entry = resp.data?.[promptId];
    if (!entry) {
      // /history 里还没有这条记录 → 排队中
      return res.send(success({ promptId, status: "queued" }, "Task queued"));
    }

    const statusStr = entry.status?.status_str;

    if (statusStr === "success") {
      return res.send(success({
        promptId,
        status: "success",
        outputs: entry.outputs || {},
      }, "Task completed"));
    }

    if (statusStr === "error") {
      const errMsg = JSON.stringify(
        entry.status?.messages || entry.status || "Unknown error",
      ).slice(0, 1000);
      return res.send(success({ promptId, status: "error", error: errMsg }, "Task failed"));
    }

    // 其余状态视为执行中
    return res.send(success({ promptId, status: statusStr || "executing" }, "Task running"));
  } catch (err: any) {
    const msg = err.response?.data?.error?.message || err.message || String(err);
    return res.status(502).send(error(`Failed to query ComfyUI history: ${msg}`));
  }
});

export default router;
