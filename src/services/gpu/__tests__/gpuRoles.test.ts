/**
 * gpuRoles 解析链单测 — 双3090 扩展 Phase A (docs/gpu-dual-3090-expansion.md)。
 *
 * 运行方式 (仿 gpuSchedulerProfiles.test.ts, node:test + tsx; 仓库无 vitest):
 *   node --import tsx --test src/services/gpu/__tests__/gpuRoles.test.ts
 *
 * 隔离策略:
 *   - conf 用 KAIS_GPU_CONF 指向临时副本, nvidia-smi 用 PATH 前插的桩脚本 —
 *     不触碰真 /opt/kais-gpu/gpu.conf, 不发真 GPU 查询。
 *   - 桩脚本按 --query-gpu 列参数分响应 (index,uuid / index,name,memory.total /
 *     uuid,name,memory.total), 与生产 execFileSync 调用形态逐一对齐。
 *   - 每个 it 前后保存/恢复 PATH 与 KAIS_GPU_* env, 并清空模块级 nvidia-smi 缓存。
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

import {
  FALLBACK_RENDER_UUID,
  FALLBACK_AUX_UUID,
  DEFAULT_ROLE,
  lookupServiceRole,
  resolveServiceRole,
  resolveRoleUuid,
  resolveServiceUuid,
  resolveServiceIndex,
  resolveServiceIndexSync,
  resolveRoleIndexSync,
  getGpuDevices,
  __resetGpuRolesCachesForTests,
} from "../gpuRoles";

// ─── 桩夹具 ───────────────────────────────────────────────

const RENDER = "GPU-c5cdd49c-5a18-7d0b-2af5-1d2f642538c6";
const AUX = "GPU-efe011dd-82a0-a20f-6ad8-eaa21aaf8570";
const QC_NEW = "GPU-new3090-0000-1111-2222-333333333333";

/** 今日默认 conf 的临时副本 (全 RENDER_GEN1 + AUX_LIGHT 两行, 与 /opt 现网同内容) */
function defaultConf(): string {
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
    "comfyui-primary_role=RENDER_GEN1",
    "comfyui-auxiliary_role=AUX_LIGHT",
    "kais-gold-team_role=RENDER_GEN1",
    "qwen_eye_role=RENDER_GEN1",
    "qwen_ear_role=RENDER_GEN1",
    "chatterbox_role=AUX_LIGHT",
    "",
  ].join("\n");
}

interface ShimDir {
  dir: string;
  /** 含 nvidia-smi 桩的 PATH 前缀 */
  with: string;
  /** 确保找不到 nvidia-smi 的 PATH (单目录, 桩已移走) */
  without: string;
}

function makeShimDirs(layout: "today2" | "dual3", logPath?: string): ShimDir {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "gpu-roles-shim-"));
  const binDir = path.join(base, "bin");
  const emptyDir = path.join(base, "empty");
  fs.mkdirSync(binDir);
  fs.mkdirSync(emptyDir);
  const qc = layout === "dual3"
    ? [
        " 2, GPU-new3090-0000-1111-2222-333333333333", // index,uuid
        " 2, NVIDIA GeForce RTX 3090, 24576", // index,name,memory.total
        " GPU-new3090-0000-1111-2222-333333333333, NVIDIA GeForce RTX 3090, 24576", // uuid,name,memory.total
      ]
    : ["", "", ""];
  const body = [
    "#!/bin/sh",
    logPath ? `echo x >> "${logPath}"` : "",
    'case "$*" in',
    "  *index,uuid*)",
    `    echo "0, ${AUX}"`,
    `    echo "1, ${RENDER}"${qc[0] ? `\n    echo "${qc[0].trim()}"` : ""}`,
    "    ;;",
    "  *index,name*)",
    '    echo "0, NVIDIA GeForce RTX 3060 Ti, 8192"',
    '    echo "1, NVIDIA GeForce RTX 3090, 24576"',
    qc[1] ? `    echo "${qc[1].trim()}"` : "",
    "    ;;",
    "  *uuid,name*)",
    `    echo "${AUX}, NVIDIA GeForce RTX 3060 Ti, 8192"`,
    `    echo "${RENDER}, NVIDIA GeForce RTX 3090, 24576"`,
    qc[2] ? `    echo "${qc[2].trim()}"` : "",
    "    ;;",
    "esac",
    "",
  ].filter((l) => l !== "").join("\n") + "\n";
  fs.writeFileSync(path.join(binDir, "nvidia-smi"), body, { mode: 0o755 });
  return { dir: base, with: binDir, without: emptyDir };
}

function writeConfFile(content: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gpu-roles-conf-"));
  const file = path.join(dir, "gpu.conf");
  fs.writeFileSync(file, content);
  return file;
}

