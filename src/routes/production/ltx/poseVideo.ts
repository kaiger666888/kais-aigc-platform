import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import axios from "axios";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { LTX_CONFIG, LTX_DEFAULTS } from "./config";

const router = express.Router();

const LOCAL_STAGING_DIR = "/tmp/comfyui-ltx-input";
if (!fs.existsSync(LOCAL_STAGING_DIR)) {
  fs.mkdirSync(LOCAL_STAGING_DIR, { recursive: true });
}

const upload = multer({ dest: LOCAL_STAGING_DIR });

function copyToContainer(localPath: string, containerPath: string) {
  const { execSync, spawnSync } = require("child_process");
  try {
    execSync(`docker cp "${localPath}" ${LTX_CONFIG.containerName}:"${containerPath}"`, { timeout: 30_000 });
  } catch {
    const fileContent = fs.readFileSync(localPath);
    const child = spawnSync("docker", ["exec", "-i", LTX_CONFIG.containerName, "bash", "-c", `cat > "${containerPath}"`], {
      input: fileContent,
      timeout: 30_000,
    });
    if (child.status !== 0) throw new Error(child.stderr?.toString() || "docker exec failed");
  }
}

// LTX-2.3 numFrames 需要 8n+1
function roundTo8nPlus1(raw: number): number {
  return Math.ceil((raw - 1) / 8) * 8 + 1;
}

// ============================================================
// Kimodo gold-team client (motion_generate → BVH)
// ============================================================

interface KimodoTaskDetail {
  task_id: string;
  status: "queued" | "scheduled" | "running" | "completed" | "failed" | "cancelled";
  outputs?: Record<string, any>;
  error?: string | null;
  progress?: number | null;
}

async function submitKimodoMotion(opts: {
  taskId: string;
  prompt: string;
  durationSec: number;
  model?: string;
}): Promise<{ taskId: string }> {
  const body = {
    task_id: opts.taskId,
    type: "motion_generate",
    params: {
      prompt: opts.prompt,
      duration_sec: opts.durationSec,
      output_format: "bvh",
      model: opts.model || "kimodo-smplx-rp",
    },
  };
  const r = await axios.post(`${LTX_CONFIG.kimodoUrl}/api/v1/tasks`, body, {
    timeout: 30_000,
    validateStatus: (s) => s < 500,
  });
  if (r.status !== 202 && r.status !== 200) {
    throw new Error(`Kimodo rejected task: ${JSON.stringify(r.data)}`);
  }
  return { taskId: r.data.task_id || opts.taskId };
}

async function getKimodoTask(taskId: string): Promise<KimodoTaskDetail> {
  const r = await axios.get(`${LTX_CONFIG.kimodoUrl}/api/v1/tasks/${taskId}`, {
    timeout: 15_000,
    validateStatus: (s) => s < 500,
  });
  if (r.status !== 200) {
    throw new Error(`Kimodo GET task failed (${r.status}): ${JSON.stringify(r.data)}`);
  }
  return r.data as KimodoTaskDetail;
}

