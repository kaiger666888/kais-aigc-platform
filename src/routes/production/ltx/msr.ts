import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import axios from "axios";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { VramInsufficientError, withGpuQueue, withGpuQueueTimed } from "@/lib/gpuVramManager";
import { LTX_CONFIG, LTX_DEFAULTS, LTX_POSE, LTX_MSR_V2, LTX_MSR_LAST_FRAME, LTX_MSR_FIRST_FRAME, LTX_MSR_FOLEY, AudioStrategy, AUDIO_STRATEGY_INFO } from "./config";

const router = express.Router();

const LOCAL_STAGING_DIR = "/tmp/comfyui-ltx-input";
if (!fs.existsSync(LOCAL_STAGING_DIR)) {
  fs.mkdirSync(LOCAL_STAGING_DIR, { recursive: true });
}

const upload = multer({ dest: LOCAL_STAGING_DIR });

function copyToContainer(localPath: string, containerPath: string) {
  const { execSync, spawnSync } = require("child_process");
  try {
    execSync(`docker cp "${localPath}" ${LTX_CONFIG.containerName}:"${containerPath}"`, { timeout: 30_000 });
  } catch {
    const fileContent = fs.readFileSync(localPath);
    const child = spawnSync("docker", ["exec", "-i", LTX_CONFIG.containerName, "bash", "-c", `cat > "${containerPath}"`], {
      input: fileContent,
      timeout: 30_000,
    });
    if (child.status !== 0) throw new Error(child.stderr?.toString() || "docker exec failed");
  }
}

/**
 * LiconMSR 的 frame_count 必须是 [17, 25, 33, 41] 之一。
 * 这是参考图序列长度，不是视频时长。
 * 视频时长由 EmptyLTXVLatentVideo.length 控制。
 */
const MSR_FRAME_COUNTS = [17, 25, 33, 41];

function pickMSRFrameCount(_refImageCount: number): number {
  // fc=41 is the default: it provides the strongest identity conditioning
  // by repeating each reference image more times in the conditioning sequence.
  // Validated via A/B test (2026-07-01): fc=41 produces better consistency
  // than fc=17 with negligible extra trim cost.
  return MSR_FRAME_COUNTS[MSR_FRAME_COUNTS.length - 1]; // always 41
}

/**
 * Calculate how many leading frames to trim from an LTX MSR raw video.
 *
 * LiconMSR repeats N reference images into msr_fc conditioning frames.
 * The last reference image switch + one VAE temporal unit (8 frames)
 * marks the boundary between static conditioning and generated content.
 *
 * @param numRefs - Number of reference images (2-5)
 * @param msrFc - LiconMSR frame_count (17, 25, 33, or 41)
 * @param vaeTemporalFactor - LTX VAE temporal compression factor (always 8)
 * @returns Number of leading frames to skip
 */
export function calcTrimFrames(
  numRefs: number,
  msrFc: number,
  vaeTemporalFactor: number = 8,
): number {
  const base = Math.floor(msrFc / numRefs);
  const remainder = msrFc % numRefs;
  const repeats: number[] = [];
  for (let i = 0; i < numRefs; i++) {
    repeats.push(base + (i < remainder ? 1 : 0));
  }
  const lastSwitch = repeats.slice(0, -1).reduce((a, b) => a + b, 0) + 1;
  return lastSwitch + vaeTemporalFactor;
}

// LTX-2.3 numFrames 需要 8n+1
function roundTo8nPlus1(raw: number): number {
  return Math.ceil((raw - 1) / 8) * 8 + 1;
}

// === Audio strategy → audioMode mapping (业务语义层 → 实现层) ===

interface MSRParams {
  // 已上传到 ComfyUI 容器的资产
  refFilenames: string[];
  customAudioFilename?: string;
  poseFrameFilename?: string;
  poseVideoFilename?: string;
  lastFrameFilename?: string;     // 尾帧图像(已在 ComfyUI 容器内),首尾帧-尾帧
  lastFrameStrength?: number;
  firstFrameFilename?: string;    // 首帧图像(有人物,已在容器内),首尾帧-首帧
  firstFrameStrength?: number;
  firstFrameIdx?: number;         // 首帧注入点覆盖(方案B 用 msrFrameCount+1=42 避开条件段;留空走默认)
  stage2PromptSuffix?: string;    // 仅 Stage 2 追加的对口型标注(谁说话+台词+嘴型同步),绝不进 Stage 3
  foleyPrompt?: string;           // 仅 foley_v2a:Foley V2A 环境音提示词(缺省用 LTX_MSR_FOLEY.defaultPrompt;画面是强条件)
  // 业务输入
  prompt: string;
  negativePrompt: string;
  refDescription?: string;
  width: number; height: number;
  numFrames: number; msrFrameCount: number;
  fps: number; seed: number;
  filenamePrefix: string;
  duration: number;
  poseGuideStrength?: number;
  dialogueEndTime?: number;
  // 用户接口层(优先级:audioStrategy > audioMode > 智能默认)
  audioStrategy?: AudioStrategy;
  audioMode?: string;
  // V2 参数
  useV2?: boolean;
  nagWeight?: number; nagLayers?: number; nagSigmaStart?: number;
  relayWeight?: number;
  msrLoraVersion?: string;
  // 元数据
  refCount: number;
  outputDir?: string;
  outputFilename: string;  // parseAndUploadAssets 保证有默认值
}

/**
 * 业务策略 → 实现层 audioMode 的映射。
 * 仅 mapStrategyToMode 知道 5stage / foley / v1 / v2 这些实现细节,用户只看到语义层。
 */
function mapStrategyToMode(strategy: AudioStrategy, ctx: { dialogueEndTime?: number }): string {
  switch (strategy) {
    case "tts":
      // dialogueEndTime 提供 → 5-stage(对话保真 + 丰富环境,主推荐)
      // dialogueEndTime 缺失 → v1 全段冻结(旁白贯穿场景,省一次 LTX pass)
      return (ctx.dialogueEndTime && ctx.dialogueEndTime > 0) ? "5stage_pipeline" : "dialogue+ambient";
    case "foley": return "foley_v2a";   // v1单pass口型画面 → Foley V2A 环境 → 混音(解耦,BGM/渗漏根治)
    case "ambient": return "ambient_only";
    case "silent":  return "silent";
  }
}

/**
 * 3 层优先级解析最终的 audioMode:
 *   1. audioStrategy(用户业务语义,新接口)→ mapStrategyToMode
 *   2. audioMode(高级/向后兼容,显式指定)
 *   3. 智能默认(无任何指定时按资产自动选)
 * 返回 mode + 是否有 strategy/mode 冲突(用于响应 warning)。
 */
function resolveAudioMode(params: MSRParams): { mode: string; conflict: boolean } {
  if (params.audioStrategy) {
    const mapped = mapStrategyToMode(params.audioStrategy, { dialogueEndTime: params.dialogueEndTime });
    const conflict = !!params.audioMode && params.audioMode !== mapped;
    return { mode: mapped, conflict };
  }
  if (params.audioMode) return { mode: params.audioMode, conflict: false };
  // 智能默认(保留 pre-refactor 行为,向后兼容)
  if (params.customAudioFilename && params.dialogueEndTime && params.dialogueEndTime > 0) {
    return { mode: "5stage_pipeline", conflict: false };
  }
  if (params.customAudioFilename) return { mode: "dialogue+ambient", conflict: false };
  return { mode: "silent", conflict: false };
}

/**
 * Build LiconMSR workflow — 支持最多5张参考图 (ref1~ref4 + background)。
 *
 * V2 升级 (2026-07-12): 新增 PromptRelayEncode + LTX2_NAG 链路。
 * - PromptRelayEncode: 分离角色描述与动作描述，用 relay weight 注入参考图 identity
 * - LTX2_NAG: Normal Attention Guidance，用 negative prompt 引导注意力提升一致性
 *
 * 模型链变化:
 *   V1: Checkpoint → IC-LoRA → (Pose IC-LoRA) → CFGGuider
 *   V2: Checkpoint → IC-LoRA → PromptRelayEncode → LTX2_NAG → (Pose IC-LoRA) → CFGGuider
 */
