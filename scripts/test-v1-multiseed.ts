import axios from "axios";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";

const COMFYUI_URL = "http://localhost:8188";
const CONTAINER = "comfyui-primary";
const INPUT_DIR = "/root/ComfyUI/input";

const REF_IMAGES = [
  "/mnt/agents/output/char-linxia-1779935277/char-linxia-1779935277_image.png",
  "/mnt/agents/output/char-xiaoju-1779935277/char-xiaoju-1779935277_image.png",
];
const PROMPT = "Two women stand in a sunlit garden, having a friendly conversation about weekend plans, smiling, occasional hand gestures, gentle breeze moving their hair and clothes";
const NEG = "worst quality, blurry, jittery, distorted, inconsistent appearance";

const AUDIO_V1 = {
  pos: "natural ambient sounds, footsteps, clothing rustle, environmental audio, character dialogue speech",
  neg: "background music, BGM, soundtrack, musical instruments, melody, singing, theme song",
};

function roundTo8nPlus1(r: number) { return Math.ceil((r - 1) / 8) * 8 + 1; }

function buildWorkflow(opts: any) {
  const { refFilenames, audioGuide, numFrames, msrFrameCount, fps, seed, filenamePrefix } = opts;
  const prompt = `${PROMPT}, ${audioGuide.pos}`;
  const negative = `${NEG}, ${audioGuide.neg}`;
  const backgroundFilename = refFilenames[refFilenames.length - 1];
  const refSlots = refFilenames.slice(0, -1);
  const msrInputs: any = { width: 768, height: 448, frame_count: msrFrameCount, background: ["30", 0] };
  const loadImageNodes: any = {};
  refSlots.forEach((fn: string, i: number) => {
    if (i < 4) {
      loadImageNodes[String(40 + i)] = { class_type: "LoadImage", inputs: { image: fn } };
      msrInputs[String(i + 1)] = [String(40 + i), 0];
    }
  });
  loadImageNodes["30"] = { class_type: "LoadImage", inputs: { image: backgroundFilename } };
  return {
    "3": { class_type: "LowVRAMCheckpointLoader", inputs: { ckpt_name: "ltx-2.3-22b-distilled-1.1.safetensors" } },
    "26": { class_type: "LTXAVTextEncoderLoader", inputs: { text_encoder: "gemma_3_12B_it_fp8_scaled.safetensors", ckpt_name: "ltx-2.3-22b-distilled-1.1.safetensors", device: "default" } },
    "10": { class_type: "LTXICLoRALoaderModelOnly", inputs: { model: ["3", 0], lora_name: "LTX-2.3-Multiple-Subject-Reference/LTX-2.3-Licon-MSR-V2.safetensors", strength_model: 1.0 } },
    "99": { class_type: "PromptRelayEncode", inputs: { model: ["10", 0], clip: ["26", 0], latent: ["8", 0], global_prompt: PROMPT, local_prompts: PROMPT, segment_lengths: "", epsilon: 0.0022 } },
    "121": { class_type: "LTX2_NAG", inputs: { model: ["99", 0], nag_scale: 11, nag_alpha: 0.25, nag_tau: 2.5, nag_cond_video: ["7", 1], nag_cond_audio: ["7", 1], inplace: true } },
    "5": { class_type: "CLIPTextEncode", inputs: { text: prompt, clip: ["26", 0] } },
    "6": { class_type: "CLIPTextEncode", inputs: { text: negative, clip: ["26", 0] } },
    "21": { class_type: "LTXVAudioVAELoader", inputs: { ckpt_name: "ltx-2.3-22b-distilled-1.1.safetensors" } },
    "7": { class_type: "LTXVConditioning", inputs: { positive: ["99", 1], negative: ["6", 0], frame_rate: fps } },
    "8": { class_type: "EmptyLTXVLatentVideo", inputs: { width: 768, height: 448, length: numFrames, batch_size: 1 } },
    "22": { class_type: "LTXVEmptyLatentAudio", inputs: { audio_vae: ["21", 0], frames_number: numFrames, frame_rate: fps, batch_size: 1 } },
    ...loadImageNodes,
    "28": { class_type: "LiconMSR", inputs: msrInputs },
    "9": { class_type: "LTXAddVideoICLoRAGuide", inputs: { positive: ["7", 0], negative: ["7", 1], vae: ["3", 2], latent: ["8", 0], image: ["28", 0], frame_idx: 0, strength: 1.0, latent_downscale_factor: 1, crop: "center", use_tiled_encode: false, tile_size: 256, tile_overlap: 64 } },
    "23": { class_type: "LTXVConcatAVLatent", inputs: { video_latent: ["9", 2], audio_latent: ["22", 0] } },
    "15": { class_type: "RandomNoise", inputs: { noise_seed: seed } },
    "27": { class_type: "ManualSigmas", inputs: { sigmas: "1.0, 0.99375, 0.9875, 0.98125, 0.975, 0.909375, 0.725, 0.421875, 0.0" } },
    "13": { class_type: "KSamplerSelect", inputs: { sampler_name: "euler" } },
    "37": { class_type: "CFGGuider", inputs: { model: ["121", 0], positive: ["9", 0], negative: ["9", 1], cfg: 1.0 } },
    "16": { class_type: "SamplerCustomAdvanced", inputs: { noise: ["15", 0], guider: ["37", 0], sampler: ["13", 0], sigmas: ["27", 0], latent_image: ["23", 0] } },
    "24": { class_type: "LTXVSeparateAVLatent", inputs: { av_latent: ["16", 0] } },
    "17": { class_type: "LTXVCropGuides", inputs: { positive: ["9", 0], negative: ["9", 1], latent: ["24", 0] } },
    "38": { class_type: "VAEDecode", inputs: { samples: ["17", 2], vae: ["3", 2] } },
    "25": { class_type: "LTXVAudioVAEDecode", inputs: { samples: ["24", 1], audio_vae: ["21", 0] } },
    "19": { class_type: "CreateVideo", inputs: { images: ["38", 0], audio: ["25", 0], fps } },
    "20": { class_type: "SaveVideo", inputs: { video: ["19", 0], filename_prefix: filenamePrefix, format: "auto", codec: "auto" } },
  };
}

