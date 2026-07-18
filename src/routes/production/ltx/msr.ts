import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import axios from "axios";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { LTX_CONFIG, LTX_DEFAULTS, LTX_POSE, LTX_MSR_V2 } from "./config";

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

  // When pose guide is active, chain: node 9 (identity) → node 52 (pose)
  // Otherwise: node 9 feeds directly into concat/sampler
  const guideOutNode = hasPose ? "52" : "9";

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

interface FiveStageOpts {
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
  useV2?: boolean;
  nagWeight?: number;
  nagLayers?: number;
  nagSigmaStart?: number;
  relayWeight?: number;
  msrLoraVersion?: string;
}

async function executeFiveStagePipeline(opts: FiveStageOpts): Promise<{
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
    prompt: opts.prompt,
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
  });

  const stage2Res = await axios.post(
    `${LTX_CONFIG.comfyuiUrl}/prompt`,
    { prompt: stage2Workflow },
    { timeout: 30_000, validateStatus: (s: number) => s < 500 },
  );
  if (stage2Res.status !== 200) {
    throw new Error(`Stage 2 ComfyUI rejected: ${JSON.stringify(stage2Res.data).slice(0, 500)}`);
  }
  const stage2PromptId: string = stage2Res.data.prompt_id;
  const stage2Poll = await pollComfyUi(stage2PromptId, { pollTimeoutMs: 900_000 });
  if (stage2Poll.status !== "success") {
    throw new Error(`Stage 2 failed: ${stage2Poll.error}`);
  }
  const stage2File = findOutputVideo(stage2Poll.outputs!);
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
    audioMode: "auto",  // bypass dialogue+ambient audio guides (we want pure ambient)
    stage3Ambient: true,
  });

  const stage3Res = await axios.post(
    `${LTX_CONFIG.comfyuiUrl}/prompt`,
    { prompt: stage3Workflow },
    { timeout: 30_000, validateStatus: (s: number) => s < 500 },
  );
  if (stage3Res.status !== 200) {
    throw new Error(`Stage 3 ComfyUI rejected: ${JSON.stringify(stage3Res.data).slice(0, 500)}`);
  }
  const stage3PromptId: string = stage3Res.data.prompt_id;
  const stage3Poll = await pollComfyUi(stage3PromptId, { pollTimeoutMs: 900_000 });
  if (stage3Poll.status !== "success") {
    throw new Error(`Stage 3 failed: ${stage3Poll.error}`);
  }
  const stage3File = findOutputVideo(stage3Poll.outputs!);
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
  const mixedAudio = `${tmpDir}/mixed_audio.wav`;
  const mixFilter = [
    "[0:a][1:a]sidechaincompress=threshold=0.03:ratio=10:attack=10:release=400[ducked]",
    "[ducked]volume=0.55[s3gain]",
    "[1:a]volume=1.0[l7gain]",
    "[l7gain][s3gain]amix=inputs=2:duration=longest:weights=1 1:normalize=0[sum]",
    "[sum]alimiter=limit=0.95:attack=5:release=50[limited]",
  ].join(";");
  execSync(
    `ffmpeg -y -i "${stage3Audio}" -i "${stage2Audio}" -filter_complex "${mixFilter}" -map "[limited]" -ar 48000 -ac 2 "${mixedAudio}"`,
    { timeout: 30_000 },
  );

  // ============ ffmpeg: mux Stage 2 video + mixed audio ============
  const finalFilename = `${opts.filenamePrefix}_5stage.mp4`;
  const containerOutputPath = `${LTX_CONFIG.comfyuiOutputDir}/${finalFilename}`;
  const localOutputPath = `${tmpDir}/${finalFilename}`;
  execSync(
    `ffmpeg -y -i "${stage2LocalPath}" -i "${mixedAudio}" -map 0:v:0 -map 1:a:0 -c:v copy -c:a aac -b:a 192k -shortest "${localOutputPath}"`,
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
// Simplified API — 只暴露用户关心的参数
// ============================================================
//
// POST /api/ltx/msr (multipart/form-data)
//
// 必填:
//   prompt         — 正向提示词
//   ref1~refN      — 2~5 张参考图 (ref1 是背景图, ref2~refN 是参考图)
//
// 可选 (都有合理默认值):
//   duration       — 视频秒数, 默认 3
//   fps            — 帧率, 默认 24
//   width          — 分辨率宽, 默认 1280
//   height         — 分辨率高, 默认 704
//   negativePrompt — 负向提示词, 有默认值
//   seed           — 随机种子, 默认随机
//   outputFilename — 输出文件名 (不含扩展名), 默认自动生成
//   outputDir      — 容器内输出子目录, 默认 ""
//
// V2 可选参数 (默认启用):
//   useV2          — 启用 NAG + LoRA V2, 默认 true (设 "false" 退回 V1)
//   refDescription — 参考图角色/场景描述, 用于增强 identity 一致性
//   nagWeight      — NAG alpha (注意力引导强度), 默认 0.25
//   nagLayers      — NAG scale (注意力层数), 默认 11
//   nagSigmaStart  — NAG tau (裁剪阈值), 默认 2.5
//   msrLoraVersion — LoRA 版本选择: "V2" (默认), "V1", "test"
//
// 内部自动计算 (不暴露):
//   numFrames      = roundTo8nPlus1(duration * fps + 1)
//   msrFrameCount  = 自动匹配最接近的 [17,25,33,41]

const commonUpload = upload.fields([
  { name: "ref1", maxCount: 1 },
  { name: "ref2", maxCount: 1 },
  { name: "ref3", maxCount: 1 },
  { name: "ref4", maxCount: 1 },
  { name: "ref5", maxCount: 1 },
  { name: "audio", maxCount: 1 },
]);

const commonValidate = validateFields({
  projectId: z.coerce.number(),
  prompt: z.string().min(1),
});

router.post(
  "/",
  commonUpload,
  commonValidate,
  async (req, res) => {
    // --- Parse user-facing params ---
    const projectId = Number(req.body.projectId);
    const prompt = req.body.prompt as string;
    const duration = Number(req.body.duration) || 3;
    const fps = Number(req.body.fps) || 24;
    const width = Number(req.body.width) || 1280;
    const height = Number(req.body.height) || 704;
    const negativePrompt = req.body.negativePrompt as string
      || "worst quality, blurry, jittery, distorted, inconsistent appearance, text, watermark, subtitles, captions, on-screen text, burned-in text, Chinese characters, handwriting, calligraphy";
    const seed = req.body.seed ? Number(req.body.seed) : Math.floor(Math.random() * 2147483647);
    const outputFilename = (req.body.outputFilename as string) || `ltx_msr_${projectId}_${Date.now()}`;
    const outputDir = (req.body.outputDir as string) || "";

    // --- V2 params ---
    const useV2 = req.body.useV2 !== "false" && req.body.useV2 !== false;
    const refDescription = (req.body.refDescription as string) || "";
    const nagWeight = req.body.nagWeight ? Number(req.body.nagWeight) : undefined;
    const nagLayers = req.body.nagLayers ? Number(req.body.nagLayers) : undefined;
    const nagSigmaStart = req.body.nagSigmaStart ? Number(req.body.nagSigmaStart) : undefined;
    const msrLoraVersion = (req.body.msrLoraVersion as string) || "V2";
    const relayWeight = req.body.relayWeight ? Number(req.body.relayWeight) : undefined;
    const audioMode = (req.body.audioMode as string) || "dialogue+ambient";
    // v2 partial-mask: 对话结束时间(秒),audioMode="dialogue+ambient_v2" 时必填
    const dialogueEndTime = req.body.dialogueEndTime ? Number(req.body.dialogueEndTime) : undefined;

    // --- Collect uploaded reference images (2~5) ---
    const files = req.files as Record<string, Express.Multer.File[]>;

    // --- Custom audio file upload ---
    // 用户提供自定义音频(wav/flac/mp3), 冻结到输出视频
    const customAudioFile = files?.["audio"]?.[0];
    let customAudioFilename: string | undefined;
    if (customAudioFile) {
      try {
        const ext = path.extname(customAudioFile.originalname || ".wav") || ".wav";
        const filename = `${uuidv4()}${ext}`;
        const containerPath = `${LTX_CONFIG.comfyuiInputDir}/${filename}`;
        copyToContainer(customAudioFile.path, containerPath);
        customAudioFilename = filename;
      } catch (err: any) {
        try { fs.unlinkSync(customAudioFile.path); } catch {}
        return res.status(502).send(error(`Failed to upload audio to ComfyUI: ${err.message}`));
      }
      try { fs.unlinkSync(customAudioFile.path); } catch {}
    }
    const refFieldNames = ["ref1", "ref2", "ref3", "ref4", "ref5"];
    const uploadedFiles: Express.Multer.File[] = [];

    for (const name of refFieldNames) {
      if (files?.[name]?.[0]) {
        uploadedFiles.push(files[name][0]);
      } else {
        break; // stop at first missing ref
      }
    }

    if (uploadedFiles.length < 2) {
      return res.status(400).send(error("At least 2 reference images required (ref1, ref2). Up to 5 supported."));
    }

    // --- Parse optional poseVideoFrames (Blender render PNGs or MP4 from poseVideo route) ---
    // Accepts: array of file paths. If first file is .mp4/.webm/.mov → video pose conditioning.
    //          If first file is .png/.jpg → single-frame pose conditioning.
    const poseVideoFramesRaw = req.body.poseVideoFrames as string | undefined;
    let poseFrameHostPath: string | null = null;
    if (poseVideoFramesRaw) {
      try {
        const parsed = JSON.parse(poseVideoFramesRaw);
        if (!Array.isArray(parsed) || parsed.length === 0) {
          return res.status(400).send(error("poseVideoFrames must be a non-empty JSON array of file paths"));
        }
        const first = parsed[0];
        if (typeof first !== "string" || first.length === 0) {
          return res.status(400).send(error("poseVideoFrames[0] must be a string path"));
        }
        poseFrameHostPath = first;
      } catch {
        return res.status(400).send(error("poseVideoFrames must be a JSON-stringified array of file paths"));
      }
    }

    // Cap total refs at 5 (MSR supports up to 4 ref slots + 1 background)
    // poseVideoFrames no longer counts against MSR ref limit — it's a separate guide
    if (uploadedFiles.length > 5) {
      return res.status(400).send(error(
        `Too many reference images: ${uploadedFiles.length} (max 5).`,
      ));
    }

    // --- Auto-calculate internal params ---
    const numFrames = roundTo8nPlus1(Math.round(duration * fps) + 1);
    const msrFrameCount = pickMSRFrameCount(uploadedFiles.length);

    // --- Copy images to ComfyUI container ---
    const filenames: string[] = [];
    try {
      for (const file of uploadedFiles) {
        const ext = path.extname(file.originalname || ".png") || ".png";
        const filename = `${uuidv4()}${ext}`;
        const containerPath = `${LTX_CONFIG.comfyuiInputDir}/${filename}`;
        filenames.push(filename);
        copyToContainer(file.path, containerPath);
      }
    } catch (err: any) {
      for (const file of uploadedFiles) {
        try { fs.unlinkSync(file.path); } catch {}
      }
      return res.status(502).send(error(`Failed to upload images to ComfyUI: ${err.message}`));
    }

    // Cleanup local staging files
    for (const file of uploadedFiles) {
      try { fs.unlinkSync(file.path); } catch {}
    }

    // --- Copy pose-video frame/video into ComfyUI container (optional, separate from MSR refs) ---
    // Video files (.mp4/.webm/.mov) → VHS_LoadVideo (multi-frame pose conditioning)
    // Image files (.png/.jpg) → LoadImage (single-frame pose conditioning)
    let poseFrameFilename: string | undefined;
    let poseVideoFilename: string | undefined;
    if (poseFrameHostPath) {
      try {
        const frame = poseFrameHostPath;
        const isHostPath = frame.startsWith("/") && fs.existsSync(frame);
        const ALLOWED_HOST_PREFIXES = [
          "/data/workspace/kais-blender-docker/outputs/",
          "/mnt/agents/output/",
          "/tmp/comfyui-ltx-input/",
          LOCAL_STAGING_DIR + "/",
        ];
        if (isHostPath) {
          const allowed = ALLOWED_HOST_PREFIXES.some((p) => frame.startsWith(p));
          if (!allowed) {
            throw new Error(`poseVideoFrames path "${frame}" is outside allowed host prefixes`);
          }
          const ext = path.extname(frame) || ".png";
          const isVideo = [".mp4", ".webm", ".mov", ".avi", ".mkv"].includes(ext.toLowerCase());
          const containerFilename = `${uuidv4()}${ext}`;
          const containerPath = `${LTX_CONFIG.comfyuiInputDir}/${containerFilename}`;
          copyToContainer(frame, containerPath);
          if (isVideo) {
            poseVideoFilename = containerFilename;
          } else {
            poseFrameFilename = containerFilename;
          }
        } else {
          // Already in container
          const ext = path.extname(frame).toLowerCase();
          const isVideo = [".mp4", ".webm", ".mov", ".avi", ".mkv"].includes(ext);
          if (isVideo) {
            poseVideoFilename = path.basename(frame);
          } else {
            poseFrameFilename = path.basename(frame);
          }
        }
      } catch (err: any) {
        return res.status(502).send(error(`Failed to ingest poseVideoFrame: ${err.message}`));
      }
    }

    // --- Optional: parse poseGuideStrength override ---
    const poseGuideStrength = req.body.poseGuideStrength
      ? Number(req.body.poseGuideStrength)
      : undefined;

    // --- Build & submit workflow ---
    const filenamePrefix = outputDir ? `${outputDir}/${outputFilename}` : outputFilename;

    // 5-stage pipeline: 同步运行 Stage 2 + Stage 3 + ffmpeg 混合 + mux
    // 比 single-pass 慢 (~6.85 min vs 3.5 min) 但环境声质量提升 3-16×
    if (audioMode === "5stage_pipeline") {
      if (!customAudioFilename) {
        return res.status(400).send(error(`audioMode=5stage_pipeline requires custom audio (TTS dialogue). Upload via "audio" field.`));
      }
      if (!dialogueEndTime || dialogueEndTime <= 0) {
        return res.status(400).send(error(`audioMode=5stage_pipeline requires dialogueEndTime (seconds, when dialogue ends and ambient takes over).`));
      }
      try {
        const result = await executeFiveStagePipeline({
          refFilenames: filenames,
          prompt, negativePrompt,
          refDescription,
          width, height, numFrames, msrFrameCount, fps,
          seed, filenamePrefix,
          customAudioFilename,
          dialogueEndTime,
          useV2,
          nagWeight, nagLayers, nagSigmaStart, msrLoraVersion, relayWeight,
        });
        return res.status(200).send(success({
          status: "completed",
          mode: "5stage_pipeline",
          stage2PromptId: result.stage2PromptId,
          stage3PromptId: result.stage3PromptId,
          finalVideo: { filename: result.finalVideoFilename },
          totalDurationSec: +(result.durationMs / 1000).toFixed(1),
          params: { width, height, numFrames, fps, seed, dialogueEndTime, audioMode },
          audio: { hasAudioTrack: true, customAudio: true, dialogueFrozen: true, ambientGenerated: true },
        }));
      } catch (err: any) {
        return res.status(502).send(error(`5-stage pipeline failed: ${err.message}`));
      }
    }

    const workflow = buildMSRWorkflow({
      refFilenames: filenames,
      prompt, negativePrompt,
      width, height, numFrames, msrFrameCount, fps,
      seed, filenamePrefix,
      poseFrameFilename,
      poseVideoFilename,
      poseGuideStrength,
      // V2 params
      useV2,
      refDescription,
      nagWeight,
      nagLayers,
      nagSigmaStart,
      msrLoraVersion,
      relayWeight,
      audioMode,
      customAudioFilename,
      dialogueEndTime,
    });

    try {
      const comfyRes = await axios.post(
        `${LTX_CONFIG.comfyuiUrl}/prompt`,
        { prompt: workflow },
        { timeout: 30_000, validateStatus: (s: number) => s < 500 },
      );

      if (comfyRes.status !== 200) {
        return res.status(502).send(error(`ComfyUI rejected prompt: ${JSON.stringify(comfyRes.data)}`));
      }

      const promptId = comfyRes.data.prompt_id;
      const actualDuration = ((numFrames - 1) / fps).toFixed(1);

      const trimFrames = calcTrimFrames(uploadedFiles.length, msrFrameCount);
      const trimSec = +(trimFrames / fps).toFixed(4);

      res.status(200).send(success({
        promptId,
        status: "pending",
        message: (poseFrameFilename || poseVideoFilename)
          ? `LTX LiconMSR V2 task submitted with pose guide (dual-conditioning)${useV2 ? " + NAG" : ""}`
          : `LTX LiconMSR ${useV2 ? "V2 (NAG)" : "V1"} multi-reference task submitted`,
        refCount: uploadedFiles.length,
        v2: useV2 ? {
          nag: { scale: nagLayers ?? LTX_MSR_V2.nag.nagLayers, alpha: nagWeight ?? LTX_MSR_V2.nag.nagWeight, tau: nagSigmaStart ?? LTX_MSR_V2.nag.nagSigmaStart },
          refDescription: refDescription ? true : false,
          loraVersion: msrLoraVersion,
        } : null,
        poseGuide: (poseFrameFilename || poseVideoFilename) ? {
          type: poseVideoFilename ? "video" : "image",
          file: poseVideoFilename || poseFrameFilename,
          strength: poseGuideStrength ?? LTX_POSE.poseGuideStrength,
        } : null,
        audio: {
          mode: audioMode,
          hasAudioTrack: audioMode !== "silent",
          customAudio: customAudioFilename ? true : false,
        },
        params: {
          width, height,
          duration: `${actualDuration}s`,
          fps,
          msrFrameCount,
          numFrames,
          seed,
          trimFrames,
          trimSec,
          trimFormula: `last_switch + 8 (VAE temporal factor)`,
        },
      }));
    } catch (err: any) {
      const msg = err.response?.data?.error?.message || err.response?.data?.node_errors || err.message || String(err);
      res.status(502).send(error(`ComfyUI request failed: ${msg}`));
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
    const maxAttempts = Math.max(1, Number(req.body.maxRegenAttempts) || 3);
    const bgmThreshold = Number(req.body.bgmThreshold) || 0.10;
    const pollTimeoutMs = Number(req.body.pollTimeoutMs) || LTX_CONFIG.pollTimeoutMs;

    // Reuse the same body parsing the / handler does. To keep this block
    // self-contained without a giant refactor, we re-read req.body here.
    const projectId = Number(req.body.projectId);
    const prompt = req.body.prompt as string;
    const duration = Number(req.body.duration) || 3;
    const fps = Number(req.body.fps) || 24;
    const width = Number(req.body.width) || 1280;
    const height = Number(req.body.height) || 704;
    const negativePrompt = (req.body.negativePrompt as string)
      || "worst quality, blurry, jittery, distorted, inconsistent appearance, text, watermark, subtitles, captions, on-screen text, burned-in text, Chinese characters, handwriting, calligraphy";
    const baseSeed = req.body.seed ? Number(req.body.seed) : Math.floor(Math.random() * 2147483647);
    const outputFilenameBase = (req.body.outputFilename as string)
      || `ltx_msr_${projectId}_${Date.now()}`;
    const outputDir = (req.body.outputDir as string) || "";

    const useV2 = req.body.useV2 !== "false" && req.body.useV2 !== false;
    const refDescription = (req.body.refDescription as string) || "";
    const nagWeight = req.body.nagWeight ? Number(req.body.nagWeight) : undefined;
    const nagLayers = req.body.nagLayers ? Number(req.body.nagLayers) : undefined;
    const nagSigmaStart = req.body.nagSigmaStart ? Number(req.body.nagSigmaStart) : undefined;
    const msrLoraVersion = (req.body.msrLoraVersion as string) || "V2";
    const relayWeight = req.body.relayWeight ? Number(req.body.relayWeight) : undefined;
    const audioMode = (req.body.audioMode as string) || "dialogue+ambient";
    // v2 partial-mask: 对话结束时间(秒),audioMode="dialogue+ambient_v2" 时必填
    const dialogueEndTime = req.body.dialogueEndTime ? Number(req.body.dialogueEndTime) : undefined;

    const files = req.files as Record<string, Express.Multer.File[]>;

    // Custom audio upload (same as /)
    const customAudioFile = files?.["audio"]?.[0];
    let customAudioFilename: string | undefined;
    if (customAudioFile) {
      try {
        const ext = path.extname(customAudioFile.originalname || ".wav") || ".wav";
        const filename = `${uuidv4()}${ext}`;
        const containerPath = `${LTX_CONFIG.comfyuiInputDir}/${filename}`;
        copyToContainer(customAudioFile.path, containerPath);
        customAudioFilename = filename;
      } catch (err: any) {
        try { fs.unlinkSync(customAudioFile.path); } catch {}
        return res.status(502).send(error(`Failed to upload audio to ComfyUI: ${err.message}`));
      }
      try { fs.unlinkSync(customAudioFile.path); } catch {}
    }

    const refFieldNames = ["ref1", "ref2", "ref3", "ref4", "ref5"];
    const uploadedFiles: Express.Multer.File[] = [];
    for (const name of refFieldNames) {
      if (files?.[name]?.[0]) uploadedFiles.push(files[name][0]);
      else break;
    }
    if (uploadedFiles.length < 2) {
      return res.status(400).send(error("At least 2 reference images required (ref1, ref2). Up to 5 supported."));
    }
    if (uploadedFiles.length > 5) {
      return res.status(400).send(error(`Too many reference images: ${uploadedFiles.length} (max 5).`));
    }

    const poseVideoFramesRaw = req.body.poseVideoFrames as string | undefined;
    let poseFrameHostPath: string | null = null;
    if (poseVideoFramesRaw) {
      try {
        const parsed = JSON.parse(poseVideoFramesRaw);
        if (!Array.isArray(parsed) || parsed.length === 0) {
          return res.status(400).send(error("poseVideoFrames must be a non-empty JSON array of file paths"));
        }
        const first = parsed[0];
        if (typeof first !== "string" || first.length === 0) {
          return res.status(400).send(error("poseVideoFrames[0] must be a string path"));
        }
        poseFrameHostPath = first;
      } catch {
        return res.status(400).send(error("poseVideoFrames must be a JSON-stringified array of file paths"));
      }
    }

    const numFrames = roundTo8nPlus1(Math.round(duration * fps) + 1);
    const msrFrameCount = pickMSRFrameCount(uploadedFiles.length);

    // Copy reference images once — re-use across regen attempts
    const refFilenames: string[] = [];
    try {
      for (const file of uploadedFiles) {
        const ext = path.extname(file.originalname || ".png") || ".png";
        const filename = `${uuidv4()}${ext}`;
        const containerPath = `${LTX_CONFIG.comfyuiInputDir}/${filename}`;
        refFilenames.push(filename);
        copyToContainer(file.path, containerPath);
      }
    } catch (err: any) {
      for (const file of uploadedFiles) {
        try { fs.unlinkSync(file.path); } catch {}
      }
      return res.status(502).send(error(`Failed to upload images to ComfyUI: ${err.message}`));
    }
    for (const file of uploadedFiles) {
      try { fs.unlinkSync(file.path); } catch {}
    }

    // Optional pose frame
    let poseFrameFilename: string | undefined;
    let poseVideoFilename: string | undefined;
    if (poseFrameHostPath) {
      try {
        const frame = poseFrameHostPath;
        const isHostPath = frame.startsWith("/") && fs.existsSync(frame);
        const ALLOWED_HOST_PREFIXES = [
          "/data/workspace/kais-blender-docker/outputs/",
          "/mnt/agents/output/",
          "/tmp/comfyui-ltx-input/",
          LOCAL_STAGING_DIR + "/",
        ];
        if (isHostPath) {
          const allowed = ALLOWED_HOST_PREFIXES.some((p) => frame.startsWith(p));
          if (!allowed) {
            throw new Error(`poseVideoFrames path "${frame}" is outside allowed host prefixes`);
          }
          const ext = path.extname(frame) || ".png";
          const isVideo = [".mp4", ".webm", ".mov", ".avi", ".mkv"].includes(ext.toLowerCase());
          const containerFilename = `${uuidv4()}${ext}`;
          const containerPath = `${LTX_CONFIG.comfyuiInputDir}/${containerFilename}`;
          copyToContainer(frame, containerPath);
          if (isVideo) poseVideoFilename = containerFilename;
          else poseFrameFilename = containerFilename;
        } else {
          const ext = path.extname(frame).toLowerCase();
          const isVideo = [".mp4", ".webm", ".mov", ".avi", ".mkv"].includes(ext);
          if (isVideo) poseVideoFilename = path.basename(frame);
          else poseFrameFilename = path.basename(frame);
        }
      } catch (err: any) {
        return res.status(502).send(error(`Failed to ingest poseVideoFrame: ${err.message}`));
      }
    }

    const poseGuideStrength = req.body.poseGuideStrength ? Number(req.body.poseGuideStrength) : undefined;

    // === Regen loop ===
    const attempts: any[] = [];
    let currentSeed = baseSeed;

    // Lazy-load heavy modules so the existing / path doesn't pay the cost.
    const { pollComfyUi, findOutputVideo, downloadOutput } = await import("@/lib/comfyuiPoll");
    const { detectBgm } = await import("@/lib/audioBgmDetector");

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const outputFilename = `${outputFilenameBase}_attempt${attempt}`;
      const filenamePrefix = outputDir ? `${outputDir}/${outputFilename}` : outputFilename;

      // 5-stage pipeline: 同步运行,完成后跳过 BGM 检测直接返回(因为对话段是冻结 TTS,不会有 BGM)
      if (audioMode === "5stage_pipeline") {
        if (!customAudioFilename) {
          return res.status(400).send(error(`audioMode=5stage_pipeline requires custom audio.`));
        }
        if (!dialogueEndTime || dialogueEndTime <= 0) {
          return res.status(400).send(error(`audioMode=5stage_pipeline requires dialogueEndTime.`));
        }
        try {
          const result = await executeFiveStagePipeline({
            refFilenames,
            prompt, negativePrompt, refDescription,
            width, height, numFrames, msrFrameCount, fps,
            seed: currentSeed, filenamePrefix,
            customAudioFilename, dialogueEndTime,
            useV2, nagWeight, nagLayers, nagSigmaStart, msrLoraVersion, relayWeight,
          });
          attempts.push({ attempt, promptId: result.stage2PromptId, status: "5stage_completed", finalVideo: result.finalVideoFilename });
          return res.status(200).send(success({
            status: "completed",
            mode: "5stage_pipeline",
            stage2PromptId: result.stage2PromptId,
            stage3PromptId: result.stage3PromptId,
            finalVideo: { filename: result.finalVideoFilename },
            totalDurationSec: +(result.durationMs / 1000).toFixed(1),
            attempts,
          }));
        } catch (err: any) {
          return res.status(502).send(error(`5-stage pipeline failed: ${err.message}`));
        }
      }

      const workflow = buildMSRWorkflow({
        refFilenames,
        prompt, negativePrompt,
        width, height, numFrames, msrFrameCount, fps,
        seed: currentSeed, filenamePrefix,
        poseFrameFilename, poseVideoFilename, poseGuideStrength,
        useV2, refDescription,
        nagWeight, nagLayers, nagSigmaStart, msrLoraVersion, relayWeight,
        audioMode, customAudioFilename, dialogueEndTime,
      });

      let promptId: string;
      try {
        const comfyRes = await axios.post(
          `${LTX_CONFIG.comfyuiUrl}/prompt`,
          { prompt: workflow },
          { timeout: 30_000, validateStatus: (s: number) => s < 500 },
        );
        if (comfyRes.status !== 200) {
          return res.status(502).send(error(`ComfyUI rejected prompt (attempt ${attempt}): ${JSON.stringify(comfyRes.data)}`));
        }
        promptId = comfyRes.data.prompt_id;
      } catch (err: any) {
        const msg = err.response?.data?.error?.message || err.response?.data?.node_errors || err.message || String(err);
        return res.status(502).send(error(`ComfyUI submit failed (attempt ${attempt}): ${msg}`));
      }

      // Poll until done
      const poll = await pollComfyUi(promptId, { pollTimeoutMs });
      if (poll.status !== "success") {
        attempts.push({ attempt, promptId, seed: currentSeed, status: "error", error: poll.error });
        return res.status(502).send(error(`Generation failed (attempt ${attempt}): ${poll.error}`));
      }

      // Find output video
      const file = findOutputVideo(poll.outputs!);
      if (!file) {
        attempts.push({ attempt, promptId, seed: currentSeed, status: "no_video" });
        return res.status(502).send(error(`No video in ComfyUI outputs (attempt ${attempt})`));
      }

      // Download and analyze (skip if silent mode = no audio)
      let bgmReport: any = null;
      if (audioMode !== "silent") {
        let localPath: string | null = null;
        try {
          localPath = await downloadOutput(file);
          bgmReport = await detectBgm(localPath, { threshold: bgmThreshold });
        } catch (err: any) {
          attempts.push({ attempt, promptId, seed: currentSeed, status: "bgm_check_failed", error: err.message });
          // BGM check failure shouldn't fail the whole request — return the video as-is
          return res.status(200).send(success({
            promptId, attempt, status: "bgm_check_failed",
            message: `Generation succeeded but BGM check errored: ${err.message}`,
            video: file,
            params: { width, height, numFrames, fps, seed: currentSeed, audioMode },
            attempts,
          }));
        } finally {
          if (localPath) { try { fs.unlinkSync(localPath); } catch {} }
        }
      } else {
        bgmReport = {
          has_bgm: false, confidence: 1.0, interpretation: "SILENT",
          note: "audioMode=silent; no audio stream produced",
        };
      }

      const accepted = !bgmReport.has_bgm;
      attempts.push({
        attempt, promptId, seed: currentSeed,
        status: accepted ? "accepted" : "rejected_bgm",
        music_pct: bgmReport.music_pct,
        confidence: bgmReport.confidence,
        video: file,
      });

      if (accepted || attempt >= maxAttempts) {
        const trimFrames = calcTrimFrames(uploadedFiles.length, msrFrameCount);
        return res.status(200).send(success({
          promptId,
          status: accepted ? "verified" : "bgm_failed",
          message: accepted
            ? `Video verified BGM-free on attempt ${attempt}/${maxAttempts}`
            : `BGM detected in all ${maxAttempts} attempts; returning last result`,
          attempt,
          accepted,
          video: file,
          bgm: bgmReport,
          refCount: uploadedFiles.length,
          audio: {
            mode: audioMode,
            hasAudioTrack: audioMode !== "silent",
            customAudio: customAudioFilename ? true : false,
          },
          params: {
            width, height, numFrames, fps, seed: currentSeed,
            msrFrameCount,
            trimFrames,
            trimSec: +(trimFrames / fps).toFixed(4),
          },
          attempts,
        }));
      }

      // BGM detected, prepare next seed
      currentSeed = Math.floor(Math.random() * 2147483647);
    }
    // Unreachable
  },
);

export default router;