export function buildMSRWorkflow(opts: {
  refFilenames: string[];       // 1~5 images: [ref1, ref2, ..., refN] (最后一张作为 background)
  prompt: string;               // action/scene prompt (what happens in the video)
  negativePrompt: string;
  refDescription?: string;      // V2: 参考图角色/场景描述 (for PromptRelayEncode)
  width: number;
  height: number;
  numFrames: number;
  msrFrameCount: number;
  fps: number;
  seed: number;
  filenamePrefix: string;
  poseFrameFilename?: string;   // optional: skeleton/pose render PNG for dual-conditioning (single frame)
  poseVideoFilename?: string;   // optional: skeleton/pose render MP4 for video pose conditioning (multi frame)
  poseGuideStrength?: number;   // optional: pose guide attention strength (default LTX_POSE.poseGuideStrength)
  // V2 options
  useV2?: boolean;              // enable PromptRelay + NAG (default: true)
  nagWeight?: number;           // NAG strength (default 0.25)
  nagLayers?: number;           // NAG attention layers (default 11)
  nagSigmaStart?: number;       // NAG sigma start (default 2.5)
  relayWeight?: number;         // PromptRelay weight (default 0.0022)
  msrLoraVersion?: string;      // LoRA version: "V2" (default), "V1", "test"
  audioMode?: string;           // "dialogue+ambient" (default, SolidMask 全冻结), "dialogue+ambient_v2" (partial-mask, 对话冻结 + 环境生成), "5stage_pipeline" (2 次 LTX pass + ffmpeg 混合,丰富环境声), "ambient_only", "silent", "auto"
  customAudioFilename?: string; // 自定义音频文件名（已在ComfyUI容器内），提供时冻结该音频到输出视频
  dialogueEndTime?: number;     // v2 partial-mask 模式专用:对话结束时间(秒),之后模型自由生成环境声。不传默认 0(等同 v1)
  stage3Ambient?: boolean;      // 内部参数:5-stage pipeline 的 Stage 3 ambient 生成 pass。audio mask=1 全段放开,prompt 聚焦环境声(无对话)。外部调用不应传此参数
  // 尾帧条件 (首尾帧 - 尾帧)
  lastFrameFilename?: string;   // optional: 尾帧图像(已在 ComfyUI 容器内的文件名)。作为额外 IC-LoRA guide 注入 latent 最后一帧
  lastFrameStrength?: number;   // optional: 尾帧 guide 强度 (default LTX_MSR_LAST_FRAME.strength = 0.6,软引导)
  // 首帧条件 (首尾帧 - 首帧)
  firstFrameFilename?: string;  // optional: 首帧图像(有人物)。注入到交付第 0 帧(= raw frame[trim 边界])
  firstFrameStrength?: number;  // optional: 首帧 guide 强度 (default LTX_MSR_FIRST_FRAME.strength = 0.8,需对抗 background 条件)
  firstFrameIdx?: number;       // optional: 覆盖首帧注入点。生产默认 = 方案B(msrFrameCount+1 = 第一纯生成帧,避开 LiconMSR 条件段竞争);方案A 传 calcTrimFrames(numRefs,msrFc)(=交付首帧,落在 background 条件段)
}) {
  const {
    refFilenames, prompt, negativePrompt,
    width, height, numFrames, msrFrameCount, fps,
    seed, filenamePrefix,
  } = opts;

  // V2 feature flags
  const useV2 = opts.useV2 !== false; // default true
  const nagWeight = opts.nagWeight ?? LTX_MSR_V2.nag.nagWeight;
  const nagLayers = opts.nagLayers ?? LTX_MSR_V2.nag.nagLayers;
  const nagSigmaStart = opts.nagSigmaStart ?? LTX_MSR_V2.nag.nagSigmaStart;
  const relayWeight = opts.relayWeight ?? LTX_MSR_V2.promptRelay.relayWeight;
  const refDescription = opts.refDescription || "";

  // Audio mode: controls how LTX implicit audio generation is guided via prompt
  //   "dialogue+ambient" — 环境音+人物对话, 禁止BGM (默认)
  //   "ambient_only"     — 纯环境音, 禁止BGM和人声
  //   "silent"           — 不输出音频 (CreateVideo 不接 audio)
  //   "auto"             — 不做任何音频引导, 完全交给模型
  const audioMode = opts.audioMode || "dialogue+ambient";
  const customAudio = opts.customAudioFilename || "";

  // v2 partial-mask: 对话段冻结 + 环境段生成
  // 仅当 audioMode == "dialogue+ambient_v2" 且提供了 customAudio 且 dialogueEndTime > 0 时启用
  const usePartialMask = audioMode === "dialogue+ambient_v2" && !!customAudio && (opts.dialogueEndTime ?? 0) > 0;
  const dialogueEndTime = usePartialMask ? opts.dialogueEndTime! : 0;
  const totalDuration = numFrames / fps;
  const ambientStartTime = dialogueEndTime; // 对话结束 = 环境开始

  // 5-stage pipeline 的 Stage 3 内部模式:audio mask=1 全段放开,LTX 全力生成环境声
  // 由 executeFiveStagePipeline() 调用时显式传入 stage3Ambient=true
  const stage3Ambient = !!opts.stage3Ambient;
  const useNode200 = usePartialMask || stage3Ambient;

  // 音频引导词 — 注入到 prompt 和 negative prompt 中
  // 强化版 (v2, 2026-07-14): 实测 v1 prompt 无法压制 LTX audio VAE 的音乐倾向,
  // 改用电影工业术语 "diegetic" vs "non-diegetic" 明确区分场内音 vs 配乐,
  // 并穷举所有音乐要素作为负面引导。
  //
  // v2.1 (2026-07-18): 加入 subtitle/text/caption 排除。
  // 实测当输入音频含中文对话时,LTX 会"转录"对白为画面烧录字幕(底部出现"这么巧"等字符)。
  // 必须 explicit 排除才能压制这个倾向。
  const SUBTITLE_NEGATIVE = "subtitles, captions, on-screen text, burned-in text, title cards, lower thirds, chyrons, captions, Chinese characters, hanzi, kanji, handwriting, calligraphy, written words, letters, numbers, signage with text, watermarks with text";
  const AUDIO_GUIDES: Record<string, { positive: string; negative: string }> = {
    "dialogue+ambient": {
      positive: "strictly diegetic in-world sound, on-location production audio, raw foley art, natural room tone, environmental ambiance, character dialogue, no scored music, unscored scene",
      negative: "non-diegetic audio, background music, BGM, soundtrack, musical score, underscore, theme music, cue, instrumentation, instruments, melody, melodic phrase, harmony, chord progression, tonal center, key, scale, rhythm, beat, pulse, tempo, groove, percussion, drums, drum beat, bass line, bass guitar, orchestral arrangement, string section, brass, electronic music, synthesizer, vocal melody, singing, hooks, drops, chorus, verse, bridge, intro, outro, leitmotif, jingle, any structured musical composition or arrangement, " + SUBTITLE_NEGATIVE,
    },
    "ambient_only": {
      positive: "strictly diegetic in-world ambient sound, on-location field recording, raw foley, natural room tone, wind, rustle, environmental texture, no scored music, no voices, unscored scene",
      negative: "non-diegetic audio, background music, BGM, soundtrack, musical score, underscore, theme music, cue, instrumentation, instruments, melody, harmony, chord progression, rhythm, beat, pulse, tempo, percussion, drums, bass, orchestra, electronic music, synthesizer, vocal melody, singing, hooks, drops, chorus, verse, bridge, leitmotif, jingle, speech, dialogue, voices, narration, any structured musical composition or arrangement, " + SUBTITLE_NEGATIVE,
    },
    "silent": {
      positive: "",
      negative: "background music, BGM, soundtrack, musical instruments, melody, singing, speech, voices, ambient sounds, " + SUBTITLE_NEGATIVE,
    },
    "auto": {
      positive: "",
      negative: SUBTITLE_NEGATIVE,
    },
  };
  const audioGuide = AUDIO_GUIDES[audioMode] || AUDIO_GUIDES["dialogue+ambient"];

  // 增强 prompt: 在尾部追加音频正面引导词
  const audioEnhancedPrompt = audioGuide.positive
    ? `${prompt}, ${audioGuide.positive}`
    : prompt;

  // 增强 negativePrompt: 追加音频负面引导词
  const audioEnhancedNegative = audioGuide.negative
    ? `${negativePrompt}, ${audioGuide.negative}`
    : negativePrompt;

  // LoRA version selection: V2 (default), V1, or test
  const loraVersion = opts.msrLoraVersion || "V2";
  const msrLoraName = loraVersion === "V1"
    ? "LTX-2.3-Multiple-Subject-Reference/LTX-2.3-Licon-MSR-V1.safetensors"
    : loraVersion === "test"
    ? LTX_DEFAULTS.msrLoraTestName
    : LTX_DEFAULTS.msrLoraName; // V2

  const hasPose = !!(opts.poseFrameFilename || opts.poseVideoFilename);
  const isPoseVideo = !!opts.poseVideoFilename;
  const poseStrength = opts.poseGuideStrength ?? LTX_POSE.poseGuideStrength;

  // 尾帧条件 (首尾帧 - 尾帧):作为 guide chain 的最后一环注入 latent 末帧。
  const hasLastFrame = !!opts.lastFrameFilename && !stage3Ambient; // Stage 3 是纯环境声 pass,不接尾帧
  const lastFrameStrength = opts.lastFrameStrength ?? LTX_MSR_LAST_FRAME.strength;

  // 首帧条件 (首尾帧 - 首帧):注入交付第 0 帧(= raw frame[trim 边界],落在 background latent)。
  const hasFirstFrame = !!opts.firstFrameFilename && !stage3Ambient;
  const firstFrameStrength = opts.firstFrameStrength ?? LTX_MSR_FIRST_FRAME.strength;
  // 首帧注入点:生产默认 = 方案B(msrFrameCount+1 = 第一纯生成帧,避开 LiconMSR 条件段竞争)。
  // 方案A(交付第 0 帧 = calcTrimFrames,落在 background 条件段)经 firstFrameIdx 显式覆盖。
  const firstFrameIdx = opts.firstFrameIdx ?? (msrFrameCount + 1);

  // V2 model chain: IC-LoRA → PromptRelay → NAG → (Pose IC-LoRA) → Guider
  // V1 model chain: IC-LoRA → (Pose IC-LoRA) → Guider
  //
  // Node IDs for V2 chain:
  //   10: IC-LoRA (base)
  //   99: PromptRelayEncode (consumes model from 10, produces enhanced model + positive conditioning)
  //   121: LTX2_NAG (consumes model from 99, produces NAG-enhanced model)
  //   51: Pose IC-LoRA (optional, consumes model from 121)
  // The "final model node" feeds into CFGGuider

  const modelNodeForGuider = hasPose ? "51" : (useV2 ? "121" : "10");

  // When PromptRelay is active, it produces the positive conditioning (node 99 → output 1)
  // which feeds into LTXVConditioning (node 7) instead of raw CLIPTextEncode (node 5)
  // V2 fallback: merge refDescription into prompt for richer identity context
  // When PromptRelayEncode is active (V2), it produces the positive conditioning (node 99 → output 1)
  // which feeds into LTXVConditioning (node 7) instead of raw CLIPTextEncode (node 5)
  const effectivePrompt = useV2 && refDescription
    ? audioEnhancedPrompt  // action prompt + audio guide; refDescription goes to PromptRelay global_prompt
    : audioEnhancedPrompt;

  // Guide chain (每环都消费上一环的 positive/negative/latent 三元组):
  //   node 9 (identity via LiconMSR) → [node 52 (pose)] → [node 53 (last frame)] → [node 54 (first frame)]
  // 每个 guide 独立指向自己的 frame_idx,链上顺序不影响各 frame_idx 语义。
  const lastFrameIn = hasPose ? "52" : "9";                              // node 53 的上游
  const firstFrameIn = hasLastFrame ? "53" : (hasPose ? "52" : "9");     // node 54 的上游
  const guideOutNode = hasFirstFrame ? "54" : (hasLastFrame ? "53" : (hasPose ? "52" : "9"));

  // refFilenames: index 0 = ref1, 1 = ref2, ... last = background
  // LiconMSR accepts slots "1","2","3","4" + "background"
  const backgroundFilename = refFilenames[refFilenames.length - 1];
  const refSlots = refFilenames.slice(0, -1); // everything except last

  // Assign reference images to LiconMSR input slots "1","2","3","4"
  const msrInputs: Record<string, any> = {
    width,
    height,
    frame_count: msrFrameCount,
    background: ["30", 0],
  };
  const refSlotNames = ["1", "2", "3", "4"];
  const loadImageNodes: Record<string, any> = {};
  refSlots.forEach((filename, i) => {
    if (i < 4) {
      const nodeId = 40 + i; // 40, 41, 42, 43
      loadImageNodes[String(nodeId)] = {
        class_type: "LoadImage",
        inputs: { image: filename },
      };
      msrInputs[refSlotNames[i]] = [String(nodeId), 0];
    }
  });
  // background loader
  loadImageNodes["30"] = {
    class_type: "LoadImage",
    inputs: { image: backgroundFilename },
  };

  return {
    // === Model & Text Encoder (int8_convrot) ===
    // 替代原 LowVRAMCheckpointLoader + LTXAVTextEncoderLoader:
    //   - int8 transformer 常驻 VRAM,不需层间 offload
    //   - transformer_only 不含 text encoder/VAE,必须独立加载
    // 回退路径: git revert 此 commit 恢复 LowVRAMCheckpointLoader
    "3": {
      class_type: "OTUNetLoaderW8A8",
      inputs: {
        unet_name: LTX_DEFAULTS.msrModelName,
        weight_dtype: "default",
        model_type: "ltx2",
        on_the_fly_quantization: false,
        enable_convrot: true,
        lora_mode: "None",
      },
    },
    "26": {
      class_type: "DualCLIPLoader",
      inputs: {
        clip_name1: LTX_DEFAULTS.clipName1,
        clip_name2: LTX_DEFAULTS.clipName2,
        type: "ltxv",
      },
    },
    "10": {
      class_type: "LTXICLoRALoaderModelOnly",
      inputs: {
        model: ["3", 0],
        lora_name: msrLoraName,
        strength_model: 1.0,
      },
    },
    // int8 transformer 不含 VAE,独立加载 video / audio VAE
    "31": {
      class_type: "VAELoader",
      inputs: { vae_name: LTX_DEFAULTS.msrVideoVAE },
    },

    // === V2: PromptRelayEncode + LTX2_NAG ===
    // ComfyUI-PromptRelay (kijai/ComfyUI-PromptRelay) 提供时间分段 prompt 控制。
    //   global_prompt = 参考图角色/场景描述（全局条件）
    //   local_prompts = 动作描述（按时间段用 | 分隔）
    // KJNodes 提供 LTX2_NAG：通过 negative conditioning 引导注意力。
    //
    // 模型链: node 10 (IC-LoRA) → node 99 (PromptRelay) → node 121 (NAG) → [Pose] → Guider
    // Conditioning: node 99 产出 positive → node 7 (LTXVConditioning)
    ...(useV2 ? {
      "99": {
        class_type: "PromptRelayEncode",
        inputs: {
          model: ["10", 0],
          clip: ["26", 0],
          latent: ["8", 0],
          global_prompt: refDescription || prompt,
          local_prompts: refDescription ? prompt : prompt,
          segment_lengths: "",
          epsilon: relayWeight,
        },
      },
      "121": {
        class_type: "LTX2_NAG",
        inputs: {
          model: ["99", 0],
          nag_scale: nagLayers,
          nag_alpha: nagWeight,
          nag_tau: nagSigmaStart,
          nag_cond_video: ["7", 1],   // negative conditioning from LTXVConditioning
          nag_cond_audio: ["7", 1],
          inplace: true,
        },
      },
    } : {}),

    // === Optional: Union Control IC-LoRA for pose conditioning ===
    // V2: pose IC-LoRA chains AFTER NAG (node 121) instead of after base IC-LoRA (node 10)
    ...(hasPose ? {
      "51": {
        class_type: "LTXICLoRALoaderModelOnly",
        inputs: {
          model: useV2 ? ["121", 0] : ["10", 0],
          lora_name: LTX_POSE.unionControlLoraName,
          strength_model: LTX_POSE.poseLoraStrength,
        },
      },
      // Pose input: VHS_LoadVideo (multi-frame MP4) or LoadImage (single PNG)
      ...(isPoseVideo ? {
        "50": {
          class_type: "VHS_LoadVideo",
          inputs: {
            video: opts.poseVideoFilename!,
            force_rate: 0,
            custom_width: 0,
            custom_height: 0,
            frame_load_cap: 0,
            skip_first_frames: 0,
            select_every_nth: 1,
          },
        },
      } : {
        "50": {
          class_type: "LoadImage",
          inputs: { image: opts.poseFrameFilename! },
        },
      }),
      // Second guide injection: pose frames with adjustable attention strength
      "52": {
        class_type: "LTXAddVideoICLoRAGuideAdvanced",
        inputs: {
          positive: ["9", 0],
          negative: ["9", 1],
          vae: ["31", 0],
          latent: ["9", 2],
          image: ["50", 0],   // VHS_LoadVideo outputs IMAGE batch (multi-frame) or LoadImage (single)
          frame_idx: 0,
          strength: poseStrength,
          latent_downscale_factor: 1,
          crop: "center",
          use_tiled_encode: false,
          tile_size: 256,
          tile_overlap: 64,
          attention_strength: poseStrength,
        },
      },
    } : {}),

    // === Prompt Encoding ===
    "5": {
      class_type: "CLIPTextEncode",
      inputs: { text: effectivePrompt, clip: ["26", 0] },
    },
    "6": {
      class_type: "CLIPTextEncode",
      inputs: { text: audioEnhancedNegative, clip: ["26", 0] },
    },

    // === Audio VAE (int8: 独立文件,不从 ckpt 加载) ===
    "21": {
      class_type: "VAELoader",
      inputs: { vae_name: LTX_DEFAULTS.msrAudioVAE },
    },

    // === Custom Audio (音频参考) ===
    // 三种场景:
    //   1. dialogue+ambient (默认): SolidMask=0 全段冻结,bit-exact 拷贝输入音频
    //   2. dialogue+ambient_v2 (partial-mask): 对话段冻结 + 环境段放开让模型生成
    //   3. stage3Ambient: 不需要输入音频(用 EmptyLatentAudio),整段交给模型生成
    ...(customAudio && !stage3Ambient ? {
      "60": {
        class_type: "LoadAudio",
        inputs: { audio: customAudio },
      },
      "61": {
        class_type: "LTXVAudioVAEEncode",
        inputs: {
          audio: ["60", 0],
          audio_vae: ["21", 0],
        },
      },
      // v1 模式: SolidMask + SetLatentNoiseMask 全段冻结
      ...(!usePartialMask ? {
        "62": {
          class_type: "SolidMask",
          inputs: { value: 0, width: 512, height: 512 },
        },
        "63": {
          class_type: "SetLatentNoiseMask",
          inputs: {
            samples: ["61", 0],
            mask: ["62", 0],
          },
        },
      } : {}),
    } : {}),

    // === Video Conditioning ===
    // V2: positive conditioning comes from PromptRelayEncode (node 99) instead of CLIPTextEncode (node 5)
    "7": {
      class_type: "LTXVConditioning",
      inputs: {
        positive: useV2 ? ["99", 1] : ["5", 0],
        negative: ["6", 0],
        frame_rate: fps,
      },
    },

    // === Empty Latents ===
    "8": {
      class_type: "EmptyLTXVLatentVideo",
      inputs: { width, height, length: numFrames, batch_size: 1 },
    },
    "22": {
      class_type: "LTXVEmptyLatentAudio",
      inputs: {
        audio_vae: ["21", 0],
        frames_number: numFrames,
        frame_rate: fps,
        batch_size: 1,
      },
    },

    // === Reference Image Loaders (dynamic) ===
    ...loadImageNodes,

    // === LiconMSR Multi-Reference Video ===
    "28": {
      class_type: "LiconMSR",
      inputs: msrInputs,
    },

    // === IC-LoRA Video Guide Injection ===
    "9": {
      class_type: "LTXAddVideoICLoRAGuide",
      inputs: {
        positive: ["7", 0],
        negative: ["7", 1],
        vae: ["31", 0],
        latent: ["8", 0],
        image: ["28", 0],
        frame_idx: 0,
        strength: 1.0,
        latent_downscale_factor: 1,
        crop: "center",
        use_tiled_encode: false,
        tile_size: 256,
        tile_overlap: 64,
      },
    },

    // === Last-Frame Conditioning (首尾帧 - 尾帧) ===
    // 尾帧作为 guide chain 最后一环,注入 latent 的最后一个 slot。
    // 用 LTXAddVideoICLoRAGuideAdvanced(与 node 52 同类,IC-LoRA attention 路径一致),
    // 而非通用的 LTXVAddGuide —— 后者不写 iclora_tokens,可能被 IC-LoRA attention 忽略。
    //
    // ⚠️ frame_idx 必须用显式正值 numFrames - 1,不能用 -1!
    //   LiconMSR 的 41 帧条件段(node 9)会让 ComfyUI 登记 num_keyframes=6,
    //   负索引解析 (latent_count = latent_length - num_keyframes) 会使 -1 落到
    //   生成内容的开头(latent slot 6)而非末尾(slot 12)。
    //   例:numFrames=97 → 13 个 latent slot → frame_idx=96 → latent_idx=(96+7)//8=12(末帧)✓
    //   单帧 image 不受"帧数必须 1 mod 8"约束(该规则仅对 guide_length>1 生效)。
    ...(hasLastFrame ? {
      "44": {
        class_type: "LoadImage",
        inputs: { image: opts.lastFrameFilename! },
      },
      "53": {
        class_type: "LTXAddVideoICLoRAGuideAdvanced",
        inputs: {
          positive: [lastFrameIn, 0],
          negative: [lastFrameIn, 1],
          vae: ["31", 0],
          latent: [lastFrameIn, 2],
          image: ["44", 0],
          frame_idx: numFrames - 1,        // 显式正值,见上方注释
          strength: lastFrameStrength,      // 软引导(默认 0.6)
          latent_downscale_factor: 1,
          crop: "center",
          use_tiled_encode: false,
          tile_size: 256,
          tile_overlap: 64,
          attention_strength: lastFrameStrength,
        },
      },
    } : {}),

    // === First-Frame Conditioning (首尾帧 - 首帧) ===
    // 注入到交付第 0 帧 = raw frame[firstFrameIdx](= calcTrimFrames(numRefs, msrFc),落在 background latent)。
    // ⚠️ 与尾帧不同:该位置在 LiconMSR 条件段内,guide 要跟 background 条件竞争。
    //   strength 默认 0.8(高于尾帧的 0.6);若仍压不过 background(交付首帧仍空场景),
    //   可换注入点 frame_idx = msrFrameCount + 1(第一个纯生成帧)+ 延长 trim。
    ...(hasFirstFrame ? {
      "46": {
        class_type: "LoadImage",
        inputs: { image: opts.firstFrameFilename! },
      },
      "54": {
        class_type: "LTXAddVideoICLoRAGuideAdvanced",
        inputs: {
          positive: [firstFrameIn, 0],
          negative: [firstFrameIn, 1],
          vae: ["31", 0],
          latent: [firstFrameIn, 2],
          image: ["46", 0],
          frame_idx: firstFrameIdx,            // 默认方案B = msrFrameCount+1(第一纯生成帧);方案A = calcTrimFrames(交付第0帧)
          strength: firstFrameStrength,
          latent_downscale_factor: 1,
          crop: "center",
          use_tiled_encode: false,
          tile_size: 256,
          tile_overlap: 64,
          attention_strength: firstFrameStrength,
        },
      },
    } : {}),

    // === Concat AV Latents ===
    // 有自定义音频时:
    //   v1 全冻结: 用 SetLatentNoiseMask 处理过的 latent (node 63)
    //   v2 partial-mask: 直接用 AudioVAEEncode 输出 (node 61),mask 由 node 200 后置处理
    //   5-stage Stage 3: 不用输入音频,直接用 EmptyLatentAudio (node 22)
    // 无自定义音频时: 用空音频latent (node 22), LTX模型自己生成音频
    "23": {
      class_type: "LTXVConcatAVLatent",
      inputs: {
        video_latent: [guideOutNode, 2],
        audio_latent: stage3Ambient
          ? ["22", 0]
          : (customAudio
            ? (usePartialMask ? ["61", 0] : ["63", 0])
            : ["22", 0]),
      },
    },

    // === Node 200: LTXVSetAudioVideoMaskByTime ===
    // 两种模式共用此节点,参数不同:
    //   v2 partial-mask: 对话段(0~dialogueEndTime) mask=0 冻结 + 环境段 mask=1 放开
    //   stage3 ambient: 全段 mask=1 放开,模型自由生成纯环境声(无对话约束)
    ...(useNode200 ? {
      "200": {
        class_type: "LTXVSetAudioVideoMaskByTime",
        inputs: {
          av_latent: ["23", 0],
          positive: [guideOutNode, 0],
          negative: [guideOutNode, 1],
          model: [modelNodeForGuider === "121" ? "121" : modelNodeForGuider === "51" ? "51" : "10", 0],
          vae: ["31", 0],
          audio_vae: ["21", 0],
          start_time: stage3Ambient ? 0 : ambientStartTime,
          end_time: totalDuration,
          video_fps: fps,
          mask_video: false,             // 视频全段自由生成
          mask_audio: !stage3Ambient,    // v2: True(区间内 mask=1) / stage3: False(全段都用 init_value)
          mask_init_value_video: 1.0,    // 视频 init=1(全段 free)
          mask_init_value_audio: stage3Ambient ? 1.0 : 0.0,  // v2: 0(对话段冻结) / stage3: 1(全段 free)
          slope_len: 3,
        },
      },
    } : {}),

    // === Sampler ===
    "15": {
      class_type: "RandomNoise",
      inputs: { noise_seed: seed },
    },
    "27": {
      class_type: "ManualSigmas",
      inputs: { sigmas: "1.0, 0.99375, 0.9875, 0.98125, 0.975, 0.909375, 0.725, 0.421875, 0.0" },
    },
    "13": {
      class_type: "KSamplerSelect",
      inputs: { sampler_name: "euler" },
    },
    "37": {
      class_type: "CFGGuider",
      inputs: {
        model: modelNodeForGuider === "121" ? ["121", 0] : modelNodeForGuider === "51" ? ["51", 0] : ["10", 0],
        positive: [guideOutNode, 0],
        negative: [guideOutNode, 1],
        cfg: 1.0,
      },
    },
    "16": {
      class_type: "SamplerCustomAdvanced",
      inputs: {
        noise: ["15", 0],
        guider: ["37", 0],
        sampler: ["13", 0],
        sigmas: ["27", 0],
        // v2 partial-mask / stage3 ambient 模式: 用 node 200 输出(已应用 mask)
        // 其他模式: 直接用 node 23(concat 后的 AV latent)
        latent_image: useNode200 ? ["200", 2] : ["23", 0],
      },
    },

    // === Separate AV Latents ===
    "24": {
      class_type: "LTXVSeparateAVLatent",
      inputs: { av_latent: ["16", 0] },
    },

    // === Crop Guides ===
    "17": {
      class_type: "LTXVCropGuides",
      inputs: {
        positive: [guideOutNode, 0],
        negative: [guideOutNode, 1],
        latent: ["24", 0],
      },
    },

    // === Decode Video ===
    "38": {
      class_type: "VAEDecode",
      inputs: { samples: ["17", 2], vae: ["31", 0] },
    },

    // === Decode Audio ===
    "25": {
      class_type: "LTXVAudioVAEDecode",
      inputs: {
        samples: ["24", 1],
        audio_vae: ["21", 0],
      },
    },

    // === Create Video with Audio ===
    // silent 模式下不接 audio 输入 → 输出纯静音视频
    "19": {
      class_type: "CreateVideo",
      inputs: audioMode === "silent" ? {
        images: ["38", 0],
        fps,
      } : {
        images: ["38", 0],
        audio: ["25", 0],
        fps,
      },
    },

    // === Save ===
    "20": {
      class_type: "SaveVideo",
      inputs: {
        video: ["19", 0],
        filename_prefix: filenamePrefix,
        format: "auto",
        codec: "auto",
      },
    },
  };
}

