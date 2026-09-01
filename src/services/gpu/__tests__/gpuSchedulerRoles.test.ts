/**
 * GpuScheduler 角色化改造单测 — 双3090 扩展 Phase A (docs/gpu-dual-3090-expansion.md)。
 *
 * 运行方式 (仿 gpuSchedulerProfiles.test.ts, node:test + tsx; 仓库无 vitest):
 *   node --import tsx --test src/services/gpu/__tests__/gpuSchedulerRoles.test.ts
 *
 * 隔离策略:
 *   - 副作用 setup 模块写在被测模块 import 之前 (hermetic conf + nvidia-smi 桩)
 *     — GPU_DEVICES 兼容导出在模块加载时快照一次, 必须让快照吃到桩。
 *   - 只用 MemoryStateStore, 不触碰 docker / 健康检查 / 真 GPU 查询。
 */
import "./gpuSchedulerRoles.setup";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";

import {
  GpuScheduler,
  GPU_DEVICES,
  getRegisteredServices,
  profileGpuIndex,
} from "../GpuScheduler";
import { MemoryStateStore } from "../memoryStateStore";
import { __resetGpuRolesCachesForTests } from "../gpuRoles";
import { confFile, shimToday, shimDual, realPath, writeDefaultConf } from "./gpuSchedulerRoles.setup";

// ─── 用例 ─────────────────────────────────────────────────

describe("GpuScheduler 角色化 — profile 索引解析 (默认 conf = 零行为变化)", () => {
  it("红线验收: 8 个 profile 全部解析回今日静态 gpuId (逐位相等)", () => {
    const services = getRegisteredServices();
    assert.equal(services.length, 8);
    for (const p of services) {
      assert.equal(profileGpuIndex(p), p.gpuId, `profile ${p.id} 解析结果偏离静态 gpuId`);
    }
    // 抽样明示: 渲染/LLM 族 1, 轻任务族 0
    const byId = new Map(services.map((p) => [p.id, p]));
    assert.equal(profileGpuIndex(byId.get("qwen-llm")!), 1);
    assert.equal(profileGpuIndex(byId.get("qwen-ear")!), 1);
    assert.equal(profileGpuIndex(byId.get("qwen-vllm")!), 1);
    assert.equal(profileGpuIndex(byId.get("comfyui-primary")!), 1);
    assert.equal(profileGpuIndex(byId.get("comfyui-auxiliary")!), 0);
    assert.equal(profileGpuIndex(byId.get("chatterbox")!), 0);
  });

  it("gpuRole 字段: qwen-llm 显式同名键, cosyvoice 映射 kais-gold-team, 其余缺省按 id", () => {
    const byId = new Map(getRegisteredServices().map((p) => [p.id, p]));
    assert.equal(byId.get("qwen-llm")!.gpuRole, "qwen-llm");
    assert.equal(byId.get("cosyvoice")!.gpuRole, "kais-gold-team");
    assert.equal(byId.get("comfyui-auxiliary")!.gpuRole, undefined);
    assert.equal(byId.get("lora-trainer")!.gpuRole, undefined);
  });

  it("插卡日 conf 翻转 (qwen-llm_role=QC_GEN2) → 解析到新卡索引 2, 免改代码", () => {
    writeDefaultConf();
    fs.writeFileSync(confFile, fs.readFileSync(confFile, "utf8")
      .replace("QC_GEN2_UUID=TBD", `QC_GEN2_UUID=GPU-new3090-0000-1111-2222-333333333333`)
      .replace("qwen-llm_role=RENDER_GEN1", "qwen-llm_role=QC_GEN2"));
    process.env.PATH = `${shimDual}:${realPath}`;
    __resetGpuRolesCachesForTests();
    const byId = new Map(getRegisteredServices().map((p) => [p.id, p]));
    assert.equal(profileGpuIndex(byId.get("qwen-llm")!), 2);
    // 未翻转的服务仍落渲染卡/轻任务卡
    assert.equal(profileGpuIndex(byId.get("qwen-ear")!), 1);
    assert.equal(profileGpuIndex(byId.get("comfyui-auxiliary")!), 0);
    // 还原 hermetic 默认
    process.env.PATH = `${shimToday}:${realPath}`;
    writeDefaultConf();
    __resetGpuRolesCachesForTests();
  });
});

describe("GpuScheduler 角色化 — 设备表与 locks 覆盖", () => {
  it("GPU_DEVICES 兼容快照 = 今日两卡 (3060Ti idx0 / 3090 idx1)", () => {
    // 注: 探测成功路径的 name 取 nvidia-smi 全名 (NVIDIA GeForce 前缀),
    // 短名硬编码仅在探测失败回退时出现 (见 gpuRoles.test.ts 设备表用例)。
    assert.deepEqual(GPU_DEVICES, [
      { id: 0, name: "NVIDIA GeForce RTX 3060 Ti", totalMb: 8192, gpusFlag: '"device=0"' },
      { id: 1, name: "NVIDIA GeForce RTX 3090", totalMb: 24576, gpusFlag: '"device=1"' },
    ]);
  });

  it("getState: locks 覆盖全部当前设备 (今日 2 卡)", async () => {
    const sched = new GpuScheduler(new MemoryStateStore());
    const state = await sched.getState();
    assert.deepEqual(state.devices.map((d) => d.id), [0, 1]);
    assert.deepEqual(Object.keys(state.locks).sort(), ["0", "1"]);
    assert.equal(state.locks[0], null);
    assert.equal(state.locks[1], null);
  });

  it("getState: 插卡后动态含 GPU2 (locks 覆盖 0/1/2)", async () => {
    const sched = new GpuScheduler(new MemoryStateStore());
    process.env.PATH = `${shimDual}:${realPath}`;
    __resetGpuRolesCachesForTests();
    const state = await sched.getState();
    assert.deepEqual(state.devices.map((d) => d.id), [0, 1, 2]);
    assert.deepEqual(Object.keys(state.locks).sort(), ["0", "1", "2"]);
    process.env.PATH = `${shimToday}:${realPath}`;
    __resetGpuRolesCachesForTests();
  });
});
