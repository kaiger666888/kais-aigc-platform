import express from "express";
import { WAN22_DEFAULTS } from "./config";

export function buildI2VWorkflow(opts: any) {
  const defaults = { ...opts, highNoiseModel: opts.highNoiseModel || WAN22_DEFAULTS.highNoiseModel, lowNoiseModel: opts.lowNoiseModel || WAN22_DEFAULTS.lowNoiseModel, textEncoder: opts.textEncoder || WAN22_DEFAULTS.textEncoder, vae: opts.vae || WAN22_DEFAULTS.vae };
  const { inputFilename, prompt, negativePrompt, width, height, numFrames, fps, seed, stepsStage1, stepsStage2, shift, samplerName, scheduler, filenamePrefix, crf } = defaults;
  const mid1 = Math.floor(stepsStage1 / 2), mid2 = Math.floor(stepsStage2 / 2);
  return {
    "1": { class_type: "CLIPLoader", inputs: { clip_name: defaults.textEncoder, type: "wan" } },
    "2": { class_type: "VAELoader", inputs: { vae_name: defaults.vae } },
    "3": { class_type: "UNETLoader", inputs: { unet_name: defaults.highNoiseModel, weight_dtype: "default" } },
    "4": { class_type: "UNETLoader", inputs: { unet_name: defaults.lowNoiseModel, weight_dtype: "default" } },
    "5": { class_type: "ModelSamplingSD3", inputs: { model: ["3", 0], shift } },
    "6": { class_type: "ModelSamplingSD3", inputs: { model: ["4", 0], shift } },
    "7": { class_type: "CLIPTextEncode", inputs: { text: prompt, clip: ["1", 0] } },
    "8": { class_type: "CLIPTextEncode", inputs: { text: negativePrompt, clip: ["1", 0] } },
    "9": { class_type: "LoadImage", inputs: { image: inputFilename, upload: "image" } },
    "10": { class_type: "WanImageToVideo", inputs: { positive: ["7", 0], negative: ["8", 0], vae: ["2", 0], width, height, length: numFrames, batch_size: 1, start_image: ["9", 0] } },
    "11": { class_type: "KSamplerAdvanced", inputs: { add_noise: "enable", noise_seed: seed, seed: 0, control_after_generate: "randomize", steps: stepsStage1, cfg: 1.0, sampler_name: samplerName, scheduler, start_at_step: 0, end_at_step: mid1, return_with_leftover_noise: "enable", model: ["5", 0], positive: ["10", 0], negative: ["10", 1], latent_image: ["10", 2] } },
    "12": { class_type: "KSamplerAdvanced", inputs: { add_noise: "disable", noise_seed: seed, seed: 0, control_after_generate: "fixed", steps: stepsStage2, cfg: 1.0, sampler_name: samplerName, scheduler, start_at_step: mid2, end_at_step: stepsStage2, return_with_leftover_noise: "disable", model: ["6", 0], positive: ["10", 0], negative: ["10", 1], latent_image: ["11", 0] } },
    "13": { class_type: "VAEDecode", inputs: { samples: ["12", 0], vae: ["2", 0] } },
    "14": { class_type: "VHS_VideoCombine", inputs: { images: ["13", 0], frame_rate: fps, loop_count: 0, filename_prefix: filenamePrefix, format: "video/h264-mp4", pix_fmt: "yuv420p", crf, save_metadata: true, trim_to_audio: false, pingpong: false, save_output: true } },
  };
}

