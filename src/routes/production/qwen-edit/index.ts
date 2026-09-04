/**
 * === 2026-09-04 转正定案 ===
 * Qwen-Image-Edit-2511 经 Kai 终审（复杂场景 4-case 实测页 + C3 融合归因复盘
 * + V1/V2 重做终审通过）转正为 KAP 正式图像编辑引擎。
 * 同日 MaGe-Flow 定谳退役：真实调用 0 + 权重已删 + 路由下线（见 router.ts 历史）。
 * 验收基准线：EP01 原片帧 4-case（C1优 C2优 C4良 C3中，V1/V2 重做终审通过）
 * 运维知识库：kais-tools/kais-image-edit（farm）
 */

/**
 * Qwen-Image-Edit-2511 (GGUF) — 指令式图像编辑
 *
 * 使用 Qwen-Image-Edit-2511 Q4_K_M GGUF + Lightning 4-step 蒸馏 LoRA，
 * 通过自然语言指令对输入图片做编辑（改主体/换背景/去物体/风格迁移等）。
 *
 * POST /api/production/qwen-edit/edit
 *   multipart: image (必选, 待编辑图片)
 *   body: {
 *     prompt: string,            // 编辑指令
 *     negative_prompt?: string,   // 默认 " "（蒸馏采样负向留空）
 *     seed?: number,              // 默认随机
 *     steps?: number,             // 默认 4（Lightning 蒸馏）
 *     cfg?: number,               // 默认 1.0（蒸馏必须 1.0）
 *     megapixels?: number,        // 默认 1.0
 *   }
 *
 * GET /api/production/qwen-edit/health
 *   — ComfyUI 可达性 + 容器内 4 个模型文件逐一核验（返回缺失清单）
 *
 * 响应: { success: true, data: { images: [{ url, filename }], seed, steps, elapsed_ms } }
 *
 * 工作流节点接线已于 2026-09-04 端到端实测（4/4 编辑成功）— 勿改接线。
 */

import express from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import axios from "axios";
import { execSync } from "child_process";
import { v4 as uuidv4 } from "uuid";
import { success, error } from "@/lib/responseFormat";
import { withGpuQueueTimed } from "@/lib/gpuVramManager";
import { QWEN_EDIT_CONFIG, QWEN_EDIT_DEFAULTS } from "./config";

const router = express.Router();

const LOCAL_STAGING_DIR = "/tmp/comfyui-qwen-edit-input";
if (!fs.existsSync(LOCAL_STAGING_DIR)) {
  fs.mkdirSync(LOCAL_STAGING_DIR, { recursive: true });
}

const upload = multer({ dest: LOCAL_STAGING_DIR });

// ─── 工具函数 ─────────────────────────────────────────────────────────────

function copyToContainer(localPath: string, containerPath: string) {
  try {
    execSync(`docker cp "${localPath}" ${QWEN_EDIT_CONFIG.containerName}:"${containerPath}"`, { timeout: 30_000 });
  } catch {
    throw new Error(`Failed to copy ${localPath} to container`);
  }
}

async function pollComfyUI(promptId: string, extraBudgetMs = 0): Promise<any> {
  const startTime = Date.now();
  while (Date.now() - startTime < QWEN_EDIT_CONFIG.pollTimeoutMs + extraBudgetMs) {
    await new Promise((r) => setTimeout(r, QWEN_EDIT_CONFIG.pollIntervalMs));
    const resp = await axios.get(`${QWEN_EDIT_CONFIG.comfyuiUrl}/history/${promptId}`);
    const hist = resp.data;
    if (promptId in hist) {
      const entry = hist[promptId];
      const status = entry.status;
      if (status?.status_str === "error") {
        const msgs = status.messages || [];
        for (const m of msgs) {
          if (Array.isArray(m) && m.length > 1 && typeof m[1] === "object" && "exception_message" in m[1]) {
            throw new Error(`ComfyUI: ${m[1].exception_message}`);
          }
        }
        throw new Error("ComfyUI execution error");
      }
      const outputs = entry.outputs || {};
      return outputs;
    }
  }
  throw new Error("ComfyUI poll timeout");
}

async function fetchImage(url: string, outputPath: string) {
  const resp = await axios.get(url, { responseType: "arraybuffer", timeout: 60_000 });
  fs.writeFileSync(outputPath, resp.data);
}

function safeUnlink(p?: string) {
  if (!p) return;
  try { fs.unlinkSync(p); } catch {}
}

// ─── Qwen-Edit 工作流构建（2026-09-04 实测验证版, 勿改接线）────────────────

