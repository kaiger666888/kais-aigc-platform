/**
 * MSR 尾帧 + 5stage 对白/环境音 15s 测试
 *
 * 调用 executeFiveStagePipeline(复用生产逻辑):
 *   Stage 2: dialogue+ambient_v2(对话段 0-5.9s 冻结 TTS)+ 尾帧 guide
 *   Stage 3: 纯环境声 pass(5.9-15s)
 *   ffmpeg: sidechain ducking 混合 + mux
 * 结果:15s 视频,前半对白保真 + 后半丰富环境声 + 尾帧拉向目标构图。
 * 用法:npx tsx scripts/test-msr-lastframe-voiced.ts
 */
import { executeFiveStagePipeline } from "../src/routes/production/ltx/msr";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const CONTAINER = "comfyui-primary";
const INPUT_DIR = "/root/ComfyUI/input";
const OUT_DIR = "workflows/ltx-2.3/msr-lastframe-test-output";

const REFS_HOST = [
  "workflows/ltx-2.3/test-viewer/refs-real/1.jpg",  // RN
  "workflows/ltx-2.3/test-viewer/refs-real/2.jpg",  // WV
  "workflows/ltx-2.3/test-viewer/refs-real/bg.png", // background
];
const DIALOGUE_WAV_HOST = "workflows/ltx-2.3/test-viewer/voicedesign/rn_wv_dialogue_v2.wav"; // 5.9s RN+WV 对白
const LAST_FRAME_HOST = "workflows/ltx-2.3/msr-ts-v2-test-output/frame_3s.png";

const WIDTH = 1280, HEIGHT = 704, FPS = 24, DURATION = 15;
const SEED = 1513163486;  // audioStrategy 旧测试出"雨"的 seed(12345 出白噪,这个出雨)
const DIALOGUE_END = 5.9;
const PROMPT = "RN in ornate red-and-gold robes and WV in green-and-white stand facing each other in a narrow misty rain-soaked alley at night, having an intimate conversation. They speak alternately — RN's and WV's lips move in tight sync with the dialogue audio, their mouths clearly articulating words with visible jaw and lip movement, close framing on their faces as they talk. Heavy rain pours down, raindrops hitting wet stone pavement and puddles, steady rainfall, water dripping from eaves. Warm paper lanterns glow overhead, puddles reflecting lantern light, cinematic handheld push-in";
const NEG = "worst quality, blurry, jittery, distorted, text, watermark, subtitles";

function dockerCp(hostPath: string): string {
  const base = path.basename(hostPath);
  execSync(`docker cp "${hostPath}" ${CONTAINER}:"${INPUT_DIR}/${base}"`, { timeout: 30_000 });
  return base;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const refs = REFS_HOST.map(dockerCp);
  const dialogue = dockerCp(DIALOGUE_WAV_HOST);
  const lastFrame = dockerCp(LAST_FRAME_HOST);
  console.log("refs:", refs, "| dialogue:", dialogue, "| lastFrame:", lastFrame);

  const numFrames = Math.ceil((Math.round(DURATION * FPS) + 1 - 1) / 8) * 8 + 1; // 361
  console.log(`numFrames=${numFrames} → 尾帧 frame_idx=${numFrames - 1} (Stage 2 视频)`);

  const t0 = Date.now();
  const result = await executeFiveStagePipeline({
    refFilenames: refs,
    prompt: PROMPT, negativePrompt: NEG,
    width: WIDTH, height: HEIGHT,
    numFrames, msrFrameCount: 41, fps: FPS,
    seed: SEED, filenamePrefix: "msr_lf_voiced_v4",
    customAudioFilename: dialogue,
    dialogueEndTime: DIALOGUE_END,
    lastFrameFilename: lastFrame,
    lastFrameStrength: 0.6,
    // 不传 stage3AudioMode → 默认 auto(audioStrategy 旧测试用 auto 出了雨声;实测 ambient_only 反而更弱)
    useV2: true,
  });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  // 最终视频在容器 output 目录,取出来
  const finalName = result.finalVideoFilename;
  const localFinal = `${OUT_DIR}/voiced_15s_lipsync.mp4`;
  execSync(`docker cp ${CONTAINER}:"/root/ComfyUI/output/${finalName}" "${localFinal}"`, { timeout: 30_000 });
  console.log(`\n✅ 完成 (${elapsed}s / ${(result.durationMs/1000).toFixed(1)}s pipeline)`);
  console.log(`   final: ${localFinal} (${(fs.statSync(localFinal).size/1024/1024).toFixed(2)} MB)`);
  console.log(`   stage2 promptId: ${result.stage2PromptId}`);
  console.log(`   stage3 promptId: ${result.stage3PromptId}`);

  fs.writeFileSync(`${OUT_DIR}/voiced_result.json`, JSON.stringify({
    seed: SEED, numFrames, width: WIDTH, height: HEIGHT, fps: FPS, duration: DURATION,
    dialogueEnd: DIALOGUE_END, dialogueWav: DIALOGUE_WAV_HOST,
    lastFrameTarget: LAST_FRAME_HOST, lastFrameStrength: 0.6,
    local: localFinal, elapsedSec: Number(elapsed),
    stage2PromptId: result.stage2PromptId, stage3PromptId: result.stage3PromptId,
  }, null, 2));
}

main().catch(e => { console.error("FATAL:", e.stack || e.message); process.exit(1); });