export function buildT2VWorkflow(opts: any) {
  const defaults = { ...opts, highNoiseModel: opts.highNoiseModel || WAN22_DEFAULTS.t2vHighNoiseModel, lowNoiseModel: opts.lowNoiseModel || WAN22_DEFAULTS.t2vLowNoiseModel, textEncoder: opts.textEncoder || WAN22_DEFAULTS.textEncoder, vae: opts.vae || WAN22_DEFAULTS.vae };
  const { prompt, negativePrompt, width, height, numFrames, fps, seed, stepsStage1, stepsStage2, shift, samplerName, scheduler, filenamePrefix, crf } = defaults;
  const mid1 = Math.floor(stepsStage1 / 2), mid2 = Math.floor(stepsStage2 / 2);
  return {
    "1": { class_type: "CLIPLoader", inputs: { clip_name: defaults.textEncoder, type: "wan" } },
    "2": { class_type: "VAELoader", inputs: { vae_name: defaults.vae } },
    "3": { class_type: "UNETLoader", inputs: { unet_name: defaults.highNoiseModel, weight_dtype: "default" } },
    "4": { class_type: "UNETLoader", inputs: { unet_name: defaults.lowNoiseModel, weight_dtype: "default" } },
    "5": { class_type: "ModelSamplingSD3", inputs: { model: ["3", 0], shift } },
    "6": { class_type: "ModelSamplingSD3", inputs: { model: ["4", 0], shift } },
    "7": { class_type: "CLIPTextEncode", inputs: { text: prompt, clip: ["1", 0] } },
    "8": { class_type: "CLIPTextEncode", inputs: { text: negativePrompt, clip: ["1", 0] } },
    "9": { class_type: "WanImageToVideo", inputs: { positive: ["7", 0], negative: ["8", 0], vae: ["2", 0], width, height, length: numFrames, batch_size: 1 } },
    "10": { class_type: "KSamplerAdvanced", inputs: { add_noise: "enable", noise_seed: seed, seed: 0, control_after_generate: "randomize", steps: stepsStage1, cfg: 1.0, sampler_name: samplerName, scheduler, start_at_step: 0, end_at_step: mid1, return_with_leftover_noise: "enable", model: ["5", 0], positive: ["9", 0], negative: ["9", 1], latent_image: ["9", 2] } },
    "11": { class_type: "KSamplerAdvanced", inputs: { add_noise: "disable", noise_seed: seed, seed: 0, control_after_generate: "fixed", steps: stepsStage2, cfg: 1.0, sampler_name: samplerName, scheduler, start_at_step: mid2, end_at_step: stepsStage2, return_with_leftover_noise: "disable", model: ["6", 0], positive: ["9", 0], negative: ["9", 1], latent_image: ["10", 0] } },
    "12": { class_type: "VAEDecode", inputs: { samples: ["11", 0], vae: ["2", 0] } },
    "13": { class_type: "VHS_VideoCombine", inputs: { images: ["12", 0], frame_rate: fps, loop_count: 0, filename_prefix: filenamePrefix, format: "video/h264-mp4", pix_fmt: "yuv420p", crf, save_metadata: true, trim_to_audio: false, pingpong: false, save_output: true } },
  };
}

export function buildFFLFWorkflow(opts: any) {
  const defaults = { ...opts, highNoiseModel: opts.highNoiseModel || WAN22_DEFAULTS.highNoiseModel, lowNoiseModel: opts.lowNoiseModel || WAN22_DEFAULTS.lowNoiseModel, textEncoder: opts.textEncoder || WAN22_DEFAULTS.textEncoder, vae: opts.vae || WAN22_DEFAULTS.vae };
  const { firstFrameFilename, lastFrameFilename, prompt, negativePrompt, width, height, numFrames, fps, seed, stepsStage1, stepsStage2, shift, samplerName, scheduler, filenamePrefix, crf } = defaults;
  const mid1 = Math.floor(stepsStage1 / 2), mid2 = Math.floor(stepsStage2 / 2);
  return {
    "1": { class_type: "CLIPLoader", inputs: { clip_name: defaults.textEncoder, type: "wan" } },
    "2": { class_type: "VAELoader", inputs: { vae_name: defaults.vae } },
    "3": { class_type: "UNETLoader", inputs: { unet_name: defaults.highNoiseModel, weight_dtype: "default" } },
    "4": { class_type: "UNETLoader", inputs: { unet_name: defaults.lowNoiseModel, weight_dtype: "default" } },
    "5": { class_type: "ModelSamplingSD3", inputs: { model: ["3", 0], shift } },
    "6": { class_type: "ModelSamplingSD3", inputs: { model: ["4", 0], shift } },
    "7": { class_type: "CLIPTextEncode", inputs: { text: prompt, clip: ["1", 0] } },
    "8": { class_type: "CLIPTextEncode", inputs: { text: negativePrompt, clip: ["1", 0] } },
    "9": { class_type: "LoadImage", inputs: { image: firstFrameFilename, upload: "image" } },
    "10": { class_type: "LoadImage", inputs: { image: lastFrameFilename, upload: "image" } },
    "11": { class_type: "WanFirstLastFrameToVideo", inputs: { positive: ["7", 0], negative: ["8", 0], vae: ["2", 0], width, height, length: numFrames, batch_size: 1, start_image: ["9", 0], end_image: ["10", 0] } },
    "12": { class_type: "KSamplerAdvanced", inputs: { add_noise: "enable", noise_seed: seed, seed: 0, control_after_generate: "randomize", steps: stepsStage1, cfg: 1.0, sampler_name: samplerName, scheduler, start_at_step: 0, end_at_step: mid1, return_with_leftover_noise: "enable", model: ["5", 0], positive: ["11", 0], negative: ["11", 1], latent_image: ["11", 2] } },
    "13": { class_type: "KSamplerAdvanced", inputs: { add_noise: "disable", noise_seed: seed, seed: 0, control_after_generate: "fixed", steps: stepsStage2, cfg: 1.0, sampler_name: samplerName, scheduler, start_at_step: mid2, end_at_step: stepsStage2, return_with_leftover_noise: "disable", model: ["6", 0], positive: ["11", 0], negative: ["11", 1], latent_image: ["12", 0] } },
    "14": { class_type: "VAEDecode", inputs: { samples: ["13", 0], vae: ["2", 0] } },
    "15": { class_type: "VHS_VideoCombine", inputs: { images: ["14", 0], frame_rate: fps, loop_count: 0, filename_prefix: filenamePrefix, format: "video/h264-mp4", pix_fmt: "yuv420p", crf, save_metadata: true, trim_to_audio: false, pingpong: false, save_output: true } },
  };
}