async function poll(pid: string, t = 600000) {
  const s = Date.now();
  while (Date.now() - s < t) {
    const r = await axios.get(`${COMFYUI_URL}/history/${pid}`, { timeout: 10000 });
    const e = r.data?.[pid];
    if (e?.status?.completed) return { ok: true, outputs: e.outputs };
    if (e?.status?.status_str === "error") return { ok: false };
    await new Promise(r => setTimeout(r, 3000));
  }
  return { ok: false };
}

async function main() {
  const refs: string[] = [];
  for (const p of REF_IMAGES) {
    const fn = `v1multi_${uuidv4()}${path.extname(p)}`;
    execSync(`docker cp "${p}" ${CONTAINER}:"${INPUT_DIR}/${fn}"`, { timeout: 30000 });
    refs.push(fn);
  }
  const SEEDS = [100, 200, 300, 400, 500];
  const NUM = roundTo8nPlus1(73);
  for (const seed of SEEDS) {
    console.log(`==> v1 seed=${seed}`);
    const wf = buildWorkflow({ refFilenames: refs, audioGuide: AUDIO_V1, numFrames: NUM, msrFrameCount: 41, fps: 24, seed, filenamePrefix: `ltx_audio_v1_moreseed/seed${seed}` });
    const r = await axios.post(`${COMFYUI_URL}/prompt`, { prompt: wf }, { timeout: 30000, validateStatus: s => s < 500 });
    if (r.status !== 200) { console.error("submit failed"); continue; }
    const res = await poll(r.data.prompt_id);
    console.log(`  ${res.ok ? "✓" : "✗"}`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
