import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { broadcastToProject } from "@/utils/ws";

// Phases that require human review before the pipeline can continue
const REVIEW_REQUIRED_PHASES = ["storyboard", "character", "scene", "camera-preview", "camera-final", "quality-gate"];

const router = express.Router();

const PHASE_INGEST_MAP: Record<string, string[]> = {
  "art-direction": ["images"],
  character: ["images"],
  scenario: [],
  voice: [],
  storyboard: ["storyboard"],
  scene: ["images"],
  "camera-preview": ["videos"],
  "camera-final": ["videos"],
  "post-production": [],
  "quality-gate": [],
  delivery: [],
};

export default router.post(
  "/",
  validateFields({
    pipelineId: z.string(),
    projectId: z.number(),
    phase: z.string(),
    phaseOrder: z.number().optional(),
    status: z.enum(["completed", "failed"]),
    outputs: z.array(z.any()).optional(),
    summary: z.any().optional(),
  }),
  async (req, res) => {
    const { pipelineId, projectId, phase, phaseOrder, status, outputs = [], summary } = req.body;
    const now = Date.now();

    // Determine next state: completed phases that require review pause as "awaiting-review"
    const needsReview = status === "completed" && REVIEW_REQUIRED_PHASES.includes(phase);
    const nextState = status === "completed" ? (needsReview ? "awaiting-review" : "running") : "failed";

    await u.db("kv_pipelineRun")
      .where({ id: pipelineId })
      .update({
        currentPhase: phase,
        currentPhaseOrder: phaseOrder ?? 0,
        state: nextState,
        updateTime: now,
      });

    if (status === "completed" && outputs.length > 0) {
      const imageOutputs = outputs.filter((o: any) => o.type === "image");
      const videoOutputs = outputs.filter((o: any) => o.type === "video");
      const storyboardData = outputs.filter((o: any) => o.type === "storyboard");

      if (imageOutputs.length > 0) {
        const images = imageOutputs.map((o: any) => ({
          filePath: o.filePath || o.url || "",
          assetName: o.assetName || o.name || `${phase}-asset`,
          assetType: o.assetType || inferAssetType(phase),
          prompt: o.prompt || "",
          description: o.description || "",
        }));
        await ingestImages(projectId, phase, images);
      }

      if (videoOutputs.length > 0) {
        const videos = videoOutputs.map((o: any) => ({
          filePath: o.filePath || o.url || "",
          duration: o.duration || 0,
          shotIndex: o.shotIndex,
          prompt: o.prompt || "",
        }));
        await ingestVideos(projectId, undefined, videos);
      }

      if (storyboardData.length > 0) {
        for (const sd of storyboardData) {
          if (sd.shots && Array.isArray(sd.shots)) {
            await ingestStoryboard(projectId, undefined, sd.shots);
          }
        }
      }
    }

    broadcastToProject(projectId, "pipeline:phase-complete", {
      pipelineId,
      phase,
      status,
      outputCount: outputs.length,
    });

    res.status(200).send(success({ message: "callback processed", phase, status }));
  },
);

function inferAssetType(phase: string): "role" | "scene" | "tool" {
  if (phase === "character") return "role";
  if (phase === "art-direction" || phase === "scene") return "scene";
  return "tool";
}

async function ingestImages(projectId: number, phase: string, images: any[]) {
  const now = Date.now();
  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    if (!img.filePath) continue;
    const imageId = now + i;
    await u.db("o_image").insert({ id: imageId, filePath: img.filePath, type: phase, state: "done" });
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
  }
}

async function ingestVideos(projectId: number, scriptId: number | undefined, videos: any[]) {
  const now = Date.now();
  for (let i = 0; i < videos.length; i++) {
    const vid = videos[i];
    if (!vid.filePath) continue;
    const trackId = now + i;
    await u.db("o_videoTrack").insert({ id: trackId, projectId, scriptId: scriptId || null, duration: vid.duration || 0 });
    const videoId = now + i + videos.length;
    await u.db("o_video").insert({
      id: videoId, filePath: vid.filePath, state: "生成成功", time: vid.duration || 0,
      scriptId: scriptId || null, projectId, videoTrackId: trackId,
    });
    await u.db("o_videoTrack").where({ id: trackId }).update({ videoId });
  }
}

async function ingestStoryboard(projectId: number, scriptId: number | undefined, shots: any[]) {
  const now = Date.now();
  for (let i = 0; i < shots.length; i++) {
    const shot = shots[i];
    const trackId = now + i;
    await u.db("o_videoTrack").insert({ id: trackId, scriptId: scriptId || null, projectId, duration: Number(shot.duration) || 0 });
    const storyboardId = now + i + shots.length;
    await u.db("o_storyboard").insert({
      id: storyboardId, scriptId: scriptId || null, prompt: shot.prompt || "",
      duration: String(shot.duration || 0), state: "未生成", trackId, track: shot.track || "main",
      videoDesc: shot.videoDesc || "", shouldGenerateImage: shot.shouldGenerateImage ?? 1,
      filePath: shot.filePath || null, projectId, index: i, createTime: now,
    });
  }
}
