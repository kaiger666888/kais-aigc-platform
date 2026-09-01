/**
 * engineGpuIndex 角色化映射单测 — 双3090 扩展 Phase A (docs/gpu-dual-3090-expansion.md)。
 *
 * 运行方式 (仿 gpuVramManager.test.ts, node:test + tsx; 仓库无 vitest):
 *   node --import tsx --test src/lib/__tests__/gpuEngineRole.test.ts
 *
 * 隔离策略:
 *   - conf 用 KAIS_GPU_CONF 指向临时副本, nvidia-smi 用 PATH 前插的桩/移走来控制
 *     发现与索引解析结果; 不触碰真 /opt/kais-gpu/gpu.conf 与真 GPU 查询。
 *   - 每个 it 前后保存/恢复 PATH 与 KAIS_GPU_* / KAP_VRAM_GPU_INDEX env,
 *     并清空 gpuRoles 模块的 nvidia-smi 缓存。
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

import { ENGINE_GPU_INDEX, ENGINE_VRAM_REQUIREMENTS, engineGpuIndex } from "../gpuVramManager";
import { __resetGpuRolesCachesForTests } from "@/services/gpu/gpuRoles";

const RENDER = "GPU-c5cdd49c-5a18-7d0b-2af5-1d2f642538c6";
const AUX = "GPU-efe011dd-82a0-a20f-6ad8-eaa21aaf8570";
const QC_NEW = "GPU-new3090-0000-1111-2222-333333333333";

// ─── 夹具 ─────────────────────────────────────────────────

function writeConf(lines: string[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gpu-engine-role-"));
  const file = path.join(dir, "gpu.conf");
  fs.writeFileSync(file, [...lines, ""].join("\n"));
  return file;
}

/** 今日默认 conf 的引擎登记子集 (与 /opt 现网同语义) */
function defaultConfLines(): string[] {
  return [
    `RENDER_GEN1_UUID=${RENDER}`,
    "QC_GEN2_UUID=TBD",
    `AUX_LIGHT_UUID=${AUX}`,
    "qwen-llm_role=RENDER_GEN1",
    "qwen-ear_role=RENDER_GEN1",
    "qwen-vllm_role=RENDER_GEN1",
    "music3_role=RENDER_GEN1",
    "qwen_tts_role=RENDER_GEN1",
    "indextts2_role=RENDER_GEN1",
    "sa3_role=RENDER_GEN1",
    "ace_role=RENDER_GEN1",
    "qwen_eye_role=RENDER_GEN1",
    "qwen_ear_role=RENDER_GEN1",
  ];
}

const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "gpu-engine-role-shim-"));
function makeShim(layout: "today2" | "dual3"): string {
  const binDir = path.join(tmpBase, `bin-${layout}`);
  fs.mkdirSync(binDir, { recursive: true });
  const qc = layout === "dual3"
    ? [
        `    echo "2, ${QC_NEW}"`,
        `    echo "${QC_NEW}, NVIDIA GeForce RTX 3090, 24576"`,
      ]
    : ["", ""];
  fs.writeFileSync(path.join(binDir, "nvidia-smi"), [
    "#!/bin/sh",
    'case "$*" in',
    "  *index,uuid*)",
    `    echo "0, ${AUX}"`,
    `    echo "1, ${RENDER}"`,
    qc[0],
    "    ;;",
    "  *uuid,name*)",
    `    echo "${AUX}, NVIDIA GeForce RTX 3060 Ti, 8192"`,
    `    echo "${RENDER}, NVIDIA GeForce RTX 3090, 24576"`,
    qc[1],
    "    ;;",
    "esac",
    "",
  ].filter((l) => l !== "").join("\n") + "\n", { mode: 0o755 });
  return binDir;
}
const shimToday = makeShim("today2");
const shimDual = makeShim("dual3");
const shimEmpty = path.join(tmpBase, "empty"); // 无 nvidia-smi → 解析必失败

// ─── env 快照/恢复 ────────────────────────────────────────

let savedPath: string | undefined;
let savedKapVram: string | undefined;
let savedKais: Record<string, string> = {};

beforeEach(() => {
  savedPath = process.env.PATH;
  savedKapVram = process.env.KAP_VRAM_GPU_INDEX;
  savedKais = {};
  for (const k of Object.keys(process.env)) {
    if (k.startsWith("KAIS_GPU_")) {
      savedKais[k] = process.env[k]!;
      delete process.env[k];
    }
  }
  process.env.PATH = `${shimToday}:${savedPath ?? ""}`;
  __resetGpuRolesCachesForTests();
});

afterEach(() => {
  process.env.PATH = savedPath;
  if (savedKapVram === undefined) delete process.env.KAP_VRAM_GPU_INDEX;
  else process.env.KAP_VRAM_GPU_INDEX = savedKapVram;
  for (const k of Object.keys(process.env)) {
    if (k.startsWith("KAIS_GPU_")) delete process.env[k];
  }
  Object.assign(process.env, savedKais);
  __resetGpuRolesCachesForTests();
});

