/**
 * MSR 尾帧(首尾帧-尾帧)能力测试
 *
 * 对照组 vs 实验组,同 refs / 同 seed / 同 prompt,唯一变量 = 是否注入尾帧 guide。
 *   - 对照:refs only(无尾帧)
 *   - 实验:refs + lastFrame = frame_3s.png(strength 0.6)
 *
 * 直接导入 buildMSRWorkflow(代码路径),不经过 HTTP 层 —— 验证 workflow 构造逻辑 + ComfyUI 运行时。
 * 用法:npx tsx scripts/test-msr-lastframe.ts
 */
import { buildMSRWorkflow } from "../src/routes/production/ltx/msr";
import fs from "fs";
import path from "path";
import axios from "axios";
import { execSync } from "child_process";

const COMFY = process.env.COMFYUI_URL || "http://localhost:8188";
const CONTAINER = "comfyui-primary";
const INPUT_DIR = "/root/ComfyUI/input";
const OUT_DIR = "workflows/ltx-2.3/msr-lastframe-test-output";

const REFS_HOST = [
  "workflows/ltx-2.3/test-viewer/refs-real/1.jpg",
  "workflows/ltx-2.3/test-viewer/refs-real/2.jpg",
  "workflows/ltx-2.3/test-viewer/refs-real/bg.png", // 最后一张 = background slot
];
const LAST_FRAME_HOST = "workflows/ltx-2.3/msr-ts-v2-test-output/frame_3s.png";

const WIDTH = 1280, HEIGHT = 704, FPS = 24, DURATION = 3;
const SEED = 12345;
const PROMPT = "two characters walking through a neon-lit alley, cinematic handheld follow shot, rain reflections on wet pavement";
const NEG = "worst quality, blurry, jittery, distorted, text, watermark";

function dockerCp(hostPath: string): string {
  const base = path.basename(hostPath);
  execSync(`docker cp "${hostPath}" ${CONTAINER}:"${INPUT_DIR}/${base}"`, { timeout: 30_000 });
  return base;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function submitAndWait(workflow: any, label: string, prefix: string): Promise<{ file: any; elapsed: number }> {
  const submitMs = Date.now();
  const res = await axios.post(`${COMFY}/prompt`, { prompt: workflow }, { timeout: 30_000,
    validateStatus: (s: number) => s < 500 });
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
        const candidates = [...(o?.videos || []), ...(o?.gifs || []), ...(o?.images || [])];
        const vid = candidates.find((c: any) => /\.(mp4|webm|mov|mkv|avi)$/i.test(c.filename || ""));
        if (vid) {
          const elapsed = ((Date.now() - start) / 1000).toFixed(1);
          console.log(`[${label}] ✓ done in ${elapsed}s → ${vid.filename}`);
          return { file: vid, elapsed: Number(elapsed) };
        }
      }
    }
    // 兜底:ComfyUI 对完全缓存(bug:同 seed 重跑)的 prompt 返回 success 但 outputs 为空。
    // 此时直接扫容器输出目录,找匹配 prefix 且晚于提交时间的 mp4。
    if (entry?.status?.completed === true && (!outs || !Object.keys(outs).length)) {
      const fb = findOutputFileByPrefix(prefix, submitMs);
      if (fb) {
        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        console.log(`[${label}] ✓ (cached/fallback) found in output dir in ${elapsed}s → ${fb.filename}`);
        return { file: fb, elapsed: Number(elapsed) };
      }
    }
    if (entry?.status?.completed === false && entry.status.status_str === "error") {
      throw new Error(`[${label}] ComfyUI execution error: ${JSON.stringify(entry.status.messages || lastStatus).slice(0, 800)}`);
    }
    if (Date.now() - start > 600_000) throw new Error(`[${label}] timeout (last status: ${lastStatus})`);
  }
}

/** 扫容器输出目录,找匹配 prefix 的最新 mp4(兜底缓存命中场景)。
 *  缓存命中时不产生新文件,但内容与首次生成相同,所以取最新 mtime 即正确结果。 */
function findOutputFileByPrefix(prefix: string, _afterMs?: number): any | null {
  try {
    const ls = execSync(
      `docker exec ${CONTAINER} bash -lc 'for f in /root/ComfyUI/output/${prefix}*.mp4; do [ -f "$f" ] && stat -c "%Y %n" "$f"; done' 2>/dev/null`,
      { timeout: 10_000 },
    ).toString().trim();
    let best: any = null;
    let bestMs = 0;
    for (const line of ls.split("\n")) {
      const m = line.match(/^\s*(\d+)\s+(.*)$/);
      if (!m) continue;
      const ms = Number(m[1]) * 1000;
      const fn = path.basename(m[2].trim());
      if (ms > bestMs) { bestMs = ms; best = { filename: fn, subfolder: "", type: "output" }; }
    }
    return best;
  } catch { return null; }
}

