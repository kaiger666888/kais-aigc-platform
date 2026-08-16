/**
 * GPU 显存统一管理 (server 侧决策层) — 2026-08-16。
 *
 * 背景 (ep-wuxia-father-son-ep01 P10 事故):
 *   GPU1 (3090 24GB) 被多进程分占 (VD server ~4.4GB + ComfyUI 主进程 + 残留),
 *   各引擎显存互斥关系无人管 —— TTS(~6-12GB) / H3(~16-20GB) / VD / qwen-eye
 *   挤在一起就是 OOM 或 dynamic VRAM 频繁 offload 导致龟速 (TTS 实测 361-374s),
 *   任务进 ComfyUI 队列后饿死到 KAP 轮询超时, ComfyUI 侧实际完成但结果被丢弃。
 *
 * 本模块在 submitPrompt **之前**做显存预检:
 *   1. nvidia-smi 清点 free 显存 (5s 缓存)
 *   2. 不足 → POST ComfyUI /free 驱逐缓存模型 → 复查
 *   3. 仍不足 → fail-fast 抛 VramInsufficientError (结构化 vram_insufficient),
 *      不让它进队列盲等超时
 *
 * env 变量:
 *   KAP_VRAM_CACHE_MS        — nvidia-smi 结果缓存时长 (默认 5000ms)
 *   KAP_VRAM_FREE_TIMEOUT_MS — ComfyUI /free 请求超时 (默认 5000ms)
 *   KAP_VRAM_FREE_WAIT_MS    — /free 后等待显存回收时长 (默认 3000ms)
 *   KAP_VRAM_GPU_INDEX       — ensureVram 默认 GPU 索引 (默认 1)
 *   KAP_VRAM_SKIP            — "1" 跳过预检 (调试用)
 */

import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

// ─── B1. 显存清点 ────────────────────────────────────────────────────────────

export interface GpuStatus {
  index: number;
  name: string;
  totalMiB: number;
  usedMiB: number;
  freeMiB: number;
}

/** nvidia-smi 结果缓存 (避免高频调用; TTL env KAP_VRAM_CACHE_MS 默认 5s) */
const CACHE_TTL_MS = process.env.KAP_VRAM_CACHE_MS
  ? parseInt(process.env.KAP_VRAM_CACHE_MS, 10)
  : 5_000;

let cache: { at: number; gpus: GpuStatus[] } | null = null;

/**
 * 查询全部 GPU 显存状态 (nvidia-smi 单次查询, 5s 缓存)。
 * nvidia-smi 不可用时返回 [] (调用方 ensureVram 视为放行, 不阻塞业务)。
 */
export async function getGpuStatus(forceRefresh = false): Promise<GpuStatus[]> {
  if (!forceRefresh && cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.gpus;
  }
  try {
    const { stdout } = await execFileAsync("nvidia-smi", [
      "--query-gpu=index,name,memory.total,memory.used,memory.free",
      "--format=csv,noheader,nounits",
    ]);
    const gpus: GpuStatus[] = stdout
      .trim()
      .split("\n")
      .map((line) => line.split(",").map((s) => s.trim()))
      .filter((cols) => cols.length >= 5)
      .map((cols) => ({
        index: parseInt(cols[0], 10),
        name: cols[1],
        totalMiB: parseInt(cols[2], 10) || 0,
        usedMiB: parseInt(cols[3], 10) || 0,
        freeMiB: parseInt(cols[4], 10) || 0,
      }));
    cache = { at: Date.now(), gpus };
    return gpus;
  } catch {
    // 宿主机无 nvidia-smi / 驱动异常 — 缓存空结果避免每次调用都 spawn
    cache = { at: Date.now(), gpus: [] };
    return [];
  }
}

// ─── B2. 引擎显存需求表 (MiB) ───────────────────────────────────────────────

export const ENGINE_VRAM_REQUIREMENTS: Record<string, number> = {
  qwen_tts: 8192,    // Qwen3-TTS 1.7B bf16 (~5GB) + 推理峰值余量
  indextts2: 8192,   // IndexTTS-2 fp16 (~6GB) + 余量
  minimax_h3: 18432, // 18GB (int8 34GB 权重 dynamic VRAM 分段驻留 + VAE)
  flux2: 12288,
  qwen_eye: 14336,   // 14GB (与 vision 引擎预检阈值一致)
  default: 8192,
};

// ─── B3. 提交前预检 ─────────────────────────────────────────────────────────

/** 结构化显存不足错误 — 路由层捕获后以 vram_insufficient kind 返回给调用方 */
export class VramInsufficientError extends Error {
  readonly kind = "vram_insufficient" as const;
  readonly engine: string;
  readonly freeMiB: number;
  readonly requiredMiB: number;
  readonly gpuIndex: number;

  constructor(opts: {
    engine: string;
    freeMiB: number;
    requiredMiB: number;
    gpuIndex: number;
  }) {
    super(
      `vram_insufficient: engine=${opts.engine} needs ${opts.requiredMiB}MiB on GPU${opts.gpuIndex}, only ${opts.freeMiB}MiB free`,
    );
    this.name = "VramInsufficientError";
    this.engine = opts.engine;
    this.freeMiB = opts.freeMiB;
    this.requiredMiB = opts.requiredMiB;
    this.gpuIndex = opts.gpuIndex;
  }
}

