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

const router = express.Router();
export default router;
