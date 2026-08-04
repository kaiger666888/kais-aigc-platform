/**
 * MiniMax H3 — 统一管线入口 generate (视频生成 + replace-audio BGM 替换)
 *
 * POST /api/production/minimax-h3/generate   (multipart/form-data)
 *
 * 把 H3 视频生成 (t2va / i2va / ref2va) 与 replace-audio (LTX Foley + NAG + BGM 检测重试)
 * 串联为一个同步管线调用, 一次性输出 "H3 视频 + 替换后的环境音 (+ 可选 TTS 对白)" 的最终 mp4。
 *
 * 入参:
 *   prompt         : string  (required — 场景描述)
 *   projectId      : number  (required)
 *
 *   # 可选: 视频生成模式
 *   mode           : string  ("t2va" | "i2va" | "ref2va", 默认 "t2va")
 *   image          : File    (i2va 模式需要首帧图片)
 *   refImages[]    : File[]  (ref2va 模式的参考图, 最多 9 张)
 *
 *   # 可选: 视频参数
 *   width          : number  (默认 1344, 必须 32 倍数)
 *   height         : number  (默认 768, 必须 32 倍数)
 *   length         : number  (帧数, 默认 124, 自动对齐 n%17==5)
 *   seed           : number  (H3 视频生成种子, 默认随机)
 *
 *   # 可选: 音频参数
 *   ttsAudio       : File    (TTS 对白音频, 有则与环境音混音)
 *   negativePrompt : string  (replace-audio 的负面提示词)
 *
 *   # 可选: 输出
 *   filenamePrefix : string  (输出文件名前缀)
 *
 * 管线流程:
 *   Step 1  H3 视频生成 (按 mode 选择 t2va / i2va / ref2va)
 *           → 提交 ComfyUI → 轮询等待 (≤15min) → 下载 H3 视频 (mp4, 内嵌音频)
 *   Step 2  replace-audio (LTX Foley + NAG + BGM 检测重试)
 *           → ffmpeg 去音频 + re-encode 到 1280x704 → 上传容器
 *           → 构建 LTX 环境音工作流 → 提交 → 轮询 (≤10min)
 *           → BGM 频谱检测 → 必要时换 seed 重试 (最多 2 次) → 下载环境音
 *   Step 3  最终合并 (保留 H3 原始分辨率)
 *           → 有 TTS: ffmpeg amix(TTS×1.4 + ambient×0.5) 再合并到 H3 视频
 *           → 无 TTS: 直接合并环境音到 H3 视频
 *           → 输出最终 mp4
 *
 * 超时: H3 ≤15min, Foley ≤10min, BGM 重试每次 ≤10min 最多 2 次, 总计 ≤45min。
 *
 * 代码复用策略:
 *   - H3 工作流 JSON 在本文件内联构建 (不 import t2va/i2va/ref2va, 仅 import config 常量),
 *     节点拓扑与三个源文件完全一致。
 *   - Foley / 合并 / BGM 检测 / ComfyUI 轮询等辅助函数复用自 ./replace-audio。
 */

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
  H3_CONFIG,
  H3_DEFAULTS,
  H3_CONSTANTS,
  alignH3FrameCount,
  H3_DEFAULT_NEGATIVE,
} from "./config";
// 复用 replace-audio 的辅助函数 (这些函数仅新增了 export 关键字, 逻辑未变更)
import {
  LTX_AMBIENT,
  copyToContainer,
  probeFrameCount,
  alignLtxFrames,
  ensureResolutionAndStripAudio,
  pollComfyuiCompletion,
  downloadAudioFromOutputs,
  downloadVideoFromOutputs,
  mergeAudioAndVideo,
  detectBgm,
  buildLtxAmbientWorkflow,
} from "./replace-audio";

const router = express.Router();

const LOCAL_STAGING_DIR = "/tmp/comfyui-h3-generate";
if (!fs.existsSync(LOCAL_STAGING_DIR)) {
  fs.mkdirSync(LOCAL_STAGING_DIR, { recursive: true });
}

// 视频 / 图片可能较大, 给到 1GB
const upload = multer({
  dest: LOCAL_STAGING_DIR,
  limits: { fileSize: 1024 * 1024 * 1024 },
});

/** 安全删除临时文件, 忽略错误 (文件可能已被删, 重复删是 no-op)。 */
function safeUnlink(p: string | null | undefined): void {
  if (!p) return;
  try { fs.unlinkSync(p); } catch {}
}

