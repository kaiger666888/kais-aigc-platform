/**
 * 首帧验证:把"有人物的图"当作 background 传进去,裁剪后交付的第 0 帧是否 = 该图。
 * 若是 → 零代码首帧方案成立(background 即首帧);若否 → 需要 independent 首帧 guide。
 * refs=[1.jpg, 2.jpg, frame_3s.png],frame_3s.png 作 background(=候选首帧)。silent/3s/seed 12345。
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

const REFS = [
  "workflows/ltx-2.3/test-viewer/refs-real/1.jpg",
  "workflows/ltx-2.3/test-viewer/refs-real/2.jpg",
  "workflows/ltx-2.3/msr-ts-v2-test-output/frame_3s.png", // ← 有人物的图作 background
];
const NUM_REFS = 3, FPS = 24, DURATION = 3, SEED = 12345;
const PROMPT = "two characters facing each other in a misty rain-soaked ancient village alley, lanterns, cinematic";
const NEG = "worst quality, blurry, text, watermark";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
function dockerCp(h: string) { const b = path.basename(h); execSync(`docker cp "${h}" ${CONTAINER}:"${INPUT_DIR}/${b}"`, { timeout: 30_000 }); return b; }

async function submitAndWait(wf: any, label: string, prefix: string) {
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
  const refs = REFS.map(dockerCp);
  const numFrames = Math.ceil((Math.round(DURATION*FPS)+1-1)/8)*8+1; // 73
  const trim = calcTrimFrames(NUM_REFS, 41); // 37
  console.log(`refs=${refs} | numFrames=${numFrames} | trim=${trim} | 交付第0帧 = raw frame ${trim}`);

  const wf = buildMSRWorkflow({
    refFilenames: refs, prompt: PROMPT, negativePrompt: NEG,
    width: 1280, height: 704, numFrames, msrFrameCount: 41, fps: FPS,
    seed: SEED, filenamePrefix: "msr_ffbg", audioMode: "silent",
  });
  fs.writeFileSync(`${OUT_DIR}/firstframe_bg_test.json`, JSON.stringify(wf, null, 2));

  const v = await submitAndWait(wf, "firstframe-bg", "msr_ffbg");
  const raw = `${OUT_DIR}/firstframe_bg_raw.mp4`;
  await dl(v, raw);
  console.log(`raw → ${raw}`);

  // 提取裁剪后第 0 帧(= raw frame trim)和 raw frame 0(对照,= subject1 条件段)
  execSync(`ffmpeg -y -i "${raw}" -vf "select=eq(n\\,${trim})" -vframes 1 -update 1 -q:v 2 "${OUT_DIR}/firstframe_delivered_f0.png"`, { timeout: 60_000, stdio: "pipe" });
  execSync(`ffmpeg -y -i "${raw}" -vf "select=eq(n\\,0)" -vframes 1 -update 1 -q:v 2 "${OUT_DIR}/firstframe_raw_f0.png"`, { timeout: 60_000, stdio: "pipe" });
  console.log("✅ 抽帧完成: firstframe_delivered_f0.png (应≈frame_3s.png), firstframe_raw_f0.png (=subject1 条件段)");
})().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
