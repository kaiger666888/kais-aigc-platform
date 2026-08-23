/**
 * Phase 39 (v1.8) — gold-team 引擎适配层。
 *
 * 封装 task 提交/轮询的 HTTP 调用。所有 canvas 路由通过这层访问引擎,
 * 保持 simulate/storyboardPreview 的引擎调用一致。
 *
 * 配置:
 *   - GOLD_TEAM_URL (必需;未配置时调用方应降级到模拟)
 *   - ENGINE_TIMEOUT_MS=120000 (单次请求超时,默认 120s)
 *   - ENGINE_POLL_INTERVAL_MS=3000 (轮询间隔,默认 3s)
 *   - ENGINE_POLL_MAX_ATTEMPTS=200 (最大轮询次数,默认 200 = 10 分钟)
 */

import fs from "node:fs";
import path from "node:path";
import { fsToOssUrl } from "./v2/import-from-dir";

export type TaskType =
  | "image_draw"
  | "image_refine"
  | "image_draw_ipadapter"
  | "image_pulid"
  | "video_final"
  | "video_preview"
  | "tts"
  | "tts_zh"
  | "tts_en"
  | "tts_bilingual"
  | "music"
  | "sfx"
  | "upscale"
  | "face_restore"
  | "controlnet_depth";

export interface EngineTaskSubmitInput {
  taskType: TaskType;
  prompt: string;
  projectId: number;
  episodesId: number;
  nodeId: string;
  referenceImages?: string[];
  metadata?: Record<string, unknown>;
  callbackUrl?: string;
}

export interface EngineTaskResult {
  taskId: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  outputUrl: string | null;
  raw: Record<string, any>;
}

const ENGINE_TIMEOUT = Number(process.env.ENGINE_TIMEOUT_MS ?? 120_000);
const POLL_INTERVAL = Number(process.env.ENGINE_POLL_INTERVAL_MS ?? 3_000);
const POLL_MAX_ATTEMPTS = Number(process.env.ENGINE_POLL_MAX_ATTEMPTS ?? 200);

function baseUrl(): string {
  const url = process.env.GOLD_TEAM_URL;
  if (!url) throw new Error("GOLD_TEAM_URL not configured");
  return url.replace(/\/$/, "");
}

/**
 * 59-01 断点④入向翻译:把客户端可影响的 `/oss/...` web 路径与既有宿主路径,
 * 翻译为引擎容器可见的宿主绝对路径。
 *
 * 语义(T-59-01 缓解):
 *   - 空 / 非 string → null
 *   - `/oss/...` → posix.normalize + 拒绝 `..` 上溯(replaceUrl.ts L14-21 先例)
 *     + 双根白名单 fs.existsSync 探测——引擎容器 Mounts 实证只挂
 *     `/mnt/agents/output` 与 `/data/workspace/kais-aigc-platform/data/oss`
 *     两个根(与 fsToOssUrl 的 ossDir 字面量一致,Pitfall 3);命中者返回,
 *     均不命中 → null。非白名单根不可达。
 *   - 其余输入(宿主绝对路径 / http(s) URL)原样返回——已是引擎可见形态
 *     (kmc 活体先例)。
 */
export function ossToEnginePath(input: string): string | null {
  if (!input || typeof input !== "string") return null;
  if (input.startsWith("/oss/")) {
    const rel = input.substring("/oss/".length);
    const normalized = path.posix.normalize(rel);
    // 防路径穿越:规范化后若以 ../ 开头或等于 ..,拒绝
    if (normalized === ".." || normalized.startsWith("../")) return null;
    const candidates = [
      `/mnt/agents/output/${normalized}`,
      `/data/workspace/kais-aigc-platform/data/oss/${normalized}`,
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
    return null;
  }
  return input;
}

/**
 * 提交任务到 gold-team。
 * 返回 task_id。如果 gold-team 不可用或拒绝,抛错。
 */
export async function submitEngineTask(
  input: EngineTaskSubmitInput,
): Promise<string> {
  const taskId = `canvas-${input.nodeId}-${Date.now()}`;
  const payload: Record<string, any> = {
    task_id: taskId,
    type: input.taskType,
    priority: "normal",
    params: {
      projectId: input.projectId,
      episodesId: input.episodesId,
      nodeId: input.nodeId,
      prompt: input.prompt,
      ...(input.referenceImages?.length
        ? { reference_images: input.referenceImages }
        : {}),
      ...input.metadata,
    },
  };
  if (input.callbackUrl) payload.callback_url = input.callbackUrl;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ENGINE_TIMEOUT);
  try {
    const resp = await fetch(`${baseUrl()}/api/v1/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(
        `gold-team POST /api/v1/tasks returned ${resp.status}: ${text.slice(0, 200)}`,
      );
    }
    // 202 Accepted;task_id 应在响应或 payload 里
    const raw = await resp.json().catch(() => ({}));
    return raw.task_id ?? raw.taskId ?? taskId;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 轮询任务状态直到 completed/failed/cancelled。
 * 失败时抛错;成功返回 outputUrl + raw。
 */
export async function pollEngineTask(taskId: string): Promise<EngineTaskResult> {
  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ENGINE_TIMEOUT);
    try {
      const resp = await fetch(
        `${baseUrl()}/api/v1/tasks/${encodeURIComponent(taskId)}`,
        {
          method: "GET",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
        },
      );
      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        throw new Error(
          `gold-team GET /api/v1/tasks/${taskId} returned ${resp.status}: ${text.slice(0, 200)}`,
        );
      }
      const raw = (await resp.json()) as Record<string, any>;
      const status = String(raw.status ?? raw.state ?? "running");
      if (status === "completed") {
        const outputUrl =
          raw.output_url ??
          raw.outputUrl ??
          raw.result?.output_url ??
          raw.result?.url ??
          raw.result?.image_url ??
          null;
        return { taskId, status: "completed", outputUrl, raw };
      }
      if (status === "failed" || status === "cancelled") {
        throw new Error(
          `gold-team task ${taskId} ${status}: ${JSON.stringify(raw.error ?? raw).slice(0, 200)}`,
        );
      }
    } finally {
      clearTimeout(timer);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL));
  }
  throw new Error(
    `gold-team task ${taskId} polling timed out after ${POLL_MAX_ATTEMPTS} attempts`,
  );
}

/**
 * 探测 gold-team 是否可用。返回 true 表示引擎就绪。
 */
export async function probeEngine(): Promise<boolean> {
  if (!process.env.GOLD_TEAM_URL) return false;
  try {
    const resp = await fetch(`${baseUrl()}/health`, {
      method: "GET",
      signal: AbortSignal.timeout(5_000),
    });
    return resp.ok;
  } catch {
    return false;
  }
}