interface QwenEditOptions {
  prompt: string;
  negativePrompt: string;
  seed: number;
  steps: number;
  cfg: number;
  megapixels: number;
  inputImageName: string; // 容器内 input/ 目录的文件名
  filenamePrefix: string;
}

function buildQwenEditWorkflow(opts: QwenEditOptions) {
  const {
    prompt, negativePrompt, seed, steps, cfg, megapixels,
    inputImageName, filenamePrefix,
  } = opts;
  const D = QWEN_EDIT_DEFAULTS;

  return {
    // 载入待编辑原图
    "10": {
      class_type: "LoadImage",
      inputs: { image: inputImageName },
    },
    // Qwen2.5-VL 7B 文本编码器
    "15": {
      class_type: "CLIPLoader",
      inputs: { clip_name: D.clipName, type: "qwen_image" },
    },
    // Lightning 4-step 蒸馏 LoRA（仅模型侧）
    "16": {
      class_type: "LoraLoaderModelOnly",
      inputs: {
        model: ["14", 0],
        lora_name: D.loraName,
        strength_model: D.loraStrength,
      },
    },
    // GGUF 量化 transformer
    "14": {
      class_type: "UnetLoaderGGUF",
      inputs: { unet_name: D.unetName },
    },
    // VAE
    "12": {
      class_type: "VAELoader",
      inputs: { vae_name: D.vaeName },
    },
    // 原图统一缩放到目标百万像素（lanczos）
    // 注意: resolution_steps 为 ComfyUI 0.30 新增必填输入, 漏掉过不了校验
    "22": {
      class_type: "ImageScaleToTotalPixels",
      inputs: {
        image: ["10", 0],
        upscale_method: "lanczos",
        megapixels,
        resolution_steps: 1,
      },
    },
    // 缩放后编码为 latent → KSampler
    "23": {
      class_type: "VAEEncode",
      inputs: { pixels: ["22", 0], vae: ["12", 0] },
    },
    // 正向条件（编辑指令）
    // 注意: image1 必须接原图 ["10",0], 不能接缩放后的 ["22",0]
    "20": {
      class_type: "TextEncodeQwenImageEditPlus",
      inputs: {
        prompt,
        clip: ["15", 0],
        vae: ["12", 0],
        image1: ["10", 0],
      },
    },
    // 负向条件 — 必须走 TextEncodeQwenImageEditPlus（勿用 CLIPTextEncode）, 文本单个空格
    "21": {
      class_type: "TextEncodeQwenImageEditPlus",
      inputs: {
        prompt: negativePrompt,
        clip: ["15", 0],
        vae: ["12", 0],
        image1: ["10", 0],
      },
    },
    // 采样
    "40": {
      class_type: "KSampler",
      inputs: {
        seed,
        steps,
        cfg,
        sampler_name: D.samplerName,
        scheduler: D.scheduler,
        denoise: D.denoise,
        model: ["16", 0],
        positive: ["20", 0],
        negative: ["21", 0],
        latent_image: ["23", 0],
      },
    },
    // 解码
    "50": {
      class_type: "VAEDecode",
      inputs: { samples: ["40", 0], vae: ["12", 0] },
    },
    // 保存（输出节点 id 固定 "60", 从 outputs["60"].images 收集）
    "60": {
      class_type: "SaveImage",
      inputs: { filename_prefix: filenamePrefix, images: ["50", 0] },
    },
  };
}

// ─── 路由 ─────────────────────────────────────────────────────────────────

