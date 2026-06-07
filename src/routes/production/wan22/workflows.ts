import { WAN22_DEFAULTS } from "./config";

/**
 * Build Wan 2.2 I2V Two-Stage workflow
 * WanImageToVideo + KSamplerAdvanced (stage1 high_noise, stage2 low_noise)
 *
 * Based on official ComfyUI blueprint: Image to Video (Wan 2.2).json
 */
export function buildI2VWorkflow(opts: {
  inputFilename: string;
  prompt: string;
  negativePrompt: string;
  width: number;
  height: number;
  numFrames: number;
  fps: number;
  seed: number;
  stepsStage1: number;
  stepsStage2: number;
  shift: number;
  samplerName: string;
  scheduler: string;
  filenamePrefix: string;
  crf: number;
  highNoiseModel?: string;
  lowNoiseModel?: string;
  textEncoder?: string;
  vae?: string;
}) {
  const {
    inputFilename, prompt, negativePrompt,
    width, height, numFrames, fps, seed,
    stepsStage1, stepsStage2, shift,
    samplerName, scheduler,
    filenamePrefix, crf,
    highNoiseModel = WAN22_DEFAULTS.highNoiseModel,
    lowNoiseModel = WAN22_DEFAULTS.lowNoiseModel,
    textEncoder = WAN22_DEFAULTS.textEncoder,
    vae = WAN22_DEFAULTS.vae,
  } = opts;

  return {
    // ── Loaders ──
    "1": { class_type: "CLIPLoader", inputs: { clip_name: textEncoder, type: "wan" } },
    "2": { class_type: "VAELoader", inputs: { vae_name: vae } },
    "3": { class_type: "UNETLoader", inputs: { unet_name: highNoiseModel, weight_dtype: "default" } },
    "4": { class_type: "UNETLoader", inputs: { unet_name: lowNoiseModel, weight_dtype: "default" } },
    "5": { class_type: "ModelSamplingSD3", inputs: { model: ["3", 0], shift } },
    "6": { class_type: "ModelSamplingSD3", inputs: { model: ["4", 0], shift } },
    // ── Conditioning ──
    "7": { class_type: "CLIPTextEncode", inputs: { text: prompt, clip: ["1", 0] } },
    "8": { class_type: "CLIPTextEncode", inputs: { text: negativePrompt, clip: ["1", 0] } },
    // ── Latent (I2V with start_image) ──
    "9": { class_type: "LoadImage", inputs: { image: inputFilename, upload: "image" } },
    "10": {
      class_type: "WanImageToVideo",
      inputs: {
        positive: ["7", 0], negative: ["8", 0], vae: ["2", 0],
        width, height, length: numFrames, batch_size: 1,
        start_image: ["9", 0],
      },
    },
    // ── Stage 1: High Noise (first half timesteps) ──
    "11": {
      class_type: "KSamplerAdvanced",
      inputs: {
        add_noise: "enable", noise_seed: seed, seed: 0,
        control_after_generate: "randomize",
        steps: stepsStage1, cfg: 1.0,
        sampler_name: samplerName, scheduler,
        start_at_step: 0, end_at_step: Math.floor(stepsStage1 / 2),
        return_with_leftover_noise: "enable",
        model: ["5", 0],
        positive: ["10", 0], negative: ["10", 1],
        latent_image: ["10", 2],
      },
    },
    // ── Stage 2: Low Noise (second half timesteps) ──
    "12": {
      class_type: "KSamplerAdvanced",
      inputs: {
        add_noise: "disable", noise_seed: seed, seed: 0,
        control_after_generate: "fixed",
        steps: stepsStage2, cfg: 1.0,
        sampler_name: samplerName, scheduler,
        start_at_step: Math.floor(stepsStage2 / 2), end_at_step: stepsStage2,
        return_with_leftover_noise: "disable",
        model: ["6", 0],
        positive: ["10", 0], negative: ["10", 1],
        latent_image: ["11", 0],
      },
    },
    // ── Decode & Output ──
    "13": { class_type: "VAEDecode", inputs: { samples: ["12", 0], vae: ["2", 0] } },
    "14": {
      class_type: "VHS_VideoCombine",
      inputs: {
        images: ["13", 0], frame_rate: fps, loop_count: 0,
        filename_prefix: filenamePrefix, format: "video/h264-mp4",
        pix_fmt: "yuv420p", crf, save_metadata: true,
        trim_to_audio: false, pingpong: false, save_output: true,
      },
    },
  };
}