// ============================================================
// 5-Stage Pipeline Orchestrator
// ============================================================
//
// 当 audioMode = "5stage_pipeline" 时调用。LTX 2.3 无法在单次 pass 既保真 TTS
// 又生成丰富环境声,需要拆 2 次 pass + ffmpeg 混合:
//   Stage 2: dialogue+ambient_v2 (partial-mask,对话冻结 + 弱环境)
//   Stage 3: stage3Ambient (audio mask=1 全段,纯环境生成,无对话约束)
//   Mix:    ffmpeg sidechaincompress ducking (对话时压环境) + alimiter
//   Mux:    ffmpeg (Stage 2 video + mixed audio) → final mp4
//
// 运行时间 ~6.85 min(2 次 LTX ~3.5 min each + ffmpeg 秒级)

export interface FiveStageOpts {
  refFilenames: string[];
  prompt: string;
  negativePrompt: string;
  refDescription?: string;
  width: number;
  height: number;
  numFrames: number;
  msrFrameCount: number;
  fps: number;
  seed: number;
  filenamePrefix: string;
  customAudioFilename: string;       // 必填:5-stage 必须有 TTS 对话音频
  dialogueEndTime: number;           // 必填:对话结束时间(秒)
  lastFrameFilename?: string;        // 可选:尾帧(首尾帧-尾帧),仅作用于 Stage 2 视频
  lastFrameStrength?: number;
  firstFrameFilename?: string;       // 可选:首帧(首尾帧-首帧,有人物),仅作用于 Stage 2 视频
  firstFrameStrength?: number;
  firstFrameIdx?: number;            // 可选:首帧注入点覆盖(方案B 用 msrFrameCount+1 避开条件段)
  stage3AudioMode?: string;          // 可选:Stage 3 环境声 pass 的 audioMode(默认 "auto";改 "ambient_only" 用 rich 音频引导,改善环境声质感)
  stage2PromptSuffix?: string;       // 可选:仅追加到 Stage 2 prompt(对口型标注:谁说话+台词+嘴型同步)。绝不进 Stage 3,否则 LTX 人声偏置会在环境声渗出"第二种声音"
  useV2?: boolean;
  nagWeight?: number;
  nagLayers?: number;
  nagSigmaStart?: number;
  relayWeight?: number;
  msrLoraVersion?: string;
}

/** 兜底:ComfyUI 对完全缓存的 prompt 返回 success 但 outputs 为空。
 *  此时按 prefix 扫容器输出目录找最新 mp4(缓存=内容相同,旧文件即正确结果)。 */
function findOutputFallback(prefix: string): any | null {
  const { execSync } = require("child_process");
  try {
    const ls = execSync(
      `docker exec ${LTX_CONFIG.containerName} bash -lc 'for f in /root/ComfyUI/output/${prefix}*.mp4; do [ -f "$f" ] && stat -c "%Y %n" "$f"; done' 2>/dev/null`,
      { timeout: 10_000 },
    ).toString().trim();
    let best: any = null, bestMs = 0;
    for (const line of ls.split("\n")) {
      const m = line.match(/^\s*(\d+)\s+(.*)$/);
      if (!m) continue;
      const ms = Number(m[1]) * 1000;
      if (ms > bestMs) { bestMs = ms; best = { filename: path.basename(m[2].trim()), subfolder: "", type: "output" }; }
    }
    return best;
  } catch { return null; }
}

