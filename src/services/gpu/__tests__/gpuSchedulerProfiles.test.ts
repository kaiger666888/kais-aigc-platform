/**
 * GpuScheduler 服务注册表单测 — qwen-vllm 档位收编 (2026-08-29)。
 *
 * 运行方式 (仿 src/lib/__tests__/gpuVramManager.test.ts, node:test + tsx):
 *   cd /data/workspace/kais-aigc-platform && node --import tsx --test src/services/gpu/__tests__/gpuSchedulerProfiles.test.ts
 *
 * 隔离策略: getRegisteredServices() 是纯函数, 只断言注册表形态,
 * 不触发任何 docker / 健康检查网络调用。(2026-09-01 双3090 角色化后, 模块加载时
 * GPU_DEVICES 快照会经 gpuRoles 探测一次 nvidia-smi — 失败静默回退硬编码, 无断言影响。)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getRegisteredServices } from "../GpuScheduler";
import type { ServiceProfile } from "../types";

/** start 可能是数组形态 (本项目现有 8 个 profile 均为单对象) */
function firstStart(s: ServiceProfile) {
  return Array.isArray(s.start) ? s.start[0] : s.start;
}
function firstStop(s: ServiceProfile) {
  return s.stop === undefined ? undefined : Array.isArray(s.stop) ? s.stop[0] : s.stop;
}

describe("GpuScheduler 服务注册表 — qwen-vllm 收编 (GPU1 让路纪律)", () => {
  const services = getRegisteredServices();
  const byId = new Map(services.map((s) => [s.id, s]));

  it("既有 7 个 profile 的 id 集合不被破坏 (收编后共 8 个)", () => {
    assert.deepEqual(
      services.map((s) => s.id).sort(),
      [
        "chatterbox",
        "comfyui-auxiliary",
        "comfyui-primary",
        "cosyvoice",
        "lora-trainer",
        "qwen-ear",
        "qwen-llm",
        "qwen-vllm",
      ],
    );
  });

  it("qwen-vllm 档位注册且字段值正确 (gpu1 / 17500MB / priority 2 / :18020)", () => {
    const p = byId.get("qwen-vllm");
    assert.ok(p, "qwen-vllm 应已注册");
    assert.equal(p.name, "Qwen3.8-27B vLLM (Huihui-Abliterated W4A16, batch)");
    assert.equal(p.gpuId, 1);
    assert.equal(p.vramEstMb, 17_500);
    assert.equal(p.priority, 2); // 与 qwen-llm/qwen-ear 同级
    assert.equal(p.category, "llm");
    assert.equal(p.healthUrl, "http://127.0.0.1:18020/health");
    assert.equal(p.healthTimeoutMs, 960_000); // vllm 首次 requantize+compile 5-15min
    assert.equal(p.idleTimeoutMs, 30 * 60 * 1000);

    const start = firstStart(p);
    assert.ok(start && start.type === "script", "start 应为 script 形态");
    if (start.type === "script") {
      assert.equal(start.command, "bash");
      assert.equal(start.args[0], "/opt/qwen-llm/kap-llm.sh");
      assert.ok(start.args.includes("vllm-huihui"), "start.args 应含 vllm-huihui 档位");
      assert.deepEqual(start.args.slice(-2), ["start", "vllm-huihui"]);
      assert.equal(start.timeoutMs, 1_200_000); // 覆盖脚本内 950s deadline + 余量
    }

    const stop = firstStop(p);
    assert.ok(stop && stop.type === "script", "stop 应为 script 形态");
    if (stop.type === "script") {
      // stop 是共享子命令: 脚本内按容器/进程存在性双形态幂等分派
      assert.deepEqual(stop.args, ["/opt/qwen-llm/kap-llm.sh", "stop"]);
      assert.equal(stop.timeoutMs, 120_000);
    }
  });

  it("既有 profile 字段值不被扰动 (抽查 qwen-llm / qwen-ear 关键值)", () => {
    const qwenLlm = byId.get("qwen-llm");
    assert.ok(qwenLlm);
    assert.equal(qwenLlm.gpuId, 1);
    assert.equal(qwenLlm.vramEstMb, 20_500);
    assert.equal(qwenLlm.priority, 2);
    assert.equal(qwenLlm.healthUrl, "http://127.0.0.1:8125/health");
    const qwenLlmStart = firstStart(qwenLlm);
    assert.ok(qwenLlmStart.type === "script");
    assert.deepEqual(qwenLlmStart.args.slice(-2), ["start", "q4"], "qwen-llm 仍指 q4 档");

    const qwenEar = byId.get("qwen-ear");
    assert.ok(qwenEar);
    assert.equal(qwenEar.gpuId, 1);
    assert.equal(qwenEar.vramEstMb, 21_500);
    assert.equal(qwenEar.priority, 2);
    assert.equal(qwenEar.healthUrl, "http://127.0.0.1:8126/health");

    const comfy = byId.get("comfyui-primary");
    assert.ok(comfy);
    assert.equal(comfy.idleTimeoutMs, 0, "comfyui-primary 常驻语义不变");
  });
});
