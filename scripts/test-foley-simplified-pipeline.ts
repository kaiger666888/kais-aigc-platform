/**
 * 简化管线验证:v1 全冻结单 pass 口型画面 → Foley V2A → 混音。
 *
 * 假设:Foley 接管环境音后,前端 LTX 不必再生成任何交付音频,只需 TTS 驱动口型。
 *   - audioMode="dialogue+ambient"(v1 SolidMask 全冻结):TTS 冻结作条件,采样器 100% 给画面
 *   - 砍掉 Stage 3(它只产环境音频,现归 Foley)
 *   - 丢弃 LTX 音频,用 TTS + Foley 混音覆盖
 *
 * 对比基准:foley15_final(v2 partial-mask 视频 + Foley,2-pass)。
 * 用法:npx tsx scripts/test-foley-simplified-pipeline.ts
 */
import fs from "fs";
import path from "path";
import axios from "axios";
import { execSync } from "child_process";
import { buildMSRWorkflow } from "../src/routes/production/ltx/msr";

const COMFY = process.env.LTX_COMFYUI_URL || "http://localhost:8188";
const CONTAINER = process.env.LTX_CONTAINER_NAME || "comfyui-primary";
const INPUT_DIR = "/root/ComfyUI/input";
const OUT_DIR = "workflows/ltx-2.3/foley-distilled-test-output";
const TMP = process.env.CLAUDE_JOB_DIR || "/tmp";

const REFS_HOST = [
  "workflows/ltx-2.3/test-viewer/refs-real/1.jpg",
  "workflows/ltx-2.3/test-viewer/refs-real/2.jpg",
  "workflows/ltx-2.3/test-viewer/refs-real/bg.png",
];
const FIRST_HOST = "workflows/ltx-2.3/msr-lastframe-test-output/dreamina/keyframe_first.png";
const LAST_HOST = "workflows/ltx-2.3/msr-lastframe-test-output/dreamina/keyframe_last.png";
const DIALOGUE_HOST = "workflows/ltx-2.3/test-viewer/voicedesign/rn_wv_dialogue_v2.wav";

const WIDTH = Number(process.env.WIDTH) || 1280, HEIGHT = Number(process.env.HEIGHT) || 704, FPS = 24, DURATION = 15;
const RES_TAG = process.env.RES_TAG || `${WIDTH}x${HEIGHT}`;
const SEED = 1513163486;
const numFrames = Math.ceil((Math.round(DURATION * FPS)) / 8) * 8 + 1; // 361

const PROMPT = "烟雨朦胧的江南小镇石板路,夜晚,暖黄灯笼倒映在湿漉漉的石板镜面上。RN(男人,深棕长发半束,酒红色暗纹广袖长袍外搭黑色狐狸毛大氅)与WV(女人,乌黑盘发缀绿玉白花发饰,暗绿色抹胸鱼尾长裙)面对面站着,随后并肩向街道深处走去,镜头缓缓绕到身后展示背影。大雨倾盆,雨滴打在湿石板和水洼上,屋檐滴水,微风。电影感手摇镜头。";
const STAGE2_SUFFIX = "两人正在交谈:RN(男人)率先开口说话,嘴唇随话语同步开合,说道:\"这么巧,没想到会在这里遇见你\";WV(女人)微微脸红点头,甜美地回答,嘴唇随话语开合:\"我也没想到,一起走吧\"。两人对话时嘴型与语音精准对口型同步。";
const NEG = "worst quality, blurry, jittery, distorted, text, watermark, subtitles, static mouth, frozen face, closed lips while speaking, mismatched lips";

// Foley B 配置
const FOLEY_LORA_STRENGTH = 2.0, FOLEY_SEED = 42, FOLEY_CFG = 1.0;
const FOLEY_PROMPT = "Heavy rain pouring down on a wet stone alley at night, raindrops hitting puddles and wet stone pavement, steady rainfall, water dripping from eaves, gentle wind, footsteps splashing in shallow puddles, fabric rustling. No speech is present. No music is present.";
const FOLEY_NEG = "music, melody, song, singing, vocals, score, soundtrack, beat, instrumental backing, tinny, harsh, clipped, distorted";
const INT8 = "ltx-2.3-22b-distilled-1.1_transformer_only_int8_convrot.safetensors";
const GEMMA = "gemma_3_12B_it_fp8_scaled.safetensors";
const LTX_PROJ = "ltx-2.3_text_projection_bf16.safetensors";
const VIDEO_VAE = "LTX23_video_vae_bf16.safetensors";
const AUDIO_VAE = "LTX23_audio_vae_bf16.safetensors";
const FOLEY_LORA = "ltx-2.3-foley-400-steps.safetensors";
const DISTILLED_SIGMAS = "1.0, 0.99375, 0.9875, 0.98125, 0.975, 0.909375, 0.725, 0.421875, 0.0";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
function dockerCp(h: string) { const b = path.basename(h); execSync(`docker cp "${h}" ${CONTAINER}:"${INPUT_DIR}/${b}"`, { timeout: 30_000 }); return b; }

