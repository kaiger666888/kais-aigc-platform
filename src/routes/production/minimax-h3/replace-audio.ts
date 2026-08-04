/**
 * MiniMax H3 — replace-audio (H3 视频 BGM 替换 / v9 Foley LoRA + SolidMask 工作流)
 *
 * 接收一个已生成的 H3 视频文件,用 LTX 2.3 + Foley LoRA 生成无 BGM 的环境音轨,
 * 最终输出独立的环境音频(客户端拿到音频后自行用 ffmpeg 合并视频+音频)。
 *
 * POST /api/production/minimax-h3/replace-audio   (multipart/form-data)
 *   video          : File    (H3 生成的视频文件, required)
 *   prompt         : string  (场景描述, 用于指导环境音生成, required)
 *   negativePrompt : string  (负面提示词, optional)
 *   ttsAudio       : File    (TTS 对白音频, optional - autoMerge=true 时自动合并)
 *   projectId      : number  (项目ID)
 *   seed           : number  (默认 42)
 *   autoMerge      : boolean (true=同步等待+自动合并TTS+环境音, false=异步返回promptId)
 *   filenamePrefix : string  (输出文件名前缀)
 *
 * 工作流(v9 方案 + NAG + BGM 检测重试):
 *   1. 接收视频 → 提取纯视频 (ffmpeg -an) + 可选 re-encode 到 1280x704
 *   2. 上传到 ComfyUI 容器 → docker cp 到 comfyui-primary:/root/ComfyUI/input/
 *   3. 构建 LTX 环境音工作流 → 提交到 ComfyUI (端口 8188)
 *   4. (autoMerge) 下载音频 → BGM 频谱检测 → 残留则换 seed 重试 (最多 2 次)
 *   5. 合并最终视频 + 音频
 *
 * 两种模式:
 *   autoMerge=false (默认): 异步模式, 返回 promptId, 客户端轮询
 *     GET /api/production/minimax-h3/status/:promptId
 *
 *   autoMerge=true: 同步模式, 服务端等待 LTX 完成后自动合并:
 *     - 有 ttsAudio: ffmpeg amix(TTS×1.4 + ambient×0.5) → 合并到纯视频
 *     - 无 ttsAudio: 直接合并环境音到纯视频
 *     返回最终 mp4 路径
 *
 * LTX 工作流拓扑(v9 Foley LoRA + SolidMask + NAG 方案):
 *   - H3 视频帧通过 VHS_LoadVideoFFmpeg → VHS_VAEEncodeBatched → SolidMask 冻结
 *   - Foley LoRA (LTX2LoraLoaderAdvanced, video=0/audio=1) 提供环境音生成能力
 *   - NAG 链 (PromptRelayEncode → LTX2_NAG) 采样阶段压制 BGM 残留
 *   - SolidMask (value=0) 冻结视频 latent, 采样只生成音频
 *   - LTX 蒸馏模型 9 步采样生成无 BGM 环境音
 *
 * 关键技术参数:
 *   - 模型: ltx-2.3-22b-distilled_transformer_only_fp8_input_scaled_v3.safetensors
 *   - Foley LoRA: ltx-2.3-foley-400-steps.safetensors (LoraLoaderModelOnly, strength=1.0)
 *   - VAE: LTX23_video_vae_bf16.safetensors, LTX23_audio_vae_bf16.safetensors
 *   - CLIP: gemma_3_12B_it_fp8_scaled + ltx-2.3_text_projection_bf16
 *   - Sigmas: 蒸馏模型专用 9 步调度
 *   - CFG: 1.0 (distilled)
 *   - 分辨率: 1280x704
 *   - 帧规则: 8n+1 (无上限)
 *
 * 架构参照 ref2va.ts (express router + zod + multer + copyToContainer),
 * 但工作流结构完全不同 —— 见 buildLtxAmbientWorkflow。
 */

import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import axios from "axios";
import { z } from "zod";
import { execSync } from "child_process";
import { v4 as uuidv4 } from "uuid";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { H3_CONFIG } from "./config";

const router = express.Router();

const LOCAL_STAGING_DIR = "/tmp/comfyui-h3-replace-audio";
if (!fs.existsSync(LOCAL_STAGING_DIR)) {
  fs.mkdirSync(LOCAL_STAGING_DIR, { recursive: true });
}

// 视频文件可能较大, 给到 1GB
const upload = multer({
  dest: LOCAL_STAGING_DIR,
  limits: { fileSize: 1024 * 1024 * 1024 },
});

// ============================================================
// LTX 常量 (v9 工作流专用, 定义在文件内部)
// ============================================================

export const LTX_AMBIENT = {
  // 模型文件名
  modelName: "ltx-2.3-22b-distilled_transformer_only_fp8_input_scaled_v3.safetensors",

  // v9: Foley LoRA — 用 LTX2LoraLoaderAdvanced 精确控制各层强度
  foleyLoraName: "ltx-2.3-foley-400-steps.safetensors",
  foleyLoraStrength: 1.0,

  // NAG (Negative Augmented Guidance) — 采样阶段压制 BGM 残留
  nagScale: 11,
  nagAlpha: 0.25,
  nagTau: 2.5,

  // BGM 检测重试参数
  bgmMaxRetries: 2,

  videoVaeName: "LTX23_video_vae_bf16.safetensors",
  audioVaeName: "LTX23_audio_vae_bf16.safetensors",
  clipName1: "gemma_3_12B_it_fp8_scaled.safetensors",
  clipName2: "ltx-2.3_text_projection_bf16.safetensors",

  // 采样参数 (蒸馏模型: CFG=1.0, euler, 9 sigmas)
  cfg: 1.0,
  samplerName: "euler",
  // 蒸馏模型专用 9 步 sigma 调度
  sigmas: "1.0, 0.99375, 0.9875, 0.98125, 0.975, 0.909375, 0.725, 0.421875, 0.0",

  // 分辨率 (固定 1280x704)
  width: 1280,
  height: 704,
  frameRate: 24,

  // 默认 seed
  defaultSeed: 42,

  // 默认负面提示词 (环境音场景: ban BGM / 人声)
  defaultNegativePrompt:
    "music, melody, song, singing, vocals, score, soundtrack, beat, instrumental backing, tinny, harsh, clipped, distorted",
} as const;

