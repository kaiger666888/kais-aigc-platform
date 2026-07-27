/**
 * 前10镜 LTX MSR Foley V2A 有声生成。
 * 对每镜:切 QwenTTS 引擎对白轨 → customAudio,调 executeFoleyPipeline
 *   (v1口型pass + Foley V2A环境pass + sidechain ducking 混音)→ 最终有声 mp4。
 * 复用 gen-from-shot-timeline.ts 的 refs/prompt/首尾帧/时长 逻辑。
 *
 * 用法: npx tsx scripts/gen-first10-foley.ts [shotIds...]
 */
import { executeFoleyPipeline, calcTrimFrames } from "../src/routes/production/ltx/msr";
import fs from "fs";
import path from "path";
import axios from "axios";
import { execSync } from "child_process";

const COMFY = process.env.COMFYUI_URL || "http://localhost:8188";
const CONTAINER = "comfyui-primary";
const INPUT_DIR = "/root/ComfyUI/input";
const HOST_OUTPUT = "/mnt/agents/output/gpu1"; // ComfyUI output 宿主挂载
const ASSET = "data/oss/shot-timeline-ep01";
const OUT_DIR = "workflows/ltx-2.3/shot-timeline-ep01-output";
const REFS_DIR = `${OUT_DIR}/refs`;
const ENGINE_AUDIO = `${OUT_DIR}/engine_audio`;
const DIALOGUE_TRACK = `${ENGINE_AUDIO}/dialogue_track.wav`;
const SHOT_FRAMES_DIR = "/data/workspace/kais-shot-timeline/output/虫虫武侠小故事《小江湖》第01话：爸爸去哪儿？（ 画面只是工具，情绪才是目的。/shot_frames";

const WIDTH = 1280, HEIGHT = 704, FPS = 24;
const MSR_FC_VALUES = [17, 25, 33, 41];
const SEED = 12345;
const NEG = "worst quality, blurry, jittery, distorted, text, watermark";
// 首尾帧锚定强度(env 可调;默认 0.8/0.6。漂移镜可提 FIRST_STRENGTH=0.95 锁死)
const FIRST_STRENGTH = Number(process.env.FIRST_STRENGTH || 0.8);
const LAST_STRENGTH = Number(process.env.LAST_STRENGTH || 0.6);

const ALL_REFS = [
  "char_caterpillar_turnaround.png", "char_beetle_turnaround.png", "char_mantis_turnaround.png", "char_centipede_turnaround.png",
  "bg_forest_mossy.jpg", "bg_forest_misty.jpg",
];
const CHAR_IDENTITY: Record<string, string> = {
  毛毛虫: "毛毛虫小孩:圆滚滚胖嘟嘟的身材,橙黄色柔软绒毛,头顶绿色小草辫,大而灵动的眼睛",
  独角仙: "独角仙武士:红棕色油亮甲壳,头顶巨大双叉弯角,前臂缠米色绑带,英武挺拔",
  螳螂: "螳螂武士:翠绿色身体,白色大复眼,橙色触角,锋利镰刀前足,手持小刀刃",
  蜈蚣: "巨型红蜈蚣:猩红色多节甲壳,密布黄色长足,扁平头部,一对黑色毒牙与张开的大颚钳,尾部最后一对步足特化为一对粗壮尾足、向后延伸、末端带黑色弯钩(尾勾)",
};
const SPK_CHAR: Record<string, string> = { kid: "毛毛虫小孩", dad: "独角仙武士" };

