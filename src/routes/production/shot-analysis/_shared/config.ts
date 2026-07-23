export const SHOT_ANALYSIS_CONFIG = {
  comfyuiUrl: process.env.SHOT_ANALYSIS_COMFYUI_URL || process.env.COMFYUI_URL || "http://localhost:8188",
  containerName: process.env.SHOT_ANALYSIS_CONTAINER_NAME || "comfyui-primary",
  outputDir: process.env.OUTPUT_DIR || "/mnt/agents/output/gpu1",
  driverPath: process.env.SHOT_ANALYSIS_DRIVER || "scripts/shot-analysis/shot_analysis_driver.py",
  pythonBin: process.env.SHOT_ANALYSIS_PYTHON || "python3",
  containerInputDir: "/root/ComfyUI/input",
  shotAnalysisDir: "/mnt/agents/output/gpu1/shot_analysis",
};
