import { SCAIL2_DEFAULTS } from "./scail2-config";

/**
 * SCAIL2 工作流 builder
 *
 * Replace vs Transfer 的语义区分（当前实现）：
 *   - Replace:  pose_strength = 1.0（严格跟随 pose 视频动作，背景也跟随 pose）
 *   - Transfer: pose_strength = 0.6（动作引导弱一些，让 ref 角色身份在画面里更突出）
 *
 * 理论上的"真正多人替换"（SCAIL2ColoredMask + SAM3 mask 分配）在当前 ComfyUI 0.24.0 中
 * 走不通：WanSCAILToVideo 没有 pose_video_mask / reference_image_mask 输入，SCAIL2ColoredMask
 * 节点未注册。本 builder 保留了 enableMask 开关和 SAM3 mask 链，ComfyUI 升级后打开即可。
 *
 * 基于 ComfyUI 核心 WanSCAILToVideo 节点 (comfy_extras/nodes_wan.py)
 */

function buildSCAIL2Workflow(opts: any, mode: "replace" | "transfer") {
  const defaults = {
    ...opts,
    scailModel: opts.scailModel || SCAIL2_DEFAULTS.scailModel,
    lightx2vLora: opts.lightx2vLora || SCAIL2_DEFAULTS.lightx2vLora,
    relightLora: opts.relightLora || SCAIL2_DEFAULTS.relightLora,
    textEncoder: opts.textEncoder || SCAIL2_DEFAULTS.textEncoder,
    clipVision: opts.clipVision || SCAIL2_DEFAULTS.clipVision,
    vae: opts.vae || SCAIL2_DEFAULTS.vae,
  };

  const {
    poseVideoFilename, referenceImageFilename,
    prompt, negativePrompt,
    width, height, numFrames, fps, seed, steps, shift,
    lightx2vStrength, relightStrength,
  } = defaults;
  const filenamePrefix = defaults.filenamePrefix;

  const shiftVal = typeof shift === "number" && !Number.isNaN(shift) ? shift : SCAIL2_DEFAULTS.shift;
  // mode 决定 pose_strength（用户传了就用用户的，否则按 mode 默认）
  const defaultPoseStrength = mode === "replace" ? 1.0 : 0.6;
  const poseStrength = typeof opts.poseStrength === "number" ? opts.poseStrength : defaultPoseStrength;

  // ── 主模型链 ──
  const nodes: Record<string, any> = {
    "1": { class_type: "UNETLoader", inputs: { unet_name: defaults.scailModel, weight_dtype: "default" } },
    "2": { class_type: "LoraLoaderModelOnly", inputs: { model: ["1", 0], lora_name: defaults.lightx2vLora, strength_model: lightx2vStrength } },
  };

  let modelRef: [string, number] = ["2", 0];
  if (defaults.relightLora) {
    nodes["3"] = { class_type: "LoraLoaderModelOnly", inputs: { model: ["2", 0], lora_name: defaults.relightLora, strength_model: relightStrength } };
    modelRef = ["3", 0];
  }
  nodes["4"] = { class_type: "ModelSamplingSD3", inputs: { model: [modelRef[0], 0], shift: shiftVal } };

  // ── 编码器 ──
  nodes["6"] = { class_type: "CLIPLoader", inputs: { clip_name: defaults.textEncoder, type: "wan" } };
  nodes["7"] = { class_type: "CLIPVisionLoader", inputs: { clip_name: defaults.clipVision } };
  nodes["8"] = { class_type: "VAELoader", inputs: { vae_name: defaults.vae } };
  nodes["10"] = { class_type: "CLIPTextEncode", inputs: { text: prompt, clip: ["6", 0] } };
  nodes["11"] = { class_type: "CLIPTextEncode", inputs: { text: negativePrompt, clip: ["6", 0] } };

  // ── 输入 ──
  nodes["13"] = { class_type: "LoadImage", inputs: { image: referenceImageFilename } };
  nodes["15"] = { class_type: "VHS_LoadVideo", inputs: {
    video: poseVideoFilename, force_rate: 0,
    custom_width: width, custom_height: height,
    frame_load_cap: numFrames, skip_first_frames: 0, select_every_nth: 1,
  } };
  nodes["12"] = { class_type: "CLIPVisionEncode", inputs: { clip_vision: ["7", 0], image: ["13", 0], crop: "center" } };

  // ── 可选：SAM3 mask 链（forward-compatible；当前 ComfyUI 0.24.0 WanSCAILToVideo 不接收 mask 输入，
  //     所以默认关闭。ComfyUI 升级支持 pose_video_mask / reference_image_mask 后改 defaults.enableMask=true 即可激活）
  const enableMask = opts.enableMask === true;
  let poseVideoMaskRef: [string, number] | null = null;
  let referenceImageMaskRef: [string, number] | null = null;
  if (enableMask) {
    nodes["50"] = { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: SCAIL2_DEFAULTS.samModel } };
    nodes["51"] = { class_type: "CLIPTextEncode", inputs: { text: "person, human", clip: ["50", 1] } };
    nodes["52"] = { class_type: "SAM3_VideoTrack", inputs: {
      images: ["15", 0], model: ["50", 0], conditioning: ["51", 0],
      detection_threshold: 0.5, max_objects: 1, detect_interval: 1,
    } };
    nodes["53"] = { class_type: "SAM3_VideoTrack", inputs: {
      images: ["13", 0], model: ["50", 0], conditioning: ["51", 0],
      detection_threshold: 0.5, max_objects: 1, detect_interval: 1,
    } };
    nodes["54"] = { class_type: "SAM3_TrackToMask", inputs: { track_data: ["52", 0], object_indices: "" } };
    nodes["55"] = { class_type: "SAM3_TrackToMask", inputs: { track_data: ["53", 0], object_indices: "" } };
    nodes["56"] = { class_type: "Convert Masks to Images", inputs: { masks: ["54", 0] } };
    nodes["57"] = { class_type: "Convert Masks to Images", inputs: { masks: ["55", 0] } };
    poseVideoMaskRef = ["56", 0];
    referenceImageMaskRef = ["57", 0];
  }

  // ── WanSCAILToVideo ──
  const scailInputs: Record<string, any> = {
    positive: ["10", 0], negative: ["11", 0], vae: ["8", 0],
    clip_vision_output: ["12", 0],
    reference_image: ["13", 0],
    pose_video: ["15", 0],
    width, height, length: numFrames, batch_size: 1,
    pose_strength: poseStrength, pose_start: 0.0, pose_end: 1.0,
  };
  if (poseVideoMaskRef) scailInputs.pose_video_mask = poseVideoMaskRef;
  if (referenceImageMaskRef) scailInputs.reference_image_mask = referenceImageMaskRef;
  nodes["20"] = { class_type: "WanSCAILToVideo", inputs: scailInputs };

  // ── 采样器 ──
  nodes["18"] = { class_type: "BasicScheduler", inputs: { model: ["4", 0], scheduler: SCAIL2_DEFAULTS.scheduler, steps, denoise: 1.0 } };
  nodes["19"] = { class_type: "KSamplerSelect", inputs: { sampler_name: SCAIL2_DEFAULTS.samplerName } };
  nodes["21"] = { class_type: "SamplerCustom", inputs: {
    model: ["4", 0], add_noise: true, noise_seed: seed, cfg: 1,
    positive: ["20", 0], negative: ["20", 1], latent_image: ["20", 2],
    sampler: ["19", 0], sigmas: ["18", 0],
  } };

  // ── 输出 ──
  nodes["26"] = { class_type: "VAEDecode", inputs: { samples: ["21", 0], vae: ["8", 0] } };
  nodes["28"] = { class_type: "VHS_VideoCombine", inputs: {
    images: ["26", 0], frame_rate: fps, loop_count: 0, filename_prefix: filenamePrefix,
    format: "video/h264-mp4", pingpong: false, save_output: true,
  } };

  return nodes;
}

export function buildSCAIL2ReplaceWorkflow(opts: any) {
  return buildSCAIL2Workflow(opts, "replace");
}

export function buildSCAIL2TransferWorkflow(opts: any) {
  return buildSCAIL2Workflow(opts, "transfer");
}