// ============================================================
// copyToContainer (与 ref2va.ts 一致)
// ============================================================

/** 把宿主文件拷进 ComfyUI 容器(先试 docker cp,失败回退 docker exec -i cat)。 */
export function copyToContainer(localPath: string, containerPath: string) {
  const { spawnSync } = require("child_process");
  try {
    execSync(`docker cp "${localPath}" ${H3_CONFIG.containerName}:"${containerPath}"`, { timeout: 30_000 });
  } catch {
    const fileContent = fs.readFileSync(localPath);
    const child = spawnSync("docker", ["exec", "-i", H3_CONFIG.containerName, "bash", "-c", `cat > "${containerPath}"`], {
      input: fileContent,
      timeout: 30_000,
    });
    if (child.status !== 0) throw new Error(child.stderr?.toString() || "docker exec failed");
  }
}

// ============================================================
// ffprobe / ffmpeg 辅助函数
// ============================================================

/** 用 ffprobe 提取视频总帧数 (优先 nb_frames, 回退 duration*fps)。失败返回 0。 */
export function probeFrameCount(localPath: string): number {
  // 1. 优先读容器元数据 nb_frames
  try {
    const out = execSync(
      `ffprobe -v error -select_streams v:0 -count_packets -show_entries stream=nb_read_packets -of csv=p=0 "${localPath}"`,
      { timeout: 30_000 },
    ).toString().trim();
    const n = parseInt(out, 10);
    if (!isNaN(n) && n > 0) return n;
  } catch {}
  // 2. 回退: duration * r_frame_rate
  try {
    const fpsOut = execSync(
      `ffprobe -v error -select_streams v:0 -show_entries stream=r_frame_rate -of csv=p=0 "${localPath}"`,
      { timeout: 30_000 },
    ).toString().trim();
    const durOut = execSync(
      `ffprobe -v error -select_streams v:0 -show_entries stream=duration -of csv=p=0 "${localPath}"`,
      { timeout: 30_000 },
    ).toString().trim();
    const [num, den] = fpsOut.split("/").map(Number);
    const fps = den && !isNaN(num) ? num / den : 24;
    const dur = parseFloat(durOut);
    if (!isNaN(dur) && dur > 0) return Math.round(dur * fps);
  } catch {}
  return 0;
}

/** 用 ffprobe 获取视频分辨率。失败返回 null。 */
function probeResolution(localPath: string): { width: number; height: number } | null {
  try {
    const out = execSync(
      `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "${localPath}"`,
      { timeout: 30_000 },
    ).toString().trim();
    const [w, h] = out.split(",").map((s) => parseInt(s.trim(), 10));
    if (!isNaN(w) && !isNaN(h) && w > 0 && h > 0) return { width: w, height: h };
  } catch {}
  return null;
}

/**
 * LTX-2.3 numFrames 需要 8n+1 对齐 (与 msr.ts roundTo8nPlus1 一致)。
 * 无帧数上限 (v9: 移除分段逻辑)。
 */
export function alignLtxFrames(raw: number): number {
  let n = Math.ceil((raw - 1) / 8) * 8 + 1;
  if (n < 9) n = 9; // 最小 9 帧 (8*1+1)
  return n;
}

/**
 * 用 ffmpeg re-encode 视频到目标分辨率 (如果原始分辨率不同)。
 * 同时用 -an 去除音频轨 (BGM 替换场景: 只需纯视频帧)。
 * 返回处理后的本地文件路径 (可能是原文件, 也可能是新文件)。
 */
export function ensureResolutionAndStripAudio(
  localPath: string,
  targetWidth: number,
  targetHeight: number,
): { path: string; reencoded: boolean } {
  const res = probeResolution(localPath);
  // 如果分辨率已匹配, 仍需 -an 去音频 → 统一 re-encode (成本低, 保证干净输入)
  // 但若无法探测分辨率, 直接 re-encode 保证安全
  const needsResize = !res || res.width !== targetWidth || res.height !== targetHeight;

  if (!needsResize) {
    // 分辨率匹配, 仅去除音频 (ffmpeg -an 快速拷贝视频流)
    const outPath = path.join(LOCAL_STAGING_DIR, `${uuidv4()}_video_only${path.extname(localPath) || ".mp4"}`);
    try {
      execSync(
        `ffmpeg -y -i "${localPath}" -an -c copy "${outPath}"`,
        { timeout: 120_000 },
      );
      return { path: outPath, reencoded: true };
    } catch {
      // -c copy 失败 (可能容器不支持), 回退 re-encode
      try { fs.unlinkSync(outPath); } catch {}
    }
  }

  // re-encode 到目标分辨率 + 去音频
  const outExt = ".mp4";
  const outPath = path.join(LOCAL_STAGING_DIR, `${uuidv4()}_resized${outExt}`);
  try {
    execSync(
      `ffmpeg -y -i "${localPath}" -an -vf "scale=${targetWidth}:${targetHeight}:flags=lanczos" -c:v libx264 -preset fast -crf 18 "${outPath}"`,
      { timeout: 300_000 },
    );
    return { path: outPath, reencoded: true };
  } catch (err: any) {
    try { fs.unlinkSync(outPath); } catch {}
    throw new Error(`ffmpeg re-encode failed: ${err.message}`);
  }
}

