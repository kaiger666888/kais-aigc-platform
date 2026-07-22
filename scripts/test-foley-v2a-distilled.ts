/**
 * Foley V2A 重验证 —— 关键修正:用【蒸馏模型专用采样器】,不再用上次的 STG/cfg=4/30步。
 *
 * 上次 run-foley-v2a.ts 用 STGGuiderNode(cfg=4,stg)+ euler_ancestral_cfg_pp + LTXVScheduler(30步),
 * 但我们的 int8_convrot 是 distilled-1.1 烤入的蒸馏模型,必须配 ManualSigmas(9步)+ euler + cfg=1.0。
 * 采样器调度不匹配 = 生成噪声。本脚本对齐 MSR 现成的出雨配置重测。
 *
 * 三变体:
 *   A: int8 + Foley LoRA 1.0 + 蒸馏采样器
 *   B: int8 + Foley LoRA 2.0(残留时可加到 2-3)
 *   C: int8 无 LoRA 基线(int8 V2A 本身能否出雨)
 *
 * 输入:t=8s 起 3.7s(对话已结束,纯雨天行走 → 测雨声+脚步动作音),仅画面(-an)。
 * 用法:npx tsx scripts/test-foley-v2a-distilled.ts
 */
import fs from "fs";
import path from "path";
import axios from "axios";
import { execSync } from "child_process";

const COMFY = process.env.LTX_COMFYUI_URL || "http://localhost:8188";
const CONTAINER = process.env.LTX_CONTAINER_NAME || "comfyui-primary";
const INPUT_DIR = "/root/ComfyUI/input";
const OUT_DIR = "workflows/ltx-2.3/foley-distilled-test-output";

const SRC_VIDEO = "workflows/ltx-2.3/msr-lastframe-test-output/voiced_15s_cleanaudio.mp4";
const CLIP_START = 8;      // 对话(0-5.9s)已结束,纯雨天行走段
const CLIP_LEN = 3.7;      // 89 帧 @ 24fps

const PROMPT = "Heavy rain pouring down on a wet stone alley at night, raindrops hitting puddles and wet stone pavement, steady rainfall, water dripping from eaves, gentle wind, footsteps splashing in shallow puddles. No speech is present. No music is present.";
const NEG = "music, melody, song, singing, vocals, score, soundtrack, beat, instrumental backing, tinny, harsh, clipped, distorted";

const INT8 = "ltx-2.3-22b-distilled-1.1_transformer_only_int8_convrot.safetensors";
const GEMMA = "gemma_3_12B_it_fp8_scaled.safetensors";
const LTX_PROJ = "ltx-2.3_text_projection_bf16.safetensors";
const VIDEO_VAE = "LTX23_video_vae_bf16.safetensors";
const AUDIO_VAE = "LTX23_audio_vae_bf16.safetensors";
const FOLEY_LORA = "ltx-2.3-foley-400-steps.safetensors";

// 蒸馏模型 9 步 sigma 调度(对齐 msr.ts 节点 27,出雨的那套)
const DISTILLED_SIGMAS = "1.0, 0.99375, 0.9875, 0.98125, 0.975, 0.909375, 0.725, 0.421875, 0.0";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

interface Variant {
  tag: string;
  useLora: boolean;
  loraStrength: number;
  seed: number;
  cfg: number;
  prefix: string;
}