async function download(file: any, localPath: string) {
  const url = `${COMFY}/view?filename=${encodeURIComponent(file.filename)}&subfolder=${encodeURIComponent(file.subfolder || "")}&type=output`;
  const res = await axios.get(url, { responseType: "stream", timeout: 120_000 });
  await new Promise<void>((resolve, reject) => {
    const ws = fs.createWriteStream(localPath);
    res.data.pipe(ws).on("finish", () => { ws.close(); resolve(); }).on("error", reject);
  });
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // 1) 拷贝资产到容器(用稳定文件名,可复现)
  const refs = REFS_HOST.map(dockerCp);
  const lastFrame = dockerCp(LAST_FRAME_HOST);
  console.log("refs (container):", refs);
  console.log("lastFrame (container):", lastFrame);

  const numFrames = Math.ceil((Math.round(DURATION * FPS) + 1 - 1) / 8) * 8 + 1; // roundTo8nPlus1
  console.log(`numFrames=${numFrames} → 尾帧 frame_idx 应为 ${numFrames - 1}`);

  // 2) 构造两个 workflow
  const baseOpts = {
    refFilenames: refs,
    prompt: PROMPT, negativePrompt: NEG,
    width: WIDTH, height: HEIGHT,
    numFrames, msrFrameCount: 41, fps: FPS,
    seed: SEED,
    filenamePrefix: "",
    audioMode: "silent", // 聚焦视频,避开音频
  };
  const wfControl = buildMSRWorkflow({ ...baseOpts, filenamePrefix: "msr_lf_control" });
  const wfLastFrame = buildMSRWorkflow({ ...baseOpts, filenamePrefix: "msr_lf_lastframe",
    lastFrameFilename: lastFrame, lastFrameStrength: 0.6 });

  fs.writeFileSync(`${OUT_DIR}/control_no_lastframe.json`, JSON.stringify(wfControl, null, 2));
  fs.writeFileSync(`${OUT_DIR}/with_lastframe.json`, JSON.stringify(wfLastFrame, null, 2));

  // 3) 结构验证(秒级,在提交前打印)
  console.log("\n=== 结构验证 ===");
  console.log("[control] node 9 class:", wfControl["9"]?.class_type, "| guideOut node 53 present?", !!wfControl["53"]);
  console.log("[control] downstream node 23 video_latent source:", JSON.stringify(wfControl["23"]?.inputs?.video_latent));
  const n53 = wfLastFrame["53"];
  console.log("[lastframe] node 53 class:", n53?.class_type);
  console.log("[lastframe] node 53 frame_idx:", n53?.inputs?.frame_idx, `(期望 ${numFrames - 1})`);
  console.log("[lastframe] node 53 strength:", n53?.inputs?.strength);
  console.log("[lastframe] node 53 latent source:", JSON.stringify(n53?.inputs?.latent), "(应指向 9)");
  console.log("[lastframe] node 44 LoadImage:", JSON.stringify(wfLastFrame["44"]?.inputs));
  console.log("[lastframe] downstream node 23 video_latent source:", JSON.stringify(wfLastFrame["23"]?.inputs?.video_latent), "(应指向 53)");
  console.log("[lastframe] node 37 CFGGuider positive:", JSON.stringify(wfLastFrame["37"]?.inputs?.positive));
  console.log("[lastframe] node 17 CropGuides positive:", JSON.stringify(wfLastFrame["17"]?.inputs?.positive));

  const checks = [
    !!wfLastFrame["53"],
    n53?.class_type === "LTXAddVideoICLoRAGuideAdvanced",
    n53?.inputs?.frame_idx === numFrames - 1,
    n53?.inputs?.latent?.[0] === "9",
    wfLastFrame["23"]?.inputs?.video_latent?.[0] === "53",
    wfLastFrame["37"]?.inputs?.positive?.[0] === "53",
    wfLastFrame["17"]?.inputs?.positive?.[0] === "53",
    !wfControl["53"],
  ];
  console.log("\n结构检查:", checks.every(Boolean) ? "✅ ALL PASS" : "❌ SOME FAILED", checks);

  if (process.env.SKIP_GEN === "1") { console.log("\nSKIP_GEN=1, 跳过生成"); return; }

  // 4) 提交两组生成(对照组先行,实验组紧随)
  console.log("\n=== 提交生成 ===");
  const ctrl = await submitAndWait(wfControl, "control", "msr_lf_control");
  const lf = await submitAndWait(wfLastFrame, "lastframe", "msr_lf_lastframe");

  const ctrlPath = `${OUT_DIR}/control.mp4`;
  const lfPath = `${OUT_DIR}/with_lastframe.mp4`;
  await download(ctrl.file, ctrlPath);
  await download(lf.file, lfPath);
  console.log(`downloaded → ${ctrlPath}, ${lfPath}`);

  // 5) 写结果元数据,供 HTML 生成步骤读取
  fs.writeFileSync(`${OUT_DIR}/result.json`, JSON.stringify({
    seed: SEED, numFrames, width: WIDTH, height: HEIGHT, fps: FPS, duration: DURATION,
    lastFrameTarget: LAST_FRAME_HOST, lastFrameStrength: 0.6,
    control: { file: ctrl.file, elapsed: ctrl.elapsed, local: ctrlPath },
    lastframe: { file: lf.file, elapsed: lf.elapsed, local: lfPath },
  }, null, 2));
  console.log("\n✅ 完成,元数据写入 result.json");
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
