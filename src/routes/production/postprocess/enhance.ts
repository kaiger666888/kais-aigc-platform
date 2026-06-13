import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import axios from "axios";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { POSTPROCESS_CONFIG } from "./_shared/config";
import { buildPostprocessWorkflow } from "./_shared/workflows";

const router = express.Router();

const LOCAL_STAGING_DIR = "/tmp/comfyui-postprocess-input";
if (!fs.existsSync(LOCAL_STAGING_DIR)) fs.mkdirSync(LOCAL_STAGING_DIR, { recursive: true });
const upload = multer({ dest: LOCAL_STAGING_DIR });

/** 复制文件到 ComfyUI 容器 */
function copyToContainer(localPath: string, containerPath: string) {
  const { execSync } = require("child_process");
  try {
    execSync(`docker cp "${localPath}" ${POSTPROCESS_CONFIG.containerName}:"${containerPath}"`, { timeout: 60_000 });
  } catch {
    const { spawnSync } = require("child_process");
    const fileContent = fs.readFileSync(localPath);
    const child = spawnSync("docker", ["exec", "-i", POSTPROCESS_CONFIG.containerName, "bash", "-c", `cat > "${containerPath}"`], {
      input: fileContent,
      timeout: 120_000,
    });
    if (child.status !== 0) throw new Error(child.stderr?.toString() || "docker exec failed");
  }
}

// ─── POST /api/production/postprocess/enhance ─────────────
// 统一后处理: 上传图片 → CodeFormer面部修复 + Depth深度图 + UltraSharp锐化

const enhanceSchema = {
  steps: z.string().optional().default("codeformer,ultrasharp"),
  codeformerFidelity: z.number().min(0).max(1).optional().default(0.7),
  depthModel: z.enum(["small", "base", "large"]).optional().default("large"),
  upscaleModel: z.enum(["4x-UltraSharp.pth", "RealESRGAN_x4plus.pth"]).optional().default("4x-UltraSharp.pth"),
  filenamePrefix: z.string().optional(),
};

export default router.post(
  "/",
  upload.single("image"),
  validateFields(enhanceSchema),
  async (req, res) => {
    const steps = (req.body.steps || "codeformer,ultrasharp").split(",").map((s: string) => s.trim());
    const codeformerFidelity = Number(req.body.codeformerFidelity) || 0.7;
    const depthModel = req.body.depthModel || "large";
    const upscaleModel = req.body.upscaleModel || "4x-UltraSharp.pth";
    const filenamePrefix = req.body.filenamePrefix || `postprocess_${Date.now()}`;

    if (!req.file) return res.status(400).send(error("image file is required"));

    // 上传图片到 ComfyUI 容器
    const ext = path.extname(req.file.originalname || ".png") || ".png";
    const inputFilename = `${uuidv4()}${ext}`;
    const containerPath = `${POSTPROCESS_CONFIG.comfyuiInputDir}/${inputFilename}`;

    try {
      copyToContainer(req.file.path, containerPath);
    } catch (err: any) {
      try { fs.unlinkSync(req.file.path); } catch {}
      return res.status(502).send(error(`Upload to ComfyUI failed: ${err.message}`));
    }
    try { fs.unlinkSync(req.file.path); } catch {}

    // 构建 workflow
    const workflow = buildPostprocessWorkflow({
      inputFilename,
      steps,
      filenamePrefix,
      codeformerFidelity,
      depthModel,
      upscaleModel,
    });

    // 提交到 ComfyUI
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
        steps,
        inputFilename,
        filenamePrefix,
        message: `Postprocess submitted: ${steps.join(" → ")}`,
      }));
    } catch (err: any) {
      const msg = err.response?.data?.error?.message || err.response?.data?.node_errors || err.message || String(err);
      res.status(502).send(error(`ComfyUI failed: ${msg}`));
    }
  },
);
