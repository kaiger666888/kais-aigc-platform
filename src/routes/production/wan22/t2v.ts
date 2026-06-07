import express from "express";
import axios from "axios";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { WAN22_CONFIG, WAN22_DEFAULTS } from "./_shared/config";
import { buildT2VWorkflow } from "./_shared/workflows";

const router = express.Router();

export default router.post(
  "/",
  validateFields({ projectId: z.number(), prompt: z.string().min(1) }),
  async (req, res) => {
    const { projectId, prompt } = req.body;
    const negativePrompt = req.body.negativePrompt || "色调艳丽，过曝，静态，细节模糊不清，字幕，风格，作品，画作，画面，静止，整体发灰，最差质量，低质量，JPEG压缩残留，丑陋的，残缺的，畸形的，毁容的，形态畸形的肢体，手指融合，静止不动的画面，杂乱的背景";
    const width = Number(req.body.width) || 480;
    const height = Number(req.body.height) || 480;
    const numFrames = Number(req.body.numFrames) || 81;
    const fps = Number(req.body.fps) || WAN22_DEFAULTS.fps;
    const seed = req.body.seed ? Number(req.body.seed) : Math.floor(Math.random() * 2147483647);
    const stepsStage1 = Number(req.body.stepsStage1) || 20;
    const stepsStage2 = Number(req.body.stepsStage2) || 20;
    const shift = Number(req.body.shift) ?? WAN22_DEFAULTS.shift;
    const samplerName = req.body.samplerName || WAN22_DEFAULTS.samplerName;
    const scheduler = req.body.scheduler || WAN22_DEFAULTS.scheduler;
    const filenamePrefix = req.body.filenamePrefix || `wan22_t2v_${projectId}_${Date.now()}`;
    const crf = Number(req.body.crf) || WAN22_DEFAULTS.crf;
    const highNoiseModel = req.body.highNoiseModel || WAN22_DEFAULTS.t2vHighNoiseModel;
    const lowNoiseModel = req.body.lowNoiseModel || WAN22_DEFAULTS.t2vLowNoiseModel;
    const textEncoder = req.body.textEncoder || WAN22_DEFAULTS.textEncoder;
    const vae = req.body.vae || WAN22_DEFAULTS.vae;

    const workflow = buildT2VWorkflow({
      prompt, negativePrompt,
      width, height, numFrames, fps, seed,
      stepsStage1, stepsStage2, shift, samplerName, scheduler,
      filenamePrefix, crf, highNoiseModel, lowNoiseModel, textEncoder, vae,
    });

    try {
      const comfyRes = await axios.post(
        `${WAN22_CONFIG.comfyuiUrl}/prompt`,
        { prompt: workflow },
        { timeout: 30_000, validateStatus: (s: number) => s < 500 },
      );
      if (comfyRes.status !== 200) return res.status(502).send(error(`ComfyUI rejected: ${JSON.stringify(comfyRes.data)}`));
      const promptId = comfyRes.data.prompt_id;
      res.status(200).send(success({ promptId, status: "pending", workflowType: "t2v", message: "Wan 2.2 T2V submitted" }));
    } catch (err: any) {
      const msg = err.response?.data?.error?.message || err.response?.data?.node_errors || err.message || String(err);
      res.status(502).send(error(`ComfyUI failed: ${msg}`));
    }
  },
);
