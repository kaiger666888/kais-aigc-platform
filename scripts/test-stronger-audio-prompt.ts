/**
 * 强化版 audio prompt 实测脚本 — dialogue+ambient 单模式
 *
 * 复刻 scripts/test-ltx-audio-modes.ts 的 workflow builder，
 * 但用 v2 强化的 AUDIO_GUIDES，只跑 dialogue+ambient 模式，
 * 输出到独立前缀方便与 v1 对比。
 *
 * 用法: npx tsx scripts/test-stronger-audio-prompt.ts
 */

import axios from "axios";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";

const COMFYUI_URL = "http://localhost:8188";
const CONTAINER = "comfyui-primary";
const INPUT_DIR = "/root/ComfyUI/input";

const DEFAULTS = {
  msrModelName: "ltx-2.3-22b-distilled-1.1.safetensors",
  clipName1: "gemma_3_12B_it_fp8_scaled.safetensors",
  msrLoraName: "LTX-2.3-Multiple-Subject-Reference/LTX-2.3-Licon-MSR-V2.safetensors",
};

const MSR_V2 = {
  nag: { nagLayers: 11, nagWeight: 0.25, nagSigmaStart: 2.5 },
  promptRelay: { relayWeight: 0.0022 },
};

const REF_IMAGES = [
  "/mnt/agents/output/char-linxia-1779935277/char-linxia-1779935277_image.png",
  "/mnt/agents/output/char-xiaoju-1779935277/char-xiaoju-1779935277_image.png",
];

const PROMPT = "Two women stand in a sunlit garden, having a friendly conversation about weekend plans, smiling, occasional hand gestures, gentle breeze moving their hair and clothes";
const NEGATIVE_PROMPT = "worst quality, blurry, jittery, distorted, inconsistent appearance";

// === V2 STRENGTHENED AUDIO GUIDE (matches msr.ts v2) ===
const AUDIO_GUIDE_V2 = {
  positive: "strictly diegetic in-world sound, on-location production audio, raw foley art, natural room tone, environmental ambiance, character dialogue, no scored music, unscored scene",
  negative: "non-diegetic audio, background music, BGM, soundtrack, musical score, underscore, theme music, cue, instrumentation, instruments, melody, melodic phrase, harmony, chord progression, tonal center, key, scale, rhythm, beat, pulse, tempo, groove, percussion, drums, drum beat, bass line, bass guitar, orchestral arrangement, string section, brass, electronic music, synthesizer, vocal melody, singing, hooks, drops, chorus, verse, bridge, intro, outro, leitmotif, jingle, any structured musical composition or arrangement",
};

// === V1 ORIGINAL (for side-by-side comparison) ===
const AUDIO_GUIDE_V1 = {
  positive: "natural ambient sounds, footsteps, clothing rustle, environmental audio, character dialogue speech",
  negative: "background music, BGM, soundtrack, musical instruments, melody, singing, theme song",
};

function copyToContainer(localPath: string, containerPath: string) {
  execSync(`docker cp "${localPath}" ${CONTAINER}:"${containerPath}"`, { timeout: 30_000 });
}

function roundTo8nPlus1(raw: number): number {
  return Math.ceil((raw - 1) / 8) * 8 + 1;
}

