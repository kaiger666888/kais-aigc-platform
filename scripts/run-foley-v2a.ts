/**
 * Foley V2A 验证:在我们的视频上跑 FuzzPuppy/LTX-2.3-Foley-LoRA,看环境音是否比白噪音好。
 *
 * 把官方 foley-sliding-window 工作流(UI 格式)手工转成 API 格式,并改造为 int8_convrot:
 *   - CheckpointLoaderSimple(dev-fp8)  → OTUNetLoaderW8A8(int8_convrot) + VAELoader(video) + VAELoader(audio)
 *   - LTXAVTextEncoderLoader(dev-fp8)  → DualCLIPLoader(gemma + ltx_projection)
 *   - LTXVAudioVAELoader(dev-fp8)      → VAELoader(LTX23_audio_vae)
 *   其余 24 节点(循环/采样/Foley helper)原样保留。
 *
 * 用法:npx tsx scripts/run-foley-v2a.ts
 */
import fs from "fs";
import path from "path";
import axios from "axios";
import { execSync } from "child_process";

const COMFY = "http://localhost:8188";
const CONTAINER = "comfyui-primary";
const INPUT_DIR = "/root/ComfyUI/input";
const OUT_DIR = "workflows/ltx-2.3/msr-lastframe-test-output";

// 输入:从 voiced_15s 取一段干净 3s(跳过开头 LiconMSR 条件段)
const SRC_VIDEO = "workflows/ltx-2.3/msr-lastframe-test-output/voiced_15s_with_lastframe.mp4";
const CLIP_START = 3;   // 跳过开头条件段(~1.5s)+ 余量
const CLIP_LEN = 4;     // 4s,确保足够内容给 Foley

const PROMPT = "Heavy rain pouring down on a wet stone alley at night, raindrops hitting puddles and wet stone, steady rainfall, water dripping, gentle wind. No speech is present. No music is present.";
const NEG = "music, melody, song, singing, vocals, score, soundtrack, beat, rhythm bed, instrumental backing, tinny, thin, harsh, clipped, distorted, low bitrate";
const SEED = 42;