export async function executeFiveStagePipeline(opts: FiveStageOpts): Promise<{
  finalVideoFilename: string;
  stage2PromptId: string;
  stage3PromptId: string;
  durationMs: number;
}> {
  const startTime = Date.now();
  const { pollComfyUi, findOutputVideo, downloadOutput } = await import("@/lib/comfyuiPoll");
  const { execSync } = require("child_process");
  const tmpDir = `/tmp/msr-5stage-${Date.now()}`;
  fs.mkdirSync(tmpDir, { recursive: true });

  // ============ Stage 2: dialogue+ambient_v2 (partial-mask) ============
  const stage2Prefix = `${opts.filenamePrefix}_stage2`;
  const stage2Workflow = buildMSRWorkflow({
    refFilenames: opts.refFilenames,
    prompt: opts.prompt + (opts.stage2PromptSuffix || ""),  // Stage 2 才加对口型标注(驱动嘴型);Stage 3 不加,避免人声渗出
    negativePrompt: opts.negativePrompt,
    refDescription: opts.refDescription,
    width: opts.width, height: opts.height,
    numFrames: opts.numFrames, msrFrameCount: opts.msrFrameCount, fps: opts.fps,
    seed: opts.seed, filenamePrefix: stage2Prefix,
    useV2: opts.useV2,
    nagWeight: opts.nagWeight, nagLayers: opts.nagLayers, nagSigmaStart: opts.nagSigmaStart,
    relayWeight: opts.relayWeight, msrLoraVersion: opts.msrLoraVersion,
    audioMode: "dialogue+ambient_v2",
    customAudioFilename: opts.customAudioFilename,
    dialogueEndTime: opts.dialogueEndTime,
    lastFrameFilename: opts.lastFrameFilename,
    lastFrameStrength: opts.lastFrameStrength,
    firstFrameFilename: opts.firstFrameFilename,
    firstFrameStrength: opts.firstFrameStrength,
    firstFrameIdx: opts.firstFrameIdx,
  });

  // ─── GPU 全局串行队列 (gpuVramManager withGpuQueueTimed, 2026-08-19 收编) ───
  // LTX 与 H3/TTS/music3/qwen_eye 共享 GPU1 锁 — 此前直提 ComfyUI 绕过队列。
  // Stage 2/3 各自把「提交+轮询到完成」包一段锁; 中间的下载/ffmpeg 混音 (CPU)
  // 在锁外。queueWaitMs 不计入轮询预算 (900s + queueWaitMs, 镜像 minimax-h3/generate.ts)。
  const stage2Out = (
    await withGpuQueueTimed(
      "ltx",
      async (queueWaitMs) => {
        const stage2Res = await axios.post(
          `${LTX_CONFIG.comfyuiUrl}/prompt`,
          { prompt: stage2Workflow },
          { timeout: 30_000, validateStatus: (s: number) => s < 500 },
        );
        if (stage2Res.status !== 200) {
          throw new Error(`Stage 2 ComfyUI rejected: ${JSON.stringify(stage2Res.data).slice(0, 500)}`);
        }
        const promptId: string = stage2Res.data.prompt_id;
        const poll = await pollComfyUi(promptId, { pollTimeoutMs: 900_000 + queueWaitMs });
        return { promptId, poll };
      },
      { gpuIndex: 1, comfyuiUrl: LTX_CONFIG.comfyuiUrl },
    )
  ).data;
  const stage2PromptId: string = stage2Out.promptId;
  const stage2Poll = stage2Out.poll;
  if (stage2Poll.status !== "success") {
    throw new Error(`Stage 2 failed: ${stage2Poll.error}`);
  }
  const stage2File = findOutputVideo(stage2Poll.outputs!) || findOutputFallback(stage2Prefix);
  if (!stage2File) throw new Error("Stage 2 produced no video output");
  const stage2LocalPath = await downloadOutput(stage2File);

  // ============ Stage 3: stage3Ambient (full audio-gen) ============
  // 用不同 seed + ambient-focused prompts + speech-excluded negative
  // Stage 3 不需要 customAudio(它生成纯环境声)
  const stage3Prefix = `${opts.filenamePrefix}_stage3`;
  const ambientNegativeSuffix = ", speech, dialogue, voices, spoken words, narration, singing";
  const ambientPromptSuffix = ". Characters are silent in this scene, focusing on ambient environmental sounds only";
  const stage3Workflow = buildMSRWorkflow({
    refFilenames: opts.refFilenames,
    prompt: opts.prompt + ambientPromptSuffix,
    negativePrompt: opts.negativePrompt + ambientNegativeSuffix,
    refDescription: opts.refDescription,
    width: opts.width, height: opts.height,
    numFrames: opts.numFrames, msrFrameCount: opts.msrFrameCount, fps: opts.fps,
    seed: opts.seed + 1, filenamePrefix: stage3Prefix,  // fresh seed for variation
    useV2: opts.useV2,
    nagWeight: opts.nagWeight, nagLayers: opts.nagLayers, nagSigmaStart: opts.nagSigmaStart,
    relayWeight: opts.relayWeight, msrLoraVersion: opts.msrLoraVersion,
    audioMode: opts.stage3AudioMode || "auto",  // 默认 auto;ambient_only 用 rich 音频引导改善环境声
    stage3Ambient: true,
  });

  const stage3Out = (
    await withGpuQueueTimed(
      "ltx",
      async (queueWaitMs) => {
        const stage3Res = await axios.post(
          `${LTX_CONFIG.comfyuiUrl}/prompt`,
          { prompt: stage3Workflow },
          { timeout: 30_000, validateStatus: (s: number) => s < 500 },
        );
        if (stage3Res.status !== 200) {
          throw new Error(`Stage 3 ComfyUI rejected: ${JSON.stringify(stage3Res.data).slice(0, 500)}`);
        }
        const promptId: string = stage3Res.data.prompt_id;
        const poll = await pollComfyUi(promptId, { pollTimeoutMs: 900_000 + queueWaitMs });
        return { promptId, poll };
      },
      { gpuIndex: 1, comfyuiUrl: LTX_CONFIG.comfyuiUrl },
    )
  ).data;
  const stage3PromptId: string = stage3Out.promptId;
  const stage3Poll = stage3Out.poll;
  if (stage3Poll.status !== "success") {
    throw new Error(`Stage 3 failed: ${stage3Poll.error}`);
  }
  const stage3File = findOutputVideo(stage3Poll.outputs!) || findOutputFallback(stage3Prefix);
  if (!stage3File) throw new Error("Stage 3 produced no video output");
  const stage3LocalPath = await downloadOutput(stage3File);

  // ============ ffmpeg: extract audio from both ============
  const stage2Audio = `${tmpDir}/stage2_audio.wav`;
  const stage3Audio = `${tmpDir}/stage3_audio.wav`;
  execSync(`ffmpeg -y -i "${stage2LocalPath}" -vn -ar 48000 -ac 2 "${stage2Audio}"`, { timeout: 30_000 });
  execSync(`ffmpeg -y -i "${stage3LocalPath}" -vn -ar 48000 -ac 2 "${stage3Audio}"`, { timeout: 30_000 });

  // ============ ffmpeg: sidechain ducking mix ============
  // Stage 2 audio(对话 + 弱环境)× 1.0 + Stage 3 audio(纯环境)× 0.55
  // sidechain 让 Stage 3 在 Stage 2 对话活跃时自动压低
  //
  // 关键修复:LTX partial-mask Mode D 在某些 seed 下,Stage 2 audio 流只覆盖
  // 对话段(= dialogueEndTime),环境段没生成 audio。如果不 pad,sidechaincompress
  // 会被 S2 audio 长度卡住,S3 audio 后段(对话结束后的环境)被丢弃。
  // 用 asplit + apad 把 S2 audio 延长到目标时长(numFrames/fps),让 sidechaincompress
  // 能完整处理 S3 audio,后段被压低到 silent(对话段已过,正常)。
  const mixedAudio = `${tmpDir}/mixed_audio.wav`;
  const targetDur = (opts.numFrames / opts.fps).toFixed(3);
  const mixFilter = [
    "[1:a]asplit=2[s2a][s2b]",
    `[s2a]apad=whole_dur=${targetDur}[s2pad]`,
    "[0:a][s2pad]sidechaincompress=threshold=0.03:ratio=10:attack=10:release=400[ducked]",
    "[ducked]volume=0.55[s3gain]",
    "[s2b]volume=1.0[l7gain]",
    "[l7gain][s3gain]amix=inputs=2:duration=longest:weights=1 1:normalize=0[sum]",
    "[sum]alimiter=limit=0.95:attack=5:release=50[limited]",
  ].join(";");
  execSync(
    `ffmpeg -y -i "${stage3Audio}" -i "${stage2Audio}" -filter_complex "${mixFilter}" -map "[limited]" -ar 48000 -ac 2 -t ${targetDur} "${mixedAudio}"`,
    { timeout: 30_000 },
  );

  // ============ ffmpeg: mux Stage 2 video + mixed audio ============
  // `-af apad` 让 audio 无限 pad silence,`-shortest` 让输出以 video 长度为准。
  // 必要性:LTX partial-mask Mode D 在某些 seed 下,Stage 2 audio 流只覆盖
  // 对话段(= dialogueEndTime),环境段的 audio latent 没生成 audio 数据。
  // 不加 apad 时,-shortest 会让最终视频截到 audio 长度(5.85s 而非 15s)。
  // 加 apad 后,audio 末段静音,但视频完整,对话段音质不受影响。
  const finalFilename = `${opts.filenamePrefix}_5stage.mp4`;
  const containerOutputPath = `${LTX_CONFIG.comfyuiOutputDir}/${finalFilename}`;
  const localOutputPath = `${tmpDir}/${finalFilename}`;
  execSync(
    `ffmpeg -y -i "${stage2LocalPath}" -i "${mixedAudio}" -map 0:v:0 -map 1:a:0 -af "apad" -c:v copy -c:a aac -b:a 192k -shortest "${localOutputPath}"`,
    { timeout: 30_000 },
  );

  // Copy final to ComfyUI container output dir for serving via /view endpoint
  try {
    execSync(`docker cp "${localOutputPath}" ${LTX_CONFIG.containerName}:"${containerOutputPath}"`, { timeout: 30_000 });
  } catch (err: any) {
    // Non-fatal: local file still exists, but won't be served via ComfyUI history
    console.warn(`5-stage: failed to copy final to container: ${err.message}`);
  }

  // Cleanup intermediates (keep final)
  try {
    fs.unlinkSync(stage2Audio);
    fs.unlinkSync(stage3Audio);
    fs.unlinkSync(mixedAudio);
    if (stage2LocalPath.startsWith("/tmp/")) fs.unlinkSync(stage2LocalPath);
    if (stage3LocalPath.startsWith("/tmp/")) fs.unlinkSync(stage3LocalPath);
  } catch {}

  return {
    finalVideoFilename: finalFilename,
    stage2PromptId,
    stage3PromptId,
    durationMs: Date.now() - startTime,
  };
}

// ============================================================
// Foley V2A pipeline(解耦音频:画面冻结 → Foley 生成环境音 → 混音)
// ============================================================
//
// 架构(2026-07-21 验证通过,audioMode=foley_v2a):
//   Step 1  v1 全冻结单 pass(buildMSRWorkflow, audioMode=dialogue+ambient):
//           TTS 冻结仅作口型条件,采样器 100% 给画面 → 口型画面视频(音频=冻结TTS)
//   Step 2  ffmpeg -an 剥出纯画面 → Foley 输入
//   Step 3  Foley V2A(buildFoleyWorkflow):画面 latent mask=0 冻结,音频 latent mask=1 生成
//           int8 + Foley LoRA(strength 2.0)+ 蒸馏采样器(ManualSigmas 9步 / euler / cfg1)
//           滑窗 89 帧 / 1s overlap → 干净环境+动作音(music 0%, speech 0%)
//   Step 4  提取两条音轨:v1 视频的冻结 TTS(对话)+ Foley 视频的环境音
//   Step 5  混音:TTS × 1.0 + Foley × ambientGain,sidechain ducking(对话时压环境)+ alimiter
//   Step 6  mux v1 画面 + 混音 → 最终 mp4
//
// 对比 5stage_pipeline:砍掉 Stage 3(Foley 替代环境音生成),前端 1 pass;
// 对话与环境彻底解耦 → BGM bias / 第二种人声 根治。