const pad3 = (n: number) => String(n).padStart(3, "0");
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function pickRefs(p: { subject?: string; prompt_text?: string; scene?: string }): string[] {
  const text = `${p.subject || ""} ${p.prompt_text || ""}`;
  const subjects: string[] = [];
  if (/毛毛虫/.test(text)) subjects.push("char_caterpillar_turnaround.png");
  if (/独角仙/.test(text)) subjects.push("char_beetle_turnaround.png");
  if (/螳螂/.test(text)) subjects.push("char_mantis_turnaround.png");
  if (/蜈蚣/.test(text)) subjects.push("char_centipede_turnaround.png");
  const bg = /雾|空地|misty/.test(p.scene || "") ? "bg_forest_misty.jpg" : "bg_forest_mossy.jpg";
  return [...subjects.slice(0, 4), bg];
}
function buildPrompts(p: any): { refDescription: string; prompt: string } {
  const text = `${p.subject || ""} ${p.prompt_text || ""}`;
  const ids: string[] = [];
  if (/毛毛虫/.test(text)) ids.push(CHAR_IDENTITY["毛毛虫"]);
  if (/独角仙/.test(text)) ids.push(CHAR_IDENTITY["独角仙"]);
  if (/螳螂/.test(text)) ids.push(CHAR_IDENTITY["螳螂"]);
  if (/蜈蚣/.test(text)) ids.push(CHAR_IDENTITY["蜈蚣"]);
  const refDescription = [...ids, p.scene ? `场景:${p.scene}` : "", p.lighting || "", p.style || ""].filter(Boolean).join("。");
  const prompt = [p.action || "", p.camera || ""].filter(Boolean).join("。") || p.prompt_text || "";
  return { refDescription, prompt };
}
function bestNumFrames(d: number, fps: number) { const t = Math.round(d * fps); const k = Math.round((t - 1) / 8); return 8 * k + 1; }
function bestMsrFc(n: number) { return MSR_FC_VALUES.filter(v => v <= n).pop() ?? 17; }
function dockerCp(hostPath: string): string {
  const base = path.basename(hostPath);
  execSync(`docker cp "${hostPath}" ${CONTAINER}:"${INPUT_DIR}/${base}"`, { timeout: 30_000 });
  return base;
}
function probeDuration(p: string): number | null {
  try { return +(execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${p}"`).toString().trim()); } catch { return null; }
}
async function waitForComfy(maxWaitSec = 180): Promise<void> {
  const deadline = Date.now() + maxWaitSec * 1000;
  while (Date.now() < deadline) {
    try { const r = await axios.get(`${COMFY}/system_stats`, { timeout: 3000 }); if (r.status === 200) return; } catch {}
    await sleep(3000);
  }
  throw new Error("ComfyUI 未在限期内恢复");
}

/** 切引擎对白轨 [start, start+dur] → docker cp 到 input,返回容器内文件名 */
function sliceDialogueToInput(start: number, dur: number, name: string): string {
  const tmp = `/tmp/${name}`;
  execSync(`ffmpeg -y -loglevel error -ss ${start.toFixed(3)} -t ${dur.toFixed(3)} -i "${DIALOGUE_TRACK}" -ac 1 -ar 48000 "${tmp}"`, { timeout: 30_000 });
  return dockerCp(tmp);
}

/** 该镜时段内的【对白】→ 口型标注(stage2PromptSuffix):谁说话+台词+嘴型同步。
 *  旁白(kind=narration)是画外音,角色嘴不动 → 不进 suffix(仍进 customAudio 作画外音播放)。 */
function buildStage2Suffix(shotStart: number, shotEnd: number, lines: any[]): string {
  const inShot = lines.filter(l => l.start >= shotStart - 0.3 && l.start < shotEnd - 0.1 && l.kind !== "narration");
  if (!inShot.length) return "";
  const parts = inShot.map(l => `${SPK_CHAR[l.speaker] || l.speaker}说:${l.text},嘴型同步`);
  return "对口型:" + parts.join(";");
}

/** 简单环境音 prompt(按动作关键词),fallback 默认森林环境 */
function buildFoleyPrompt(p: any): string {
  const a = `${p.action || ""} ${p.prompt_text || ""}`;
  const base = "diegetic forest ambience, birdsong, insects, gentle breeze rustling leaves, natural room tone, no music";
  const extra: string[] = [];
  if (/走|跑|步|踏/.test(a)) extra.push("footsteps on mossy ground");
  if (/打|拳|踢|攻|挡|兵器|刀|剑/.test(a)) extra.push("martial arts movement, fabric swishes, body motion foley");
  if (/风|雨|水/.test(a)) extra.push("wind or water texture");
  return [base, ...extra].join(", ");
}

async function runFoleyWithResilience(opts: any, label: string, maxAttempts = 3) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await executeFoleyPipeline(opts);
    } catch (e: any) {
      const msg = (e.message || "").toString();
      console.log(`[${label}] foley attempt ${attempt}/${maxAttempts} 失败: ${msg.slice(0, 250)}`);
      const fatal = /interrupt|OOM|out of memory|cuda|VRAM|FATAL|timeout|rejected/i.test(msg);
      if (fatal && attempt < maxAttempts) {
        console.log(`[${label}] → docker restart ${CONTAINER}…`);
        try { execSync(`docker restart ${CONTAINER}`, { timeout: 90_000 }); } catch {}
        await waitForComfy();
        continue;
      }
      throw e;
    }
  }
  throw new Error(`[${label}] unreachable`);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const shotIds = process.argv.slice(2).map(Number).filter(Boolean);
  const ids = shotIds.length ? shotIds : Array.from({ length: 10 }, (_, i) => i + 1);
  console.log(`foley 前10镜: #${ids.join(" #")}`);

  // refs 上传
  const refContainer: Record<string, string> = {};
  for (const f of ALL_REFS) refContainer[f] = dockerCp(`${REFS_DIR}/${f}`);
  console.log("refs uploaded");

  const prompts = JSON.parse(fs.readFileSync(`${ASSET}/prompts.json`, "utf8"));
  const promptMap = new Map<number, any>(prompts.map((p: any) => [p.shot_id, p]));
  const shotsArr = JSON.parse(fs.readFileSync(`${ASSET}/shots.json`, "utf8"));
  const shotMap = new Map<number, any>(shotsArr.map((s: any) => [s.id, s]));
  const plan = JSON.parse(fs.readFileSync(`${ENGINE_AUDIO}/dialogue_plan.json`, "utf8"));
  const lines = plan.lines;

  const done: number[] = [];
  for (const id of ids) {
    const p = promptMap.get(id); const s = shotMap.get(id);
    if (!p) { console.log(`\nskip #${id}: 无 prompt`); continue; }
    const startSec = s.start_sec, endSec = s.end_sec;
    const realDur = endSec - startSec;
    const numFrames = bestNumFrames(realDur, FPS);
    const actualDur = +(numFrames / FPS).toFixed(2);
    const nn = pad3(id);
    const prefix = `stlep01_shot${nn}`;
    const outMp4 = `${OUT_DIR}/${prefix}_foley.mp4`;
    if (fs.existsSync(outMp4) && (probeDuration(outMp4) ?? 0) > 0) {
      console.log(`\nskip #${id}: 已存在 ${prefix}_foley.mp4(断点续跑)`); done.push(id); continue;
    }

    // 首尾帧
    let firstFrame: string | undefined, lastFrame: string | undefined;
    const ff = `${SHOT_FRAMES_DIR}/shot_${nn}_first.jpg`, lf = `${SHOT_FRAMES_DIR}/shot_${nn}_last.jpg`;
    if (fs.existsSync(ff) && fs.existsSync(lf)) { firstFrame = dockerCp(ff); lastFrame = dockerCp(lf); }

    // 切引擎对白 + 口型标注
    const dialogueName = sliceDialogueToInput(startSec, actualDur, `shot${nn}_dialogue.wav`);
    const stage2 = buildStage2Suffix(startSec, endSec, lines);
    const { refDescription, prompt } = buildPrompts(p);
    const foleyPrompt = buildFoleyPrompt(p);

    console.log(`\n=== shot #${id} (${realDur}s→${actualDur}s/${numFrames}f) 对白:${dialogueName} ===`);
    if (stage2) console.log(`  口型: ${stage2.slice(0, 80)}`);

    const result = await runFoleyWithResilience({
      refFilenames: pickRefs(p).map(f => refContainer[f]),
      prompt, negativePrompt: NEG, refDescription,
      width: WIDTH, height: HEIGHT, numFrames, msrFrameCount: bestMsrFc(numFrames), fps: FPS,
      seed: SEED, filenamePrefix: prefix,
      customAudioFilename: dialogueName,
      dialogueEndTime: actualDur,
      stage2PromptSuffix: stage2,
      foleyPrompt,
      ...(firstFrame ? {
        firstFrameFilename: firstFrame, firstFrameStrength: FIRST_STRENGTH,
        // 方案A:首帧注入到交付第0帧(calcTrimFrames),而非默认方案B(msrFC+1 纯生成帧)。
        // 方案B 时首帧不落在输出第0帧 → 输出首帧漂移;方案A 锁死输出首帧=锚点。
        firstFrameIdx: calcTrimFrames(pickRefs(p).length, bestMsrFc(numFrames)),
      } : {}),
      ...(lastFrame ? { lastFrameFilename: lastFrame, lastFrameStrength: LAST_STRENGTH } : {}),
    }, `shot${id}`);

    // 最终视频在容器 /root/ComfyUI/output(容器内部路径,非宿主挂载)→ 经 /view 下载
    try {
      const url = `${COMFY}/view?filename=${encodeURIComponent(result.finalVideoFilename)}&type=output`;
      const res = await axios.get(url, { responseType: "stream", timeout: 180_000 });
      await new Promise<void>((resolve, reject) => {
        const ws = fs.createWriteStream(outMp4);
        res.data.pipe(ws).on("finish", () => { ws.close(); resolve(); }).on("error", reject);
      });
      const d = probeDuration(outMp4);
      console.log(`✓ shot #${id} → ${outMp4} (${d}s, foley ${result.durationMs / 1000 | 0}s)`);
      done.push(id);
    } catch (err: any) {
      console.log(`✗ shot #${id}: 取回最终视频失败 ${err.message}`);
    }
  }
  console.log(`\n✅ 完成 ${done.length}/${ids.length} 镜 foley`);
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
