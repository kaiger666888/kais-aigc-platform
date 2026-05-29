import express from "express";
import u from "@/utils";
import axios from "axios";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { broadcastToProject, getIo } from "@/utils/ws";

const router = express.Router();

const MOVIE_AGENT_URL = process.env.MOVIE_AGENT_URL || "http://localhost:8001";

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    scriptId: z.number().optional(),
    episodesId: z.number().optional(),
    config: z.any().optional(),
  }),
  async (req, res) => {
    const { projectId, scriptId, episodesId, config } = req.body;

    const project = await u.db("o_project").where({ id: projectId }).first();
    if (!project) {
      return res.status(404).send(error(`Project ${projectId} not found`));
    }

    let script = null;
    if (scriptId) {
      script = await u.db("o_script").where({ id: scriptId, projectId }).first();
    }
    if (!script) {
      script = await u.db("o_script").where({ projectId }).orderBy("createTime", "desc").first();
    }

    const assets = await u.db("o_assets").where({ projectId }).select("*");

    const initialData: Record<string, any> = {
      project_id: String(projectId),
      title: project.name || "Untitled",
      genre: project.type || "animation",
      videoRatio: project.videoRatio || "9:16",
      artStyle: project.artStyle || "",
      directorManual: project.directorManual || "",
      mode: project.mode || "",
      imageModel: project.imageModel || "",
      videoModel: project.videoModel || "",
    };

    if (script) {
      initialData.script = {
        id: script.id,
        content: script.content,
        name: script.name,
      };
    }

    if (assets.length > 0) {
      initialData.characters = assets
        .filter((a: any) => a.type === "role")
        .map((a: any) => ({ id: a.id, name: a.name, description: a.describe, prompt: a.prompt }));
      initialData.scenes = assets
        .filter((a: any) => a.type === "scene")
        .map((a: any) => ({ id: a.id, name: a.name, description: a.describe, prompt: a.prompt }));
    }

    try {
      // movie-agent uses /api/v1/pipeline/run (create + start combined)
      const runRes = await axios.post(
        `${MOVIE_AGENT_URL}/api/v1/pipeline/run`,
        {
          project_id: String(projectId),
          phases: ['requirement', 'art-direction', 'character', 'scenario', 'voice', 'storyboard', 'scene', 'camera-preview', 'camera-final', 'post-production', 'quality-gate'],
          config: {
            ...config,
            goldTeam: {
              baseUrl: process.env.GOLD_TEAM_URL || 'http://kais-aigc-platform-gold-team-1:8002',
              enableFluxArt: true,
              enableVideoGpu: true,
              enableBGM: false,
              enableSFX: false,
            },
            reviewPlatform: {
              baseUrl: process.env.REVIEW_PLATFORM_URL || 'http://kais-review-platform:8090',
            },
            comfyui: {
              baseUrl: process.env.COMFYUI_URL || 'http://localhost:8188',
            },
            // Toonflow bridge config
            projectId,
            scriptId: script?.id || scriptId || null,
            episodesId: episodesId || script?.id || null,
            toonflowBaseUrl: 'http://kais-core-backend:8000',
            ossRoot: '/app/data/oss',
            ...initialData,
          },
        },
        { headers: { "Content-Type": "application/json" }, timeout: 30_000, validateStatus: (s) => s < 500 },
      );

      if (runRes.status !== 200 && runRes.status !== 202 && runRes.status !== 201) {
        return res.status(502).send(error(`movie-agent run failed: ${JSON.stringify(runRes.data)}`));
      }

      const pipelineId = runRes.data.pipeline_id || runRes.data.id;

      const now = Date.now();
      await u.db("kv_pipelineRun").insert({
        id: pipelineId,
        projectId,
        scriptId: script?.id || null,
        state: "running",
        currentPhase: "requirement",
        currentPhaseOrder: 0,
        config: JSON.stringify(config || {}),
        createTime: now,
        updateTime: now,
      });

      broadcastToProject(projectId, "pipeline:started", { pipelineId, projectId });

      // Also emit on the dedicated pipelineProgress namespace
      const io = getIo();
      if (io) {
        io.of("/api/socket/pipelineProgress")
          .to(`pipeline:${pipelineId}`)
          .emit("pipeline:started", { pipelineId, projectId, currentPhase: "requirement" });
      }

      res.status(200).send(success({
        pipelineId,
        status: "running",
        message: "pipeline started",
      }));
    } catch (err: any) {
      const msg = err.response?.data?.error || err.message || String(err);
      res.status(502).send(error(`movie-agent unreachable: ${msg}`));
    }
  },
);