// ─── env 快照/恢复 ────────────────────────────────────────

let savedPath: string | undefined;
let savedKais: Record<string, string> = {};

beforeEach(() => {
  savedPath = process.env.PATH;
  savedKais = {};
  for (const k of Object.keys(process.env)) {
    if (k.startsWith("KAIS_GPU_") || k === "KAIS_GPU_CONF") {
      savedKais[k] = process.env[k]!;
      delete process.env[k];
    }
  }
  __resetGpuRolesCachesForTests();
});

afterEach(() => {
  process.env.PATH = savedPath;
  for (const k of Object.keys(process.env)) {
    if (k.startsWith("KAIS_GPU_") || k === "KAIS_GPU_CONF") delete process.env[k];
  }
  Object.assign(process.env, savedKais);
  __resetGpuRolesCachesForTests();
});

// ─── conf 解析 / env 覆盖 ─────────────────────────────────

describe("gpuRoles 服务→角色 (conf 解析 / env 覆盖)", () => {
  it("conf <svc>_role 原样命中 (横线与下划线并存, 勿强转)", () => {
    process.env.KAIS_GPU_CONF = writeConfFile(defaultConf());
    assert.equal(resolveServiceRole("qwen-llm"), "RENDER_GEN1");
    assert.equal(lookupServiceRole("comfyui-auxiliary"), "AUX_LIGHT");
    assert.equal(lookupServiceRole("chatterbox"), "AUX_LIGHT");
    assert.equal(resolveServiceRole("qwen_tts"), "RENDER_GEN1");
    // conf 无此行 → lookup null / resolve 折叠默认
    assert.equal(lookupServiceRole("minimax_h3"), null);
    assert.equal(resolveServiceRole("minimax_h3"), DEFAULT_ROLE);
  });

  it("env KAIS_GPU_<SVC>_ROLE 覆盖 conf (横线→下划线大写)", () => {
    process.env.KAIS_GPU_CONF = writeConfFile(defaultConf());
    process.env.KAIS_GPU_QWEN_LLM_ROLE = "AUX_LIGHT";
    assert.equal(resolveServiceRole("qwen-llm"), "AUX_LIGHT");
    // conf 里该服务是 AUX_LIGHT, env 翻回 RENDER_GEN1
    process.env.KAIS_GPU_COMFYUI_AUXILIARY_ROLE = "RENDER_GEN1";
    assert.equal(resolveServiceRole("comfyui-auxiliary"), "RENDER_GEN1");
  });

  it("服务→UUID: 走 conf 角色链 (AUX 服务落 3060Ti UUID)", () => {
    process.env.KAIS_GPU_CONF = writeConfFile(defaultConf());
    assert.equal(resolveServiceUuid("comfyui-auxiliary"), AUX);
    assert.equal(resolveServiceUuid("qwen-llm"), RENDER);
  });
});

// ─── 角色→UUID 解析链 ─────────────────────────────────────

describe("gpuRoles 角色→UUID (env → conf → 发现兜底 → 硬编码)", () => {
  it("conf 值生效; env KAIS_GPU_<ROLE>_UUID 最高优先", () => {
    process.env.KAIS_GPU_CONF = writeConfFile(defaultConf());
    assert.equal(resolveRoleUuid("RENDER_GEN1"), RENDER);
    process.env.KAIS_GPU_QC_GEN2_UUID = QC_NEW;
    assert.equal(resolveRoleUuid("QC_GEN2"), QC_NEW);
  });

  it("QC_GEN2_UUID=TBD + 未插卡 (2 卡) → 发现兜底退渲染卡", () => {
    process.env.KAIS_GPU_CONF = writeConfFile(defaultConf()); // QC_GEN2_UUID=TBD
    process.env.PATH = `${makeShimDirs("today2").with}:${process.env.PATH}`;
    assert.equal(resolveRoleUuid("QC_GEN2"), RENDER);
  });

  it("QC_GEN2_UUID=TBD + 插卡 (3 卡) → 按属性+排除法发现新卡", () => {
    process.env.KAIS_GPU_CONF = writeConfFile(defaultConf());
    process.env.PATH = `${makeShimDirs("dual3").with}:${process.env.PATH}`;
    assert.equal(resolveRoleUuid("QC_GEN2"), QC_NEW);
  });

  it("发现兜底只认 3090 ∧ ≥23000MB ∧ ≠RENDER_GEN1 (3060Ti 不误判)", () => {
    // conf 把 RENDER_GEN1 换成 AUX UUID → 桩里 idx1 的 3090 不再被排除, 应命中它
    const conf = defaultConf().replace(`RENDER_GEN1_UUID=${RENDER}`, `RENDER_GEN1_UUID=${AUX}`);
    process.env.KAIS_GPU_CONF = writeConfFile(conf);
    process.env.PATH = `${makeShimDirs("today2").with}:${process.env.PATH}`;
    assert.equal(resolveRoleUuid("QC_GEN2"), RENDER);
  });

  it("非 QC_GEN2 角色 TBD → 落渲染卡 (gpu-roles.sh 同款语义)", () => {
    const conf = defaultConf().replace(`AUX_LIGHT_UUID=${AUX}`, "AUX_LIGHT_UUID=TBD");
    process.env.KAIS_GPU_CONF = writeConfFile(conf);
    assert.equal(resolveRoleUuid("AUX_LIGHT"), RENDER);
  });

  it("conf 文件不存在 → 全走默认, 不抛异常", () => {
    process.env.KAIS_GPU_CONF = "/nonexistent/gpu.conf";
    // QC_GEN2 缺省仍会尝试发现兜底 — 桩移走保证与宿主机真卡数无关, 落硬编码
    process.env.PATH = makeShimDirs("today2").without;
    assert.equal(resolveServiceRole("qwen-llm"), DEFAULT_ROLE);
    assert.equal(resolveServiceUuid("qwen-llm"), FALLBACK_RENDER_UUID);
    assert.equal(resolveRoleUuid("QC_GEN2"), FALLBACK_RENDER_UUID);
  });
});

