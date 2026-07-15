import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import axios from "axios";
import { execSync, spawnSync } from "child_process";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { POSTPROCESS_CONFIG, SEEDVR2_MODELS, SEEDVR2_DEFAULTS, SeedVR2ColorCorrection } from "./_shared/config";
import { buildSeedVR2ImageWorkflow, buildSeedVR2VideoWorkflow } from "./_shared/seedvr2Workflow";

const router = express.Router();

const LOCAL_STAGING_DIR = "/tmp/comfyui-seedvr2-input";
if (!fs.existsSync(LOCAL_STAGING_DIR)) fs.mkdirSync(LOCAL_STAGING_DIR, { recursive: true });

// 视频文件可能较大，给到 1GB
const upload = multer({
  dest: LOCAL_STAGING_DIR,
  limits: { fileSize: 1024 * 1024 * 1024 },
});

const IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp", "image/bmp"]);
const VIDEO_MIMES = new Set(["video/mp4", "video/webm", "video/quicktime", "video/x-matroska", "video/mpeg"]);
const VIDEO_EXTS = new Set([".mp4", ".webm", ".mov", ".mkv", ".mpeg", ".mpg"]);

/** 复制文件到 ComfyUI 容器 */
function copyToContainer(localPath: string, containerPath: string) {
  try {
    execSync(`docker cp "${localPath}" ${POSTPROCESS_CONFIG.containerName}:"${containerPath}"`, { timeout: 120_000 });
  } catch {
    const fileContent = fs.readFileSync(localPath);
    const child = spawnSync("docker", ["exec", "-i", POSTPROCESS_CONFIG.containerName, "bash", "-c", `cat > "${containerPath}"`], {
      input: fileContent,
      timeout: 300_000,
    });
    if (child.status !== 0) throw new Error(child.stderr?.toString() || "docker exec failed");
  }
}

/** 用 ffprobe 提取视频帧率（失败返回 24） */
function probeFrameRate(localPath: string): number {
  try {
    const out = execSync(
      `ffprobe -v error -select_streams v:0 -show_entries stream=r_frame_rate -of csv=p=0 "${localPath}"`,
      { timeout: 30_000 },
    ).toString().trim();
    // 形如 "30/1" 或 "30000/1001"
    const [num, den] = out.split("/").map(Number);
    if (den && !isNaN(num)) return Math.round((num / den) * 100) / 100;
    const fps = Number(out);
    return isNaN(fps) ? 24 : fps;
  } catch {
    return 24;
  }
}

// ─── POST /api/production/postprocess/seedvr2 ─────────────
// SeedVR2 扩散超分：单图或视频

const seedvr2Schema = {
  mode: z.enum(["image", "video"]).optional(),
  model: z.string().optional(),
  resolution: z.coerce.number().int().min(16).max(16384).optional(),
  maxResolution: z.coerce.number().int().min(0).max(16384).optional(),
  batchSize: z.coerce.number().int().min(1).max(16384).optional(),
  temporalOverlap: z.coerce.number().int().min(0).max(16).optional(),
  uniformBatchSize: z.union([z.boolean(), z.string()]).optional(),
  colorCorrection: z.enum(["lab", "wavelet", "wavelet_adaptive", "hsv", "adain", "none"]).optional(),
  frameRate: z.coerce.number().min(1).max(240).optional(),
  device: z.enum(["cuda:0", "cuda:1"]).optional(),
  blocksToSwap: z.coerce.number().int().min(0).max(36).optional(),
  encodeTiled: z.union([z.boolean(), z.string()]).optional(),
  decodeTiled: z.union([z.boolean(), z.string()]).optional(),
  seed: z.coerce.number().int().min(0).max(4294967295).optional(),
  filenamePrefix: z.string().optional(),
};

