/**
 * Foley V2A 全长 15s 端到端验证(B 配置:LoRA 2.0 / seed42 / cfg1 / 蒸馏9步)。
 *
 * 架构(用户目标):
 *   1) 复用已验证的口型画面视频(voiced_15s_cleanaudio.mp4,带 lip-sync + 对话)
 *   2) Foley V2A 对整段 15s 画面(冻结画面,仅生成音频)→ 干净环境+动作音(无语音/无音乐)
 *   3) 混音:对话 TTS(5.9s)× 1.0 + Foley 环境 × 0.55,sidechain ducking(对话时压环境)
 *   4) Mux 原画面 + 混音 → 最终 mp4(覆盖原 LTX 音轨)
 *
 * 对比:原 voiced_15s_cleanaudio(对话+LTX-native雨) vs 新(对话+Foley雨)。
 * 用法:npx tsx scripts/run-foley-full-15s.ts
 */
import fs from "fs";
import path from "path";
import axios from "axios";
import { execSync } from "child_process";

const COMFY = process.env.LTX_COMFYUI_URL || "http://localhost:8188";
const CONTAINER = process.env.LTX_CONTAINER_NAME || "comfyui-primary";
const INPUT_DIR = "/root/ComfyUI/input";
const OUT_DIR = "workflows/ltx-2.3/foley-distilled-test-output";
const TMP = process.env.CLAUDE_JOB_DIR || "/tmp";

// 输入:已验证的口型画面视频(取画面,-an);对话 TTS 原文件
const SRC_VIDEO = "workflows/ltx-2.3/msr-lastframe-test-output/voiced_15s_cleanaudio.mp4";
const DIALOGUE_WAV = "workflows/ltx-2.3/test-viewer/voicedesign/rn_wv_dialogue_v2.wav"; // 5.9s
const DIALOGUE_END = 5.9;

// B 配置(你听过最棒的)
const LORA_STRENGTH = 2.0;
const SEED = 42;
const CFG = 1.0;

const PROMPT = "Heavy rain pouring down on a wet stone alley at night, raindrops hitting puddles and wet stone pavement, steady rainfall, water dripping from eaves, gentle wind, footsteps splashing in shallow puddles, fabric rustling. No speech is present. No music is present.";
const NEG = "music, melody, song, singing, vocals, score, soundtrack, beat, instrumental backing, tinny, harsh, clipped, distorted";