const INT8 = "ltx-2.3-22b-distilled-1.1_transformer_only_int8_convrot.safetensors";
const GEMMA = "gemma_3_12B_it_fp8_scaled.safetensors";
const LTX_PROJ = "ltx-2.3_text_projection_bf16.safetensors";
const VIDEO_VAE = "LTX23_video_vae_bf16.safetensors";
const AUDIO_VAE = "LTX23_audio_vae_bf16.safetensors";
const FOLEY_LORA = "ltx-2.3-foley-400-steps.safetensors";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function buildWorkflow(inputFile: string, opts: { stg: number; loraStrength: number; prefix: string }): Record<string, any> {
  const wf: Record<string, any> = {
    // === Loaders(int8_convrot 改造)===
    "1": { class_type: "LoadVideo", inputs: { file: inputFile } },
    "2": { class_type: "GetVideoComponents", inputs: { video: ["1", 0] } },        // IMAGE[0] AUDIO[1] fps[2]
    "3": { class_type: "OTUNetLoaderW8A8", inputs: {            // MODEL[0] (原 CheckpointLoaderSimple)
      unet_name: INT8, weight_dtype: "default", model_type: "ltx2",
      on_the_fly_quantization: false, enable_convrot: true, lora_mode: "None",
    }},
    "31": { class_type: "VAELoader", inputs: { vae_name: VIDEO_VAE } },            // 新增:视频 VAE
    "4": { class_type: "VAELoader", inputs: { vae_name: AUDIO_VAE } },             // 原 LTXVAudioVAELoader → VAELoader
    "5": { class_type: "DualCLIPLoader", inputs: {                                // CLIP[0] (原 LTXAVTextEncoderLoader)
      clip_name1: GEMMA, clip_name2: LTX_PROJ, type: "ltxv",
    }},
    "10": { class_type: "LoraLoaderModelOnly", inputs: {
      model: ["3", 0], lora_name: FOLEY_LORA, strength_model: opts.loraStrength,
    }},
    // === Text + Conditioning ===
    "6": { class_type: "CLIPTextEncode", inputs: { text: PROMPT, clip: ["5", 0] } },
    "7": { class_type: "CLIPTextEncode", inputs: { text: NEG, clip: ["5", 0] } },
    "8": { class_type: "LTXVConditioning", inputs: {
      positive: ["6", 0], negative: ["7", 0], frame_rate: ["2", 2],
    }},
    // === Foley 窗口规划(window_frames=89,overlap=1s,max=16)===
    "9": { class_type: "LTXFoleyWindowPlan", inputs: {
      images: ["2", 0], frame_rate: ["2", 2], window_frames: 89, overlap_seconds: 1, max_windows: 16,
    }},
    // === Foley 循环 ===
    "11": { class_type: "LTXFoleyForLoopOpen", inputs: { remaining: ["9", 1] } },
    "12": { class_type: "LTXFoleyWindowSelect", inputs: {
      images: ["2", 0], window_plan: ["9", 0], remaining: ["11", 1],
    }},
    "13": { class_type: "LTXFoleyVideoToAudioLatent", inputs: {
      images: ["12", 0], positive: ["8", 0], negative: ["8", 1],
      video_vae: ["31", 0], audio_vae: ["4", 0], frame_rate: ["2", 2],
      width: 576, height: 576, frames: 89,
    }},
    // === 采样链(保留 STG 节点结构,仅调 stg 强度;避免摘节点破坏 guider/scheduler 配对)==="
    "14": { class_type: "ModelSamplingLTXV", inputs: { model: ["10", 0], max_shift: 2.05, base_shift: 0.95, latent: ["13", 2] } },
    "15": { class_type: "LTXVApplySTG", inputs: { model: ["14", 0], block_indices: "14, 19" } },
    "16": { class_type: "STGGuiderNode", inputs: { model: ["15", 0], positive: ["13", 0], negative: ["13", 1], cfg: 4, stg: opts.stg, rescale: 0.7 } },
    "17": { class_type: "RandomNoise", inputs: { noise_seed: SEED } },
    "18": { class_type: "KSamplerSelect", inputs: { sampler_name: "euler_ancestral_cfg_pp" } },
    "19": { class_type: "LTXVScheduler", inputs: { steps: 30, max_shift: 2.05, base_shift: 0.95, stretch: true, terminal: 0.1, latent: ["13", 2] } },
    "20": { class_type: "SamplerCustomAdvanced", inputs: {
      noise: ["17", 0], guider: ["16", 0], sampler: ["18", 0], sigmas: ["19", 0], latent_image: ["13", 2],
    }},
    // === 音频解码 + 累积 ===
    "21": { class_type: "LTXVSeparateAVLatent", inputs: { av_latent: ["20", 0] } },
    "22": { class_type: "LTXFoleyAudioVAEDecode", inputs: { samples: ["21", 1], audio_vae: ["4", 0] } },
    "23": { class_type: "LTXFoleyWindowAudioSave", inputs: { audio: ["22", 0], window_info: ["12", 1], save_audio: false, filename_prefix: "ltx_foley_window" } },
    "24": { class_type: "LTXFoleyAudioAccumulator", inputs: { window_record: ["23", 1], accumulation: ["11", 2] } },
    "25": { class_type: "LTXFoleyForLoopClose", inputs: { flow_control: ["11", 0], audio_accumulation: ["24", 0] } },
    "26": { class_type: "LTXFoleyAudioStitch", inputs: { accumulation: ["25", 0], window_plan: ["9", 0] } },
    // === 输出 ===
    "27": { class_type: "CreateVideo", inputs: { images: ["2", 0], fps: ["2", 2], audio: ["26", 0] } },
    "28": { class_type: "SaveVideo", inputs: { video: ["27", 0], filename_prefix: opts.prefix, format: "auto", codec: "auto" } },
  };
  return wf;
}

