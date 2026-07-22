/**
 * SeedVR2 视频超分放大 —— 真·视频SR(有时间一致性),把低分辨率成片放大到 1080p。
 *
 * 流程:VHS_LoadVideo → SeedVR2 7B DiT + VAE → VideoUpscaler(resolution=1080)→ VideoCombine
 *      → ffmpeg 把原音轨 mux 回放大后的无声视频。
 *
 * 用法:npx tsx scripts/upscale-seedvr2.ts
 *   env: INPUT=路径 OUT=路径 RESOLUTION=1080 BATCH=5 BLOCKS_SWAP=0
 */
import fs from "fs";
import path from "path";
import axios from "axios";
import { execSync } from "child_process";

const COMFY = process.env.LTX_COMFYUI_URL || "http://localhost:8188";
const CONTAINER = process.env.LTX_CONTAINER_NAME || "comfyui-primary";
const INPUT_DIR = "/root/ComfyUI/input";

const INPUT = process.env.INPUT || "workflows/ltx-2.3/foley-distilled-test-output/foleysimp_final.mp4";
const OUT = process.env.OUT || "workflows/ltx-2.3/foley-distilled-test-output/foleysimp_final_1080p_seedvr2.mp4";
const RESOLUTION = Number(process.env.RESOLUTION) || 1080;
const BATCH = Number(process.env.BATCH) || 17;  // SeedVR2 时序注意力按4帧一组,batch_size 必须 4n+1(5/9/13/17/21…);<17 会周期性重影
const BLOCKS_SWAP = Number(process.env.BLOCKS_SWAP) || 0;   // >0 时需配 offload_device=cpu
const FPS = Number(process.env.FPS) || 24;
const EVERY_NTH = Number(process.env.SELECT_EVERY_NTH) || 1; // >1 = 抽帧处理(减显存),输出按 FPS/EVERY_NTH 存,再补帧回 FPS
const VAE_TILE = Number(process.env.VAE_TILE) || 512;        // >0 = VAE 分块编解码(tile 尺寸);默认 512(7B 1080p 在 24GB 上必须开,否则 OOM)
const TEMPORAL_OVERLAP = Number(process.env.TEMPORAL_OVERLAP) || 8; // 批间重叠帧数,平滑 batch 边界(消除"中间顿一帧");2 不够会边界断裂,8 较稳
const DIT = process.env.DIT || "seedvr2_ema_7b_fp16.safetensors";
const VAE = "ema_vae_fp16.safetensors";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
function dockerCpIn(h: string) { const b = path.basename(h); execSync(`docker cp "${h}" ${CONTAINER}:"${INPUT_DIR}/${b}"`, { timeout: 60_000 }); return b; }

async function submitAndWait(workflow: any, timeoutMs = 3_600_000): Promise<any> {
  const res = await axios.post(`${COMFY}/prompt`, { prompt: workflow }, { timeout: 30_000, validateStatus: (s: number) => s < 500 });
  if (res.status !== 200) throw new Error(`ComfyUI rejected:\n${JSON.stringify(res.data, null, 2).slice(0, 2000)}`);
  const id = res.data.prompt_id;
  console.log(`  submitted promptId=${id}`);
  const start = Date.now();
  for (;;) {
    await sleep(4000);
    const hist = await axios.get(`${COMFY}/history/${id}`, { timeout: 15_000 });
    const e = hist.data?.[id];
    if (e?.status?.status_str === "error") throw new Error(`exec error: ${JSON.stringify(e.status.messages || e.status).slice(0, 1500)}`);
    const outs = e?.outputs;
    if (outs && Object.keys(outs).length) {
      for (const nid of Object.keys(outs)) {
        const o = outs[nid];
        const vid = [...(o?.gifs||[]),...(o?.images||[]),...(o?.videos||[])].find((c:any)=>/\.(mp4|webm|mov|gif)$/i.test(c.filename||""));
        if (vid) { console.log(`  ✓ ${((Date.now()-start)/1000).toFixed(0)}s → ${vid.filename} (subfolder=${vid.subfolder||""})`); return vid; }
      }
    }
    if (Date.now() - start > timeoutMs) throw new Error(`timeout (status: ${e?.status?.status_str || "unknown"})`);
  }
}
async function download(file: any, local: string) {
  const url = `${COMFY}/view?filename=${encodeURIComponent(file.filename)}&subfolder=${encodeURIComponent(file.subfolder||"")}&type=output`;
  const res = await axios.get(url, { responseType: "stream", timeout: 300_000 });
  await new Promise<void>((resolve, reject) => { const ws = fs.createWriteStream(local); res.data.pipe(ws).on("finish", () => { ws.close(); resolve(); }).on("error", reject); });
}