function buildWorkflow(opts: {
  refFilenames: string[];
  prompt: string;
  negativePrompt: string;
  audioGuide: { positive: string; negative: string };
  width: number;
  height: number;
  numFrames: number;
  msrFrameCount: number;
  fps: number;
  seed: number;
  filenamePrefix: string;
}): Record<string, any> {
  const {
    refFilenames, prompt, negativePrompt, audioGuide,
    width, height, numFrames, msrFrameCount, fps,
    seed, filenamePrefix,
  } = opts;

  const useV2 = true;
  const nagLayers = MSR_V2.nag.nagLayers;
  const nagWeight = MSR_V2.nag.nagWeight;
  const nagSigmaStart = MSR_V2.nag.nagSigmaStart;
  const relayWeight = MSR_V2.promptRelay.relayWeight;

  const audioEnhancedPrompt = audioGuide.positive ? `${prompt}, ${audioGuide.positive}` : prompt;
  const audioEnhancedNegative = audioGuide.negative ? `${negativePrompt}, ${audioGuide.negative}` : negativePrompt;

  const backgroundFilename = refFilenames[refFilenames.length - 1];
  const refSlots = refFilenames.slice(0, -1);

  const msrInputs: Record<string, any> = {
    width, height,
    frame_count: msrFrameCount,
    background: ["30", 0],
  };
  const refSlotNames = ["1", "2", "3", "4"];
  const loadImageNodes: Record<string, any> = {};
  refSlots.forEach((filename, i) => {
    if (i < 4) {
      const nodeId = 40 + i;
      loadImageNodes[String(nodeId)] = {
        class_type: "LoadImage",
        inputs: { image: filename },
      };
      msrInputs[refSlotNames[i]] = [String(nodeId), 0];
    }
  });
  loadImageNodes["30"] = {
    class_type: "LoadImage",
    inputs: { image: backgroundFilename },
  };

  return {
    "3": { class_type: "LowVRAMCheckpointLoader", inputs: { ckpt_name: DEFAULTS.msrModelName } },
    "26": { class_type: "LTXAVTextEncoderLoader", inputs: {
      text_encoder: DEFAULTS.clipName1,
      ckpt_name: DEFAULTS.msrModelName,
      device: "default",
    }},
    "10": { class_type: "LTXICLoRALoaderModelOnly", inputs: {
      model: ["3", 0],
      lora_name: DEFAULTS.msrLoraName,
      strength_model: 1.0,
    }},
    "99": { class_type: "PromptRelayEncode", inputs: {
      model: ["10", 0],
      clip: ["26", 0],
      latent: ["8", 0],
      global_prompt: prompt,
      local_prompts: prompt,
      segment_lengths: "",
      epsilon: relayWeight,
    }},
    "121": { class_type: "LTX2_NAG", inputs: {
      model: ["99", 0],
      nag_scale: nagLayers,
      nag_alpha: nagWeight,
      nag_tau: nagSigmaStart,
      nag_cond_video: ["7", 1],
      nag_cond_audio: ["7", 1],
      inplace: true,
    }},
    "5": { class_type: "CLIPTextEncode", inputs: { text: audioEnhancedPrompt, clip: ["26", 0] } },
    "6": { class_type: "CLIPTextEncode", inputs: { text: audioEnhancedNegative, clip: ["26", 0] } },
    "21": { class_type: "LTXVAudioVAELoader", inputs: { ckpt_name: DEFAULTS.msrModelName } },
    "7": { class_type: "LTXVConditioning", inputs: {
      positive: ["99", 1],
      negative: ["6", 0],
      frame_rate: fps,
    }},
    "8": { class_type: "EmptyLTXVLatentVideo", inputs: { width, height, length: numFrames, batch_size: 1 } },
    "22": { class_type: "LTXVEmptyLatentAudio", inputs: {
      audio_vae: ["21", 0],
      frames_number: numFrames,
      frame_rate: fps,
      batch_size: 1,
    }},
    ...loadImageNodes,
    "28": { class_type: "LiconMSR", inputs: msrInputs },
    "9": { class_type: "LTXAddVideoICLoRAGuide", inputs: {
      positive: ["7", 0],
      negative: ["7", 1],
      vae: ["3", 2],
      latent: ["8", 0],
      image: ["28", 0],
      frame_idx: 0,
      strength: 1.0,
      latent_downscale_factor: 1,
      crop: "center",
      use_tiled_encode: false,
      tile_size: 256,
      tile_overlap: 64,
    }},
    "23": { class_type: "LTXVConcatAVLatent", inputs: {
      video_latent: ["9", 2],
      audio_latent: ["22", 0],
    }},
    "15": { class_type: "RandomNoise", inputs: { noise_seed: seed } },
    "27": { class_type: "ManualSigmas", inputs: {
      sigmas: "1.0, 0.99375, 0.9875, 0.98125, 0.975, 0.909375, 0.725, 0.421875, 0.0",
    }},
    "13": { class_type: "KSamplerSelect", inputs: { sampler_name: "euler" } },
    "37": { class_type: "CFGGuider", inputs: {
      model: ["121", 0],
      positive: ["9", 0],
      negative: ["9", 1],
      cfg: 1.0,
    }},
    "16": { class_type: "SamplerCustomAdvanced", inputs: {
      noise: ["15", 0],
      guider: ["37", 0],
      sampler: ["13", 0],
      sigmas: ["27", 0],
      latent_image: ["23", 0],
    }},
    "24": { class_type: "LTXVSeparateAVLatent", inputs: { av_latent: ["16", 0] } },
    "17": { class_type: "LTXVCropGuides", inputs: {
      positive: ["9", 0],
      negative: ["9", 1],
      latent: ["24", 0],
    }},
    "38": { class_type: "VAEDecode", inputs: { samples: ["17", 2], vae: ["3", 2] } },
    "25": { class_type: "LTXVAudioVAEDecode", inputs: {
      samples: ["24", 1],
      audio_vae: ["21", 0],
    }},
    "19": { class_type: "CreateVideo", inputs: {
      images: ["38", 0], audio: ["25", 0], fps,
    }},
    "20": { class_type: "SaveVideo", inputs: {
      video: ["19", 0],
      filename_prefix: filenamePrefix,
      format: "auto",
      codec: "auto",
    }},
  };
}