// ============================================================
// Workflow builder (v9: Foley LoRA + SolidMask + NAG)
// ============================================================
//
// 节点拓扑 (v9 方案 + NAG 链, API JSON 格式):
//
//   模型加载:
//     3:  UNETLoader (distilled transformer_only fp8)
//     10: LTX2LoraLoaderAdvanced (model=[3,0], Foley LoRA, video=0 audio=1)
//
//   NAG 链 (Negative Augmented Guidance — 采样阶段压制 BGM):
//     99:  PromptRelayEncode (model=[10,0], clip=[26,0], latent=[23,0])
//     121: LTX2_NAG (model=[99,0], nag_scale=11, nag_alpha=0.25, nag_tau=2.5)
//
//   文本:
//     26: DualCLIPLoader (gemma + text_projection, type="ltxv")
//     5:  CLIPTextEncode (positive)
//     6:  CLIPTextEncode (negative)
//     7:  LTXVConditioning (frame_rate=24)
//
//   VAE:
//     31: VAELoader (video VAE)
//     21: VAELoader (audio VAE)
//
//   视频潜在 (SolidMask 冻结):
//     100: VHS_LoadVideoFFmpeg (H3 视频, force_rate=24, resize 1280x704)
//     101: VHS_VAEEncodeBatched (pixels=[100,0], vae=[31,0])
//     102: SolidMask (value=0, width=40, height=22) ← latent space (1280/32 × 704/32)
//     103: SetLatentNoiseMask (samples=[101,0], mask=[102,0])
//         value=0 → 完全冻结视频 latent, 采样只影响音频
//
//   音频潜在 (ambient from scratch):
//     50: LTXVEmptyLatentAudio (frames_number, frame_rate=24, audio_vae=[21,0])
//
//   合并 AV:
//     23: LTXVConcatAVLatent (video_latent=[103,0], audio_latent=[50,0])
//
//   采样 (distilled: CFG=1.0, euler, 9 sigmas):
//     15: RandomNoise
//     27: ManualSigmas
//     13: KSamplerSelect (euler)
//     37: CFGGuider (model=[10,0], cfg=1.0)
//     16: SamplerCustomAdvanced
//
//   解码音频:
//     24: LTXVSeparateAVLatent (av_latent=[16,0])
//     25: LTXVAudioVAEDecode (samples=[24,1])
//     110: SaveAudio (filename_prefix)

interface LtxAmbientWorkflowOpts {
  /** 已上传到 ComfyUI 容器内的视频文件名 (VHS_LoadVideoFFmpeg 的 video 参数) */
  videoFilename: string;
  /** 正面提示词 (场景描述, 指导环境音生成) */
  prompt: string;
  /** 负面提示词 */
  negativePrompt: string;
  /** 帧数 (调用方应先 alignLtxFrames) */
  numFrames: number;
  /** 噪声种子 */
  seed: number;
  /** 输出音频文件名前缀 */
  filenamePrefix: string;
}