/**
 * Build Wan 2.2 T2V Two-Stage workflow
 * Same as I2V but WITHOUT start_image (pure text-to-video)
 */
export function buildT2VWorkflow(opts: {
  prompt: string;
  negativePrompt: string;
  width: number;
  height: number;
  numFrames: number;
  fps: number;
  seed: number;
  stepsStage1: number;
  stepsStage2: number;
  shift: number;
  samplerName: string;
  scheduler: string;
  filenamePrefix: string;
  crf: number;
  highNoiseModel?: string;
  lowNoiseModel?: string;
  textEncoder?: string;
  vae?: string;
}) {
  const {
    prompt, negativePrompt,
    width, height, numFrames, fps, seed,
    stepsStage1, stepsStage2, shift,
    samplerName, scheduler,
    filenamePrefix, crf,
    highNoiseModel = WAN22_DEFAULTS.t2vHighNoiseModel,
    lowNoiseModel = WAN22_DEFAULTS.t2vLowNoiseModel,
    textEncoder = WAN22_DEFAULTS.textEncoder,
    vae = WAN22_DEFAULTS.vae,
  } = opts;

  return {
    "1": { class_type: "CLIPLoader", inputs: { clip_name: textEncoder, type: "wan" } },
    "2": { class_type: "VAELoader", inputs: { vae_name: vae } },
    "3": { class_type: "UNETLoader", inputs: { unet_name: highNoiseModel, weight_dtype: "default" } },
    "4": { class_type: "UNETLoader", inputs: { unet_name: lowNoiseModel, weight_dtype: "default" } },
    "5": { class_type: "ModelSamplingSD3", inputs: { model: ["3", 0], shift } },
    "6": { class_type: "ModelSamplingSD3", inputs: { model: ["4", 0], shift } },
    "7": { class_type: "CLIPTextEncode", inputs: { text: prompt, clip: ["1", 0] } },
    "8": { class_type: "CLIPTextEncode", inputs: { text: negativePrompt, clip: ["1", 0] } },
    // T2V: WanImageToVideo WITHOUT start_image
    "9": {
      class_type: "WanImageToVideo",
      inputs: {
        positive: ["7", 0], negative: ["8", 0], vae: ["2", 0],
        width, height, length: numFrames, batch_size: 1,
      },
    },
    "10": {
      class_type: "KSamplerAdvanced",
      inputs: {
        add_noise: "enable", noise_seed: seed, seed: 0,
        control_after_generate: "randomize",
        steps: stepsStage1, cfg: 1.0,
        sampler_name: samplerName, scheduler,
        start_at_step: 0, end_at_step: Math.floor(stepsStage1 / 2),
        return_with_leftover_noise: "enable",
        model: ["5", 0],
        positive: ["9", 0], negative: ["9", 1],
        latent_image: ["9", 2],
      },
    },
    "11": {
      class_type: "KSamplerAdvanced",
      inputs: {
        add_noise: "disable", noise_seed: seed, seed: 0,
        control_after_generate: "fixed",
        steps: stepsStage2, cfg: 1.0,
        sampler_name: samplerName, scheduler,
        start_at_step: Math.floor(stepsStage2 / 2), end_at_step: stepsStage2,
        return_with_leftover_noise: "disable",
        model: ["6", 0],
        positive: ["9", 0], negative: ["9", 1],
        latent_image: ["10", 0],
      },
    },
    "12": { class_type: "VAEDecode", inputs: { samples: ["11", 0], vae: ["2", 0] } },
    "13": {
      class_type: "VHS_VideoCombine",
      inputs: {
        images: ["12", 0], frame_rate: fps, loop_count: 0,
        filename_prefix: filenamePrefix, format: "video/h264-mp4",
        pix_fmt: "yuv420p", crf, save_metadata: true,
        trim_to_audio: false, pingpong: false, save_output: true,
      },
    },
  };
}

