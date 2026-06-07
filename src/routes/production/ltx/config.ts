export const LTX_CONFIG = {
  comfyuiUrl: process.env.LTX_COMFYUI_URL || process.env.COMFYUI_URL || "http://localhost:8188",
  containerName: process.env.LTX_CONTAINER_NAME || "comfyui-ltx",
  outputDir: process.env.OUTPUT_DIR || "/mnt/agents/output",
  comfyuiInputDir: "/app/ComfyUI/input",
  comfyuiOutputDir: "/app/ComfyUI/output",
  pollIntervalMs: 2000,
  pollTimeoutMs: 600_000, // 10 min
};

export const LTX_DEFAULTS = {
  modelName: "ltx-2.3-22b-distilled-mxfp8.safetensors",
  clipName1: "gemma_3_12B_it_fp8_scaled.safetensors",
  clipName2: "ltx-2.3_text_projection_bf16.safetensors",
  vaeName: "ltx2_vae/LTX23_video_vae_bf16.safetensors",
  loraName: "ltx-2.3-22b-distilled-lora-384-1.1.safetensors",
};

// NOTE: exported as route handler (no-op) because auto-router scans all .ts in routes/
export default function configRoute() { /* config-only, no HTTP handler */ }