// ─── UUID → 索引 ──────────────────────────────────────────

describe("gpuRoles UUID→索引 (nvidia-smi 实时/缓存) 与设备表", () => {
  it("resolveServiceIndex: 异步实时解析 (render=1 / aux=0)", async () => {
    process.env.KAIS_GPU_CONF = writeConfFile(defaultConf());
    process.env.PATH = `${makeShimDirs("today2").with}:${process.env.PATH}`;
    assert.equal(await resolveServiceIndex("qwen-llm"), 1);
    assert.equal(await resolveServiceIndex("comfyui-auxiliary"), 0);
  });

  it("UUID 不在系统上 / nvidia-smi 失败 → null, 不抛异常", async () => {
    process.env.KAIS_GPU_CONF = writeConfFile(defaultConf());
    process.env.KAIS_GPU_QWEN_LLM_ROLE = "QC_GEN2";
    process.env.KAIS_GPU_QC_GEN2_UUID = QC_NEW;
    // 2 卡桩上没有 QC_NEW
    process.env.PATH = `${makeShimDirs("today2").with}:${process.env.PATH}`;
    assert.equal(await resolveServiceIndex("qwen-llm"), null);
    assert.equal(resolveServiceIndexSync("qwen-llm"), null);
    // 桩彻底移走
    process.env.PATH = makeShimDirs("today2").without;
    __resetGpuRolesCachesForTests();
    assert.equal(await resolveServiceIndex("qwen-llm"), null);
    assert.equal(resolveRoleIndexSync("RENDER_GEN1"), null);
  });

  it("同步路径 5s TTL 缓存: 多次解析只 spawn 一次桩", () => {
    process.env.KAIS_GPU_CONF = writeConfFile(defaultConf());
    const log = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "gpu-roles-log-")), "calls");
    process.env.PATH = `${makeShimDirs("today2", log).with}:${process.env.PATH}`;
    assert.equal(resolveServiceIndexSync("qwen-llm"), 1);
    assert.equal(resolveServiceIndexSync("qwen-ear"), 1);
    assert.equal(resolveRoleIndexSync("AUX_LIGHT"), 0);
    assert.equal(fs.readFileSync(log, "utf8").trim().split("\n").length, 1);
    // 清缓存后重新 spawn
    __resetGpuRolesCachesForTests();
    resolveServiceIndexSync("qwen-llm");
    assert.equal(fs.readFileSync(log, "utf8").trim().split("\n").length, 2);
  });

  it("getGpuDevices: 插卡后 3 卡动态视图 (gpusFlag 跟索引)", () => {
    process.env.PATH = `${makeShimDirs("dual3").with}:${process.env.PATH}`;
    const devices = getGpuDevices();
    assert.deepEqual(devices.map((d) => d.id), [0, 1, 2]);
    assert.equal(devices[2].name, "NVIDIA GeForce RTX 3090");
    assert.equal(devices[2].totalMb, 24576);
    assert.equal(devices[2].gpusFlag, '"device=2"');
  });

  it("getGpuDevices: nvidia-smi 失败回退今日硬编码两卡 (零异常)", () => {
    process.env.PATH = makeShimDirs("today2").without;
    assert.deepEqual(getGpuDevices(), [
      { id: 0, name: "RTX 3060 Ti", totalMb: 8192, gpusFlag: '"device=0"' },
      { id: 1, name: "RTX 3090", totalMb: 24576, gpusFlag: '"device=1"' },
    ]);
  });
});