export function buildMoveTrackWorkflow(opts: any) {
  const defaults = { ...opts, highNoiseModel: opts.highNoiseModel || WAN22_DEFAULTS.highNoiseModel, lowNoiseModel: opts.lowNoiseModel || WAN22_DEFAULTS.lowNoiseModel, textEncoder: opts.textEncoder || WAN22_DEFAULTS.textEncoder, vae: opts.vae || WAN22_DEFAULTS.vae };
  const { inputFilename, prompt, negativePrompt, width, height, numFrames, fps, seed, stepsStage1, stepsStage2, shift, samplerName, scheduler, strength, filenamePrefix, crf } = defaults;
  const mid1 = Math.floor(stepsStage1 / 2), mid2 = Math.floor(stepsStage2 / 2);
  return {
    "1": { class_type: "CLIPLoader", inputs: { clip_name: defaults.textEncoder, type: "wan" } },
    "2": { class_type: "VAELoader", inputs: { vae_name: defaults.vae } },
    "3": { class_type: "UNETLoader", inputs: { unet_name: defaults.highNoiseModel, weight_dtype: "default" } },
    "4": { class_type: "UNETLoader", inputs: { unet_name: defaults.lowNoiseModel, weight_dtype: "default" } },
    "5": { class_type: "ModelSamplingSD3", inputs: { model: ["3", 0], shift } },
    "6": { class_type: "ModelSamplingSD3", inputs: { model: ["4", 0], shift } },
    "7": { class_type: "CLIPTextEncode", inputs: { text: prompt, clip: ["1", 0] } },
    "8": { class_type: "CLIPTextEncode", inputs: { text: negativePrompt, clip: ["1", 0] } },
    "9": { class_type: "LoadImage", inputs: { image: inputFilename, upload: "image" } },
    "10": { class_type: "WanMoveTrackToVideo", inputs: { positive: ["7", 0], negative: ["8", 0], vae: ["2", 0], strength, width, height, length: numFrames, batch_size: 1, start_image: ["9", 0] } },
    "11": { class_type: "KSamplerAdvanced", inputs: { add_noise: "enable", noise_seed: seed, seed: 0, control_after_generate: "randomize", steps: stepsStage1, cfg: 1.0, sampler_name: samplerName, scheduler, start_at_step: 0, end_at_step: mid1, return_with_leftover_noise: "enable", model: ["5", 0], positive: ["10", 0], negative: ["10", 1], latent_image: ["10", 2] } },
    "12": { class_type: "KSamplerAdvanced", inputs: { add_noise: "disable", noise_seed: seed, seed: 0, control_after_generate: "fixed", steps: stepsStage2, cfg: 1.0, sampler_name: samplerName, scheduler, start_at_step: mid2, end_at_step: stepsStage2, return_with_leftover_noise: "disable", model: ["6", 0], positive: ["10", 0], negative: ["10", 1], latent_image: ["11", 0] } },
    "13": { class_type: "VAEDecode", inputs: { samples: ["12", 0], vae: ["2", 0] } },
    "14": { class_type: "VHS_VideoCombine", inputs: { images: ["13", 0], frame_rate: fps, loop_count: 0, filename_prefix: filenamePrefix, format: "video/h264-mp4", pix_fmt: "yuv420p", crf, save_metadata: true, trim_to_audio: false, pingpong: false, save_output: true } },
  };
}