async function pollKimodoTask(
  taskId: string,
  opts: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<KimodoTaskDetail> {
  const intervalMs = opts.intervalMs ?? LTX_CONFIG.pollIntervalMs;
  const timeoutMs = opts.timeoutMs ?? LTX_CONFIG.pollTimeoutMs;
  const start = Date.now();
  let last: KimodoTaskDetail | null = null;

  while (Date.now() - start < timeoutMs) {
    const detail = await getKimodoTask(taskId);
    last = detail;
    if (detail.status === "completed") return detail;
    if (detail.status === "failed" || detail.status === "cancelled") {
      throw new Error(`Kimodo task ${detail.status}: ${detail.error || "no error detail"}`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Kimodo task ${taskId} timed out after ${timeoutMs / 1000}s (last status: ${last?.status})`);
}

/**
 * Extract BVH file path from completed Kimodo task.
 * Strategy: outputs.bvh (explicit) → outputs.video (fallback) → scan OUTPUT_DIR for newest .bvh.
 */
function extractBvhPath(detail: KimodoTaskDetail): string {
  const outputs = detail.outputs || {};
  const explicit = outputs.bvh || outputs.video || outputs.motion || outputs.file;
  if (typeof explicit === "string" && explicit.endsWith(".bvh") && fs.existsSync(explicit)) {
    return explicit;
  }

  // Fallback: scan /mnt/agents/output for the newest .bvh modified in last 10 min
  const outputDir = LTX_CONFIG.outputDir;
  if (!fs.existsSync(outputDir)) {
    throw new Error(`Cannot find BVH: ${outputDir} does not exist`);
  }
  const cutoff = Date.now() - 10 * 60 * 1000;
  const found: { path: string; mtime: number }[] = [];

  function walk(dir: string, depth: number) {
    if (depth > 4) return;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(full, depth + 1);
      } else if (e.isFile() && e.name.endsWith(".bvh")) {
        try {
          const st = fs.statSync(full);
          if (st.mtimeMs >= cutoff) {
            found.push({ path: full, mtime: st.mtimeMs });
          }
        } catch {}
      }
    }
  }
  walk(outputDir, 0);

  if (found.length === 0) {
    throw new Error(`Kimodo task ${detail.task_id} completed but no BVH file found in ${outputDir} (outputs=${JSON.stringify(outputs)})`);
  }
  found.sort((a, b) => b.mtime - a.mtime);
  return found[0].path;
}

// ============================================================
// Blender BVH renderer client (host :8095)
// ============================================================

interface BlenderBvhResponse {
  /** Blender /render/bvh returns render_output_dir + frames list (shape varies; we handle both) */
  [k: string]: any;
}

function extractRenderedFrames(data: BlenderBvhResponse): string[] {
  // Try common keys first
  const candidates = [
    data.frames,
    data.outputs,
    data.images,
    data.files,
    data.rendered_frames,
    data.result?.frames,
  ];
  for (const c of candidates) {
    if (Array.isArray(c) && c.length > 0) {
      return c.map((x: any) => (typeof x === "string" ? x : x?.path || x?.file || x?.url)).filter((x: any): x is string => typeof x === "string");
    }
  }
  // Single-string response
  if (typeof data.frame === "string") return [data.frame];
  if (typeof data.path === "string") return [data.path];

  // Last resort: if data has render_output_dir + subdir, glob the host dir
  const dir = data.render_output_dir || data.output_dir;
  const subdir = data.output_subdir || data.subdir;
  if (typeof dir === "string") {
    const fullDir = subdir ? path.join(dir, subdir) : dir;
    if (fs.existsSync(fullDir)) {
      const pngs = fs.readdirSync(fullDir)
        .filter((f) => f.endsWith(".png"))
        .sort()
        .map((f) => path.join(fullDir, f));
      if (pngs.length > 0) return pngs;
    }
  }
  throw new Error(`Could not extract rendered frames from Blender response: ${JSON.stringify(data)}`);
}

async function renderBvhInBlender(opts: {
  bvhPath: string;
  cameraAngles: string[];
  resolution: number;
  framesPerAngle: number;
}): Promise<string[]> {
  const body = {
    bvh_path: opts.bvhPath,
    camera_angles: opts.cameraAngles,
    resolution: opts.resolution,
    frames_per_angle: opts.framesPerAngle,
  };
  const r = await axios.post(`${LTX_CONFIG.blenderUrl}/render/bvh`, body, {
    timeout: 120_000,
    validateStatus: (s) => s < 500,
  });
  if (r.status !== 200) {
    throw new Error(`Blender /render/bvh failed (${r.status}): ${JSON.stringify(r.data)}`);
  }
  return extractRenderedFrames(r.data as BlenderBvhResponse);
}

// ============================================================
// LTX I2V workflow (NOT MSR — pure image-to-video with skeleton frame as image input)
// ============================================================

function buildPoseVideoWorkflow(opts: {
  inputFilename: string;
  prompt: string;
  negativePrompt: string;
  width: number;
  height: number;
  numFrames: number;
  fps: number;
  cfg: number;
  steps: number;
  seed: number;
  strength: number;
  filenamePrefix: string;
}) {
  const {
    inputFilename, prompt, negativePrompt,
    width, height, numFrames, fps,
    cfg, steps, seed, strength, filenamePrefix,
  } = opts;

  return {
    // 1: LoadImage (skeleton render PNG)
    "1": {
      class_type: "LoadImage",
      inputs: { image: inputFilename, upload: "image" },
    },
    // 2: CheckpointLoaderSimple — distilled-1.1 is the validated I2V checkpoint
    "2": {
      class_type: "CheckpointLoaderSimple",
      inputs: { ckpt_name: LTX_DEFAULTS.msrModelName },
    },
    // 3: LTXAVTextEncoderLoader — gemma fp8 clip (validated for LTX-2.3 I2V)
    "3": {
      class_type: "LTXAVTextEncoderLoader",
      inputs: {
        text_encoder: LTX_DEFAULTS.clipName1,
        ckpt_name: LTX_DEFAULTS.msrModelName,
        device: "default",
      },
    },
    // 4: CLIPTextEncode (positive)
    "4": {
      class_type: "CLIPTextEncode",
      inputs: { text: prompt, clip: ["3", 0] },
    },
    // 5: CLIPTextEncode (negative)
    "5": {
      class_type: "CLIPTextEncode",
      inputs: { text: negativePrompt, clip: ["3", 0] },
    },
    // 6: LTXVConditioning
    "6": {
      class_type: "LTXVConditioning",
      inputs: { positive: ["4", 0], negative: ["5", 0], frame_rate: fps },
    },
    // 7: EmptyLTXVLatentVideo
    "7": {
      class_type: "EmptyLTXVLatentVideo",
      inputs: { width, height, length: numFrames, batch_size: 1 },
    },
    // 8: LTXVImgToVideoConditionOnly — inject skeleton image as identity/motion conditioning
    "8": {
      class_type: "LTXVImgToVideoConditionOnly",
      inputs: {
        vae: ["2", 2],
        image: ["1", 0],
        latent: ["7", 0],
        strength,
        bypass: false,
      },
    },
    // 9: CFGGuider (model from checkpoint, conditionings from LTXVConditioning)
    "9": {
      class_type: "CFGGuider",
      inputs: {
        model: ["2", 0],
        positive: ["6", 0],
        negative: ["6", 1],
        cfg,
      },
    },
    // 10: KSamplerSelect
    "10": {
      class_type: "KSamplerSelect",
      inputs: { sampler_name: "euler" },
    },
    // 11: LTXVScheduler — validated LTX-2.3 distilled schedule
    "11": {
      class_type: "LTXVScheduler",
      inputs: {
        steps,
        max_shift: 2.05,
        base_shift: 0.95,
        stretch: true,
        terminal: 0.1,
      },
    },
    // 12: RandomNoise
    "12": {
      class_type: "RandomNoise",
      inputs: { noise_seed: seed },
    },
    // 13: SamplerCustomAdvanced
    "13": {
      class_type: "SamplerCustomAdvanced",
      inputs: {
        noise: ["12", 0],
        guider: ["9", 0],
        sampler: ["10", 0],
        sigmas: ["11", 0],
        latent_image: ["8", 0],
      },
    },
    // 14: VAEDecode
    "14": {
      class_type: "VAEDecode",
      inputs: { samples: ["13", 0], vae: ["2", 2] },
    },
    // 15: SaveAnimatedWEBP
    "15": {
      class_type: "SaveAnimatedWEBP",
      inputs: { images: ["14", 0], filename_prefix: `${filenamePrefix}_webp`, fps, lossless: false, quality: 90, method: "default" },
    },
    // 16: SaveWEBM (VHS)
    "16": {
      class_type: "SaveWEBM",
      inputs: { images: ["14", 0], filename_prefix: `${filenamePrefix}_webm`, fps, codec: "vp9", crf: 30 },
    },
  };
}

// ============================================================
// POST /api/production/ltx/poseVideo
// ============================================================
//
// 必填 (multipart/form-data):
//   prompt      — 动作描述 (同时用于 Kimodo + LTX)
//   ref1        — 角色参考图 (LTX I2V 的身份条件)
//   projectId   — 项目 ID
//
// 可选:
//   duration       — 秒, 默认 3
//   fps            — 默认 24
//   width          — 默认 768
//   height         — 默认 768
//   negativePrompt — 负向提示词
//   motionPrompt   — Kimodo 专用动作描述 (默认同 prompt)
//   cameraAngles   — 逗号分隔, "front,iso" 默认
//   poseFrameCount — BVH 渲染帧数 per angle, 默认 2
//   seed           — 随机种子
//   steps          — 采样步数, 默认 30
//   cfg            — CFG scale, 默认 3.0
//   strength       — I2V conditioning strength, 默认 0.7

export default router.post(
  "/",
  upload.single("ref1"),
  validateFields({
    projectId: z.coerce.number(),
    prompt: z.string().min(1),
  }),
  async (req, res) => {
    const projectId = Number(req.body.projectId);
    const prompt = req.body.prompt as string;
    const duration = Number(req.body.duration) || 3;
    const fps = Number(req.body.fps) || 24;
    const width = Number(req.body.width) || 768;
    const height = Number(req.body.height) || 768;
    const negativePrompt = (req.body.negativePrompt as string)
      || "worst quality, blurry, jittery, distorted, inconsistent appearance, broken bones, extra limbs";
    const motionPrompt = (req.body.motionPrompt as string) || prompt;
    const cameraAnglesStr = (req.body.cameraAngles as string) || "front,iso";
    const cameraAngles = cameraAnglesStr.split(",").map((s) => s.trim()).filter(Boolean);
    const poseFrameCount = Number(req.body.poseFrameCount) || 2;
    const seed = req.body.seed ? Number(req.body.seed) : Math.floor(Math.random() * 2147483647);
    const steps = Number(req.body.steps) || 30;
    const cfg = Number(req.body.cfg) || 3.0;
    const strength = Number(req.body.strength) || 0.7;

    if (!req.file) {
      return res.status(400).send(error("ref1 (character reference image) is required"));
    }
    if (cameraAngles.length === 0) {
      return res.status(400).send(error("cameraAngles must contain at least one of: front, side, back, iso, top"));
    }

    const poseVideoId = uuidv4();
    const kimodoTaskId = `pose-${poseVideoId}`;
    const filenamePrefix = `ltx_pose_${projectId}_${Date.now()}_${poseVideoId.slice(0, 8)}`;

    // --- Step 1: Submit Kimodo motion_generate task ---
    let bvhPath: string;
    let kimodoTaskDetail: KimodoTaskDetail;
    try {
      await submitKimodoMotion({ taskId: kimodoTaskId, prompt: motionPrompt, durationSec: duration });
      kimodoTaskDetail = await pollKimodoTask(kimodoTaskId);
      bvhPath = extractBvhPath(kimodoTaskDetail);
    } catch (err: any) {
      try { fs.unlinkSync(req.file.path); } catch {}
      const msg = err.response?.data?.detail || err.message || String(err);
      return res.status(502).send(error(`Kimodo BVH generation failed: ${msg}`));
    }

    // --- Step 2: Blender BVH render ---
    let renderedFrames: string[];
    try {
      renderedFrames = await renderBvhInBlender({
        bvhPath,
        cameraAngles,
        resolution: Math.min(width, height),
        framesPerAngle: poseFrameCount,
      });
    } catch (err: any) {
      try { fs.unlinkSync(req.file.path); } catch {}
      const msg = err.response?.data?.detail || err.message || String(err);
      return res.status(502).send(error(`Blender BVH render failed: ${msg}`));
    }

    // Pick first "front" frame (or first available) for LTX I2V image input
    const frontFrame = renderedFrames.find((p) => path.basename(p).toLowerCase().includes("front")) || renderedFrames[0];

    // --- Step 3: docker cp skeleton PNG into ComfyUI container ---
    const skelExt = path.extname(frontFrame) || ".png";
    const skelFilename = `${uuidv4()}${skelExt}`;
    const skelContainerPath = `${LTX_CONFIG.comfyuiInputDir}/${skelFilename}`;
    try {
      copyToContainer(frontFrame, skelContainerPath);
    } catch (err: any) {
      try { fs.unlinkSync(req.file.path); } catch {}
      return res.status(502).send(error(`Failed to upload skeleton frame to ComfyUI: ${err.message}`));
    }

    // --- Step 4: docker cp character ref into ComfyUI container ---
    const refExt = path.extname(req.file.originalname || ".png") || ".png";
    const refFilename = `${uuidv4()}${refExt}`;
    const refContainerPath = `${LTX_CONFIG.comfyuiInputDir}/${refFilename}`;
    try {
      copyToContainer(req.file.path, refContainerPath);
    } catch (err: any) {
      try { fs.unlinkSync(req.file.path); } catch {}
      return res.status(502).send(error(`Failed to upload ref1 to ComfyUI: ${err.message}`));
    }
    try { fs.unlinkSync(req.file.path); } catch {}

    // --- Step 5: Build + submit LTX I2V workflow ---
    const numFrames = roundTo8nPlus1(Math.round(duration * fps) + 1);
    const workflow = buildPoseVideoWorkflow({
      inputFilename: skelFilename,
      prompt,
      negativePrompt,
      width,
      height,
      numFrames,
      fps,
      cfg,
      steps,
      seed,
      strength,
      filenamePrefix,
    });

    try {
      const comfyRes = await axios.post(
        `${LTX_CONFIG.comfyuiUrl}/prompt`,
        { prompt: workflow },
        { timeout: 30_000, validateStatus: (s: number) => s < 500 },
      );

      if (comfyRes.status !== 200) {
        return res.status(502).send(error(`ComfyUI rejected prompt: ${JSON.stringify(comfyRes.data)}`));
      }

      const promptId = comfyRes.data.prompt_id;
      const actualDuration = ((numFrames - 1) / fps).toFixed(1);

      res.status(200).send(success({
        promptId,
        status: "pending",
        poseVideoId,
        message: "LTX Pose-Guided Video task submitted",
        params: {
          width, height,
          duration: `${actualDuration}s`,
          fps,
          numFrames,
          seed,
          steps,
          cfg,
          strength,
        },
        stages: {
          bvh: {
            taskId: kimodoTaskDetail.task_id,
            path: bvhPath,
            outputs: kimodoTaskDetail.outputs || {},
          },
          blender: {
            frames: renderedFrames,
            frontFrame,
            containerFilename: skelFilename,
          },
          ltx: {
            promptId,
            refFilename,
            skelFilename,
          },
        },
      }));
    } catch (err: any) {
      const msg = err.response?.data?.error?.message || err.response?.data?.node_errors || err.message || String(err);
      res.status(502).send(error(`ComfyUI request failed: ${msg}`));
    }
  },
);
