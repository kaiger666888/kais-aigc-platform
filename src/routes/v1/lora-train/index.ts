/**
 * src/routes/v1/lora-train/index.ts — LoRA Training API
 *
 * Endpoints:
 *   POST   /api/v1/lora-train           — Start training job
 *   GET    /api/v1/lora-train/:id        — Get training status
 *   POST   /api/v1/lora-train/:id/cancel — Cancel training
 *   GET    /api/v1/lora-train            — List all training jobs
 *   GET    /api/v1/lora-train/models     — List available FLUX models
 *   POST   /api/v1/lora-train/upload     — Upload dataset images
 */

import express from "express";
import { z } from "zod";
import axios from "axios";
import multer from "multer";
import fs from "fs/promises";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";

const router = express.Router();
const LORA_TRAINER_URL = process.env.LORA_TRAINER_URL || "http://localhost:8070";
const DATASETS_DIR = process.env.DATASETS_DIR || "/data/datasets";

// Multer for dataset uploads
const storage = multer.diskStorage({
  destination: async (req, _file, cb) => {
    const datasetId = req.body.datasetId || `ds-${uuidv4().slice(0, 8)}`;
    const dir = path.join(DATASETS_DIR, datasetId, "img");
    await fs.mkdir(dir, { recursive: true });
    req.body.datasetId = datasetId;
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB per image

// ─── Schemas ──────────────────────────────────────────

const startTrainSchema = z.object({
  datasetDir: z.string().min(1),
  outputName: z.string().optional().default("flux-lora"),
  resolution: z.number().min(256).max(1024).optional().default(512),
  trainBatchSize: z.number().min(1).max(4).optional().default(1),
  gradientAccumulationSteps: z.number().min(1).max(16).optional().default(4),
  learningRate: z.number().positive().optional().default(4e-4),
  maxTrainSteps: z.number().min(10).max(10000).optional().default(200),
  saveEveryNSteps: z.number().min(10).optional().default(100),
  networkDim: z.number().min(2).max(128).optional().default(4),
  networkAlpha: z.number().min(1).optional().default(4),
  optimizerType: z.string().optional().default("adamw8bit"),
  fp8Base: z.boolean().optional().default(true),
  numRepeats: z.number().min(1).max(100).optional().default(10),
});

// ─── Routes ───────────────────────────────────────────

/**
 * POST /api/v1/lora-train — Start training
 */
router.post(
  "/",
  validateFields(startTrainSchema.shape),
  async (req, res) => {
    try {
      const resp = await axios.post(
        `${LORA_TRAINER_URL}/train`,
        req.body,
        { timeout: 10_000 },
      );
      res.json(success(resp.data));
    } catch (err: any) {
      const msg = err.response?.data?.detail || err.message;
      res.status(502).json(error(`LoRA trainer error: ${msg}`));
    }
  },
);

/**
 * GET /api/v1/lora-train/:id — Get status
 */
router.get("/:id", async (req, res) => {
  try {
    const resp = await axios.get(`${LORA_TRAINER_URL}/status/${req.params.id}`, { timeout: 5_000 });
    res.json(success(resp.data));
  } catch (err: any) {
    const msg = err.response?.data?.detail || err.message;
    res.status(502).json(error(`LoRA trainer error: ${msg}`));
  }
});

/**
 * POST /api/v1/lora-train/:id/cancel — Cancel training
 */
router.post("/:id/cancel", async (req, res) => {
  try {
    const resp = await axios.post(`${LORA_TRAINER_URL}/cancel/${req.params.id}`, { timeout: 5_000 });
    res.json(success(resp.data));
  } catch (err: any) {
    const msg = err.response?.data?.detail || err.message;
    res.status(502).json(error(`LoRA trainer error: ${msg}`));
  }
});

/**
 * GET /api/v1/lora-train — List all training jobs
 */
router.get("/", async (_req, res) => {
  try {
    const resp = await axios.get(`${LORA_TRAINER_URL}/list`, { timeout: 5_000 });
    res.json(success(resp.data));
  } catch (err: any) {
    const msg = err.response?.data?.detail || err.message;
    res.status(502).json(error(`LoRA trainer error: ${msg}`));
  }
});

/**
 * GET /api/v1/lora-train/models — List available models
 */
router.get("/models/list", async (_req, res) => {
  try {
    const resp = await axios.get(`${LORA_TRAINER_URL}/models`, { timeout: 5_000 });
    res.json(success(resp.data));
  } catch (err: any) {
    const msg = err.response?.data?.detail || err.message;
    res.status(502).json(error(`LoRA trainer error: ${msg}`));
  }
});

/**
 * POST /api/v1/lora-train/upload — Upload dataset images
 * 
 * multipart/form-data:
 *   images[] — one or more image files
 *   captions — optional JSON array of captions matching images
 *   datasetId — optional existing dataset ID (append mode)
 *   triggerWord — optional trigger word (default: "tok")
 */
router.post(
  "/upload",
  upload.array("images", 50),
  async (req, res) => {
    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      return res.status(400).json(error("No images uploaded"));
    }

    const datasetId = req.body.datasetId;
    const datasetDir = path.join(DATASETS_DIR, datasetId);
    const imgDir = path.join(datasetDir, "img");

    // Parse captions
    let captions: string[] = [];
    try {
      captions = req.body.captions ? JSON.parse(req.body.captions) : [];
    } catch {
      captions = [];
    }
    const triggerWord = req.body.triggerWord || "tok";

    // Build metadata
    const metadataPath = path.join(datasetDir, "metadata.json");
    let metadata: Record<string, any> = {};
    try {
      const existing = await fs.readFile(metadataPath, "utf-8");
      metadata = JSON.parse(existing);
    } catch {
      // New dataset
    }

    files.forEach((file, i) => {
      const caption = captions[i] || `a photo of ${triggerWord} person, high quality, detailed`;
      metadata[file.filename] = { caption };
    });

    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));

    res.json(success({
      datasetId,
      datasetDir,
      imageCount: Object.keys(metadata).length,
      newImages: files.length,
      metadataPath,
    }));
  },
);

export default router;
