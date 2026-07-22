/**
 * 从当前 msr.ts 的 buildMSRWorkflow 导出【唯一】规范参考工作流 JSON。
 * 反映生产默认:V2(PromptRelayEncode + LTX2_NAG)+ 蒸馏9步 ManualSigmas +
 *              dialogue+ambient 音频全冻结 + 首尾帧条件。
 * msr.ts 演进后重跑此脚本即可刷新参考 JSON。
 * 用法:npx tsx scripts/export-msr-workflow.ts
 */
import fs from "fs";
import { buildMSRWorkflow } from "../src/routes/production/ltx/msr";

const numFrames = Math.ceil((15 * 24) / 8) * 8 + 1; // 361

const wf = buildMSRWorkflow({
  refFilenames: ["ref1.jpg", "ref2.jpg", "bg.png"],   // 末张作 background
  prompt: "<场景+动作 prompt:谁在做什么,镜头如何运动>",
  negativePrompt: "worst quality, blurry, jittery, distorted, text, watermark, subtitles, static mouth, frozen face, mismatched lips",
  width: 1280, height: 704, numFrames, msrFrameCount: 41, fps: 24,
  seed: 1513163486,
  filenamePrefix: "msr_multi_reference",
  customAudioFilename: "dialogue.wav",               // 冻结该音频作条件
  audioMode: "dialogue+ambient",                     // 生产默认(v1 SolidMask 全冻结;另可 dialogue+ambient_v2=partial-mask Mode D / 5stage_pipeline / ambient_only / silent)
  firstFrameFilename: "keyframe_first.png", firstFrameIdx: 42,
  lastFrameFilename: "keyframe_last.png",
  useV2: true,                                        // PromptRelay + NAG
});

const out = "workflows/ltx-2.3/msr_multi_reference.json";
fs.writeFileSync(out, JSON.stringify(wf, null, 2));
console.log(`✓ 导出 → ${out} (${Object.keys(wf).length} 节点)`);
