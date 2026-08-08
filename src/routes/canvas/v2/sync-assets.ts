import express from "express";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { broadcastToProject } from "@/utils/ws";
import { db } from "@/utils/db";
import { upsertNode } from "@/lib/canvasRelationalStore";
import type { FlowNodeV2 } from "@/types/flowgraph-v2";

const router = express.Router();

/**
 * POST /api/canvas/v2/sync-assets
 *
 * Incremental sync: reads o_assets (active, with image) that have NO matching
 * canvas_nodes row, creates canvas_nodes for them, and broadcasts a
 * websocket event so the frontend reloads.
 *
 * Matching logic: an o_assets row is "synced" if a canvas_nodes row exists
 * in the same (project_id, episodes_id) scope whose `data` JSON contains
 * the o_image.filePath string.
 *
 * This is IDEMPOTENT: running it multiple times produces no duplicates
 * because upsertNode uses ON CONFLICT DO UPDATE.
 */
const syncSchema = z.object({
  projectId: z.number(),
  episodesId: z.number().optional().default(1),
  /** Optional: only sync specific asset IDs. If omitted, sync ALL missing. */
  assetIds: z.array(z.number()).optional(),
  /** Optional: filter by asset type (character/scene/keyframe/clip/...) */
  types: z.array(z.string()).optional(),
});

// ─── o_assets type → canvas node phase_name mapping ──────────
function inferPhaseName(asset: any): string {
  const type = asset.type;
  const viewAngle = asset.viewAngle || "";
  const meta = asset.meta ? (typeof asset.meta === "string" ? JSON.parse(asset.meta) : asset.meta) : {};
  const subtype = meta.subtype || "";

  if (type === "character") {
    if (subtype === "costume_turnaround" || viewAngle === "costume_turnaround") return "p04_costume_turnaround";
    if (subtype === "turnaround_sheet" || viewAngle === "turnaround_sheet") return "p04_character_design";
    if (subtype === "character_concept" || subtype === "character_design") return "p04_character_design";
    return "p04_character_design";
  }
  if (type === "scene") return "p07_scene_generation";
  if (type === "keyframe") return "p11_first_last_frames";
  if (type === "clip") return "p11_video_render";
  if (type === "voice") return "p10_voice_generation";
  return "manual_sync";
}

// ─── o_assets type → canvas node.data.assetType mapping ──────
function inferAssetType(asset: any): string {
  return asset.type; // character/scene/keyframe/clip/voice — same names
}

// ─── Build canvas node from o_assets row ─────────────────────
function buildCanvasNode(
  asset: any,
  scope: { projectId: number; episodesId: number },
): FlowNodeV2 {
  const meta = asset.meta ? (typeof asset.meta === "string" ? JSON.parse(asset.meta) : asset.meta) : {};
  const filePath = asset.filePath || "";
  const phaseName = inferPhaseName(asset);
  const assetType = inferAssetType(asset);
  const assetIdStr = `a-oasset-${asset.id}`;

  // Build node.data — the shape the frontend expects
  const data: Record<string, any> = {
    label: asset.name,
    type: "asset",
    assetType,
    filePath,
    thumbnailUrl: filePath,
    imageUrl: filePath,
    src: filePath,
    description: asset.name,
    state: asset.isPrimaryView ? "selected" : "candidate",
    oAssetId: asset.id,
    tags: asset.isPrimaryView ? ["selected"] : [],
  };

  // Add character-specific fields
  if (asset.characterId) {
    data.characterId = asset.characterId;
  }

  // Add subtype if available in meta
  if (meta.subtype) {
    data.subtype = meta.subtype;
  }

  // Add turnaround-specific fields
  if (meta.subtype === "turnaround_sheet" || asset.viewAngle === "turnaround_sheet") {
    data.isTurnaroundSheet = true;
    data.turnaroundType = "gray_base";
  }
  if (meta.subtype === "costume_turnaround" || asset.viewAngle === "costume_turnaround") {
    data.isCostumeTurnaround = true;
    data.turnaroundType = "costume";
  }

  // Add keyframe-specific fields
  if (asset.type === "keyframe" && meta.shot_id) {
    data.shot_id = meta.shot_id;
    data.frame_type = meta.frame_type || "first";
  }

  // Merge any other useful meta fields
  if (meta.model_version) data.modelVersion = meta.model_version;
  if (asset.prompt) data.prompt = asset.prompt;
  if (asset.model) data.model = asset.model;

  // Position: place new nodes in a spiral around origin to avoid overlap
  // Use asset.id as seed for deterministic placement
  const seed = asset.id;
  const angle = (seed * 2.39996) % (2 * Math.PI); // golden angle
  const radius = 300 + (seed % 20) * 50;
  const x = Math.cos(angle) * radius;
  const y = Math.sin(angle) * radius;

  return {
    id: assetIdStr,
    type: "asset",
    branchId: "main",
    phaseIndex: 0,
    phaseName,
    position: { x, y },
    size: { width: 260, height: 180 },
    data,
    state: "idle",
  };
}

