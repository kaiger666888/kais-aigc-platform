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
 * RTX Video Super Resolution 配置 — 双 GPU 实例
 *
 * ┌─────────────────────────────────────────────────────────────────┐
 * │ ⚠️ 用途限制（2026-08-08 定量测试结论，务必遵守）              │
 * │                                                                 │
 * │ RTX VSR 是【插值超分】，不生成新细节，不是扩散超分。            │
 * │                                                                 │
 * │ ❌ 禁止用于 AI 生成视频超分（H3/LTX/Wan 等模型输出）：          │
 * │    实测 SSIM=0.964（零新信息），清晰度比值 0.81×（反而更糊）。  │
 * │    AI 视频超分请用 SeedVR2；修复画面崩坏请增加 sampling steps。 │
 * │                                                                 │
 * │ ✅ 仅用于真实视频流/摄像头/压缩视频恢复（HIGHBITRATE/DENOISE/   │
 * │    DEBLUR 模式）等 NVIDIA 设计目标场景。                        │
 * └─────────────────────────────────────────────────────────────────┘
 *
 * 两个独立 VSR 微服务实例，平台统一管控，自动选择最优实例：
 *   - 3060Ti (端口 10590): 宿主机直跑，~568 MiB VRAM，不干扰 3090 渲染
 *   - 3090   (端口 10589): comfyui-primary 容器内，socat 转发
 *
 * 路由策略: 优先 3060Ti (3090 空闲给视频生成)，3060Ti 不可用时 fallback 到 3090
 */
const VSR_INSTANCES = [
  {
    name: "3060Ti",
    url: process.env.RTX_VSR_3060TI_URL || "http://localhost:10590",
    outputDir: "/home/kai/shared/gpu0/rtx-vsr",
    webBaseUrl: process.env.WEB_BASE_URL || "http://100.124.72.88:8082/gpu0/rtx-vsr",
  },
  {
    name: "3090",
    url: process.env.RTX_VSR_3090_URL || "http://localhost:10589",
    outputDir: "/mnt/agents/output/gpu1/rtx-vsr",
    webBaseUrl: process.env.WEB_BASE_URL || "http://100.124.72.88:8082/gpu1/rtx-vsr",
  },
];

const RTX_VSR_CONFIG = {
  timeoutMs: 120_000,
  instances: VSR_INSTANCES,
};

/**
 * 选择可用的 VSR 实例 — 优先 3060Ti，fallback 3090
 * 返回 { name, url, outputDir, webBaseUrl }
 */
async function selectInstance(): Promise<typeof VSR_INSTANCES[0]> {
  for (const inst of VSR_INSTANCES) {
    try {
      const resp = await axios.get(`${inst.url}/health`, { timeout: 3_000 });
      if (resp.data?.status === "ok") return inst;
    } catch {}
  }
  throw new Error("All RTX VSR instances unavailable");
}

const LOCAL_STAGING_DIR = "/tmp/rtx-vsr-staging";
if (!fs.existsSync(LOCAL_STAGING_DIR)) fs.mkdirSync(LOCAL_STAGING_DIR, { recursive: true });
const upload = multer({ dest: LOCAL_STAGING_DIR, limits: { fileSize: 500 * 1024 * 1024 } });

/**
 * GET /api/production/postprocess/rtx-vsr/health
 * 返回所有 VSR 实例的健康状态
 */
export const healthCheck = router.get("/health", async (_req: any, res) => {
  const results = await Promise.all(
    VSR_INSTANCES.map(async (inst) => {
      try {
        const resp = await axios.get(`${inst.url}/health`, { timeout: 3_000 });
        return { name: inst.name, url: inst.url, status: "ok", ...resp.data };
      } catch {
        return { name: inst.name, url: inst.url, status: "unavailable" };
      }
    })
  );
  const anyOk = results.some((r) => r.status === "ok");
  res.status(anyOk ? 200 : 503).send(
    anyOk
      ? success({ instances: results, primary: results.find((r) => r.status === "ok")?.name })
      : error("All RTX VSR instances unavailable")
  );
});