function buildWorkflow(inputFile: string, prefix: string): Record<string, any> {
  return {
    "1": { class_type: "VHS_LoadVideo", inputs: { video: inputFile, force_rate: 0, custom_width: 0, custom_height: 0, frame_load_cap: 0, skip_first_frames: 0, select_every_nth: EVERY_NTH } },
    "2": { class_type: "SeedVR2LoadDiTModel", inputs: { model: DIT, device: "cuda:0", blocks_to_swap: BLOCKS_SWAP, offload_device: BLOCKS_SWAP > 0 ? "cpu" : "none", attention_mode: "sdpa" } },
    "3": { class_type: "SeedVR2LoadVAEModel", inputs: { model: VAE, device: "cuda:0", encode_tiled: VAE_TILE > 0, encode_tile_size: VAE_TILE || 512, encode_tile_overlap: 64, decode_tiled: VAE_TILE > 0, decode_tile_size: VAE_TILE || 512, decode_tile_overlap: 64 } },
    "4": { class_type: "SeedVR2VideoUpscaler", inputs: { image: ["1", 0], dit: ["2", 0], vae: ["3", 0], seed: 42, resolution: RESOLUTION, max_resolution: 0, batch_size: BATCH, uniform_batch_size: true, temporal_overlap: TEMPORAL_OVERLAP, color_correction: "lab" } },
    "5": { class_type: "VHS_VideoCombine", inputs: { images: ["4", 0], frame_rate: FPS / EVERY_NTH, loop_count: 0, filename_prefix: prefix, format: "video/h264-mp4", pingpong: false, save_output: true } },
  };
}

async function main() {
  console.log(`SeedVR2 放大: ${INPUT}\n  → ${RESOLUTION}p · batch=${BATCH} · blocks_swap=${BLOCKS_SWAP} · DiT=${DIT}`);
  const containerName = dockerCpIn(INPUT);
  const prefix = "seedvr2_up";
  const t0 = Date.now();
  const file = await submitAndWait(buildWorkflow(containerName, prefix));
  const upLocal = OUT + ".novid.mp4";
  await download(file, upLocal);
  const upRes = execSync(`ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 "${upLocal}"`).toString().trim();
  console.log(`  放大耗时 ${((Date.now()-t0)/1000).toFixed(0)}s,输出分辨率 ${upRes}`);

  // 抽帧模式下:补帧回 FPS(minterpolate blend,平滑加倍)
  if (EVERY_NTH > 1) {
    const interp = upLocal + ".interp.mp4";
    execSync(`ffmpeg -y -i "${upLocal}" -vf "minterpolate=fps=${FPS}:mi_mode=blend" -an -c:v libx264 -preset fast -crf 18 "${interp}"`, { timeout: 600_000 });
    fs.renameSync(interp, upLocal);
    console.log(`  补帧 ${(FPS/EVERY_NTH).toFixed(0)}→${FPS}fps`);
  }

  // mux 原音轨(TTS+Foley 混音)到放大视频
  const finalMp4 = OUT;
  execSync(`ffmpeg -y -i "${upLocal}" -i "${INPUT}" -map 0:v:0 -map 1:a:0 -c:v copy -c:a aac -b:a 192k -shortest "${finalMp4}"`, { timeout: 120_000 });
  fs.unlinkSync(upLocal);
  const sz = (fs.statSync(finalMp4).size / 1024 / 1024).toFixed(2);
  console.log(`\n✅ 1080p 成片 ${((Date.now()-t0)/1000).toFixed(0)}s → ${finalMp4} (${sz}MB, ${upRes})`);
}
main().catch(e => { console.error("FATAL:", e.stack || e.message); process.exit(1); });