router.post(
  "/",
  validateFields({
    projectId: z.number(),
  }),
  async (req, res) => {
    const parse = syncSchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).send(error("参数校验失败", parse.error.issues));
    }
    const { projectId, episodesId, assetIds, types } = parse.data;
    const scope = { projectId, episodesId };

    try {
      // ─── 1. Find all active o_assets WITH images ────────────
      let query = db("o_assets as a")
        .leftJoin("o_image as img", "a.imageId", "img.id")
        .select(
          "a.id",
          "a.name",
          "a.type",
          "a.prompt",
          "a.characterId",
          "a.viewAngle",
          "a.isPrimaryView",
          "a.model",
          "a.tags",
          "a.meta",
          "a.state as assetState",
          "a.createdAt",
          "img.filePath",
          "img.resolution",
          "img.model as imageModel",
        )
        .where("a.projectId", projectId)
        .where("a.state", "active")
        .whereNotNull("img.filePath");

      if (assetIds && assetIds.length > 0) {
        query = query.whereIn("a.id", assetIds);
      }
      if (types && types.length > 0) {
        query = query.whereIn("a.type", types);
      }

      const allAssets = await query;

      // ─── 2. Get existing canvas node filePaths to detect what's already synced ──
      // We check if the filePath appears in ANY canvas node's data JSON
      const existingNodes = await db("canvas_nodes")
        .where({ project_id: projectId, episodes_id: episodesId })
        .select("data");

      // Build a Set of all filePaths already on canvas
      const syncedPaths = new Set<string>();
      for (const node of existingNodes) {
        try {
          const data = typeof node.data === "string" ? JSON.parse(node.data) : node.data;
          const fp = data?.filePath;
          if (fp) syncedPaths.add(fp);
        } catch {
          // skip unparseable
        }
      }

      // ─── 3. Filter to unsynced assets ──────────────────────
      const unsynced = allAssets.filter((a: any) => !syncedPaths.has(a.filePath));

      if (unsynced.length === 0) {
        return res.status(200).send(
          success({
            synced: 0,
            total: allAssets.length,
            message: "所有资产已同步，无需操作",
          }),
        );
      }

      // ─── 4. Create canvas nodes for each unsynced asset ────
      let created = 0;
      const errors: string[] = [];

      for (const asset of unsynced) {
        try {
          const node = buildCanvasNode(asset, scope);
          await upsertNode(scope, node);
          created++;
        } catch (err: any) {
          errors.push(`asset ${asset.id} (${asset.name}): ${err.message}`);
        }
      }

      // ─── 5. Broadcast websocket event ──────────────────────
      broadcastToProject(projectId, "graph:saved", {
        projectId,
        episodesId,
        timestamp: Date.now(),
        source: "sync-assets",
      });

      return res.status(200).send(
        success({
          synced: created,
          total: allAssets.length,
          skipped: allAssets.length - unsynced.length,
          errors: errors.length > 0 ? errors : undefined,
        }),
      );
    } catch (err: any) {
      console.error("[v2/canvas/sync-assets] 同步失败:", err);
      return res.status(500).send(error("资产同步失败: " + err.message));
    }
  },
);

export default router;
