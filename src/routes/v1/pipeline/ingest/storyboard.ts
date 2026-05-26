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
    shots: z.array(
      z.object({
        prompt: z.string(),
        duration: z.union([z.string(), z.number()]),
        videoDesc: z.string().optional(),
        shouldGenerateImage: z.number().optional(),
        filePath: z.string().nullable().optional(),
        track: z.string().optional(),
      }),
    ),
  }),
  async (req, res) => {
    const { projectId, scriptId, shots } = req.body;
    const now = Date.now();
    const results: any[] = [];

    for (let i = 0; i < shots.length; i++) {
      const shot = shots[i];
      const trackId = now + i;

      await u.db("o_videoTrack").insert({
        id: trackId,
        scriptId: scriptId || null,
        projectId,
        duration: Number(shot.duration) || 0,
      });

      const storyboardId = now + i + shots.length;
      await u.db("o_storyboard").insert({
        id: storyboardId,
        scriptId: scriptId || null,
        prompt: shot.prompt,
        duration: String(shot.duration),
        state: "未生成",
        trackId,
        track: shot.track || "main",
        videoDesc: shot.videoDesc || "",
        shouldGenerateImage: shot.shouldGenerateImage ?? 1,
        filePath: shot.filePath || null,
        projectId,
        index: i,
        createTime: now,
      });

      results.push({ storyboardId, trackId });
    }

    res.status(200).send(success({ count: results.length, storyboards: results }));
  },
);
