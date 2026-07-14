import { SCAIL2_DEFAULTS } from "./scail2-config";

/**
 * 构建 SCAIL2 工作流（角色替换 / 动作迁移共用核心逻辑）
 *
 * 基于 ComfyUI 核心 WanSCAILToVideo 节点 (comfy_extras/nodes_wan.py)
 */
function buildSCAIL2Workflow(opts: any, isReplace: boolean) {
  const defaults = {
    ...opts,
    scailModel: opts.scailModel || SCAIL2_DEFAULTS.scailModel,
    lightx2vLora: opts.lightx2vLora || SCAIL2_DEFAULTS.lightx2vLora,
    relightLora: opts.relightLora || SCAIL2_DEFAULTS.relightLora,
    textEncoder: opts.textEncoder || SCAIL2_DEFAULTS.textEncoder,
    clipVision: opts.clipVision || SCAIL2_DEFAULTS.clipVision,
    vae: opts.vae || SCAIL2_DEFAULTS.vae,
  };

  const {
    poseVideoFilename, referenceImageFilename,
    prompt, negativePrompt,
    width, height, numFrames, fps, seed, steps, shift,
    lightx2vStrength, relightStrength,
    filenamePrefix, crf,
  } = defaults;

  // ── 模型加载链 ──
  const loraChain: Record<string, any> = {
    "1": { class_type: "UNETLoader", inputs: { unet_name: defaults.scailModel, weight_dtype: "default" } },
    "2": { class_type: "LoraLoaderModelOnly", inputs: { model: ["1", 0], lora_name: defaults.lightx2vLora, strength_model: lightx2vStrength } },
  };

  let modelRef: [string, number] = ["2", 0];
  if (defaults.relightLora) {
    loraChain["3"] = { class_type: "LoraLoaderModelOnly", inputs: { model: ["2", 0], lora_name: defaults.relightLora, strength_model: relightStrength } };
    modelRef = ["3", 0];
  }

  // ModelSamplingSD3: shift 参数
  loraChain["4"] = { class_type: "ModelSamplingSD3", inputs: { model: [modelRef[0], 0], shift: shift ?? 5.0 } };

  return {
    ...loraChain,

    // ── 文本编码器与 CLIP Vision ──
    "6": { class_type: "CLIPLoader", inputs: { clip_name: defaults.textEncoder, type: "wan" } },
    "7": { class_type: "CLIPVisionLoader", inputs: { clip_name: defaults.clipVision } },
    "8": { class_type: "VAELoader", inputs: { vae_name: defaults.vae } },

    // ── 文本编码 ──
    "10": { class_type: "CLIPTextEncode", inputs: { text: prompt, clip: ["6", 0] } },
    "11": { class_type: "CLIPTextEncode", inputs: { text: negativePrompt, clip: ["6", 0] } },

    // ── CLIP Vision Encode (参考图) — 需要 crop 参数 ──
    "12": { class_type: "CLIPVisionEncode", inputs: { clip_vision: ["7", 0], image: ["13", 0], crop: "center" } },

    // ── 输入加载 ──
    "13": { class_type: "LoadImage", inputs: { image: referenceImageFilename } },
    // VHS_LoadVideo 需要 custom_width/custom_height
    "15": { class_type: "VHS_LoadVideo", inputs: {
      video: poseVideoFilename, force_rate: 0,
      custom_width: width, custom_height: height,
      frame_load_cap: numFrames, skip_first_frames: 0, select_every_nth: 1,
    } },

    // ── WanSCAILToVideo: 构建 conditioning + latent ──
    "20": {
      class_type: "WanSCAILToVideo", inputs: {
        positive: ["10", 0], negative: ["11", 0], vae: ["8", 0],
        clip_vision_output: ["12", 0],
        reference_image: ["13", 0],
        pose_video: ["15", 0],
        width, height, length: numFrames, batch_size: 1,
        pose_strength: 1.0, pose_start: 0.0, pose_end: 1.0,
      },
    },

    // ── 采样器 ──
    "18": { class_type: "BasicScheduler", inputs: { model: ["4", 0], scheduler: SCAIL2_DEFAULTS.scheduler, steps, denoise: 1.0 } },
    "19": { class_type: "KSamplerSelect", inputs: { sampler_name: SCAIL2_DEFAULTS.samplerName } },
    "21": {
      class_type: "SamplerCustom", inputs: {
        model: ["4", 0], add_noise: true, noise_seed: seed, cfg: 1,
        positive: ["20", 0], negative: ["20", 1], latent_image: ["20", 2],
        sampler: ["19", 0], sigmas: ["18", 0],
      },
    },

    // ── 后处理与输出 ──
    "26": { class_type: "VAEDecode", inputs: { samples: ["21", 0], vae: ["8", 0] } },
    "28": { class_type: "VHS_VideoCombine", inputs: {
      images: ["26", 0], frame_rate: fps, loop_count: 0, filename_prefix: filenamePrefix,
      format: "video/h264-mp4", pingpong: false, save_output: true,
    } },
  };
}

export function buildSCAIL2ReplaceWorkflow(opts: any) {
  return buildSCAIL2Workflow(opts, true);
}

export function buildSCAIL2TransferWorkflow(opts: any) {
  return buildSCAIL2Workflow(opts, false);
}