/** 构建 Foley V2A workflow(画面冻结 + Foley LoRA 生成音频)。videoInput 已在容器 input 内。 */
function buildFoleyWorkflow(opts: {
  videoInputFilename: string;
  foleyPrompt: string;
  filenamePrefix: string;
}): Record<string, any> {
  const foleyNeg = LTX_MSR_FOLEY.negativePrompt;
  return {
    "1": { class_type: "LoadVideo", inputs: { file: opts.videoInputFilename } },
    "2": { class_type: "GetVideoComponents", inputs: { video: ["1", 0] } },           // IMAGE[0] fps[2]
    // int8_convrot 底模(与 MSR 同款 OTUNetLoaderW8A8)
    "3": { class_type: "OTUNetLoaderW8A8", inputs: {
      unet_name: LTX_DEFAULTS.msrModelName, weight_dtype: "default", model_type: "ltx2",
      on_the_fly_quantization: false, enable_convrot: true, lora_mode: "None",
    }},
    // Foley LoRA(model-only,不影响文本编码)
    "10": { class_type: "LoraLoaderModelOnly", inputs: {
      model: ["3", 0], lora_name: LTX_MSR_FOLEY.loraName, strength_model: LTX_MSR_FOLEY.loraStrength,
    }},
    "31": { class_type: "VAELoader", inputs: { vae_name: LTX_DEFAULTS.msrVideoVAE } },
    "4":  { class_type: "VAELoader", inputs: { vae_name: LTX_DEFAULTS.msrAudioVAE } },
    "5":  { class_type: "DualCLIPLoader", inputs: { clip_name1: LTX_DEFAULTS.clipName1, clip_name2: LTX_DEFAULTS.clipName2, type: "ltxv" } },
    "6": { class_type: "CLIPTextEncode", inputs: { text: opts.foleyPrompt, clip: ["5", 0] } },
    "7": { class_type: "CLIPTextEncode", inputs: { text: foleyNeg, clip: ["5", 0] } },
    "8": { class_type: "LTXVConditioning", inputs: { positive: ["6", 0], negative: ["7", 0], frame_rate: ["2", 2] } },
    // 滑窗规划
    "9": { class_type: "LTXFoleyWindowPlan", inputs: {
      images: ["2", 0], frame_rate: ["2", 2],
      window_frames: LTX_MSR_FOLEY.windowFrames, overlap_seconds: LTX_MSR_FOLEY.overlapSeconds, max_windows: LTX_MSR_FOLEY.maxWindows,
    }},
    "11": { class_type: "LTXFoleyForLoopOpen", inputs: { remaining: ["9", 1] } },
    "12": { class_type: "LTXFoleyWindowSelect", inputs: { images: ["2", 0], window_plan: ["9", 0], remaining: ["11", 1] } },
    // 核心:画面 latent mask=0 冻结,音频 latent mask=1 生成 → 真 V2A
    "13": { class_type: "LTXFoleyVideoToAudioLatent", inputs: {
      images: ["12", 0], positive: ["8", 0], negative: ["8", 1],
      video_vae: ["31", 0], audio_vae: ["4", 0], frame_rate: ["2", 2],
      width: LTX_MSR_FOLEY.foleyWidth, height: LTX_MSR_FOLEY.foleyHeight, frames: LTX_MSR_FOLEY.windowFrames,
    }}, // → positive[0] negative[1] av_latent[2]
    // 蒸馏采样器(对齐 msr.ts 出雨配置:ManualSigmas 9步 + euler + cfg1)
    "15": { class_type: "RandomNoise", inputs: { noise_seed: LTX_MSR_FOLEY.seed } },
    "27": { class_type: "ManualSigmas", inputs: { sigmas: LTX_MSR_FOLEY.distilledSigmas } },
    "33": { class_type: "KSamplerSelect", inputs: { sampler_name: "euler" } },
    "37": { class_type: "CFGGuider", inputs: {
      model: ["10", 0], positive: ["13", 0], negative: ["13", 1], cfg: LTX_MSR_FOLEY.cfg,
    }},
    "16": { class_type: "SamplerCustomAdvanced", inputs: {
      noise: ["15", 0], guider: ["37", 0], sampler: ["33", 0], sigmas: ["27", 0], latent_image: ["13", 2],
    }},
    // 音频解码 + 窗口循环累积 + 拼接
    "21": { class_type: "LTXVSeparateAVLatent", inputs: { av_latent: ["16", 0] } },
    "22": { class_type: "LTXFoleyAudioVAEDecode", inputs: { samples: ["21", 1], audio_vae: ["4", 0] } },
    "23": { class_type: "LTXFoleyWindowAudioSave", inputs: {
      audio: ["22", 0], window_info: ["12", 1], save_audio: false, filename_prefix: `${opts.filenamePrefix}_win`,
    }},
    "24": { class_type: "LTXFoleyAudioAccumulator", inputs: { window_record: ["23", 1], accumulation: ["11", 2] } },
    "25": { class_type: "LTXFoleyForLoopClose", inputs: { flow_control: ["11", 0], audio_accumulation: ["24", 0] } },
    "26": { class_type: "LTXFoleyAudioStitch", inputs: { accumulation: ["25", 0], window_plan: ["9", 0] } },
    // 输出:原画面 + 生成的 Foley 环境音(无对话)
    "34": { class_type: "CreateVideo", inputs: { images: ["2", 0], fps: ["2", 2], audio: ["26", 0] } },
    "28": { class_type: "SaveVideo", inputs: { video: ["34", 0], filename_prefix: opts.filenamePrefix, format: "auto", codec: "auto" } },
  };
}

interface FoleyOpts {
  refFilenames: string[];
  prompt: string;
  negativePrompt: string;
  refDescription?: string;
  width: number; height: number;
  numFrames: number; msrFrameCount: number;
  fps: number; seed: number;
  filenamePrefix: string;
  customAudioFilename: string;        // 必填:TTS 对话(冻结进口型画面 + 混音源)
  dialogueEndTime?: number;           // 可选(sidechain 电平触发,不强制;留元数据)
  lastFrameFilename?: string; lastFrameStrength?: number;
  firstFrameFilename?: string; firstFrameStrength?: number; firstFrameIdx?: number;
  stage2PromptSuffix?: string;        // 对口型标注(进 v1 视频 prompt,驱动嘴型)
  foleyPrompt?: string;               // Foley 环境音描述(缺省 LTX_MSR_FOLEY.defaultPrompt)
  useV2?: boolean;
  nagWeight?: number; nagLayers?: number; nagSigmaStart?: number;
  relayWeight?: number; msrLoraVersion?: string;
}

export async function executeFoleyPipeline(opts: FoleyOpts): Promise<{
  finalVideoFilename: string;
  videoPromptId: string;
  foleyPromptId: string;
  durationMs: number;
}> {
  const startTime = Date.now();
  const { pollComfyUi, findOutputVideo, downloadOutput } = await import("@/lib/comfyuiPoll");
  const { execSync } = require("child_process");
  const tmpDir = `/tmp/msr-foley-${Date.now()}`;
  fs.mkdirSync(tmpDir, { recursive: true });

  // ============ Step 1: v1 全冻结单 pass → 口型画面视频 ============
  // audioMode=dialogue+ambient:TTS 冻结(bit-exact)仅作口型条件,采样器 100% 给画面。
  // 输出视频音频 = 冻结 TTS(对话),Step 4 提取它做混音。
  const videoPrefix = `${opts.filenamePrefix}_v1video`;
  const videoWorkflow = buildMSRWorkflow({
    refFilenames: opts.refFilenames,
    prompt: opts.prompt + (opts.stage2PromptSuffix || ""),  // 对口型标注进 prompt 驱动嘴型
    negativePrompt: opts.negativePrompt,
    refDescription: opts.refDescription,
    width: opts.width, height: opts.height,
    numFrames: opts.numFrames, msrFrameCount: opts.msrFrameCount, fps: opts.fps,
    seed: opts.seed, filenamePrefix: videoPrefix,
    useV2: opts.useV2,
    nagWeight: opts.nagWeight, nagLayers: opts.nagLayers, nagSigmaStart: opts.nagSigmaStart,
    relayWeight: opts.relayWeight, msrLoraVersion: opts.msrLoraVersion,
    audioMode: "dialogue+ambient",       // ← v1 SolidMask 全冻结
    customAudioFilename: opts.customAudioFilename,
    lastFrameFilename: opts.lastFrameFilename,
    lastFrameStrength: opts.lastFrameStrength,
    firstFrameFilename: opts.firstFrameFilename,
    firstFrameStrength: opts.firstFrameStrength,
    firstFrameIdx: opts.firstFrameIdx,
  });
  // ─── GPU 全局串行队列 (gpuVramManager withGpuQueueTimed, 2026-08-19 收编) ───
  // 同 5stage: Step1(v1 视频)与 Step3(Foley V2A)各自把「提交+轮询到完成」包
  // 一段 GPU1 全局锁 (ltx 键), 中间的 ffmpeg 剥画面/docker cp 在锁外。
  // queueWaitMs 不计入轮询预算 (900s + queueWaitMs, 镜像 minimax-h3/generate.ts)。
  const videoOut = (
    await withGpuQueueTimed(
      "ltx",
      async (queueWaitMs) => {
        const videoRes = await axios.post(
          `${LTX_CONFIG.comfyuiUrl}/prompt`, { prompt: videoWorkflow },
          { timeout: 30_000, validateStatus: (s: number) => s < 500 },
        );
        if (videoRes.status !== 200) throw new Error(`Foley Step1 (v1 video) ComfyUI rejected: ${JSON.stringify(videoRes.data).slice(0, 500)}`);
        const promptId: string = videoRes.data.prompt_id;
        const poll = await pollComfyUi(promptId, { pollTimeoutMs: 900_000 + queueWaitMs });
        return { promptId, poll };
      },
      { gpuIndex: 1, comfyuiUrl: LTX_CONFIG.comfyuiUrl },
    )
  ).data;
  const videoPromptId: string = videoOut.promptId;
  const videoPoll = videoOut.poll;
  if (videoPoll.status !== "success") throw new Error(`Foley Step1 (v1 video) failed: ${videoPoll.error}`);
  const videoFile = findOutputVideo(videoPoll.outputs!) || findOutputFallback(videoPrefix);
  if (!videoFile) throw new Error("Foley Step1 (v1 video) produced no video output");
  const videoLocalPath = await downloadOutput(videoFile);

  // ============ Step 2: 剥纯画面 → Foley 输入 ============
  const foleyInputHost = `${tmpDir}/foley_input.mp4`;
  execSync(`ffmpeg -y -i "${videoLocalPath}" -an -c:v libx264 -preset fast -crf 18 "${foleyInputHost}"`, { timeout: 120_000 });
  const foleyInputName = `${opts.filenamePrefix}_foleyin.mp4`;
  execSync(`docker cp "${foleyInputHost}" ${LTX_CONFIG.containerName}:"${LTX_CONFIG.comfyuiInputDir}/${foleyInputName}"`, { timeout: 30_000 });

  // ============ Step 3: Foley V2A → 环境音视频 ============
  const foleyPrefix = `${opts.filenamePrefix}_foley`;
  const foleyPrompt = opts.foleyPrompt || LTX_MSR_FOLEY.defaultPrompt;
  const foleyWorkflow = buildFoleyWorkflow({ videoInputFilename: foleyInputName, foleyPrompt, filenamePrefix: foleyPrefix });
  const foleyOut = (
    await withGpuQueueTimed(
      "ltx",
      async (queueWaitMs) => {
        const foleyRes = await axios.post(
          `${LTX_CONFIG.comfyuiUrl}/prompt`, { prompt: foleyWorkflow },
          { timeout: 30_000, validateStatus: (s: number) => s < 500 },
        );
        if (foleyRes.status !== 200) throw new Error(`Foley Step3 (V2A) ComfyUI rejected: ${JSON.stringify(foleyRes.data).slice(0, 500)}`);
        const promptId: string = foleyRes.data.prompt_id;
        const poll = await pollComfyUi(promptId, { pollTimeoutMs: 900_000 + queueWaitMs });
        return { promptId, poll };
      },
      { gpuIndex: 1, comfyuiUrl: LTX_CONFIG.comfyuiUrl },
    )
  ).data;
  const foleyPromptId: string = foleyOut.promptId;
  const foleyPoll = foleyOut.poll;
  if (foleyPoll.status !== "success") throw new Error(`Foley Step3 (V2A) failed: ${foleyPoll.error}`);
  const foleyFile = findOutputVideo(foleyPoll.outputs!) || findOutputFallback(foleyPrefix);
  if (!foleyFile) throw new Error("Foley Step3 (V2A) produced no video output");
  const foleyLocalPath = await downloadOutput(foleyFile);

  // ============ Step 4: 提取两条音轨 ============
  const dialogueAudio = `${tmpDir}/dialogue.wav`;   // v1 视频里的冻结 TTS(对话)
  const foleyAmbient = `${tmpDir}/foley_ambient.wav`; // Foley 生成的纯环境音
  execSync(`ffmpeg -y -i "${videoLocalPath}" -vn -ar 48000 -ac 2 "${dialogueAudio}"`, { timeout: 30_000 });
  execSync(`ffmpeg -y -i "${foleyLocalPath}" -vn -ar 48000 -ac 2 "${foleyAmbient}"`, { timeout: 30_000 });

  // ============ Step 5: sidechain ducking 混音(复用 5stage 套路)============
  // Foley 环境 × ambientGain(对话活跃时 sidechain 自动压低)+ 对话(TTS)× 1.0
  const mixedAudio = `${tmpDir}/mixed_audio.wav`;
  const targetDur = (opts.numFrames / opts.fps).toFixed(3);
  const ag = LTX_MSR_FOLEY.ambientGain;
  const mixFilter = [
    "[1:a]asplit=2[s2a][s2b]",
    `[s2a]apad=whole_dur=${targetDur}[s2pad]`,
    "[0:a][s2pad]sidechaincompress=threshold=0.03:ratio=10:attack=10:release=400[ducked]",
    `[ducked]volume=${ag}[foleygain]`,
    "[s2b]volume=1.0[voxdgain]",
    "[voxdgain][foleygain]amix=inputs=2:duration=longest:weights=1 1:normalize=0[sum]",
    "[sum]alimiter=limit=0.95:attack=5:release=50[limited]",
  ].join(";");
  execSync(
    `ffmpeg -y -i "${foleyAmbient}" -i "${dialogueAudio}" -filter_complex "${mixFilter}" -map "[limited]" -ar 48000 -ac 2 -t ${targetDur} "${mixedAudio}"`,
    { timeout: 30_000 },
  );

  // ============ Step 6: mux v1 画面 + 混音 ============
  const finalFilename = `${opts.filenamePrefix}_foley.mp4`;
  const containerOutputPath = `${LTX_CONFIG.comfyuiOutputDir}/${finalFilename}`;
  const localOutputPath = `${tmpDir}/${finalFilename}`;
  execSync(
    `ffmpeg -y -i "${videoLocalPath}" -i "${mixedAudio}" -map 0:v:0 -map 1:a:0 -af "apad" -c:v copy -c:a aac -b:a 192k -shortest "${localOutputPath}"`,
    { timeout: 30_000 },
  );

  // Copy final to ComfyUI container output dir(供 /view 端点 serve)
  try {
    execSync(`docker cp "${localOutputPath}" ${LTX_CONFIG.containerName}:"${containerOutputPath}"`, { timeout: 30_000 });
  } catch (err: any) {
    console.warn(`foley: failed to copy final to container: ${err.message}`);
  }

  // Cleanup intermediates(保留 final)
  try {
    fs.unlinkSync(dialogueAudio); fs.unlinkSync(foleyAmbient); fs.unlinkSync(mixedAudio); fs.unlinkSync(foleyInputHost);
    if (videoLocalPath.startsWith("/tmp/")) fs.unlinkSync(videoLocalPath);
    if (foleyLocalPath.startsWith("/tmp/")) fs.unlinkSync(foleyLocalPath);
  } catch {}

  return {
    finalVideoFilename: finalFilename,
    videoPromptId,
    foleyPromptId,
    durationMs: Date.now() - startTime,
  };
}

