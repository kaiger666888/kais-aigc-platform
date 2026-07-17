import express from "express";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { ensureThumbnail, needsThumbnailing } from "@/lib/thumbnail";

const router = express.Router();

/**
 * POST /api/canvas/v2/thumbnail
 * 为单个图片/视频生成 WebP 缩略图。
 *
 * Body: { sourcePath: "/oss/scifi-epic/assets/scene_refs/EP1-S01.png" }
 * Resp: { code: 200, data: { thumbnailUrl: "/oss/_thumbs/scifi-epic/assets/scene_refs/EP1-S01.webp" } }
 *
 * 幂等：若缩略图已存在且较新则直接返回缓存。
 */
router.post(
  "/",
  validateFields({
    sourcePath: z.string().min(1),
  }),
  async (req, res) => {
    const { sourcePath } = req.body;
    if (!needsThumbnailing(sourcePath)) {
      // 已经是缩略图或非媒体类型 — 原样返回
      return res.status(200).send(success({ thumbnailUrl: sourcePath, generated: false }));
    }
    try {
      const result = await ensureThumbnail(sourcePath);
      return res.status(200).send(success({ thumbnailUrl: result.thumbnailUrl, generated: result.generated }));
    } catch (err) {
      console.error("[v2/thumbnail] 生成失败:", err);
      return res.status(500).send(error("缩略图生成失败"));
    }
  },
);

export default router;
