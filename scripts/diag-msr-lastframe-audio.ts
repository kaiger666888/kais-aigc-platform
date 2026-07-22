/**
 * 诊断:节点 53(尾帧 guide)是否在联合 A/V pass 里损害 LTX 生成的环境音。
 *
 * 3 组 3s ambient_only(音频完全由 LTX 生成、不冻结,任何 node53 影响都可见):
 *   A: 基线 prompt,无尾帧       → LTX 原生环境音基线
 *   B: 基线 prompt,+尾帧(node53)→ 与 A 比,看 node53 是否改变音频
 *   C: 雨声强化 prompt,无尾帧    → 看 LTX 换 prompt 能否生成更像雨的环境音
 *
 * 指标:RMS(响度)+ Flatness(白噪度,越高越像白噪音)+ 导出 wav 供试听
 * 判定:B 的 Flatness 显著 > A → node53 让音频更白噪;C 的 Flatness < A 且更雨 → prompt 是关键。
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
const LAST_FRAME_HOST = "workflows/ltx-2.3/msr-ts-v2-test-output/frame_3s.png";

const WIDTH = 1280, HEIGHT = 704, FPS = 24, DURATION = 3, SEED = 12345;
const PROMPT_BASE = "two characters in a misty rain-soaked ancient village alley at night, lanterns glowing, wet stone pavement";
const PROMPT_RAIN = "heavy rain pouring down on a wet stone alley, raindrops hitting puddles and stone, steady rainfall, dripping water, no music, diegetic rain ambience only";

function dockerCp(hostPath: string): string {
  const base = path.basename(hostPath);
  execSync(`docker cp "${hostPath}" ${CONTAINER}:"${INPUT_DIR}/${base}"`, { timeout: 30_000 });
  return base;
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function findOutputFileByPrefix(prefix: string): any | null {
  try {
    const ls = execSync(`docker exec ${CONTAINER} bash -lc 'for f in /root/ComfyUI/output/${prefix}*.mp4; do [ -f "$f" ] && stat -c "%Y %n" "$f"; done' 2>/dev/null`, { timeout: 10_000 }).toString().trim();
    let best: any = null, bestMs = 0;
    for (const line of ls.split("\n")) {
      const m = line.match(/^\s*(\d+)\s+(.*)$/); if (!m) continue;
      const ms = Number(m[1]) * 1000, fn = path.basename(m[2].trim());
      if (ms > bestMs) { bestMs = ms; best = { filename: fn, subfolder: "", type: "output" }; }
    }
    return best;
  } catch { return null; }
}

async function submitAndWait(workflow: any, label: string, prefix: string): Promise<any> {
  const res = await axios.post(`${COMFY}/prompt`, { prompt: workflow }, { timeout: 30_000, validateStatus: (s: number) => s < 500 });
  if (res.status !== 200) throw new Error(`[${label}] rejected: ${JSON.stringify(res.data).slice(0, 500)}`);
  const promptId = res.data.prompt_id;
  console.log(`[${label}] submitted ${promptId}`);
  const start = Date.now();
  for (;;) {
    await sleep(3000);
    const hist = await axios.get(`${COMFY}/history/${promptId}`, { timeout: 15_000 });
    const e = hist.data?.[promptId];
    const outs = e?.outputs;
    if (outs && Object.keys(outs).length) {
      for (const nid of Object.keys(outs)) {
        const o = outs[nid];
        const vid = [...(o?.videos||[]),...(o?.gifs||[]),...(o?.images||[])].find((c:any)=>/\.(mp4|webm|mov)$/i.test(c.filename||""));
        if (vid) { console.log(`[${label}] ✓ ${((Date.now()-start)/1000).toFixed(0)}s → ${vid.filename}`); return vid; }
      }
    }
    if (e?.status?.completed === true && (!outs || !Object.keys(outs).length)) {
      const fb = findOutputFileByPrefix(prefix);
      if (fb) { console.log(`[${label}] ✓ (cached) → ${fb.filename}`); return fb; }
    }
    if (Date.now() - start > 600_000) throw new Error(`[${label}] timeout`);
  }
}

async function download(file: any, local: string) {
  const url = `${COMFY}/view?filename=${encodeURIComponent(file.filename)}&subfolder=${encodeURIComponent(file.subfolder||"")}&type=output`;
  const res = await axios.get(url, { responseType: "stream", timeout: 120_000 });
  await new Promise<void>((resolve, reject) => { const ws = fs.createWriteStream(local); res.data.pipe(ws).on("finish",()=>{ws.close();resolve();}).on("error",reject); });
}

/** 抽音频 + astats(Flatness 越高越像白噪音)+ RMS */
function audioStats(mp4: string, wavOut: string): { rms: string; flatness: string } {
  execSync(`ffmpeg -y -i "${mp4}" -vn -ac 1 -ar 48000 "${wavOut}" 2>/dev/null`, { timeout: 30_000 });
  const out = execSync(`ffmpeg -i "${wavOut}" -af astats=metadata=1:reset=0 -f null - 2>&1`, { timeout: 30_000 }).toString();
  const rms = (out.match(/RMS level dB:\s*(-?[\d.]+)/) || [])[1] || "?";
  const flat = (out.match(/Flatness:\s*(-?[\d.]+)/) || [])[1] || "?";
  return { rms, flatness: flat };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const refs = REFS_HOST.map(dockerCp);
  const lastFrame = dockerCp(LAST_FRAME_HOST);
  const numFrames = Math.ceil((Math.round(DURATION * FPS)) / 8) * 8 + 1; // 73

  const variants = [
    { id: "A", label: "基线·无尾帧", prefix: "diag_a", prompt: PROMPT_BASE, lastFrame: false },
    { id: "B", label: "基线·+尾帧(node53)", prefix: "diag_b", prompt: PROMPT_BASE, lastFrame: true },
    { id: "C", label: "雨声强化·无尾帧", prefix: "diag_c", prompt: PROMPT_RAIN, lastFrame: false },
  ];

  const results: any[] = [];
  for (const v of variants) {
    const wf = buildMSRWorkflow({
      refFilenames: refs, prompt: v.prompt, negativePrompt: "music, bgm, soundtrack, worst quality, blurry",
      width: WIDTH, height: HEIGHT, numFrames, msrFrameCount: 41, fps: FPS, seed: SEED,
      filenamePrefix: v.prefix, audioMode: "ambient_only",
      ...(v.lastFrame ? { lastFrameFilename: lastFrame, lastFrameStrength: 0.6 } : {}),
    });
    const file = await submitAndWait(wf, v.id, v.prefix);
    const mp4 = `${OUT_DIR}/${v.id}.mp4`;
    await download(file, mp4);
    const wav = `${OUT_DIR}/${v.id}.wav`;
    const s = audioStats(mp4, wav);
    results.push({ ...v, ...s });
    console.log(`[${v.id}] RMS=${s.rms}dB  Flatness=${s.flatness}`);
  }

  console.log("\n=== 诊断汇总 ===");
  console.log("Flatness 越高 → 越像白噪音;越低 → 越有结构(雨声/环境质感)");
  for (const r of results) console.log(`  ${r.id} ${r.label.padEnd(24)} RMS=${r.rms}dB  Flatness=${r.flatness}`);
  const [a, b, c] = results;
  console.log(`\n判定:`);
  console.log(`  B vs A (node53 影响):Flatness ${b.flatness} vs ${a.flatness} → ${Number(b.flatness)>Number(a.flatness)+0.02?"⚠️ node53 让音频更白噪":"✓ node53 基本不影响音频"}`);
  console.log(`  C vs A (prompt 影响):Flatness ${c.flatness} vs ${a.flatness} → ${Number(c.flatness)<Number(a.flatness)-0.02?"✓ 雨声 prompt 降低了白噪度":"prompt 影响不大"}`);

  fs.writeFileSync(`${OUT_DIR}/diag_audio.json`, JSON.stringify(results, null, 2));
}
main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
