import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import axios from "axios";
import FormData from "form-data";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";

const router = express.Router();

/**
 * RTX Video Super Resolution 配置
 *
 * 微服务运行在 comfyui-primary 容器内 (端口 10589)，与 ComfyUI 共享 GPU。
 * 只需 ~13MB VRAM，不阻塞 ComfyUI 的渲染队列。
 *
 * 从宿主机访问: http://localhost:10589 (socat 端口转发由 kais-rtx-vsr-forward.service 管理)
 * 从 gold-team 容器访问: http://comfyui-primary:10589
 *
 * 输出目录: /mnt/agents/output/gpu1/rtx-vsr/ (容器内 = 宿主机共享挂载)
 */
const RTX_VSR_CONFIG = {
  serviceUrl: process.env.RTX_VSR_URL || "http://localhost:10589",
  timeoutMs: 120_000,
  // 输出目录 = ComfyUI primary 的共享输出挂载
  outputDir: "/mnt/agents/output/gpu1/rtx-vsr",
  // 通过 8082 range_server 暴露的 URL 前缀
  webBaseUrl: process.env.WEB_BASE_URL || "http://localhost:8082/gpu1/rtx-vsr",
};

const LOCAL_STAGING_DIR = "/tmp/rtx-vsr-staging";
if (!fs.existsSync(LOCAL_STAGING_DIR)) fs.mkdirSync(LOCAL_STAGING_DIR, { recursive: true });
const upload = multer({ dest: LOCAL_STAGING_DIR, limits: { fileSize: 500 * 1024 * 1024 } });

/**
 * 检查 RTX VSR 微服务是否可用
 */
async function checkService(): Promise<string> {
  const url = RTX_VSR_CONFIG.serviceUrl;
  const resp = await axios.get(`${url}/health`, { timeout: 5_000 });
  if (resp.data?.status === "ok") return url;
  throw new Error("RTX VSR service unhealthy");
}

// ─── GET /api/production/postprocess/rtx-vsr/health ─────
/** RTX VSR 服务健康检查 */
export const healthCheck = router.get("/health", async (_req: any, res) => {
  try {
    const baseUrl = await checkService();
    const resp = await axios.get(`${baseUrl}/health`, { timeout: 5_000 });
    res.status(200).send(success({ ...resp.data, serviceUrl: baseUrl }));
  } catch (err: any) {
    res.status(503).send(error(`RTX VSR service unavailable: ${err.message}`));
  }
});

// ─── GET /api/production/postprocess/rtx-vsr/benchmark ─────
/** 运行 VSR 性能基准测试 */
export const benchmark = router.get("/benchmark", async (_req: any, res) => {
  try {
    const baseUrl = await checkService();
    const resp = await axios.get(`${baseUrl}/benchmark`, { timeout: 60_000 });
    res.status(200).send(success(resp.data));
  } catch (err: any) {
    res.status(502).send(error(`Benchmark failed: ${err.message}`));
  }
});

// ─── Schema ──────────────────────────────────────────────
const vsrSchema = {
  scale: z.union([z.string(), z.number()]).optional(),
  quality: z.enum([
    "LOW", "MEDIUM", "HIGH", "ULTRA",
    "HIGHBITRATE_LOW", "HIGHBITRATE_MEDIUM", "HIGHBITRATE_HIGH", "HIGHBITRATE_ULTRA",
    "DENOISE_LOW", "DENOISE_MEDIUM", "DENOISE_HIGH", "DENOISE_ULTRA",
    "DEBLUR_LOW", "DEBLUR_MEDIUM", "DEBLUR_HIGH", "DEBLUR_ULTRA",
  ]).optional(),
  targetWidth: z.union([z.string(), z.number()]).optional(),
  targetHeight: z.union([z.string(), z.number()]).optional(),
  returnFormat: z.enum(["png", "jpeg", "webp"]).optional(),
};

// ─── POST /api/production/postprocess/rtx-vsr/upscale ─────
/**
 * 图片超分放大 (RTX VSR)
 *
 * 同步调用，直接返回结果。
 * 处理速度: ~0.9ms/frame (HIGH on RTX 3090)
 *
 * Form data:
 *   image: 图片文件 (png/jpg/webp)
 *   scale: 放大倍数 1.0-4.0 (默认 2.0)
 *   quality: LOW | MEDIUM | HIGH | ULTRA (默认 HIGH)
 *            HIGHBITRATE_* (清洁源)
 *            DENOISE_* (同分辨率降噪)
 *            DEBLUR_* (同分辨率去模糊)
 *   targetWidth: 目标宽度 (可选，覆盖 scale)
 *   targetHeight: 目标高度 (可选，覆盖 scale)
 *   returnFormat: png | jpeg | webp (默认 png)
 */
