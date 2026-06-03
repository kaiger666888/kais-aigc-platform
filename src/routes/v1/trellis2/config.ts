export const TRELLIS2_CONFIG = {
  comfyuiUrl: process.env.TRELLIS2_COMFYUI_URL || "http://localhost:8189",
  containerName: process.env.TRELLIS2_CONTAINER_NAME || "comfyui-trellis",
  outputDir: process.env.OUTPUT_DIR || "/mnt/agents/output",
  comfyuiInputDir: "/app/ComfyUI/input",
  comfyuiOutputDir: "/app/ComfyUI/output",
};
