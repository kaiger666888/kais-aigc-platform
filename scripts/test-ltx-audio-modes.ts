/**
 * LTX MSR 4 种音频模式对比测试
 *
 * 流程:
 *   1. docker cp 2 张角色图到 comfyui-primary:/root/ComfyUI/input/
 *   2. 复刻 msr.ts 的 buildMSRWorkflow,4 种 audioMode 各提交 1 次
 *   3. 轮询 ComfyUI /history/{promptId} 直到全部完成
 *   4. 把结果(视频路径、参数、耗时)写到 /tmp/ltx-audio-test/result.json
 *
 * 用法: npx tsx scripts/test-ltx-audio-modes.ts
 */

import axios from "axios";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";

// ─── 配置(从 src/routes/production/ltx/config.ts 复刻) ────────────────

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

const POSE = {
  poseGuideStrength: 0.7,
  poseLoraStrength: 0.6,
  unionControlLoraName: "ltx-2.3-22b-ic-lora-union-control-ref0.5.safetensors",
};

// ─── 参考图与 prompt ─────────────────────────────────────────────

const REF_IMAGES = [
  "/mnt/agents/output/char-linxia-1779935277/char-linxia-1779935277_image.png",
  "/mnt/agents/output/char-xiaoju-1779935277/char-xiaoju-1779935277_image.png",
];

const PROMPT = "Two women stand in a sunlit garden, having a friendly conversation about weekend plans, smiling, occasional hand gestures, gentle breeze moving their hair and clothes";

const NEGATIVE_PROMPT = "worst quality, blurry, jittery, distorted, inconsistent appearance";

// ─── Helpers ─────────────────────────────────────────────────────

function copyToContainer(localPath: string, containerPath: string) {
  execSync(`docker cp "${localPath}" ${CONTAINER}:"${containerPath}"`, { timeout: 30_000 });
}

function roundTo8nPlus1(raw: number): number {
  return Math.ceil((raw - 1) / 8) * 8 + 1;
}

const AUDIO_GUIDES: Record<string, { positive: string; negative: string }> = {
  "dialogue+ambient": {
    positive: "natural ambient sounds, footsteps, clothing rustle, environmental audio, character dialogue speech",
    negative: "background music, BGM, soundtrack, musical instruments, melody, singing, theme song",
  },
  "ambient_only": {
    positive: "natural ambient sounds, footsteps, clothing rustle, environmental audio, wind, room tone",
    negative: "background music, BGM, soundtrack, musical instruments, melody, singing, speech, dialogue, voices",
  },
  "silent": {
    positive: "",
    negative: "background music, BGM, soundtrack, musical instruments, melody, singing, speech, voices, ambient sounds",
  },
  "auto": { positive: "", negative: "" },
};

// ─── Workflow 构造(复刻 msr.ts:93-514,只保留必要参数) ───────────────

