import express from "express";
import u from "@/utils";
import axios from "axios";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { broadcastToProject } from "@/utils/ws";

const router = express.Router();

const MOVIE_AGENT_URL = process.env.MOVIE_AGENT_URL || "http://localhost:8001";

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    scriptId: z.number().optional(),
    config: z.any().optional(),
  }),
  async (req, res) => {
    const { projectId, scriptId, config } = req.body;

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
      const createRes = await axios.post(
        `${MOVIE_AGENT_URL}/api/v1/pipeline/create`,
        { project_id: String(projectId), config: config || {}, metadata: initialData },
        { headers: { "Content-Type": "application/json" }, timeout: 15_000, validateStatus: (s) => s < 500 },
      );

      if (createRes.status !== 201) {
        return res.status(502).send(error(`movie-agent create failed: ${JSON.stringify(createRes.data)}`));
      }

      const pipelineId = createRes.data.pipeline_id || createRes.data.id;

      const startRes = await axios.post(
        `${MOVIE_AGENT_URL}/api/v1/pipeline/${pipelineId}/start`,
        {},
        { headers: { "Content-Type": "application/json" }, timeout: 15_000, validateStatus: (s) => s < 500 },
      );

      if (startRes.status !== 202) {
        return res.status(502).send(error(`movie-agent start failed: ${JSON.stringify(startRes.data)}`));
      }

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
