import express from "express";
import axios from "axios";
import { v4 as uuidv4 } from "uuid";
import { success, error } from "@/lib/responseFormat";
import { HUNYUAN3D_CONFIG } from "./config";

const router = express.Router();

/**
 * POST /api/v1/hunyuan3d/image-to-3d
 *
 * Submit an image-to-3D task via gold-team unified task API.
 * Supports both single-view (2mini/2.1) and multiview (2mv) modes.
 *
 * Single-view body: { image, model?, texture_mode?, steps?, seed?, render_size?, texture_size? }
 *   - model: "mini" (default, recommended) or "full"
 *   - texture_mode: "none" (geometry only) or "texture" (PBR multiview paint, adds ~8min)
 *   - render_size/texture_size: PBR resolution (default 1024; use 512 for low VRAM)
 *
 * Multiview body:  { mode: "mv", front, left?, back?, right?, steps?, seed? }
 *
 * Returns: { task_id, status }
 */
export default router.post("/image-to-3d", async (req, res) => {
  const { image, mode, front, left, back, right, model, texture_mode, steps, seed, render_size, texture_size } = req.body || {};

  // Multiview mode
  if (mode === "mv" || front) {
    if (!front && !image) {
      return res.status(400).send(error("'front' image is required for multiview mode"));
    }

    const task_id = `hy3dmv_${uuidv4().replace(/-/g, "").slice(0, 12)}`;
    const params: Record<string, any> = {
      front_image: front || image,
      left_image: left || "",
      back_image: back || "",
      right_image: right || "",
      steps: steps || 50,
    };
    if (seed !== undefined) params.seed = seed;

    const payload = {
      task_id,
      type: "image_to_3d_mv",
      priority: "normal",
      model_preference: "hunyuan3d-mv-local",
      params,
    };

    try {
      const resp = await axios.post(
        `${HUNYUAN3D_CONFIG.goldTeamUrl}/api/v1/tasks`,
        payload,
        { timeout: 15_000, validateStatus: (s) => s < 500 },
      );

      if (resp.status === 202 || resp.status === 200) {
        const data = resp.data;
        return res.status(202).send(success({
          task_id,
          gold_team_task_id: data.task_id || task_id,
          status: data.status || "queued",
          engine_target: data.engine_target,
          queue_position: data.queue_position,
          estimated_start_sec: data.estimated_start_sec,
          views: ["front", ...(left ? ["left"] : []), ...(back ? ["back"] : []), ...(right ? ["right"] : [])],
          message: "Hunyuan3D-2mv multiview image-to-3D task submitted",
        }));
      }

      return res.status(502).send(error(`Gold-team rejected task: ${JSON.stringify(resp.data)}`));
    } catch (err: any) {
      const msg = err.response?.data?.detail?.message || err.response?.data?.error || err.message || String(err);
      return res.status(502).send(error(`Gold-team request failed: ${msg}`));
    }
  }

  // Single-view mode (default, Hunyuan3D-2mini)
  if (!image) {
    return res.status(400).send(error("'image' field is required (URL or local path)"));
  }

  const task_id = `hy3d_${uuidv4().replace(/-/g, "").slice(0, 12)}`;
  const params: Record<string, any> = {
    input_image: image,
    model: model || "mini",
    texture_mode: texture_mode || "none",
    steps: steps || 50,
    render_size: render_size || 1024,
    texture_size: texture_size || 1024,
  };
  if (seed !== undefined) params.seed = seed;

  const payload = {
    task_id,
    type: "image_to_3d",
    priority: "normal",
    model_preference: HUNYUAN3D_CONFIG.engineId,
    params,
  };

  try {
    const resp = await axios.post(
      `${HUNYUAN3D_CONFIG.goldTeamUrl}/api/v1/tasks`,
      payload,
      { timeout: 15_000, validateStatus: (s) => s < 500 },
    );

    if (resp.status === 202 || resp.status === 200) {
      const data = resp.data;
      return res.status(202).send(success({
        task_id,
        gold_team_task_id: data.task_id || task_id,
        status: data.status || "queued",
        engine_target: data.engine_target,
        queue_position: data.queue_position,
        estimated_start_sec: data.estimated_start_sec,
        message: "Hunyuan3D image-to-3D task submitted",
      }));
    }

    return res.status(502).send(error(`Gold-team rejected task: ${JSON.stringify(resp.data)}`));
  } catch (err: any) {
    const msg = err.response?.data?.detail?.message || err.response?.data?.error || err.message || String(err);
    return res.status(502).send(error(`Gold-team request failed: ${msg}`));
  }
});
