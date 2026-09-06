/**
 * breezeResident.test.ts — R5 常驻感知探测单测 (2026-09-06 GPU 加固)。
 *
 * 运行方式 (node:test + tsx, 同 GPU 系测试):
 *   node --import tsx --test src/routes/production/breezeTts/__tests__/breezeResident.test.ts
 *
 * 覆盖 probeBreezeResident 两分支 (注入 fetch 桩):
 *   - /health 200 + model_loaded:true → {modelLoaded:true} (路由层据此切增量预检)
 *   - 探针任何失败形态 (非 200 / 网络异常 / loading 中) → 一律 not loaded
 *     (fail-closed 满档, 绝不放行错增量)
 * 以及增量常量契约 (2560 < 满档 8192, 且为正数)。
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { probeBreezeResident } from "../_client";
import { BREEZE_TTS_RESIDENT_INCREMENT_MIB } from "../config";

/** 构造最小 Response 形桩 (probeBreezeResident 只消费 ok + json) */
function resp(ok: boolean, body?: unknown): typeof fetch {
  return (async () => ({
    ok,
    status: ok ? 200 : 503,
    json: async () => body,
  })) as unknown as typeof fetch;
}

const throwingFetch = (async () => {
  throw new Error("simulated probe timeout");
}) as unknown as typeof fetch;

describe("R5 probeBreezeResident — 权重驻留快探", () => {
  it("model_loaded:true → modelLoaded:true (增量预检信号)", async () => {
    const r = await probeBreezeResident(
      resp(true, { status: "ok", model_loaded: true, loading: false, engine: "breeze-tts-2" }),
    );
    assert.deepEqual(r, { modelLoaded: true, loading: false });
  });

  it("model_loaded:false (TTL 已自卸/未加载) → not loaded (走满档)", async () => {
    const r = await probeBreezeResident(
      resp(true, { status: "ok", model_loaded: false, loading: false, ttl_sec: 600.0 }),
    );
    assert.deepEqual(r, { modelLoaded: false, loading: false });
  });

  it("loading:true (加载中未驻留完成) → not loaded (走满档)", async () => {
    const r = await probeBreezeResident(
      resp(true, { status: "ok", model_loaded: false, loading: true }),
    );
    assert.deepEqual(r, { modelLoaded: false, loading: true });
  });

  it("探针非 200 → not loaded (fail-closed)", async () => {
    const r = await probeBreezeResident(resp(false, { status: "error" }));
    assert.deepEqual(r, { modelLoaded: false, loading: false });
  });

  it("探针网络异常/超时 → not loaded, 不抛 (fail-closed)", async () => {
    const r = await probeBreezeResident(throwingFetch);
    assert.deepEqual(r, { modelLoaded: false, loading: false });
  });
});

describe("R5 增量常量契约 — BREEZE_TTS_RESIDENT_INCREMENT_MIB", () => {
  it("2560MiB: 合成峰值增量+余量, 严格小于满档 8192", async () => {
    assert.equal(BREEZE_TTS_RESIDENT_INCREMENT_MIB, 2560);
    assert.ok(BREEZE_TTS_RESIDENT_INCREMENT_MIB > 0);
    assert.ok(BREEZE_TTS_RESIDENT_INCREMENT_MIB < 8192,
      "增量档必须小于 ENGINE_VRAM_REQUIREMENTS.breeze_tts 满档, 否则失去意义");
  });
});