/**
 * 请求 ComfyUI 驱逐缓存的模型权重 (可逆 — 下次任务会重新加载, 只是慢一点)。
 * POST {comfyuiUrl}/free {"unload_models": true, "free_memory": true}
 */
async function requestComfyuiFree(comfyuiUrl: string): Promise<boolean> {
  const timeoutMs = process.env.KAP_VRAM_FREE_TIMEOUT_MS
    ? parseInt(process.env.KAP_VRAM_FREE_TIMEOUT_MS, 10)
    : 5_000;
  try {
    const resp = await fetch(`${comfyuiUrl}/free`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ unload_models: true, free_memory: true }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

/**
 * submitPrompt 前的显存预检 (fail-fast, 不让任务进队列饿死到轮询超时)。
 *
 * 流程:
 *   1. getGpuStatus() → free >= required → 放行
 *   2. 不足 → POST {comfyuiUrl}/free 驱逐 ComfyUI 缓存 → 等待回收 → 复查
 *   3. 仍不足 → 抛 VramInsufficientError
 *
 * @param engineKey  ENGINE_VRAM_REQUIREMENTS 键 (未知键用 default 8GB)
 * @param gpuIndex   GPU 索引 (env KAP_VRAM_GPU_INDEX / 默认 1 — GPU1 是生成卡)
 * @param comfyuiUrl ComfyUI 基地址 (用于 /free 驱逐; 空串则跳过驱逐直接判)
 */
export async function ensureVram(
  engineKey: string,
  gpuIndex: number = process.env.KAP_VRAM_GPU_INDEX
    ? parseInt(process.env.KAP_VRAM_GPU_INDEX, 10)
    : 1,
  comfyuiUrl?: string,
): Promise<{ freeMiB: number; requiredMiB: number; evicted: boolean }> {
  const requiredMiB = ENGINE_VRAM_REQUIREMENTS[engineKey] ?? ENGINE_VRAM_REQUIREMENTS.default;

  // 调试逃生口: KAP_VRAM_SKIP=1 直接放行
  if (process.env.KAP_VRAM_SKIP === "1") {
    return { freeMiB: -1, requiredMiB, evicted: false };
  }

  const check = async (): Promise<GpuStatus | null> => {
    const gpus = await getGpuStatus();
    return gpus.find((g) => g.index === gpuIndex) || null;
  };

  let gpu = await check();
  // nvidia-smi 不可用 → 无法清点, 放行 (不因监控缺失阻塞业务)
  if (!gpu) {
    console.warn(`[gpuVramManager] nvidia-smi returned no GPU${gpuIndex}; skipping preflight for ${engineKey}`);
    return { freeMiB: -1, requiredMiB, evicted: false };
  }
  if (gpu.freeMiB >= requiredMiB) {
    console.log(`[gpuVramManager] ok ${engineKey}: need ${requiredMiB}MiB, GPU${gpuIndex} free ${gpu.freeMiB}MiB`);
    return { freeMiB: gpu.freeMiB, requiredMiB, evicted: false };
  }

  // 不足 → 驱逐 ComfyUI 缓存模型 (可逆) → 等回收 → 复查
  let evicted = false;
  if (comfyuiUrl) {
    console.log(
      `[gpuVramManager] low vram for ${engineKey} (free ${gpu.freeMiB}MiB < need ${requiredMiB}MiB), evicting ComfyUI cache via /free`,
    );
    evicted = await requestComfyuiFree(comfyuiUrl);
    if (evicted) {
      const waitMs = process.env.KAP_VRAM_FREE_WAIT_MS
        ? parseInt(process.env.KAP_VRAM_FREE_WAIT_MS, 10)
        : 3_000;
      await new Promise((r) => setTimeout(r, waitMs));
      gpu = await check();
      if (gpu && gpu.freeMiB >= requiredMiB) {
        console.log(`[gpuVramManager] ok after /free: ${engineKey} GPU${gpuIndex} free ${gpu.freeMiB}MiB`);
        return { freeMiB: gpu.freeMiB, requiredMiB, evicted: true };
      }
    }
  }

  const freeMiB = gpu?.freeMiB ?? 0;
  throw new VramInsufficientError({ engine: engineKey, freeMiB, requiredMiB, gpuIndex });
}

// ─── B5. 互斥信号 (进程内) ──────────────────────────────────────────────────
//
// GPU1 上互斥的重型引擎 (qwen_tts vs minimax_h3) 同时提交会互相挤爆。
// 进程内 Map<string, Promise> 把同 key 的 ensureVram+submit 串行化:
// 后到者等前一个 release 再提交, 避免两个大模型同时在 ComfyUI 队列里装载。
// 仅进程内有效 (KAP 是单进程部署, 够用); 跨进程需 Redis 锁, 留待后续。

const engineLocks = new Map<string, Promise<void>>();

/**
 * 以互斥锁包裹一次提交动作 (典型: await withEngineLock("qwen_tts", () => submitPrompt(wf)))。
 * 锁在动作结束 (无论成败) 后释放。
 */
export async function withEngineLock<T>(engineKey: string, fn: () => Promise<T>): Promise<T> {
  const prev = engineLocks.get(engineKey) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  engineLocks.set(engineKey, prev.then(() => gate));
  await prev;
  try {
    return await fn();
  } finally {
    release();
  }
}
