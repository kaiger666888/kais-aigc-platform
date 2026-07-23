/**
 * 用 kais-shot-timeline 资产驱动 MSR 多参考视频生成。
 *
 * 素材:data/oss/shot-timeline-ep01/(《小江湖》第01话)+ kais-shot-timeline 工具 output/ 下的逐镜首尾帧
 *   - refs(锁角色一致性)= frames.json 关键帧
 *   - firstFrame/lastFrame(锁起止画面)= 工具 output/…/shot_frames/shot_NNN_{first,last}.jpg(逐镜真实首尾帧)
 *   - prompt(逐镜动作/场景)= prompts.json 的 prompt_text
 *   - 时长 = shots.json 每镜真实 duration → numFrames = nearest 8k+1(输出时长 = numFrames/fps)
 *
 * 时长映射:输出时长 = numFrames / fps;numFrames ∈ {8k+1};msrFrameCount=41(条件帧,不影响时长)。
 * 直接 import buildMSRWorkflow,提交 ComfyUI(:8188),不走平台 HTTP 层。
 *
 * 用法:
 *   npx tsx scripts/gen-from-shot-timeline.ts            # 默认 #1 #8 #66,真实时长 + 首尾帧
 *   npx tsx scripts/gen-from-shot-timeline.ts 4 17 88    # 指定镜头
 *   FIRSTLAST=0 npx tsx ...                              # 关闭首尾帧(纯 refs)
 *   CAP_SEC=10 npx tsx ...                               # 给超长镜设上限(单 pass 保护)
 *   SKIP_GEN=1 npx tsx ...                               # 只构造 workflow
 */
import { buildMSRWorkflow } from "../src/routes/production/ltx/msr";
import fs from "fs";
import path from "path";
import axios from "axios";
import { execSync } from "child_process";

const COMFY = process.env.COMFYUI_URL || "http://localhost:8188";
const CONTAINER = "comfyui-primary";
const INPUT_DIR = "/root/ComfyUI/input";
const ASSET = "data/oss/shot-timeline-ep01";
const OUT_DIR = "workflows/ltx-2.3/shot-timeline-ep01-output";
const REFS_DIR = `${OUT_DIR}/refs`;
// 工具 output 下逐镜真实首尾帧(93 镜 × 2)
const SHOT_FRAMES_DIR = "/data/workspace/kais-shot-timeline/output/虫虫武侠小故事《小江湖》第01话：爸爸去哪儿？（ 画面只是工具，情绪才是目的。/shot_frames";

const WIDTH = 1280, HEIGHT = 704, FPS = 24;
const MSR_FC = 41;                 // MSR 条件帧数(不影响输出时长)
const SEED = 12345;
const NEG = "worst quality, blurry, jittery, distorted, text, watermark";
const USE_FIRSTLAST = process.env.FIRSTLAST !== "0"; // 默认开首尾帧
const CAP_SEC = Number(process.env.CAP_SEC || 0);     // 0 = 不设上限,用真实时长

const DEFAULT_SHOTS = [1, 8, 17, 37, 66, 90];
const REF_FILES = ["char_caterpillar.jpg", "char_beetle.jpg", "char_mantis.jpg", "bg_forest.jpg"]; // 干净角色图+背景图(末位=bg 槽)

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function dockerCp(hostPath: string): string {
  const base = path.basename(hostPath);
  execSync(`docker cp "${hostPath}" ${CONTAINER}:"${INPUT_DIR}/${base}"`, { timeout: 30_000 });
  return base;
}