const INT8 = "ltx-2.3-22b-distilled-1.1_transformer_only_int8_convrot.safetensors";
const GEMMA = "gemma_3_12B_it_fp8_scaled.safetensors";
const LTX_PROJ = "ltx-2.3_text_projection_bf16.safetensors";
const VIDEO_VAE = "LTX23_video_vae_bf16.safetensors";
const AUDIO_VAE = "LTX23_audio_vae_bf16.safetensors";
const FOLEY_LORA = "ltx-2.3-foley-400-steps.safetensors";
const DISTILLED_SIGMAS = "1.0, 0.99375, 0.9875, 0.98125, 0.975, 0.909375, 0.725, 0.421875, 0.0";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function buildWorkflow(inputFile: string, prefix: string): Record<string, any> {
  return {
    "1": { class_type: "LoadVideo", inputs: { file: inputFile } },
    "2": { class_type: "GetVideoComponents", inputs: { video: ["1", 0] } },
    "3": { class_type: "OTUNetLoaderW8A8", inputs: {
      unet_name: INT8, weight_dtype: "default", model_type: "ltx2",
      on_the_fly_quantization: false, enable_convrot: true, lora_mode: "None",
    }},
    "10": { class_type: "LoraLoaderModelOnly", inputs: {
      model: ["3", 0], lora_name: FOLEY_LORA, strength_model: LORA_STRENGTH,
    }},
    "31": { class_type: "VAELoader", inputs: { vae_name: VIDEO_VAE } },
    "4": { class_type: "VAELoader", inputs: { vae_name: AUDIO_VAE } },
    "5": { class_type: "DualCLIPLoader", inputs: { clip_name1: GEMMA, clip_name2: LTX_PROJ, type: "ltxv" } },
    "6": { class_type: "CLIPTextEncode", inputs: { text: PROMPT, clip: ["5", 0] } },
    "7": { class_type: "CLIPTextEncode", inputs: { text: NEG, clip: ["5", 0] } },
    "8": { class_type: "LTXVConditioning", inputs: { positive: ["6", 0], negative: ["7", 0], frame_rate: ["2", 2] } },
    // 滑窗:89 帧/窗,1s overlap → 15s 约 5 窗
    "9": { class_type: "LTXFoleyWindowPlan", inputs: {
      images: ["2", 0], frame_rate: ["2", 2], window_frames: 89, overlap_seconds: 1, max_windows: 16,
    }},
    "11": { class_type: "LTXFoleyForLoopOpen", inputs: { remaining: ["9", 1] } },
    "12": { class_type: "LTXFoleyWindowSelect", inputs: {
      images: ["2", 0], window_plan: ["9", 0], remaining: ["11", 1],
    }},
    "13": { class_type: "LTXFoleyVideoToAudioLatent", inputs: {
      images: ["12", 0], positive: ["8", 0], negative: ["8", 1],
      video_vae: ["31", 0], audio_vae: ["4", 0], frame_rate: ["2", 2],
      width: 640, height: 352, frames: 89,
    }},
    // 蒸馏采样器(对齐 msr.ts 出雨配置)
    "15": { class_type: "RandomNoise", inputs: { noise_seed: SEED } },
    "27": { class_type: "ManualSigmas", inputs: { sigmas: DISTILLED_SIGMAS } },
    "33": { class_type: "KSamplerSelect", inputs: { sampler_name: "euler" } },
    "37": { class_type: "CFGGuider", inputs: {
      model: ["10", 0], positive: ["13", 0], negative: ["13", 1], cfg: CFG,
    }},
    "16": { class_type: "SamplerCustomAdvanced", inputs: {
      noise: ["15", 0], guider: ["37", 0], sampler: ["33", 0], sigmas: ["27", 0],
      latent_image: ["13", 2],
    }},
    "21": { class_type: "LTXVSeparateAVLatent", inputs: { av_latent: ["16", 0] } },
    "22": { class_type: "LTXFoleyAudioVAEDecode", inputs: { samples: ["21", 1], audio_vae: ["4", 0] } },
    "23": { class_type: "LTXFoleyWindowAudioSave", inputs: {
      audio: ["22", 0], window_info: ["12", 1], save_audio: true, filename_prefix: "foley15_win",
    }},
    "24": { class_type: "LTXFoleyAudioAccumulator", inputs: { window_record: ["23", 1], accumulation: ["11", 2] } },
    "25": { class_type: "LTXFoleyForLoopClose", inputs: { flow_control: ["11", 0], audio_accumulation: ["24", 0] } },
    "26": { class_type: "LTXFoleyAudioStitch", inputs: { accumulation: ["25", 0], window_plan: ["9", 0] } },
    "34": { class_type: "CreateVideo", inputs: { images: ["2", 0], fps: ["2", 2], audio: ["26", 0] } },
    "28": { class_type: "SaveVideo", inputs: { video: ["34", 0], filename_prefix: prefix, format: "auto", codec: "auto" } },
  };
}

async function submitAndWait(workflow: any, prefix: string): Promise<any> {
  const res = await axios.post(`${COMFY}/prompt`, { prompt: workflow }, { timeout: 30_000, validateStatus: (s: number) => s < 500 });
  if (res.status !== 200) throw new Error(`ComfyUI rejected:\n${JSON.stringify(res.data, null, 2).slice(0, 1800)}`);
  const promptId = res.data.prompt_id;
  console.log(`  submitted promptId=${promptId}`);
  const start = Date.now();
  let lastWin = "";
  for (;;) {
    await sleep(4000);
    const hist = await axios.get(`${COMFY}/history/${promptId}`, { timeout: 15_000 });
    const e = hist.data?.[promptId];
    if (e?.status?.status_str === "error") throw new Error(`execution error: ${JSON.stringify(e.status.messages || e.status).slice(0, 1500)}`);
    // 进度:抓 ComfyUI 日志里的 window select 行
    const outs = e?.outputs;
    if (outs && Object.keys(outs).length) {
      for (const nid of Object.keys(outs)) {
        const o = outs[nid];
        const vid = [...(o?.videos||[]),...(o?.gifs||[]),...(o?.images||[])].find((c:any)=>/\.(mp4|webm|mov)$/i.test(c.filename||""));
        if (vid) { console.log(`  ✓ ${((Date.now()-start)/1000).toFixed(0)}s → ${vid.filename}`); return vid; }
      }
    }
    if (Date.now() - start > 900_000) throw new Error(`timeout (status: ${e?.status?.status_str || "unknown"})`);
  }
}

