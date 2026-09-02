/**
 * ComfyUI 连接常量 —— 共享基础设施 (非 LTX 专属)。
 *
 * 2026-09-02 LTX 视频链路退役后, 原 ltx/config.ts 的 ComfyUI 连接三字段
 * (comfyuiUrl/pollIntervalMs/pollTimeoutMs) 提升到此共享 lib, 供 comfyuiPoll.ts
 * 等通用设施消费; ltx/config.ts 保留同名字段(取自本常量)做向后兼容。
 *
 * ⚠️ env 回退链保持历史形态 (LTX_COMFYUI_URL 在前) —— 既有部署可能仍设该变量, 不可换名。
 */
export const COMFYUI_CONN = {
  comfyuiUrl: process.env.LTX_COMFYUI_URL || process.env.COMFYUI_URL || "http://localhost:8188",
  pollIntervalMs: 2000,
  pollTimeoutMs: 600_000, // 10 min
};