// ─── 用例 ─────────────────────────────────────────────────

describe("engineGpuIndex 角色化 — 默认 conf 零行为变化", () => {
  it("红线验收: 今日 conf + 2 卡, ENGINE_GPU_INDEX 全表解析 = 1 (逐位相等)", () => {
    process.env.KAIS_GPU_CONF = writeConf(defaultConfLines());
    for (const key of Object.keys(ENGINE_GPU_INDEX)) {
      assert.equal(engineGpuIndex(key), 1, `engine ${key} 偏离表值 1`);
    }
  });

  it("conf 未登记的引擎 (minimax_h3 等) 不受角色链扰动, 仍走表值", () => {
    process.env.KAIS_GPU_CONF = writeConf(defaultConfLines());
    for (const key of ["minimax_h3", "flux2", "wan22", "wan21", "trellis2", "postprocess", "rtx_vsr", "ltx", "default"]) {
      assert.equal(ENGINE_GPU_INDEX[key], 1);
      assert.equal(engineGpuIndex(key), 1);
    }
  });
});

describe("engineGpuIndex 角色化 — conf/env 翻转", () => {
  it("conf music3_role=QC_GEN2 (插卡日 setup sed 翻转) → 新卡索引 2", () => {
    process.env.KAIS_GPU_CONF = writeConf([
      `RENDER_GEN1_UUID=${RENDER}`,
      `QC_GEN2_UUID=${QC_NEW}`,
      `AUX_LIGHT_UUID=${AUX}`,
      "qwen_tts_role=RENDER_GEN1",
      "music3_role=QC_GEN2",
    ]);
    process.env.PATH = `${shimDual}:${savedPath ?? ""}`;
    __resetGpuRolesCachesForTests();
    assert.equal(engineGpuIndex("music3"), 2);
    assert.equal(engineGpuIndex("qwen_tts"), 1); // 未翻转的仍渲染卡
  });

  it("env KAIS_GPU_QWEN_TTS_ROLE 覆盖 conf (临时改道, 不动 conf)", () => {
    process.env.KAIS_GPU_CONF = writeConf(defaultConfLines());
    process.env.PATH = `${shimDual}:${savedPath ?? ""}`;
    __resetGpuRolesCachesForTests();
    process.env.KAIS_GPU_QWEN_TTS_ROLE = "QC_GEN2";
    process.env.KAIS_GPU_QC_GEN2_UUID = QC_NEW;
    assert.equal(engineGpuIndex("qwen_tts"), 2);
    assert.equal(engineGpuIndex("qwen_ear"), 1);
  });

  it("conf 键拼写原样: 只有横线键 qwen-tts_role 时不命中下划线引擎键 (勿强转)", () => {
    process.env.KAIS_GPU_CONF = writeConf([
      `RENDER_GEN1_UUID=${RENDER}`,
      `QC_GEN2_UUID=${QC_NEW}`,
      "qwen-tts_role=QC_GEN2", // 横线拼写的 bash 服务键 — TS 引擎键 qwen_tts 不消费
    ]);
    process.env.PATH = `${shimDual}:${savedPath ?? ""}`;
    __resetGpuRolesCachesForTests();
    assert.equal(engineGpuIndex("qwen_tts"), 1); // 未登记 → 表值链
  });
});

describe("engineGpuIndex 角色化 — 失败静默回退现状链", () => {
  it("conf 有登记但 nvidia-smi 不可用 → 回退表值, 不抛异常", () => {
    process.env.KAIS_GPU_CONF = writeConf(defaultConfLines());
    process.env.PATH = shimEmpty;
    __resetGpuRolesCachesForTests();
    for (const key of ["qwen_tts", "music3", "sa3", "qwen_ear"]) {
      assert.equal(engineGpuIndex(key), 1);
    }
  });

  it("conf 文件缺失 → 全部走表值链", () => {
    process.env.KAIS_GPU_CONF = "/nonexistent/gpu.conf";
    process.env.PATH = shimEmpty;
    __resetGpuRolesCachesForTests();
    for (const key of Object.keys(ENGINE_GPU_INDEX)) {
      assert.equal(engineGpuIndex(key), ENGINE_GPU_INDEX[key]);
    }
  });

  it("未登记引擎的现状链 env 分支保持: KAP_VRAM_GPU_INDEX → 兜底", () => {
    process.env.KAIS_GPU_CONF = "/nonexistent/gpu.conf";
    process.env.PATH = shimEmpty;
    __resetGpuRolesCachesForTests();
    assert.equal(engineGpuIndex("never_registered_engine"), 1);
    process.env.KAP_VRAM_GPU_INDEX = "2";
    assert.equal(engineGpuIndex("never_registered_engine"), 2);
  });

  it("登记表与显存需求表键集合一致 (防新引擎漏登记 GPU 归属)", () => {
    for (const key of Object.keys(ENGINE_VRAM_REQUIREMENTS)) {
      if (key === "default") continue;
      assert.ok(key in ENGINE_GPU_INDEX, `ENGINE_GPU_INDEX 缺 ${key}`);
    }
  });
});