async function download(file: any, local: string) {
  const url = `${COMFY}/view?filename=${encodeURIComponent(file.filename)}&subfolder=${encodeURIComponent(file.subfolder||"")}&type=output`;
  const res = await axios.get(url, { responseType: "stream", timeout: 180_000 });
  await new Promise<void>((resolve, reject) => { const ws = fs.createWriteStream(local); res.data.pipe(ws).on("finish",()=>{ws.close();resolve();}).on("error",reject); });
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // 1) 准备 Foley 输入:整段 15s 仅画面
  const inputName = "foley_input_15s.mp4";
  const tmpVideo = `${TMP}/foley_input_15s.mp4`;
  execSync(`ffmpeg -y -i "${SRC_VIDEO}" -an -c:v libx264 -preset fast -crf 18 "${tmpVideo}" 2>/dev/null`, { timeout: 120_000 });
  execSync(`docker cp "${tmpVideo}" ${CONTAINER}:"${INPUT_DIR}/${inputName}"`, { timeout: 30_000 });
  console.log(`Foley 输入: ${inputName} (15s 仅画面)`);

  // 2) 跑 Foley V2A(滑窗 ~5 窗)
  console.log(`\n=== Foley V2A 15s (LoRA=${LORA_STRENGTH}, seed=${SEED}, cfg=${CFG}, 蒸馏9步, 滑窗89帧/1s overlap) ===`);
  const t0 = Date.now();
  const prefix = "foley15_B";
  const wf = buildWorkflow(inputName, prefix);
  const file = await submitAndWait(wf, prefix);
  const foleyMp4 = `${OUT_DIR}/foley15_B.mp4`;
  await download(file, foleyMp4);
  console.log(`  Foley 完成 ${((Date.now()-t0)/1000).toFixed(0)}s → ${foleyMp4} (${(fs.statSync(foleyMp4).size/1024/1024).toFixed(2)}MB)`);

  // 3) 提取 Foley 环境音 wav
  const foleyAmbient = `${TMP}/foley_ambient.wav`;
  execSync(`ffmpeg -y -i "${foleyMp4}" -vn -ar 48000 -ac 2 "${foleyAmbient}" 2>/dev/null`, { timeout: 30_000 });
  const foleyDur = parseFloat(execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${foleyAmbient}"`).toString().trim());
  console.log(`  Foley 环境音: ${foleyDur.toFixed(2)}s`);

  // 4) 混音:对话 × 1.0 + Foley 环境 × 0.55,sidechain ducking(对话时压环境)+ alimiter
  //    复用 msr.ts executeFiveStagePipeline 的混音套路
  const dialogueLocal = `${TMP}/dialogue.wav`;
  execSync(`docker cp ${CONTAINER}:"${INPUT_DIR}/rn_wv_dialogue_v2.wav" "${dialogueLocal}" 2>/dev/null || cp "${DIALOGUE_WAV}" "${dialogueLocal}"`, { timeout: 30_000 });
  const mixedAudio = `${TMP}/foley_mixed.wav`;
  const targetDur = foleyDur.toFixed(3);
  const mixFilter = [
    "[1:a]asplit=2[s2a][s2b]",                         // dialogue split
    `[s2a]apad=whole_dur=${targetDur}[s2pad]`,         // dialogue pad 到全长(sidechain 需要)
    "[0:a][s2pad]sidechaincompress=threshold=0.03:ratio=10:attack=10:release=400[ducked]", // foley 被 dialogue 压
    "[ducked]volume=0.55[foleygain]",
    "[s2b]volume=1.0[voxdgain]",
    "[voxdgain][foleygain]amix=inputs=2:duration=longest:weights=1 1:normalize=0[sum]",
    "[sum]alimiter=limit=0.95:attack=5:release=50[limited]",
  ].join(";");
  execSync(`ffmpeg -y -i "${foleyAmbient}" -i "${dialogueLocal}" -filter_complex "${mixFilter}" -map "[limited]" -ar 48000 -ac 2 -t ${targetDur} "${mixedAudio}"`, { timeout: 30_000 });
  console.log(`  混音完成 → ${mixedAudio}`);

  // 5) Mux 原画面 + 混音
  const finalMp4 = `${OUT_DIR}/foley15_final.mp4`;
  execSync(`ffmpeg -y -i "${tmpVideo}" -i "${mixedAudio}" -map 0:v:0 -map 1:a:0 -af "apad" -c:v copy -c:a aac -b:a 192k -shortest "${finalMp4}"`, { timeout: 60_000 });
  console.log(`\n✅ 最终成片 → ${finalMp4} (${(fs.statSync(finalMp4).size/1024/1024).toFixed(2)}MB)`);

  // 6) 顺手把对话+Foley环境拆出来便于单独听
  execSync(`ffmpeg -y -i "${foleyAmbient}" -t ${targetDur} -ac 1 -ar 48000 "${OUT_DIR}/foley15_ambient_only.wav" 2>/dev/null`, { timeout: 30_000 });

  console.log(`\n对比基准(原 LTX-native): ${SRC_VIDEO}`);
  console.log(`成片(对话+Foley):       ${finalMp4}`);
}

main().catch(e => { console.error("FATAL:", e.stack || e.message); process.exit(1); });