function probeDuration(p: string): number | null {
  try { return +(execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${p}"`).toString().trim()); }
  catch { return null; }
}

/** 目标时长 → 最接近的合法 numFrames(8k+1),使输出时长尽量贴近 targetDuration */
function bestNumFrames(targetDuration: number, fps: number): number {
  const target = Math.round(targetDuration * fps);
  const k = Math.round((target - 1) / 8);
  return 8 * k + 1;
}

async function submitAndWait(workflow: any, label: string, prefix: string): Promise<{ file: any; elapsed: number }> {
  const submitMs = Date.now();
  const res = await axios.post(`${COMFY}/prompt`, { prompt: workflow }, { timeout: 30_000, validateStatus: (s: number) => s < 500 });
  if (res.status !== 200) throw new Error(`[${label}] ComfyUI rejected: ${JSON.stringify(res.data).slice(0, 800)}`);
  const promptId = res.data.prompt_id as string;
  console.log(`[${label}] submitted promptId=${promptId}`);
  const start = Date.now();
  let lastStatus = "";
  for (;;) {
    await sleep(3000);
    const hist = await axios.get(`${COMFY}/history/${promptId}`, { timeout: 15_000 });
    const entry = hist.data?.[promptId];
    if (entry?.status) lastStatus = JSON.stringify(entry.status.status_str || entry.status);
    const outs = entry?.outputs;
    if (outs && Object.keys(outs).length) {
      for (const nid of Object.keys(outs)) {
        const o = outs[nid];
        const vid = [...(o?.videos || []), ...(o?.gifs || []), ...(o?.images || [])]
          .find((c: any) => /\.(mp4|webm|mov|mkv|avi)$/i.test(c.filename || ""));
        if (vid) {
          const elapsed = ((Date.now() - start) / 1000).toFixed(1);
          console.log(`[${label}] ✓ done in ${elapsed}s → ${vid.filename}`);
          return { file: vid, elapsed: Number(elapsed) };
        }
      }
    }
    if (entry?.status?.completed === true && (!outs || !Object.keys(outs).length)) {
      const fb = findOutputFileByPrefix(prefix, submitMs);
      if (fb) { const e = ((Date.now() - start) / 1000).toFixed(1); console.log(`[${label}] ✓ (cached) ${e}s → ${fb.filename}`); return { file: fb, elapsed: Number(e) }; }
    }
    if (entry?.status?.completed === false && entry.status.status_str === "error")
      throw new Error(`[${label}] ComfyUI error: ${JSON.stringify(entry.status.messages || lastStatus).slice(0, 800)}`);
    if (Date.now() - start > 900_000) throw new Error(`[${label}] timeout (last: ${lastStatus})`);
  }
}

function findOutputFileByPrefix(prefix: string): any | null {
  try {
    const ls = execSync(`docker exec ${CONTAINER} bash -lc 'for f in /root/ComfyUI/output/${prefix}*.mp4; do [ -f "$f" ] && stat -c "%Y %n" "$f"; done' 2>/dev/null`, { timeout: 10_000 }).toString().trim();
    let best: any = null, bestMs = 0;
    for (const line of ls.split("\n")) {
      const m = line.match(/^\s*(\d+)\s+(.*)$/); if (!m) continue;
      const ms = Number(m[1]) * 1000; if (ms > bestMs) { bestMs = ms; best = { filename: path.basename(m[2].trim()), subfolder: "", type: "output" }; }
    }
    return best;
  } catch { return null; }
}

async function download(file: any, localPath: string) {
  const url = `${COMFY}/view?filename=${encodeURIComponent(file.filename)}&subfolder=${encodeURIComponent(file.subfolder || "")}&type=output`;
  const res = await axios.get(url, { responseType: "stream", timeout: 180_000 });
  await new Promise<void>((resolve, reject) => {
    const ws = fs.createWriteStream(localPath);
    res.data.pipe(ws).on("finish", () => { ws.close(); resolve(); }).on("error", reject);
  });
}

function pad3(n: number) { return String(n).padStart(3, "0"); }

function copySourceFrameToOut(shotId: number, kind: "first" | "last"): string | null {
  // 把源首尾帧拷进输出目录 refs/,供 HTML 展示
  const src = `${SHOT_FRAMES_DIR}/shot_${pad3(shotId)}_${kind}.jpg`;
  if (!fs.existsSync(src)) return null;
  const dst = `${REFS_DIR}/src_shot${pad3(shotId)}_${kind}.jpg`;
  fs.copyFileSync(src, dst);
  return `refs/src_shot${pad3(shotId)}_${kind}.jpg`;
}

function writeHtml(results: any[], mode: string) {
  const v = Date.now();
  const cards = results.map(r => {
    const srcFirst = r.srcFirst ? `<img class="src" src="${r.srcFirst}?v=${v}" title="源首帧">` : "";
    const srcLast = r.srcLast ? `<img class="src" src="${r.srcLast}?v=${v}" title="源尾帧">` : "";
    const prev = r.prevMp4 ? `<div class="prev"><b>上一轮对比 @${r.prevDur}s</b><video controls muted loop preload="metadata"><source src="${r.prevMp4}?v=${v}" type="video/mp4"></video></div>` : "";
    return `<section class="shot">
      <h2>镜头 #${r.id} <span class="dur">目标 ${r.targetDur}s · 实际 ${r.actualDur}s · ${r.numFrames}f ${r.firstlast ? "· refs+首尾帧" : "· 纯refs"}</span></h2>
      <div class="row">${srcFirst}<video controls autoplay muted loop preload="metadata"><source src="${r.mp4}?v=${v}" type="video/mp4"></video>${srcLast}</div>
      ${prev}
      <p class="prompt">${escapeHtml(r.prompt)}</p>
    </section>`;
  }).join("\n");

  const html = `<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>小江湖 EP01 · shot-timeline 驱动生成 (${mode})</title>
<style>
  *{box-sizing:border-box} body{margin:0;background:#111;color:#eee;font-family:-apple-system,"PingFang SC",sans-serif}
  header{padding:20px 28px;background:#1a1a1a;border-bottom:1px solid #333}
  header h1{margin:0;font-size:20px} header p{margin:6px 0 0;color:#999;font-size:13px}
  .refs{padding:14px 28px;background:#161616;border-bottom:1px solid #2a2a2a}
  .refs b{color:#aaa;font-size:13px} .refs img{height:110px;border:1px solid #333;margin:8px 8px 0 0;border-radius:4px}
  main{padding:24px 28px;display:grid;gap:24px}
  .shot{background:#1a1a1a;border:1px solid #2a2a2a;border-radius:10px;padding:18px}
  .shot h2{margin:0 0 12px;font-size:16px} .dur{color:#888;font-weight:normal;font-size:13px;margin-left:8px}
  .row{display:flex;gap:10px;align-items:stretch}
  .row video{flex:1;max-height:55vh;background:#000;border-radius:6px}
  .row img.src{width:160px;object-fit:cover;border-radius:6px;border:1px solid #333}
  .prev{margin-top:12px;padding-top:12px;border-top:1px dashed #333}
  .prev b{color:#888;font-size:12px;display:block;margin-bottom:6px}
  .prev video{width:100%;max-height:40vh;background:#000;border-radius:6px}
  .prompt{color:#bbb;font-size:13px;line-height:1.6;margin:12px 0 0}
</style></head><body>
<header>
  <h1>《小江湖》EP01 · shot-timeline 驱动 MSR 生成 — ${mode}</h1>
  <p>refs 锁角色 + 逐镜真实首尾帧锁起止 + prompts.json 逐镜 prompt · int8_convrot · seed ${SEED} · 时长=真实duration→nearest 8k+1 · ${new Date().toISOString().slice(0,16)}</p>
</header>
<div class="refs"><b>参考图池(MSR multi-reference,锁角色一致性):</b><br>${REF_FILES.map(f => `<img src="refs/${f}?v=${v}">`).join("")}</div>
<main>${cards}</main>
</body></html>`;
  fs.writeFileSync(`${OUT_DIR}/index.html`, html);
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(REFS_DIR, { recursive: true });

  const refHosts = REF_FILES.map(f => `${REFS_DIR}/${f}`);
  for (const f of refHosts) if (!fs.existsSync(f)) throw new Error(`missing ref: ${f}`);
  const refs = refHosts.map(dockerCp);
  console.log("refs (container):", refs);
  console.log("mode:", USE_FIRSTLAST ? "refs + 逐镜首尾帧" : "纯 refs", CAP_SEC ? `(cap ${CAP_SEC}s)` : "(真实时长)");

  const prompts = JSON.parse(fs.readFileSync(`${ASSET}/prompts.json`, "utf8"));
  const promptMap = new Map<number, any>(prompts.map((p: any) => [p.shot_id, p]));
  const shotsArr = JSON.parse(fs.readFileSync(`${ASSET}/shots.json`, "utf8"));
  const shotMap = new Map<number, any>(shotsArr.map((s: any) => [s.id, s]));

  const shotIds = (process.argv.slice(2).map(Number).filter(Boolean).length ? process.argv.slice(2).map(Number) : DEFAULT_SHOTS);
  console.log(`shots: #${shotIds.join(" #")}`);

  const results: any[] = [];
  for (const id of shotIds) {
    const p = promptMap.get(id);
    const s = shotMap.get(id);
    if (!p) { console.log(`\nskip #${id}: 无 prompt`); continue; }
    const realDur = s?.duration ?? 4;
    const targetDur = CAP_SEC ? Math.min(realDur, CAP_SEC) : realDur;
    const numFrames = bestNumFrames(targetDur, FPS);
    const actualDur = +(numFrames / FPS).toFixed(2);
    const nn = pad3(id);
    const tag = process.env.RUN_TAG || (USE_FIRSTLAST ? "fl" : "base");
    const prefix = `stlep01_shot${nn}_${tag}`;

    // 逐镜真实首尾帧
    let firstFrame: string | undefined, lastFrame: string | undefined;
    let srcFirst: string | null = null, srcLast: string | null = null;
    if (USE_FIRSTLAST) {
      const ff = `${SHOT_FRAMES_DIR}/shot_${nn}_first.jpg`;
      const lf = `${SHOT_FRAMES_DIR}/shot_${nn}_last.jpg`;
      if (!fs.existsSync(ff) || !fs.existsSync(lf)) {
        console.log(`\n⚠ shot #${id}: 缺首尾帧(${ff}),回退纯 refs`);
      } else {
        firstFrame = dockerCp(ff);
        lastFrame = dockerCp(lf);
        srcFirst = copySourceFrameToOut(id, "first");
        srcLast = copySourceFrameToOut(id, "last");
      }
    }

    const wf = buildMSRWorkflow({
      refFilenames: refs,
      prompt: p.prompt_text,
      negativePrompt: NEG,
      width: WIDTH, height: HEIGHT,
      numFrames, msrFrameCount: MSR_FC, fps: FPS,
      seed: SEED, filenamePrefix: prefix,
      audioMode: "silent",
      ...(firstFrame ? { firstFrameFilename: firstFrame, firstFrameStrength: 0.8 } : {}),
      ...(lastFrame ? { lastFrameFilename: lastFrame, lastFrameStrength: 0.6 } : {}),
    });
    fs.writeFileSync(`${OUT_DIR}/${prefix}.json`, JSON.stringify(wf, null, 2));

    console.log(`\n=== shot #${id} (真实 ${realDur}s → ${actualDur}s / ${numFrames}f${firstFrame ? " +首尾帧" : ""}) ===`);
    console.log(`prompt: ${p.prompt_text}`);
    if (process.env.SKIP_GEN === "1") { console.log("SKIP_GEN=1, 仅构造 workflow"); continue; }

    const { file, elapsed } = await submitAndWait(wf, `shot${id}_${tag}`, prefix);
    const mp4 = `${prefix}.mp4`;
    await download(file, `${OUT_DIR}/${mp4}`);

    // 上一轮对比(优先 _fl:同首尾帧不同refs;其次 base:纯refs)
    let prevMp4: string | null = null, prevDur: number | null = null;
    for (const c of [`stlep01_shot${nn}_fl.mp4`, `stlep01_shot${nn}.mp4`]) {
      if (c !== mp4 && fs.existsSync(`${OUT_DIR}/${c}`)) { prevMp4 = c; prevDur = probeDuration(`${OUT_DIR}/${c}`); break; }
    }

    results.push({ id, targetDur: +targetDur.toFixed(2), actualDur, numFrames,
      firstlast: !!(firstFrame && lastFrame), prompt: p.prompt_text, mp4, elapsed,
      srcFirst, srcLast, prevMp4, prevDur });
    console.log(`✓ shot #${id} → ${OUT_DIR}/${mp4} (${elapsed}s)`);
  }

  if (results.length) {
    fs.writeFileSync(`${OUT_DIR}/results.json`, JSON.stringify({
      seed: SEED, fps: FPS, msrFc: MSR_FC, useFirstLast: USE_FIRSTLAST,
      refs: REF_FILES, mode: USE_FIRSTLAST ? "refs+firstlast" : "refs-only", shots: results,
    }, null, 2));
    const mode = `干净角色/背景refs + 真实时长 + 首尾帧 (v${Date.now().toString().slice(-5)})`;
    writeHtml(results, mode);
    console.log(`\n✅ ${results.length} shots → ${OUT_DIR}/index.html`);
  }
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