export const upscaleImage = router.post(
  "/upscale",
  upload.single("image"),
  validateFields(vsrSchema),
  async (req: any, res) => {
    if (!req.file) return res.status(400).send(error("image file is required"));

    const scale = parseFloat(req.body.scale) || 2.0;
    const quality = (req.body.quality || "HIGH").toUpperCase();
    const targetWidth = req.body.targetWidth ? parseInt(req.body.targetWidth) : undefined;
    const targetHeight = req.body.targetHeight ? parseInt(req.body.targetHeight) : undefined;
    const returnFormat = req.body.returnFormat || "png";

    if (scale < 1.0 || scale > 4.0) {
      return res.status(400).send(error("Scale must be between 1.0 and 4.0"));
    }

    try {
      const baseUrl = await checkService();

      // Forward file to VSR service
      const formData = new FormData();
      formData.append("file", fs.createReadStream(req.file.path), {
        filename: req.file.originalname || "input.png",
        contentType: req.file.mimetype,
      });
      formData.append("scale", String(scale));
      formData.append("quality", quality);
      formData.append("return_format", returnFormat);
      if (targetWidth) formData.append("target_width", String(targetWidth));
      if (targetHeight) formData.append("target_height", String(targetHeight));

      const vsrResp = await axios.post(`${baseUrl}/upscale`, formData, {
        headers: formData.getHeaders(),
        timeout: RTX_VSR_CONFIG.timeoutMs,
      });

      // Clean up temp file
      try { fs.unlinkSync(req.file.path); } catch {}

      const data = vsrResp.data;
      // Build accessible URL from output_path
      // VSR service outputs to /home/kai/shared/rtx-vsr-output/ inside container
      // which maps to /mnt/agents/output/gpu1/rtx-vsr/ on host (via shared mount)
      const outputFilename = data.output_url ? path.basename(data.output_url) : "";
      const webUrl = outputFilename
        ? `${RTX_VSR_CONFIG.webBaseUrl}/${outputFilename}`
        : undefined;

      res.status(200).send(success({
        ...data,
        engine: "rtx-vsr",
        quality,
        webUrl,
      }));
    } catch (err: any) {
      try { fs.unlinkSync(req.file.path); } catch {}
      const msg = err.response?.data?.detail || err.message || String(err);
      res.status(502).send(error(`RTX VSR upscale failed: ${msg}`));
    }
  },
);

// ─── POST /api/production/postprocess/rtx-vsr/upscale/batch ─────
/**
 * 批量图片超分
 * Form data:
 *   images: 多个图片文件
 *   scale: 放大倍数 (默认 2.0)
 *   quality: LOW | MEDIUM | HIGH | ULTRA (默认 HIGH)
 */
export const upscaleBatch = router.post(
  "/upscale/batch",
  upload.array("images", 20),
  async (req: any, res) => {
    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      return res.status(400).send(error("At least one image file is required"));
    }

    const scale = parseFloat(req.body.scale) || 2.0;
    const quality = (req.body.quality || "HIGH").toUpperCase();

    try {
      const baseUrl = await checkService();

      const formData = new FormData();
      for (const file of files) {
        formData.append("files", fs.createReadStream(file.path), {
          filename: file.originalname,
          contentType: file.mimetype,
        });
      }
      formData.append("scale", String(scale));
      formData.append("quality", quality);

      const vsrResp = await axios.post(`${baseUrl}/upscale/batch`, formData, {
        headers: formData.getHeaders(),
        timeout: RTX_VSR_CONFIG.timeoutMs,
      });

      // Clean up
      for (const file of files) {
        try { fs.unlinkSync(file.path); } catch {}
      }

      res.status(200).send(success(vsrResp.data));
    } catch (err: any) {
      for (const file of files) {
        try { fs.unlinkSync(file.path); } catch {}
      }
      const msg = err.response?.data?.detail || err.message || String(err);
      res.status(502).send(error(`RTX VSR batch failed: ${msg}`));
    }
  },
);

// ─── POST /api/production/postprocess/rtx-vsr/upscale/video ─────
/**
 * 视频超分放大 (RTX VSR - 逐帧处理)
 *
 * 速度: ~450 fps (HIGH) on RTX 3090
 * 一段 10s 30fps 视频 (~300帧): <1s 处理时间
 *
 * Form data:
 *   video: 视频文件 (mp4)
 *   scale: 放大倍数 1.0-4.0 (默认 2.0)
 *   quality: LOW | MEDIUM | HIGH | ULTRA (默认 HIGH)
 */
export const upscaleVideo = router.post(
  "/upscale/video",
  upload.single("video"),
  async (req: any, res) => {
    if (!req.file) return res.status(400).send(error("video file is required"));

    const scale = parseFloat(req.body.scale) || 2.0;
    const quality = (req.body.quality || "HIGH").toUpperCase();

    try {
      const baseUrl = await checkService();

      const formData = new FormData();
      formData.append("file", fs.createReadStream(req.file.path), {
        filename: req.file.originalname || "input.mp4",
        contentType: req.file.mimetype || "video/mp4",
      });
      formData.append("scale", String(scale));
      formData.append("quality", quality);

      const vsrResp = await axios.post(`${baseUrl}/upscale/video`, formData, {
        headers: formData.getHeaders(),
        timeout: 300_000, // 5 min for video
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      });

      try { fs.unlinkSync(req.file.path); } catch {}

      const data = vsrResp.data;
      const outputFilename = data.output_url ? path.basename(data.output_url) : "";
      const webUrl = outputFilename
        ? `${RTX_VSR_CONFIG.webBaseUrl}/${outputFilename}`
        : undefined;

      res.status(200).send(success({
        ...data,
        engine: "rtx-vsr",
        webUrl,
      }));
    } catch (err: any) {
      try { fs.unlinkSync(req.file.path); } catch {}
      const msg = err.response?.data?.detail || err.message || String(err);
      res.status(502).send(error(`RTX VSR video upscale failed: ${msg}`));
    }
  },
);

export const RTX_VSR_ROUTE_INFO = {
  path: "/api/production/postprocess/rtx-vsr",
  description: "NVIDIA RTX Video Super Resolution (image + video)",
  endpoints: ["/health", "/benchmark", "/upscale", "/upscale/batch", "/upscale/video"],
  qualities: ["LOW", "MEDIUM", "HIGH", "ULTRA", "HIGHBITRATE_*", "DENOISE_*", "DEBLUR_*"],
};

export default router;
