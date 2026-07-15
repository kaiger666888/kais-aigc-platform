import express from "express";

export const POSTPROCESS_CONFIG = {
  comfyuiUrl: process.env.COMFYUI_URL || "http://localhost:8188",
  containerName: "comfyui-primary",
  outputDir: process.env.OUTPUT_DIR || "/mnt/agents/output/gpu1",
  comfyuiInputDir: "/root/ComfyUI/input",
  comfyuiOutputDir: "/root/ComfyUI/output",
  pollIntervalMs: 2000,
  pollTimeoutMs: 300_000,
};

export const POSTPROCESS_MODELS = {
  codeformer: "codeformer.pth",
  gfpgan: "GFPGANv1.4.pth",
  ultrasharp: "4x-UltraSharp.pth",
  realesrgan: "RealESRGAN_x4plus.pth",
  faceDetection: "retinaface_resnet50",
} as const;

export type PostprocessStep =
  | "codeformer"
  | "depth"
  | "ultrasharp"
  | "realesrgan";

// ─── SeedVR2 扩散超分引擎 ───────────────────────────
// 节点：numz/ComfyUI-SeedVR2_VideoUpscaler（同时处理单图和视频）
// 模型目录：/data/models/comfyui/SEEDVR2/（DiT 和 VAE 都放这里，非 diffusion_models/ 或 vae/）
export const SEEDVR2_MODELS = {
  dit: "seedvr2_ema_7b_fp16.safetensors",
  ditSharp: "seedvr2_ema_7b_sharp_fp16.safetensors",
  dit3b: "seedvr2_ema_3b_fp16.safetensors",
  ditFp8: "seedvr2_ema_7b_fp8_e4m3fn_mixed_block35_fp16.safetensors",
  vae: "ema_vae_fp16.safetensors",
} as const;

// RTX 3090 24GB 最优默认值
export const SEEDVR2_DEFAULTS = {
  device: "cuda:0",
  offloadDevice: "none",
  blocksToSwap: 0,
  encodeTiled: false,
  decodeTiled: false,
  resolution: 1080,
  maxResolution: 1920,
  batchSizeImage: 1,        // 4n+1, n=0
  batchSizeVideo: 21,      // 4n+1, n=5（3090 24GB 处理 1080p 稳定）
  temporalOverlap: 4,
  colorCorrection: "lab" as
    | "lab"
    | "wavelet"
    | "wavelet_adaptive"
    | "hsv"
    | "adain"
    | "none",
  uniformBatchSize: false,
  seed: 42,
} as const;

export type SeedVR2ColorCorrection = typeof SEEDVR2_DEFAULTS.colorCorrection;
