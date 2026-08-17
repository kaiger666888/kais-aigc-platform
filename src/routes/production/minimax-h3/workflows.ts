/**
 * MiniMax H3 — 能力清单 API (2026-08-17 API 精简新增)
 *
 * GET /api/production/minimax-h3/workflows
 *
 * 返回当前暴露的工作流档位 (白名单内容, 见 config.ts H3_EXPOSED_*):
 *   - useCase 入口两档 (preview-lock 动态路由 / final-shot 成片)
 *   - profile 两档 (turbo / native-sage)
 *   - 分辨率预设表 + token 预算线
 * 供 KMC / 前端程序化发现可用工作流; 未列入白名单的档位一律 400 拒绝。
 */

import express from "express";
import { success } from "@/lib/responseFormat";
import {
  H3_PROFILES,
  H3_USE_CASES,
  H3_EXPOSED_PROFILES,
  H3_EXPOSED_USE_CASES,
  H3_PREVIEW_MOTION_ROUTES,
  H3_RESOLUTION_TABLE,
  H3_TOKEN_BUDGET_SAFE,
  H3_TOKEN_BUDGET_CRASH,
  type H3UseCasePreset,
} from "./config";

const router = express.Router();

router.get("/", (_req, res) => {
  res.status(200).send(
    success({
      useCases: H3_EXPOSED_USE_CASES.map((id) => {
        const preset: H3UseCasePreset = H3_USE_CASES[id];
        return {
          id,
          label: preset.label,
          mode: preset.mode,
          motion: preset.motion,
          audioMix: preset.audioMix,
          steps: preset.steps,
          audio: preset.audio,
          // 预览档动态路由 (仅 preview-lock): motion → profile/steps
          motionRoutes: id === "preview-lock"
            ? Object.entries(H3_PREVIEW_MOTION_ROUTES).map(([motion, route]) => ({
              motion,
              profile: route.profile,
              steps: route.steps,
            }))
            : undefined,
        };
      }),
      profiles: H3_EXPOSED_PROFILES.map((id) => ({
        id,
        ...H3_PROFILES[id],
      })),
      resolutions: H3_RESOLUTION_TABLE,
      tokenBudget: {
        safeLine: H3_TOKEN_BUDGET_SAFE,
        crashLine: H3_TOKEN_BUDGET_CRASH,
        note: "tokens = width×height×length; >crashLine 400 拒绝, >safeLine 日志警告放行",
      },
      // 预留档位 (未暴露, POST 传它们会 400)
      reserved: [
        "final-motion — 连续 motion 专用工作流 (P09 分镜 camera_continuity/首尾帧链已有数据基础, 待设计)",
      ],
      notes: [
        "POST /generate 接受 useCase (推荐) 或显式 profile; 白名单外的 profile/useCase 一律 400",
        "preview-lock 音频为 tts-only: 跳过 LTX Foley, TTS 对白与 H3 原生音轨混音",
        "final-shot 音频为 full: LTX Foley 环境音 + TTS 混音 (audioMix 默认 balanced)",
      ],
    }),
  );
});

export default router;