// ============================================================
// Simplified API — 只暴露用户关心的参数
// ============================================================
//
// POST /api/ltx/msr (multipart/form-data)  +  POST /verified (同步+BGM重生)
//
// 📖 完整入参/提示词撰写指南见 docs/ltx-msr-input-guide.md(范例源自 ~/文档/LTX/validition_v1)。
// 本注释是 call-time 速查;不确定时读那份文档——MSR 对参考图与提示词写法高度敏感。
//
// ======================= 黄金法则(最容易踩的坑) =======================
// 1. 参考图顺序:主体在前(slot1-4),背景=最后一张(background 槽)。见 buildMSRWorkflow
//    msr.ts:329-332: backgroundFilename=refFilenames[last], refSlots=refFilenames.slice(0,-1)。
//    即 ref1=第一个主体(不是背景!),refN(末位)=背景。放反→主体和背景错位。
//    每个主体 ref 必须是「角色卡」拼图:横排 4 格 = 正面近照 + 全身正/侧/背(见 input-guide §2.2)。
// 2. refDescription 写「身份」(每角色一段外貌/服饰/场景,不写动作),prompt 写「动作」。
//    V2 PromptRelay:global_prompt=refDescription, local_prompts=prompt(见 node 99)。
//    漏填 refDescription → 模型拿 prompt 当 identity → 人物漂移。强烈建议必填。
// 3. 不要在 prompt 里写音乐词("BGM"/"soundtrack"/"epic music")——audioMode 已自动注入
//    diegetic 正向 + 音乐/字幕负向(见 AUDIO_GUIDES),你写了反而诱发 BGM。要环境音就写
//    具体声源(footsteps/wind/rustle)。中文对白别在正向提"字幕"(会被转录烧录)。
// 4. 对口型标注(谁说话+台词+嘴型同步)只进 stage2PromptSuffix,绝不进 prompt
//    ——否则 LTX 人声偏置在环境声 Stage 渗出"第二种声音"。
// 5. width/height 必须匹配参考图宽高比(默认 1280×704=16:9;竖屏立绘改 720×1280)。
//
// ======================= 字段速查(默认值见 parseAndUploadAssets) =======================
// 必填:projectId(number)、prompt(非空)、ref1..refN(2~5 张,主体在前背景在末位)
// 提示词:prompt(动作)、refDescription(identity,强烈建议)、negativePrompt(有默认,勿重写)
//         stage2PromptSuffix(仅 5stage Stage2 对口型)、foleyPrompt(仅 foley_v2a)
// 基础:duration(3)、fps(24)、width(1280)、height(704)、seed、outputFilename、outputDir
// V2:useV2(true)、nagWeight(0.25)、nagLayers(11)、nagSigmaStart(2.5)、relayWeight(0.0022)、msrLoraVersion(V2)
// 音频:audioStrategy(tts/foley/ambient/silent,推荐)> audioMode(dialogue+ambient/dialogue+ambient_v2/
//         5stage_pipeline/ambient_only/silent/auto)> 智能默认。audio(file)、dialogueEndTime(5stage/v2 必填)
// 画面引导:firstFrame[/firstFramePath](str 0.8)、lastFrame[/lastFramePath](str 0.6)、firstFrameIdx、
//         poseVideoFrames(JSON 数组,宿主白名单路径)、poseGuideStrength(0.7)
// /verified 专用:maxRegenAttempts(3)、bgmThreshold(0.10)、pollTimeoutMs(600000)
// 宿主路径白名单:/data/workspace/kais-blender-docker/outputs/ | /mnt/agents/output/ | /tmp/comfyui-ltx-input/
//
// 内部自动计算(不暴露):numFrames = roundTo8nPlus1(duration*fps + 1);msrFrameCount ∈ [17,25,33,41]

const commonUpload = upload.fields([
  { name: "ref1", maxCount: 1 },
  { name: "ref2", maxCount: 1 },
  { name: "ref3", maxCount: 1 },
  { name: "ref4", maxCount: 1 },
  { name: "ref5", maxCount: 1 },
  { name: "audio", maxCount: 1 },
  { name: "lastFrame", maxCount: 1 },  // 尾帧图像(首尾帧-尾帧,可选)
  { name: "firstFrame", maxCount: 1 }, // 首帧图像(首尾帧-首帧,可选,有人物)
]);

const commonValidate = validateFields({
  projectId: z.coerce.number(),
  prompt: z.string().min(1),
});

// ============================================================
// Shared handlers (POST / and POST /verified 共用入口)
// ============================================================

class MSRValidationError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "MSRValidationError";
  }
}

const ALLOWED_POSE_HOST_PREFIXES = [
  "/data/workspace/kais-blender-docker/outputs/",
  "/mnt/agents/output/",
  "/tmp/comfyui-ltx-input/",
  LOCAL_STAGING_DIR + "/",
];

const DEFAULT_NEGATIVE = "worst quality, blurry, jittery, distorted, inconsistent appearance, text, watermark, subtitles, captions, on-screen text, burned-in text, Chinese characters, handwriting, calligraphy";

/**
 * 从 req 解析所有参数 + 上传所有资产到 ComfyUI 容器。
 * 错误时 throw MSRValidationError,handler 一处 catch 即可。
 */
async function parseAndUploadAssets(req: any): Promise<MSRParams> {
  // --- 基本字段 ---
  const projectId = Number(req.body.projectId);
  const prompt = req.body.prompt as string;
  const duration = Number(req.body.duration) || 3;
  const fps = Number(req.body.fps) || 24;
  const width = Number(req.body.width) || 1280;
  const height = Number(req.body.height) || 704;
  const negativePrompt = (req.body.negativePrompt as string) || DEFAULT_NEGATIVE;
  const seed = req.body.seed ? Number(req.body.seed) : Math.floor(Math.random() * 2147483647);
  const outputFilename = (req.body.outputFilename as string) || `ltx_msr_${projectId}_${Date.now()}`;
  const outputDir = (req.body.outputDir as string) || "";

  // --- V2 参数 ---
  const useV2 = req.body.useV2 !== "false" && req.body.useV2 !== false;
  const refDescription = (req.body.refDescription as string) || "";
  const nagWeight = req.body.nagWeight ? Number(req.body.nagWeight) : undefined;
  const nagLayers = req.body.nagLayers ? Number(req.body.nagLayers) : undefined;
  const nagSigmaStart = req.body.nagSigmaStart ? Number(req.body.nagSigmaStart) : undefined;
  const msrLoraVersion = (req.body.msrLoraVersion as string) || "V2";
  const relayWeight = req.body.relayWeight ? Number(req.body.relayWeight) : undefined;

  // --- 音频接口层(audioStrategy > audioMode > 智能默认) ---
  const audioStrategyRaw = (req.body.audioStrategy as string) || "";
  const audioStrategy = (["tts", "foley", "ambient", "silent"] as AudioStrategy[]).includes(audioStrategyRaw as AudioStrategy)
    ? (audioStrategyRaw as AudioStrategy)
    : undefined;
  const audioMode = (req.body.audioMode as string) || "";
  const dialogueEndTime = req.body.dialogueEndTime ? Number(req.body.dialogueEndTime) : undefined;
  const poseGuideStrength = req.body.poseGuideStrength ? Number(req.body.poseGuideStrength) : undefined;
  const lastFrameStrength = req.body.lastFrameStrength ? Number(req.body.lastFrameStrength) : undefined;
  const firstFrameStrength = req.body.firstFrameStrength ? Number(req.body.firstFrameStrength) : undefined;
  const firstFrameIdx = req.body.firstFrameIdx ? Number(req.body.firstFrameIdx) : undefined;
  const stage2PromptSuffix = (req.body.stage2PromptSuffix as string) || undefined;  // 对口型标注(仅 Stage 2)
  const foleyPrompt = (req.body.foleyPrompt as string) || undefined;  // Foley V2A 环境音描述(仅 foley_v2a;缺省用 LTX_MSR_FOLEY.defaultPrompt)

  // --- 收集上传文件 ---
  const files = req.files as Record<string, Express.Multer.File[]>;
  const refFieldNames = ["ref1", "ref2", "ref3", "ref4", "ref5"];
  const uploadedFiles: Express.Multer.File[] = [];
  for (const name of refFieldNames) {
    if (files?.[name]?.[0]) uploadedFiles.push(files[name][0]);
    else break;
  }
  if (uploadedFiles.length < 2) {
    throw new MSRValidationError(400, "At least 2 reference images required (ref1, ref2). Up to 5 supported.");
  }
  if (uploadedFiles.length > 5) {
    throw new MSRValidationError(400, `Too many reference images: ${uploadedFiles.length} (max 5).`);
  }

  // --- 上传 custom audio ---
  const customAudioFile = files?.["audio"]?.[0];
  let customAudioFilename: string | undefined;
  if (customAudioFile) {
    try {
      const ext = path.extname(customAudioFile.originalname || ".wav") || ".wav";
      const filename = `${uuidv4()}${ext}`;
      copyToContainer(customAudioFile.path, `${LTX_CONFIG.comfyuiInputDir}/${filename}`);
      customAudioFilename = filename;
    } catch (err: any) {
      try { fs.unlinkSync(customAudioFile.path); } catch {}
      throw new MSRValidationError(502, `Failed to upload audio to ComfyUI: ${err.message}`);
    }
    try { fs.unlinkSync(customAudioFile.path); } catch {}
  }

  // --- 上传 refs 到 ComfyUI ---
  const refFilenames: string[] = [];
  try {
    for (const file of uploadedFiles) {
      const ext = path.extname(file.originalname || ".png") || ".png";
      const filename = `${uuidv4()}${ext}`;
      copyToContainer(file.path, `${LTX_CONFIG.comfyuiInputDir}/${filename}`);
      refFilenames.push(filename);
    }
  } catch (err: any) {
    for (const file of uploadedFiles) {
      try { fs.unlinkSync(file.path); } catch {}
    }
    throw new MSRValidationError(502, `Failed to upload images to ComfyUI: ${err.message}`);
  }
  for (const file of uploadedFiles) {
    try { fs.unlinkSync(file.path); } catch {}
  }

  // --- 解析 poseVideoFrames(可选) ---
  const poseVideoFramesRaw = req.body.poseVideoFrames as string | undefined;
  let poseFrameFilename: string | undefined;
  let poseVideoFilename: string | undefined;
  if (poseVideoFramesRaw) {
    try {
      const parsed = JSON.parse(poseVideoFramesRaw);
      if (!Array.isArray(parsed) || parsed.length === 0) {
        throw new MSRValidationError(400, "poseVideoFrames must be a non-empty JSON array of file paths");
      }
      const first = parsed[0];
      if (typeof first !== "string" || first.length === 0) {
        throw new MSRValidationError(400, "poseVideoFrames[0] must be a string path");
      }
      const frame = first;
      const isHostPath = frame.startsWith("/") && fs.existsSync(frame);
      if (isHostPath) {
        const allowed = ALLOWED_POSE_HOST_PREFIXES.some((p) => frame.startsWith(p));
        if (!allowed) {
          throw new MSRValidationError(400, `poseVideoFrames path "${frame}" is outside allowed host prefixes`);
        }
        const ext = path.extname(frame) || ".png";
        const isVideo = [".mp4", ".webm", ".mov", ".avi", ".mkv"].includes(ext.toLowerCase());
        const containerFilename = `${uuidv4()}${ext}`;
        copyToContainer(frame, `${LTX_CONFIG.comfyuiInputDir}/${containerFilename}`);
        if (isVideo) poseVideoFilename = containerFilename;
        else poseFrameFilename = containerFilename;
      } else {
        const ext = path.extname(frame).toLowerCase();
        const isVideo = [".mp4", ".webm", ".mov", ".avi", ".mkv"].includes(ext);
        if (isVideo) poseVideoFilename = path.basename(frame);
        else poseFrameFilename = path.basename(frame);
      }
    } catch (err: any) {
      if (err instanceof MSRValidationError) throw err;
      throw new MSRValidationError(400, `poseVideoFrames must be a JSON-stringified array of file paths: ${err.message}`);
    }
  }

  // --- 解析尾帧 lastFrame (可选,首尾帧-尾帧) ---
  // 两种来源(优先上传文件):
  //   1. multipart 上传字段 "lastFrame"
  //   2. body.lastFramePath: 容器内文件名,或宿主路径(必须在 ALLOWED_POSE_HOST_PREFIXES 白名单内)
  const lastFrameFile = files?.["lastFrame"]?.[0];
  const lastFramePathRaw = (req.body.lastFramePath as string) || "";
  let lastFrameFilename: string | undefined;
  if (lastFrameFile) {
    try {
      const ext = path.extname(lastFrameFile.originalname || ".png") || ".png";
      const filename = `${uuidv4()}${ext}`;
      copyToContainer(lastFrameFile.path, `${LTX_CONFIG.comfyuiInputDir}/${filename}`);
      lastFrameFilename = filename;
    } catch (err: any) {
      try { fs.unlinkSync(lastFrameFile.path); } catch {}
      throw new MSRValidationError(502, `Failed to upload lastFrame to ComfyUI: ${err.message}`);
    }
    try { fs.unlinkSync(lastFrameFile.path); } catch {}
  } else if (lastFramePathRaw) {
    const isHostPath = lastFramePathRaw.startsWith("/") && fs.existsSync(lastFramePathRaw);
    if (isHostPath) {
      const allowed = ALLOWED_POSE_HOST_PREFIXES.some((p) => lastFramePathRaw.startsWith(p));
      if (!allowed) {
        throw new MSRValidationError(400, `lastFramePath "${lastFramePathRaw}" is outside allowed host prefixes`);
      }
      const ext = path.extname(lastFramePathRaw) || ".png";
      const filename = `${uuidv4()}${ext}`;
      copyToContainer(lastFramePathRaw, `${LTX_CONFIG.comfyuiInputDir}/${filename}`);
      lastFrameFilename = filename;
    } else {
      // 容器内已存在的文件名,直接用
      lastFrameFilename = path.basename(lastFramePathRaw);
    }
  }

  // --- 解析首帧 firstFrame (可选,首尾帧-首帧,有人物) ---
  // 两种来源:1. multipart "firstFrame";2. body.firstFramePath(容器文件名 / 宿主白名单路径)
  const firstFrameFile = files?.["firstFrame"]?.[0];
  const firstFramePathRaw = (req.body.firstFramePath as string) || "";
  let firstFrameFilename: string | undefined;
  if (firstFrameFile) {
    try {
      const ext = path.extname(firstFrameFile.originalname || ".png") || ".png";
      const filename = `${uuidv4()}${ext}`;
      copyToContainer(firstFrameFile.path, `${LTX_CONFIG.comfyuiInputDir}/${filename}`);
      firstFrameFilename = filename;
    } catch (err: any) {
      try { fs.unlinkSync(firstFrameFile.path); } catch {}
      throw new MSRValidationError(502, `Failed to upload firstFrame to ComfyUI: ${err.message}`);
    }
    try { fs.unlinkSync(firstFrameFile.path); } catch {}
  } else if (firstFramePathRaw) {
    const isHostPath = firstFramePathRaw.startsWith("/") && fs.existsSync(firstFramePathRaw);
    if (isHostPath) {
      const allowed = ALLOWED_POSE_HOST_PREFIXES.some((p) => firstFramePathRaw.startsWith(p));
      if (!allowed) {
        throw new MSRValidationError(400, `firstFramePath "${firstFramePathRaw}" is outside allowed host prefixes`);
      }
      const ext = path.extname(firstFramePathRaw) || ".png";
      const filename = `${uuidv4()}${ext}`;
      copyToContainer(firstFramePathRaw, `${LTX_CONFIG.comfyuiInputDir}/${filename}`);
      firstFrameFilename = filename;
    } else {
      firstFrameFilename = path.basename(firstFramePathRaw);
    }
  }

  // --- 派生参数 ---
  const numFrames = roundTo8nPlus1(Math.round(duration * fps) + 1);
  const msrFrameCount = pickMSRFrameCount(uploadedFiles.length);

  return {
    refFilenames,
    customAudioFilename,
    poseFrameFilename,
    poseVideoFilename,
    lastFrameFilename,
    firstFrameFilename,
    prompt, negativePrompt, refDescription,
    width, height, numFrames, msrFrameCount, fps, seed,
    filenamePrefix: "",  // 由 handler 在 seed/outputDir 已知后填充
    duration, poseGuideStrength, dialogueEndTime, lastFrameStrength, firstFrameStrength, firstFrameIdx, stage2PromptSuffix, foleyPrompt,
    audioStrategy, audioMode,
    useV2, nagWeight, nagLayers, nagSigmaStart, relayWeight, msrLoraVersion,
    refCount: uploadedFiles.length,
    outputDir, outputFilename,
  };
}