async function submitAndWait(workflow: any, prefix: string): Promise<any> {
  const res = await axios.post(`${COMFY}/prompt`, { prompt: workflow }, { timeout: 30_000, validateStatus: (s: number) => s < 500 });
  if (res.status !== 200) throw new Error(`ComfyUI rejected:\n${JSON.stringify(res.data, null, 2).slice(0, 1500)}`);
  const promptId = res.data.prompt_id;
  console.log(`submitted promptId=${promptId}`);
  const start = Date.now();
  for (;;) {
    await sleep(3000);
    const hist = await axios.get(`${COMFY}/history/${promptId}`, { timeout: 15_000 });
    const e = hist.data?.[promptId];
    if (e?.status?.status_str === "error") {
      throw new Error(`execution error: ${JSON.stringify(e.status.messages || e.status).slice(0, 1200)}`);
    }
    const outs = e?.outputs;
    if (outs && Object.keys(outs).length) {
      for (const nid of Object.keys(outs)) {
        const o = outs[nid];
        const vid = [...(o?.videos||[]),...(o?.gifs||[]),...(o?.images||[])].find((c:any)=>/\.(mp4|webm|mov)$/i.test(c.filename||""));
        if (vid) { console.log(`✓ ${((Date.now()-start)/1000).toFixed(0)}s → ${vid.filename}`); return vid; }
      }
    }
    if (Date.now() - start > 900_000) throw new Error(`timeout (status: ${e?.status?.status_str || "unknown"})`);
  }
}

async function download(file: any, local: string) {
  const url = `${COMFY}/view?filename=${encodeURIComponent(file.filename)}&subfolder=${encodeURIComponent(file.subfolder||"")}&type=output`;
  const res = await axios.get(url, { responseType: "stream", timeout: 120_000 });
  await new Promise<void>((resolve, reject) => { const ws = fs.createWriteStream(local); res.data.pipe(ws).on("finish",()=>{ws.close();resolve();}).on("error",reject); });
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // 1) 裁一段干净 4s 视频作 Foley 输入
  const tmpClip = "/tmp/foley_input.mp4";
  execSync(`ffmpeg -y -ss ${CLIP_START} -t ${CLIP_LEN} -i "${SRC_VIDEO}" -an -c:v libx264 -preset fast -crf 18 "${tmpClip}" 2>/dev/null`, { timeout: 60_000 });
  const inputName = "foley_input.mp4";
  execSync(`docker cp "${tmpClip}" ${CONTAINER}:"${INPUT_DIR}/${inputName}"`, { timeout: 30_000 });
  console.log(`输入视频: ${inputName} (${CLIP_LEN}s, 跳过开头条件段)`);

  // 2) 跑变体:保留 STG 结构,降 stg 强度(隔离伪影)
  const variants = [
    { tag: "stg0.0", stg: 0.0, loraStrength: 1.0, prefix: "foley_stg0" },
  ];

  if (process.env.DRY === "1") { const wf = buildWorkflow(inputName, { stg: 0.0, loraStrength: 1.0, prefix: "dry" }); fs.writeFileSync(`${OUT_DIR}/foley_workflow_api.json`, JSON.stringify(wf, null, 2)); console.log("DRY=1,已写 workflow JSON"); return; }

  for (const v of variants) {
    console.log(`\n=== 变体 ${v.tag} (stg=${v.stg}, lora=${v.loraStrength}) ===`);
    const wf = buildWorkflow(inputName, v);
    const file = await submitAndWait(wf, v.prefix);
    const local = `${OUT_DIR}/${v.prefix}.mp4`;
    await download(file, local);
    const wav = `${OUT_DIR}/${v.prefix}.wav`;
    execSync(`ffmpeg -y -i "${local}" -vn -ac 1 -ar 48000 "${wav}" 2>/dev/null`, { timeout: 30_000 });
    const out = execSync(`ffmpeg -i "${wav}" -af astats=metadata=1 -f null - 2>&1`, { timeout: 30_000 }).toString();
    const rms = (out.match(/RMS level dB:\s*(-?[\d.]+)/)||[])[1];
    const ent = (out.match(/Entropy:\s*(-?[\d.]+)/)||[])[1];
    const crest = (out.match(/Crest factor:\s*(-?[\d.]+)/)||[])[1];
    console.log(`✅ ${v.tag}: ${local} (${(fs.statSync(local).size/1024/1024).toFixed(2)}MB)  RMS=${rms}dB Entropy=${ent} Crest=${crest}`);
  }
  console.log(`\n(对比:首版 stg=1.0 伪影 RMS=-37dB Crest=36.6;Stage3 白噪音 RMS=-51dB)`);
}
main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