function buildWorkflow(inputFile: string, v: Variant): Record<string, any> {
  // LoRA 变体:model 链 3→10;基线:直接用 3
  const modelOut = v.useLora ? ["10", 0] : ["3", 0];
  const wf: Record<string, any> = {
    // === Loaders ===
    "1": { class_type: "LoadVideo", inputs: { file: inputFile } },
    "2": { class_type: "GetVideoComponents", inputs: { video: ["1", 0] } },       // IMAGE[0] fps[2]
    "3": { class_type: "OTUNetLoaderW8A8", inputs: {
      unet_name: INT8, weight_dtype: "default", model_type: "ltx2",
      on_the_fly_quantization: false, enable_convrot: true, lora_mode: "None",
    }},
    ...(v.useLora ? {
      "10": { class_type: "LoraLoaderModelOnly", inputs: {
        model: ["3", 0], lora_name: FOLEY_LORA, strength_model: v.loraStrength,
      }},
    } : {}),
    "31": { class_type: "VAELoader", inputs: { vae_name: VIDEO_VAE } },
    "4": { class_type: "VAELoader", inputs: { vae_name: AUDIO_VAE } },
    "5": { class_type: "DualCLIPLoader", inputs: { clip_name1: GEMMA, clip_name2: LTX_PROJ, type: "ltxv" } },
    // === Text + Conditioning ===
    "6": { class_type: "CLIPTextEncode", inputs: { text: PROMPT, clip: ["5", 0] } },
    "7": { class_type: "CLIPTextEncode", inputs: { text: NEG, clip: ["5", 0] } },
    "8": { class_type: "LTXVConditioning", inputs: { positive: ["6", 0], negative: ["7", 0], frame_rate: ["2", 2] } },
    // === Foley 窗口(单窗:89 帧 ≈ 3.7s)===
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
    }}, // → positive[0] negative[1] av_latent[2]
    // === 蒸馏采样器(对齐 msr.ts 出雨配置)===
    "15": { class_type: "RandomNoise", inputs: { noise_seed: v.seed } },
    "27": { class_type: "ManualSigmas", inputs: { sigmas: DISTILLED_SIGMAS } },
    "33": { class_type: "KSamplerSelect", inputs: { sampler_name: "euler" } },
    "37": { class_type: "CFGGuider", inputs: {
      model: modelOut, positive: ["13", 0], negative: ["13", 1], cfg: v.cfg,
    }},
    "16": { class_type: "SamplerCustomAdvanced", inputs: {
      noise: ["15", 0], guider: ["37", 0], sampler: ["33", 0], sigmas: ["27", 0],
      latent_image: ["13", 2],
    }},
    // === 音频解码 + 窗口循环累积 ===
    "21": { class_type: "LTXVSeparateAVLatent", inputs: { av_latent: ["16", 0] } },
    "22": { class_type: "LTXFoleyAudioVAEDecode", inputs: { samples: ["21", 1], audio_vae: ["4", 0] } },
    "23": { class_type: "LTXFoleyWindowAudioSave", inputs: {
      audio: ["22", 0], window_info: ["12", 1], save_audio: false, filename_prefix: "ltx_foley_window",
    }},
    "24": { class_type: "LTXFoleyAudioAccumulator", inputs: { window_record: ["23", 1], accumulation: ["11", 2] } },
    "25": { class_type: "LTXFoleyForLoopClose", inputs: { flow_control: ["11", 0], audio_accumulation: ["24", 0] } },
    "26": { class_type: "LTXFoleyAudioStitch", inputs: { accumulation: ["25", 0], window_plan: ["9", 0] } },
    // === 输出(原视频画面 + 生成的音频)===
    "34": { class_type: "CreateVideo", inputs: { images: ["2", 0], fps: ["2", 2], audio: ["26", 0] } },
    "28": { class_type: "SaveVideo", inputs: { video: ["34", 0], filename_prefix: v.prefix, format: "auto", codec: "auto" } },
  };
  return wf;
}