// ============================================================
// H3 工作流构建 (内联, 节点拓扑复制自 t2va.ts / i2va.ts / ref2va.ts)
// ============================================================
//
// 不 import 那三个路由文件, 仅 import config 常量后在本文件内联构建工作流 JSON。
// 三种模式共享节点 10/11/12/13/16/21/30/40/41/42/50, 仅在以下处分支:
//   - 节点 12 (UNETLoader): t2va/i2va 用 fl2va 模型; ref2va 用 ref2va 模型
//   - 节点 20 (正面条件): t2va/i2va 用 MiniMaxH3ImageToVideo; ref2va 用 MiniMaxH3ReferenceToVideo
//   - 采样器: t2va/i2va 用 euler+50 步; ref2va 用 res_multistep+20 步
//   - LoadImage 节点: i2va 首帧 = 节点 14; ref2va 参考图 = 节点 14/141/142...

interface H3GenOpts {
  mode: "t2va" | "i2va" | "ref2va";
  prompt: string;
  negativePrompt: string;
  width: number;
  height: number;
  length: number;
  seed: number;
  /** i2va 首帧图 (容器内文件名); t2va / ref2va 传 null */
  firstFrameFilename: string | null;
  /** ref2va 参考图 (容器内文件名数组); t2va / i2va 传 [] */
  refImageFilenames: string[];
  filenamePrefix: string;
}

function buildH3Workflow(opts: H3GenOpts): Record<string, any> {
  const {
    mode, prompt, negativePrompt,
    width, height, length, seed,
    firstFrameFilename, refImageFilenames, filenamePrefix,
  } = opts;

  const isRef2va = mode === "ref2va";
  // 模型 / 采样器 / 步数按模式选择
  const unetModel = isRef2va ? H3_DEFAULTS.ref2vaModel : H3_DEFAULTS.fl2vaModel;
  const steps = isRef2va ? H3_DEFAULTS.r2vSteps : H3_DEFAULTS.t2vSteps;
  const samplerName = isRef2va ? H3_DEFAULTS.r2vSamplerName : H3_DEFAULTS.t2vSamplerName;
  const scheduler = isRef2va ? H3_DEFAULTS.r2vScheduler : H3_DEFAULTS.t2vScheduler;

  const nodes: Record<string, any> = {
    // === 模型 / 文本编码器 / VAE ===
    "10": { class_type: "CLIPLoader", inputs: { clip_name: H3_DEFAULTS.clipName, type: "minimax" } },
    "11": { class_type: "VAELoader", inputs: { vae_name: H3_DEFAULTS.videoVaeName } },
    "12": { class_type: "UNETLoader", inputs: { unet_name: unetModel, weight_dtype: "default" } },
    "13": { class_type: "VAELoader", inputs: { vae_name: H3_DEFAULTS.audioVaeName } },
  };

  // === LoadImage 节点 ===
  // ref2va: 参考图首张 = "14", 其余 141,142...
  if (isRef2va) {
    refImageFilenames.forEach((filename, i) => {
      const nodeId = i === 0 ? "14" : `14${i}`;
      nodes[nodeId] = { class_type: "LoadImage", inputs: { image: filename } };
    });
  }
  // i2va: 首帧图 = "14"
  if (mode === "i2va" && firstFrameFilename) {
    nodes["14"] = { class_type: "LoadImage", inputs: { image: firstFrameFilename } };
  }

  // === 负面条件 (MiniMaxH3ImageToVideo, 无图) ===
  // H3 CFG-distilled (cfg=1.0), 负面提示词实际不生效, 但 KSampler 需 negative conditioning 占位。
  nodes["16"] = {
    class_type: "MiniMaxH3ImageToVideo",
    inputs: { clip: ["10", 0], vae: ["11", 0], prompt: negativePrompt, width, height, length },
  };

  // === 正面条件 ===
  if (isRef2va) {
    // ref2va: MiniMaxH3ReferenceToVideo, ref_images 通过结构化槽位注入
    const refImageSlots: Record<string, any> = {};
    refImageFilenames.forEach((_, i) => {
      const nodeId = i === 0 ? "14" : `14${i}`;
      refImageSlots[`ref_images.ref_image_${i}`] = [nodeId, 0];
    });
    nodes["20"] = {
      class_type: "MiniMaxH3ReferenceToVideo",
      inputs: {
        clip: ["10", 0],
        vae: ["11", 0],
        audio_vae: ["13", 0],
        prompt,
        width, height, length,
        ref_image_size: "match",
        ...refImageSlots,
      },
    };
  } else {
    // t2va / i2va: MiniMaxH3ImageToVideo (i2va 接 first_frame)
    nodes["20"] = {
      class_type: "MiniMaxH3ImageToVideo",
      inputs: {
        clip: ["10", 0],
        vae: ["11", 0],
        prompt,
        width, height, length,
        ...(mode === "i2va" && firstFrameFilename ? { first_frame: ["14", 0] } : {}),
      },
    };
  }

  // === 噪声调度 (SigmaShift) ===
  nodes["21"] = {
    class_type: "MiniMaxH3SigmaShift",
    inputs: {
      model: ["12", 0],
      shift_video: H3_DEFAULTS.shiftVideo,
      shift_audio: H3_DEFAULTS.shiftAudio,
    },
  };

  // === 采样 (latent_image = ["20", 1] —— ToVideo 条件生成器第二输出 = latent) ===
  nodes["30"] = {
    class_type: "KSampler",
    inputs: {
      model: ["21", 0],
      positive: ["20", 0],
      negative: ["16", 0],
      latent_image: ["20", 1],
      seed,
      steps,
      cfg: H3_CONSTANTS.CFG,
      sampler_name: samplerName,
      scheduler,
      denoise: H3_DEFAULTS.denoise,
    },
  };

  // === 视频解码 ===
  nodes["40"] = { class_type: "VAEDecode", inputs: { samples: ["30", 0], vae: ["11", 0] } };

  // === 音频解码 (合并到视频) ===
  nodes["41"] = { class_type: "VAEDecodeAudio", inputs: { samples: ["30", 0], vae: ["13", 0] } };

  // === 合并视频 + 音频 ===
  nodes["42"] = {
    class_type: "CreateVideo",
    inputs: { images: ["40", 0], fps: H3_CONSTANTS.FPS, audio: ["41", 0] },
  };

  // === 保存 (mp4 内嵌音频) ===
  nodes["50"] = {
    class_type: "SaveVideo",
    inputs: { video: ["42", 0], filename_prefix: filenamePrefix, format: "mp4", codec: "auto" },
  };

  return nodes;
}

