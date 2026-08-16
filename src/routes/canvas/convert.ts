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
const VIDEO_START_Y = SB_START_Y + 350;
const AUDIO_START_Y = VIDEO_START_Y + 250;
const THREED_START_Y = ASSET_Y + 480;
const VARIANT_OFFSET_Y = 220;
const REF_OFFSET_X = -200;
const UPSCALE_OFFSET_Y = 220;
const FACERESTORE_OFFSET_Y = 440;

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
      // 策略: 先从 o_scriptAssets 关联表查，如果为空则直接查项目下所有资产（兼容 Pipeline 创建的项目）
      const scriptAssets = await u.db("o_scriptAssets").where("scriptId", episodesId);
      let assetIds = scriptAssets.map((i: any) => i.assetId);

      if (assetIds.length === 0) {
        // Pipeline 创建的项目可能没写 o_scriptAssets，退而查项目下所有资产
        // F-3: 必须按 episodesId 过滤——否则同项目其它集的首尾帧/资产混入
        // 当前集（StoryboardTimeline extraFrameShots 跨集泄漏）。OR 兼容
        // 历史 Notion 资产（episodesId 可能为 NULL，不属于任何集）。
        const fallbackAssets = await u.db("o_assets")
          .where("projectId", projectId)
          .whereNull("assetsId")
          .andWhere((qb: any) => {
            qb.where("episodesId", episodesId).orWhereNull("episodesId");
          });
        assetIds = fallbackAssets.map((a: any) => a.id);
      }

      const assetsData = assetIds.length > 0
        ? await u.db("o_assets")
            .leftJoin("o_image", "o_assets.imageId", "o_image.id")
            .select("o_assets.*", "o_image.filePath", "o_image.state as imageState")
            .whereIn("o_assets.id", assetIds)
            .andWhere("o_assets.projectId", projectId)
            .whereNull("o_assets.assetsId")
        : [];

      // 3. 获取分镜（必须加 projectId 过滤，否则跨项目匹配到错误数据）
      const storyboardData = await u.db("o_storyboard")
        .where("scriptId", episodesId)
        .andWhere("projectId", projectId)
        .orderBy("index", "asc");

      // 获取分镜关联资产
      // 策略: 先从 o_assets2Storyboard 查，如果为空则自动分配（Pipeline 创建的项目可能没写此表）
      const storyboardIds = storyboardData.map((s: any) => s.id);
      const assets2Storyboard = storyboardIds.length > 0
        ? await u.db("o_assets2Storyboard").whereIn("storyboardId", storyboardIds)
        : [];
      const assets2SbMap: Record<number, number[]> = {};
      assets2Storyboard.forEach((r: any) => {
        if (!assets2SbMap[r.storyboardId]) assets2SbMap[r.storyboardId] = [];
        assets2SbMap[r.storyboardId].push(r.assetId);
      });

      // 如果没有任何关联数据，自动将所有资产关联到所有分镜
      const hasAnyAssetLink = Object.keys(assets2SbMap).length > 0;
      if (!hasAnyAssetLink && assetsData.length > 0 && storyboardData.length > 0) {
        for (const sb of storyboardData) {
          if (sb.id !== undefined) assets2SbMap[sb.id] = assetIds;
        }
      }

      // ─── 查询审核数据 ──────────────────────────────────
      const reviewKey = `reviewStatus-${episodesId}`;
      const reviewRow = await u.db("o_agentWorkData")
        .where("projectId", String(projectId))
        .andWhere("episodesId", String(episodesId))
        .andWhere("key", reviewKey)
        .first();

      let reviewMapping: Record<string, any> = {};
      if (reviewRow?.data) {
        try {
          reviewMapping = typeof reviewRow.data === "string"
            ? JSON.parse(reviewRow.data)
            : reviewRow.data;
        } catch { reviewMapping = {}; }
      }

      function getNodeReview(nodeId: string) {
        const m = reviewMapping[nodeId];
        if (!m) return { reviewStatus: null, aiScore: null, isWinner: null, routingDecision: null };
        return {
          reviewStatus: m.reviewStatus ?? null,
          aiScore: m.aiScore ?? null,
          isWinner: m.isWinner ?? null,
          routingDecision: m.routingDecision ?? null,
        };
      }

      // ─── 文件系统扫描：Pipeline 产物回填 ────────────
      // Pipeline 创建的项目可能没写 filePath 到 Toonflow 表。
      // 扫描 /mnt/agents/output/ 目录，按名称/项目ID匹配图片并回写。
      const OUTPUT_DIR = process.env.OUTPUT_DIR || '/mnt/agents/output';
      const fs = await import('fs');
      const path = await import('path');

      async function scanOutputForImages() {
        try {
          const entries = await fs.promises.readdir(OUTPUT_DIR, { withFileTypes: true });
          const imageExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp']);
          const results: Record<string, string> = {}; // key: "asset-{id}" or "storyboard-{id}", value: relative path

          // 构建所有目录下图片文件的索引
          const imageMap = new Map<string, string>(); // dirName → first image relPath
          for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const dirPath = path.join(OUTPUT_DIR, entry.name);
            try {
              const files = await fs.promises.readdir(dirPath);
              const imgFile = files.find(f => imageExtensions.has(path.extname(f).toLowerCase()));
              if (imgFile) imageMap.set(entry.name, `${entry.name}/${imgFile}`);
            } catch {}
          }
          console.log(`[canvas:scan] 扫到 ${imageMap.size} 个含图片目录`);

          // 1. 匹配资产图片：char-* / e2e-char-* 目录按时间倒序分配给无 filePath 的资产
          const charDirs = [...imageMap.keys()].filter(d => d.toLowerCase().includes('char'));
          charDirs.sort((a, b) => {
            try {
              return fs.statSync(path.join(OUTPUT_DIR, b)).mtimeMs - fs.statSync(path.join(OUTPUT_DIR, a)).mtimeMs;
            } catch { return 0; }
          });
          const usedDirs = new Set<string>();
          let charIdx = 0;
          for (const asset of assetsData) {
            if (asset.filePath) continue;
            if (charIdx >= charDirs.length) break;
            const dirName = charDirs[charIdx++];
            results[`asset-${asset.id}`] = imageMap.get(dirName)!;
            usedDirs.add(dirName);
            console.log(`[canvas:scan] 资产 ${asset.id} "${asset.name}" → ${dirName}`);
          }

          // 2. 匹配分镜图片
          const sceneDirs = [...imageMap.keys()]
            .filter(d => !usedDirs.has(d))
            .filter(d => /scene|demo|volvo|s[0-9]/.test(d.toLowerCase()));
          sceneDirs.sort();
          for (const sb of storyboardData) {
            if (sb.filePath) continue;
            const sbIndex = sb.index ?? 0;
            const patterns = [`scene-s${sbIndex+1}`, `scene${sbIndex+1}`, `demo-v2-s${sbIndex.toString().padStart(2,'0')}`, `demo-v3-s${sbIndex.toString().padStart(2,'0')}`, `volvo-s${sbIndex+1}`];
            let matched = false;
            for (const dirName of sceneDirs) {
              if (patterns.some(p => dirName.toLowerCase().includes(p))) {
                results[`storyboard-${sb.id}`] = imageMap.get(dirName)!;
                matched = true;
                break;
              }
            }
            if (!matched && sbIndex < sceneDirs.length) {
              results[`storyboard-${sb.id}`] = imageMap.get(sceneDirs[sbIndex])!;
            }
            if (results[`storyboard-${sb.id}`]) {
              console.log(`[canvas:scan] 分镜 ${sb.id} → ${results[`storyboard-${sb.id}`]}`);
            }
          }

          // 3. 回写数据库
          for (const [key, relPath] of Object.entries(results)) {
            if (key.startsWith('asset-')) {
              const assetId = parseInt(key.replace('asset-', ''));
              await backfillAssetImage(assetId, relPath);
            } else if (key.startsWith('storyboard-')) {
              const sbId = parseInt(key.replace('storyboard-', ''));
              await u.db('o_storyboard').where('id', sbId).update({ filePath: relPath });
            }
          }

          return results;
        } catch (err) {
          console.warn('[canvas:convert] 文件系统扫描失败:', err);
          return {};
        }
      }

      async function backfillAssetImage(assetId: number, relPath: string) {
        try {
          const existingImage = await u.db('o_image').where('filePath', relPath).first();
          if (existingImage) {
            await u.db('o_assets').where('id', assetId).update({ imageId: existingImage.id });
            return;
          }
          const [imageId] = await u.db('o_image').insert({ filePath: relPath, state: '已完成' });
          await u.db('o_assets').where('id', assetId).update({ imageId });
          console.log(`[canvas:scan] 图片 ${imageId} → 资产 ${assetId}`);
        } catch (err) {
          console.warn(`[canvas:scan] 回写资产图片失败 ${assetId}:`, err);
        }
      }

      // 执行扫描（异步，不阻塞主流程太久）
      const fsScanResults = await scanOutputForImages();

      // 如果扫描到了新数据，重新获取资产和分镜数据
      if (Object.keys(fsScanResults).length > 0) {
        // 重新获取资产数据（可能已有 imageId）
        const updatedAssets = await u.db('o_assets')
          .leftJoin('o_image', 'o_assets.imageId', 'o_image.id')
          .select('o_assets.*', 'o_image.filePath', 'o_image.state as imageState')
          .whereIn('o_assets.id', assetIds)
          .andWhere('o_assets.projectId', projectId)
          .whereNull('o_assets.assetsId');
        // 用更新后的数据替换
        for (let i = 0; i < updatedAssets.length && i < assetsData.length; i++) {
          if (updatedAssets[i].filePath) {
            assetsData[i].filePath = updatedAssets[i].filePath;
            assetsData[i].imageState = updatedAssets[i].imageState;
          }
        }
        // 重新获取分镜数据
        const updatedSb = await u.db('o_storyboard')
          .where('scriptId', episodesId)
          .orderBy('index', 'asc');
        for (const usb of updatedSb) {
          const idx = storyboardData.findIndex(s => s.id === usb.id);
          if (idx >= 0 && usb.filePath) {
            storyboardData[idx].filePath = usb.filePath;
          }
        }
      }

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

        const isVariantRole = (asset.type ?? "role") === "character" && i < 2;
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
            uuid: asset.uuid ?? null,
            prompt: asset.prompt ?? "",
            filePath: asset.filePath ? `/oss/${asset.filePath}` : null,
            thumbnailUrl,
            // ─── 资产系统增强字段 (从 o_assets 表读取) ───
            characterId: asset.characterId ?? undefined,
            viewAngle: asset.viewAngle ?? undefined,
            isPrimaryView: asset.isPrimaryView ?? undefined,
            model: asset.model ?? undefined,
            tags: asset.tags ?? undefined,
            ...(() => { const r = getNodeReview(nodeId); return { reviewStatus: r.reviewStatus, aiScore: r.aiScore, isWinner: r.isWinner, routingDecision: r.routingDecision }; })(),
            ...(isVariantRole ? {
              variantGroupId: "vg-char-role",
              variantIndex: i,
              isWinner: i === 0,
            } : {}),
          },
          state,
          ...(() => { const r = getNodeReview(nodeId); return { reviewStatus: r.reviewStatus, aiScore: r.aiScore, isWinner: r.isWinner, routingDecision: r.routingDecision }; })(),
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
            filePath: sb.filePath ? `/oss/${sb.filePath}` : null,
            thumbnailUrl,
            linkedAssetIds: assets2SbMap[sb.id!] ?? [],
            ...(() => { const r = getNodeReview(nodeId); return { reviewStatus: r.reviewStatus, aiScore: r.aiScore, isWinner: r.isWinner, routingDecision: r.routingDecision }; })(),
          },
          state,
          ...(() => { const r = getNodeReview(nodeId); return { reviewStatus: r.reviewStatus, aiScore: r.aiScore, isWinner: r.isWinner, routingDecision: r.routingDecision }; })(),
        });

        // 连接关联资产到分镜
        for (const aid of assets2SbMap[sb.id!] ?? []) {
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

      // 4. 视频节点（从 o_videoTrack 和 o_video 读取）
      const videoTrackData = await u.db("o_videoTrack")
        .where("scriptId", episodesId)
        .andWhere("projectId", projectId);

      const videoTrackIds = videoTrackData.map((t: any) => t.id);
      const videoData = videoTrackIds.length > 0
        ? await u.db("o_video").whereIn("videoTrackId", videoTrackIds)
        : [];

      // 建立 trackId → 分镜节点id 的映射
      const track2Storyboard = new Map<number, string>();
      for (const sb of storyboardData) {
        if (sb.trackId) track2Storyboard.set(sb.trackId, `storyboard-${sb.id}`);
      }

      for (let i = 0; i < videoTrackData.length; i++) {
        const track = videoTrackData[i];
        const selectedVideoId = track.videoId || track.selectVideoId;
        const video = selectedVideoId
          ? videoData.find((v: any) => v.id === selectedVideoId)
          : videoData.find((v: any) => v.videoTrackId === track.id);

        if (!video) continue;

        const nodeId = `video-${video.id}`;
        const videoState = video.state === "已完成" ? "success"
          : video.state === "生成中" ? "running"
          : video.state === "生成失败" ? "error"
          : "idle";

        let thumbnailUrl: string | null = null;
        if (video.filePath) {
          thumbnailUrl = `/oss/${video.filePath}`;
        }

        nodes.push({
          id: nodeId,
          type: "video",
          position: { x: SB_START_X + i * SB_GAP_X, y: VIDEO_START_Y },
          size: { width: 260, height: 180 },
          data: {
            label: `视频 ${i + 1}`,
            type: "video",
            videoId: video.id,
            filePath: video.filePath ?? null,
            thumbnailUrl,
            duration: track.duration ? +track.duration : (video.time ? +video.time : 0),
            ...(() => { const r = getNodeReview(nodeId); return { reviewStatus: r.reviewStatus, aiScore: r.aiScore, isWinner: r.isWinner, routingDecision: r.routingDecision }; })(),
          },
          state: videoState,
          ...(() => { const r = getNodeReview(nodeId); return { reviewStatus: r.reviewStatus, aiScore: r.aiScore, isWinner: r.isWinner, routingDecision: r.routingDecision }; })(),
        });

        // 连接分镜 → 视频节点
        const storyboardNodeId = track2Storyboard.get(track.id!);
        if (storyboardNodeId) {
          links.push({
            id: `e-${edgeId++}`,
            source: storyboardNodeId,
            target: nodeId,
            dataType: "video",
          });
        }
      }

      // 5. 音频节点（从 o_assetsRole2Audio 关联表读取）
      const assetsRoleIds = assetsData.map((a: any) => a.id);
      const audioLinks = assetsRoleIds.length > 0
        ? await u.db("o_assetsRole2Audio").whereIn("assetsRoleId", assetsRoleIds)
        : [];

      if (audioLinks.length > 0) {
        const audioFileIds = [...new Set(audioLinks.map((l: any) => l.assetsAudioId))];
        const audioFiles = audioFileIds.length > 0
          ? await u.db("o_audio").whereIn("id", audioFileIds)
          : [];
        const audioMap: Record<number, any> = {};
        audioFiles.forEach((a: any) => { audioMap[a.id] = a; });

        for (let i = 0; i < audioLinks.length; i++) {
          const link = audioLinks[i];
          const audio = audioMap[link.assetsAudioId!];
          if (!audio) continue;

          const nodeId = `audio-${audio.id}`;
          const audioState = audio.state === "已完成" ? "success"
            : audio.state === "生成中" ? "running"
            : audio.state === "生成失败" ? "error"
            : "idle";

          let filePath: string | null = null;
          if (audio.filePath) {
            filePath = `/oss/${audio.filePath}`;
          }

          nodes.push({
            id: nodeId,
            type: "audio",
            position: { x: SB_START_X + i * SB_GAP_X, y: AUDIO_START_Y },
            size: { width: 260, height: 180 },
            data: {
              label: audio.name ?? `音频 ${i + 1}`,
              type: "audio",
              audioId: audio.id,
              filePath,
              thumbnailUrl: null,
              duration: audio.duration ? +audio.duration : 0,
              ...(() => { const r = getNodeReview(nodeId); return { reviewStatus: r.reviewStatus, aiScore: r.aiScore, isWinner: r.isWinner, routingDecision: r.routingDecision }; })(),
            },
            state: audioState,
            ...(() => { const r = getNodeReview(nodeId); return { reviewStatus: r.reviewStatus, aiScore: r.aiScore, isWinner: r.isWinner, routingDecision: r.routingDecision }; })(),
          });

          // 连接资产 → 音频
          const assetNodeId = assetNodeMap.get(link.assetsRoleId!);
          if (assetNodeId) {
            links.push({
              id: `e-${edgeId++}`,
              source: assetNodeId,
              target: nodeId,
              dataType: "audio",
            });
          }
        }
      }

      // 6. 3D 空间节点（TRELLIS2 / IMAGE_TO_3D 产物）
      const threeDAssets = assetsData.filter((a: any) => a.type === '3d');

      for (let threeDIdx = 0; threeDIdx < threeDAssets.length; threeDIdx++) {
        const asset = threeDAssets[threeDIdx];
        const nodeId = `3d-${asset.id}`;
        const col = threeDIdx % 4;
        nodes.push({
          id: nodeId,
          type: "3d",
          position: { x: ASSET_START_X + col * ASSET_GAP_X, y: THREED_START_Y + Math.floor(threeDIdx / 4) * ASSET_GAP_Y },
          size: { width: 260, height: 180 },
          data: {
            label: asset.name ?? "3D 空间",
            type: "3d",
            assetType: "3d",
            assetId: asset.id,
            filePath: asset.filePath ? `/oss/${asset.filePath}` : null,
            thumbnailUrl: null,
            format: "glb",
            engine: "TRELLIS2",
          },
          state: asset.imageState === "已完成" ? "success" : "idle",
        });
        links.push({ id: `e-${edgeId++}`, source: scriptNodeId, target: nodeId, dataType: "3d" });
      }

      // 7. 工作流变体节点（IPAdapter / PuLID 产物）
      const variantAssets = assetsData.filter((a: any) => a.variantGroupId);
      const variantGroups: Record<string, any[]> = {};
      variantAssets.forEach((a: any) => {
        const gid = a.variantGroupId || 'default';
        if (!variantGroups[gid]) variantGroups[gid] = [];
        variantGroups[gid].push(a);
      });

      let variantGroupIdx = 0;
      for (const [groupId, variants] of Object.entries(variantGroups)) {
        for (let i = 0; i < variants.length; i++) {
          const asset = variants[i];
          const nodeId = `variant-${asset.id}`;
          let thumbnailUrl: string | null = null;
          if (asset.filePath) {
            try { thumbnailUrl = await u.oss.getSmallImageUrl(asset.filePath); } catch { thumbnailUrl = null; }
          }
          nodes.push({
            id: nodeId,
            type: "variant",
            position: { x: ASSET_START_X + i * 200, y: THREED_START_Y + VARIANT_OFFSET_Y + variantGroupIdx * ASSET_GAP_Y },
            size: { width: 200, height: 160 },
            data: {
              label: `${asset.name || '变体'} ${i + 1}`,
              type: "variant",
              assetType: asset.type,
              assetId: asset.id,
              variantGroupId: groupId,
              variantIndex: i,
              variantType: (asset as any).variantType || "ipadapter",
              filePath: asset.filePath ? `/oss/${asset.filePath}` : null,
              thumbnailUrl,
              isWinner: i === 0,
            },
            state: asset.imageState === "已完成" ? "success" : "idle",
          });
          const parentNodeId = `asset-${(asset as any).parentId || variants[0].id}`;
          links.push({ id: `e-${edgeId++}`, source: parentNodeId, target: nodeId, dataType: "variant" });
        }
        variantGroupIdx++;
      }

      // 8. 参考图节点（深度图、ControlNet 控制图）
      const refImages = assetIds.length > 0
        ? await u.db("o_image").whereIn("assetsId", assetIds).where("type", "depth")
        : [];

      for (let refIdx = 0; refIdx < refImages.length; refIdx++) {
        const ref = refImages[refIdx];
        const nodeId = `reference-${ref.id}`;
        let thumbnailUrl: string | null = null;
        if (ref.filePath) {
          try { thumbnailUrl = await u.oss.getSmallImageUrl(ref.filePath); } catch { thumbnailUrl = null; }
        }
        nodes.push({
          id: nodeId,
          type: "reference",
          position: { x: SB_START_X + REF_OFFSET_X, y: SB_START_Y + refIdx * ASSET_GAP_Y },
          size: { width: 200, height: 160 },
          data: {
            label: ref.type === 'depth' ? "深度图" : "参考图",
            type: "reference",
            refType: ref.type || "depth",
            filePath: ref.filePath ? `/oss/${ref.filePath}` : null,
            thumbnailUrl,
          },
          state: "success",
        });
        if ((ref as any).storyboardId) {
          links.push({ id: `e-${edgeId++}`, source: nodeId, target: `storyboard-${(ref as any).storyboardId}`, dataType: "reference" });
        }
      }

      // 9. 超分节点
      const upscaleImages = assetIds.length > 0
        ? await u.db("o_image").whereIn("assetsId", assetIds).where("type", "upscale")
        : [];

      for (let upsIdx = 0; upsIdx < upscaleImages.length; upsIdx++) {
        const ups = upscaleImages[upsIdx];
        const nodeId = `upscale-${ups.id}`;
        let thumbnailUrl: string | null = null;
        if (ups.filePath) {
          try { thumbnailUrl = await u.oss.getSmallImageUrl(ups.filePath); } catch { thumbnailUrl = null; }
        }
        nodes.push({
          id: nodeId,
          type: "upscale",
          position: { x: SB_START_X + upsIdx * SB_GAP_X, y: VIDEO_START_Y + UPSCALE_OFFSET_Y },
          size: { width: 260, height: 160 },
          data: {
            label: `${(ups as any).scaleFactor || '4x'} 超分`,
            type: "upscale",
            scaleFactor: (ups as any).scaleFactor || 4,
            sourceVideoId: (ups as any).sourceId,
            filePath: ups.filePath ? `/oss/${ups.filePath}` : null,
            thumbnailUrl,
          },
          state: ups.state === "已完成" ? "success" : "idle",
        });
        if ((ups as any).sourceId) {
          links.push({ id: `e-${edgeId++}`, source: `video-${(ups as any).sourceId}`, target: nodeId, dataType: "upscale" });
        }
      }

      // 10. 面部修复节点
      const faceRestoreImages = assetIds.length > 0
        ? await u.db("o_image").whereIn("assetsId", assetIds).where("type", "face_restore")
        : [];

      for (let frIdx = 0; frIdx < faceRestoreImages.length; frIdx++) {
        const fr = faceRestoreImages[frIdx];
        const nodeId = `face_restore-${fr.id}`;
        let thumbnailUrl: string | null = null;
        if (fr.filePath) {
          try { thumbnailUrl = await u.oss.getSmallImageUrl(fr.filePath); } catch { thumbnailUrl = null; }
        }
        nodes.push({
          id: nodeId,
          type: "face_restore",
          position: { x: SB_START_X + frIdx * SB_GAP_X, y: VIDEO_START_Y + FACERESTORE_OFFSET_Y },
          size: { width: 260, height: 160 },
          data: {
            label: "面部修复",
            type: "face_restore",
            sourceUpscaleId: (fr as any).sourceId,
            filePath: fr.filePath ? `/oss/${fr.filePath}` : null,
            thumbnailUrl,
          },
          state: fr.state === "已完成" ? "success" : "idle",
        });
        if ((fr as any).sourceId) {
          links.push({ id: `e-${edgeId++}`, source: `upscale-${(fr as any).sourceId}`, target: nodeId, dataType: "face_restore" });
        }
      }

      const graph = {
        nodes,
        links,
        groups: [],
        viewport: undefined,
      };

      res.status(200).send(success(graph));

      // ─── 异步自动评分：缺少 aiScore 的图片节点 ──────────
      setTimeout(async () => {
        try {
          const { scoreImageWithRetry } = await import("@/lib/ai-scorer");
          for (const node of graph.nodes) {
            if (node.data?.aiScore) continue; // 已有评分，跳过
            const imageUrl = node.data?.thumbnailUrl || node.data?.filePath;
            if (!imageUrl || !imageUrl.startsWith("/")) continue; // 只处理本地图片
            try {
              const score = await scoreImageWithRetry(imageUrl);
              // 写入 reviewMapping
              const reviewKey = `reviewStatus-${episodesId}`;
              const reviewRow = await u.db("o_agentWorkData")
                .where("projectId", String(projectId))
                .andWhere("episodesId", String(episodesId))
                .andWhere("key", reviewKey)
                .first();
              let mapping: Record<string, any> = {};
              if (reviewRow?.data) {
                try { mapping = typeof reviewRow.data === "string" ? JSON.parse(reviewRow.data) : reviewRow.data; } catch { mapping = {}; }
              }
              if (!mapping[node.id]) mapping[node.id] = {};
              mapping[node.id].aiScore = score;
              const mappingStr = JSON.stringify(mapping);
              if (reviewRow) {
                await u.db("o_agentWorkData").where("id", reviewRow.id).update({ data: mappingStr });
              } else {
                await u.db("o_agentWorkData").insert({ projectId: String(projectId) as any, episodesId: String(episodesId) as any, key: reviewKey, data: mappingStr });
              }
              console.log(`[auto-score] ${node.id} → overall=${score.overall}`);
              // 广播
              try {
                const { broadcastToProject } = await import("@/utils/ws");
                broadcastToProject(projectId, "node:state", { nodeId: node.id, state: "scored", aiScore: score });
              } catch {}
            } catch (err: any) {
              console.warn(`[auto-score] ${node.id} 评分失败:`, err.message);
            }
          }
        } catch (err) {
          console.error("[auto-score] 异步评分启动失败:", err);
        }
      }, 2000); // 2秒后开始，不阻塞返回
    } catch (err) {
      console.error("[canvas:convert] 转换项目数据失败:", err);
      res.status(500).send(error("转换项目数据失败"));
    }
  },
);
