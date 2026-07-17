import express from "express";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { ensureThumbnail, needsThumbnailing } from "@/lib/thumbnail";

const router = express.Router();

/**
 * POST /api/canvas/v2/thumbnail/batch
 * 批量生成缩略图。
 *
 * Body: { paths: ["/oss/.../a.png", "/oss/.../b.mp4"] }
 * Resp: { code: 200, data: { thumbnails: { "/oss/.../a.png": "/oss/_thumbs/.../a.webp", ... } } }
 *
 * 幂等：已生成的跳过。失败的路径返回原路径（降级）。
 */
router.post(
  "/",
  validateFields({
    paths: z.array(z.string()).min(1).max(2000),
  }),
  async (req, res) => {
    const { paths } = req.body as { paths: string[] };
    try {
      // 串行执行避免 sharp/ffmpeg 并发过高（图片大）
      const thumbnails: Record<string, string> = {};
      for (const p of paths) {
        if (!needsThumbnailing(p)) {
          thumbnails[p] = p;
          continue;
        }
        const result = await ensureThumbnail(p);
        thumbnails[p] = result.thumbnailUrl;
      }
      return res.status(200).send(success({ thumbnails }));
    } catch (err) {
      console.error("[v2/thumbnail/batch] 批量生成失败:", err);
      return res.status(500).send(error("批量缩略图生成失败"));
    }
  },
);

export default router;