// ============================================================
// Handler —— 三步管线编排
// ============================================================

export default router.post(
  "/",
  upload.fields([
    { name: "image", maxCount: 1 },                              // i2va 首帧图
    { name: "refImages", maxCount: H3_CONSTANTS.MAX_REF_IMAGES }, // ref2va 参考图 (≤9)
    { name: "ttsAudio", maxCount: 1 },                            // TTS 对白音频 (可选)
  ]),
  validateFields({
    projectId: z.coerce.number(),
    prompt: z.string().min(1),
  }),
  async (req, res) => {
    const projectId = req.body.projectId;
    const prompt = req.body.prompt as string;
    const negativePrompt = (req.body.negativePrompt as string) || LTX_AMBIENT.defaultNegativePrompt;
    const filenamePrefix =
      (req.body.filenamePrefix as string) || `h3_generate_${projectId}_${Date.now()}`;

    // ── 模式解析 + 校验 ──
    const rawMode = ((req.body.mode as string) || "t2va").toLowerCase();
    if (!["t2va", "i2va", "ref2va"].includes(rawMode)) {
      return res.status(400).send(error(`mode must be one of: t2va | i2va | ref2va (got "${rawMode}")`));
    }
    const mode = rawMode as "t2va" | "i2va" | "ref2va";

    // ── 分辨率 (默认 16:9, 必须 32 倍数) ──
    const width = Number(req.body.width) || H3_DEFAULTS.defaultWidth;
    const height = Number(req.body.height) || H3_DEFAULTS.defaultHeight;
    if (width % H3_CONSTANTS.CANVAS_MULTIPLE !== 0 || height % H3_CONSTANTS.CANVAS_MULTIPLE !== 0) {
      return res
        .status(400)
        .send(error(`width/height must be multiples of ${H3_CONSTANTS.CANVAS_MULTIPLE} (got ${width}×${height})`));
    }

    // ── 帧数 (自动对齐 n%17==5) ──
    const rawLength = Number(req.body.length) || H3_DEFAULTS.defaultLength;
    const length = alignH3FrameCount(rawLength);

    // H3 视频生成种子 (默认随机); Foley 种子用 LTX 默认 (42)
    const h3Seed = req.body.seed ? Number(req.body.seed) : Math.floor(Math.random() * 2147483647);

    // ── 文件入参 ──
    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    const imageFile = files?.image?.[0];
    const refImageFiles = files?.refImages || [];
    const ttsAudioFile = files?.ttsAudio?.[0];

    // 模式入参校验
    if (mode === "i2va" && !imageFile) {
      return res.status(400).send(error("mode=i2va requires an 'image' file (first frame)."));
    }
    if (mode === "ref2va") {
      if (refImageFiles.length < 1) {
        return res
          .status(400)
          .send(error(`mode=ref2va requires at least 1 'refImages' file (up to ${H3_CONSTANTS.MAX_REF_IMAGES}).`));
      }
      if (refImageFiles.length > H3_CONSTANTS.MAX_REF_IMAGES) {
        return res
          .status(400)
          .send(error(`Too many refImages: ${refImageFiles.length} (max ${H3_CONSTANTS.MAX_REF_IMAGES}).`));
      }
    }

    // TTS 本地路径 (最终合并用); 所有出口都需清理
    const localTtsAudio: string | null = ttsAudioFile ? ttsAudioFile.path : null;

    // 收集需要清理的临时文件 (safeUnlink 幂等, 重复删是 no-op)
    const tmpPaths: string[] = [];

    // ── 上传图片到 ComfyUI 容器 (i2va / ref2va) ──
    let firstFrameFilename: string | null = null;
    const refImageFilenames: string[] = [];
    try {
      if (mode === "i2va" && imageFile) {
        const ext = path.extname(imageFile.originalname || ".png") || ".png";
        firstFrameFilename = `${uuidv4()}${ext}`;
        copyToContainer(imageFile.path, `${H3_CONFIG.comfyuiInputDir}/${firstFrameFilename}`);
      }
      if (mode === "ref2va") {
        for (const file of refImageFiles) {
          const ext = path.extname(file.originalname || ".png") || ".png";
          const fname = `${uuidv4()}${ext}`;
          copyToContainer(file.path, `${H3_CONFIG.comfyuiInputDir}/${fname}`);
          refImageFilenames.push(fname);
        }
      }
    } catch (err: any) {
      if (imageFile) safeUnlink(imageFile.path);
      for (const f of refImageFiles) safeUnlink(f.path);
      if (ttsAudioFile) safeUnlink(ttsAudioFile.path);
      return res.status(502).send(error(`Failed to upload image(s) to ComfyUI: ${err.message}`));
    }
    // multer 暂存的原图上传后即可删 (容器内已有副本)
    if (imageFile) safeUnlink(imageFile.path);
    for (const f of refImageFiles) safeUnlink(f.path);

    // ============================================================
    // Step 1: H3 视频生成
    // ============================================================
    const h3Wf = buildH3Workflow({
      mode,
      prompt,
      negativePrompt: H3_DEFAULT_NEGATIVE, // H3 视频用视觉负面词; API 的 negativePrompt 留给 Foley
      width, height, length,
      seed: h3Seed,
      firstFrameFilename,
      refImageFilenames,
      filenamePrefix: `${filenamePrefix}_h3`,
    });

    let h3PromptId: string | null = null;
    let localH3VideoPath: string | null = null;

    try {
      const comfyRes = await axios.post(
        `${H3_CONFIG.comfyuiUrl}/prompt`,
        { prompt: h3Wf },
        { timeout: 30_000, validateStatus: (s: number) => s < 500 },
      );
      if (comfyRes.status !== 200) {
        safeUnlink(localTtsAudio);
        return res
          .status(502)
          .send(error(`ComfyUI rejected H3 prompt: ${JSON.stringify(comfyRes.data)}`));
      }
      h3PromptId = comfyRes.data.prompt_id as string;

      // 轮询等待 H3 完成 (≤15 分钟)
      const poll = await pollComfyuiCompletion(H3_CONFIG.comfyuiUrl, h3PromptId, H3_CONFIG.pollTimeoutMs);
      if (!poll.ok) {
        safeUnlink(localTtsAudio);
        return res.status(502).send(error(`H3 video generation failed: ${poll.error}`, {
          pipeline: { h3: { mode, promptId: h3PromptId } },
        }));
      }

      // 下载 H3 视频 (mp4, 内嵌音频)
      localH3VideoPath = path.join(LOCAL_STAGING_DIR, `${h3PromptId}_h3.mp4`);
      tmpPaths.push(localH3VideoPath);
      const fetched = await downloadVideoFromOutputs(H3_CONFIG.comfyuiUrl, poll.outputs, localH3VideoPath);
      if (!fetched || !fs.existsSync(localH3VideoPath)) {
        safeUnlink(localTtsAudio);
        for (const p of tmpPaths) safeUnlink(p);
        return res.status(502).send(error("Failed to download H3 video output", {
          pipeline: { h3: { mode, promptId: h3PromptId } },
        }));
      }
    } catch (err: any) {
      const msg = err.response?.data?.error?.message || err.response?.data?.node_errors || err.message || String(err);
      safeUnlink(localTtsAudio);
      for (const p of tmpPaths) safeUnlink(p);
      return res.status(502).send(error(`H3 generation request failed: ${msg}`, {
        pipeline: { h3: { mode, promptId: h3PromptId } },
      }));
    }

    // ============================================================
    // Step 2: Foley 环境音生成 (LTX + NAG + BGM 检测重试)
    // ============================================================
    // H3 视频 → 去音频 + re-encode 到 LTX 分辨率 (1280x704) 作为 Foley 输入
    let foleyInputPath: string | null = null;
    let foleyPromptId: string | null = null;
    let numFrames = 0;
    let bgmDetection: any = {
      risk: "UNKNOWN",
      suspectSegments: 0,
      totalSegments: 0,
      retries: 0,
      finalSeed: LTX_AMBIENT.defaultSeed,
    };
    let ambientAudioPath: string | null = null;

    try {
      const processed = ensureResolutionAndStripAudio(localH3VideoPath!, LTX_AMBIENT.width, LTX_AMBIENT.height);
      foleyInputPath = processed.path;
      tmpPaths.push(foleyInputPath);

      // 帧数自动计算 (ffprobe → 8n+1 对齐)
      let rawFrames = probeFrameCount(foleyInputPath);
      if (rawFrames <= 0) rawFrames = 97;
      numFrames = alignLtxFrames(rawFrames);

      // 上传纯视频到容器
      const videoContainerFilename = `${uuidv4()}_h3pure.mp4`;
      const videoContainerPath = `${H3_CONFIG.comfyuiInputDir}/${videoContainerFilename}`;
      copyToContainer(foleyInputPath, videoContainerPath);

      const foleySeed = LTX_AMBIENT.defaultSeed;

      // 构建 + 提交 LTX 环境音工作流
      const foleyWf = buildLtxAmbientWorkflow({
        videoFilename: videoContainerFilename,
        prompt,
        negativePrompt,
        numFrames,
        seed: foleySeed,
        filenamePrefix: `${filenamePrefix}_foley`,
      });

      const foleyRes = await axios.post(
        `${H3_CONFIG.comfyuiUrl}/prompt`,
        { prompt: foleyWf },
        { timeout: 30_000, validateStatus: (s: number) => s < 500 },
      );
      if (foleyRes.status !== 200) {
        throw new Error(`ComfyUI rejected Foley prompt: ${JSON.stringify(foleyRes.data)}`);
      }
      foleyPromptId = foleyRes.data.prompt_id as string;

      // 轮询等待 Foley 完成 (≤10 分钟)
      const poll = await pollComfyuiCompletion(H3_CONFIG.comfyuiUrl, foleyPromptId, 600_000);
      if (!poll.ok) throw new Error(`Foley generation failed: ${poll.error}`);

      // 下载环境音
      ambientAudioPath = path.join(LOCAL_STAGING_DIR, `${foleyPromptId}_ambient.flac`);
      tmpPaths.push(ambientAudioPath);
      const found = await downloadAudioFromOutputs(H3_CONFIG.comfyuiUrl, poll.outputs, ambientAudioPath);
      if (!found || !fs.existsSync(ambientAudioPath)) throw new Error("Failed to produce ambient audio");

      // ── BGM 检测 + 换 seed 重试 (最多 2 次, 逻辑复制自 replace-audio) ──
      let currentSeed = foleySeed;
      let bestAmbientPath = ambientAudioPath;
      let bgmResult = detectBgm(ambientAudioPath);
      let bgmRetries = 0;

      while (bgmResult.hasBgm && bgmRetries < LTX_AMBIENT.bgmMaxRetries) {
        bgmRetries++;
        currentSeed = foleySeed + bgmRetries * 1000;
        console.log(
          `[generate] BGM detected (risk=${bgmResult.risk}, ` +
          `${bgmResult.suspectSegments}/${bgmResult.totalSegments} segs), ` +
          `retry ${bgmRetries}/${LTX_AMBIENT.bgmMaxRetries} seed=${currentSeed}`,
        );

        const retryWf = buildLtxAmbientWorkflow({
          videoFilename: videoContainerFilename,
          prompt,
          negativePrompt,
          numFrames,
          seed: currentSeed,
          filenamePrefix: `${filenamePrefix}_foley_retry${bgmRetries}`,
        });
        const retryRes = await axios.post(
          `${H3_CONFIG.comfyuiUrl}/prompt`,
          { prompt: retryWf },
          { timeout: 30_000, validateStatus: (s: number) => s < 500 },
        );
        if (retryRes.status !== 200) break;

        const retryPoll = await pollComfyuiCompletion(H3_CONFIG.comfyuiUrl, retryRes.data.prompt_id, 600_000);
        if (!retryPoll.ok) break;

        const retryAudioPath = path.join(
          LOCAL_STAGING_DIR,
          `${retryRes.data.prompt_id}_ambient_retry${bgmRetries}.flac`,
        );
        tmpPaths.push(retryAudioPath);
        const retryFound = await downloadAudioFromOutputs(H3_CONFIG.comfyuiUrl, retryPoll.outputs, retryAudioPath);
        if (!retryFound) break;

        const retryBgm = detectBgm(retryAudioPath);
        console.log(
          `[generate] Retry ${bgmRetries}: risk=${retryBgm.risk}, ` +
          `${retryBgm.suspectSegments}/${retryBgm.totalSegments} segs`,
        );

        // 只有改善时才采用新音频
        if (retryBgm.suspectSegments < bgmResult.suspectSegments) {
          bestAmbientPath = retryAudioPath; // 旧 best 由最终 cleanup 兜底删除
          bgmResult = retryBgm;
          if (!retryBgm.hasBgm || retryBgm.risk === "LOW") break;
        } else {
          break; // 无改善, 放弃
        }
      }

      bgmDetection = {
        risk: bgmResult.risk,
        suspectSegments: bgmResult.suspectSegments,
        totalSegments: bgmResult.totalSegments,
        retries: bgmRetries,
        finalSeed: currentSeed,
      };
      // 合并用最佳环境音
      ambientAudioPath = bestAmbientPath;
    } catch (err: any) {
      const msg = err.response?.data?.error?.message || err.message || String(err);
      safeUnlink(localTtsAudio);
      for (const p of tmpPaths) safeUnlink(p);
      return res.status(502).send(error(`Foley (replace-audio) step failed: ${msg}`, {
        pipeline: {
          h3: { mode, promptId: h3PromptId, videoPath: localH3VideoPath },
          foley: { promptId: foleyPromptId, numFrames, error: msg },
        },
      }));
    }

    // ============================================================
    // Step 3: 最终合并 (H3 视频 + 可选 TTS + 环境音)
    // ============================================================
    const finalOutputPath = path.join(H3_CONFIG.outputDir, `${filenamePrefix}_final.mp4`);
    try {
      fs.mkdirSync(path.dirname(finalOutputPath), { recursive: true });
      // 用 H3 原始分辨率视频合并: mergeAudioAndVideo 只取视频流 (-map 0:v:0),
      // 用 Foley 环境音 (+可选 TTS 混音) 替换原音轨。
      mergeAudioAndVideo(localH3VideoPath!, localTtsAudio, ambientAudioPath!, finalOutputPath);
    } catch (err: any) {
      safeUnlink(localTtsAudio);
      for (const p of tmpPaths) safeUnlink(p);
      return res.status(502).send(error(`Final merge failed: ${err.message}`, {
        pipeline: {
          h3: { mode, promptId: h3PromptId, videoPath: localH3VideoPath },
          foley: { promptId: foleyPromptId, numFrames, bgmDetection },
        },
      }));
    }

    // 清理所有临时文件
    safeUnlink(localTtsAudio);
    for (const p of tmpPaths) safeUnlink(p);

    const outputUrl = `/mnt/agents/output/${filenamePrefix}_final.mp4`;
    res.status(200).send(
      success({
        status: "completed",
        videoUrl: outputUrl,
        videoPath: finalOutputPath,
        pipeline: {
          h3: { mode, promptId: h3PromptId, videoPath: localH3VideoPath },
          foley: { promptId: foleyPromptId, numFrames, bgmDetection },
        },
        hasTts: !!ttsAudioFile,
      }, "H3 generate pipeline completed (video + ambient audio merged)"),
    );
  },
);