async function submitAndWait(workflow: any, prefix: string, timeoutMs = 1_800_000): Promise<any> {
  const res = await axios.post(`${COMFY}/prompt`, { prompt: workflow }, { timeout: 30_000, validateStatus: (s: number) => s < 500 });
  if (res.status !== 200) throw new Error(`ComfyUI rejected:\n${JSON.stringify(res.data, null, 2).slice(0, 1800)}`);
  const promptId = res.data.prompt_id;
  console.log(`  submitted promptId=${promptId}`);
  const start = Date.now();
  for (;;) {
    await sleep(4000);
    const hist = await axios.get(`${COMFY}/history/${promptId}`, { timeout: 15_000 });
    const e = hist.data?.[promptId];
    if (e?.status?.status_str === "error") throw new Error(`execution error: ${JSON.stringify(e.status.messages || e.status).slice(0, 1500)}`);
    const outs = e?.outputs;
    if (outs && Object.keys(outs).length) {
      for (const nid of Object.keys(outs)) {
        const o = outs[nid];
        const vid = [...(o?.videos||[]),...(o?.gifs||[]),...(o?.images||[])].find((c:any)=>/\.(mp4|webm|mov)$/i.test(c.filename||""));
        if (vid) { console.log(`  ✓ ${((Date.now()-start)/1000).toFixed(0)}s → ${vid.filename}`); return vid; }
      }
    }
    if (Date.now() - start > timeoutMs) throw new Error(`timeout (status: ${e?.status?.status_str || "unknown"})`);
  }
}
function findOutputFallback(prefix: string): string | null {
  try { const out = execSync(`docker exec ${CONTAINER} bash -lc 'ls -t /root/ComfyUI/output/${prefix}*.mp4 2>/dev/null | head -1'`, { timeout: 10_000 }).toString().trim(); return out || null; } catch { return null; }
}
async function download(file: any, local: string) {
  const url = `${COMFY}/view?filename=${encodeURIComponent(file.filename)}&subfolder=${encodeURIComponent(file.subfolder||"")}&type=output`;
  const res = await axios.get(url, { responseType: "stream", timeout: 180_000 });
  await new Promise<void>((resolve, reject) => { const ws = fs.createWriteStream(local); res.data.pipe(ws).on("finish",()=>{ws.close();resolve();}).on("error",reject); });
}