/**
 * Build Wan 2.2 First-Last Frame Interpolation workflow
 * Given first + last frame, AI generates intermediate video
 */
export function buildFFLFWorkflow(opts: {
  firstFrameFilename: string;
  lastFrameFilename: string;
  prompt: string;
  negativePrompt: string;
  width: number;
  height: number;
  numFrames: number;
  fps: number;
  seed: number;
  stepsStage1: number;
  stepsStage2: number;
  shift: number;
  samplerName: string;
  scheduler: string;
  filenamePrefix: string;
  crf: number;
  highNoiseModel?: string;
  lowNoiseModel?: string;
  textEncoder?: string;
  vae?: string;
}) {
  const {
    firstFrameFilename, lastFrameFilename, prompt, negativePrompt,
    width, height, numFrames, fps, seed,
    stepsStage1, stepsStage2, shift,
    samplerName, scheduler,
    filenamePrefix, crf,
    highNoiseModel = WAN22_DEFAULTS.highNoiseModel,
    lowNoiseModel = WAN22_DEFAULTS.lowNoiseModel,
    textEncoder = WAN22_DEFAULTS.textEncoder,
    vae = WAN22_DEFAULTS.vae,
  } = opts;

  return {
    "1": { class_type: "CLIPLoader", inputs: { clip_name: textEncoder, type: "wan" } },
    "2": { class_type: "VAELoader", inputs: { vae_name: vae } },
    "3": { class_type: "UNETLoader", inputs: { unet_name: highNoiseModel, weight_dtype: "default" } },
    "4": { class_type: "UNETLoader", inputs: { unet_name: lowNoiseModel, weight_dtype: "default" } },
    "5": { class_type: "ModelSamplingSD3", inputs: { model: ["3", 0], shift } },
    "6": { class_type: "ModelSamplingSD3", inputs: { model: ["4", 0], shift } },
    "7": { class_type: "CLIPTextEncode", inputs: { text: prompt, clip: ["1", 0] } },
    "8": { class_type: "CLIPTextEncode", inputs: { text: negativePrompt, clip: ["1", 0] } },
    "9": { class_type: "LoadImage", inputs: { image: firstFrameFilename, upload: "image" } },
    "10": { class_type: "LoadImage", inputs: { image: lastFrameFilename, upload: "image" } },
    "11": {
      class_type: "WanFirstLastFrameToVideo",
      inputs: {
        positive: ["7", 0], negative: ["8", 0], vae: ["2", 0],
        width, height, length: numFrames, batch_size: 1,
        start_image: ["9", 0], end_image: ["10", 0],
      },
    },
    "12": {
      class_type: "KSamplerAdvanced",
      inputs: {
        add_noise: "enable", noise_seed: seed, seed: 0,
        control_after_generate: "randomize",
        steps: stepsStage1, cfg: 1.0,
        sampler_name: samplerName, scheduler,
        start_at_step: 0, end_at_step: Math.floor(stepsStage1 / 2),
        return_with_leftover_noise: "enable",
        model: ["5", 0],
        positive: ["11", 0], negative: ["11", 1],
        latent_image: ["11", 2],
      },
    },
    "13": {
      class_type: "KSamplerAdvanced",
      inputs: {
        add_noise: "disable", noise_seed: seed, seed: 0,
        control_after_generate: "fixed",
        steps: stepsStage2, cfg: 1.0,
        sampler_name: samplerName, scheduler,
        start_at_step: Math.floor(stepsStage2 / 2), end_at_step: stepsStage2,
        return_with_leftover_noise: "disable",
        model: ["6", 0],
        positive: ["11", 0], negative: ["11", 1],
        latent_image: ["12", 0],
      },
    },
    "14": { class_type: "VAEDecode", inputs: { samples: ["13", 0], vae: ["2", 0] } },
    "15": {
      class_type: "VHS_VideoCombine",
      inputs: {
        images: ["14", 0], frame_rate: fps, loop_count: 0,
        filename_prefix: filenamePrefix, format: "video/h264-mp4",
        pix_fmt: "yuv420p", crf, save_metadata: true,
        trim_to_audio: false, pingpong: false, save_output: true,
      },
    },
  };
}

