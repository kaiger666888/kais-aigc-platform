/**
 * B2a 桌面卡空闲地板 单测 (2026-09-06)。
 *
 * 运行方式:
 *   cd /data/workspace/kais-aigc-platform && node --import tsx --test src/lib/__tests__/gpuVramFloor.test.ts
 *
 * 范围: gpuFloorMib / parseFloorEnv 纯函数层 (默认表 + env 解析 + 合并语义)。
 * ensureVram 的三处接线 (放行判定/驱逐复查/抛错上报) 由 build + grep 审验兜底 —
 * nvidia-smi 依赖不可在本文件桩化 (无 DI), 与既有 gpuVramManager.test.ts 同一
 * 隔离策略 (不触碰真卡)。
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { gpuFloorMib, GPU_VRAM_FLOOR_MIB_DEFAULT } from "../gpuVramManager";

const ENV_KEY = "KAP_VRAM_FLOOR_MIB";
let savedEnv: string | undefined;

beforeEach(() => {
  savedEnv = process.env[ENV_KEY];
  delete process.env[ENV_KEY];
});

afterEach(() => {
  if (savedEnv === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = savedEnv;
});

describe("gpuVramManager B2a — 桌面卡空闲地板", () => {
  it("默认表: 仅 GPU0=1792, GPU1/GPU2/未知卡 = 0 (行为零变化)", () => {
    assert.equal(gpuFloorMib(0), 1792);
    assert.equal(gpuFloorMib(1), 0);
    assert.equal(gpuFloorMib(2), 0);
    assert.equal(gpuFloorMib(99), 0);
    assert.deepEqual(GPU_VRAM_FLOOR_MIB_DEFAULT, { 0: 1792 });
  });

  it("env 覆盖列出的卡, 未列出的卡回落内置默认 (合并语义)", () => {
    process.env[ENV_KEY] = "2:2048";
    assert.equal(gpuFloorMib(2), 2048);
    assert.equal(gpuFloorMib(0), 1792); // 未列出 → 默认
    assert.equal(gpuFloorMib(1), 0);
  });

  it("env 显式 0 可关掉某卡地板 (逃生口)", () => {
    process.env[ENV_KEY] = "0:0,1:500";
    assert.equal(gpuFloorMib(0), 0);
    assert.equal(gpuFloorMib(1), 500);
  });

  it("env 空串 = 全部无地板 (逃生口)", () => {
    process.env[ENV_KEY] = "";
    assert.equal(gpuFloorMib(0), 0);
    assert.equal(gpuFloorMib(1), 0);
  });

  it("env 全非法项 = 忽略, 回落默认", () => {
    process.env[ENV_KEY] = "abc,0:,0:x,  ,gpu0:1";
    assert.equal(gpuFloorMib(0), 1792);
    assert.equal(gpuFloorMib(1), 0);
  });

  it("env 混合合法+非法: 合法项生效", () => {
    process.env[ENV_KEY] = "junk,0:1024";
    assert.equal(gpuFloorMib(0), 1024);
  });

  it("env 负数/超大值: 负数非法被忽略, 超大值放行 (调用方自担)", () => {
    process.env[ENV_KEY] = "0:-5";
    assert.equal(gpuFloorMib(0), 1792); // -5 不匹配 ^\d+$ → 非法 → 回落默认
    process.env[ENV_KEY] = "0:999999";
    assert.equal(gpuFloorMib(0), 999999); // 语义上=结构性永不放行, 允许显式表达
  });
});
