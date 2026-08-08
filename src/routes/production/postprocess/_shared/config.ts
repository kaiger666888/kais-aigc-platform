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

// RTX 3090 24GB 最优默认值（2026-07-23 实测验证：无重影/纹理跳/边界顿）
// 关键:batch 必须 4n+1(SeedVR2 时序注意力按4帧一组);显存用 BlockSwap+VAE分块换,绝不砍 batch
export const SEEDVR2_DEFAULTS = {
  device: "cuda:0",
  offloadDevice: "cpu",      // blocksToSwap>0 时 block 卸到 CPU
  blocksToSwap: 28,          // 7B 1080p 在 24GB 必须(配大 batch);不开则 DiT 峰值超 24GB OOM
  encodeTiled: true,         // VAE 分块编解码,降峰值(不开 1080p 必 OOM)
  decodeTiled: true,
  tileSize: 512,             // VAE 分块尺寸
  resolution: 1080,
  maxResolution: 1920,
  batchSizeImage: 1,         // 4n+1, n=0
  batchSizeVideo: 41,        // 4n+1, >40 消纹理 flicker(21 会残留跳变)
  temporalOverlap: 8,        // 平滑 batch 边界(4 会有"中间顿一帧")
  colorCorrection: "lab" as
    | "lab"
    | "wavelet"
    | "wavelet_adaptive"
    | "hsv"
    | "adain"
    | "none",
  uniformBatchSize: true,    // 批帧数一致,避免残批打乱节奏
  seed: 42,
} as const;

// ─── RTX VSR (NVIDIA RTX Video Super Resolution) ─────────────────────
// ⚠️ 用途规范（2026-08-08 定量测试结论，务必遵守）
//
// RTX VSR 是 NVIDIA 为【真实视频流】设计的【插值超分】，不生成新细节：
//   - 本质：修复压缩损失（低码率马赛克/块效应），不是扩散超分
//   - 实测：对 AI 生成视频 SSIM(原始 vs VSR降回原分辨率)=0.964（零新信息）
//           PSNR=40.2 dB（只是插值放大），清晰度比值 0.81×（反而更糊）
//           全尺寸(5376×3072)清晰度仅 3.1 vs 原始 30.9 → 低分辨率硬拉大
//
// ✅ 适用场景（保留的能力）：
//   - 真实视频/摄像头画面的超分放大（监控视频增强等）
//   - 高码率压缩视频清晰度恢复（HIGHBITRATE_* 模式）
//   - 视频去噪（DENOISE_* 模式）/ 去模糊（DEBLUR_* 模式）
//   - 需要快速处理（~450fps on 3090）的场景
//
// ❌ 不适用场景（禁止）：
//   - AI 生成视频（H3/LTX/Wan 等）超分放大 → 无实质清晰度提升，用 SeedVR2 替代
//   - 修复 AI 生成视频画面崩坏（面部扭曲/肢体变形）→ 应增加 sampling steps，非超分
//   - P11/P12 管线视频后处理超分 → 用 SeedVR2 扩散超分替代
//
// 独立 FastAPI 微服务，运行在 comfyui-primary 容器 :10589
// VRAM 占用仅 ~13MB，不阻塞 ComfyUI 渲染队列
// 宿主机访问: http://localhost:10589 (socat 转发)
export const RTX_VSR_CONFIG = {
  serviceUrl: process.env.RTX_VSR_URL || "http://localhost:10589",
  outputDir: "/mnt/agents/output/gpu1/rtx-vsr",
  webBaseUrl: process.env.WEB_BASE_URL || "http://localhost:8082/gpu1/rtx-vsr",
  qualities: [
    "LOW", "MEDIUM", "HIGH", "ULTRA",
    "HIGHBITRATE_LOW", "HIGHBITRATE_MEDIUM", "HIGHBITRATE_HIGH", "HIGHBITRATE_ULTRA",
    "DENOISE_LOW", "DENOISE_MEDIUM", "DENOISE_HIGH", "DENOISE_ULTRA",
    "DEBLUR_LOW", "DEBLUR_MEDIUM", "DEBLUR_HIGH", "DEBLUR_ULTRA",
  ] as const,
} as const;

export type SeedVR2ColorCorrection = typeof SEEDVR2_DEFAULTS.colorCorrection;
