/**
 * 方案 B:首帧注入点改到 frame_idx = msrFrameCount+1 = 41(第一纯生成帧,避开条件段竞争)。
 * firstFrame=keyframe_first @ 41 + lastFrame=keyframe_last @ 72。3s 无声,seed 12345。
 * 看 frame 41(=交付第4帧)是否变成 keyframe_first 的远景对面构图。
 */
import { buildMSRWorkflow } from "../src/routes/production/ltx/msr";
import fs from "fs";
import path from "path";
import axios from "axios";
import { execSync } from "child_process";

const COMFY = "http://localhost:8188";
const CONTAINER = "comfyui-primary";
const INPUT_DIR = "/root/ComfyUI/input";
const OUT_DIR = "workflows/ltx-2.3/msr-lastframe-test-output";

const REFS_HOST = [
  "workflows/ltx-2.3/test-viewer/refs-real/1.jpg",
  "workflows/ltx-2.3/test-viewer/refs-real/2.jpg",
  "workflows/ltx-2.3/test-viewer/refs-real/bg.png",
];
const FIRST_HOST = "workflows/ltx-2.3/msr-lastframe-test-output/dreamina/keyframe_first.png";
const LAST_HOST = "workflows/ltx-2.3/msr-lastframe-test-output/dreamina/keyframe_last.png";
const FPS = 24, DURATION = 3, SEED = 12345, MSR_FC = 41;
const FIRST_IDX = MSR_FC + 1; // 41 —— 方案 B:第一纯生成帧
const PROMPT = "two characters walking toward each other through a misty rain-soaked ancient village alley at night, lanterns, cinematic";
const NEG = "worst quality, blurry, text, watermark";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
function dockerCp(h: string) { const b = path.basename(h); execSync(`docker cp "${h}" ${CONTAINER}:"${INPUT_DIR}/${b}"`, { timeout: 30_000 }); return b; }
async function submitAndWait(wf: any, label: string) {
  const res = await axios.post(`${COMFY}/prompt`, { prompt: wf }, { timeout: 30_000, validateStatus: (s: number) => s < 500 });
  if (res.status !== 200) throw new Error(`[${label}] rejected: ${JSON.stringify(res.data).slice(0, 600)}`);
  const pid = res.data.prompt_id; console.log(`[${label}] submitted ${pid}`);
  const start = Date.now();
  for (;;) {
    await sleep(3000);
    const h = (await axios.get(`${COMFY}/history/${pid}`, { timeout: 15_000 })).data?.[pid];
    const outs = h?.outputs;
    if (outs && Object.keys(outs).length) {
      for (const n of Object.keys(outs)) {
        const c = [...(outs[n]?.videos||[]),...(outs[n]?.gifs||[]),...(outs[n]?.images||[])];
        const v = c.find((x: any) => /\.(mp4|webm|mov)$/i.test(x.filename||""));
        if (v) { console.log(`[${label}] ✓ ${((Date.now()-start)/1000).toFixed(1)}s → ${v.filename}`); return v; }
      }
    }
    if (Date.now()-start > 600_000) throw new Error(`[${label}] timeout`);
  }
}
async function dl(v: any, p: string) {
  const u = `${COMFY}/view?filename=${encodeURIComponent(v.filename)}&subfolder=${encodeURIComponent(v.subfolder||"")}&type=output`;
  const r = await axios.get(u, { responseType: "stream", timeout: 120_000 });
  await new Promise<void>((res, rej) => { const w = fs.createWriteStream(p); r.data.pipe(w).on("finish",()=>{w.close();res();}).on("error",rej); });
}

(async () => {
  const refs = REFS_HOST.map(dockerCp);
  const firstFrame = dockerCp(FIRST_HOST);
  const lastFrame = dockerCp(LAST_HOST);
  const numFrames = Math.ceil((Math.round(DURATION*FPS)+1-1)/8)*8+1; // 73
  console.log(`refs=${refs} first=${firstFrame}@idx${FIRST_IDX} last=${lastFrame}@idx${numFrames-1} numFrames=${numFrames}`);

  const wf = buildMSRWorkflow({
    refFilenames: refs, prompt: PROMPT, negativePrompt: NEG,
    width: 1280, height: 704, numFrames, msrFrameCount: MSR_FC, fps: FPS,
    seed: SEED, filenamePrefix: "msr_ffB", audioMode: "silent",
    firstFrameFilename: firstFrame, firstFrameIdx: FIRST_IDX,  // ← 方案 B:注入点 41
    lastFrameFilename: lastFrame,
  });
  fs.writeFileSync(`${OUT_DIR}/firstframe_B_test.json`, JSON.stringify(wf, null, 2));
  console.log(`node54 frame_idx=${wf["54"]?.inputs?.frame_idx}(期望${FIRST_IDX}) str=${wf["54"]?.inputs?.strength}`);

  const v = await submitAndWait(wf, "firstframe-B");
  const raw = `${OUT_DIR}/firstframe_B_raw.mp4`;
  await dl(v, raw);
  // 抽:37(交付f0,方案B下应仍是空场景)、41(首帧目标,交付第4帧)、72(末帧)
  for (const [idx, name] of [[37,"ffB_frame37_delivered_f0"],[FIRST_IDX,"ffB_frame41_first_target"],[numFrames-1,"ffB_frame72_last"]] as [number,string][]) {
    execSync(`ffmpeg -y -i "${raw}" -vf "select=eq(n\\,${idx})" -vframes 1 -update 1 -q:v 2 "${OUT_DIR}/${name}.png"`, { timeout: 60_000, stdio: "pipe" });
  }
  console.log("✅ 抽帧: frame37(交付f0) / frame41(首帧目标) / frame72(末帧)");
})().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
