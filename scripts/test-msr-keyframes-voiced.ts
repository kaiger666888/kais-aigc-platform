/**
 * 完整首尾帧 + 5stage 对白/雨声 15s。
 * firstFrame=keyframe_first + lastFrame=keyframe_last + 对白(rn_wv_dialogue_v2.wav) + 雨声 seed。
 * executeFiveStagePipeline:Stage2(对话冻结+首尾帧)→ Stage3(雨环境)→ ffmpeg ducking 混合。
 */
import { executeFiveStagePipeline } from "../src/routes/production/ltx/msr";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

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
const DIALOGUE_HOST = "workflows/ltx-2.3/test-viewer/voicedesign/rn_wv_dialogue_v2.wav";

const WIDTH = 1280, HEIGHT = 704, FPS = 24, DURATION = 15;
const SEED = 1513163486;          // 雨声 seed(你 task#14 验证过)
const DIALOGUE_END = 5.9;
// 场景 prompt(干净,Stage 2+3 共用;不含对白/说话,避免 Stage 3 人声渗出)
const PROMPT = "烟雨朦胧的江南小镇石板路,夜晚,暖黄灯笼倒映在湿漉漉的石板镜面上。RN(男人,深棕长发半束,酒红色暗纹广袖长袍外搭黑色狐狸毛大氅)与WV(女人,乌黑盘发缀绿玉白花发饰,暗绿色抹胸鱼尾长裙)面对面站着,随后并肩向街道深处走去,镜头缓缓绕到身后展示背影。大雨倾盆,雨滴打在湿石板和水洼上,屋檐滴水,微风。电影感手摇镜头。";
// 对口型标注 —— 仅 Stage 2(驱动嘴型),绝不进 Stage 3
const STAGE2_SUFFIX = "两人正在交谈:RN(男人)率先开口说话,嘴唇随话语同步开合,说道:\"这么巧,没想到会在这里遇见你\";WV(女人)微微脸红点头,甜美地回答,嘴唇随话语开合:\"我也没想到,一起走吧\"。两人对话时嘴型与语音精准对口型同步。";
const NEG = "worst quality, blurry, jittery, distorted, text, watermark, subtitles, static mouth, frozen face, closed lips while speaking, mismatched lips";

function dockerCp(h: string) { const b = path.basename(h); execSync(`docker cp "${h}" ${CONTAINER}:"${INPUT_DIR}/${b}"`, { timeout: 30_000 }); return b; }

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const refs = REFS_HOST.map(dockerCp);
  const firstFrame = dockerCp(FIRST_HOST);
  const lastFrame = dockerCp(LAST_HOST);
  const dialogue = dockerCp(DIALOGUE_HOST);
  const numFrames = Math.ceil((Math.round(DURATION * FPS) + 1 - 1) / 8) * 8 + 1; // 361
  console.log(`refs=${refs} first=${firstFrame} last=${lastFrame} dialogue=${dialogue}`);
  console.log(`numFrames=${numFrames} firstIdx=37 lastIdx=${numFrames - 1} seed=${SEED}(rain)`);

  const t0 = Date.now();
  const result = await executeFiveStagePipeline({
    refFilenames: refs,
    prompt: PROMPT, negativePrompt: NEG,
    width: WIDTH, height: HEIGHT,
    numFrames, msrFrameCount: 41, fps: FPS,
    seed: SEED, filenamePrefix: "msr_kf_voiced_cleanaudio",
    customAudioFilename: dialogue,
    dialogueEndTime: DIALOGUE_END,
    firstFrameFilename: firstFrame,
    firstFrameIdx: 42,                // 方案 B:msrFrameCount+1,避开条件段(默认 37 是方案A)
    lastFrameFilename: lastFrame,     // node53 @ frame 360, str 0.6
    stage2PromptSuffix: STAGE2_SUFFIX, // 对口型标注只进 Stage 2,Stage 3 用干净场景(避免人声渗出)
    useV2: true,
  });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  const localFinal = `${OUT_DIR}/voiced_15s_cleanaudio.mp4`;
  execSync(`docker cp ${CONTAINER}:"/root/ComfyUI/output/${result.finalVideoFilename}" "${localFinal}"`, { timeout: 30_000 });
  console.log(`\n✅ 完成 (${elapsed}s) → ${localFinal} (${(fs.statSync(localFinal).size/1024/1024).toFixed(2)} MB)`);
})().catch(e => { console.error("FATAL:", e.stack || e.message); process.exit(1); });
