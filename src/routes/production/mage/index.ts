/**
 * MageFlow Proxy — 转发到 mage_flow_serve.py FastAPI 服务
 *
 * 路由:
 *   POST /api/production/mage/edit      — 指令式图像编辑
 *   POST /api/production/mage/generate  — 文生图
 *   POST /api/production/mage/depth     — 深度图提取
 *   GET  /api/production/mage/health    — 健康检查
 *   GET  /api/production/mage/models    — 模型状态
 *
 * mage_flow_serve.py 需独立启动:
 *   python3 scripts/mage_flow_serve.py --port 7860 --device cuda:1
 */

import express from "express";
import multer from "multer";
import axios from "axios";
import FormData from "form-data";
import fs from "fs";
import { success, error } from "@/lib/responseFormat";

const router = express.Router();

const MAGE_FLOW_URL =
  process.env.MAGE_FLOW_URL || "http://localhost:7860";

const upload = multer({ dest: "/tmp/mage-flow-proxy-upload" });

// ─── GET /health ─────────────────────────────────────────────

router.get("/health", async (_req, res) => {
  try {
    const resp = await axios.get(`${MAGE_FLOW_URL}/health`, { timeout: 5_000 });
    res.json(success(resp.data, "MageFlow service healthy"));
  } catch (err: any) {
    res
      .status(503)
      .json(
        error(
          `MageFlow service unavailable: ${err.message}. Start it with: python3 scripts/mage_flow_serve.py --port 7860 --device cuda:1`,
        ),
      );
  }
});

// ─── GET /models ─────────────────────────────────────────────

router.get("/models", async (_req, res) => {
  try {
    const resp = await axios.get(`${MAGE_FLOW_URL}/models`, { timeout: 5_000 });
    res.json(success(resp.data));
  } catch (err: any) {
    res.status(502).json(error(`MageFlow unreachable: ${err.message}`));
  }
});

// ─── POST /edit — 指令式图像编辑 ────────────────────────────

router.post(
  "/edit",
  upload.single("image"),
  async (req: any, res: any) => {
    if (!req.file) return res.status(400).json(error("image file is required"));

    const formData = new FormData();
    formData.append("image", fs.createReadStream(req.file.path), {
      filename: req.file.originalname || "input.png",
      contentType: req.file.mimetype,
    });

    // 转发所有 body 字段
    const fields = [
      "prompt", "negative_prompt", "steps", "cfg",
      "max_size", "height", "width", "seed",
    ];
    for (const f of fields) {
      if (req.body[f] !== undefined) formData.append(f, String(req.body[f]));
    }

    try {
      const resp = await axios.post(`${MAGE_FLOW_URL}/edit`, formData, {
        headers: formData.getHeaders(),
        timeout: 120_000,
        maxContentLength: Infinity,
      });
      res.json(success(resp.data, "MageFlow edit complete"));
    } catch (err: any) {
      const msg = err.response?.data?.detail || err.response?.data?.error || err.message;
      res.status(502).json(error(`MageFlow edit failed: ${msg}`));
    } finally {
      try { fs.unlinkSync(req.file.path); } catch {}
    }
  },
);

// ─── POST /generate — 文生图 ────────────────────────────────

router.post("/generate", async (req: any, res: any) => {
  const body = req.body || {};
  if (!body.prompt) return res.status(400).json(error("prompt is required"));

  try {
    const resp = await axios.post(`${MAGE_FLOW_URL}/generate`, body, {
      timeout: 60_000,
      headers: { "Content-Type": "application/json" },
    });
    res.json(success(resp.data, "MageFlow generate complete"));
  } catch (err: any) {
    const msg = err.response?.data?.detail || err.response?.data?.error || err.message;
    res.status(502).json(error(`MageFlow generate failed: ${msg}`));
  }
});

// ─── POST /depth — 深度图提取 ────────────────────────────────

router.post(
  "/depth",
  upload.single("image"),
  async (req: any, res: any) => {
    if (!req.file) return res.status(400).json(error("image file is required"));

    const formData = new FormData();
    formData.append("image", fs.createReadStream(req.file.path), {
      filename: req.file.originalname || "input.png",
      contentType: req.file.mimetype,
    });
    if (req.body.model) formData.append("model", String(req.body.model));

    try {
      const resp = await axios.post(`${MAGE_FLOW_URL}/depth`, formData, {
        headers: formData.getHeaders(),
        timeout: 120_000,
      });
      res.json(success(resp.data, "Depth extraction complete"));
    } catch (err: any) {
      const msg = err.response?.data?.detail || err.response?.data?.error || err.message;
      res.status(502).json(error(`Depth extraction failed: ${msg}`));
    } finally {
      try { fs.unlinkSync(req.file.path); } catch {}
    }
  },
);

export default router;
