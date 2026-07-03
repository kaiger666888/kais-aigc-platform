export const LTX_CONFIG = {
  comfyuiUrl: process.env.LTX_COMFYUI_URL || process.env.COMFYUI_URL || "http://localhost:8188",
  containerName: process.env.LTX_CONTAINER_NAME || "comfyui-primary",
  outputDir: process.env.OUTPUT_DIR || "/mnt/agents/output",
  comfyuiInputDir: "/root/ComfyUI/input",
  comfyuiOutputDir: "/root/ComfyUI/output",
  pollIntervalMs: 2000,
  pollTimeoutMs: 600_000, // 10 min
  // External services for pose-video pipeline
  kimodoUrl: process.env.KIMODO_URL || "http://localhost:8002",
  blenderUrl: process.env.BLENDER_BVH_URL || "http://localhost:8095",
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

export const LTX_MSR_TRIM = {
  vaeTemporalFactor: 8,
  // If true, the platform auto-trims the raw video after ComfyUI completes
  autoTrim: false, // Set to true once the trim endpoint is integrated
};

// === MSR + Pose Dual-Conditioning ===

export const LTX_POSE = {
  /** Default IC-LoRA strengths for dual-conditioning */
  msrStrength: 1.0,           // IC-LoRA 1 (identity via LiconMSR)
  poseLoraStrength: 0.6,      // IC-LoRA 2 (Union Control for pose/motion)
  poseGuideStrength: 0.7,     // Guide 2 injection strength (0-1)

  /** Union Control IC-LoRA model name */
  unionControlLoraName: "ltx-2.3-22b-ic-lora-union-control-ref0.5.safetensors",

  /** Pose extraction defaults */
  poseMapWidth: 768,
  poseMapHeight: 1024,
  maxPoseFrames: 97,          // ~4s at 24fps, rounded to 8n+1

  /** Skeleton format from Kimodo */
  skeleton: {
    // SOMA-77: 77 joints, nv-tlabs/kimodo default for humanoid motion
    // Maps to OpenPose BODY-25 body subset (25 joints)
    format: "soma77",
    jointCount: 77,
    // SMPLX-22 also supported (fewer joints, includes fingers)
    // format: "smplx22", jointCount: 22,
  },

  /** Pose processor microservice URL (empty = disabled, requires pre-rendered PNGs) */
  poseProcessorUrl: process.env.POSE_PROCESSOR_URL || "",
};
