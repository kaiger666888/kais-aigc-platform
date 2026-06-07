export const WAN22_CONFIG = {
  comfyuiUrl: process.env.WAN22_COMFYUI_URL || process.env.COMFYUI_URL || "http://localhost:8188",
  containerName: process.env.WAN22_CONTAINER_NAME || "comfyui-primary",
  outputDir: process.env.OUTPUT_DIR || "/mnt/agents/output/gpu1",
  comfyuiInputDir: "/root/ComfyUI/input",
  comfyuiOutputDir: "/root/ComfyUI/output",
  pollIntervalMs: 2000,
  pollTimeoutMs: 600_000,
};

export const WAN22_DEFAULTS = {
  // Diffusion models
  highNoiseModel: "wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors",
  lowNoiseModel: "wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors",
  t2vHighNoiseModel: "wan2.2_t2v_high_noise_14B_fp8_scaled.safetensors",
  t2vLowNoiseModel: "wan2.2_t2v_low_noise_14B_fp8_scaled.safetensors",
  // Text encoder
  textEncoder: "umt5_xxl_fp8_e4m3fn_scaled.safetensors",
  textEncoderType: "wan",
  // VAE
  vae: "wan_2.1_vae.safetensors",
  // Two-stage sampling
  samplerName: "euler",
  scheduler: "simple",
  shift: 5.0,
  // Output
  fps: 16,
  crf: 19,
};

// NOTE: exported as route handler (no-op) because auto-router scans all .ts in routes/
export default function wan22ConfigRoute() { /* config-only, no HTTP handler */ }