export function buildLtxAmbientWorkflow(opts: LtxAmbientWorkflowOpts): Record<string, any> {
  const { videoFilename, prompt, negativePrompt, numFrames, seed, filenamePrefix } = opts;

  // 强化版音频引导词 (参照 msr.ts AUDIO_GUIDES)
  // 用电影工业术语 diegetic vs non-diegetic 明确区分场内音 vs 配乐
  const SUBTITLE_NEG = "subtitles, captions, on-screen text, burned-in text, title cards, Chinese characters, hanzi, handwriting, calligraphy, written words";
  const AUDIO_POS = "strictly diegetic in-world ambient sound, on-location field recording, raw foley, natural room tone, wind, rustle, environmental texture, no scored music, no voices, unscored scene";
  const AUDIO_NEG = "non-diegetic audio, background music, BGM, soundtrack, musical score, underscore, theme music, cue, instrumentation, instruments, melody, harmony, chord progression, rhythm, beat, pulse, tempo, percussion, drums, bass, orchestra, electronic music, synthesizer, vocal melody, singing, hooks, drops, chorus, verse, bridge, intro, outro, leitmotif, jingle, speech, dialogue, voices, narration, any structured musical composition or arrangement, " + SUBTITLE_NEG;

  // 注入音频引导词到 prompt
  const enhancedPrompt = `${prompt}, ${AUDIO_POS}`;
  const enhancedNegative = `${negativePrompt}, ${AUDIO_NEG}`;

  // latent space 维度 (width/32 × height/32) — SolidMask 用
  const latentW = LTX_AMBIENT.width / 32;   // 40
  const latentH = LTX_AMBIENT.height / 32;  // 22

  return {
    // === 模型加载 ===
    // 3: UNETLoader (distilled transformer_only fp8)
    "3": {
      class_type: "UNETLoader",
      inputs: {
        unet_name: LTX_AMBIENT.modelName,
        weight_dtype: "default",
      },
    },
    // 10: LTX2LoraLoaderAdvanced (Foley LoRA — 精确控制 video/audio 层强度)
    //    video=0: 不影响视频生成; audio=1: 增强音频; video_to_audio=1: 跨注意力
    "10": {
      class_type: "LTX2LoraLoaderAdvanced",
      inputs: {
        model: ["3", 0],
        lora_name: LTX_AMBIENT.foleyLoraName,
        strength_model: LTX_AMBIENT.foleyLoraStrength,
        video: 0.0,
        video_to_audio: 1.0,
        audio: 1.0,
        audio_to_video: 0.0,
        other: 1.0,
      },
    },

    // === NAG 链 (Negative Augmented Guidance — 采样阶段压制 BGM) ===
    // 99: PromptRelayEncode (将模型+CLIP+latent 包装为 relay 模型)
    "99": {
      class_type: "PromptRelayEncode",
      inputs: {
        model: ["10", 0],
        clip: ["26", 0],
        latent: ["23", 0],
        global_prompt: prompt,
        local_prompts: enhancedPrompt,
        segment_lengths: "",
        epsilon: 0.0022,
      },
    },
    // 121: LTX2_NAG (NAG 包装 — 强化 negative prompt 对 BGM 的压制)
    "121": {
      class_type: "LTX2_NAG",
      inputs: {
        model: ["99", 0],
        nag_scale: LTX_AMBIENT.nagScale,
        nag_alpha: LTX_AMBIENT.nagAlpha,
        nag_tau: LTX_AMBIENT.nagTau,
        nag_cond_video: ["7", 1],
        nag_cond_audio: ["7", 1],
        inplace: true,
      },
    },

    // === 文本编码 ===
    // 26: DualCLIPLoader (gemma + text_projection, type="ltxv")
    "26": {
      class_type: "DualCLIPLoader",
      inputs: {
        clip_name1: LTX_AMBIENT.clipName1,
        clip_name2: LTX_AMBIENT.clipName2,
        type: "ltxv",
      },
    },
    // 5: CLIPTextEncode (positive — 注入音频正面引导词)
    "5": {
      class_type: "CLIPTextEncode",
      inputs: {
        clip: ["26", 0],
        text: enhancedPrompt,
      },
    },
    // 6: CLIPTextEncode (negative — 注入音频负面引导词)
    "6": {
      class_type: "CLIPTextEncode",
      inputs: {
        clip: ["26", 0],
        text: enhancedNegative,
      },
    },
    // 7: LTXVConditioning
    "7": {
      class_type: "LTXVConditioning",
      inputs: {
        positive: ["5", 0],
        negative: ["6", 0],
        frame_rate: LTX_AMBIENT.frameRate,
      },
    },

    // === VAE ===
    // 31: VAELoader (video VAE)
    "31": {
      class_type: "VAELoader",
      inputs: { vae_name: LTX_AMBIENT.videoVaeName },
    },
    // 21: VAELoader (audio VAE)
    "21": {
      class_type: "VAELoader",
      inputs: { vae_name: LTX_AMBIENT.audioVaeName },
    },

    // === 视频潜在 (SolidMask 冻结) ===
    // 100: VHS_LoadVideoFFmpeg (H3 视频帧)
    //     注意: VHS_LoadVideoFFmpeg 不支持 skip_first_frames, 用 start_time (秒级浮点)
    "100": {
      class_type: "VHS_LoadVideoFFmpeg",
      inputs: {
        video: videoFilename,
        force_rate: LTX_AMBIENT.frameRate,
        custom_width: LTX_AMBIENT.width,
        custom_height: LTX_AMBIENT.height,
        frame_load_cap: numFrames,
        start_time: 0,
      },
    },
    // 101: VHS_VAEEncodeBatched (视频帧 → latent)
    "101": {
      class_type: "VHS_VAEEncodeBatched",
      inputs: {
        pixels: ["100", 0],
        vae: ["31", 0],
        per_batch: numFrames,
      },
    },
    // 102: SolidMask (value=0 → 完全冻结视频 latent, 采样只生成音频)
    //     尺寸 = latent space (width/32 × height/32)
    "102": {
      class_type: "SolidMask",
      inputs: {
        value: 0,
        width: latentW,
        height: latentH,
      },
    },
    // 103: SetLatentNoiseMask (将 SolidMask 应用到视频 latent)
    "103": {
      class_type: "SetLatentNoiseMask",
      inputs: {
        samples: ["101", 0],
        mask: ["102", 0],
      },
    },

    // === 音频潜在 (ambient from scratch) ===
    // 50: LTXVEmptyLatentAudio
    "50": {
      class_type: "LTXVEmptyLatentAudio",
      inputs: {
        frames_number: numFrames,
        frame_rate: LTX_AMBIENT.frameRate,
        batch_size: 1,
        audio_vae: ["21", 0],
      },
    },

    // === 合并 AV ===
    // 23: LTXVConcatAVLatent (video_latent=[103,0] frozen, audio_latent=[50,0])
    "23": {
      class_type: "LTXVConcatAVLatent",
      inputs: {
        video_latent: ["103", 0],
        audio_latent: ["50", 0],
      },
    },

    // === 采样 (distilled: CFG=1.0, euler, 9 sigmas) ===
    // 15: RandomNoise
    "15": {
      class_type: "RandomNoise",
      inputs: { noise_seed: seed },
    },
    // 27: ManualSigmas (蒸馏模型专用 9 步调度)
    "27": {
      class_type: "ManualSigmas",
      inputs: { sigmas: LTX_AMBIENT.sigmas },
    },
    // 13: KSamplerSelect (euler)
    "13": {
      class_type: "KSamplerSelect",
      inputs: { sampler_name: LTX_AMBIENT.samplerName },
    },
    // 37: CFGGuider (model=[121,0] NAG-wrapped, cfg=1.0)
    "37": {
      class_type: "CFGGuider",
      inputs: {
        model: ["121", 0],
        positive: ["7", 0],
        negative: ["7", 1],
        cfg: LTX_AMBIENT.cfg,
      },
    },
    // 16: SamplerCustomAdvanced
    "16": {
      class_type: "SamplerCustomAdvanced",
      inputs: {
        noise: ["15", 0],
        guider: ["37", 0],
        sampler: ["13", 0],
        sigmas: ["27", 0],
        latent_image: ["23", 0],
      },
    },

    // === 解码音频 ===
    // 24: LTXVSeparateAVLatent
    "24": {
      class_type: "LTXVSeparateAVLatent",
      inputs: { av_latent: ["16", 0] },
    },
    // 25: LTXVAudioVAEDecode (samples=[24,1] 音频 latent)
    "25": {
      class_type: "LTXVAudioVAEDecode",
      inputs: {
        samples: ["24", 1],
        audio_vae: ["21", 0],
      },
    },
    // 110: SaveAudio
    "110": {
      class_type: "SaveAudio",
      inputs: {
        audio: ["25", 0],
        filename_prefix: filenamePrefix,
      },
    },
  };
}

