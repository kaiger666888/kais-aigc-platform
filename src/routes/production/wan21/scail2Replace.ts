import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import axios from "axios";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { SCAIL2_CONFIG, SCAIL2_DEFAULTS } from "./_shared/scail2-config";
import { buildSCAIL2ReplaceWorkflow } from "./_shared/scail2-workflows";

const router = express.Router();

const LOCAL_STAGING_DIR = "/tmp/comfyui-wan21-scail2-input";
if (!fs.existsSync(LOCAL_STAGING_DIR)) fs.mkdirSync(LOCAL_STAGING_DIR, { recursive: true });
const upload = multer({ dest: LOCAL_STAGING_DIR });

function copyToContainer(localPath: string, containerPath: string) {
  const { execSync, spawnSync } = require("child_process");
  try {
    execSync(`docker cp "${localPath}" ${SCAIL2_CONFIG.containerName}:"${containerPath}"`, { timeout: 60_000 });
  } catch {
    const fileContent = fs.readFileSync(localPath);
    const child = spawnSync("docker", ["exec", "-i", SCAIL2_CONFIG.containerName, "bash", "-c", `cat > "${containerPath}"`], {
      input: fileContent, timeout: 120_000,
    });
    if (child.status !== 0) throw new Error(child.stderr?.toString() || "docker exec failed");
  }
}

export default router.post(
  "/",
  upload.fields([
    { name: "poseVideo", maxCount: 1 },
    { name: "referenceImage", maxCount: 1 },
  ]),
  validateFields({ projectId: z.coerce.number(), prompt: z.string().min(1) }),
  async (req, res) => {
    const { projectId, prompt } = req.body;
    const negativePrompt = req.body.negativePrompt || SCAIL2_DEFAULTS.negativePrompt;
    const width = Number(req.body.width) || SCAIL2_DEFAULTS.width;
    const height = Number(req.body.height) || SCAIL2_DEFAULTS.height;
    const pass2Height = Number(req.body.pass2Height) || SCAIL2_DEFAULTS.pass2Height;
    const numFrames = Number(req.body.numFrames) || SCAIL2_DEFAULTS.numFrames;
    const fps = Number(req.body.fps) || SCAIL2_DEFAULTS.fps;
    const seed = req.body.seed ? Number(req.body.seed) : Math.floor(Math.random() * 2147483647);
    const steps = Number(req.body.steps) || SCAIL2_DEFAULTS.steps;
    const shift = Number(req.body.shift) || SCAIL2_DEFAULTS.shift;
    const lightx2vStrength = Number(req.body.lightx2vStrength) || SCAIL2_DEFAULTS.lightx2vStrength;
    const relightStrength = Number(req.body.relightStrength) || SCAIL2_DEFAULTS.relightStrength;
    const filenamePrefix = req.body.filenamePrefix || `scail2_replace_${projectId}_${Date.now()}`;
    const crf = Number(req.body.crf) || SCAIL2_DEFAULTS.crf;
    const scailModel = req.body.scailModel || SCAIL2_DEFAULTS.scailModel;
    const lightx2vLora = req.body.lightx2vLora || SCAIL2_DEFAULTS.lightx2vLora;
    const relightLora = req.body.relightLora || SCAIL2_DEFAULTS.relightLora;
    const samModel = req.body.samModel || SCAIL2_DEFAULTS.samModel;
    const textEncoder = req.body.textEncoder || SCAIL2_DEFAULTS.textEncoder;
    const clipVision = req.body.clipVision || SCAIL2_DEFAULTS.clipVision;
    const vae = req.body.vae || SCAIL2_DEFAULTS.vae;

    const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
    if (!files?.poseVideo?.[0] || !files?.referenceImage?.[0]) {
      return res.status(400).send(error("poseVideo and referenceImage are required"));
    }

    const poseFile = files.poseVideo[0];
    const refFile = files.referenceImage[0];
    const poseExt = path.extname(poseFile.originalname || ".mp4") || ".mp4";
    const refExt = path.extname(refFile.originalname || ".png") || ".png";
    const poseVideoFilename = `${uuidv4()}${poseExt}`;
    const referenceImageFilename = `${uuidv4()}${refExt}`;

    try {
      copyToContainer(poseFile.path, `${SCAIL2_CONFIG.comfyuiInputDir}/${poseVideoFilename}`);
      copyToContainer(refFile.path, `${SCAIL2_CONFIG.comfyuiInputDir}/${referenceImageFilename}`);
    } catch (err: any) {
      try { fs.unlinkSync(poseFile.path); } catch {}
      try { fs.unlinkSync(refFile.path); } catch {}
      return res.status(502).send(error(`Upload failed: ${err.message}`));
    }
    try { fs.unlinkSync(poseFile.path); } catch {}
    try { fs.unlinkSync(refFile.path); } catch {}

    const workflow = buildSCAIL2ReplaceWorkflow({
      poseVideoFilename, referenceImageFilename, prompt, negativePrompt,
      width, height, pass2Height, numFrames, fps, seed, steps, shift,
      lightx2vStrength, relightStrength,
      filenamePrefix, crf,
      scailModel, lightx2vLora, relightLora, samModel, textEncoder, clipVision, vae,
    });

    try {
      const comfyRes = await axios.post(
        `${SCAIL2_CONFIG.comfyuiUrl}/prompt`,
        { prompt: workflow },
        { timeout: 30_000, validateStatus: (s: number) => s < 500 },
      );
      if (comfyRes.status !== 200) return res.status(502).send(error(`ComfyUI rejected: ${JSON.stringify(comfyRes.data)}`));
      const promptId = comfyRes.data.prompt_id;
      res.status(200).send(success({ promptId, status: "pending", workflowType: "scail2-replace", message: "SCAIL2 character replace submitted", poseVideoFilename, referenceImageFilename }));
    } catch (err: any) {
      const msg = err.response?.data?.error?.message || err.response?.data?.node_errors || err.message || String(err);
      res.status(502).send(error(`ComfyUI failed: ${msg}`));
    }
  },
);