async function submitPrompt(workflow: Record<string, any>): Promise<string> {
  const r = await axios.post(`${COMFYUI_URL}/prompt`, { prompt: workflow }, {
    timeout: 30_000,
    validateStatus: (s) => s < 500,
  });
  if (r.status !== 200) {
    throw new Error(`ComfyUI rejected: ${JSON.stringify(r.data).slice(0, 500)}`);
  }
  return r.data.prompt_id as string;
}

async function pollUntilDone(promptId: string, timeoutMs = 600_000) {
  const start = Date.now();
  const deadline = start + timeoutMs;
  while (Date.now() < deadline) {
    const r = await axios.get(`${COMFYUI_URL}/history/${promptId}`, { timeout: 10_000 });
    const entry = r.data?.[promptId];
    if (entry) {
      if (entry.status?.completed) {
        return { status: "success" as const, outputs: entry.outputs, elapsedMs: Date.now() - start };
      }
      if (entry.status?.status_str === "error") {
        return {
          status: "error" as const,
          error: JSON.stringify(entry.status?.messages || "unknown").slice(0, 1000),
          elapsedMs: Date.now() - start,
        };
      }
    }
    process.stdout.write(`  [${Math.round((Date.now() - start) / 1000)}s] running\r`);
    await new Promise((r) => setTimeout(r, 3000));
  }
  return { status: "error" as const, error: "timeout", elapsedMs: Date.now() - start };
}

async function runOne(label: string, audioGuide: { positive: string; negative: string }, refFilenames: string[]) {
  const NUM_FRAMES = roundTo8nPlus1(Math.round(3 * 24) + 1); // 73 frames
  const SEED = 42;

  console.log(`\n==> [${label}] Submitting...`);
  const positiveFull = audioGuide.positive ? `${PROMPT}, ${audioGuide.positive}` : PROMPT;
  const negativeFull = audioGuide.negative ? `${NEGATIVE_PROMPT}, ${audioGuide.negative}` : NEGATIVE_PROMPT;
  console.log(`  positive (+${positiveFull.length - PROMPT.length} chars): ${audioGuide.positive.slice(0, 120)}...`);
  console.log(`  negative (+${negativeFull.length - NEGATIVE_PROMPT.length} chars): ${audioGuide.negative.slice(0, 120)}...`);

  const workflow = buildWorkflow({
    refFilenames,
    prompt: PROMPT,
    negativePrompt: NEGATIVE_PROMPT,
    audioGuide,
    width: 768,
    height: 448,
    numFrames: NUM_FRAMES,
    msrFrameCount: 41,
    fps: 24,
    seed: SEED,
    filenamePrefix: `ltx_audio_v2_test/${label}`,
  });

  const promptId = await submitPrompt(workflow);
  console.log(`  ✓ promptId: ${promptId}`);
  const result = await pollUntilDone(promptId);
  console.log(`  ${result.status === "success" ? "✓" : "✗"} ${result.status} in ${(result.elapsedMs / 1000).toFixed(1)}s`);
  if (result.status === "error") {
    console.error(`  error: ${result.error?.slice(0, 200)}`);
    return null;
  }
  const video = result.outputs?.["20"]?.videos?.[0] || result.outputs?.["20"]?.images?.[0];
  return { ...video, promptId };
}

async function main() {
  const OUT_DIR = "/tmp/ltx-audio-v2-test";
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // Copy refs once
  const refFilenames: string[] = [];
  for (const localPath of REF_IMAGES) {
    const ext = path.extname(localPath);
    const filename = `ltx_audio_v2_${uuidv4()}${ext}`;
    copyToContainer(localPath, `${INPUT_DIR}/${filename}`);
    refFilenames.push(filename);
  }

  // V2 first (the new stronger prompt) — most interesting
  const v2Result = await runOne("v2_strong", AUDIO_GUIDE_V2, refFilenames);
  // V1 as control (same as yesterday's test, regenerated to confirm reproducibility)
  const v1Result = await runOne("v1_original", AUDIO_GUIDE_V1, refFilenames);

  const summary = {
    timestamp: new Date().toISOString(),
    prompt: PROMPT,
    negativePrompt: NEGATIVE_PROMPT,
    audioGuides: { v1: AUDIO_GUIDE_V1, v2: AUDIO_GUIDE_V2 },
    results: { v1: v1Result, v2: v2Result },
  };
  fs.writeFileSync(path.join(OUT_DIR, "result.json"), JSON.stringify(summary, null, 2));
  console.log(`\n==> Result: ${OUT_DIR}/result.json`);
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