/** 5stage 必须有 audio + dialogueEndTime */
function validateFiveStage(params: MSRParams): void {
  if (!params.customAudioFilename) {
    throw new MSRValidationError(400, `audioMode=5stage_pipeline requires custom audio (TTS dialogue). Upload via "audio" field, or use audioStrategy=tts.`);
  }
  if (!params.dialogueEndTime || params.dialogueEndTime <= 0) {
    throw new MSRValidationError(400, `audioMode=5stage_pipeline requires dialogueEndTime (seconds, when dialogue ends and ambient takes over).`);
  }
}

/** 提交单次 workflow,返回 promptId */
async function submitWorkflow(params: MSRParams, audioMode: string, seed: number, filenamePrefix: string): Promise<string> {
  const workflow = buildMSRWorkflow({
    refFilenames: params.refFilenames,
    prompt: params.prompt, negativePrompt: params.negativePrompt,
    width: params.width, height: params.height,
    numFrames: params.numFrames, msrFrameCount: params.msrFrameCount, fps: params.fps,
    seed, filenamePrefix,
    poseFrameFilename: params.poseFrameFilename,
    poseVideoFilename: params.poseVideoFilename,
    poseGuideStrength: params.poseGuideStrength,
    lastFrameFilename: params.lastFrameFilename,
    lastFrameStrength: params.lastFrameStrength,
    firstFrameFilename: params.firstFrameFilename,
    firstFrameStrength: params.firstFrameStrength,
    firstFrameIdx: params.firstFrameIdx,
    useV2: params.useV2, refDescription: params.refDescription,
    nagWeight: params.nagWeight, nagLayers: params.nagLayers, nagSigmaStart: params.nagSigmaStart,
    msrLoraVersion: params.msrLoraVersion, relayWeight: params.relayWeight,
    audioMode, customAudioFilename: params.customAudioFilename, dialogueEndTime: params.dialogueEndTime,
  });
  // ─── GPU 全局串行队列 (gpuVramManager withGpuQueue, 2026-08-19 收编) ───
  // LTX 与 H3/TTS/music3/qwen_eye 共享 GPU1 锁 — 此前直提 ComfyUI 绕过队列,
  // 是同卡撞车源。POST / 异步 taskId 模式: 锁只包「提交段」(显存预检/驱逐 +
  // POST /prompt); /verified 的「提交+轮询」由外层 withGpuQueueTimed 统一持锁
  // (此处在锁内嵌套调用会自动 pass-through, 不重复排队)。
  return withGpuQueue(
    "ltx",
    async () => {
      const comfyRes = await axios.post(
        `${LTX_CONFIG.comfyuiUrl}/prompt`,
        { prompt: workflow },
        { timeout: 30_000, validateStatus: (s: number) => s < 500 },
      );
      if (comfyRes.status !== 200) {
        throw new MSRValidationError(502, `ComfyUI rejected prompt: ${JSON.stringify(comfyRes.data)}`);
      }
      return comfyRes.data.prompt_id as string;
    },
    { gpuIndex: 1, comfyuiUrl: LTX_CONFIG.comfyuiUrl },
  );
}

/** POST /verified 的 regen 循环 */
async function runVerifiedRegenLoop(
  params: MSRParams,
  audioMode: string,
  opts: { maxAttempts: number; bgmThreshold: number; pollTimeoutMs: number; conflict: boolean },
): Promise<{ status: number; body: any }> {
  const { pollComfyUi, findOutputVideo, downloadOutput } = await import("@/lib/comfyuiPoll");
  const { detectBgm } = await import("@/lib/audioBgmDetector");

  const attempts: any[] = [];
  let currentSeed = params.seed;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    const outputFilename = `${params.outputFilename}_attempt${attempt}`;
    const filenamePrefix = params.outputDir ? `${params.outputDir}/${outputFilename}` : outputFilename;

    // ─── GPU 全局串行队列 (gpuVramManager withGpuQueueTimed, 2026-08-19 收编) ───
    // /verified 为同步长轮询路由: 锁粒度 = 「提交+轮询到完成」, 下载/BGM 检测在
    // 锁外 (每个 attempt 重新排队)。queueWaitMs 不计入轮询预算 (pollTimeoutMs +
    // queueWaitMs, 镜像 minimax-h3/generate.ts); 锁内嵌套的 submitWorkflow 自动
    // pass-through, 不重复排队。
    const { promptId, poll } = (
      await withGpuQueueTimed(
        "ltx",
        async (queueWaitMs) => {
          const promptId = await submitWorkflow(params, audioMode, currentSeed, filenamePrefix);
          const poll = await pollComfyUi(promptId, { pollTimeoutMs: opts.pollTimeoutMs + queueWaitMs });
          return { promptId, poll };
        },
        { gpuIndex: 1, comfyuiUrl: LTX_CONFIG.comfyuiUrl },
      )
    ).data;
    if (poll.status !== "success") {
      attempts.push({ attempt, promptId, seed: currentSeed, status: "error", error: poll.error });
      return { status: 502, body: error(`Generation failed (attempt ${attempt}): ${poll.error}`) };
    }

    const file = findOutputVideo(poll.outputs!);
    if (!file) {
      attempts.push({ attempt, promptId, seed: currentSeed, status: "no_video" });
      return { status: 502, body: error(`No video in ComfyUI outputs (attempt ${attempt})`) };
    }

    let bgmReport: any = null;
    if (audioMode !== "silent") {
      let localPath: string | null = null;
      try {
        localPath = await downloadOutput(file);
        bgmReport = await detectBgm(localPath, { threshold: opts.bgmThreshold });
      } catch (err: any) {
        attempts.push({ attempt, promptId, seed: currentSeed, status: "bgm_check_failed", error: err.message });
        return {
          status: 200,
          body: success({
            promptId, attempt, status: "bgm_check_failed",
            message: `Generation succeeded but BGM check errored: ${err.message}`,
            video: file,
            audioStrategy: params.audioStrategy,
            audioMode,
            warning: opts.conflict ? "Both audioStrategy and audioMode provided; audioStrategy takes precedence." : undefined,
            params: { width: params.width, height: params.height, numFrames: params.numFrames, fps: params.fps, seed: currentSeed, audioMode },
            attempts,
          }),
        };
      } finally {
        if (localPath) { try { fs.unlinkSync(localPath); } catch {} }
      }
    } else {
      bgmReport = { has_bgm: false, confidence: 1.0, interpretation: "SILENT", note: "audioMode=silent; no audio stream produced" };
    }

    const accepted = !bgmReport.has_bgm;
    attempts.push({
      attempt, promptId, seed: currentSeed,
      status: accepted ? "accepted" : "rejected_bgm",
      music_pct: bgmReport.music_pct, confidence: bgmReport.confidence,
      video: file,
    });

    if (accepted || attempt >= opts.maxAttempts) {
      const trimFrames = calcTrimFrames(params.refCount, params.msrFrameCount);
      return {
        status: 200,
        body: success({
          promptId,
          status: accepted ? "verified" : "bgm_failed",
          message: accepted
            ? `Video verified BGM-free on attempt ${attempt}/${opts.maxAttempts}`
            : `BGM detected in all ${opts.maxAttempts} attempts; returning last result`,
          attempt, accepted, video: file, bgm: bgmReport,
          refCount: params.refCount,
          audioStrategy: params.audioStrategy,
          audioMode,
          warning: opts.conflict ? "Both audioStrategy and audioMode provided; audioStrategy takes precedence." : undefined,
          audio: {
            mode: audioMode,
            hasAudioTrack: audioMode !== "silent",
            customAudio: !!params.customAudioFilename,
          },
          params: {
            width: params.width, height: params.height,
            numFrames: params.numFrames, fps: params.fps, seed: currentSeed,
            msrFrameCount: params.msrFrameCount, trimFrames,
            trimSec: +(trimFrames / params.fps).toFixed(4),
          },
          attempts,
        }),
      };
    }
    currentSeed = Math.floor(Math.random() * 2147483647);
  }
  // Unreachable
  return { status: 500, body: error("regen loop exited unexpectedly") };
}

