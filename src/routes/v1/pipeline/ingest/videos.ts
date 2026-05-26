import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    scriptId: z.number().optional(),
    videos: z.array(
      z.object({
        filePath: z.string(),
        duration: z.number().optional(),
        shotIndex: z.number().optional(),
        prompt: z.string().optional(),
        trackId: z.number().optional(),
      }),
    ),
  }),
  async (req, res) => {
    const { projectId, scriptId, videos } = req.body;
    const now = Date.now();
    const results: any[] = [];

    for (let i = 0; i < videos.length; i++) {
      const vid = videos[i];
      let trackId = vid.trackId;

      if (!trackId) {
        trackId = now + i;
        await u.db("o_videoTrack").insert({
          id: trackId,
          projectId,
          scriptId: scriptId || null,
          duration: vid.duration || 0,
        });
      }

      const videoId = now + i + videos.length;
      await u.db("o_video").insert({
        id: videoId,
        filePath: vid.filePath,
        state: "生成成功",
        time: vid.duration || 0,
        scriptId: scriptId || null,
        projectId,
        videoTrackId: trackId,
      });

      await u.db("o_videoTrack").where({ id: trackId }).update({ videoId });

      results.push({ videoId, trackId });
    }

    res.status(200).send(success({ count: results.length, videos: results }));
  },
);
