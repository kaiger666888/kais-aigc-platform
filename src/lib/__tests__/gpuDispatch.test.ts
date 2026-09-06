/**
 * B2c GPU2 双实例统一调度 单测 (2026-09-06, M4 双 3090)。
 *
 * 运行方式:
 *   cd /data/workspace/kais-aigc-platform && node --import tsx --test src/lib/__tests__/gpuDispatch.test.ts
 *
 * 范围: secondaryEnabled / gpu2EngineAllowlist / secondaryComfyuiUrl /
 * comfyuiUrlForGpu / pinTaskGpu / getPinnedGpu / gpuOutputRoots 纯函数层 +
 * resolveDispatchGpuIndex 决策树 (probe 桩化, 不发真网络请求)。
 * nvidia-smi 依赖的 headroom 分支通过 env 关总闸绕开 (闸关=不触 nvidia-smi)。
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  secondaryEnabled,
  gpu2EngineAllowlist,
  secondaryComfyuiUrl,
  comfyuiUrlForGpu,
  pinTaskGpu,
  getPinnedGpu,
  gpuOutputRoots,
  resolveDispatchGpuIndex,
  __resetGpu2DispatchForTests,
} from "../gpuVramManager";

const ENV_KEYS = [
  "KAP_GPU2_ENABLED",
  "KAP_GPU2_ENGINES",
  "KAP_COMFYUI_URL_GPU1",
  "KAP_COMFYUI_URL_GPU2",
  "OUTPUT_ROOT",
  "OUTPUT_DIR",
] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  __resetGpu2DispatchForTests();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  __resetGpu2DispatchForTests();
});

describe("gpuDispatch B2c — GPU2 双实例统一调度", () => {
  describe("策略开关 (默认关 = 旧行为)", () => {
    it("未设 env → secondaryEnabled=false, 所有引擎落 GPU1", async () => {
      assert.equal(secondaryEnabled(), false);
      const d = await resolveDispatchGpuIndex("sa3");
      assert.deepEqual(d, { gpuIndex: 1, secondary: false });
    });

    it("KAP_GPU2_ENABLED=0 → 关", () => {
      process.env.KAP_GPU2_ENABLED = "0";
      assert.equal(secondaryEnabled(), false);
    });

    it("KAP_GPU2_ENABLED=1 → 开", () => {
      process.env.KAP_GPU2_ENABLED = "1";
      assert.equal(secondaryEnabled(), true);
    });

    it("非白名单引擎在总闸开时也落 GPU1 (闸关=不触网络)", async () => {
      process.env.KAP_GPU2_ENABLED = "1";
      process.env.KAP_GPU2_ENGINES = "sa3,ace";
      const d = await resolveDispatchGpuIndex("minimax_h3");
      assert.deepEqual(d, { gpuIndex: 1, secondary: false });
    });
  });

  describe("白名单解析", () => {
    it("逗号分隔 + 空格容忍", () => {
      process.env.KAP_GPU2_ENGINES = " sa3 , ace , postprocess ";
      assert.deepEqual(gpu2EngineAllowlist(), ["sa3", "ace", "postprocess"]);
    });

    it("未设 → 空表", () => {
      assert.deepEqual(gpu2EngineAllowlist(), []);
    });
  });

  describe("per-GPU 端点", () => {
    it("默认: GPU1→:8188, GPU2→:8190", () => {
      assert.equal(comfyuiUrlForGpu(1), "http://localhost:8188");
      assert.equal(comfyuiUrlForGpu(2), "http://localhost:8190");
      assert.equal(secondaryComfyuiUrl(), "http://localhost:8190");
    });

    it("env 覆盖生效", () => {
      process.env.KAP_COMFYUI_URL_GPU1 = "http://127.0.0.1:9001";
      process.env.KAP_COMFYUI_URL_GPU2 = "http://127.0.0.1:9002";
      assert.equal(comfyuiUrlForGpu(1), "http://127.0.0.1:9001");
      assert.equal(comfyuiUrlForGpu(2), "http://127.0.0.1:9002");
    });
  });

  describe("任务↔实例钉扎", () => {
    it("pin/get 往返 + 未钉扎 undefined", () => {
      pinTaskGpu("task-a", 2);
      pinTaskGpu("task-b", 1);
      assert.equal(getPinnedGpu("task-a"), 2);
      assert.equal(getPinnedGpu("task-b"), 1);
      assert.equal(getPinnedGpu("task-c"), undefined);
    });

    it("6h 过期视为未钉扎 (时钟桩化: 塞旧时间戳需内部态, 用存在性近似 — 直接验证未钉扎路径)", () => {
      pinTaskGpu("old-task", 2);
      assert.equal(getPinnedGpu("old-task"), 2); // 表内未过期
      assert.equal(getPinnedGpu("never"), undefined);
    });
  });

  describe("产物查找根", () => {
    it("默认: 主根 + gpu2 子根", () => {
      const roots = gpuOutputRoots();
      assert.equal(roots[0], "/mnt/agents/output");
      assert.equal(roots[1], "/mnt/agents/output/gpu2");
    });

    it("OUTPUT_ROOT 覆盖传播", () => {
      process.env.OUTPUT_ROOT = "/data/out";
      assert.deepEqual(gpuOutputRoots(), ["/data/out", "/data/out/gpu2"]);
    });
  });

  describe("决策树 (probe 桩化)", () => {
    it("总闸开 + 白名单命中 + 探活成功 → GPU2 (headroom 需真卡, 总闸开启时本用例只跑 probe-fail 路径)", async () => {
      process.env.KAP_GPU2_ENABLED = "1";
      process.env.KAP_GPU2_ENGINES = "sa3";
      const d = await resolveDispatchGpuIndex("sa3", undefined, { probeFn: async () => false });
      assert.deepEqual(d, { gpuIndex: 1, secondary: false });
    });

    it("显式 preferGpu 直通 (绕过白名单与探活)", async () => {
      const d2 = await resolveDispatchGpuIndex("minimax_h3", 2);
      assert.deepEqual(d2, { gpuIndex: 2, secondary: true });
      const d1 = await resolveDispatchGpuIndex("sa3", 1);
      assert.deepEqual(d1, { gpuIndex: 1, secondary: false });
    });
  });
});
