/**
 * 4x-UltraSharp 逐帧放大 → 降采样到目标分辨率(默认 1080p)。
 * CNN 推理,低显存、不爆、快;模型已在容器内。
 *
 * 流程:VHS_LoadVideo → UpscaleModelLoader(4x-UltraSharp)→ ImageUpscaleWithModelBatched(4x)
 *      → ImageScale(lanczos 降到 OUT_W×OUT_H)→ VideoCombine → ffmpeg mux 原音轨。
 *
 * 用法:npx tsx scripts/upscale-ultrasharp.ts
 *   env: INPUT= OUT= OUT_W=1920 OUT_H=1056 PER_BATCH=8 MODEL=4x-UltraSharp.pth
 */
import fs from "fs";
import path from "path";
import axios from "axios";
import { execSync } from "child_process";

const COMFY = process.env.LTX_COMFYUI_URL || "http://localhost:8188";
const CONTAINER = process.env.LTX_CONTAINER_NAME || "comfyui-primary";
const INPUT_DIR = "/root/ComfyUI/input";

const INPUT = process.env.INPUT || "workflows/ltx-2.3/foley-distilled-test-output/foleysimp_final.mp4";
const OUT = process.env.OUT || "workflows/ltx-2.3/foley-distilled-test-output/foleysimp_final_1080p_ultrasharp.mp4";
const OUT_W = Number(process.env.OUT_W) || 1920;
const OUT_H = Number(process.env.OUT_H) || 1056;
const PER_BATCH = Number(process.env.PER_BATCH) || 8;
const MODEL = process.env.MODEL || "4x-UltraSharp.pth";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
function dockerCpIn(h: string) { const b = path.basename(h); execSync(`docker cp "${h}" ${CONTAINER}:"${INPUT_DIR}/${b}"`, { timeout: 60_000 }); return b; }

async function submitAndWait(workflow: any, timeoutMs = 1_800_000): Promise<any> {
  const res = await axios.post(`${COMFY}/prompt`, { prompt: workflow }, { timeout: 30_000, validateStatus: (s: number) => s < 500 });
  if (res.status !== 200) throw new Error(`ComfyUI rejected:\n${JSON.stringify(res.data, null, 2).slice(0, 2000)}`);
  const id = res.data.prompt_id;
  console.log(`  submitted promptId=${id}`);
  const start = Date.now();
  for (;;) {
    await sleep(4000);
    const hist = await axios.get(`${COMFY}/history/${id}`, { timeout: 15_000 });
    const e = hist.data?.[id];
    if (e?.status?.status_str === "error") throw new Error(`exec error: ${JSON.stringify(e.status.messages || e.status).slice(0, 1200)}`);
    const outs = e?.outputs;
    if (outs && Object.keys(outs).length) {
      for (const nid of Object.keys(outs)) {
        const o = outs[nid];
        const vid = [...(o?.gifs||[]),...(o?.images||[]),...(o?.videos||[])].find((c:any)=>/\.(mp4|webm|mov|gif)$/i.test(c.filename||""));
        if (vid) { console.log(`  ✓ ${((Date.now()-start)/1000).toFixed(0)}s → ${vid.filename}`); return vid; }
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
    "1": { class_type: "VHS_LoadVideo", inputs: { video: inputFile, force_rate: 0, custom_width: 0, custom_height: 0, frame_load_cap: 0, skip_first_frames: 0, select_every_nth: 1 } },
    "2": { class_type: "UpscaleModelLoader", inputs: { model_name: MODEL, upscale_method: "lanczos" } },
    "3": { class_type: "ImageUpscaleWithModelBatched", inputs: { upscale_model: ["2", 0], images: ["1", 0], per_batch: PER_BATCH } },
    "4": { class_type: "ImageScale", inputs: { image: ["3", 0], upscale_method: "lanczos", width: OUT_W, height: OUT_H, crop: "disabled" } },
    "5": { class_type: "VHS_VideoCombine", inputs: { images: ["4", 0], frame_rate: 24, loop_count: 0, filename_prefix: prefix, format: "video/h264-mp4", pingpong: false, save_output: true } },
  };
}

async function main() {
  console.log(`UltraSharp 放大: ${INPUT}\n  → ${OUT_W}×${OUT_H} · per_batch=${PER_BATCH} · model=${MODEL}`);
  const containerName = dockerCpIn(INPUT);
  const prefix = "ultrasharp_up";
  const t0 = Date.now();
  const file = await submitAndWait(buildWorkflow(containerName, prefix));
  const upLocal = OUT + ".novid.mp4";
  await download(file, upLocal);
  const upRes = execSync(`ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 "${upLocal}"`).toString().trim();
  console.log(`  放大耗时 ${((Date.now()-t0)/1000).toFixed(0)}s,输出 ${upRes}`);
  // mux 原音轨
  execSync(`ffmpeg -y -i "${upLocal}" -i "${INPUT}" -map 0:v:0 -map 1:a:0 -c:v copy -c:a aac -b:a 192k -shortest "${OUT}"`, { timeout: 120_000 });
  fs.unlinkSync(upLocal);
  console.log(`\n✅ 成片 ${((Date.now()-t0)/1000).toFixed(0)}s → ${OUT} (${(fs.statSync(OUT).size/1024/1024).toFixed(2)}MB, ${upRes})`);
}
main().catch(e => { console.error("FATAL:", e.stack || e.message); process.exit(1); });
