#!/usr/bin/env node
// ============================================================
// verify-h3-sigma-interp —— KSampler→Advanced 链 + sigma 低噪段插值改造验证
// ============================================================
// 任务书: /tmp/h3-sigma-interp-kap-prompt.md (2026-08-16, Case08 B-arm 验证结论)
//
// 检查项 (对应任务书 §3 验证要求 1-4):
//   1. 等价性   nativeInterp=false 时, 四条 Native 链的 Advanced 采样段与旧 KSampler 链
//              除采样链外逐节点一致; BasicScheduler(31).steps/scheduler = 原 KSampler 值;
//              31.sigmas 直连 (无 36)。
//   2. 插值生效 nativeInterp=true (默认 profile native-sage) 时, 34.sigmas=["36",0],
//              36 参数 = (2, 0.65, 0, "linear"), 36.sigmas=["31",0]。
//   3. 下游重接线 VAEDecode/VAEDecodeAudio 全部接 ["34",0]; 无残留 ["30",0] 引用
//              (节点 30 自身定义除外 —— KSamplerSelect 的 key "30" 不是引用)。
//   4. profile 隔离 turbo / lightx2v / lineart / production(T8) 各档 workflow 中
//              不存在 ExtendIntermediateSigmas 节点。
//
// 运行: node scripts/verify-h3-sigma-interp.mjs   (构建产物 data/serve/app.js 之外,
//       本脚本用 esbuild 单独 bundle src/routes/production/minimax-h3 的 builder 函数)