/**
 * Build Wan 2.2 Move Track workflow
 * Character image + optional move track → character motion video
 */
export function buildMoveTrackWorkflow(opts: {
  inputFilename: string;
  prompt: string;
  negativePrompt: string;
  width: number;
  height: number;
  numFrames: number;
  fps: number;
  seed: number;
  stepsStage1: number;
  stepsStage2: number;
  shift: number;
  samplerName: string;
  scheduler: string;
  strength: number;
  filenamePrefix: string;
  crf: number;
  highNoiseModel?: string;
  lowNoiseModel?: string;
  textEncoder?: string;
  vae?: string;
}) {
  const {
    inputFilename, prompt, negativePrompt,
    width, height, numFrames, fps, seed,
    stepsStage1, stepsStage2, shift,
    samplerName, scheduler, strength,
    filenamePrefix, crf,
    highNoiseModel = WAN22_DEFAULTS.highNoiseModel,
    lowNoiseModel = WAN22_DEFAULTS.lowNoiseModel,
    textEncoder = WAN22_DEFAULTS.textEncoder,
    vae = WAN22_DEFAULTS.vae,
  } = opts;

  return {
    "1": { class_type: "CLIPLoader", inputs: { clip_name: textEncoder, type: "wan" } },
    "2": { class_type: "VAELoader", inputs: { vae_name: vae } },
    "3": { class_type: "UNETLoader", inputs: { unet_name: highNoiseModel, weight_dtype: "default" } },
    "4": { class_type: "UNETLoader", inputs: { unet_name: lowNoiseModel, weight_dtype: "default" } },
    "5": { class_type: "ModelSamplingSD3", inputs: { model: ["3", 0], shift } },
    "6": { class_type: "ModelSamplingSD3", inputs: { model: ["4", 0], shift } },
    "7": { class_type: "CLIPTextEncode", inputs: { text: prompt, clip: ["1", 0] } },
    "8": { class_type: "CLIPTextEncode", inputs: { text: negativePrompt, clip: ["1", 0] } },
    "9": { class_type: "LoadImage", inputs: { image: inputFilename, upload: "image" } },
    "10": {
      class_type: "WanMoveTrackToVideo",
      inputs: {
        positive: ["7", 0], negative: ["8", 0], vae: ["2", 0],
        strength,
        width, height, length: numFrames, batch_size: 1,
        start_image: ["9", 0],
      },
    },
    "11": {
      class_type: "KSamplerAdvanced",
      inputs: {
        add_noise: "enable", noise_seed: seed, seed: 0,
        control_after_generate: "randomize",
        steps: stepsStage1, cfg: 1.0,
        sampler_name: samplerName, scheduler,
        start_at_step: 0, end_at_step: Math.floor(stepsStage1 / 2),
        return_with_leftover_noise: "enable",
        model: ["5", 0],
        positive: ["10", 0], negative: ["10", 1],
        latent_image: ["10", 2],
      },
    },
    "12": {
      class_type: "KSamplerAdvanced",
      inputs: {
        add_noise: "disable", noise_seed: seed, seed: 0,
        control_after_generate: "fixed",
        steps: stepsStage2, cfg: 1.0,
        sampler_name: samplerName, scheduler,
        start_at_step: Math.floor(stepsStage2 / 2), end_at_step: stepsStage2,
        return_with_leftover_noise: "disable",
        model: ["6", 0],
        positive: ["10", 0], negative: ["10", 1],
        latent_image: ["11", 0],
      },
    },
    "13": { class_type: "VAEDecode", inputs: { samples: ["12", 0], vae: ["2", 0] } },
    "14": {
      class_type: "VHS_VideoCombine",
      inputs: {
        images: ["13", 0], frame_rate: fps, loop_count: 0,
        filename_prefix: filenamePrefix, format: "video/h264-mp4",
        pix_fmt: "yuv420p", crf, save_metadata: true,
        trim_to_audio: false, pingpong: false, save_output: true,
      },
    },
  };
}
