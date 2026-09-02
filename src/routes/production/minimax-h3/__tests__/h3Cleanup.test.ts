/**
 * h3Cleanup.test.ts — LTX 视频路由退役 + H3 turbo 白名单清理 回归测试 (2026-09-02)。
 *
 * 运行方式 (仓库无 vitest, 仿 gpuRoles.test.ts, node:test + tsx):
 *   node --import tsx --test src/routes/production/minimax-h3/__tests__/h3Cleanup.test.ts
 *
 * 覆盖 (工单 laneA FIX-1~FIX-4):
 *   ① router.ts 不再挂载 8 个 LTX 视频路由 (源码契约: 无 import 无 app.use → 请求 404)
 *   ② 8 个 ltx 视频路由文件已从磁盘删除 (ltx/ 仅剩 config.ts)
 *   ③ ltx/config.ts 保留: LTX_CONFIG 连接字段与 COMFYUI_CONN 同源 (comfyuiPoll 兼容)
 *   ④ comfyuiPoll.ts 已解耦, 从 @/lib/comfyui-conn 取常量 (不再 import ltx/config)
 *   ⑤ H3_EXPOSED_PROFILES 不含 turbo, 含 native-sage / lightx2v-8-768p
 *   ⑥ preview-lock useCase 解析 profile=lightx2v-8-768p, 且与 H3_PREVIEW_MOTION_ROUTES 三档一致
 *   ⑦ generate.ts 无 profile/useCase 的 fallback 不再指向已退役 turbo (白名单残留防回归)
 *
 * 隔离: 只 import 纯常量模块 (config/comfyui-conn) + 源码文本断言, 零 DB / 零网络。
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";

import {
  H3_EXPOSED_PROFILES,
  H3_EXPOSED_USE_CASES,
  H3_PREVIEW_MOTION_ROUTES,
  H3_PROFILES,
  H3_USE_CASES,
} from "../config";
import { COMFYUI_CONN } from "../../../../lib/comfyui-conn";
import { LTX_CONFIG } from "../../ltx/config";

const SRC_ROOT = path.join(__dirname, "..", "..", "..", "..", "..", "src");
const RETIRED_LTX_ROUTES = [
  "msr",
  "trim",
  "extension",
  "fflf",
  "poseVideo",
  "promptRelayI2V",
  "singularityFFLF",
  "twoStageAudioI2V",
] as const;

describe("LTX 视频路由退役 (FIX-1)", () => {
  it("router.ts 无 8 个已删路由的 import 与 app.use 挂载 (不挂载 → 请求落 404)", () => {
    const routerSrc = fs.readFileSync(path.join(SRC_ROOT, "router.ts"), "utf8");
    for (const name of RETIRED_LTX_ROUTES) {
      assert.ok(
        !routerSrc.includes(`routes/production/ltx/${name}"`),
        `router.ts 仍 import ltx/${name}`,
      );
      assert.ok(
        !routerSrc.includes(`/api/production/ltx/${name}"`),
        `router.ts 仍挂载 /api/production/ltx/${name}`,
      );
    }
    // 整个 ltx 命名空间在 router.ts 里不应再有任何挂载
    assert.ok(!routerSrc.includes(`/api/production/ltx/`), "router.ts 仍残留 /api/production/ltx/ 挂载");
  });

  it("8 个 ltx 视频路由文件已删除, ltx/ 目录仅剩 config.ts", () => {
    for (const name of RETIRED_LTX_ROUTES) {
      const p = path.join(SRC_ROOT, "routes", "production", "ltx", `${name}.ts`);
      assert.equal(fs.existsSync(p), false, `ltx/${name}.ts 应已删除`);
    }
    const remaining = fs
      .readdirSync(path.join(SRC_ROOT, "routes", "production", "ltx"))
      .filter((f) => f.endsWith(".ts"));
    assert.deepEqual(remaining, ["config.ts"]);
  });
});

describe("ltx/config.ts 保留 + comfyuiPoll 解耦 (FIX-2)", () => {
  it("LTX_CONFIG 连接三字段与 COMFYUI_CONN 同源 (值不漂移)", () => {
    assert.equal(LTX_CONFIG.comfyuiUrl, COMFYUI_CONN.comfyuiUrl);
    assert.equal(LTX_CONFIG.pollIntervalMs, COMFYUI_CONN.pollIntervalMs);
    assert.equal(LTX_CONFIG.pollTimeoutMs, COMFYUI_CONN.pollTimeoutMs);
    // 历史回退链契约: LTX_COMFYUI_URL 优先, 其次 COMFYUI_URL, 兜底 localhost:8188
    const expectUrl =
      process.env.LTX_COMFYUI_URL || process.env.COMFYUI_URL || "http://localhost:8188";
    assert.equal(COMFYUI_CONN.comfyuiUrl, expectUrl);
    assert.equal(COMFYUI_CONN.pollIntervalMs, 2000);
    assert.equal(COMFYUI_CONN.pollTimeoutMs, 600_000);
  });

  it("comfyuiPoll.ts 已改为从 @/lib/comfyui-conn 取常量", () => {
    const src = fs.readFileSync(path.join(SRC_ROOT, "lib", "comfyuiPoll.ts"), "utf8");
    assert.ok(src.includes(`from "@/lib/comfyui-conn"`), "comfyuiPoll 应 import comfyui-conn");
    assert.ok(!src.includes("ltx/config"), "comfyuiPoll 不应再依赖 ltx/config");
  });
});

describe("H3 turbo 白名单退役 (FIX-3)", () => {
  it("H3_EXPOSED_PROFILES 不含 turbo, 恰为 native-sage + lightx2v-8-768p", () => {
    assert.ok(!H3_EXPOSED_PROFILES.includes("turbo"), "turbo 不应再在暴露白名单");
    assert.deepEqual([...H3_EXPOSED_PROFILES].sort(), ["lightx2v-8-768p", "native-sage"]);
    // 白名单每项都必须在 H3_PROFILES 有定义 (GET /workflows 能力清单依赖)
    for (const id of H3_EXPOSED_PROFILES) {
      assert.ok(H3_PROFILES[id], `白名单 profile ${id} 缺 H3_PROFILES 定义`);
    }
  });

  it("preview-lock useCase 解析 profile=lightx2v-8-768p, 与 motion 路由三档一致 (9 步)", () => {
    assert.equal(H3_USE_CASES["preview-lock"].profile, "lightx2v-8-768p");
    for (const [motion, route] of Object.entries(H3_PREVIEW_MOTION_ROUTES)) {
      assert.equal(route.profile, "lightx2v-8-768p", `motion=${motion} 应走 lightx2v-8-768p`);
      assert.equal(route.steps, 9, `motion=${motion} 应 9 步`);
    }
    // 暴露的 useCase 白名单不变
    assert.deepEqual([...H3_EXPOSED_USE_CASES].sort(), ["final-shot", "preview-lock"]);
  });

  it("generate.ts 无 profile/useCase 的 fallback 不再指向已退役 turbo (白名单残留防回归)", () => {
    const src = fs.readFileSync(
      path.join(SRC_ROOT, "routes", "production", "minimax-h3", "generate.ts"),
      "utf8",
    );
    assert.ok(!src.includes('      "turbo"\n    ).toLowerCase()'), "generate.ts fallback 仍为 turbo");
    assert.ok(
      src.includes('      "lightx2v-8-768p"\n    ).toLowerCase()'),
      "generate.ts fallback 应为 lightx2v-8-768p",
    );
  });

  it("H3_TURBO/getTurboSteps 保留 (显式 turbo=true 直调契约不变)", () => {
    // 配置真源保留在 config.ts; blockCache.test.ts T5/T6④ 已覆盖工作流行为
    const src = fs.readFileSync(
      path.join(SRC_ROOT, "routes", "production", "minimax-h3", "config.ts"),
      "utf8",
    );
    assert.ok(src.includes("export const H3_TURBO"), "H3_TURBO 应保留");
    assert.ok(src.includes("export function getTurboSteps"), "getTurboSteps 应保留");
  });
});
