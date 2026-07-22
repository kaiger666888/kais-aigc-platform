/**
 * 完整首尾帧验证(dreamina 生成的两张构图不同的关键帧)。
 * firstFrame=keyframe_first(远景对面)+ lastFrame=keyframe_last(背影相拥),同 refs/seed。
 * 看交付 f0(=frame 37)是否≈keyframe_first,末帧(frame 72)是否≈keyframe_last。
 */
import { buildMSRWorkflow, calcTrimFrames } from "../src/routes/production/ltx/msr";
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
const NUM_REFS = 3, FPS = 24, DURATION = 3, SEED = 12345;
const PROMPT = "two characters walking toward each other through a misty rain-soaked ancient village alley at night, then coming together, lanterns glowing, heavy rain, cinematic";
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
    if (Date.now()-start > 1500_000) throw new Error(`[${label}] timeout`);
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
  const ffIdx = calcTrimFrames(NUM_REFS, 41); // 37
  console.log(`refs=${refs} first=${firstFrame} last=${lastFrame} numFrames=${numFrames} firstIdx=${ffIdx} lastIdx=${numFrames-1}`);

  const wf = buildMSRWorkflow({
    refFilenames: refs, prompt: PROMPT, negativePrompt: NEG,
    width: 1280, height: 704, numFrames, msrFrameCount: 41, fps: FPS,
    seed: SEED, filenamePrefix: "msr_keyframes", audioMode: "silent",
    firstFrameFilename: firstFrame,   // 默认 strength 0.8
    lastFrameFilename: lastFrame,     // 默认 strength 0.6
  });
  fs.writeFileSync(`${OUT_DIR}/full_keyframes_test.json`, JSON.stringify(wf, null, 2));
  console.log(`node54(首帧) frame_idx=${wf["54"]?.inputs?.frame_idx} str=${wf["54"]?.inputs?.strength} | node53(尾帧) frame_idx=${wf["53"]?.inputs?.frame_idx} str=${wf["53"]?.inputs?.strength} | out.23=${JSON.stringify(wf["23"]?.inputs?.video_latent)}`);

  const v = await submitAndWait(wf, "full-keyframes");
  const raw = `${OUT_DIR}/full_keyframes_raw.mp4`;
  await dl(v, raw);
  // 交付 f0(=ffIdx)、中间、末帧
  for (const [idx, name] of [[ffIdx,"kf_delivered_f0"],[Math.round((ffIdx+numFrames-1)/2),"kf_mid"],[numFrames-1,"kf_lastframe"]] as [number,string][]) {
    execSync(`ffmpeg -y -i "${raw}" -vf "select=eq(n\\,${idx})" -vframes 1 -update 1 -q:v 2 "${OUT_DIR}/${name}.png"`, { timeout: 60_000, stdio: "pipe" });
  }
  console.log("✅ 抽帧: delivered_f0 / mid / lastframe");
})().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