function buildFoleyWorkflow(inputFile: string, prefix: string): Record<string, any> {
  return {
    "1": { class_type: "LoadVideo", inputs: { file: inputFile } },
    "2": { class_type: "GetVideoComponents", inputs: { video: ["1", 0] } },
    "3": { class_type: "OTUNetLoaderW8A8", inputs: { unet_name: INT8, weight_dtype: "default", model_type: "ltx2", on_the_fly_quantization: false, enable_convrot: true, lora_mode: "None" } },
    "10": { class_type: "LoraLoaderModelOnly", inputs: { model: ["3", 0], lora_name: FOLEY_LORA, strength_model: FOLEY_LORA_STRENGTH } },
    "31": { class_type: "VAELoader", inputs: { vae_name: VIDEO_VAE } },
    "4": { class_type: "VAELoader", inputs: { vae_name: AUDIO_VAE } },
    "5": { class_type: "DualCLIPLoader", inputs: { clip_name1: GEMMA, clip_name2: LTX_PROJ, type: "ltxv" } },
    "6": { class_type: "CLIPTextEncode", inputs: { text: FOLEY_PROMPT, clip: ["5", 0] } },
    "7": { class_type: "CLIPTextEncode", inputs: { text: FOLEY_NEG, clip: ["5", 0] } },
    "8": { class_type: "LTXVConditioning", inputs: { positive: ["6", 0], negative: ["7", 0], frame_rate: ["2", 2] } },
    "9": { class_type: "LTXFoleyWindowPlan", inputs: { images: ["2", 0], frame_rate: ["2", 2], window_frames: 89, overlap_seconds: 1, max_windows: 16 } },
    "11": { class_type: "LTXFoleyForLoopOpen", inputs: { remaining: ["9", 1] } },
    "12": { class_type: "LTXFoleyWindowSelect", inputs: { images: ["2", 0], window_plan: ["9", 0], remaining: ["11", 1] } },
    "13": { class_type: "LTXFoleyVideoToAudioLatent", inputs: { images: ["12", 0], positive: ["8", 0], negative: ["8", 1], video_vae: ["31", 0], audio_vae: ["4", 0], frame_rate: ["2", 2], width: 640, height: 352, frames: 89 } },
    "15": { class_type: "RandomNoise", inputs: { noise_seed: FOLEY_SEED } },
    "27": { class_type: "ManualSigmas", inputs: { sigmas: DISTILLED_SIGMAS } },
    "33": { class_type: "KSamplerSelect", inputs: { sampler_name: "euler" } },
    "37": { class_type: "CFGGuider", inputs: { model: ["10", 0], positive: ["13", 0], negative: ["13", 1], cfg: FOLEY_CFG } },
    "16": { class_type: "SamplerCustomAdvanced", inputs: { noise: ["15", 0], guider: ["37", 0], sampler: ["33", 0], sigmas: ["27", 0], latent_image: ["13", 2] } },
    "21": { class_type: "LTXVSeparateAVLatent", inputs: { av_latent: ["16", 0] } },
    "22": { class_type: "LTXFoleyAudioVAEDecode", inputs: { samples: ["21", 1], audio_vae: ["4", 0] } },
    "23": { class_type: "LTXFoleyWindowAudioSave", inputs: { audio: ["22", 0], window_info: ["12", 1], save_audio: false, filename_prefix: "foleysimp_win" } },
    "24": { class_type: "LTXFoleyAudioAccumulator", inputs: { window_record: ["23", 1], accumulation: ["11", 2] } },
    "25": { class_type: "LTXFoleyForLoopClose", inputs: { flow_control: ["11", 0], audio_accumulation: ["24", 0] } },
    "26": { class_type: "LTXFoleyAudioStitch", inputs: { accumulation: ["25", 0], window_plan: ["9", 0] } },
    "34": { class_type: "CreateVideo", inputs: { images: ["2", 0], fps: ["2", 2], audio: ["26", 0] } },
    "28": { class_type: "SaveVideo", inputs: { video: ["34", 0], filename_prefix: prefix, format: "auto", codec: "auto" } },
  };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const refs = REFS_HOST.map(dockerCp);
  const firstFrame = dockerCp(FIRST_HOST);
  const lastFrame = dockerCp(LAST_HOST);
  const dialogue = dockerCp(DIALOGUE_HOST);
  console.log(`assets: refs=${refs} first=${firstFrame} last=${lastFrame} dialogue=${dialogue}`);

  // ===== 1) v1 全冻结单 pass 口型画面 =====
  console.log(`\n=== [1/3] v1 全冻结视频(audioMode=dialogue+ambient, 单 pass, seed=${SEED}) ===`);
  const t0 = Date.now();
  const v1Prefix = `msr_v1freeze_${RES_TAG}`;
  const v1VideoLocal = `${OUT_DIR}/v1freeze_${RES_TAG}.mp4`;
  let v1File: any;
  if (fs.existsSync(v1VideoLocal)) {
    console.log(`  (skip) 复用已有 ${v1VideoLocal}`);
  } else {
    const v1Wf = buildMSRWorkflow({
      refFilenames: refs,
      prompt: PROMPT + STAGE2_SUFFIX,        // 对口型标注直接进 prompt(v1 没有 stage2PromptSuffix 概念)
      negativePrompt: NEG,
      width: WIDTH, height: HEIGHT, numFrames, msrFrameCount: 41, fps: FPS,
      seed: SEED, filenamePrefix: v1Prefix,
      customAudioFilename: dialogue,
      audioMode: "dialogue+ambient",         // ← v1 SolidMask 全冻结:采样器只管画面
      firstFrameFilename: firstFrame, firstFrameIdx: 42,
      lastFrameFilename: lastFrame,
      useV2: true,
    });
    try { v1File = await submitAndWait(v1Wf, v1Prefix); }
    catch (e: any) { const fb = findOutputFallback(v1Prefix); if (!fb) throw e; v1File = { filename: path.basename(fb), subfolder: "" }; console.log("  (fallback)"); }
    await download(v1File, v1VideoLocal);
  }
  // 剥出纯画面供 Foley
  const v1VideoOnly = `${TMP}/v1freeze_video_only.mp4`;
  execSync(`ffmpeg -y -i "${v1VideoLocal}" -an -c:v libx264 -preset fast -crf 18 "${v1VideoOnly}" 2>/dev/null`, { timeout: 120_000 });
  console.log(`  v1 视频 ${((Date.now()-t0)/1000).toFixed(0)}s → ${v1VideoLocal} (${(fs.statSync(v1VideoLocal).size/1024/1024).toFixed(2)}MB)`);

  // ===== 2) Foley V2A on v1 视频 =====
  console.log(`\n=== [2/3] Foley V2A(LoRA=${FOLEY_LORA_STRENGTH}, seed=${FOLEY_SEED}) ===`);
  const t1 = Date.now();
  const foleyInput = "v1freeze_foley_input.mp4";
  execSync(`docker cp "${v1VideoOnly}" ${CONTAINER}:"${INPUT_DIR}/${foleyInput}"`, { timeout: 30_000 });
  const foleyPrefix = `foleysimp_B_${RES_TAG}`;
  const foleyFile = await submitAndWait(buildFoleyWorkflow(foleyInput, foleyPrefix), foleyPrefix);
  const foleyMp4 = `${OUT_DIR}/foleysimp_B_${RES_TAG}.mp4`;
  await download(foleyFile, foleyMp4);
  const foleyAmbient = `${TMP}/foleysimp_ambient.wav`;
  execSync(`ffmpeg -y -i "${foleyMp4}" -vn -ar 48000 -ac 2 "${foleyAmbient}" 2>/dev/null`, { timeout: 30_000 });
  console.log(`  Foley ${((Date.now()-t1)/1000).toFixed(0)}s`);

  // ===== 3) 混音 TTS + Foley + mux =====
  console.log(`\n=== [3/3] 混音 + mux ===`);
  const dialogueLocal = `${TMP}/dialogue.wav`;
  execSync(`cp "${DIALOGUE_HOST}" "${dialogueLocal}"`, { timeout: 10_000 });
  const foleyDur = parseFloat(execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${foleyAmbient}"`).toString().trim());
  const mixedAudio = `${TMP}/foleysimp_mixed.wav`;
  const targetDur = foleyDur.toFixed(3);
  const mixFilter = [
    "[1:a]asplit=2[s2a][s2b]", `[s2a]apad=whole_dur=${targetDur}[s2pad]`,
    "[0:a][s2pad]sidechaincompress=threshold=0.03:ratio=10:attack=10:release=400[ducked]",
    "[ducked]volume=0.55[foleygain]", "[s2b]volume=1.0[voxdgain]",
    "[voxdgain][foleygain]amix=inputs=2:duration=longest:weights=1 1:normalize=0[sum]",
    "[sum]alimiter=limit=0.95:attack=5:release=50[limited]",
  ].join(";");
  execSync(`ffmpeg -y -i "${foleyAmbient}" -i "${dialogueLocal}" -filter_complex "${mixFilter}" -map "[limited]" -ar 48000 -ac 2 -t ${targetDur} "${mixedAudio}"`, { timeout: 30_000 });
  const finalMp4 = `${OUT_DIR}/foleysimp_final_${RES_TAG}.mp4`;
  execSync(`ffmpeg -y -i "${v1VideoOnly}" -i "${mixedAudio}" -map 0:v:0 -map 1:a:0 -af "apad" -c:v copy -c:a aac -b:a 192k -shortest "${finalMp4}"`, { timeout: 60_000 });
  console.log(`\n✅ 简化管线成片 ${((Date.now()-t0)/1000).toFixed(0)}s 总耗时 → ${finalMp4} (${(fs.statSync(finalMp4).size/1024/1024).toFixed(2)}MB)`);
  console.log(`   v1 视频(单 pass): ${v1VideoLocal}`);
  console.log(`   对比基准(2 pass): workflows/ltx-2.3/foley-distilled-test-output/foley15_final.mp4`);
}

main().catch(e => { console.error("FATAL:", e.stack || e.message); process.exit(1); });
