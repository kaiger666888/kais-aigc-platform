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
 * 59-fix CR-01: 引擎 params 服务端保留键 — 这些键由 submitEngineTask 显式设置
 * (projectId/episodesId/nodeId/prompt/ref_images)或受平台政策约束
 * (model_preference:A3 服务端常量,非用户输入)。metadata(可携带客户端透传
 * params,_simulate.ts CLIENT_PARAM_KEYS 白名单后的余量)里的同名键在平铺进
 * payload.params 前剔除——纵深防御:即使白名单侧被绕过(未来新调用方直传),
 * 客户端也无法覆盖 ref_images 翻译白名单/model_preference 政策/身份键。
 */
const RESERVED_PARAM_KEYS = new Set([
  "ref_images", "model_preference", "prompt",
  "nodeId", "projectId", "episodesId", "nodeType", "originalNodeId",
]);

function scrubReservedParams(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(metadata ?? {})) {
    if (!RESERVED_PARAM_KEYS.has(k)) out[k] = v;
  }
  return out;
}

/**
 * 提交任务到 gold-team。
 * 返回 task_id。如果 gold-team 不可用或拒绝,抛错。
 */
export async function submitEngineTask(
  input: EngineTaskSubmitInput,
): Promise<string> {
  const taskId = `canvas-${input.nodeId}-${Date.now()}`;
  // 59-01 断点④:referenceImages 先经 ossToEnginePath 翻译(/oss/ web 路径 →
  // 引擎容器可见宿主路径;translate 失败返回 null 的项 filter 丢弃,不污染引擎)。
  const translatedRefs = (input.referenceImages ?? [])
    .map((r) => ossToEnginePath(r))
    .filter((r): r is string => r !== null);
  const payload: Record<string, any> = {
    task_id: taskId,
    type: input.taskType,
    priority: "normal",
    params: {
      projectId: input.projectId,
      episodesId: input.episodesId,
      nodeId: input.nodeId,
      prompt: input.prompt,
      // 59-01 断点④:引擎 v6 cloud 直通表键名 ref_images(executor.py:703-717),
      // 不是旧 reference_images;仅非空数组时展开。
      ...(translatedRefs.length > 0 ? { ref_images: translatedRefs } : {}),
      // 59-01 REGEN-02 seed 通道:调用方经 input.metadata 平铺即达 params.seed
      // (59-02 接线 reroll-seed 时直接生效);本地引擎读 params.seed,完成时
      // 写入 metadata.seed。cloud 路径 dreamina CLI 不接受 seed,seed 只落
      // metadata.seed,确定性重放仅本地 ComfyUI 路径成立(VERIFICATION 如实记录)。
      // 59-fix CR-01:metadata 先经 scrubReservedParams 剔除服务端保留键再平铺
      // ——上方服务端显式设置的 projectId/episodesId/nodeId/prompt/ref_images
      // 不可被覆盖,非 image 任务也不会被注入 model_preference。
      ...scrubReservedParams(input.metadata),
      // 59-01 A3 裁定:平台政策 2026-08-19 — image 任务(t2i 5.0 / i2i 4.6 白名单)
      // 走 :8002 gateway cloud-jimeng;model_preference 服务端常量非用户输入
      // (T-59-03 accept)。taskType 以 "image" 开头时平铺,video/tts 等不动。
      ...(input.taskType.startsWith("image") ? { model_preference: "cloud" } : {}),
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
        // 59-01 断点①:引擎活体形状(GET :8002/api/v1/tasks/{id} 两轮实证 +
        // docker/gold-team/src/v6/models/task.py:90-127)产物挂在 raw.outputs
        // 对象下,依序回退 image → video → audio → thumbnail;旧 output_url /
        // outputUrl 键保留兜底无害。
        const out = (raw.outputs ?? {}) as Record<string, unknown>;
        const containerPath =
          out.image ?? out.video ?? out.audio ?? out.thumbnail ??
          raw.output_url ?? raw.outputUrl ?? null;
        // 59-01 断点②:容器路径(/mnt/agents/output/...)经 fsToOssUrl 翻译为
        // /oss/ web 路径;http(s) CDN 直链原样透传;不可翻译 → null。
        const outputUrl =
          containerPath != null ? fsToOssUrl(String(containerPath)) : null;
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