export default router.post(
  "/",
  upload.single("file"),
  validateFields(seedvr2Schema),
  async (req, res) => {
    if (!req.file) return res.status(400).send(error("file is required"));

    // ─── 判定模式（显式 > MIME > 扩展名） ──────────────
    const ext = path.extname(req.file.originalname || "").toLowerCase();
    const mime = req.file.mimetype || "";
    let mode: "image" | "video" = req.body.mode;
    if (!mode) {
      if (VIDEO_MIMES.has(mime) || VIDEO_EXTS.has(ext)) mode = "video";
      else if (IMAGE_MIMES.has(mime)) mode = "image";
      else {
        try { fs.unlinkSync(req.file.path); } catch {}
        return res.status(400).send(error(`Unsupported file type: ${mime || ext}`));
      }
    }

    // ─── 上传到 ComfyUI 容器 ──────────────────────────
    const inputFilename = `${uuidv4()}${ext || (mode === "video" ? ".mp4" : ".png")}`;
    const containerPath = `${POSTPROCESS_CONFIG.comfyuiInputDir}/${inputFilename}`;
    try {
      copyToContainer(req.file.path, containerPath);
    } catch (err: any) {
      try { fs.unlinkSync(req.file.path); } catch {}
      return res.status(502).send(error(`Upload to ComfyUI failed: ${err.message}`));
    }

    // 提取视频帧率（视频模式）
    let frameRate = Number(req.body.frameRate) || 0;
    if (mode === "video") {
      if (!frameRate) frameRate = probeFrameRate(req.file.path);
    }
    try { fs.unlinkSync(req.file.path); } catch {}

    const filenamePrefix = req.body.filenamePrefix || `seedvr2_${mode}_${Date.now()}`;

    // ─── 构建 workflow ────────────────────────────────
    const commonOpts = {
      filenamePrefix,
      ditModel: req.body.model,
      device: req.body.device,
      blocksToSwap: req.body.blocksToSwap !== undefined ? Number(req.body.blocksToSwap) : undefined,
      encodeTiled: req.body.encodeTiled !== undefined ? String(req.body.encodeTiled) === "true" : undefined,
      decodeTiled: req.body.decodeTiled !== undefined ? String(req.body.decodeTiled) === "true" : undefined,
      resolution: req.body.resolution !== undefined ? Number(req.body.resolution) : SEEDVR2_DEFAULTS.resolution,
      maxResolution: req.body.maxResolution !== undefined ? Number(req.body.maxResolution) : SEEDVR2_DEFAULTS.maxResolution,
      colorCorrection: (req.body.colorCorrection as SeedVR2ColorCorrection) || SEEDVR2_DEFAULTS.colorCorrection,
      seed: req.body.seed !== undefined ? Number(req.body.seed) : SEEDVR2_DEFAULTS.seed,
    };

    const workflow =
      mode === "image"
        ? buildSeedVR2ImageWorkflow({ ...commonOpts, inputFilename })
        : buildSeedVR2VideoWorkflow({
            ...commonOpts,
            inputFilename,
            frameRate,
            batchSize: req.body.batchSize !== undefined ? Number(req.body.batchSize) : SEEDVR2_DEFAULTS.batchSizeVideo,
            temporalOverlap: req.body.temporalOverlap !== undefined ? Number(req.body.temporalOverlap) : SEEDVR2_DEFAULTS.temporalOverlap,
            uniformBatchSize: req.body.uniformBatchSize !== undefined ? String(req.body.uniformBatchSize) === "true" : SEEDVR2_DEFAULTS.uniformBatchSize,
          });

    // ─── 提交到 ComfyUI ───────────────────────────────
    try {
      const comfyRes = await axios.post(
        `${POSTPROCESS_CONFIG.comfyuiUrl}/prompt`,
        { prompt: workflow },
        { timeout: 30_000, validateStatus: (s: number) => s < 500 },
      );

      if (comfyRes.status !== 200) {
        return res.status(502).send(error(`ComfyUI rejected: ${JSON.stringify(comfyRes.data)}`));
      }

      const promptId = comfyRes.data.prompt_id;

      res.status(200).send(success({
        promptId,
        status: "pending",
        mode,
        inputFilename,
        filenamePrefix,
        model: commonOpts.ditModel || SEEDVR2_MODELS.dit,
        resolution: commonOpts.resolution,
        ...(mode === "video" ? { frameRate, batchSize: req.body.batchSize || SEEDVR2_DEFAULTS.batchSizeVideo } : {}),
        message: `SeedVR2 ${mode} upscale submitted`,
      }));
    } catch (err: any) {
      const msg = err.response?.data?.error?.message || err.response?.data?.node_errors || err.message || String(err);
      res.status(502).send(error(`ComfyUI failed: ${msg}`));
    }
  },
);

export const SEEDVR2_ROUTE_INFO = {
  path: "/api/production/postprocess/seedvr2",
  description: "SeedVR2 diffusion super-resolution (image or video)",
  models: SEEDVR2_MODELS,
  defaults: SEEDVR2_DEFAULTS,
};