// ============================================================
// Handler
// ============================================================

// ============================================================
// 轮询辅助: 等待 ComfyUI 任务完成, 返回音频 outputs
// ============================================================

export async function pollComfyuiCompletion(
  comfyuiUrl: string,
  promptId: string,
  timeoutMs: number = 600_000,
): Promise<{ ok: true; outputs: any } | { ok: false; error: string }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const resp = await axios.get(`${comfyuiUrl}/history/${promptId}`, { timeout: 15_000 });
      const history = resp.data;
      const entry = history?.[promptId];
      if (entry) {
        const s = entry.status;
        if (s?.status_str === "success" && entry.outputs) {
          return { ok: true, outputs: entry.outputs };
        }
        if (s?.status_str === "error") {
          let errMsg = "unknown error";
          for (const m of s.messages || []) {
            if (m[0] === "execution_error") {
              errMsg = m[1]?.exception_message || JSON.stringify(m[1]);
            }
          }
          return { ok: false, error: errMsg };
        }
      }
    } catch {
      // network hiccup, keep polling
    }
    await new Promise((r) => setTimeout(r, 3_000));
  }
  return { ok: false, error: "polling timeout" };
}

// ============================================================
// 从 ComfyUI outputs 中提取音频文件信息并下载到本地
// ============================================================

export async function downloadAudioFromOutputs(
  comfyuiUrl: string,
  outputs: any,
  localDestPath: string,
): Promise<boolean> {
  for (const nodeId of Object.keys(outputs)) {
    const nodeOut = outputs[nodeId];
    if (nodeOut.audio) {
      for (const aud of nodeOut.audio) {
        const url = `${comfyuiUrl}/view?filename=${aud.filename}&subfolder=${aud.subfolder || ""}&type=${aud.type || "output"}`;
        const resp = await axios.get(url, { responseType: "arraybuffer", timeout: 120_000 });
        fs.writeFileSync(localDestPath, Buffer.from(resp.data));
        return true;
      }
    }
  }
  return false;
}

// ============================================================
// 从 ComfyUI outputs 中提取视频文件并下载到本地
// ============================================================
//
// ComfyUI 不同保存节点的输出键不同:
//   - SaveVideo (ComfyUI 核心, H3 工作流用) → outputs[node].videos
//   - VHS_VideoCombine                              → outputs[node].gifs (即使是 mp4)
//   - 部分老节点                                     → outputs[node].images
// 本函数按 videos → gifs → images 顺序查找首个视频文件并下载。
//
// 返回下载到本地的 ComfyUI 文件名 (含扩展名); 未找到返回 null。

export async function downloadVideoFromOutputs(
  comfyuiUrl: string,
  outputs: any,
  localDestPath: string,
): Promise<string | null> {
  for (const nodeId of Object.keys(outputs)) {
    const nodeOut = outputs[nodeId];
    // 按优先级检查三种可能的输出键
    for (const key of ["videos", "gifs", "images"]) {
      const list = nodeOut[key];
      if (Array.isArray(list) && list.length > 0) {
        const vid = list[0];
        const url =
          `${comfyuiUrl}/view?filename=${encodeURIComponent(vid.filename)}` +
          `&subfolder=${encodeURIComponent(vid.subfolder || "")}` +
          `&type=${encodeURIComponent(vid.type || "output")}`;
        const resp = await axios.get(url, { responseType: "arraybuffer", timeout: 300_000 });
        fs.writeFileSync(localDestPath, Buffer.from(resp.data));
        return vid.filename as string;
      }
    }
  }
  return null;
}

// ============================================================
// TTS + 环境音混音 + 视频合成 (参照 msr.ts 两轨混音模式)
// ============================================================

