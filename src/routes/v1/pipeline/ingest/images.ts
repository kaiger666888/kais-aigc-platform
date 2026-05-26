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
    phase: z.string().optional(),
    images: z.array(
      z.object({
        filePath: z.string(),
        assetName: z.string(),
        assetType: z.enum(["role", "scene", "tool"]),
        prompt: z.string().optional(),
        description: z.string().optional(),
      }),
    ),
  }),
  async (req, res) => {
    const { projectId, phase, images } = req.body;
    const now = Date.now();
    const results: any[] = [];

    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      const imageId = now + i;

      await u.db("o_image").insert({
        id: imageId,
        filePath: img.filePath,
        type: phase || "pipeline",
        state: "done",
      });

      const assetId = now + i + images.length;
      await u.db("o_assets").insert({
        id: assetId,
        name: img.assetName,
        prompt: img.prompt || "",
        type: img.assetType,
        describe: img.description || "",
        projectId,
        imageId,
        promptState: "done",
        startTime: now,
      });

      results.push({ imageId, assetId });
    }

    res.status(200).send(success({ count: results.length, assets: results }));
  },
);
