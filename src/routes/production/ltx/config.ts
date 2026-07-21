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
  msrLoraName: "LTX-2.3-Multiple-Subject-Reference/LTX-2.3-Licon-MSR-V2.safetensors",
  // int8_convrot 替代 BF16 全量 checkpoint:
  //   - 体积 43GB → 21GB,常驻 24GB VRAM,无需 LowVRAM 层间 offload
  //   - per-step ~30s+ → ~12-16s (2-3× 提速)
  // 前提:ComfyUI-INT8-Fast 节点 + --enable-triton-backend 启动标志
  // 回退:git revert 此 commit 恢复 BF16 (ltx-2.3-22b-distilled-1.1.safetensors)
  msrModelName: "ltx-2.3-22b-distilled-1.1_transformer_only_int8_convrot.safetensors",
  // int8 transformer 不含内嵌 VAE,必须独立加载
  msrVideoVAE: "LTX23_video_vae_bf16.safetensors",
  msrAudioVAE: "LTX23_audio_vae_bf16.safetensors",
  // V2 also provides a test version with extra training
  msrLoraTestName: "LTX-2.3-Multiple-Subject-Reference/LTX2.3-Licon-MSR-test_version.safetensors",
};

// === MSR V2: PromptRelay + NAG ===
export const LTX_MSR_V2 = {
  /** NAG (Normal Attention Guidance) defaults from V2 sample workflow */
  nag: {
    enabled: true,
    nagLayers: 11,        // number of attention layers to apply NAG
    nagWeight: 0.25,      // NAG strength
    nagSigmaStart: 2.5,   // sigma start for NAG
    nagApplyToAudio: true, // apply NAG to audio conditioning too
  },
  /** PromptRelay defaults */
  promptRelay: {
    relayWeight: 0.0022,  // weight for reference description injection
  },
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

// === MSR + Last-Frame Conditioning (首尾帧 - 尾帧) ===
//
// 尾帧作为额外的 IC-LoRA guide 注入到 latent 的最后一帧,实现"首尾帧"能力。
// MSR 本身的"首帧"语义已由 LiconMSR 的 background slot 承担(裁后视频第 1 帧 = background),
// 所以这里只补尾帧这一侧。
//
// ⚠️ 关键:frame_idx 必须用显式正值 `numFrames - 1`,不能用 `-1`。
// LiconMSR 的 41 帧条件段会让 LTXAddVideoICLoRAGuide 登记 num_keyframes=6,
// ComfyUI 负索引解析 (latent_count = latent_length - num_keyframes) 会使 -1 落到
// 生成内容的开头而非末尾。详见 msr.ts buildMSRWorkflow 节点 53 的注释。
//
// strength 默认 0.6(软引导),与 singularityFFLF.ts 尾帧对齐,
// 避免 strength=1.0 产生"硬切到尾帧"伪影。
export const LTX_MSR_LAST_FRAME = {
  strength: 0.6,  // last-frame guide attention strength (soft guidance, 0-1)
};

// === MSR + First-Frame Conditioning (首尾帧 - 首帧) ===
//
// 首帧 guide 注入到"交付视频第 0 帧"的位置 = raw frame[calcTrimFrames(numRefs, msrFc)]。
// 该位置落在 LiconMSR 条件段尾的 background latent,guide 要跟 background 条件竞争 ——
// 与尾帧不同(尾帧落在纯生成区,远离条件段),首帧紧贴条件段,可能需要更高 strength 才能压过。
// 实测起步建议 0.8(尾帧用 0.6 即可);压不过则考虑注入到第一个纯生成帧(frame_idx=msrFc+1)。
export const LTX_MSR_FIRST_FRAME = {
  strength: 0.8,  // first-frame guide attention strength(首帧需对抗 background 条件,默认比尾帧高)
};

// === Audio Strategy (业务语义层) ===
// 用户面向的 3 种音频策略;内部映射到 audioMode 实现层。
// 优先级:audioStrategy > audioMode > 智能默认(见 msr.ts resolveAudioMode)。
//
// v15.1 (2026-07-19): 移除 `auto` —— LTX 2.3 自生成对白不可靠(BGM bias + 嘴型不同步),
// 实测 audioStrategy=auto 在 3 次重生中都产生 62.9-100% music_pct 被全部拒绝。
// `auto` 唯一的真实客户(ltx_native engine)也已移除。底层 audioMode=auto 仍保留,
// 高级用户可显式传 audioMode=auto。

export type AudioStrategy = "tts" | "ambient" | "silent";

export const AUDIO_STRATEGY_INFO: Record<AudioStrategy, { description: string; requiresAudio: boolean }> = {
  tts: {
    description: "TTS dialogue preservation. dialogueEndTime provided → 5-stage pipeline (rich ambient); missing → v1 full-freeze (narration贯穿).",
    requiresAudio: true,
  },
  ambient: {
    description: "Ambient sound only (no speech). Maps to ambient_only audioMode.",
    requiresAudio: false,
  },
  silent: {
    description: "No audio track. Maps to silent audioMode.",
    requiresAudio: false,
  },
};
