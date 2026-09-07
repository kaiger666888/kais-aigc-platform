/**
 * B2c host-mem 预检地板 单测 (2026-09-07)。
 * 运行: cd /data/workspace/kais-aigc-platform && node --import tsx --test src/lib/__tests__/hostMemFloor.test.ts
 * 范围: hostMemFloorMib / parseMemAvailableMib 纯函数层 (默认值 + env + 解析鲁棒性)。
 * ensureVram 内闸接线由 build + 真实 /proc/meminfo 冒烟兜底 (与 gpuVramFloor.test.ts 同一隔离策略)。
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { hostMemFloorMib, parseMemAvailableMib } from "../gpuVramManager";

const ENV_KEY = "KAP_HOSTMEM_FLOOR_MIB";
let savedEnv: string | undefined;

beforeEach(() => {
  savedEnv = process.env[ENV_KEY];
  delete process.env[ENV_KEY];
});
afterEach(() => {
  if (savedEnv === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = savedEnv;
});

describe("gpuVramManager B2c — host-mem 地板", () => {
  it("默认 16384 MiB (16G); env 合法值覆盖; 非法回落默认", () => {
    assert.equal(hostMemFloorMib(), 16384);
    process.env[ENV_KEY] = "8192";
    assert.equal(hostMemFloorMib(), 8192);
    process.env[ENV_KEY] = "0";
    assert.equal(hostMemFloorMib(), 0); // 逃生口
    process.env[ENV_KEY] = "abc";
    assert.equal(hostMemFloorMib(), 16384);
    process.env[ENV_KEY] = "-5";
    assert.equal(hostMemFloorMib(), 16384);
  });

  it("parseMemAvailableMib: 标准行 / 真实格式 / 缺行 / 非法", () => {
    const real = "MemTotal:       131775372 kB\nMemFree:        20148796 kB\nMemAvailable:   85057220 kB\nBuffers:         1234567 kB\n";
    assert.equal(parseMemAvailableMib(real), 83063); // 85057220/1024 floor
    assert.equal(parseMemAvailableMib("MemTotal: 1 kB\n"), null); // 缺行
    assert.equal(parseMemAvailableMib("MemAvailable:  abc kB\n"), null); // 非法
    assert.equal(parseMemAvailableMib(""), null);
  });
});
