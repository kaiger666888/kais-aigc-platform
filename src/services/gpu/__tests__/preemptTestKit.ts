/**
 * preemptTestKit.ts — M1/M2 调度单测共用夹具 (非 *.test.ts, 不被 test runner 执行)。
 *
 * TestScheduler: 桩掉 docker/script 启停 + 健康检查 + nvidia-smi 显存查询,
 * 只测 GpuScheduler 的调度状态机 (T0/T1/T2/dev-TTL/persona 闸门)。
 * 隔离前提: 本文件被测模块 import 前, 测试文件须先副作用 import
 * "./gpuSchedulerRoles.setup" (hermetic conf + nvidia-smi 桩)。
 */
import assert from "node:assert/strict";

import { GpuScheduler } from "../GpuScheduler";
import type { SchedulerTuningOpts } from "../GpuScheduler";
import type { ServiceProfile } from "../types";
import { MemoryStateStore } from "../memoryStateStore";

/** 可注入假钟起始值 (任意固定 epoch ms) */
export const CLOCK_START = 1_780_000_000_000;

export class TestScheduler extends GpuScheduler {
  /** nvidia-smi --query-gpu=memory.free 桩值 (逼/免 ensureVram 驱逐) */
  vramFree = 24_000;
  startCalls: string[] = [];
  stopCalls: string[] = [];

  constructor(opts?: SchedulerTuningOpts) {
    super(new MemoryStateStore(), opts);
  }

  protected override async executeStartStep(profile: ServiceProfile): Promise<void> {
    this.startCalls.push(profile.id);
  }

  protected override async executeStopStep(profile: ServiceProfile): Promise<void> {
    this.stopCalls.push(profile.id);
  }

  protected override async waitForHealthy(_profile: ServiceProfile, _maxMs?: number): Promise<boolean> {
    return true;
  }

  protected override async checkServiceAlive(_profile: ServiceProfile): Promise<boolean> {
    return true; // fast-path 存活探测桩 (免真网络调用)
  }

  override async getGpuVramFree(_gpuId: number): Promise<number> {
    return this.vramFree;
  }
}

/** 快照里取指定卡条目 */
export async function gpuEntry(sched: GpuScheduler, gpuIndex: number) {
  const snap = await sched.getSchedulingState();
  const g = snap.gpus.find((x) => x.gpuIndex === gpuIndex);
  assert.ok(g, `snapshot 应含 GPU${gpuIndex}`);
  return g;
}
