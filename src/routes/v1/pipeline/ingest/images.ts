import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { INGEST_INPUT_ASSET_TYPES } from "@/lib/assetTypes";
import { ingestImagesPayload } from "@/lib/ingestAssets";

const router = express.Router();

/**
 * POST /api/v1/pipeline/ingest/images — 候选感知建组 ingest (Phase 48).
 *
 * Thin wrapper: schema hardening here, ALL DB policy in
 * src/lib/ingestAssets.ts (transactional grouping service — also reused by
 * the Phase 50 backfill). assetType vocabulary comes from the single truth
 * source @/lib/assetTypes (canonical 11 + legacy role/tool, D-06) — old
 * payloads {projectId, phase, images:[{filePath, assetName, assetType:
 * role|scene|tool, prompt, description}]} stay valid by construction.
 *
 * Batch caps (WR-04): ≤1000 images / ≤100 manifests per call — sized safely
 * above known kmc batch shapes (turnaround registers scale with character
 * count × views, so legacy uncapped payloads up to 1000 stay valid). Larger
 * runs must chunk; each call is one transaction, so a failure never leaves a
 * partial group inside one chunk.
 */

/** Reject `..` path segments — filePath is stored and later resolved as an
 *  OSS media URL (T-48-02 path-traversal guard). */
const hasNoTraversalSegment = (p: string): boolean => !p.split("/").includes("..");

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    phase: z.string().max(64).optional(),
    images: z
      .array(
        z.object({
          filePath: z
            .string()
            .min(1)
            .max(1024)
            .refine(hasNoTraversalSegment, "filePath 不能包含 .. 路径段"),
          assetName: z.string().min(1).max(512),
          assetType: z.enum(INGEST_INPUT_ASSET_TYPES),
          prompt: z.string().max(10000).optional(),
          description: z.string().max(10000).optional(),
          characterId: z.string().max(256).optional(),
          viewAngle: z.string().max(64).optional(),
          subtype: z.string().max(64).optional(),
          meta: z.record(z.string(), z.unknown()).optional(),
        }),
      )
      .max(1000),
    manifests: z
      .array(
        z.object({
          shot_id: z.string().min(1).max(64),
          all_first_frames: z.array(z.string().max(1024)).max(20).optional(),
          all_last_frames: z.array(z.string().max(1024)).max(20).optional(),
          selected_first_variant: z.number().int().min(1).max(20).nullable().optional(),
          selected_last_variant: z.number().int().min(1).max(20).nullable().optional(),
          first_frame_prompt: z.string().max(10000).optional(),
          last_frame_prompt: z.string().max(10000).optional(),
        }),
      )
      .max(100)
      // CR-02: two entries with the same shot_id (same side) produce colliding
      // groupKeys that cross-link members onto the wrong primary — reject.
      .refine((ms) => new Set(ms.map((m) => m.shot_id)).size === ms.length, "manifests 中 shot_id 重复")
      .optional(),
  }),
  async (req, res) => {
    const { projectId, phase, images, manifests } = req.body;

    // CR-01: duplicate filePaths would plant a second isPrimaryView=1 row the
    // service's group assertion cannot see — reject up front with the
    // offending paths (ingestImagesPayload has the same guard for direct /
    // backfill callers).
    const paths: string[] = Array.isArray(images)
      ? images.map((i: { filePath: string }) => i.filePath)
      : [];
    const dupPaths = [...new Set(paths.filter((p, i) => paths.indexOf(p) !== i))];
    if (dupPaths.length > 0) {
      return res.status(400).send(error("filePath 重复: " + dupPaths.join(", ")));
    }

    try {
      const result = await ingestImagesPayload(u.db, { projectId, phase, images, manifests });
      return res.status(200).send(success(result));
    } catch (err: any) {
      console.error("[v1/pipeline/ingest/images] ingest 失败:", err);
      return res.status(500).send(error("ingest 失败: " + err.message));
    }
  },
);