export function mergeAudioAndVideo(
  videoPath: string,
  ttsAudioPath: string | null,
  ambientAudioPath: string,
  outputPath: string,
): void {
  if (ttsAudioPath && fs.existsSync(ttsAudioPath)) {
    // 两轨混音: TTS (对白) + ambient (环境音)
    // TTS 提升 3dB, ambient 降低 6dB, 防止对白被环境音盖住
    const mixedAudio = outputPath.replace(/\.mp4$/, "_mixed.aac");
    execSync(
      `ffmpeg -y -i "${ttsAudioPath}" -i "${ambientAudioPath}" ` +
      `-filter_complex "[0:a]volume=1.4[tts];[1:a]volume=0.5[amb];[tts][amb]amix=inputs=2:duration=first:weights=1 1:normalize=0[mix]" ` +
      `-map "[mix]" -c:a aac -b:a 192k "${mixedAudio}"`,
      { timeout: 60_000 },
    );
    // 合并视频 + 混合音频
    execSync(
      `ffmpeg -y -i "${videoPath}" -i "${mixedAudio}" ` +
      `-map 0:v:0 -map 1:a:0 -af "apad" -c:v copy -c:a aac -b:a 192k -shortest "${outputPath}"`,
      { timeout: 60_000 },
    );
    try { fs.unlinkSync(mixedAudio); } catch {}
  } else {
    // 无 TTS, 直接合并视频 + 环境音
    execSync(
      `ffmpeg -y -i "${videoPath}" -i "${ambientAudioPath}" ` +
      `-map 0:v:0 -map 1:a:0 -af "apad" -c:v copy -c:a aac -b:a 192k -shortest "${outputPath}"`,
      { timeout: 60_000 },
    );
  }
}

// ============================================================
// BGM 残留检测 (频谱分析: tonal_ratio + mid_freq 占比)
// ============================================================

export interface BgmDetectResult {
  hasBgm: boolean;
  risk: "LOW" | "MEDIUM" | "HIGH";
  suspectSegments: number;
  totalSegments: number;
  details: Array<{ time: number; rms_db: number; tonal_ratio: number; mid_pct: number }>;
}

/**
 * 用 ffmpeg + numpy FFT 频谱分析检测音频中是否残留 BGM。
 * 原理: BGM 通常有持续的高 tonal_ratio (>0.15) 和中频占比 (>0.4)。
 * 实现: 转换到 WAV → 调用 python3 执行 FFT 分析。
 */
export function detectBgm(audioPath: string): BgmDetectResult {
  const pyScript = `
import sys, json
import numpy as np
from scipy.io import wavfile

sr, data = wavfile.read(sys.argv[1])
if data.ndim > 1:
    data = data.mean(axis=1)
data = data.astype(float)

seg_len = int(sr * 1.0)
n_segs = max(1, len(data) // seg_len)

segments = []
bgm_suspect = 0
for i in range(n_segs):
    seg = data[i*seg_len:(i+1)*seg_len]
    if len(seg) < 256:
        continue
    freqs = np.fft.rfftfreq(len(seg), 1/sr)
    spectrum = np.abs(np.fft.rfft(seg))
    low = np.sum(spectrum[(freqs < 200)])
    mid = np.sum(spectrum[(freqs >= 200) & (freqs < 2000)])
    high = np.sum(spectrum[(freqs >= 2000)])
    total = low + mid + high + 1e-10
    spec_smooth = np.convolve(spectrum, np.ones(50)/50, mode='same')
    peaks = spectrum > spec_smooth * 3
    tonal_ratio = float(np.sum(spectrum[peaks]) / (np.sum(spectrum) + 1e-10))
    seg_rms = float(np.sqrt(np.mean(seg**2)))
    seg_rms_db = float(20 * np.log10(max(seg_rms, 1e-10)))
    mid_pct = float(mid / total)
    segments.append({"time": float(i), "rms_db": seg_rms_db, "tonal_ratio": tonal_ratio, "mid_pct": mid_pct})
    if tonal_ratio > 0.15 and mid_pct > 0.4:
        bgm_suspect += 1

risk = "HIGH" if bgm_suspect >= n_segs * 0.5 else ("MEDIUM" if bgm_suspect > 0 else "LOW")
print(json.dumps({"hasBgm": bgm_suspect > 0, "risk": risk, "suspectSegments": bgm_suspect, "totalSegments": n_segs, "details": segments}))
`;

  const scriptPath = path.join(LOCAL_STAGING_DIR, "_bgm_detect.py");
  fs.writeFileSync(scriptPath, pyScript);

  const wavPath = audioPath.replace(/\.\w+$/, "_detect.wav");
  try {
    execSync(`ffmpeg -y -i "${audioPath}" -ar 48000 -ac 1 "${wavPath}"`, { timeout: 30_000 });
  } catch {
    return { hasBgm: false, risk: "LOW", suspectSegments: 0, totalSegments: 0, details: [] };
  }

  try {
    const out = execSync(`python3 "${scriptPath}" "${wavPath}"`, { timeout: 60_000 }).toString().trim();
    try { fs.unlinkSync(wavPath); } catch {}
    return JSON.parse(out) as BgmDetectResult;
  } catch {
    try { fs.unlinkSync(wavPath); } catch {}
    return { hasBgm: false, risk: "LOW", suspectSegments: 0, totalSegments: 0, details: [] };
  }
}

// ============================================================
// Handler (v9: Foley LoRA + SolidMask + NAG + BGM 检测重试)
// ============================================================

