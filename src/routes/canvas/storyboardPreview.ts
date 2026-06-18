import express from "express";
import { z } from "zod";
import u from "@/utils";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { broadcastToProject } from "@/utils/ws";
import { submitEngineTask, pollEngineTask } from "./_engine";

const router = express.Router();

/**
 * Phase 38 (revised in v1.8) — 分镜构图预览。
 *
 * 接收 {projectId, episodesId, nodeId},仅支持 storyboard-* 节点。
 *
 * v1.8 改造:
 *   - GOLD_TEAM_URL 已配置 → 调用真实 IMAGE_DRAW 引擎,prompt 取自节点的 prompt 字段,
 *     linkedAssetIds 解析为 reference_images 作为 IP-Adapter 角色/风格参考。
 *   - GOLD_TEAM_URL 未配置 → 降级为 v1.7 占位模拟 (4s 延迟 + thumbnailUrl: null)
 *
 * 完成后通过 'node:preview' 通道广播 {nodeId, thumbnailUrl}。
 */
async function readStoryboardNode(
  projectId: number,
  episodesId: number,
  nodeId: string,
): Promise<{ prompt: string; referenceImages: string[] } | null> {
  const row = await u
    .db("o_agentWorkData")
    .where("projectId", String(projectId))
    .andWhere("episodesId", String(episodesId))
    .andWhere("key", "canvasGraph")
    .first();
  if (!row?.data) return null;
  try {
    const graph = JSON.parse(row.data) as {
      nodes?: Array<{ id: string; prompt?: string; data?: { prompt?: string; linkedAssetIds?: string[] }; linkedAssetIds?: string[] }>;
    };
    const node = (graph.nodes ?? []).find((n) => n.id === nodeId);
    if (!node) return null;

    const prompt =
      (typeof node.prompt === "string" && node.prompt) ||
      (typeof node.data?.prompt === "string" && node.data.prompt) ||
      "";

    // Resolve linked asset IDs to URLs (best-effort: read o_asset.url by id)
    const linkedIds =
      node.linkedAssetIds ?? node.data?.linkedAssetIds ?? [];
    const referenceImages: string[] = [];
    if (Array.isArray(linkedIds) && linkedIds.length) {
      const assets = await u
        .db("o_asset")
        .whereIn("id", linkedIds)
        .select("id", "url")
        .limit(10);
      for (const a of assets) {
        if (a?.url) referenceImages.push(a.url);
      }
    }
    return { prompt, referenceImages };
  } catch {
    return null;
  }
}

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    episodesId: z.number(),
    nodeId: z.string(),
  }),
  async (req, res) => {
    const { projectId, episodesId, nodeId } = req.body;

    if (!nodeId.startsWith("storyboard-")) {
      return res.status(400).send(error("仅分镜节点支持构图预览"));
    }

    res.status(200).send(success({ nodeId, status: "preview_triggered" }));

    setImmediate(async () => {
      try {
        // 无引擎配置 → v1.7 占位行为
        if (!process.env.GOLD_TEAM_URL) {
          console.log("[storyboardPreview] GOLD_TEAM_URL 未配置,降级为占位模拟");
          await new Promise((r) => setTimeout(r, 4000));
          broadcastToProject(projectId, "node:preview", {
            nodeId,
            thumbnailUrl: null,
            state: "preview_ready",
          });
          broadcastToProject(projectId, "node:state", { nodeId, state: "idle" });
          return;
        }

        const ctx = await readStoryboardNode(projectId, episodesId, nodeId);
        if (!ctx || !ctx.prompt) {
          console.log(
            `[storyboardPreview] nodeId=${nodeId} 未找到节点或 prompt 为空,降级模拟`,
          );
          await new Promise((r) => setTimeout(r, 4000));
          broadcastToProject(projectId, "node:preview", {
            nodeId,
            thumbnailUrl: null,
            state: "preview_ready",
          });
          broadcastToProject(projectId, "node:state", { nodeId, state: "idle" });
          return;
        }

        // 提交 IMAGE_DRAW 任务 (有参考图 → image_draw_ipadapter;否则纯 image_draw)
        const taskType = ctx.referenceImages.length
          ? "image_draw_ipadapter"
          : "image_draw";
        const taskId = await submitEngineTask({
          taskType,
          prompt: ctx.prompt,
          projectId,
          episodesId,
          nodeId,
          referenceImages: ctx.referenceImages,
          metadata: { kind: "storyboard_preview", ratio: "16:9" },
        });

        const result = await pollEngineTask(taskId);

        broadcastToProject(projectId, "node:preview", {
          nodeId,
          thumbnailUrl: result.outputUrl,
          state: "preview_ready",
        });
        broadcastToProject(projectId, "node:state", { nodeId, state: "idle" });
      } catch (err: any) {
        console.error("[canvas:storyboardPreview] 预览生成失败:", err.message);
        // 失败不阻塞主流程 — 广播一个 null thumbnailUrl 让 UI 回到默认
        broadcastToProject(projectId, "node:preview", {
          nodeId,
          thumbnailUrl: null,
          state: "preview_failed",
        });
        broadcastToProject(projectId, "node:state", { nodeId, state: "idle" });
      }
    });
  },
);
