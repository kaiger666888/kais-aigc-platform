import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import axios from "axios";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import {
  VramInsufficientError,
  QueueTimeoutError,
  QueueAbortedError,
  QueuePurgedError,
  withGpuQueue,
} from "@/lib/gpuVramManager";
import { WAN22_CONFIG, WAN22_DEFAULTS } from "./_shared/config";
import { buildI2VWorkflow } from "./_shared/workflows";

const router = express.Router();

const LOCAL_STAGING_DIR = "/tmp/comfyui-wan22-input";
if (!fs.existsSync(LOCAL_STAGING_DIR)) fs.mkdirSync(LOCAL_STAGING_DIR, { recursive: true });
const upload = multer({ dest: LOCAL_STAGING_DIR });

function copyToContainer(localPath: string, containerPath: string) {
  const { execSync, spawnSync } = require("child_process");
  try {
    execSync(`docker cp "${localPath}" ${WAN22_CONFIG.containerName}:"${containerPath}"`, { timeout: 60_000 });
  } catch {
    const fileContent = fs.readFileSync(localPath);
    const child = spawnSync("docker", ["exec", "-i", WAN22_CONFIG.containerName, "bash", "-c", `cat > "${containerPath}"`], {
      input: fileContent, timeout: 120_000,
    });
    if (child.status !== 0) throw new Error(child.stderr?.toString() || "docker exec failed");
  }
}

export default router.post(
  "/",
  upload.single("sourceImage"),
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
    const filenamePrefix = req.body.filenamePrefix || `wan22_i2v_${projectId}_${Date.now()}`;
    const crf = Number(req.body.crf) || WAN22_DEFAULTS.crf;
    const highNoiseModel = req.body.highNoiseModel || WAN22_DEFAULTS.highNoiseModel;
    const lowNoiseModel = req.body.lowNoiseModel || WAN22_DEFAULTS.lowNoiseModel;
    const textEncoder = req.body.textEncoder || WAN22_DEFAULTS.textEncoder;
    const vae = req.body.vae || WAN22_DEFAULTS.vae;

    if (!req.file) return res.status(400).send(error("sourceImage is required"));

    const ext = path.extname(req.file.originalname || ".png") || ".png";
    const inputFilename = `${uuidv4()}${ext}`;
    const containerPath = `${WAN22_CONFIG.comfyuiInputDir}/${inputFilename}`;

    try {
      copyToContainer(req.file.path, containerPath);
    } catch (err: any) {
      try { fs.unlinkSync(req.file.path); } catch {}
      return res.status(502).send(error(`Upload to ComfyUI failed: ${err.message}`));
    }
    try { fs.unlinkSync(req.file.path); } catch {}

    const workflow = buildI2VWorkflow({
      inputFilename, prompt, negativePrompt,
      width, height, numFrames, fps, seed,
      stepsStage1, stepsStage2, shift, samplerName, scheduler,
      filenamePrefix, crf, highNoiseModel, lowNoiseModel, textEncoder, vae,
    });

    // ─── 2026-08-19 收编：GPU 全局串行队列 (gpuVramManager withGpuQueue) ───
    // 来源 docs/engine-integration-spec.md M2 / docs/gpu-unified-scheduling-plan.md §P2-A。
    // Wan2.2 (~12GB, ENGINE_VRAM_REQUIREMENTS.wan22) 与 TTS/H3/music3/qwen_eye 共享
    // GPU1 锁 — 此前直提 ComfyUI 绕过队列, 是同卡撞车源。异步 taskId 模式: 锁只包
    // 「提交段」(显存预检/驱逐 + POST /prompt), 作业在 ComfyUI 侧异步跑, 客户端轮询
    // status 路由。multipart 解析/容器拷贝均在队列外 (不持锁等上传)。
    try {
      const submitted = await withGpuQueue(
        "wan22",
        async () => {
          const comfyRes = await axios.post(
            `${WAN22_CONFIG.comfyuiUrl}/prompt`,
            { prompt: workflow },
            { timeout: 30_000, validateStatus: (s: number) => s < 500 },
          );
          if (comfyRes.status !== 200) {
            return { kind: "rejected" as const, detail: JSON.stringify(comfyRes.data) };
          }
          return { kind: "ok" as const, promptId: comfyRes.data.prompt_id as string };
        },
        { gpuIndex: 1, comfyuiUrl: WAN22_CONFIG.comfyuiUrl },
      );

      if (submitted.kind === "rejected") {
        return res.status(502).send(error(`ComfyUI rejected: ${submitted.detail}`));
      }
      const promptId = submitted.promptId;
      res.status(200).send(success({ promptId, status: "pending", workflowType: "i2v", message: "Wan 2.2 I2V submitted", inputFilename }));
    } catch (err: any) {
      if (err instanceof VramInsufficientError) {
        return res.status(503).send(error(err.message, {
          kind: "vram_insufficient",
          engine: "wan22",
          freeMiB: err.freeMiB,
          requiredMiB: err.requiredMiB,
          gpuIndex: err.gpuIndex,
        }));
      }
      // 队列类结构化错误: queue_timeout→504 / queue_aborted→499 / queue_purged→503
      // (镜像 minimax-h3/generate.ts 三联判)
      if (
        err instanceof QueueTimeoutError ||
        err instanceof QueueAbortedError ||
        err instanceof QueuePurgedError
      ) {
        const status =
          err.kind === "queue_timeout" ? 504 : err.kind === "queue_aborted" ? 499 : 503;
        return res.status(status).send(error(err.message, {
          kind: err.kind,
          engine: err.engine,
          gpuIndex: err.gpuIndex,
        }));
      }
      const msg = err.response?.data?.error?.message || err.response?.data?.node_errors || err.message || String(err);
      res.status(502).send(error(`ComfyUI failed: ${msg}`));
    }
  },
);