// ─── GET /api/production/postprocess/rtx-vsr/benchmark ─────
/** 运行 VSR 性能基准测试 */
export const benchmark = router.get("/benchmark", async (_req: any, res) => {
  try {
    const inst = await selectInstance();
    const resp = await axios.get(`${inst.url}/benchmark`, { timeout: 60_000 });
    res.status(200).send(success({ ...resp.data, instance: inst.name }));
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

/**
 * 规范化 VSR 微服务返回数据 — 把 output_url 替换为 output_path（文件系统绝对路径）。
 *
 * VSR 微服务返回两个字段：
 *   - output_path: 文件系统绝对路径（如 /home/kai/shared/gpu0/rtx-vsr/xxx.mp4）
 *   - output_url:  微服务内部静态文件路由（如 /output/xxx.mp4）— 相对路径
 *
 * KAP 调用方用 output_url 做 os.path.exists() / os.path.getsize()，
 * 因此路由层需把 output_url 规范化为绝对路径。同时处理批量 results 数组。
 */
function normalizeVsrOutput<T>(data: T): T {
  const fixItem = (item: any): any => {
    if (item && typeof item === "object" && item.output_path) {
      return { ...item, output_url: item.output_path };
    }
    return item;
  };
  const fixed = fixItem(data);
  if (fixed && Array.isArray(fixed.results)) {
    fixed.results = fixed.results.map(fixItem);
  }
  return fixed as T;
}

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
      const inst = await selectInstance();

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

      const vsrResp = await axios.post(`${inst.url}/upscale`, formData, {
        headers: formData.getHeaders(),
        timeout: RTX_VSR_CONFIG.timeoutMs,
      });

      // Clean up temp file
      try { fs.unlinkSync(req.file.path); } catch {}

      const data = normalizeVsrOutput(vsrResp.data);
      const outputFilename = data.output_url ? path.basename(data.output_url) : "";
      const webUrl = outputFilename
        ? `${inst.webBaseUrl}/${outputFilename}`
        : undefined;

      res.status(200).send(success({
        ...data,
        engine: "rtx-vsr",
        instance: inst.name,
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
      const inst = await selectInstance();

      const formData = new FormData();
      for (const file of files) {
        formData.append("files", fs.createReadStream(file.path), {
          filename: file.originalname,
          contentType: file.mimetype,
        });
      }
      formData.append("scale", String(scale));
      formData.append("quality", quality);

      const vsrResp = await axios.post(`${inst.url}/upscale/batch`, formData, {
        headers: formData.getHeaders(),
        timeout: RTX_VSR_CONFIG.timeoutMs,
      });

      // Clean up
      for (const file of files) {
        try { fs.unlinkSync(file.path); } catch {}
      }

      const data = normalizeVsrOutput(vsrResp.data);
      res.status(200).send(success({ ...data, instance: inst.name }));
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
      const inst = await selectInstance();

      const formData = new FormData();
      formData.append("file", fs.createReadStream(req.file.path), {
        filename: req.file.originalname || "input.mp4",
        contentType: req.file.mimetype || "video/mp4",
      });
      formData.append("scale", String(scale));
      formData.append("quality", quality);

      const vsrResp = await axios.post(`${inst.url}/upscale/video`, formData, {
        headers: formData.getHeaders(),
        timeout: 300_000, // 5 min for video
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      });

      try { fs.unlinkSync(req.file.path); } catch {}

      const data = normalizeVsrOutput(vsrResp.data);
      const outputFilename = data.output_url ? path.basename(data.output_url) : "";
      const webUrl = outputFilename
        ? `${inst.webBaseUrl}/${outputFilename}`
        : undefined;

      res.status(200).send(success({
        ...data,
        engine: "rtx-vsr",
        instance: inst.name,
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