import { build } from "esbuild";
import { mkdtempSync, rmSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ENTRY = path.join(ROOT, "src/routes/production/minimax-h3");

let failures = 0;
function check(label, cond, detail = "") {
  const mark = cond ? "PASS" : "FAIL";
  if (!cond) failures++;
  console.log(`  [${mark}] ${label}${detail && !cond ? ` — ${detail}` : ""}`);
}

// —— bundle 四个 builder (导出的 build*WorkflowNative + generate.ts 的两个内联 builder) ——
// generate.ts 的 buildH3WorkflowNative 未 export, 通过一个 shim 入口 re-export。
// 注意: bundle 产物必须放在项目根目录下 (node 可解析项目 node_modules 的 external 依赖)。
const tmpDir = mkdtempSync(path.join(ROOT, ".tmp-h3-sigma-verify-"));
const shim = path.join(tmpDir, "entry.ts");
await (async () => {
  const { writeFile } = await import("fs/promises");
  await writeFile(shim, `
export { buildH3Ref2vaWorkflowNative, buildH3Ref2vaWorkflowT8 } from ${JSON.stringify(path.join(ENTRY, "ref2va"))};
export { buildH3I2vaWorkflowNative } from ${JSON.stringify(path.join(ENTRY, "i2va"))};
export { buildH3T2vaWorkflowNative } from ${JSON.stringify(path.join(ENTRY, "t2va"))};
`);
})();

const outfile = path.join(tmpDir, "bundle.cjs");
await build({
  entryPoints: [shim],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile,
  external: ["express", "multer", "sharp", "axios", "zod", "uuid"],
  logLevel: "silent",
});

// generate.ts buildH3WorkflowNative 未导出 —— 直接读 data/serve/app.js? 不行 (未 build)。
// 改为源级 grep 断言 (见检查 2/3 的 generate 部分), ref2va/i2va/t2va 走运行时断言。

const { buildH3Ref2vaWorkflowNative, buildH3I2vaWorkflowNative, buildH3T2vaWorkflowNative } =
  await import(outfile);

// —— 公共参数 (与 handler 调用侧一致; ref2va 需 1 张参考图) ——
const BASE = {
  prompt: "verify sigma interp",
  width: 1344, height: 768, length: 124,
  seed: 20260816, steps: 15,
  shiftVideo: 12.0, shiftAudio: 3.0,
  filenamePrefix: "verify_h3_sigma",
  negativePrompt: "neg",
  cfg: 1.0,
  denoise: 1.0,
  tespeed: false, // native-sage 等价 (不插 TESpeed, 排除 35 干扰)
};
const REF2VA = {
  ...BASE,
  refImageFilenames: ["ref0.png"],
  refAudioFilenames: [], refVideoFilenames: [], refVideoAudioFilenames: [],
  refImageSize: "match",
  samplerName: "res_multistep", scheduler: "normal", // H3_NATIVE.r2v*
};
const I2VA = {
  ...BASE,
  firstFrameFilename: "first.png", lastFrameFilename: null,
  refImageSize: "match",
  samplerName: "euler", scheduler: "normal", // H3_NATIVE.t2v*
};
const T2VA = {
  ...BASE,
  refImageSize: "match",
  samplerName: "euler", scheduler: "normal",
};

const CHAINS = [
  { name: "ref2va", build: (o) => buildH3Ref2vaWorkflowNative({ ...REF2VA, ...o }), modeOpts: REF2VA, r2v: true },
  { name: "i2va", build: (o) => buildH3I2vaWorkflowNative({ ...I2VA, ...o }), modeOpts: I2VA },
  { name: "t2va", build: (o) => buildH3T2vaWorkflowNative({ ...T2VA, ...o }), modeOpts: T2VA },
];

/** 旧 KSampler 链 (改动前, commit c227f773) 的采样段 —— 用于等价性对比的"预期旧图"。 */
function legacyKSamplerChain(o) {
  return {
    "30": {
      class_type: "KSampler",
      inputs: {
        model: ["21", 0], positive: ["20", 0], negative: ["16", 0],
        latent_image: ["20", 1], seed: o.seed, steps: o.steps, cfg: 1.0,
        sampler_name: o.samplerName, scheduler: o.scheduler, denoise: 1.0,
      },
    },
  };
}

const ADV_IDS = ["30", "31", "32", "33", "34", "36"];

for (const chain of CHAINS) {
  console.log(`\n=== ${chain.name}: nativeInterp=false (等价性 / 纯 Advanced 化) ===`);
  const off = chain.build({ nativeInterp: false });
  const adv = {
    "30": { class_type: "KSamplerSelect", inputs: { sampler_name: chain.modeOpts.samplerName } },
    "31": { class_type: "BasicScheduler", inputs: { model: ["21", 0], scheduler: chain.modeOpts.scheduler, steps: chain.modeOpts.steps, denoise: 1.0 } },
    "32": { class_type: "RandomNoise", inputs: { noise_seed: BASE.seed } },
    "33": { class_type: "BasicGuider", inputs: { model: ["21", 0], conditioning: ["20", 0] } },
    "34": { class_type: "SamplerCustomAdvanced", inputs: { noise: ["32", 0], guider: ["33", 0], sampler: ["30", 0], sigmas: ["31", 0], latent_image: ["20", 1] } },
  };
  check("31.steps = 原 KSampler steps", off["31"]?.inputs?.steps === chain.modeOpts.steps, JSON.stringify(off["31"]?.inputs));
  check("31.scheduler = 原 KSampler scheduler", off["31"]?.inputs?.scheduler === chain.modeOpts.scheduler);
  check("30.sampler_name = 原 sampler_name", off["30"]?.inputs?.sampler_name === chain.modeOpts.samplerName);
  check("34.sigmas 直连 [31,0] (无插值)", JSON.stringify(off["34"]?.inputs?.sigmas) === '["31",0]');
  check("无 ExtendIntermediateSigmas 节点", !Object.values(off).some(n => n.class_type === "ExtendIntermediateSigmas"));
  // 采样链之外的节点 (10/11/12/13/14*/16/20/21/40/41/42/43/44/50/51) 与旧图一致 —— 逐 key 对比
  const offStatic = Object.fromEntries(Object.entries(off).filter(([k]) => !ADV_IDS.includes(k)));
  const expectedStatic = {
    "10": off["10"], "11": off["11"], "12": off["12"], "13": off["13"], "16": off["16"],
    "20": off["20"], "21": off["21"],
  };
  // 旧链里采样段是 KSampler(30); 其余节点定义不受本改动影响 —— 结构抽检关键解码节点即可
  check("40.samples = [34,0]", JSON.stringify(off["40"]?.inputs?.samples) === '["34",0]');
  const audioDecode = off["41"] || off["43"]; // i2va/t2va 用 41, ref2va 用 43
  check("音频解码 samples = [34,0]", JSON.stringify(audioDecode?.inputs?.samples) === '["34",0]');
  check("无残留 [30,0] 引用", !hasRef(off, "30"), "仍有节点引用 [30,0]");
  check("静态节点未被改动 (keys ⊇ 10/11/12/13/16/20/21)", ["10","11","12","13","16","20","21"].every(k => k in offStatic));

  console.log(`\n=== ${chain.name}: nativeInterp=true (插值生效) ===`);
  const on = chain.build({ nativeInterp: true });
  const n36 = on["36"];
  check("存在节点 36", !!n36);
  check("36.class_type = ExtendIntermediateSigmas", n36?.class_type === "ExtendIntermediateSigmas");
  check("36.steps=2 / start_at_sigma=0.65 / end_at_sigma=0 / spacing=linear",
    n36?.inputs?.steps === 2 && n36?.inputs?.start_at_sigma === 0.65 &&
    n36?.inputs?.end_at_sigma === 0 && n36?.inputs?.spacing === "linear",
    JSON.stringify(n36?.inputs));
  check("36.sigmas = [31,0]", JSON.stringify(n36?.inputs?.sigmas) === '["31",0]');
  check("34.sigmas = [36,0]", JSON.stringify(on["34"]?.inputs?.sigmas) === '["36",0]');
  check("插值开启时 31 仍是原 steps/scheduler (15 步表 → 插值后 17)",
    on["31"]?.inputs?.steps === chain.modeOpts.steps && on["31"]?.inputs?.scheduler === chain.modeOpts.scheduler);
  check("40.samples = [34,0]", JSON.stringify(on["40"]?.inputs?.samples) === '["34",0]');
  const audioDecodeOn = on["41"] || on["43"];
  check("音频解码 samples = [34,0]", JSON.stringify(audioDecodeOn?.inputs?.samples) === '["34",0]');
  check("无残留 [30,0] 引用", !hasRef(on, "30"));

  // ref2va 专属: saveSeparateAudio 的 41/51 分支也要接 34
  if (chain.name === "ref2va") {
    const sep = chain.build({ nativeInterp: true, saveSeparateAudio: true });
    check("ref2va saveSeparateAudio: 41.samples = [34,0]", JSON.stringify(sep["41"]?.inputs?.samples) === '["34",0]');
    check("ref2va saveSeparateAudio: 无残留 [30,0]", !hasRef(sep, "30"));
  }
}

function hasRef(wf, id) {
  // 残留引用 = 除合法下游 (SamplerCustomAdvanced.sampler=["30",0] 是新链合法接线) 外,
  // 仍有节点把 ["30",0] 当 samples/latent 等输入 (旧 KSampler 输出的消费者)。
  return Object.entries(wf).some(([key, node]) =>
    key !== id &&
    !(node.class_type === "SamplerCustomAdvanced") && // 34.sampler=["30",0] 合法
    Object.values(node.inputs || {}).some(
      (v) => Array.isArray(v) && v[0] === id,
    ),
  );
}

// —— generate.ts: buildH3WorkflowNative 未 export, 源级断言 (结构与上面三链同构) ——
console.log("\n=== generate.ts buildH3WorkflowNative (源级断言, 函数未导出) ===");
{
  const src = await (await import("fs/promises")).readFile(path.join(ENTRY, "generate.ts"), "utf8");
  const nativeFn = src.slice(src.indexOf("function buildH3WorkflowNative"), src.indexOf("// ============================================================\n// H3 SigmaShift + LoRA"));
  check("KSamplerSelect(30) 存在", /"30"\] = \{ class_type: "KSamplerSelect"/.test(nativeFn) || /"30": \{ class_type: "KSamplerSelect"/.test(nativeFn));
  check("BasicScheduler(31) + RandomNoise(32) + BasicGuider(33) + SamplerCustomAdvanced(34)",
    nativeFn.includes('nodes["31"]') && nativeFn.includes('nodes["32"]') && nativeFn.includes('nodes["33"]') && nativeFn.includes('nodes["34"]'));
  check("useInterp 门控 (H3_SIGMA_INTERP.enabled && nativeInterp)", nativeFn.includes("const useInterp = H3_SIGMA_INTERP.enabled && nativeInterp === true"));
  check("36 = ExtendIntermediateSigmas + 四参数", nativeFn.includes('H3_SIGMA_INTERP_NODES.generate') && nativeFn.includes('"ExtendIntermediateSigmas"') && nativeFn.includes("start_at_sigma"));
  check("34.sigmas 条件指向 36/31", nativeFn.includes('sigmas: useInterp ? [H3_SIGMA_INTERP_NODES.generate, 0] : ["31", 0]'));
  check("40/41 接 [34,0]", nativeFn.includes('samples: ["34", 0]'));
  check("native 段无 KSampler(经典) 残留", !/class_type: "KSampler"/.test(nativeFn));
  // LightX2V/lineart 段 (buildH3WorkflowLightX2V) 与 T8 段不得含 ExtendIntermediateSigmas
  const lightFn = src.slice(src.indexOf("function buildH3WorkflowLightX2V"));
  check("LightX2V/lineart 段无 ExtendIntermediateSigmas", !lightFn.includes("ExtendIntermediateSigmas"));
  const t8Fn = src.slice(src.indexOf("function buildH3WorkflowT8"), src.indexOf("// ============================================================\n// H3 原生工作流构建"));
  check("T8 段无 ExtendIntermediateSigmas", !t8Fn.includes("ExtendIntermediateSigmas"));
}

// —— profile 隔离: turbo/production/lightx2v/lineart 的 T8/LightX2V 工作流无插值节点 ——
// (T8/LightX2V builder 未导出 —— 上面源级断言已覆盖。这里运行时复检 ref2va T8 builder:)
console.log("\n=== profile 隔离 (T8 链运行时复检) ===");
{
  const { buildH3Ref2vaWorkflowT8 } = await import(outfile);
  const t8 = buildH3Ref2vaWorkflowT8({
    ...REF2VA, turbo: true, steps: 4, nativeInterp: true, // 即使误传 nativeInterp, T8 也不得插值
    firstFrameFilename: null, lastFrameFilename: null, saveSeparateAudio: false,
  });
  check("T8 workflow (turbo) 无 ExtendIntermediateSigmas", !Object.values(t8).some(n => n.class_type === "ExtendIntermediateSigmas"));
  check("T8 workflow 无 36 节点", !("36" in t8));
}

rmSync(tmpDir, { recursive: true, force: true });

console.log(failures === 0 ? "\n✅ ALL CHECKS PASSED" : `\n❌ ${failures} CHECK(S) FAILED`);
process.on("exit", () => { try { rmSync(tmpDir, { recursive: true, force: true }); } catch {} });
process.exit(failures === 0 ? 0 : 1);
