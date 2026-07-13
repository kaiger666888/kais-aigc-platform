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
function buildMSRWorkflow(opts: {
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
  audioMode?: string;           // "dialogue+ambient" (default), "ambient_only", "silent", "auto"
  customAudioFilename?: string; // 自定义音频文件名（已在ComfyUI容器内），提供时冻结该音频到输出视频
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

  // 音频引导词 — 注入到 prompt 和 negative prompt 中
  const AUDIO_GUIDES: Record<string, { positive: string; negative: string }> = {
    "dialogue+ambient": {
      positive: "natural ambient sounds, footsteps, clothing rustle, environmental audio, character dialogue speech",
      negative: "background music, BGM, soundtrack, musical instruments, melody, singing, theme song",
    },
    "ambient_only": {
      positive: "natural ambient sounds, footsteps, clothing rustle, environmental audio, wind, room tone",
      negative: "background music, BGM, soundtrack, musical instruments, melody, singing, speech, dialogue, voices",
    },
    "silent": {
      positive: "",
      negative: "background music, BGM, soundtrack, musical instruments, melody, singing, speech, voices, ambient sounds",
    },
    "auto": {
      positive: "",
      negative: "",
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
    // === Model & Text Encoder ===
    "3": {
      class_type: "LowVRAMCheckpointLoader",
      inputs: { ckpt_name: LTX_DEFAULTS.msrModelName },
    },
    "26": {
      class_type: "LTXAVTextEncoderLoader",
      inputs: {
        text_encoder: LTX_DEFAULTS.clipName1,
        ckpt_name: LTX_DEFAULTS.msrModelName,
        device: "default",
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
          vae: ["3", 2],
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

    // === Audio VAE ===
    "21": {
      class_type: "LTXVAudioVAELoader",
      inputs: { ckpt_name: LTX_DEFAULTS.msrModelName },
    },

    // === Custom Audio (冻结音频参考) ===
    // 借鉴 LTX2.3-MSR全能参考工作流的音频冻结机制:
    // LoadAudio → AudioVAEEncode → SetLatentNoiseMask(SolidMask=0) → ConcatAVLatent
    // SolidMask=0 冻结音频区域, 采样时不修改音频, 相当于"强制"输出指定音频
    ...(customAudio ? {
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
        vae: ["3", 2],
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
    // 有自定义音频时: 用冻结的音频latent (node 63)
    // 无自定义音频时: 用空音频latent (node 22), LTX模型自己生成音频
    "23": {
      class_type: "LTXVConcatAVLatent",
      inputs: {
        video_latent: [guideOutNode, 2],
        audio_latent: customAudio ? ["63", 0] : ["22", 0],
      },
    },

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
        latent_image: ["23", 0],
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
      inputs: { samples: ["17", 2], vae: ["3", 2] },
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

export default router.post(
  "/",
  upload.fields([
    { name: "ref1", maxCount: 1 },
    { name: "ref2", maxCount: 1 },
    { name: "ref3", maxCount: 1 },
    { name: "ref4", maxCount: 1 },
    { name: "ref5", maxCount: 1 },
    { name: "audio", maxCount: 1 },
  ]),
  validateFields({
    projectId: z.coerce.number(),
    prompt: z.string().min(1),
  }),
  async (req, res) => {
    // --- Parse user-facing params ---
    const projectId = Number(req.body.projectId);
    const prompt = req.body.prompt as string;
    const duration = Number(req.body.duration) || 3;
    const fps = Number(req.body.fps) || 24;
    const width = Number(req.body.width) || 1280;
    const height = Number(req.body.height) || 704;
    const negativePrompt = req.body.negativePrompt as string
      || "worst quality, blurry, jittery, distorted, inconsistent appearance";
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
