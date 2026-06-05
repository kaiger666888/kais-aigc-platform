/**
 * 单节点 AI 评分 API
 * POST /api/canvas/review/score
 * Body: { projectId, episodesId, nodeId }
 */
import u from "@/utils";
import { scoreImageWithRetry, scoreCharacterConsistency, scoreDepthAccuracy, scoreUpscaleQuality, type AIScoreResult } from "@/lib/ai-scorer";

export default async function handler(req: any, res: any) {
  try {
    const { projectId, episodesId, nodeId, scoreType, compareImageId } = req.body || {};
    if (!projectId || !episodesId || !nodeId) {
      return res.json({ code: 400, msg: "缺少参数" });
    }

    // 1. 查找节点的缩略图路径
    let imagePath: string | null = null;
    let promptText: string | undefined;
    let compareImagePath: string | undefined;

    if (nodeId.startsWith("asset-")) {
      const assetId = nodeId.replace("asset-", "");
      const assetRow = await u.db("o_scriptAssets").where("id", assetId).first();
      if (!assetRow) return res.json({ code: 404, msg: "资产不存在" });
      const imageRow = assetRow.assetId ? await u.db("o_image").where("assetsId", assetRow.assetId).first() : null;
      imagePath = (imageRow as any)?.filePath || null;
      const assetData = assetRow.assetId ? await u.db("o_assets").where("id", assetRow.assetId).first() : null;
      promptText = (assetData as any)?.prompt || undefined;
    } else if (nodeId.startsWith("storyboard-")) {
      const sbId = nodeId.replace("storyboard-", "");
      const sb = await u.db("o_storyboard").where("id", sbId).first();
      if (!sb) return res.json({ code: 404, msg: "分镜不存在" });
      imagePath = sb.filePath || null;
      promptText = sb.prompt || undefined;
    } else {
      return res.json({ code: 400, msg: "不支持的节点类型" });
    }

    if (!imagePath) {
      return res.json({ code: 400, msg: "该节点没有图片" });
    }

    // 1b. 解析对比图路径（如果有 compareImageId）
    if (compareImageId) {
      if (compareImageId.startsWith("asset-")) {
        const cAssetId = compareImageId.replace("asset-", "");
        const cAssetRow = await u.db("o_scriptAssets").where("id", cAssetId).first();
        if (cAssetRow?.assetId) {
          const cImageRow = await u.db("o_image").where("assetsId", cAssetRow.assetId).first();
          compareImagePath = (cImageRow as any)?.filePath || undefined;
        }
      } else if (compareImageId.startsWith("storyboard-")) {
        const cSbId = compareImageId.replace("storyboard-", "");
        const cSb = await u.db("o_storyboard").where("id", cSbId).first();
        compareImagePath = cSb?.filePath || undefined;
      }
    }

    // 2. 调用 AI 评分（根据 scoreType 分支）
    let score: AIScoreResult;
    if (scoreType === "character" && compareImagePath) {
      score = await scoreCharacterConsistency(imagePath, compareImagePath, promptText);
    } else if (scoreType === "depth" && compareImagePath) {
      score = await scoreDepthAccuracy(imagePath, compareImagePath, promptText);
    } else if (scoreType === "upscale" && compareImagePath) {
      score = await scoreUpscaleQuality(imagePath, compareImagePath);
    } else {
      score = await scoreImageWithRetry(imagePath, promptText);
    }

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
        .update({ data: mappingStr });
    } else {
      await u.db("o_agentWorkData").insert({
        projectId: String(projectId) as any,
        episodesId: String(episodesId) as any,
        key: reviewKey,
        data: mappingStr,
      });
    }

    // 4. 广播更新
    try {
      const { broadcastToProject } = await import("@/utils/ws");
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
