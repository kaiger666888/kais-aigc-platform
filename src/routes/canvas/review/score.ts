/**
 * 单节点 AI 评分 API
 * POST /api/canvas/review/score
 * Body: { projectId, episodesId, nodeId }
 */
import u from "@/utils";
import { scoreImageWithRetry, type AIScoreResult } from "@/lib/ai-scorer";

export default async function handler(req: any, res: any) {
  try {
    const { projectId, episodesId, nodeId } = req.body || {};
    if (!projectId || !episodesId || !nodeId) {
      return res.json({ code: 400, msg: "缺少参数" });
    }

    // 1. 查找节点的缩略图路径
    let imagePath: string | null = null;
    let promptText: string | undefined;

    if (nodeId.startsWith("asset-")) {
      const assetId = nodeId.replace("asset-", "");
      const asset = await u.db("o_scriptAssets").where("id", assetId).first();
      if (!asset) return res.json({ code: 404, msg: "资产不存在" });
      imagePath = asset.filePath || asset.src || null;
      promptText = asset.prompt || undefined;
    } else if (nodeId.startsWith("storyboard-")) {
      const sbId = nodeId.replace("storyboard-", "");
      const sb = await u.db("o_storyboards").where("id", sbId).first();
      if (!sb) return res.json({ code: 404, msg: "分镜不存在" });
      imagePath = sb.filePath || sb.src || null;
      promptText = sb.prompt || undefined;
    } else {
      return res.json({ code: 400, msg: "不支持的节点类型" });
    }

    if (!imagePath) {
      return res.json({ code: 400, msg: "该节点没有图片" });
    }

    // 2. 调用 AI 评分
    const score = await scoreImageWithRetry(imagePath, promptText);

    // 3. 写回 o_agentWorkData
    const reviewKey = `reviewStatus-${episodesId}`;
    const existing = await u.db("o_agentWorkData")
      .where("projectId", String(projectId))
      .andWhere("episodesId", String(episodesId))
      .andWhere("key", reviewKey)
      .first();

    let reviewMapping: Record<string, any> = {};
    if (existing?.data) {
      try {
        reviewMapping = typeof existing.data === "string" ? JSON.parse(existing.data) : existing.data;
      } catch {
        reviewMapping = {};
      }
    }

    // 更新该节点的评分
    if (!reviewMapping[nodeId]) reviewMapping[nodeId] = {};
    reviewMapping[nodeId].aiScore = score;

    // 写回数据库
    const mappingStr = JSON.stringify(reviewMapping);
    if (existing) {
      await u.db("o_agentWorkData")
        .where("id", existing.id)
        .update({ data: mappingStr, updatedAt: new Date().toISOString() });
    } else {
      await u.db("o_agentWorkData").insert({
        projectId: String(projectId),
        episodesId: String(episodesId),
        key: reviewKey,
        data: mappingStr,
      });
    }

    // 4. 广播更新
    try {
      const { broadcastToProject } = await import("@/routes/canvas/ws-broadcast");
      broadcastToProject(projectId, "node:state", {
        nodeId,
        state: "scored",
        aiScore: score,
      });
    } catch {
      // WS 不可用不影响结果
    }

    return res.json({
      code: 200,
      data: { score },
      msg: "评分完成",
    });
  } catch (err: any) {
    console.error("[canvas/review/score] 错误:", err);
    return res.json({ code: 500, msg: err.message || "评分失败" });
  }
}
