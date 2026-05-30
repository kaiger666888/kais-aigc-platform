import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

/**
 * 将现有项目数据转换为画布 FlowGraph 格式
 * 读取 o_script、o_assets、o_storyboard 并转换为画布节点
 */

// ─── 布局常量 ─────────────────────────────────────
const SCRIPT_X = 50;
const SCRIPT_Y = 50;
const ASSET_START_X = 400;
const ASSET_Y = 50;
const ASSET_GAP_X = 280;
const ASSET_GAP_Y = 220;
const SB_START_X = 400;
const SB_START_Y = 500;
const SB_GAP_X = 300;

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    episodesId: z.number(),
  }),
  async (req, res) => {
    const { projectId, episodesId } = req.body;

    try {
      // 1. 获取剧本
      const scriptData = await u.db("o_script")
        .where("projectId", projectId)
        .where("id", episodesId)
        .first();

      // 2. 获取资产
      const scriptAssets = await u.db("o_scriptAssets").where("scriptId", episodesId);
      const assetIds = scriptAssets.map((i: any) => i.assetId);

      const assetsData = assetIds.length > 0
        ? await u.db("o_assets")
            .leftJoin("o_image", "o_assets.imageId", "o_image.id")
            .select("o_assets.*", "o_image.filePath", "o_image.state as imageState")
            .whereIn("o_assets.id", assetIds)
            .andWhere("o_assets.projectId", projectId)
            .whereNull("o_assets.assetsId")
        : [];

      // 3. 获取分镜
      const storyboardData = await u.db("o_storyboard")
        .where("scriptId", episodesId)
        .orderBy("index", "asc");

      // 获取分镜关联资产
      const storyboardIds = storyboardData.map((s: any) => s.id);
      const assets2Storyboard = storyboardIds.length > 0
        ? await u.db("o_assets2Storyboard").whereIn("storyboardId", storyboardIds)
        : [];
      const assets2SbMap: Record<number, number[]> = {};
      assets2Storyboard.forEach((r: any) => {
        if (!assets2SbMap[r.storyboardId]) assets2SbMap[r.storyboardId] = [];
        assets2SbMap[r.storyboardId].push(r.assetId);
      });

      // ─── 构建节点和边 ────────────────────────────────
      const nodes: any[] = [];
      const links: any[] = [];
      let edgeId = 0;

      // 剧本节点
      const scriptNodeId = "script-0";
      nodes.push({
        id: scriptNodeId,
        type: "script",
        position: { x: SCRIPT_X, y: SCRIPT_Y },
        size: { width: 260, height: 180 },
        data: {
          label: scriptData?.name ?? "剧本",
          type: "script",
          content: (scriptData?.content ?? "").slice(0, 200),
        },
        state: scriptData?.content ? "success" : "idle",
      });

      // 资产节点（网格布局）
      const assetNodeMap = new Map<number, string>();
      for (let i = 0; i < assetsData.length; i++) {
        const asset = assetsData[i];
        const nodeId = `asset-${asset.id}`;
        assetNodeMap.set(asset.id, nodeId);

        const col = i % 4;
        const row = Math.floor(i / 4);
        const imgState = asset.imageState;
        const state = imgState === "已完成" ? "success"
          : imgState === "生成中" ? "running"
          : imgState === "生成失败" ? "error"
          : "idle";

        let thumbnailUrl: string | null = null;
        if (asset.filePath) {
          try {
            thumbnailUrl = await u.oss.getSmallImageUrl(asset.filePath);
          } catch { thumbnailUrl = null; }
        }

        nodes.push({
          id: nodeId,
          type: "asset",
          position: { x: ASSET_START_X + col * ASSET_GAP_X, y: ASSET_Y + row * ASSET_GAP_Y },
          size: { width: 260, height: 180 },
          data: {
            label: asset.name ?? "资产",
            type: "asset",
            assetType: asset.type ?? "role",
            assetId: asset.id,
            prompt: asset.prompt ?? "",
            thumbnailUrl,
          },
          state,
        });

        links.push({
          id: `e-${edgeId++}`,
          source: scriptNodeId,
          target: nodeId,
          dataType: "text",
        });
      }

      // 分镜节点（横向排列）
      for (let i = 0; i < storyboardData.length; i++) {
        const sb = storyboardData[i];
        const nodeId = `storyboard-${sb.id}`;

        const state = sb.state === "已完成" ? "success"
          : sb.state === "生成中" ? "running"
          : sb.state === "生成失败" ? "error"
          : "idle";

        let thumbnailUrl: string | null = null;
        if (sb.filePath) {
          try {
            thumbnailUrl = await u.oss.getSmallImageUrl(sb.filePath);
          } catch { thumbnailUrl = null; }
        }

        nodes.push({
          id: nodeId,
          type: "storyboard",
          position: { x: SB_START_X + i * SB_GAP_X, y: SB_START_Y },
          size: { width: 260, height: 180 },
          data: {
            label: `分镜 ${sb.index ?? i + 1}`,
            type: "storyboard",
            storyboardId: sb.id,
            duration: sb.duration ? +sb.duration : 0,
            prompt: sb.prompt ?? "",
            thumbnailUrl,
            linkedAssetIds: assets2SbMap[sb.id] ?? [],
          },
          state,
        });

        // 连接关联资产到分镜
        for (const aid of assets2SbMap[sb.id] ?? []) {
          const sourceId = assetNodeMap.get(aid);
          if (sourceId) {
            links.push({
              id: `e-${edgeId++}`,
              source: sourceId,
              target: nodeId,
              dataType: "image",
            });
          }
        }
      }

      const graph = {
        nodes,
        links,
        groups: [],
        viewport: undefined,
      };

      res.status(200).send(success(graph));
    } catch (err) {
      console.error("[canvas:convert] 转换项目数据失败:", err);
      res.status(500).send(error("转换项目数据失败"));
    }
  },
);