/** 5stage 响应格式化 */
function formatFiveStageResponse(
  params: MSRParams,
  result: { stage2PromptId: string; stage3PromptId: string; finalVideoFilename: string; durationMs: number },
  audioMode: string,
  conflict: boolean,
): any {
  return success({
    status: "completed",
    audioStrategy: params.audioStrategy,
    mode: audioMode,
    warning: conflict ? "Both audioStrategy and audioMode provided; audioStrategy takes precedence." : undefined,
    stage2PromptId: result.stage2PromptId,
    stage3PromptId: result.stage3PromptId,
    finalVideo: { filename: result.finalVideoFilename },
    totalDurationSec: +(result.durationMs / 1000).toFixed(1),
    params: {
      width: params.width, height: params.height,
      numFrames: params.numFrames, fps: params.fps,
      seed: params.seed, dialogueEndTime: params.dialogueEndTime, audioMode,
    },
    audio: { hasAudioTrack: true, customAudio: true, dialogueFrozen: true, ambientGenerated: true },
  });
}

function formatFoleyResponse(
  params: MSRParams,
  result: { videoPromptId: string; foleyPromptId: string; finalVideoFilename: string; durationMs: number },
  audioMode: string,
  conflict: boolean,
): any {
  return success({
    status: "completed",
    audioStrategy: params.audioStrategy,
    mode: audioMode,
    warning: conflict ? "Both audioStrategy and audioMode provided; audioStrategy takes precedence." : undefined,
    videoPromptId: result.videoPromptId,       // v1 全冻结单 pass(口型画面)
    foleyPromptId: result.foleyPromptId,        // Foley V2A(环境音生成)
    finalVideo: { filename: result.finalVideoFilename },
    totalDurationSec: +(result.durationMs / 1000).toFixed(1),
    params: {
      width: params.width, height: params.height,
      numFrames: params.numFrames, fps: params.fps,
      seed: params.seed, dialogueEndTime: params.dialogueEndTime, audioMode,
    },
    // 对话=TTS冻结(直通),环境=Foley V2A 生成(无音乐/无人声);两者解耦混音
    audio: { hasAudioTrack: true, customAudio: true, dialogueFrozen: true, ambientSource: "foley_v2a", bgmRisk: "none", voiceLeakageRisk: "none" },
  });
}

/** 单 pass 响应格式化(POST / 异步提交) */
function formatSinglePassResponse(
  params: MSRParams,
  audioMode: string,
  promptId: string,
  conflict: boolean,
): any {
  const actualDuration = ((params.numFrames - 1) / params.fps).toFixed(1);
  const trimFrames = calcTrimFrames(params.refCount, params.msrFrameCount);
  const trimSec = +(trimFrames / params.fps).toFixed(4);
  return success({
    promptId,
    status: "pending",
    audioStrategy: params.audioStrategy,
    warning: conflict ? "Both audioStrategy and audioMode provided; audioStrategy takes precedence." : undefined,
    message: (params.poseFrameFilename || params.poseVideoFilename)
      ? `LTX LiconMSR V2 task submitted with pose guide (dual-conditioning)${params.useV2 ? " + NAG" : ""}`
      : `LTX LiconMSR ${params.useV2 ? "V2 (NAG)" : "V1"} multi-reference task submitted`,
    refCount: params.refCount,
    v2: params.useV2 ? {
      nag: {
        scale: params.nagLayers ?? LTX_MSR_V2.nag.nagLayers,
        alpha: params.nagWeight ?? LTX_MSR_V2.nag.nagWeight,
        tau: params.nagSigmaStart ?? LTX_MSR_V2.nag.nagSigmaStart,
      },
      refDescription: !!params.refDescription,
      loraVersion: params.msrLoraVersion,
    } : null,
    poseGuide: (params.poseFrameFilename || params.poseVideoFilename) ? {
      type: params.poseVideoFilename ? "video" : "image",
      file: params.poseVideoFilename || params.poseFrameFilename,
      strength: params.poseGuideStrength ?? LTX_POSE.poseGuideStrength,
    } : null,
    audio: {
      mode: audioMode,
      hasAudioTrack: audioMode !== "silent",
      customAudio: !!params.customAudioFilename,
    },
    params: {
      width: params.width, height: params.height,
      duration: `${actualDuration}s`, fps: params.fps,
      msrFrameCount: params.msrFrameCount, numFrames: params.numFrames,
      seed: params.seed, trimFrames, trimSec,
      trimFormula: `last_switch + 8 (VAE temporal factor)`,
    },
  });
}

// ============================================================
// POST / — async submit (returns promptId immediately)
// ============================================================

router.post(
  "/",
  commonUpload,
  commonValidate,
  async (req, res) => {
    try {
      const params = await parseAndUploadAssets(req);
      const { mode, conflict } = resolveAudioMode(params);
      const filenamePrefix = params.outputDir
        ? `${params.outputDir}/${params.outputFilename}`
        : params.outputFilename;

      if (mode === "5stage_pipeline") {
        validateFiveStage(params);
        const result = await executeFiveStagePipeline({
          refFilenames: params.refFilenames,
          prompt: params.prompt, negativePrompt: params.negativePrompt,
          refDescription: params.refDescription,
          width: params.width, height: params.height,
          numFrames: params.numFrames, msrFrameCount: params.msrFrameCount, fps: params.fps,
          seed: params.seed, filenamePrefix,
          customAudioFilename: params.customAudioFilename!,
          dialogueEndTime: params.dialogueEndTime!,
          lastFrameFilename: params.lastFrameFilename,
          lastFrameStrength: params.lastFrameStrength,
          firstFrameFilename: params.firstFrameFilename,
          firstFrameStrength: params.firstFrameStrength,
          firstFrameIdx: params.firstFrameIdx,
          stage2PromptSuffix: params.stage2PromptSuffix,
          useV2: params.useV2,
          nagWeight: params.nagWeight, nagLayers: params.nagLayers, nagSigmaStart: params.nagSigmaStart,
          msrLoraVersion: params.msrLoraVersion, relayWeight: params.relayWeight,
        });
        return res.status(200).send(formatFiveStageResponse(params, result, mode, conflict));
      }

      if (mode === "foley_v2a") {
        validateFiveStage(params);  // 同样需要 customAudio(TTS)+ dialogueEndTime
        const result = await executeFoleyPipeline({
          refFilenames: params.refFilenames,
          prompt: params.prompt, negativePrompt: params.negativePrompt,
          refDescription: params.refDescription,
          width: params.width, height: params.height,
          numFrames: params.numFrames, msrFrameCount: params.msrFrameCount, fps: params.fps,
          seed: params.seed, filenamePrefix,
          customAudioFilename: params.customAudioFilename!,
          dialogueEndTime: params.dialogueEndTime,
          lastFrameFilename: params.lastFrameFilename,
          lastFrameStrength: params.lastFrameStrength,
          firstFrameFilename: params.firstFrameFilename,
          firstFrameStrength: params.firstFrameStrength,
          firstFrameIdx: params.firstFrameIdx,
          stage2PromptSuffix: params.stage2PromptSuffix,
          foleyPrompt: params.foleyPrompt,
          useV2: params.useV2,
          nagWeight: params.nagWeight, nagLayers: params.nagLayers, nagSigmaStart: params.nagSigmaStart,
          msrLoraVersion: params.msrLoraVersion, relayWeight: params.relayWeight,
        });
        return res.status(200).send(formatFoleyResponse(params, result, mode, conflict));
      }

      const promptId = await submitWorkflow(params, mode, params.seed, filenamePrefix);
      return res.status(200).send(formatSinglePassResponse(params, mode, promptId, conflict));
    } catch (err: any) {
      if (err instanceof VramInsufficientError) {
        return res.status(503).send(error(err.message, {
          kind: "vram_insufficient",
          engine: "ltx",
          freeMiB: err.freeMiB,
          requiredMiB: err.requiredMiB,
          gpuIndex: err.gpuIndex,
        }));
      }
      const status = err instanceof MSRValidationError ? err.status : 502;
      const msg = err.response?.data?.error?.message || err.response?.data?.node_errors || err.message || String(err);
      res.status(status).send(error(msg));
    }
  },
);

// ============================================================
// POST /verified — submit + poll + BGM-verify + auto-regen
// ============================================================
//
// Same multipart input as POST /, but synchronous:
//   1. Submit workflow to ComfyUI
//   2. Poll /history/{promptId} until success
//   3. Download output video
//   4. Run BGM detection (scripts/audio/detect_bgm.py)
//   5. If has_bgm && attempts remaining → re-submit with new seed
//   6. Return final result + BGM report
//
// Additional body params:
//   maxRegenAttempts — 最大重试次数 (默认 3, 包含首次)
//   bgmThreshold     — 音乐占比阈值 (默认 0.10 = 10%)
//   pollTimeoutMs    — 单次轮询超时 (默认 600000 = 10min)
//
// Caveat: this endpoint holds the HTTP connection for the entire pipeline.
// Total worst-case time = maxRegenAttempts × pollTimeoutMs.
// Use a long-timeout client (e.g. axios with timeout: 0).

router.post(
  "/verified",
  commonUpload,
  commonValidate,
  async (req, res) => {
    try {
      const params = await parseAndUploadAssets(req);
      const { mode, conflict } = resolveAudioMode(params);

      // 5stage: 同步运行,跳过 BGM 检测(对话段冻结 TTS,不会产生 BGM)
      if (mode === "5stage_pipeline") {
        validateFiveStage(params);
        const filenamePrefix = params.outputDir
          ? `${params.outputDir}/${params.outputFilename}`
          : params.outputFilename;
        try {
          const result = await executeFiveStagePipeline({
            refFilenames: params.refFilenames,
            prompt: params.prompt, negativePrompt: params.negativePrompt,
            refDescription: params.refDescription,
            width: params.width, height: params.height,
            numFrames: params.numFrames, msrFrameCount: params.msrFrameCount, fps: params.fps,
            seed: params.seed, filenamePrefix,
            customAudioFilename: params.customAudioFilename!,
            dialogueEndTime: params.dialogueEndTime!,
            lastFrameFilename: params.lastFrameFilename,
            lastFrameStrength: params.lastFrameStrength,
            firstFrameFilename: params.firstFrameFilename,
            firstFrameStrength: params.firstFrameStrength,
            firstFrameIdx: params.firstFrameIdx,
            stage2PromptSuffix: params.stage2PromptSuffix,
            useV2: params.useV2,
            nagWeight: params.nagWeight, nagLayers: params.nagLayers, nagSigmaStart: params.nagSigmaStart,
            msrLoraVersion: params.msrLoraVersion, relayWeight: params.relayWeight,
          });
          return res.status(200).send(formatFiveStageResponse(params, result, mode, conflict));
        } catch (err: any) {
          return res.status(502).send(error(`5-stage pipeline failed: ${err.message}`));
        }
      }

      // foley_v2a:同步运行,跳过 BGM 检测(对话是冻结TTS,Foley 无音乐/无人声)
      if (mode === "foley_v2a") {
        validateFiveStage(params);
        const filenamePrefix = params.outputDir
          ? `${params.outputDir}/${params.outputFilename}`
          : params.outputFilename;
        try {
          const result = await executeFoleyPipeline({
            refFilenames: params.refFilenames,
            prompt: params.prompt, negativePrompt: params.negativePrompt,
            refDescription: params.refDescription,
            width: params.width, height: params.height,
            numFrames: params.numFrames, msrFrameCount: params.msrFrameCount, fps: params.fps,
            seed: params.seed, filenamePrefix,
            customAudioFilename: params.customAudioFilename!,
            dialogueEndTime: params.dialogueEndTime,
            lastFrameFilename: params.lastFrameFilename,
            lastFrameStrength: params.lastFrameStrength,
            firstFrameFilename: params.firstFrameFilename,
            firstFrameStrength: params.firstFrameStrength,
            firstFrameIdx: params.firstFrameIdx,
            stage2PromptSuffix: params.stage2PromptSuffix,
            foleyPrompt: params.foleyPrompt,
            useV2: params.useV2,
            nagWeight: params.nagWeight, nagLayers: params.nagLayers, nagSigmaStart: params.nagSigmaStart,
            msrLoraVersion: params.msrLoraVersion, relayWeight: params.relayWeight,
          });
          return res.status(200).send(formatFoleyResponse(params, result, mode, conflict));
        } catch (err: any) {
          return res.status(502).send(error(`foley_v2a pipeline failed: ${err.message}`));
        }
      }

      // 单 pass + poll + BGM 检测 + regen
      const result = await runVerifiedRegenLoop(params, mode, {
        maxAttempts: Math.max(1, Number(req.body.maxRegenAttempts) || 3),
        bgmThreshold: Number(req.body.bgmThreshold) || 0.10,
        pollTimeoutMs: Number(req.body.pollTimeoutMs) || LTX_CONFIG.pollTimeoutMs,
        conflict,
      });
      return res.status(result.status).send(result.body);
    } catch (err: any) {
      if (err instanceof VramInsufficientError) {
        return res.status(503).send(error(err.message, {
          kind: "vram_insufficient",
          engine: "ltx",
          freeMiB: err.freeMiB,
          requiredMiB: err.requiredMiB,
          gpuIndex: err.gpuIndex,
        }));
      }
      const status = err instanceof MSRValidationError ? err.status : 502;
      const msg = err.response?.data?.error?.message || err.response?.data?.node_errors || err.message || String(err);
      res.status(status).send(error(msg));
    }
  },
);

export default router;
