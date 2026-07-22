/**
 * RIFE 补帧 —— 把 12fps 的 SeedVR2 放大源补成 24fps(替代 blend,去重影)。
 * 输入:容器内 /root/ComfyUI/output/seedvr2_up_00001.mp4(12fps,1962×1080,181帧)
 * 用法:npx tsx scripts/rife-interpolate.ts
 */
import fs from "fs";
import axios from "axios";
import { execSync } from "child_process";

const COMFY = process.env.LTX_COMFYUI_URL || "http://localhost:8188";
const CONTAINER = process.env.LTX_CONTAINER_NAME || "comfyui-primary";
const SRC_OUT = process.env.SRC || "/root/ComfyUI/output/seedvr2_up_00001.mp4"; // 容器内 12fps 源
const AUDIO_HOST = process.env.AUDIO || "workflows/ltx-2.3/foley-distilled-test-output/foleysimp_final.mp4";
const OUT = process.env.OUT || "workflows/ltx-2.3/foley-distilled-test-output/foleysimp_final_1080p_seedvr2_rife.mp4";
const RIFE_CKPT = process.env.RIFE_CKPT || "rife49.pth";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

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

function buildWorkflow(srcInput: string, prefix: string): Record<string, any> {
  return {
    "1": { class_type: "VHS_LoadVideo", inputs: { video: srcInput, force_rate: 0, custom_width: 0, custom_height: 0, frame_load_cap: 0, skip_first_frames: 0, select_every_nth: 1 } },
    "2": { class_type: "RIFE VFI", inputs: { ckpt_name: RIFE_CKPT, frames: ["1", 0], clear_cache_after_n_frames: 10, multiplier: 2, fast_mode: true, ensemble: true, scale_factor: 1.0, dtype: "float32", torch_compile: false, batch_size: 1 } },
    "3": { class_type: "VHS_VideoCombine", inputs: { images: ["2", 0], frame_rate: 24, loop_count: 0, filename_prefix: prefix, format: "video/h264-mp4", pingpong: false, save_output: true } },
  };
}

async function main() {
  console.log(`RIFE 补帧: ${SRC_OUT} (12fps) → 24fps, ckpt=${RIFE_CKPT}`);
  // 源已在容器 output 目录,复制到 input 供 VHS_LoadVideo 读取
  const srcInput = "rife_src.mp4";
  execSync(`docker exec ${CONTAINER} cp "${SRC_OUT}" /root/ComfyUI/input/${srcInput}`, { timeout: 30_000 });
  const t0 = Date.now();
  const file = await submitAndWait(buildWorkflow(srcInput, "rife_out"));
  const upLocal = OUT + ".novid.mp4";
  await download(file, upLocal);
  console.log(`  RIFE 耗时 ${((Date.now()-t0)/1000).toFixed(0)}s`);
  // mux 原音轨
  execSync(`ffmpeg -y -i "${upLocal}" -i "${AUDIO_HOST}" -map 0:v:0 -map 1:a:0 -c:v copy -c:a aac -b:a 192k -shortest "${OUT}"`, { timeout: 120_000 });
  fs.unlinkSync(upLocal);
  console.log(`\n✅ RIFE 成片 ${((Date.now()-t0)/1000).toFixed(0)}s → ${OUT} (${(fs.statSync(OUT).size/1024/1024).toFixed(2)}MB)`);
}
main().catch(e => { console.error("FATAL:", e.stack || e.message); process.exit(1); });
