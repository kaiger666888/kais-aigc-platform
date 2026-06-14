export const LTX_CONFIG = {
  comfyuiUrl: process.env.LTX_COMFYUI_URL || process.env.COMFYUI_URL || "http://localhost:8188",
  containerName: process.env.LTX_CONTAINER_NAME || "comfyui-primary",
  outputDir: process.env.OUTPUT_DIR || "/mnt/agents/output",
  comfyuiInputDir: "/root/ComfyUI/input",
  comfyuiOutputDir: "/root/ComfyUI/output",
  pollIntervalMs: 2000,
  pollTimeoutMs: 600_000, // 10 min
};

export const LTX_DEFAULTS = {
  modelName: "ltx-2.3-22b-distilled-mxfp8.safetensors",
  clipName1: "gemma_3_12B_it_fp8_scaled.safetensors",
  clipName2: "ltx-2.3_text_projection_bf16.safetensors",
  vaeName: "ltx2_vae/LTX23_video_vae_bf16.safetensors",
  loraName: "ltx-2.3-22b-distilled-lora-384-1.1.safetensors",
  msrLoraName: "LTX-2.3-Licon-MSR-V1.safetensors",
  msrModelName: "ltx-2.3-22b-distilled-1.1.safetensors",
};