function buildWorkflow(opts: {
  refFilenames: string[];
  prompt: string;
  negativePrompt: string;
  width: number;
  height: number;
  numFrames: number;
  msrFrameCount: number;
  fps: number;
  seed: number;
  filenamePrefix: string;
  audioMode: string;
  refDescription?: string;
}): Record<string, any> {
  const {
    refFilenames, prompt, negativePrompt,
    width, height, numFrames, msrFrameCount, fps,
    seed, filenamePrefix, audioMode,
  } = opts;

  const refDescription = opts.refDescription || "";
  const useV2 = true;
  const nagLayers = MSR_V2.nag.nagLayers;
  const nagWeight = MSR_V2.nag.nagWeight;
  const nagSigmaStart = MSR_V2.nag.nagSigmaStart;
  const relayWeight = MSR_V2.promptRelay.relayWeight;

  const audioGuide = AUDIO_GUIDES[audioMode] || AUDIO_GUIDES["dialogue+ambient"];
  const audioEnhancedPrompt = audioGuide.positive ? `${prompt}, ${audioGuide.positive}` : prompt;
  const audioEnhancedNegative = audioGuide.negative ? `${negativePrompt}, ${audioGuide.negative}` : negativePrompt;

  const effectivePrompt = audioEnhancedPrompt;

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
    // V2: PromptRelayEncode + LTX2_NAG
    "99": { class_type: "PromptRelayEncode", inputs: {
      model: ["10", 0],
      clip: ["26", 0],
      latent: ["8", 0],
      global_prompt: refDescription || prompt,
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
    // Prompt encoding
    "5": { class_type: "CLIPTextEncode", inputs: { text: effectivePrompt, clip: ["26", 0] } },
    "6": { class_type: "CLIPTextEncode", inputs: { text: audioEnhancedNegative, clip: ["26", 0] } },
    // Audio VAE
    "21": { class_type: "LTXVAudioVAELoader", inputs: { ckpt_name: DEFAULTS.msrModelName } },
    // Conditioning (V2: positive from PromptRelay node 99 output 1)
    "7": { class_type: "LTXVConditioning", inputs: {
      positive: ["99", 1],
      negative: ["6", 0],
      frame_rate: fps,
    }},
    // Latents
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
    // silent: 不接 audio 输入 → 输出静音视频
    "19": { class_type: "CreateVideo", inputs: audioMode === "silent" ? {
      images: ["38", 0], fps,
    } : {
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

// ─── ComfyUI 提交 + 轮询 ────────────────────────────────────────────

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

async function pollUntilDone(promptId: string, timeoutMs = 600_000): Promise<{
  status: "success" | "error";
  outputs?: any;
  error?: string;
  elapsedMs: number;
}> {
  const start = Date.now();
  const deadline = start + timeoutMs;
  let lastStatus = "";

  while (Date.now() < deadline) {
    const r = await axios.get(`${COMFYUI_URL}/history/${promptId}`, { timeout: 10_000 });
    const entry = r.data?.[promptId];

    if (entry) {
      if (entry.status?.completed) {
        return {
          status: "success",
          outputs: entry.outputs,
          elapsedMs: Date.now() - start,
        };
      }
      if (entry.status?.status_str === "error") {
        return {
          status: "error",
          error: JSON.stringify(entry.status?.messages || "unknown error").slice(0, 1000),
          elapsedMs: Date.now() - start,
        };
      }
      lastStatus = entry.status?.status_str || "running";
    }

    // 检查队列中是否还在
    const q = await axios.get(`${COMFYUI_URL}/queue`, { timeout: 5_000 });
    const inQueue =
      q.data.queue_running.some((x: any[]) => x[1] === promptId) ||
      q.data.queue_pending.some((x: any[]) => x[1] === promptId);

    if (!inQueue && !entry) {
      // 既没在队列里,history 里也没有 — 异常
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }

    if (!inQueue && entry && !entry.status?.completed) {
      // 已离开队列但未完成 — 可能刚完成正在写入 history,等一下再查
      await new Promise((r) => setTimeout(r, 3000));
      continue;
    }

    process.stdout.write(`  [${Math.round((Date.now() - start) / 1000)}s] ${lastStatus}\r`);
    await new Promise((r) => setTimeout(r, 3000));
  }

  return { status: "error", error: `timeout after ${timeoutMs}ms (lastStatus=${lastStatus})`, elapsedMs: Date.now() - start };
}

// ─── Main ─────────────────────────────────────────────────────────

async function main() {
  const OUT_DIR = "/tmp/ltx-audio-test";
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // 校验参考图
  for (const p of REF_IMAGES) {
    if (!fs.existsSync(p)) {
      throw new Error(`Reference image missing: ${p}`);
    }
  }

  // 1. docker cp 参考图到容器
  console.log("==> Copying reference images to ComfyUI container...");
  const refFilenames: string[] = [];
  for (const localPath of REF_IMAGES) {
    const ext = path.extname(localPath);
    const filename = `ltx_audio_test_${uuidv4()}${ext}`;
    copyToContainer(localPath, `${INPUT_DIR}/${filename}`);
    refFilenames.push(filename);
    console.log(`  ✓ ${path.basename(localPath)} → ${filename}`);
  }

  // 公共参数
  const DURATION = 3;
  const FPS = 24;
  const WIDTH = 768;
  const HEIGHT = 448;
  const NUM_FRAMES = roundTo8nPlus1(Math.round(DURATION * FPS) + 1);
  const MSR_FRAME_COUNT = 41;
  const SEED = 42;  // 固定种子便于横向对比

  console.log(`\n==> Common params: ${WIDTH}x${HEIGHT}, ${NUM_FRAMES} frames, ${FPS}fps, seed=${SEED}, V2=on`);

  const modes = ["dialogue+ambient", "ambient_only", "silent", "auto"] as const;
  const results: Array<{
    mode: string;
    promptId: string;
    status: string;
    outputs?: any;
    error?: string;
    elapsedMs: number;
    enhancedPrompt: string;
    enhancedNegative: string;
    submittedAt: string;
  }> = [];

  // 2. 顺序提交 + 等待每个完成(避免 GPU OOM)
  for (const mode of modes) {
    console.log(`\n==> [${mode}] Submitting...`);
    const audioGuide = AUDIO_GUIDES[mode];
    const enhancedPrompt = audioGuide.positive ? `${PROMPT}, ${audioGuide.positive}` : PROMPT;
    const enhancedNegative = audioGuide.negative ? `${NEGATIVE_PROMPT}, ${audioGuide.negative}` : NEGATIVE_PROMPT;
    console.log(`  positive: ${enhancedPrompt.slice(0, 100)}${enhancedPrompt.length > 100 ? "..." : ""}`);
    console.log(`  negative: ${enhancedNegative.slice(0, 100)}${enhancedNegative.length > 100 ? "..." : ""}`);

    const workflow = buildWorkflow({
      refFilenames,
      prompt: PROMPT,
      negativePrompt: NEGATIVE_PROMPT,
      width: WIDTH,
      height: HEIGHT,
      numFrames: NUM_FRAMES,
      msrFrameCount: MSR_FRAME_COUNT,
      fps: FPS,
      seed: SEED,
      filenamePrefix: `ltx_audio_test/${mode}`,
      audioMode: mode,
    });

    const submittedAt = new Date().toISOString();
    let promptId: string;
    try {
      promptId = await submitPrompt(workflow);
      console.log(`  ✓ promptId: ${promptId}`);
    } catch (e: any) {
      console.error(`  ✗ Submit failed: ${e.message}`);
      results.push({ mode, promptId: "", status: "submit_failed", error: e.message, elapsedMs: 0, enhancedPrompt, enhancedNegative, submittedAt });
      continue;
    }

    // 轮询
    const result = await pollUntilDone(promptId, 600_000);
    console.log(`  ${result.status === "success" ? "✓" : "✗"} ${result.status} in ${(result.elapsedMs / 1000).toFixed(1)}s`);

    if (result.status === "error") {
      console.error(`  error: ${result.error?.slice(0, 200)}`);
    }

    results.push({
      mode,
      promptId,
      status: result.status,
      outputs: result.outputs,
      error: result.error,
      elapsedMs: result.elapsedMs,
      enhancedPrompt,
      enhancedNegative,
      submittedAt,
    });
  }

  // 3. 写 result.json
  const summary = {
    timestamp: new Date().toISOString(),
    prompt: PROMPT,
    negativePrompt: NEGATIVE_PROMPT,
    params: {
      width: WIDTH, height: HEIGHT, fps: FPS, duration: DURATION,
      numFrames: NUM_FRAMES, msrFrameCount: MSR_FRAME_COUNT, seed: SEED,
      v2: true, refImages: REF_IMAGES.map((p) => path.basename(p)),
    },
    results,
  };

  fs.writeFileSync(
    path.join(OUT_DIR, "result.json"),
    JSON.stringify(summary, null, 2),
  );

  console.log(`\n==> Result written to ${OUT_DIR}/result.json`);
  console.log("Summary:");
  for (const r of results) {
    const file = r.outputs?.["20"]?.videos?.[0]?.filename || "(no video)";
    const subfolder = r.outputs?.["20"]?.videos?.[0]?.subfolder || "";
    console.log(`  [${r.mode}] ${r.status} | ${(r.elapsedMs / 1000).toFixed(1)}s | ${subfolder ? subfolder + "/" : ""}${file}`);
  }
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