router.post("/edit", upload.single("image"), async (req: any, res: any) => {
  const startTime = Date.now();

  try {
    // 验证输入图
    if (!req.file) {
      return res.status(400).json(error("image is required"));
    }

    const body = req.body || {};
    const prompt = body.prompt;
    if (!prompt) {
      return res.status(400).json(error("prompt is required"));
    }

    const negativePrompt = body.negative_prompt || " ";
    const seed = body.seed ? parseInt(body.seed) : Math.floor(Math.random() * 1_000_000);
    const steps = parseInt(body.steps) || QWEN_EDIT_DEFAULTS.steps;
    const cfg = parseFloat(body.cfg) || QWEN_EDIT_DEFAULTS.cfg;
    const megapixels = parseFloat(body.megapixels) || QWEN_EDIT_DEFAULTS.megapixels;

    const jobId = uuidv4().slice(0, 8);

    // 1. 上传待编辑图到 ComfyUI 容器（队列外纯 IO）
    const imgExt = path.extname(req.file.originalname) || ".png";
    const imgName = `qwen_edit_in_${jobId}${imgExt}`;
    const containerInputPath = `/root/ComfyUI/input/${imgName}`;
    copyToContainer(req.file.path, containerInputPath);

    // 2. 构建工作流
    const filenamePrefix = `qwen_edit_${jobId}`;
    const workflow = buildQwenEditWorkflow({
      prompt,
      negativePrompt,
      seed,
      steps,
      cfg,
      megapixels,
      inputImageName: imgName,
      filenamePrefix,
    });

    // 3+4. ─── GPU 全局串行队列 ───
    // 与 FLUX.1/Kontext/FLUX.2 共用 comfyui-primary (engineKey=flux2, 撞车主力)
    // — 锁内「提交+轮询到完成」; queueWaitMs 不计入轮询预算 (镜像 kontext-generate)。
    // 输入图上传 (docker cp) 在队列外; 结果图下载 (纯 IO) 也在锁外。
    const outputs = (
      await withGpuQueueTimed(
        "flux2",
        async (queueWaitMs) => {
          const submitResp = await axios.post(
            `${QWEN_EDIT_CONFIG.comfyuiUrl}/prompt`,
            { prompt: workflow },
            { headers: { "Content-Type": "application/json" }, timeout: 30_000 }
          );
          // 4. 轮询结果 (排队等待 queueWaitMs 等量延长预算)
          return await pollComfyUI(submitResp.data.prompt_id, queueWaitMs);
        },
        { gpuIndex: 1, comfyuiUrl: QWEN_EDIT_CONFIG.comfyuiUrl },
      )
    ).data;

    // 5. 收集输出图片
    const images: { url: string; filename: string }[] = [];
    const outputNode = outputs["60"];
    if (outputNode?.images) {
      for (const img of outputNode.images) {
        const fname = img.filename;
        const subfolder = img.subfolder || "";
        const imgUrl = `${QWEN_EDIT_CONFIG.comfyuiUrl}/view?filename=${encodeURIComponent(fname)}&subfolder=${encodeURIComponent(subfolder)}&type=output`;

        // 下载到本地 staging
        const localPath = path.join(LOCAL_STAGING_DIR, fname);
        await fetchImage(imgUrl, localPath);

        images.push({ url: imgUrl, filename: fname });
      }
    }

    const elapsedMs = Date.now() - startTime;

    // 6. 清理临时文件
    safeUnlink(req.file?.path);

    return res.json(
      success({
        images,
        seed,
        steps,
        elapsed_ms: elapsedMs,
      }, "Qwen-Image-Edit complete")
    );
  } catch (err: any) {
    console.error("[qwen-edit/edit] Error:", err.message);
    safeUnlink(req.file?.path);
    return res.status(500).json(error(err.message || "Qwen-Image-Edit failed"));
  }
});

// ─── 健康检查 ─────────────────────────────────────────────────────────────

router.get("/health", async (_req: any, res: any) => {
  try {
    // 1. ComfyUI 可达性（/system_stats, 5s 超时）
    let comfyuiReady = false;
    try {
      await axios.get(`${QWEN_EDIT_CONFIG.comfyuiUrl}/system_stats`, { timeout: 5_000 });
      comfyuiReady = true;
    } catch { /* 不可达 */ }

    // 2. 容器内 4 个模型文件逐一核验（docker exec test -f）
    const checkFileInContainer = (filePath: string): boolean => {
      try {
        const out = execSync(
          `docker exec ${QWEN_EDIT_CONFIG.containerName} test -f ${filePath} && echo YES || echo NO`,
          { timeout: 10_000, encoding: "utf-8" }
        ).trim();
        return out === "YES";
      } catch {
        return false;
      }
    };
    const modelPaths: Record<string, string> = {
      unet: `/root/ComfyUI/models/diffusion_models/${QWEN_EDIT_DEFAULTS.unetName}`,
      clip: `/root/ComfyUI/models/text_encoders/${QWEN_EDIT_DEFAULTS.clipName}`,
      vae: `/root/ComfyUI/models/vae/${QWEN_EDIT_DEFAULTS.vaeName}`,
      lora: `/root/ComfyUI/models/loras/${QWEN_EDIT_DEFAULTS.loraName}`,
    };
    const models: Record<string, boolean> = {};
    for (const [key, p] of Object.entries(modelPaths)) {
      models[key] = comfyuiReady ? checkFileInContainer(p) : false;
    }

    const missing = Object.entries(models).filter(([, ok]) => !ok).map(([key]) => key);

    return res.json(
      success({
        comfyuiReady,
        container: QWEN_EDIT_CONFIG.containerName,
        models,
        missing,
      }, missing.length ? `Missing models: ${missing.join(", ")}` : "Qwen-Edit ready")
    );
  } catch (err: any) {
    console.error("[qwen-edit/health] Error:", err.message);
    return res.status(500).json(error(err.message || "Qwen-Edit health check failed"));
  }
});

export default router;
