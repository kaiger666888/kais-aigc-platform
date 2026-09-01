/**
 * gpuSchedulerRoles.setup.ts — hermetic env 前置模块 (供 gpuSchedulerRoles.test.ts 用)。
 *
 * 必须以副作用 import 的形式写在被测模块 import 之前:
 *   import "./gpuSchedulerRoles.setup";
 *   import { GpuScheduler } from "../GpuScheduler";
 * ES/CJS 模块求值按 import 声明序执行 — 本模块先落 KAIS_GPU_CONF 临时副本 +
 * PATH 前插 nvidia-smi 桩, GpuScheduler 模块加载时的 GPU_DEVICES 快照才吃得到桩
 * (否则快照打在宿主真机上, 测试不再 hermetic)。
 */
import fs from "fs";
import os from "os";
import path from "path";

export const RENDER = "GPU-c5cdd49c-5a18-7d0b-2af5-1d2f642538c6";
export const AUX = "GPU-efe011dd-82a0-a20f-6ad8-eaa21aaf8570";
export const QC_NEW = "GPU-new3090-0000-1111-2222-333333333333";

export const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "gpu-roles-sched-"));
export const confFile = path.join(tmpBase, "gpu.conf");

/** 重写 conf 为今日默认内容 (全 RENDER_GEN1 + AUX_LIGHT, QC_GEN2=TBD) */
export function writeDefaultConf(): void {
  fs.writeFileSync(confFile, [
    `RENDER_GEN1_UUID=${RENDER}`,
    "QC_GEN2_UUID=TBD",
    `AUX_LIGHT_UUID=${AUX}`,
    "qwen-llm_role=RENDER_GEN1",
    "qwen-ear_role=RENDER_GEN1",
    "qwen-vllm_role=RENDER_GEN1",
    "music3_role=RENDER_GEN1",
    "qwen_tts_role=RENDER_GEN1",
    "comfyui-primary_role=RENDER_GEN1",
    "comfyui-auxiliary_role=AUX_LIGHT",
    "kais-gold-team_role=RENDER_GEN1",
    "chatterbox_role=AUX_LIGHT",
    "",
  ].join("\n"));
}
writeDefaultConf();
process.env.KAIS_GPU_CONF = confFile;

export const realPath = process.env.PATH ?? "";

/** nvidia-smi 桩目录: layout=today2 (今日 2 卡) / dual3 (插卡后 3 卡) */
function makeShim(layout: "today2" | "dual3"): string {
  const binDir = path.join(tmpBase, `bin-${layout}`);
  fs.mkdirSync(binDir, { recursive: true });
  const qc = layout === "dual3"
    ? [
        `    echo "2, ${QC_NEW}"`,
        '    echo "2, NVIDIA GeForce RTX 3090, 24576"',
        `    echo "${QC_NEW}, NVIDIA GeForce RTX 3090, 24576"`,
      ]
    : ["", "", ""];
  fs.writeFileSync(path.join(binDir, "nvidia-smi"), [
    "#!/bin/sh",
    'case "$*" in',
    "  *index,uuid*)",
    `    echo "0, ${AUX}"`,
    `    echo "1, ${RENDER}"`,
    qc[0],
    "    ;;",
    "  *index,name*)",
    '    echo "0, NVIDIA GeForce RTX 3060 Ti, 8192"',
    '    echo "1, NVIDIA GeForce RTX 3090, 24576"',
    qc[1],
    "    ;;",
    "  *uuid,name*)",
    `    echo "${AUX}, NVIDIA GeForce RTX 3060 Ti, 8192"`,
    `    echo "${RENDER}, NVIDIA GeForce RTX 3090, 24576"`,
    qc[2],
    "    ;;",
    "esac",
    "",
  ].filter((l) => l !== "").join("\n") + "\n", { mode: 0o755 });
  return binDir;
}

export const shimToday = makeShim("today2");
export const shimDual = makeShim("dual3");
process.env.PATH = `${shimToday}:${realPath}`;