async function submitAndWait(workflow: any, prefix: string): Promise<any> {
  const res = await axios.post(`${COMFY}/prompt`, { prompt: workflow }, { timeout: 30_000, validateStatus: (s: number) => s < 500 });
  if (res.status !== 200) throw new Error(`ComfyUI rejected:\n${JSON.stringify(res.data, null, 2).slice(0, 1800)}`);
  const promptId = res.data.prompt_id;
  console.log(`  submitted promptId=${promptId}`);
  const start = Date.now();
  for (;;) {
    await sleep(3000);
    const hist = await axios.get(`${COMFY}/history/${promptId}`, { timeout: 15_000 });
    const e = hist.data?.[promptId];
    if (e?.status?.status_str === "error") {
      throw new Error(`execution error: ${JSON.stringify(e.status.messages || e.status).slice(0, 1500)}`);
    }
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

function findOutputFallback(prefix: string): string | null {
  // ComfyUI 全缓存时返回空 outputs,扫容器 output 目录兜底
  try {
    const out = execSync(`docker exec ${CONTAINER} bash -lc 'ls -t /root/ComfyUI/output/${prefix}*.mp4 2>/dev/null | head -1'`, { timeout: 10_000 }).toString().trim();
    return out || null;
  } catch { return null; }
}

async function download(file: any, local: string) {
  const url = `${COMFY}/view?filename=${encodeURIComponent(file.filename)}&subfolder=${encodeURIComponent(file.subfolder||"")}&type=output`;
  const res = await axios.get(url, { responseType: "stream", timeout: 120_000 });
  await new Promise<void>((resolve, reject) => { const ws = fs.createWriteStream(local); res.data.pipe(ws).on("finish",()=>{ws.close();resolve();}).on("error",reject); });
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // 1) 裁 3.7s 纯画面片段
  const tmpClip = `${process.env.CLAUDE_JOB_DIR || "/tmp"}/foley_input.mp4`;
  execSync(`ffmpeg -y -ss ${CLIP_START} -t ${CLIP_LEN} -i "${SRC_VIDEO}" -an -c:v libx264 -preset fast -crf 18 "${tmpClip}" 2>/dev/null`, { timeout: 60_000 });
  const inputName = "foley_input_distilled.mp4";
  execSync(`docker cp "${tmpClip}" ${CONTAINER}:"${INPUT_DIR}/${inputName}"`, { timeout: 30_000 });
  console.log(`输入: ${inputName} (t=${CLIP_START}s, ${CLIP_LEN}s, 仅画面)`);

  if (process.env.DRY === "1") {
    const wf = buildWorkflow(inputName, { tag: "A", useLora: true, loraStrength: 1.0, seed: 42, cfg: 1.0, prefix: "dry" });
    fs.writeFileSync(`${OUT_DIR}/foley_distilled_workflow_api.json`, JSON.stringify(wf, null, 2));
    console.log("DRY=1,已写 workflow JSON → " + `${OUT_DIR}/foley_distilled_workflow_api.json`);
    return;
  }

  const variants: Variant[] = [
    { tag: "A_lora1.0", useLora: true,  loraStrength: 1.0, seed: 42,         cfg: 1.0, prefix: "foley_A_lora10" },
    { tag: "B_lora2.0", useLora: true,  loraStrength: 2.0, seed: 42,         cfg: 1.0, prefix: "foley_B_lora20" },
    { tag: "C_noLora",  useLora: false, loraStrength: 0,   seed: 1513163486, cfg: 1.0, prefix: "foley_C_nolora" },
  ];

  const results: any[] = [];
  for (const v of variants) {
    console.log(`\n=== 变体 ${v.tag} (lora=${v.useLora?v.loraStrength:"off"}, seed=${v.seed}, cfg=${v.cfg}) ===`);
    const wf = buildWorkflow(inputName, v);
    let file: any;
    try {
      file = await submitAndWait(wf, v.prefix);
    } catch (e: any) {
      // 兜底:全缓存时扫目录
      const fb = findOutputFallback(v.prefix);
      if (!fb) { console.error(`  ✗ ${v.tag} 失败: ${e.message}`); results.push({ tag: v.tag, error: e.message }); continue; }
      const base = path.basename(fb);
      file = { filename: base, subfolder: "" };
      console.log(`  (fallback) → ${base}`);
    }
    const local = `${OUT_DIR}/${v.prefix}.mp4`;
    await download(file, local);
    const wav = `${OUT_DIR}/${v.prefix}.wav`;
    execSync(`ffmpeg -y -i "${local}" -vn -ac 1 -ar 48000 "${wav}" 2>/dev/null`, { timeout: 30_000 });
    const sz = (fs.statSync(local).size/1024/1024).toFixed(2);
    console.log(`  ✅ ${v.tag}: ${local} (${sz}MB)`);
    results.push({ ...v, local, wav });
  }

  fs.writeFileSync(`${OUT_DIR}/results.json`, JSON.stringify(results, null, 2));
  console.log(`\n完成。下一步:用 BGM 检测器 + HTML 对比这三个 wav。`);
  console.log(`结果: ${OUT_DIR}/results.json`);
}

main().catch(e => { console.error("FATAL:", e.stack || e.message); process.exit(1); });
