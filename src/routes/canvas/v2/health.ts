import express from "express";
import u from "@/utils";
import { success, error } from "@/lib/responseFormat";

const router = express.Router();

/**
 * GET /api/canvas/v2/health
 *
 * Canvas v2 烟雾测试端点。外部编排器（OpenClaw / hermes-agent / 任何客户端）
 * 启动时调用一次即可验证：
 *   1. HTTP 服务在线
 *   2. 数据库连通（kv_canvasEvent 表可读）
 *   3. projectId / episodesId 配置匹配实际数据
 *   4. 事件流活跃度（最近一次事件时间戳）
 *
 * 不返回敏感信息（认证、路径、用户数据），适合无鉴权探活。
 */
router.get("/", async (_req, res) => {
  const timestamp = Date.now();

  try {
    const scopeRows: any[] = await u
      .db("kv_canvasEvent")
      .select("projectId", "episodesId")
      .count("* as eventCount")
      .max("eventId as lastEventId")
      .max("createdAt as lastEventAt")
      .groupBy("projectId", "episodesId")
      .orderBy("lastEventAt", "desc")
      .limit(20);

    const totalRow: any = await u.db("kv_canvasEvent").count("* as total").first();
    const totalEvents = Number(totalRow?.total ?? 0);

    return res.status(200).send(
      success({
        timestamp,
        canvas: {
          totalScopes: scopeRows.length,
          totalEvents,
          scopes: scopeRows.map((r: any) => ({
            projectId: Number(r.projectId),
            episodesId: Number(r.episodesId),
            eventCount: Number(r.eventCount),
            lastEventId: r.lastEventId != null ? Number(r.lastEventId) : null,
            lastEventAt: r.lastEventAt != null ? Number(r.lastEventAt) : null,
          })),
        },
      }),
    );
  } catch (err) {
    console.error("[v2/canvas/health] 探活失败:", err);
    return res.status(503).send(error("画布服务不可用"));
  }
});

export default router;
