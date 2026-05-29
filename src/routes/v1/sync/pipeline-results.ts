import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import axios from "axios";

const router = express.Router();

const TOONFLOW_BASE_URL = process.env.CORE_BACKEND_URL || "http://kais-core-backend:8000";

/**
 * POST /api/v1/sync/pipeline-results
 *
 * Batch sync all pipeline outputs to Toonflow (core-backend).
 *
 * Body:
 *   pipelineId — pipeline run identifier
 */
export default router.post(
  "/",
  validateFields({
    pipelineId: z.string(),
  }),
  async (req, res) => {
    const { pipelineId } = req.body;
    const now = Date.now();

    try {
      // 1. Find pipeline run record
      const pipelineRun = await u.db("kv_pipelineRun")
        .where({ id: pipelineId })
        .first();

      if (!pipelineRun) {
        return res.status(404).send(error(`Pipeline ${pipelineId} not found`));
      }

      const projectId = Number(pipelineRun.projectId);
      const scriptId = pipelineRun.scriptId ? Number(pipelineRun.scriptId) : null;

      // 2. Fetch project info from local database
      const project = await u.db("o_project").where({ id: projectId }).first();
      if (!project) {
        return res.status(404).send(error(`Project ${projectId} not found`));
      }

      // 3. Get or create project in Toonflow
      let toonflowProject: any;
      try {
        const projectsRes = await axios.post(
          `${TOONFLOW_BASE_URL}/api/project/getProject`,
          {},
          { timeout: 10000, validateStatus: (s) => s < 500 },
        );
        if (projectsRes.data?.data && Array.isArray(projectsRes.data.data)) {
          toonflowProject = projectsRes.data.data.find((p: any) => p.name === project.name);
        }
      } catch (e) {
        // Ignore query errors
      }

      if (!toonflowProject) {
        // Create project in Toonflow
        const createRes = await axios.post(
          `${TOONFLOW_BASE_URL}/api/project/addProject`,
          {
            projectType: "short-film",
            name: project.name,
            intro: project.intro || `Pipeline project: ${project.name}`,
            type: project.type || "animation",
            artStyle: project.artStyle || "",
            directorManual: project.directorManual || "",
            videoRatio: project.videoRatio || "9:16",
            imageModel: project.imageModel || "",
            videoModel: project.videoModel || "",
            imageQuality: "high",
            mode: "agent",
          },
          { timeout: 15000, validateStatus: (s) => s < 500 },
        );
        if (createRes.status !== 200) {
          return res.status(502).send(error(`Failed to create Toonflow project`));
        }
        // Query again to get project ID
        try {
          const projectsRes = await axios.post(
            `${TOONFLOW_BASE_URL}/api/project/getProject`,
            {},
            { timeout: 10000 },
          );
          if (projectsRes.data?.data && Array.isArray(projectsRes.data.data)) {
            toonflowProject = projectsRes.data.data.find((p: any) => p.name === project.name);
          }
        } catch (e) {
          // Continue anyway
        }
      }

      if (!toonflowProject || !toonflowProject.id) {
        return res.status(502).send(error(`Cannot resolve Toonflow project ID`));
      }

      const toonflowProjectId = toonflowProject.id;

      // 4. Sync assets (characters, scenes)
      const assets = await u.db("o_assets")
        .where({ projectId })
        .select("*");

      const characterAssets = assets.filter((a: any) => a.type === "role");
      const sceneAssets = assets.filter((a: any) => a.type === "scene");

      // Sync character images
      for (const asset of characterAssets) {
        try {
          const image = await u.db("o_image").where({ id: asset.imageId }).first();
          if (image && image.filePath) {
            await axios.post(
              `${TOONFLOW_BASE_URL}/api/assets/addAssets`,
              {
                name: asset.name,
                describe: asset.describe || "",
                type: "role",
                projectId: toonflowProjectId,
                prompt: asset.prompt || "",
                remark: `Synced from pipeline ${pipelineId}`,
              },
              { timeout: 10000, validateStatus: (s) => s < 500 },
            );
          }
        } catch (e: any) {
          console.error(`Failed to sync character asset ${asset.id}:`, e.message);
        }
      }

      // Sync scene images
      for (const asset of sceneAssets) {
        try {
          const image = await u.db("o_image").where({ id: asset.imageId }).first();
          if (image && image.filePath) {
            await axios.post(
              `${TOONFLOW_BASE_URL}/api/assets/addAssets`,
              {
                name: asset.name,
                describe: asset.describe || "",
                type: "scene",
                projectId: toonflowProjectId,
                prompt: asset.prompt || "",
                remark: `Synced from pipeline ${pipelineId}`,
              },
              { timeout: 10000, validateStatus: (s) => s < 500 },
            );
          }
        } catch (e: any) {
          console.error(`Failed to sync scene asset ${asset.id}:`, e.message);
        }
      }

      // 5. Sync storyboard
      const storyboards = await u.db("o_storyboard")
        .where({ projectId })
        .select("*");

      if (storyboards.length > 0) {
        // For storyboard, we need to create script first if not exists
        let scriptIdToUse: number | null = scriptId || null;
        if (!scriptIdToUse) {
          // Find or create default script
          const script = await u.db("o_script")
            .where({ projectId })
            .orderBy("createTime", "desc")
            .first();
          if (script) {
            scriptIdToUse = script.id ?? null;
          } else {
            // Create minimal script in Toonflow
            const scriptCreateRes = await axios.post(
              `${TOONFLOW_BASE_URL}/api/script/addScript`,
              {
                name: project.name || "Pipeline Script",
                content: `Auto-generated script for pipeline ${pipelineId}`,
                projectId: toonflowProjectId,
                assets: [],
              },
              { timeout: 10000, validateStatus: (s) => s < 500 },
            );
            if (scriptCreateRes.data?.data?.id) {
              scriptIdToUse = scriptCreateRes.data.data.id;
            }
          }
        }

        if (scriptIdToUse) {
          for (const sb of storyboards) {
            try {
              await axios.post(
                `${TOONFLOW_BASE_URL}/api/production/storyboard/addStoryboard`,
                {
                  scriptId: scriptIdToUse ?? 0,
                  prompt: sb.prompt || "",
                  duration: sb.duration || "5",
                  videoDesc: sb.videoDesc || "",
                  track: sb.track || "main",
                  index: sb.index || 0,
                  shouldGenerateImage: sb.shouldGenerateImage ?? 1,
                },
                { timeout: 10000, validateStatus: (s) => s < 500 },
              );
            } catch (e: any) {
              console.error(`Failed to sync storyboard ${sb.id}:`, e.message);
            }
          }
        }
      }

      // 6. Sync videos
      const videos = await u.db("o_video")
        .where({ projectId })
        .select("*");

      for (const vid of videos) {
        try {
          if (vid.filePath && vid.state === "生成成功") {
            // Create video track reference
            await axios.post(
              `${TOONFLOW_BASE_URL}/api/cornerScape/updateAssetsAudio`,
              {
                projectId: toonflowProjectId,
                scriptId: scriptId || 0,
                videoId: vid.id,
                duration: vid.time || 0,
              },
              { timeout: 10000, validateStatus: (s) => s < 500 },
            );
          }
        } catch (e: any) {
          console.error(`Failed to sync video ${vid.id}:`, e.message);
        }
      }

      // 7. Record sync status
      await u.db("kv_syncStatus").insert({
        id: now,
        pipelineId,
        projectId,
        toonflowProjectId,
        status: "completed",
        syncedAssets: assets.length,
        syncedStoryboards: storyboards.length,
        syncedVideos: videos.length,
        syncTime: now,
        createTime: now,
      });

      return res.status(200).send(
        success({
          pipelineId,
          projectId,
          toonflowProjectId,
          syncedAssets: assets.length,
          syncedStoryboards: storyboards.length,
          syncedVideos: videos.length,
          message: "Pipeline results synced to Toonflow successfully",
        }),
      );
    } catch (err: any) {
      const msg = err.response?.data?.message || err.message || String(err);

      // Record failed sync
      try {
        await u.db("kv_syncStatus").insert({
          id: now,
          pipelineId,
          status: "failed",
          error: msg,
          syncTime: now,
          createTime: now,
        });
      } catch (e) {
        // Ignore
      }

      return res.status(502).send(error(`Sync failed: ${msg}`));
    }
  },
);