export default router.post(
  "/",
  upload.fields([
    { name: "video", maxCount: 1 },    // H3 生成的视频文件 (required)
    { name: "ttsAudio", maxCount: 1 }, // TTS 对白音频 (optional)
  ]),
  validateFields({
    projectId: z.coerce.number(),
    prompt: z.string().min(1),
  }),
  async (req, res) => {
    const projectId = req.body.projectId;
    const prompt = req.body.prompt as string;
    const negativePrompt =
      (req.body.negativePrompt as string) || LTX_AMBIENT.defaultNegativePrompt;
    const seed = req.body.seed ? Number(req.body.seed) : LTX_AMBIENT.defaultSeed;
    // autoMerge=true: 同步等待 LTX 完成后自动合并 TTS + 环境音 + 视频, 直接返回最终 mp4
    // autoMerge=false (默认): 异步模式, 返回 promptId 让客户端轮询
    const autoMerge = req.body.autoMerge === "true" || req.body.autoMerge === true;
    const filenamePrefix =
      (req.body.filenamePrefix as string) ||
      `h3_replace_audio_${projectId}_${Date.now()}`;

    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    const videoFile = files?.video?.[0];
    const ttsAudioFile = files?.ttsAudio?.[0];

    if (!videoFile) {
      return res.status(400).send(error("video file is required"));
    }

    // ─── 1. 视频预处理: re-encode 到 1280x704 + 去音频 (-an) ───────────
    let processedVideoPath: string;
    let reencodedPath: string | null = null;
    try {
      const result = ensureResolutionAndStripAudio(
        videoFile.path,
        LTX_AMBIENT.width,
        LTX_AMBIENT.height,
      );
      processedVideoPath = result.path;
      if (result.reencoded) reencodedPath = result.path;
    } catch (err: any) {
      try { fs.unlinkSync(videoFile.path); } catch {}
      return res
        .status(400)
        .send(error(`Video preprocessing failed (ffmpeg): ${err.message}`));
    }
    try { fs.unlinkSync(videoFile.path); } catch {}

    // ─── 2. 帧数自动计算: ffprobe → 8n+1 对齐 (无上限) ────────────────
    let rawFrames = probeFrameCount(processedVideoPath);
    if (rawFrames <= 0) rawFrames = 97;
    const numFrames = alignLtxFrames(rawFrames);

    // ─── 3. 上传处理后的视频到 ComfyUI 容器 ──────────────────────────
    const videoExt = path.extname(videoFile.originalname || ".mp4") || ".mp4";
    const videoContainerFilename = `${uuidv4()}_h3video${videoExt}`;
    const videoContainerPath = `${H3_CONFIG.comfyuiInputDir}/${videoContainerFilename}`;
    try {
      copyToContainer(processedVideoPath, videoContainerPath);
    } catch (err: any) {
      if (reencodedPath) { try { fs.unlinkSync(reencodedPath); } catch {} }
      return res
        .status(502)
        .send(error(`Failed to upload video to ComfyUI: ${err.message}`));
    }

    // 保存本地纯视频路径 (autoMerge 时合并用)
    const localPureVideo = processedVideoPath;
    // 如果 reencodedPath 存在说明 processedVideoPath 是临时文件, autoMerge 模式需要保留
    // 如果不存在说明 processedVideoPath == 原文件(已被删), 需要从容器拉回
    if (!autoMerge) {
      if (reencodedPath) { try { fs.unlinkSync(reencodedPath); } catch {} }
    }

    // ─── 4. (可选) 保存 TTS 对白音频到本地 (autoMerge 时合并用) ────────
    let localTtsAudio: string | null = null;
    if (ttsAudioFile) {
      if (autoMerge) {
        // autoMerge 模式: 保留本地副本供合并用
        localTtsAudio = ttsAudioFile.path;
      } else {
        // 异步模式: 上传到容器供客户端后续取用
        const ttsExt = path.extname(ttsAudioFile.originalname || ".wav") || ".wav";
        const ttsContainerFilename = `${uuidv4()}_tts${ttsExt}`;
        const ttsContainerPath = `${H3_CONFIG.comfyuiInputDir}/${ttsContainerFilename}`;
        try {
          copyToContainer(ttsAudioFile.path, ttsContainerPath);
        } catch (err: any) {
          try { fs.unlinkSync(ttsAudioFile.path); } catch {}
          return res
            .status(502)
            .send(error(`Failed to upload TTS audio to ComfyUI: ${err.message}`));
        }
        try { fs.unlinkSync(ttsAudioFile.path); } catch {}
      }
    }

    // ─── 5. 构建 + 提交 LTX 环境音工作流 (单段, 无分段) ────────────────
    const wf = buildLtxAmbientWorkflow({
      videoFilename: videoContainerFilename,
      prompt,
      negativePrompt,
      numFrames,
      seed,
      filenamePrefix,
    });

    try {
      const comfyRes = await axios.post(
        `${H3_CONFIG.comfyuiUrl}/prompt`,
        { prompt: wf },
        { timeout: 30_000, validateStatus: (s: number) => s < 500 },
      );

      if (comfyRes.status !== 200) {
        return res
          .status(502)
          .send(error(`ComfyUI rejected prompt: ${JSON.stringify(comfyRes.data)}`));
      }

      const promptId = comfyRes.data.prompt_id as string;

      // ─── 异步模式: 立即返回 promptId ──────────────────────────────
      if (!autoMerge) {
        if (localTtsAudio) { try { fs.unlinkSync(localTtsAudio); } catch {} }
        return res.status(200).send(
          success({
            promptId,
            status: "submitted",
            estimatedTime: "2-5 min",
            pollUrl: `/api/production/minimax-h3/status/${promptId}`,
            params: {
              width: LTX_AMBIENT.width,
              height: LTX_AMBIENT.height,
              numFrames,
              rawFrames,
              fps: LTX_AMBIENT.frameRate,
              seed,
              cfg: LTX_AMBIENT.cfg,
              sampler: LTX_AMBIENT.samplerName,
              model: LTX_AMBIENT.modelName,
              foleyLora: LTX_AMBIENT.foleyLoraName,
            },
            hasTts: !!ttsAudioFile,
            message: "LTX ambient task submitted",
          }),
        );
      }

      // ─── autoMerge 模式: 等待完成 → 下载音频 → 合并视频 ─────────────
      const poll = await pollComfyuiCompletion(H3_CONFIG.comfyuiUrl, promptId, 600_000);
      if (!poll.ok) {
        if (localPureVideo && reencodedPath) { try { fs.unlinkSync(localPureVideo); } catch {} }
        if (localTtsAudio) { try { fs.unlinkSync(localTtsAudio); } catch {} }
        return res.status(502).send(error(`LTX ambient generation failed: ${poll.error}`));
      }

      // 下载生成的环境音
      const ambientAudioPath = path.join(LOCAL_STAGING_DIR, `${promptId}_ambient.flac`);
      const found = await downloadAudioFromOutputs(H3_CONFIG.comfyuiUrl, poll.outputs, ambientAudioPath);

      if (!found || !fs.existsSync(ambientAudioPath)) {
        if (localPureVideo && reencodedPath) { try { fs.unlinkSync(localPureVideo); } catch {} }
        if (localTtsAudio) { try { fs.unlinkSync(localTtsAudio); } catch {} }
        return res.status(502).send(error("Failed to produce ambient audio"));
      }

      // ─── BGM 检测 + 重试 (autoMerge 模式) ──────────────────────────────
      let currentSeed = seed;
      let bestAmbientPath = ambientAudioPath;
      let bgmResult = detectBgm(ambientAudioPath);
      let bgmRetries = 0;

      while (bgmResult.hasBgm && bgmRetries < LTX_AMBIENT.bgmMaxRetries) {
        bgmRetries++;
        currentSeed = seed + bgmRetries * 1000;
        console.log(
          `[replace-audio] BGM detected (risk=${bgmResult.risk}, ` +
          `${bgmResult.suspectSegments}/${bgmResult.totalSegments} segs), ` +
          `retry ${bgmRetries}/${LTX_AMBIENT.bgmMaxRetries} seed=${currentSeed}`,
        );

        // 重新构建 + 提交 (新 seed)
        const retryWf = buildLtxAmbientWorkflow({
          videoFilename: videoContainerFilename,
          prompt,
          negativePrompt,
          numFrames,
          seed: currentSeed,
          filenamePrefix: `${filenamePrefix}_retry${bgmRetries}`,
        });

        const retryRes = await axios.post(
          `${H3_CONFIG.comfyuiUrl}/prompt`,
          { prompt: retryWf },
          { timeout: 30_000, validateStatus: (s: number) => s < 500 },
        );
        if (retryRes.status !== 200) break;

        const retryPoll = await pollComfyuiCompletion(
          H3_CONFIG.comfyuiUrl, retryRes.data.prompt_id, 600_000,
        );
        if (!retryPoll.ok) break;

        const retryAudioPath = path.join(
          LOCAL_STAGING_DIR, `${retryRes.data.prompt_id}_ambient_retry${bgmRetries}.flac`,
        );
        const retryFound = await downloadAudioFromOutputs(
          H3_CONFIG.comfyuiUrl, retryPoll.outputs, retryAudioPath,
        );
        if (!retryFound) break;

        const retryBgm = detectBgm(retryAudioPath);
        console.log(
          `[replace-audio] Retry ${bgmRetries}: risk=${retryBgm.risk}, ` +
          `${retryBgm.suspectSegments}/${retryBgm.totalSegments} segs`,
        );

        // 只有改善时才用新音频
        if (retryBgm.suspectSegments < bgmResult.suspectSegments) {
          try { fs.unlinkSync(bestAmbientPath); } catch {}
          bestAmbientPath = retryAudioPath;
          bgmResult = retryBgm;
          if (!retryBgm.hasBgm || retryBgm.risk === "LOW") break;
        } else {
          try { fs.unlinkSync(retryAudioPath); } catch {}
          break; // 没有改善, 放弃
        }
      }

      // 合并: 视频 + (可选 TTS) + 环境音
      const finalOutputPath = path.join(H3_CONFIG.outputDir, `${filenamePrefix}_final.mp4`);
      try {
        fs.mkdirSync(path.dirname(finalOutputPath), { recursive: true });
      } catch {}

      mergeAudioAndVideo(
        localPureVideo,
        localTtsAudio,
        bestAmbientPath,
        finalOutputPath,
      );

      // 清理临时文件
      if (localPureVideo && reencodedPath) { try { fs.unlinkSync(localPureVideo); } catch {} }
      if (localTtsAudio) { try { fs.unlinkSync(localTtsAudio); } catch {} }
      try { fs.unlinkSync(bestAmbientPath); } catch {}

      const outputUrl = `/mnt/agents/output/${filenamePrefix}_final.mp4`;

      res.status(200).send(
        success({
          promptId,
          status: "completed",
          hasTts: !!ttsAudioFile,
          output: {
            videoUrl: outputUrl,
            videoPath: finalOutputPath,
            numFrames,
            rawFrames,
            model: LTX_AMBIENT.modelName,
            foleyLora: LTX_AMBIENT.foleyLoraName,
          },
          bgmDetection: {
            risk: bgmResult.risk,
            suspectSegments: bgmResult.suspectSegments,
            totalSegments: bgmResult.totalSegments,
            retries: bgmRetries,
            finalSeed: currentSeed,
          },
          message: "H3 video + LTX ambient merged successfully",
        }),
      );
    } catch (err: any) {
      const msg =
        err.response?.data?.error?.message ||
        err.response?.data?.node_errors ||
        err.message ||
        String(err);
      res.status(502).send(error(`ComfyUI request failed: ${msg}`));
    }
  },
);
