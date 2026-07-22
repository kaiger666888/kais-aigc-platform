/**
 * 首帧 guide A/B 验证(路线 2-A:注入到交付第 0 帧 = frame_idx=calcTrimFrames=37)。
 * 实验组:refs=[1,2,bg](空背景)+ firstFrame=frame_3s.png @ frame_idx=37, strength 0.8。
 * 对照:已验证的空场景(control_trimmed_firstframe.png)。
 * 目标:实验组交付第 0 帧(frame 37)是否变成 frame_3s.png 的人物(guide 压过 background 条件)。
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
  "workflows/ltx-2.3/test-viewer/refs-real/bg.png", // 空背景(常规)
];
const FIRST_FRAME_HOST = "workflows/ltx-2.3/msr-ts-v2-test-output/frame_3s.png"; // 有人物,作首帧目标
const NUM_REFS = 3, FPS = 24, DURATION = 3, SEED = 12345, STRENGTH = 0.8;
const PROMPT = "two characters facing each other in a misty rain-soaked ancient village alley, lanterns, cinematic";
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
  const firstFrame = dockerCp(FIRST_FRAME_HOST);
  const numFrames = Math.ceil((Math.round(DURATION*FPS)+1-1)/8)*8+1; // 73
  const ffIdx = calcTrimFrames(NUM_REFS, 41); // 37
  console.log(`refs=${refs} | firstFrame=${firstFrame} | numFrames=${numFrames} | firstFrameIdx=${ffIdx} | strength=${STRENGTH}`);

  const wf = buildMSRWorkflow({
    refFilenames: refs, prompt: PROMPT, negativePrompt: NEG,
    width: 1280, height: 704, numFrames, msrFrameCount: 41, fps: FPS,
    seed: SEED, filenamePrefix: "msr_ff_guide", audioMode: "silent",
    firstFrameFilename: firstFrame, firstFrameStrength: STRENGTH,
  });
  fs.writeFileSync(`${OUT_DIR}/firstframe_guide_test.json`, JSON.stringify(wf, null, 2));

  // 结构验证
  const n54 = wf["54"];
  console.log(`node54 class=${n54?.class_type} frame_idx=${n54?.inputs?.frame_idx}(期望${ffIdx}) strength=${n54?.inputs?.strength} latent=${JSON.stringify(n54?.inputs?.latent)} downstream.23=${JSON.stringify(wf["23"]?.inputs?.video_latent)}`);

  const v = await submitAndWait(wf, "firstframe-guide");
  const raw = `${OUT_DIR}/firstframe_guide_raw.mp4`;
  await dl(v, raw);
  // 抽交付第0帧(ffIdx)、ffIdx+1、第一个纯生成帧(41)
  for (const [idx, name] of [[ffIdx,"firstframe_guide_delivered_f0"],[ffIdx+1,"firstframe_guide_frame38"],[41,"firstframe_guide_frame41"]] as [number,string][]) {
    execSync(`ffmpeg -y -i "${raw}" -vf "select=eq(n\\,${idx})" -vframes 1 -update 1 -q:v 2 "${OUT_DIR}/${name}.png"`, { timeout: 60_000, stdio: "pipe" });
  }
  console.log("✅ 抽帧完成: delivered_f0(frame37) / frame38 / frame41(首个纯生成帧)");
})().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
