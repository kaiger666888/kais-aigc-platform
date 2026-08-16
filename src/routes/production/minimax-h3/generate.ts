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
 *   refVideo       : File    (lineart-anime 模式的线稿参考视频, 可选)
 *
 *   # 可选: 分用途入口 (KMC 推荐 — 一个参数解析 profile/mode/motion/audioMix)
 *   useCase        : string  ("preview-lock" | "final-shot" | "broll" | "keyframe-interp"
 *                             | "portrait-dialogue" | "motion-board" | "lineart-color")
 *                             仅提供默认值; 显式传 mode/profile/motion/steps/audioMix 仍可覆盖 (显式优先)。
 *                             详见 config.ts 的 H3_USE_CASES。
 *
 *   # 可选: 视频参数
 *   width          : number  (默认 1344, 必须 32 倍数)
 *   height         : number  (默认 768, 必须 32 倍数)
 *   length         : number  (帧数, 默认 124, 自动对齐 n%17==5)
 *
 *   # ⚠️ Token 预算 (2026-08-14 压力测试): width×height×length ≤ 300M 安全线
 *   #   - 340M+ 实测崩溃 (1344×768×362f=374M, comfy_kitchen 双后端 illegal access)
 *   #   - 满 15s (362f) 最高 1280×704 (=326M, warn 区); 1344×768 最高 311f
 *   #   - 详见 config.ts 的 H3_TOKEN_FRONTIER / checkH3TokenBudget()
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
import { VramInsufficientError, withGpuQueueTimed } from "@/lib/gpuVramManager";
import { validateFields } from "@/middleware/middleware";
import {
  H3_CONFIG,
  H3_DEFAULTS,
  H3_CONSTANTS,
  H3_T8,
  H3_TURBO,
  H3_TESPEED,
  H3_NATIVE,
  H3_LIGHTX2V_VARIANTS,
  H3_LINEART_ANIME,
  H3_PROFILES,
  H3_USE_CASES,
  H3_SIGMA_INTERP,
  H3_SIGMA_INTERP_NODES,
  H3_DEFAULT_NEGATIVE,
  alignH3FrameCount,
  checkH3TokenBudget,
  getTurboSteps,
  type H3UseCasePreset,
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
// H3 工作流构建 (T8 内联, 节点拓扑与 t2va.ts / i2va.ts / ref2va.ts 一致)
// ============================================================
//
// 不 import 那三个路由文件, 仅 import config 常量后在本文件内联构建 T8 工作流 JSON。
// 三种模式共享 T8 节点 10/11/12/13/20/30/31/32/33/40/42/50, 仅在以下处分支:
//   - 节点 20 (统一条件 MiniMaxH3AudioConditioningT8):
//       t2va   —— 无图输入
//       i2va   —— first_frame = 节点 14
//       ref2va —— ref_images 数组 (节点 14/141/142...)
//   - LoadImage 节点: i2va 首帧 = 节点 14; ref2va 参考图 = 节点 14/141/142...
//   - turbo 模式: 插入 14_lora (LoraLoaderBypassModelOnly), steps 由 motion 参数决定 (4~8)
// T8 统一模型 fl2va_int8_convrot 覆盖所有 task_type (task_type="auto" 自动判定)。

interface H3GenOpts {
  mode: "t2va" | "i2va" | "ref2va";
  prompt: string;
  width: number;
  height: number;
  length: number;
  seed: number;
  /** 采样步数覆盖 (null 则用 H3_DEFAULTS.t2vSteps; turbo 时用 getTurboSteps 兜底) */
  stepsOverride: number | null;
  /** i2va 首帧图 (容器内文件名); t2va / ref2va 传 null */
  firstFrameFilename: string | null;
  /** ref2va 参考图 (容器内文件名数组); t2va / i2va 传 [] */
  refImageFilenames: string[];
  /** lineart-anime 线稿参考视频 (容器内文件名); 其他模式传 null */
  refVideoFilename: string | null;
  filenamePrefix: string;
  /** 启用 Turbo LoRA (LoraLoaderBypassModelOnly, 4~8 步加速, 步数由 motion 参数决定) */
  turbo?: boolean;
  /** 走原生 KSampler + SigmaShift 链路 (true) 或 T8 Dual-Clock (false/undefined) */
  native?: boolean;
  /**
   * 原生链路是否插入 TESpeed 节点(35)。
   * 默认 (不传或 true): 插入 (仅当 H3_TESPEED.enabled=true)。
   * 显式 false: 不插入 —— 用于 native-sage profile (SageAttention 全局生效, 无质量损失)。
   * T8 工作流忽略此字段。
   */
  tespeed?: boolean;
  /**
   * 原生链路 sigma 低噪段插值 (ExtendIntermediateSigmas, 2026-08-16)。
   * true: 注入节点 36, 34.sigmas → [36,0] (15→17 步, 末段跳变减半)。
   * false/undefined: 不注入, 34.sigmas 直连 [31,0] (Advanced 链 sigma 表与 KSampler 逐位相同)。
   * 仅 buildH3WorkflowNative 使用; T8 / LightX2V 工作流忽略。
   */
  nativeInterp?: boolean;
  /** 负面提示词 (原生链路 KSampler 需占位; T8 忽略) */
  negativePrompt?: string;
}

function buildH3WorkflowT8(opts: H3GenOpts): Record<string, any> {
  const {
    mode, prompt,
    width, height, length, seed,
    stepsOverride,
    firstFrameFilename, refImageFilenames, filenamePrefix,
    turbo,
  } = opts;

  const isRef2va = mode === "ref2va";
  // turbo 模式下 steps 优先用 stepsOverride (可能携带 motion-based 值), 否则按默认 motion 兜底
  const steps = turbo ? (stepsOverride || getTurboSteps()) : (stepsOverride || H3_DEFAULTS.t2vSteps);
  // Turbo LoRA 仅在低步数 (≤15) 时加载; 高步数时 LoRA 无益反而引入伪影
  const useLora = turbo && steps <= 15;
  // ref2va 参考图节点 ID: 首张 "14", 其余 141,142...
  const imageNodeId = (i: number) => (i === 0 ? "14" : `14${i}`);

  const nodes: Record<string, any> = {
    // === 模型 / 文本编码器 / VAE ===
    "10": { class_type: "CLIPLoader", inputs: { clip_name: H3_DEFAULTS.clipName, type: "minimax" } },
    "11": { class_type: "VAELoader", inputs: { vae_name: H3_DEFAULTS.videoVaeName } },
    "12": { class_type: "UNETLoader", inputs: { unet_name: H3_DEFAULTS.fl2vaModel, weight_dtype: "default" } },
    "13": { class_type: "VAELoader", inputs: { vae_name: H3_DEFAULTS.audioVaeName } },

    // === Turbo LoRA (仅低步数 ≤15; 高步数跳过避免伪影) ===
    ...(useLora ? {
      [H3_TURBO.nodeId]: {
        class_type: H3_TURBO.loaderClassType,
        inputs: {
          model: ["12", 0],
          lora_name: H3_TURBO.useEma ? H3_TURBO.loraNameEma : H3_TURBO.loraName,
          strength_model: H3_TURBO.strengthModel,
        },
      },
    } : {}),

    // === 统一条件 (MiniMaxH3AudioConditioningT8) ===
    // task_type="auto" 自动判 t2va/i2va/ref2va/hybrid (按连接的可选输入)。
    "20": {
      class_type: "MiniMaxH3AudioConditioningT8",
      inputs: {
        clip: ["10", 0],
        video_vae: ["11", 0],
        audio_vae: ["13", 0],
        prompt,
        width, height, length,
        task_type: H3_T8.taskType,
        audio_mode: H3_T8.audioMode,
        audio_denoise_strength: H3_T8.audioDenoiseStrength,
        add_source_as_reference: H3_T8.addSourceAsReference,
        prompt_primary_audio_ordinal: H3_T8.promptPrimaryAudioOrdinal,
        strict_prompt_tags: H3_T8.strictPromptTags,
        ref_image_size: "match",
        reference_video_policy: H3_T8.referenceVideoPolicy,
        ...(mode === "i2va" && firstFrameFilename ? { first_frame: ["14", 0] } : {}),
        ...(isRef2va && refImageFilenames.length
          ? { ref_images: refImageFilenames.map((_, i) => [imageNodeId(i), 0]) }
          : {}),
      },
    },

    // === Dual-Clock 采样器配置 (内置 12/3 shift + flow sigma + 双时钟 Euler) ===
    "30": {
      class_type: "MiniMaxH3DualClockSamplerT8",
      inputs: {
        model: useLora ? [H3_TURBO.nodeId, 0] : ["12", 0],
        av_latent: ["20", 1],
        steps,
        shift_video: H3_DEFAULTS.shiftVideo,
        shift_audio: H3_DEFAULTS.shiftAudio,
      },
    },

    // === 采样链路 (RandomNoise + BasicGuider + SamplerCustomAdvanced 产出 LATENT) ===
    "31": { class_type: "RandomNoise", inputs: { noise_seed: seed } },
    "32": { class_type: "BasicGuider", inputs: { model: ["30", 0], conditioning: ["20", 0] } },
    "33": {
      class_type: "SamplerCustomAdvanced",
      inputs: { noise: ["31", 0], guider: ["32", 0], sampler: ["30", 1], sigmas: ["30", 2], latent_image: ["20", 1] },
    },

    // === 联合 AV 解码 (IMAGE + AUDIO) + 合并 + 保存 ===
    "40": {
      class_type: "MiniMaxH3AVDecodeT8",
      inputs: { av_latent: ["33", 0], video_vae: ["11", 0], audio_vae: ["13", 0] },
    },
    "42": {
      class_type: "CreateVideo",
      inputs: { images: ["40", 0], fps: H3_CONSTANTS.FPS, audio: ["40", 1] },
    },
    "50": {
      class_type: "SaveVideo",
      inputs: { video: ["42", 0], filename_prefix: filenamePrefix, format: "mp4", codec: "auto" },
    },
  };

  // === LoadImage 节点 ===
  // ref2va: 参考图首张 = "14", 其余 141,142...
  if (isRef2va) {
    refImageFilenames.forEach((filename, i) => {
      nodes[imageNodeId(i)] = { class_type: "LoadImage", inputs: { image: filename } };
    });
  }
  // i2va: 首帧图 = "14"
  if (mode === "i2va" && firstFrameFilename) {
    nodes["14"] = { class_type: "LoadImage", inputs: { image: firstFrameFilename } };
  }

  return nodes;
}

// ============================================================
// H3 原生工作流构建 (Native — KSampler + SigmaShift, pre-T8 拓扑)
// ============================================================
//
// 从 commit c2ad955a~1 恢复, 适配当前 config 常量。
// 三种模式共享原生节点 10/11/12/13/16/21/30/40/41/42/50, 仅在以下处分支:
//   - 节点 12 (UNETLoader): t2va/i2va 用 fl2vaModel; ref2va 用 ref2vaModel (pruned int8)
//   - 节点 20 (正面条件): t2va/i2va 用 MiniMaxH3ImageToVideo; ref2va 用 MiniMaxH3ReferenceToVideo
//   - 采样器/步数: t2va/i2va 用 euler + H3_NATIVE.t2vSteps(50); ref2va 用 res_multistep + H3_NATIVE.r2vSteps(20)
//   - LoadImage 节点: i2va 首帧 = 节点 14; ref2va 参考图 = 节点 14/141/142...
// ⚠️ native 模式不使用 Turbo LoRA, 不使用 T8 节点 (MiniMaxH3AudioConditioningT8 / DualClockSamplerT8 / AVDecodeT8)。
// ⚠️ native 模式默认不插入 TESpeed 节点 (与 pre-T8 代码一致的行为; H3_TESPEED.enabled=true 仅表示全局 patch 就位)。
function buildH3WorkflowNative(opts: H3GenOpts): Record<string, any> {
  const {
    mode, prompt, negativePrompt = H3_DEFAULT_NEGATIVE,
    width, height, length, seed,
    stepsOverride,
    firstFrameFilename, refImageFilenames, filenamePrefix,
    nativeInterp,
  } = opts;

  const isRef2va = mode === "ref2va";
  // 模型 / 采样器 / 步数按模式选择 (原生链路)
  const unetModel = isRef2va ? H3_DEFAULTS.ref2vaModel : H3_DEFAULTS.fl2vaModel;
  const steps = stepsOverride || (isRef2va ? H3_NATIVE.r2vSteps : H3_NATIVE.t2vSteps);
  const samplerName = isRef2va ? H3_NATIVE.r2vSamplerName : H3_NATIVE.t2vSamplerName;
  const scheduler = isRef2va ? H3_NATIVE.r2vScheduler : H3_NATIVE.t2vScheduler;

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

  // === 采样 (Advanced 链, 2026-08-16 sigma 插值改造; latent_image = ["20", 1]) ===
  // TESpeed 加速: SigmaShift(21) → TESpeed(35) → BasicScheduler(31)/BasicGuider(33)
  // KSampler → KSamplerSelect(30) + BasicScheduler(31) + RandomNoise(32) + BasicGuider(33)
  // + SamplerCustomAdvanced(34)。数学等价性已验证: BasicScheduler 输出与 KSampler 内部
  // calculate_sigmas 逐位一致; cfg=1.0 下 BasicGuider ≡ KSampler 单 cond。
  // TESpeed 仅当 H3_TESPEED.enabled=true 且 opts.tespeed !== false 时插入;
  // native-sage profile 传 tespeed=false → 不插入 (SageAttention 全局生效, 无质量损失)。
  const useTespeed = H3_TESPEED.enabled && opts.tespeed !== false;
  // sigma 低噪段插值 (ExtendIntermediateSigmas 节点 36): H3_SIGMA_INTERP.enabled 总开关
  // && profile nativeInterp 才注入; 否则 34.sigmas 直连 31 (纯 Advanced 化, sigma 表逐位不变)。
  const useInterp = H3_SIGMA_INTERP.enabled && nativeInterp === true;
  if (useTespeed) {
    nodes[H3_TESPEED.nodeId] = {
      class_type: H3_TESPEED.classType,
      inputs: {
        model: ["21", 0],
        processing_control_value: H3_TESPEED.processingControlValue,
        processing_percent_1: H3_TESPEED.processingPercent1,
        processing_percent_2: H3_TESPEED.processingPercent2,
        mcs: H3_TESPEED.mcs,
        device: H3_TESPEED.device,
        cache_depth: H3_TESPEED.cacheDepth,
      },
    };
  }
  nodes["30"] = { class_type: "KSamplerSelect", inputs: { sampler_name: samplerName } };
  nodes["31"] = {
    class_type: "BasicScheduler",
    inputs: {
      model: useTespeed ? [H3_TESPEED.nodeId, 0] : ["21", 0],
      scheduler,
      steps,
      denoise: H3_DEFAULTS.denoise,
    },
  };
  nodes["32"] = { class_type: "RandomNoise", inputs: { noise_seed: seed } };
  // H3 CFG-distilled (cfg=1.0) → BasicGuider 单 conditioning 即可, 无需 negative
  nodes["33"] = {
    class_type: "BasicGuider",
    inputs: {
      model: useTespeed ? [H3_TESPEED.nodeId, 0] : ["21", 0],
      conditioning: ["20", 0],
    },
  };
  // sigma 低噪段加密 (仅 nativeInterp): 31 的 sigma 表在 σ≤0.65 段每对相邻值间插 1 中点
  if (useInterp) {
    nodes[H3_SIGMA_INTERP_NODES.generate] = {
      class_type: "ExtendIntermediateSigmas",
      inputs: {
        sigmas: ["31", 0],
        steps: H3_SIGMA_INTERP.steps,
        start_at_sigma: H3_SIGMA_INTERP.startAtSigma,
        end_at_sigma: H3_SIGMA_INTERP.endAtSigma,
        spacing: H3_SIGMA_INTERP.spacing,
      },
    };
  }
  nodes["34"] = {
    class_type: "SamplerCustomAdvanced",
    inputs: {
      noise: ["32", 0],
      guider: ["33", 0],
      sampler: ["30", 0],
      sigmas: useInterp ? [H3_SIGMA_INTERP_NODES.generate, 0] : ["31", 0],
      latent_image: ["20", 1],   // ToVideo 条件生成器第二输出 = latent
    },
  };

  // === 视频解码 ===
  nodes["40"] = { class_type: "VAEDecode", inputs: { samples: ["34", 0], vae: ["11", 0] } };

  // === 音频解码 (合并到视频) ===
  nodes["41"] = { class_type: "VAEDecodeAudio", inputs: { samples: ["34", 0], vae: ["13", 0] } };

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
// H3 SigmaShift + LoRA 工作流构建 (LightX2V Turbo LoRA v1.0 4步/8步 / LineartAnime LoRA, 无 T8)
// ============================================================
//
// LightX2V Turbo LoRA v1.0 正式版: lightx2v-4 (~72s, 768p, shift=6) / lightx2v-8 (~120s, 544p, shift=12)。
// LineartAnime LoRA (lineart-anime profile): rank=32, 20 步, 标准 shift=12, 仅 ref2va。
// 两者共享同一 SigmaShift + LoRA + KSampler 拓扑, 故本函数已泛化为接受任意 LoRA 配置 (loraConfig)。
// 三种模式共享节点 10/11/12/13/14_shift/15/16/20/30/31/32/33/34/40/41/42/50, 仅在以下处分支:
//   - 节点 12 (UNETLoader): t2va/i2va 用 fl2vaModel; ref2va 用 ref2vaModel (同 native)
//   - 节点 20 (正面条件): t2va/i2va 用 MiniMaxH3ImageToVideo; ref2va 用 MiniMaxH3ReferenceToVideo (同 native)
//   - LoadImage 节点: i2va 首帧 = 节点 14; ref2va 参考图 = 节点 14/141/142... (同 native)
// ⚠️ 关键区别 (与 native / T8):
//   - 使用 SigmaShift (节点 14_shift) —— v1.0 按 variant 设 shift_video (4步=6, 8步=12), shift_audio=3.0。
//     v0.1 旧版不带 SigmaShift 导致极暗画面; 正式版修正了 sigma schedule 故必须带 shift。
//   - 不使用 T8 节点 (MiniMaxH3AudioConditioningT8 / DualClockSamplerT8 / AVDecodeT8)
//   - 不使用 T8 Turbo LoRA (用独立 LightX2V LoRA, strength=1.0)
//   - 采样链路: KSamplerSelect(30) + BasicScheduler(31) + RandomNoise(32) + BasicGuider(33) + SamplerCustomAdvanced(34)
//   - model 链: 12(UNET) → 14_shift(SigmaShift) → 15(LoRA) → BasicScheduler(31)/BasicGuider(33)
// SigmaShift + LoRA 配置结构 (LightX2V v1.0 各版本与 LineartAnime 共用同一工作流拓扑)。
// H3_LIGHTX2V_VARIANTS[*] 与 H3_LINEART_ANIME 均满足此结构。
interface H3LoraShiftConfig {
  loraName: string;
  strengthModel: number;
  steps: number;
  shiftVideo: number;
  shiftAudio: number;
  samplerName: string;
  scheduler: string;
  denoise: number;
  nodeId: string;
  loaderClassType: string;
}

function buildH3WorkflowLightX2V(
  opts: H3GenOpts,
  loraConfig: H3LoraShiftConfig,
): Record<string, any> {
  const {
    mode, prompt, negativePrompt = H3_DEFAULT_NEGATIVE,
    width, height, length, seed,
    stepsOverride,
    firstFrameFilename, refImageFilenames, refVideoFilename, filenamePrefix,
  } = opts;

  const isRef2va = mode === "ref2va";
  const unetModel = isRef2va ? H3_DEFAULTS.ref2vaModel : H3_DEFAULTS.fl2vaModel;
  const steps = stepsOverride || loraConfig.steps;

  const nodes: Record<string, any> = {
    // === 模型 / 文本编码器 / VAE ===
    "10": { class_type: "CLIPLoader", inputs: { clip_name: H3_DEFAULTS.clipName, type: "minimax" } },
    "11": { class_type: "VAELoader", inputs: { vae_name: H3_DEFAULTS.videoVaeName } },
    "12": { class_type: "UNETLoader", inputs: { unet_name: unetModel, weight_dtype: "default" } },
    "13": { class_type: "VAELoader", inputs: { vae_name: H3_DEFAULTS.audioVaeName } },

    // === SigmaShift (LightX2V v1.0: shift 值因版本而异) ===
    // 4步正式版: shift_video=6 (768p 训练优化); 8步正式版: shift_video=12 (544p mixed 训练)。
    // v0.1 旧版不用 SigmaShift → 极暗画面的真因正是缺少 shift。节点 ID 用 "14_shift"
    // 避免与 i2va 首帧 / ref2va 参考图的 LoadImage "14"/"141" 槽位冲突。
    "14_shift": {
      class_type: "MiniMaxH3SigmaShift",
      inputs: {
        model: ["12", 0],
        shift_video: loraConfig.shiftVideo,
        shift_audio: loraConfig.shiftAudio,
      },
    },

    // === LoRA (LoraLoaderModelOnly, model→14_shift) —— LightX2V / LineartAnime 共用 ===
    [loraConfig.nodeId]: {
      class_type: loraConfig.loaderClassType,
      inputs: {
        model: ["14_shift", 0],
        lora_name: loraConfig.loraName,
        strength_model: loraConfig.strengthModel,
      },
    },
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

  // === 负面条件占位 (MiniMaxH3ImageToVideo, 无图) ===
  // 结构占位 (验证拓扑携带, 同 native 的 Node 16)。BasicGuider 路径只接正面 conditioning,
  // 此节点不可达 SaveVideo(50) 故 ComfyUI 不执行; H3 cfg=1.0 下负面提示词本就不生效。
  nodes["16"] = {
    class_type: "MiniMaxH3ImageToVideo",
    inputs: { clip: ["10", 0], vae: ["11", 0], prompt: negativePrompt, width, height, length },
  };

  // === 正面条件 (分支逻辑同 native) ===
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

  // === ref_video 支持 (LineartAnime: 线稿视频 → 彩色视频) ===
  // LoadVideo → GetVideoComponents → 拆出 IMAGE 帧序列 + AUDIO → 注入 node 20
  // (MiniMaxH3ReferenceToVideo) 的 ref_videos / ref_video_audios 结构化槽位。
  // 仅在 ref2va 模式 + 提供了线稿参考视频时构建 (lineart-anime profile)。
  // 节点 ID "60"/"61" 不与本工作流其他节点冲突 (本链路最高用至 "50")。
  if (isRef2va && refVideoFilename) {
    nodes["60"] = { class_type: "LoadVideo", inputs: { file: refVideoFilename } };
    nodes["61"] = {
      class_type: "GetVideoComponents",
      inputs: { video: ["60", 0] },  // 输出 [IMAGE, AUDIO, FLOAT, INT]
    };
    nodes["20"].inputs["ref_videos.ref_video_0"] = ["61", 0];              // IMAGE frames
    nodes["20"].inputs["ref_video_audios.ref_video_audio_0"] = ["61", 1];  // AUDIO
  }

  // === 采样链路 (SigmaShift 在 model 链上游 14_shift 已应用) ===
  // KSamplerSelect(30) + BasicScheduler(31) + RandomNoise(32) + BasicGuider(33) + SamplerCustomAdvanced(34)
  // ⚠️ BasicGuider / BasicScheduler 的 model 输入 = Node 15 (LoRA loader 输出, 已含 SigmaShift), 不是 Node 12。
  nodes["30"] = {
    class_type: "KSamplerSelect",
    inputs: { sampler_name: loraConfig.samplerName },
  };
  nodes["31"] = {
    class_type: "BasicScheduler",
    inputs: {
      model: [loraConfig.nodeId, 0],
      scheduler: loraConfig.scheduler,
      steps,
      denoise: loraConfig.denoise,
    },
  };
  nodes["32"] = { class_type: "RandomNoise", inputs: { noise_seed: seed } };
  nodes["33"] = {
    class_type: "BasicGuider",
    inputs: { model: [loraConfig.nodeId, 0], conditioning: ["20", 0] },
  };
  nodes["34"] = {
    class_type: "SamplerCustomAdvanced",
    inputs: {
      noise: ["32", 0],
      guider: ["33", 0],
      sampler: ["30", 0],
      sigmas: ["31", 0],
      latent_image: ["20", 1],
    },
  };

  // === 视频解码 ===
  nodes["40"] = { class_type: "VAEDecode", inputs: { samples: ["34", 0], vae: ["11", 0] } };

  // === 音频解码 (合并到视频) ===
  nodes["41"] = { class_type: "VAEDecodeAudio", inputs: { samples: ["34", 0], vae: ["13", 0] } };

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
    { name: "refVideo", maxCount: 1 },                            // lineart-anime 线稿参考视频 (可选)
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

    // ── useCase 分用途入口 (KMC 推荐: 一个参数解析 profile/mode/motion/audioMix) ──
    // useCase 仅提供默认值; 调用方显式传 mode/profile/motion/steps/audioMix 仍可覆盖 (显式优先)。
    // 不传 useCase 时完全向后兼容 (mode 默认 t2va, profile 默认 production)。详见 config.ts H3_USE_CASES。
    const rawUseCase = (req.body.useCase as string)?.toLowerCase() || null;
    let useCasePreset: H3UseCasePreset | null = null;
    if (rawUseCase) {
      if (!(rawUseCase in H3_USE_CASES)) {
        return res.status(400).send(error(
          `useCase must be one of: ${Object.keys(H3_USE_CASES).join(" | ")} (got "${rawUseCase}")`,
        ));
      }
      useCasePreset = H3_USE_CASES[rawUseCase as keyof typeof H3_USE_CASES];
    }

    // ── 模式解析 + 校验 (显式 mode > useCase.mode > "t2va") ──
    const rawMode = ((req.body.mode as string) || useCasePreset?.mode || "t2va").toLowerCase();
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

    // ── Token 预算校验 (2026-08-14 压力测试: 崩溃由 width×height×length 决定) ──
    // reject → 400 拒绝 (340M+ 实测双后端崩溃); warn → 日志放行 (326M 实测可过, 不误杀)。
    const tokenBudget = checkH3TokenBudget(width, height, length);
    if (tokenBudget.level === "reject") {
      return res.status(400).send(error(tokenBudget.message, {
        tokenBudget: {
          tokens: tokenBudget.tokens,
          level: tokenBudget.level,
          safeLine: 300_000_000,
          crashLine: 340_000_000,
          requested: { width, height, length },
          suggestion:
            length >= 340
              ? { width: 1280, height: 704, length, note: "满时长请降分辨率 (1280×704×362f=326M 实测可过)" }
              : { width: 1344, height: 768, length: Math.min(length, 311), note: "1344×768 最高 311f (13s)" },
        },
      }));
    }
    if (tokenBudget.level === "warn") {
      console.warn(
        `[generate] H3 token budget WARN: ${width}×${height}×${length}f = ` +
        `${tokenBudget.tokens.toLocaleString()} tokens — ${tokenBudget.message}`,
      );
    }

    // H3 视频生成种子 (默认随机); Foley 种子用 LTX 默认 (42)
    const h3Seed = req.body.seed ? Number(req.body.seed) : Math.floor(Math.random() * 2147483647);

    // 采样步数覆盖 (优先级: 显式 steps > motion-based (turbo时) > profile.steps)
    // profile: "preview" (15步+跳过Foley) | "turbo" (motion-adaptive 4~8步+Turbo LoRA+跳过Foley)
    //        | "production" (50步 lossless+完整Foley)
    //        | "native" (原生 KSampler+SigmaShift, t2v/i2va 50步 / ref2va 20步, 非 T8)
    //        | "lightx2v-4" (LightX2V Turbo LoRA v1.0, 4 步 768p shift=6 / 无 T8, 跳过 Foley)
    //        | "lightx2v-8" (LightX2V Turbo LoRA v1.0, 8 步 544p shift=12 / 无 T8, 跳过 Foley)
    //        | "lineart-anime" (LineartAnime LoRA, 20 步 shift=12, line art→anime 上色 / ref2va, 无 T8, 跳过 Foley)
    const rawProfile = ((req.body.profile as string) || useCasePreset?.profile || "production").toLowerCase();
    if (![ "preview", "turbo", "production", "native", "native-sage", "lightx2v-4", "lightx2v-8", "lineart-anime" ].includes(rawProfile)) {
      return res
        .status(400)
        .send(error(`profile must be one of: preview | turbo | production | native | native-sage | lightx2v-4 | lightx2v-8 | lineart-anime (got "${rawProfile}")`));
    }
    const profile = H3_PROFILES[rawProfile as keyof typeof H3_PROFILES];
    // native: profile=native/native-sage 或显式 native=true
    const native = req.body.native === "true" || req.body.native === true || profile.native;
    // turbo: profile=turbo 或显式 turbo=true 任一为真即启用 (启用后 steps 由 motion 参数决定)
    const turbo = req.body.turbo === "true" || req.body.turbo === true || profile.turbo;
    // tespeed: 原生链路是否插入 TESpeed 节点(35)。native-sage profile 的 tespeed=false → 不插入。
    const tespeed = profile.tespeed !== false;
    // nativeInterp: sigma 低噪段插值 (native/native-sage profile 为 true, 其余 undefined → 不插值)
    const nativeInterp = profile.nativeInterp === true;
    const motion = (req.body.motion as string) || useCasePreset?.motion || undefined; // low | medium | high
    // 步数优先级: 显式 steps > motion-based (turbo时) > profile.steps (native profile.steps=null → 按模式默认)
    const h3StepsOverride = req.body.steps
      ? Number(req.body.steps)
      : (turbo && motion ? getTurboSteps(motion) : profile.steps);

    // 音频混音策略 (仅 skipFoley=false 档位的 Step3 合并生效): 显式 > useCase.audioMix > "balanced"
    //   balanced          —— TTS I=-16 + 环境音 I=-24 volume=0.5 (默认, 对白与环境音并重)
    //   dialogue-priority —— 环境音压到 I=-28 volume=0.3 (口播/短剧对白, 对白绝对优先)
    const rawAudioMix = (req.body.audioMix as string) || useCasePreset?.audioMix || "balanced";
    if (rawAudioMix !== "balanced" && rawAudioMix !== "dialogue-priority") {
      return res.status(400).send(error(`audioMix must be one of: balanced | dialogue-priority (got "${rawAudioMix}")`));
    }
    const audioMix = rawAudioMix;

    // ── 文件入参 ──
    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    const imageFile = files?.image?.[0];
    const refImageFiles = files?.refImages || [];
    const ttsAudioFile = files?.ttsAudio?.[0];
    const refVideoFile = files?.refVideo?.[0];

    // 模式入参校验
    if (mode === "i2va" && !imageFile) {
      return res.status(400).send(error("mode=i2va requires an 'image' file (first frame)."));
    }
    if (mode === "ref2va") {
      // lineart-anime profile 可只用 refVideo (线稿视频) 不传 refImages
      const isLineartAnime = rawProfile === "lineart-anime";
      if (refImageFiles.length < 1 && !isLineartAnime) {
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

    // ── 上传参考视频到 ComfyUI 容器 (lineart-anime) ──
    let refVideoFilename: string | null = null;
    if (refVideoFile) {
      const ext = path.extname(refVideoFile.originalname || ".mp4") || ".mp4";
      refVideoFilename = `${uuidv4()}${ext}`;
      try {
        copyToContainer(refVideoFile.path, `${H3_CONFIG.comfyuiInputDir}/${refVideoFilename}`);
      } catch (err: any) {
        safeUnlink(refVideoFile.path);
        if (ttsAudioFile) safeUnlink(ttsAudioFile.path);
        return res.status(502).send(error(`Failed to upload refVideo to ComfyUI: ${err.message}`));
      }
      safeUnlink(refVideoFile.path);
    }

    // ============================================================
    // Step 1: H3 视频生成
    // ============================================================
    // T8 DualClockSampler 独立可用, LoRA 是可选加速。
    // turbo=true → T8 链路 (低步数 ≤15 加载 LoRA, 高步数不加 LoRA)。
    // native=true → KSampler+SigmaShift 链路。
    const effectiveNative = native;

    const nativeWfOpts = {
      mode,
      prompt,
      width, height, length,
      seed: h3Seed,
      stepsOverride: h3StepsOverride,
      firstFrameFilename,
      refImageFilenames,
      refVideoFilename,
      filenamePrefix: `${filenamePrefix}_h3`,
      turbo: turbo && !effectiveNative,  // native 链路时 turbo=false
      native: effectiveNative,
      tespeed,
      nativeInterp,
    };
    // SigmaShift + LoRA 工作流 (无 T8): LightX2V Turbo LoRA v1.0 (lightx2v-4/8) 或
    // LineartAnime LoRA (lineart-anime)。三者共享同一拓扑, 仅 LoRA 配置/steps/shift 不同。
    // 用 rawProfile 字符串解析配置 (这些 profile.native=false 故 effectiveNative=false, 不会误入 native)。
    let loraShiftConfig: H3LoraShiftConfig | null = null;
    if (rawProfile === "lightx2v-4" || rawProfile === "lightx2v-8") {
      loraShiftConfig = H3_LIGHTX2V_VARIANTS[rawProfile as "lightx2v-4" | "lightx2v-8"];
    } else if (rawProfile === "lineart-anime") {
      loraShiftConfig = H3_LINEART_ANIME;
    }
    const h3Wf = effectiveNative
      ? buildH3WorkflowNative({ ...nativeWfOpts, negativePrompt: H3_DEFAULT_NEGATIVE })
      : loraShiftConfig
        ? buildH3WorkflowLightX2V(nativeWfOpts, loraShiftConfig)
        : buildH3WorkflowT8(nativeWfOpts);

    let h3PromptId: string | null = null;
    let localH3VideoPath: string | null = null;

    try {
      // ─── GPU 全局串行队列 (gpuVramManager withGpuQueueTimed, 2026-08-16) ───
      // 跨引擎互斥 (H3/TTS/music3/qwen_eye 共享 GPU1 锁), 排队等待而非 fail-fast;
      // H3 需 ~18GB, 锁粒度到「提交+轮询到完成+下载」— 34GB int8 权重驻留期间
      // 不允许其它引擎装载。排队超时 (默认 30min) 才抛 vram_insufficient。
      //
      // 双重超时修复 (21:48 事故同类): queueWaitMs 不计入 poll 预算 —
      // 2_700_000 (45min) + queueWaitMs; poll 失败时尽力清队列孤儿。
      const h3Out = await withGpuQueueTimed(
        "minimax_h3",
        async (queueWaitMs) => {
          const comfyRes = await axios.post(
            `${H3_CONFIG.comfyuiUrl}/prompt`,
            { prompt: h3Wf },
            { timeout: 30_000, validateStatus: (s: number) => s < 500 },
          );
          if (comfyRes.status !== 200) {
            return { kind: "rejected" as const, detail: JSON.stringify(comfyRes.data) };
          }
          const pid = comfyRes.data.prompt_id as string;

          // 轮询等待 H3 完成 (≤45 分钟 + 排队补偿)
          // 362帧 ref2va 实测 33 分钟 (模型重加载导致第二轮 124s/step)
          const poll = await pollComfyuiCompletion(
            H3_CONFIG.comfyuiUrl, pid, 2_700_000 + queueWaitMs,
            { orphanCleanup: true },
          );
          if (!poll.ok) {
            return { kind: "poll_failed" as const, promptId: pid, detail: poll.error };
          }
          return { kind: "ok" as const, promptId: pid, outputs: poll.outputs };
        },
        { gpuIndex: 1, comfyuiUrl: H3_CONFIG.comfyuiUrl },
      );
      const h3Result = h3Out.data;

      if (h3Result.kind === "rejected") {
        safeUnlink(localTtsAudio);
        return res.status(502).send(error(`ComfyUI rejected H3 prompt: ${h3Result.detail}`));
      }
      if (h3Result.kind === "poll_failed") {
        h3PromptId = h3Result.promptId;
        safeUnlink(localTtsAudio);
        return res.status(502).send(error(`H3 video generation failed: ${h3Result.detail}`, {
          pipeline: { h3: { mode, promptId: h3PromptId } },
        }));
      }
      h3PromptId = h3Result.promptId;

      // 下载 H3 视频 (mp4, 内嵌音频) — 锁外下载 (纯 IO, 不占显存)
      localH3VideoPath = path.join(LOCAL_STAGING_DIR, `${h3PromptId}_h3.mp4`);
      tmpPaths.push(localH3VideoPath);
      const fetched = await downloadVideoFromOutputs(H3_CONFIG.comfyuiUrl, h3Result.outputs, localH3VideoPath);
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
      if (err instanceof VramInsufficientError) {
        return res.status(503).send(error(err.message, {
          kind: "vram_insufficient",
          engine: "minimax_h3",
          freeMiB: err.freeMiB,
          requiredMiB: err.requiredMiB,
          gpuIndex: err.gpuIndex,
        }));
      }
      return res.status(502).send(error(`H3 generation request failed: ${msg}`, {
        pipeline: { h3: { mode, promptId: h3PromptId } },
      }));
    }

    // ============================================================
    // Preview profile 快速返回: H3 原生视频直出 (跳过 Foley / 合并)
    // ============================================================
    // H3 原生 mp4 已内嵌音频。预览档直接交付, 不跑 LTX 环境音替换
    // (省 5-10min)。TTS 对白文件若有则清理 (预览档不做混音)。
    if (profile.skipFoley) {
      // H3 原生视频移到输出目录 (生产路径: outputDir/filenamePrefix_final.mp4;
      // 预览路径: outputDir/filenamePrefix_h3.mp4)
      const previewOutputPath = path.join(H3_CONFIG.outputDir, `${filenamePrefix}_h3.mp4`);
      try {
        fs.mkdirSync(path.dirname(previewOutputPath), { recursive: true });
        fs.copyFileSync(localH3VideoPath!, previewOutputPath);
      } catch (err: any) {
        safeUnlink(localTtsAudio);
        for (const p of tmpPaths) safeUnlink(p);
        return res.status(502).send(error(`Preview output copy failed: ${err.message}`, {
          pipeline: { h3: { mode, promptId: h3PromptId } },
        }));
      }
      safeUnlink(localTtsAudio);
      for (const p of tmpPaths) safeUnlink(p);
      return res.status(200).send(
        success({
          status: "completed",
          profile: rawProfile,
          useCase: rawUseCase,
          turbo,
          videoUrl: `/mnt/agents/output/${filenamePrefix}_h3.mp4`,
          videoPath: previewOutputPath,
          pipeline: {
            h3: { mode, promptId: h3PromptId, videoPath: previewOutputPath },
            foley: null, // 预览档跳过
          },
          hasTts: !!ttsAudioFile,
          note: `T8 Dual-Clock preview${turbo ? " (Turbo, motion-adaptive)" : ""}: H3 native audio, Foley skipped`,
        }, "H3 preview completed (native audio, Foley skipped)"),
      );
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
      mergeAudioAndVideo(localH3VideoPath!, localTtsAudio, ambientAudioPath!, finalOutputPath, audioMix);
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
        profile: rawProfile,
        useCase: rawUseCase,
        audioMix,
        turbo,
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
