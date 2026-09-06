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
 *   3. 仍不足 → 抛 VramInsufficientError (结构化 vram_insufficient)
 *
 * 2026-08-16 二期 (跨引擎撞车, 20:47 事故):
 *   withEngineLock 是按引擎各管各的 (qwen_tts 与 minimax_h3 互不阻塞),
 *   且 qwen-eye 走 GpuScheduler 与本模块互不知情 → TTS 预检放行后 qwen-eye
 *   拉起吃掉 14.7G, TTS 合成时 fail-fast 崩管线。
 *   升级为 withGpuQueue: 同一 GPU 上所有重型引擎共享一把全局互斥锁,
 *   排队等待 (指数退避) 而非 fail-fast, 超时 (KAP_GPU_QUEUE_TIMEOUT_MS) 才抛错。
 *
 * 2026-08-19 三期 (ep-ccport-test01 p11a 5h 死锁事故, docs/gpu-unified-scheduling-plan.md):
 *   D1/D2/D3 三因子叠加: qwen_eye 服务级占位在 :8125 死后孤儿化 (无看门狗),
 *   所有引擎 waiter 无限等待 (锁等待无超时), 客户端 ReadTimeout 断连后
 *   幽灵 waiter 照常堆积。修复:
 *   - 锁等待 deadline (KAP_GPU_LOCK_WAIT_TIMEOUT_MS, 默认 30min, 0=禁用) →
 *     超时摘除 waiter 并抛 QueueTimeoutError (kind=queue_timeout)
 *   - opts.signal (AbortSignal) 绑定客户端连接 —— 仅排队阶段生效; 已获锁的
 *     作业跑完 (省 GPU+配额), 完成时记 orphaned_completion 事件
 *   - 占用看门狗: acquireEngineOccupancy 传 healthUrl 后, 后台按间隔轮询,
 *     连续 N 次失败自动 releaseEngineOccupancy (KAP_GPU_WATCHDOG=0 可关)
 *   - waiter 对象化: 支持 timeout/abort/purge 三种摘除路径, settled 守卫防
 *     resolve/reject 竞态
 *
 * env 变量:
 *   KAP_VRAM_CACHE_MS              — nvidia-smi 结果缓存时长 (默认 5000ms)
 *   KAP_VRAM_FREE_TIMEOUT_MS       — ComfyUI /free 请求超时 (默认 5000ms)
 *   KAP_VRAM_FREE_WAIT_MS          — /free 后等待显存回收时长 (默认 3000ms)
 *   KAP_VRAM_GPU_INDEX             — ensureVram / withGpuQueue 默认 GPU 索引 (默认 1;
 *                                    角色链解析失败时的现状链兜底之一, 见 B2b)
 *   KAIS_GPU_CONF / KAIS_GPU_<KEY>_ROLE — GPU 角色化解析 (docs/gpu-dual-3090-expansion.md):
 *                                    conf <engineKey>_role 有值时 engineGpuIndex 按角色
 *                                    解析, 覆盖 ENGINE_GPU_INDEX 表值; 解析失败落表值
 *   KAP_VRAM_SKIP                  — "1" 跳过预检 (调试用)
 *   KAP_GPU_QUEUE_TIMEOUT_MS       — 锁内 vram_retry 等待上限 (默认 1800000 = 30min)
 *   KAP_GPU_LOCK_WAIT_TIMEOUT_MS   — 锁排队等待上限 (默认同 QUEUE_TIMEOUT; 0=禁用)
 *   KAP_GPU_WATCHDOG               — "0" 关闭占用看门狗 (默认开)
 *   KAP_GPU_WATCHDOG_INTERVAL_MS   — 看门狗健康轮询间隔 (默认 30000)
 *   KAP_GPU_WATCHDOG_FAIL_THRESHOLD— 看门狗连续失败释放阈值 (默认 2)
 */

import { execFile } from "child_process";
import { promisify } from "util";
import { AsyncLocalStorage } from "async_hooks";
// 跨进程门控 (P3-A/D4): 进程内锁之上的 redis mirror/strict 层, 默认 off —
// 见 gpuQueueCrossProc.ts 头注释。
import { getQueueGate } from "./gpuQueueCrossProc";
// 双3090 Phase A 角色化 (docs/gpu-dual-3090-expansion.md): conf <engineKey>_role
// → 角色 → UUID → nvidia-smi 索引; 失败静默回退本表现状链。
import { lookupServiceRole, resolveRoleIndexSync } from "@/services/gpu/gpuRoles";

const execFileAsync = promisify(execFile);

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

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
  indextts2: 8192,   // IndexTTS-2 fp16 (~6GB) + 余量 (2026-09-04 起 TTS 链已切 breeze_tts, 键保留防旧分支误调用)
  breeze_tts: 8192,  // Breeze TTS 2 (7.2GB 权重常驻 breeze-tts.service + 推理峰值余量; IndexTTS2.5 后继)
  minimax_h3: 18432, // 18GB (int8 34GB 权重 dynamic VRAM 分段驻留 + VAE)
  flux2: 12288,      // FLUX.2-dev fp8mixed + TE (mistral cpu offload 后 GPU 侧 ~12GB)
  qwen_eye: 14336,   // 14GB (与 vision 引擎预检阈值一致; GpuScheduler qwen-llm vramEst 15.5GB 同源)
  qwen_ear: 22016,   // 21.5GB (Qwen3-Omni Q4_K_M 18.56G + mmproj 1.33G + 余量; kap-ear.sh NEED_MB 同源) — 3090 近独占, 与 qwen_eye 互斥
  music3: 22528,     // 22GB (MiniMax Music3 diffusers 直装 24.7GB, MUSIC3_CPU_OFFLOAD=1 后 ~22GB, 3090 满卡)
  sa3: 8192,         // Stable Audio 3 Medium (~6GB: DiT + t5gemma TE) + 余量
  ace: 8192,         // ACE-Step v1.5 XL (SFT DiT + qwen TE + VAE, tiled VAE) 实测 ~7GB
  rtx_vsr: 4096,     // RTX VSR 插值超分 (~568MiB) — 轻量但同卡互斥; 4GB 含输入缓冲余量
  ltx: 8192,         // LTX-2.3 video (kmc 已退役, 防误调用撞卡收编用)
  // ── 2026-08-19 接入门禁首批补登记 (docs/engine-integration-spec.md; 此前排查
  // 只扫了 flux/minimax-h3/ltx 目录, wan/trellis2/postprocess 家族是暴露面盲区) ──
  wan22: 12288,      // Wan2.2 video (i2v/t2v/fflf/movetrack; 14B 级 ComfyUI 作业)
  wan21: 8192,       // Wan2.1 scail2 换装/迁移 (VACE 级作业, 未实测按 default 档)
  trellis2: 8192,    // TRELLIS 3D image-to-3d (ComfyUI 作业)
  postprocess: 8192, // SeedVR2/seedvrs 超分增强 (postprocess/enhance+seedvr2)
  default: 8192,
};

// ─── B2a. 桌面卡空闲地板 (2026-09-06, GPU0=3060Ti 兼职 GUI 显示卡) ───────────
//
// 背景: GPU0 是桌面合成器 (GNOME Wayland, 三屏含 4K) 的显示卡 — Wayland/Chrome
// 常驻 ~1.9GB, GUI 峰值可冲 3.0-3.4GB。KAP 引擎若按"free 够就用"上卡, 渲染峰值
// 会挤压桌面 buffer → 桌面卡顿。Linux 无 VRAM 硬分区 (cgroup 不支持), 预算约束
// 只能落在预检层: 保证本作业提交后仍给桌面留下 floor 空闲。
//
// 语义: ensureVram / GpuScheduler.ensureVram 的放行条件从 free ≥ required
// 收紧为 free ≥ required + floor。floor 只对配置了的卡生效 (默认仅 GPU0),
// GPU1/GPU2 = 0 → 行为零变化。floor 计入 required 上报 (VramInsufficientError
// 的 requiredMiB 含 floor), 日志显式标注 floor 来源, 排障可分辨。
//
// 默认值推导 (2026-09-06 实测): 8192(总) − ~1900(桌面三屏静止) − ~3400(GUI
// 峰值头寸 4K 视频+截屏+多窗) − ~1100(该卡 KAP 峰值作业≈6.4G 预检上限)
// = ~1790 → 取 1792MiB (= KAP 可用预算上限 ≈ 4608MiB, 与 docker-compose
// 注释口径 5.5G 相比保守 0.9G, 为桌面峰值让位)。
//
// 覆盖: KAP_VRAM_FLOOR_MIB="0:1792,2:2048" (逗号分隔 gpuIndex:MIB; 非法项
// 忽略)。设为空串/全非法 = 全部无地板 (逃生口)。
export const GPU_VRAM_FLOOR_MIB_DEFAULT: Record<number, number> = { 0: 1792 };

function parseFloorEnv(raw: string | undefined): Record<number, number> | null {
  if (raw === undefined || raw === "") return null;
  const out: Record<number, number> = {};
  for (const item of raw.split(",")) {
    const m = item.trim().match(/^(\d+):(\d+)$/);
    if (!m) continue;
    const idx = parseInt(m[1], 10);
    const mib = parseInt(m[2], 10);
    if (Number.isFinite(idx) && Number.isFinite(mib)) out[idx] = mib;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** 该卡预检空闲地板 (MiB): env KAP_VRAM_FLOOR_MIB > 内置默认 (仅 GPU0)。
 * 语义: 未配置/全非法 → 内置默认; 显式空串 → 0 (全部无地板逃生口);
 * 有合法项 → 列出的卡取 env 值 (含显式 0 可关), 未列出的卡回落内置默认。 */
export function gpuFloorMib(gpuIndex: number): number {
  const raw = process.env.KAP_VRAM_FLOOR_MIB;
  if (raw === "") return 0; // 显式空串 = 全部无地板 (逃生口)
  const def = GPU_VRAM_FLOOR_MIB_DEFAULT[gpuIndex] ?? 0;
  const envTable = parseFloorEnv(raw);
  if (!envTable) return def;
  return envTable[gpuIndex] ?? def;
}

// ─── B2b. 引擎 → GPU 归属表 (2026-08-19 P3 / D8 GPU0 纳管) ─────────────────
//
// 当前所有过队列的重型引擎都在 GPU1 (3090 生成卡) — 全表默认 1 = 行为不变。
// 机制先行: 新增 GPU0 引擎 (如 comfyui-aux 类轻作业) 时在此登记 + 路由不传
// gpuIndex 即自动落到正确卡, 与 defaultGpuIndex() (env 兜底) 解耦。
//
// 双3090 Phase A (docs/gpu-dual-3090-expansion.md): 引擎键在 gpu.conf 有
// `<engineKey>_role` 登记 (env KAIS_GPU_<KEY>_ROLE 可覆盖) 时, engineGpuIndex
// 按角色链运行时解析 (conf 现网已登记 qwen_tts/qwen_ear/qwen_eye/music3/sa3/ace/
// indextts2 等, 插卡日 conf 翻 QC_GEN2 即整组切卡, 免改代码); 未登记/解析失败
// 仍走本表现状链 — 全表默认 1 = 零行为变化。

export const ENGINE_GPU_INDEX: Record<string, number> = {
  qwen_tts: 1,
  indextts2: 1,
  breeze_tts: 1, // Breeze 常驻 RENDER_GEN1 (与 indextts2 同卡; 插卡日可在 gpu.conf 加 breeze_tts_role 角色化)
  minimax_h3: 1,
  flux2: 1,
  qwen_eye: 1,
  qwen_ear: 1,
  music3: 1,
  sa3: 1,
  ace: 1,
  rtx_vsr: 1,
  ltx: 1,
  wan22: 1,
  wan21: 1,
  trellis2: 1,
  postprocess: 1,
  default: 1,
  // GPU0 (3060Ti 8GB) 候补位 — 登记 lighter 引擎即纳管:
  // comfyui_aux: 0,
};

/**
 * 引擎默认 GPU 归属 (双3090 Phase A 角色化)。
 * 解析顺序: conf/env `<engineKey>_role` 有值 → 角色链解析索引; 未登记或解析失败
 * (nvidia-smi 不可用/UUID 不在位) → 现状链: 表内值 → env KAP_VRAM_GPU_INDEX → 1。
 * 同步签名 (withGpuQueueTimed 排队路径在用) — 内部走 gpuRoles 的 5s TTL 缓存,
 * 失败一律静默回退, 绝不抛异常。
 */
export function engineGpuIndex(engineKey: string): number {
  const role = lookupServiceRole(engineKey);
  if (role) {
    const idx = resolveRoleIndexSync(role);
    if (idx !== null) return idx;
  }
  return ENGINE_GPU_INDEX[engineKey] ?? defaultGpuIndex();
}

// ─── B2c. GPU2 双实例统一调度 (2026-09-06, M4 双 3090) ─────────────────────
//
// 布局: GPU1 = comfyui-primary :8188 (RENDER_GEN1 主生成卡)
//       GPU2 = comfyui-secondary :8190 (QC_GEN2 第二渲染实例, docker-compose.secondary.yml,
//              CDI 锚 QC_GEN2_UUID, 共享模型库, 输出隔离 /mnt/agents/output/gpu2)
// 队列锁 (withGpuQueue) 按 gpuIndex 分钥匙 → 跨卡作业天然并行; 本节只补
// 「选卡 + 端点路由」决策点, withGpuQueue 锁内核零改动。
//
// 策略 (全部 env, 默认关 = 旧行为; KAP_GPU2_ENABLED=0 为总 kill-switch):
//   KAP_GPU2_ENABLED=1                     总闸
//   KAP_GPU2_ENGINES=sa3,ace,postprocess   白名单 (命中才可派 GPU2)
//   KAP_COMFYUI_URL_GPU2=...               secondary 端点 (默认宿主 :8190)
//
// 首批收编 (v1): 纯 ComfyUI 工作流引擎 (fn 内 fetch {url}/prompt, 换 URL 即
// 完整迁移): sa3 / ace / postprocess。
// 明确不收编: music3 (diffusers 独立 server :5112, 非 ComfyUI 作业, URL 换卡
// 语义不成立) / rtx_vsr (服务绑定 comfyui-primary 容器 :10589) / minimax_h3
// (docker cp 投递容器名硬编码 + T8 节点集未在 secondary 验证, 后续批次) /
// wan22/wan21/flux/trellis2 (后续批次按同模式)。
// 探测失败静默回退 GPU1 — secondary 缺位绝不让请求失败。

/** GPU2 渲染策略总闸 (env KAP_GPU2_ENABLED=1) */
export function secondaryEnabled(): boolean {
  return process.env.KAP_GPU2_ENABLED === "1";
}

/** GPU2 白名单引擎 (env KAP_GPU2_ENGINES, 逗号分隔) */
export function gpu2EngineAllowlist(): string[] {
  return (process.env.KAP_GPU2_ENGINES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** comfyui-secondary 端点 (env KAP_COMFYUI_URL_GPU2, 默认宿主 :8190) */
export function secondaryComfyuiUrl(): string {
  return process.env.KAP_COMFYUI_URL_GPU2 || "http://localhost:8190";
}

type Gpu2ProbeFn = (url: string) => Promise<boolean>;

async function defaultProbeGpu2(url: string): Promise<boolean> {
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(1500) });
    return resp.ok;
  } catch {
    return false;
  }
}

let gpu2AvailCache: { at: number; ok: boolean } | null = null;
const GPU2_AVAIL_TTL_MS = 30_000;

/** GPU2 secondary 可用性 (缓存同步读, 供状态端点; 未探测过=false) */
export function cachedAvailGpu2(): boolean {
  return gpu2AvailCache?.ok === true;
}

/** GPU2 secondary 可用性 (缓存过期真探测, 调度路径用; 30s 缓存) */
export async function availGpu2(probe: Gpu2ProbeFn = defaultProbeGpu2): Promise<boolean> {
  if (gpu2AvailCache && Date.now() - gpu2AvailCache.at < GPU2_AVAIL_TTL_MS) {
    return gpu2AvailCache.ok;
  }
  const ok = await probe(secondaryComfyuiUrl());
  gpu2AvailCache = { at: Date.now(), ok };
  return ok;
}

/** 测试辅助: 清 GPU2 调度缓存 */
export function __resetGpu2DispatchForTests(): void {
  gpu2AvailCache = null;
}

// ── 异步任务↔实例钉扎 (ACE status/cancel 需轮询「提交所在」的实例) ──
const GPU2_PIN_CAP = 2000;
const gpu2PinnedTasks = new Map<string, { gpuIndex: number; at: number }>();

/** 记录任务提交到哪张卡 (异步引擎 status/cancel 路由用; 超容量整表清一次) */
export function pinTaskGpu(taskId: string, gpuIndex: number): void {
  if (gpu2PinnedTasks.size >= GPU2_PIN_CAP) gpu2PinnedTasks.clear();
  gpu2PinnedTasks.set(taskId, { gpuIndex, at: Date.now() });
}

/** 查任务钉扎卡 (未钉扎/超过 6h 视为过期 → undefined, 调用方回落 GPU1) */
export function getPinnedGpu(taskId: string): number | undefined {
  const rec = gpu2PinnedTasks.get(taskId);
  if (!rec) return undefined;
  if (Date.now() - rec.at > 6 * 3600_000) {
    gpu2PinnedTasks.delete(taskId);
    return undefined;
  }
  return rec.gpuIndex;
}

/** ComfyUI 产物查找根列表: 主根 + GPU2 根 (下载/读取路由按序试) */
export function gpuOutputRoots(): string[] {
  const root = process.env.OUTPUT_ROOT || process.env.OUTPUT_DIR || "/mnt/agents/output";
  return [root, `${root}/gpu2`];
}

/** per-GPU ComfyUI 端点 (1→primary :8188, 2→secondary :8190; env KAP_COMFYUI_URL_GPU1/GPU2 可覆盖) */
export function comfyuiUrlForGpu(gpuIndex: number): string {
  if (gpuIndex === 2) return secondaryComfyuiUrl();
  return process.env.KAP_COMFYUI_URL_GPU1 || process.env.COMFYUI_URL || "http://localhost:8188";
}

export interface GpuDispatchDecision {
  gpuIndex: number;
  secondary: boolean;
}

/**
 * 选卡决策 (调用点在 withGpuQueue 前调用):
 *   显式 preferGpu(1/2) 直通 > 总闸关 → 1 > 非白名单 → 1 >
 *   GPU2 探活失败 → 1 (静默回退) > GPU2。
 */
export async function resolveDispatchGpuIndex(
  engineKey: string,
  preferGpu?: number,
  opts: { probeFn?: Gpu2ProbeFn } = {},
): Promise<GpuDispatchDecision> {
  if (preferGpu === 1 || preferGpu === 2) {
    return { gpuIndex: preferGpu, secondary: preferGpu === 2 };
  }
  if (!secondaryEnabled()) return { gpuIndex: 1, secondary: false };
  if (!gpu2EngineAllowlist().includes(engineKey)) return { gpuIndex: 1, secondary: false };
  if (!(await availGpu2(opts.probeFn))) {
    console.log(`[gpuDispatch] ${engineKey}: GPU2 unavailable (probe fail), fallback GPU1`);
    return { gpuIndex: 1, secondary: false };
  }
  // 显存头寸检查: 探活只证实例活着 — secondary 被 QC 大服务(qwen-ear ~18.5G)
  // 占用或在跑大作业时, free 不足会让作业在 GPU2 队列里 vram_retry 空转 30min。
  // 头寸不足 → 静默回退 GPU1 (那里排队语义成熟)。
  const needMiB = ENGINE_VRAM_REQUIREMENTS[engineKey] ?? ENGINE_VRAM_REQUIREMENTS.default;
  const gpus = await getGpuStatus(true);
  const gpu2 = gpus.find((g) => g.index === 2);
  if (!gpu2 || gpu2.freeMiB < needMiB + 1024) {
    console.log(
      `[gpuDispatch] ${engineKey}: GPU2 headroom insufficient (free ${gpu2?.freeMiB ?? -1}MiB < need ${needMiB}+1024MiB), fallback GPU1`,
    );
    return { gpuIndex: 1, secondary: false };
  }
  console.log(`[gpuDispatch] ${engineKey} → GPU2 (secondary, free ${gpu2.freeMiB}MiB)`);
  return { gpuIndex: 2, secondary: true };
}

// ─── B2d. 常驻引擎显存登记 (2026-08-19 P3 / D6 常驻占用语义准备) ────────────
//
// 结构性缺口: music3/qwen_tts 等常驻 server 在请求间驻留显存, 但队列锁每请求
// 释放 — ensureVram 只看 nvidia-smi free, 分不清「可驱逐」与「常驻不可驱逐」,
// 目前靠 requireVramMiB 逐案补丁 (music3 增量 6GB)。
//
// 登记表 + 可回收公式 (env KAP_VRAM_RESIDENT_AWARE=1 开启, 默认关):
//   effectiveFree = nvidia-smi free + Σ 该卡上 evictable 常驻引擎的 residentVramMiB
// 常驻引擎自身的驱逐 (music3 cpu-offload / ComfyUI /free) 留给后续迁移 —
// 本期交付接口与公式, 不改默认行为。

export interface ResidentEngineEntry {
  engine: string;
  gpuIndex: number;
  /** 常驻占用显存 (MiB) */
  residentVramMiB: number;
  /** true = ensureVram 可把它计入可回收 (有驱逐手段); false = 硬驻留 */
  evictable: boolean;
}

const RESIDENT_ENGINES = new Map<string, ResidentEngineEntry>();

export function registerResidentEngine(entry: ResidentEngineEntry): void {
  RESIDENT_ENGINES.set(entry.engine, entry);
}

export function unregisterResidentEngine(engine: string): void {
  RESIDENT_ENGINES.delete(engine);
}

export function getResidentEngines(): ResidentEngineEntry[] {
  return Array.from(RESIDENT_ENGINES.values());
}

/** 该卡上可回收显存 (常驻登记贡献; 默认未开启时恒 0) */
function evictableResidentMiB(gpuIndex: number): number {
  if (process.env.KAP_VRAM_RESIDENT_AWARE !== "1") return 0;
  let sum = 0;
  for (const entry of RESIDENT_ENGINES.values()) {
    if (entry.gpuIndex === gpuIndex && entry.evictable) sum += entry.residentVramMiB;
  }
  return sum;
}

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
 * @param requireVramMiB 显存需求覆盖 (MiB) — 不传时查 ENGINE_VRAM_REQUIREMENTS。
 *   供「常驻 server 已占住基线显存, 只需按增量预检」的引擎用 (music3: 模型加载后
 *   权重经 CPU offload 驻留, 生成峰值增量 ~6GB; 按满卡 22GB 预检会结构性死锁)。
 */
export async function ensureVram(
  engineKey: string,
  gpuIndex: number = process.env.KAP_VRAM_GPU_INDEX
    ? parseInt(process.env.KAP_VRAM_GPU_INDEX, 10)
    : 1,
  comfyuiUrl?: string,
  requireVramMiB?: number,
): Promise<{ freeMiB: number; requiredMiB: number; evicted: boolean }> {
  const requiredMiB = requireVramMiB ?? ENGINE_VRAM_REQUIREMENTS[engineKey] ?? ENGINE_VRAM_REQUIREMENTS.default;

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
  // 可回收常驻贡献 (KAP_VRAM_RESIDENT_AWARE=1 时按登记表计入, 默认 0 — 行为不变)
  const recyclableMiB = evictableResidentMiB(gpuIndex);
  // 桌面卡空闲地板 (B2a; 默认仅 GPU0=1792, 其余卡 0 → 不改变放行条件)
  const floorMiB = gpuFloorMib(gpuIndex);
  const effRequiredMiB = requiredMiB + floorMiB;
  if (gpu.freeMiB + recyclableMiB >= effRequiredMiB) {
    console.log(
      `[gpuVramManager] ok ${engineKey}: need ${requiredMiB}MiB${floorMiB > 0 ? ` + desktop-floor ${floorMiB}MiB` : ""}, GPU${gpuIndex} free ${gpu.freeMiB}MiB${recyclableMiB > 0 ? ` + evictable resident ${recyclableMiB}MiB` : ""}`,
    );
    return { freeMiB: gpu.freeMiB, requiredMiB: effRequiredMiB, evicted: false };
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
      if (gpu && gpu.freeMiB + evictableResidentMiB(gpuIndex) >= effRequiredMiB) {
        console.log(`[gpuVramManager] ok after /free: ${engineKey} GPU${gpuIndex} free ${gpu.freeMiB}MiB${floorMiB > 0 ? ` (incl. desktop-floor ${floorMiB}MiB)` : ""}`);
        return { freeMiB: gpu.freeMiB, requiredMiB: effRequiredMiB, evicted: true };
      }
    }
  }

  const freeMiB = gpu?.freeMiB ?? 0;
  throw new VramInsufficientError({ engine: engineKey, freeMiB, requiredMiB: effRequiredMiB, gpuIndex });
}

// ─── B5. 全局引擎队列 (withGpuQueue, 2026-08-16 二期) ────────────────────────
//
// 上一代 withEngineLock 是按引擎各管各的 (qwen_tts 与 minimax_h3 互不阻塞),
// 撞车实锤 (20:47 TTS 预检放行 → 20:47:51 qwen-eye 拉起 14.7G → 20:51 TTS 崩)。
//
// 升级语义:
//   1. 同一 GPU 上所有重型引擎共享一把全局互斥锁 — 同一时刻只有一个引擎作业
//      在提交/执行 (GPU1: qwen_tts/indextts2/minimax_h3/music3/sa3/ace/flux2/qwen_eye/rtx_vsr)。
//   2. 锁内执行: ensureVram (不足先 /free 驱逐) → fn (提交+等完成) → 释放。
//   3. ensureVram 失败不立刻 fail-fast — 在锁内指数退避重试 (5s→10s→20s, 封顶 20s),
//      累计等待超过 KAP_GPU_QUEUE_TIMEOUT_MS (默认 30min) 才抛 VramInsufficientError。
//   4. 防死锁: AsyncLocalStorage 检测同请求嵌套获取 — 嵌套时直接放行内层
//      (外层已持有该 GPU 的锁) 并 log 警告。
//   5. 可观测: [gpuQueue] 前缀 log 排队/获得锁/释放事件; 事件环形缓冲供
//      GET /api/production/gpu-queue 查询。
//
// 2026-08-19 三期 (锁等待健壮性):
//   6. 锁排队等待有 deadline (KAP_GPU_LOCK_WAIT_TIMEOUT_MS, 0=禁用) — 超时
//      waiter 自摘除并抛 QueueTimeoutError, 不再无限挂起。
//   7. opts.signal (AbortSignal) — 客户端断连时取消排队 (仅排队阶段); 已获锁
//      作业跑完, 完成记 orphaned_completion。
//   8. waiter 对象化 — grant/evict 双路径 + settled 竞态守卫。

/** 排队等待上限 (env KAP_GPU_QUEUE_TIMEOUT_MS, 默认 30min — H3 长任务可能占锁 30min+) */
const QUEUE_TIMEOUT_MS = process.env.KAP_GPU_QUEUE_TIMEOUT_MS
  ? parseInt(process.env.KAP_GPU_QUEUE_TIMEOUT_MS, 10)
  : 30 * 60 * 1000;

/**
 * 锁排队等待上限 (env KAP_GPU_LOCK_WAIT_TIMEOUT_MS)。
 * 默认取 QUEUE_TIMEOUT_MS (30min); 0 = 禁用 (恢复三期前的无限等待, 回滚开关)。
 * 注意与 vram_retry 预算是两个独立上限 — 客户端断连由 signal 摘除 waiter 兜底,
 * 不依赖服务端预算与客户端 ReadTimeout 的数值耦合。
 */
const LOCK_WAIT_TIMEOUT_MS = process.env.KAP_GPU_LOCK_WAIT_TIMEOUT_MS !== undefined
  ? parseInt(process.env.KAP_GPU_LOCK_WAIT_TIMEOUT_MS, 10)
  : QUEUE_TIMEOUT_MS;

/** ensureVram 重试指数退避: 5s → 10s → 20s (封顶 20s) */
const RETRY_BACKOFF_MS = [5_000, 10_000, 20_000];

/** 事件环形缓冲大小 (gpu-queue 端点返回最近 20 条, 留余量) */
const EVENT_RING_SIZE = 40;

export interface GpuQueueEvent {
  at: string;
  event:
    | "enqueue"
    | "acquire"
    | "release"
    | "vram_retry"
    | "timeout"
    | "nested_pass_through"
    | "aborted"
    | "purged"
    | "watchdog_release"
    | "admin_release"
    | "orphaned_completion";
  engine: string;
  gpuIndex: number;
  position?: number;
  waitMs?: number;
  heldMs?: number;
  detail?: string;
}

const eventRing: GpuQueueEvent[] = [];

function recordEvent(evt: GpuQueueEvent): void {
  eventRing.push(evt);
  if (eventRing.length > EVENT_RING_SIZE) eventRing.shift();
}

/** 每引擎排队计数 (gpu-queue 端点观测用; 值 = 等待锁的该引擎作业数) */
const waitingByEngine = new Map<string, number>();

function incrementWaiting(engine: string, gpuIndex: number): void {
  waitingByEngine.set(engine, (waitingByEngine.get(engine) ?? 0) + 1);
  mirrorWaitingToGate(engine, gpuIndex);
}

function decrementWaiting(engine: string, gpuIndex: number): void {
  waitingByEngine.set(engine, Math.max(0, (waitingByEngine.get(engine) ?? 1) - 1));
  mirrorWaitingToGate(engine, gpuIndex);
}

/** 排队计数镜像到跨进程门控 (best-effort, 永不阻塞/抛错) */
function mirrorWaitingToGate(engine: string, gpuIndex: number): void {
  void getQueueGate()
    .then((gate) => gate.mirrorWaiting(gpuIndex, engine, waitingByEngine.get(engine) ?? 0))
    .catch(() => undefined);
}

/** 获取锁的先后顺序固定 (按 ENGINE_VRAM_REQUIREMENTS 键排序) — 防多锁场景死锁 */
const ENGINE_ORDER: string[] = Object.keys(ENGINE_VRAM_REQUIREMENTS).sort();

/**
 * AsyncLocalStorage 携带「本异步上下文当前持有的 GPU 锁」。
// 同一请求链内再次 withGpuQueue → 嵌套 → 直接放行内层 (外层已持锁)。
 */
const heldGpus = new AsyncLocalStorage<Set<number>>();

interface GpuLockHolder {
  engine: string;
  acquiredAt: number;
  /** 服务级占用 (acquireEngineOccupancy 产出) — 跨请求持有, 可被看门狗/管理端强制释放 */
  occupancy?: boolean;
}

/**
 * FIFO 等待队列的 waiter 记录 (2026-08-19 三期对象化)。
 * settle 双路径: grant (获锁) / evict (timeout|aborted|purged 自摘除)。
 * settled 守卫: grant 与 evict 竞态时只生效先到者 (例: release 已 shift 出队、
 * 定时器随后才 fire → evict no-op, 不 reject 已 resolve 的 promise)。
 */
interface GpuWaiter {
  engine: string;
  gpuIndex: number;
  enqueuedAt: number;
  settled: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  onAbort: (() => void) | null;
  grant: () => void;
  evict: (err: Error) => void;
}

interface GpuLockState {
  /** 当前持锁者 (null = 空闲)。每次获取都是新对象 — withGpuQueue 靠对象身份
   *  判断锁是否被「转交」(服务级占用), 转交后外层 release 是 no-op。 */
  holder: GpuLockHolder | null;
  /** FIFO 等待队列: waiter.grant() 即获得锁 (holder 在 grant 内重写) */
  waiters: GpuWaiter[];
}

/** gpuIndex → 锁状态 (KAP 目前只有 GPU1 生成卡, 但按索引分锁留扩展) */
const gpuLocks = new Map<number, GpuLockState>();

function getGpuLock(gpuIndex: number): GpuLockState {
  let lock = gpuLocks.get(gpuIndex);
  if (!lock) {
    lock = { holder: null, waiters: [] };
    gpuLocks.set(gpuIndex, lock);
  }
  return lock;
}

function defaultGpuIndex(): number {
  return process.env.KAP_VRAM_GPU_INDEX
    ? parseInt(process.env.KAP_VRAM_GPU_INDEX, 10)
    : 1;
}

/** 结构化锁排队超时 — 路由层捕获后以 5xx + kind=queue_timeout 返回 (kmc D-09 天然降级兼容) */
export class QueueTimeoutError extends Error {
  readonly kind = "queue_timeout" as const;
  readonly engine: string;
  readonly gpuIndex: number;
  readonly waitedMs: number;

  constructor(opts: { engine: string; gpuIndex: number; waitedMs: number }) {
    super(
      `queue_timeout: engine=${opts.engine} waited ${Math.round(opts.waitedMs / 1000)}s for GPU${opts.gpuIndex} lock (KAP_GPU_LOCK_WAIT_TIMEOUT_MS)`,
    );
    this.name = "QueueTimeoutError";
    this.engine = opts.engine;
    this.gpuIndex = opts.gpuIndex;
    this.waitedMs = opts.waitedMs;
  }
}

/** 客户端断连取消排队 — 只在排队阶段发生; 已获锁作业不受影响 */
export class QueueAbortedError extends Error {
  readonly kind = "queue_aborted" as const;
  readonly engine: string;
  readonly gpuIndex: number;

  constructor(opts: { engine: string; gpuIndex: number }) {
    super(`queue_aborted: client disconnected while engine=${opts.engine} waited for GPU${opts.gpuIndex}`);
    this.name = "QueueAbortedError";
    this.engine = opts.engine;
    this.gpuIndex = opts.gpuIndex;
  }
}

/** 管理端 purge-waiters 摘除 — 与 timeout 同形, 便于调用方统一按 5xx 降级 */
export class QueuePurgedError extends Error {
  readonly kind = "queue_purged" as const;
  readonly engine: string;
  readonly gpuIndex: number;

  constructor(opts: { engine: string; gpuIndex: number }) {
    super(`queue_purged: waiter for engine=${opts.engine} on GPU${opts.gpuIndex} purged by admin`);
    this.name = "QueuePurgedError";
    this.engine = opts.engine;
    this.gpuIndex = opts.gpuIndex;
  }
}

/**
 * 排队获取锁的统一实现 (withGpuQueueTimed / acquireEngineOccupancy 形态 a 共用)。
 *
 * - 无人持锁: 直接拿锁立即 resolve (不动 waitingByEngine)
 * - 有人持锁: 入队 waiter, 可选 deadline (lockWaitTimeoutMs>0) 与 AbortSignal
 * - grant/evict 均负责清理 timer + abort listener + waitingByEngine 计数
 */
function enqueueAcquire(
  lock: GpuLockState,
  engineKey: string,
  gpuIndex: number,
  opts: { lockWaitTimeoutMs?: number; signal?: AbortSignal; detail?: string } = {},
): Promise<void> {
  // 已断连的客户端不再占队 (无人持锁也一样 — 直接拒, 不浪费锁)
  if (opts.signal?.aborted) {
    throw new QueueAbortedError({ engine: engineKey, gpuIndex });
  }

  if (!lock.holder) {
    lock.holder = { engine: engineKey, acquiredAt: Date.now() };
    return Promise.resolve();
  }

  const position = lock.waiters.length + 1;
  incrementWaiting(engineKey, gpuIndex);
  recordEvent({
    at: new Date().toISOString(),
    event: "enqueue",
    engine: engineKey,
    gpuIndex,
    position,
    detail: opts.detail ?? `waiting behind ${lock.holder.engine}`,
  });
  console.log(
    `[gpuQueue] enqueue ${engineKey} GPU${gpuIndex} position=${position} (held by ${lock.holder.engine} for ${Math.round((Date.now() - lock.holder.acquiredAt) / 1000)}s)`,
  );

  return new Promise<void>((resolve, reject) => {
    const w: GpuWaiter = {
      engine: engineKey,
      gpuIndex,
      enqueuedAt: Date.now(),
      settled: false,
      timer: null,
      onAbort: null,
      grant: () => {
        if (w.settled) return;
        w.settled = true;
        cleanup();
        decrementWaiting(engineKey, gpuIndex);
        lock.holder = { engine: engineKey, acquiredAt: Date.now() };
        resolve();
      },
      evict: (err: Error) => {
        if (w.settled) return;
        w.settled = true;
        cleanup();
        const idx = lock.waiters.indexOf(w);
        if (idx >= 0) lock.waiters.splice(idx, 1);
        decrementWaiting(engineKey, gpuIndex);
        reject(err);
      },
    };

    const cleanup = () => {
      if (w.timer) clearTimeout(w.timer);
      if (w.onAbort && opts.signal) opts.signal.removeEventListener("abort", w.onAbort);
    };

    // 锁等待 deadline (0/负数 = 禁用, 恢复无限等待)
    const timeoutMs = opts.lockWaitTimeoutMs ?? 0;
    if (timeoutMs > 0) {
      w.timer = setTimeout(() => {
        const waitedMs = Date.now() - w.enqueuedAt;
        recordEvent({
          at: new Date().toISOString(),
          event: "timeout",
          engine: engineKey,
          gpuIndex,
          waitMs: waitedMs,
          detail: `lock wait exceeded ${Math.round(timeoutMs / 1000)}s; holder=${lock.holder?.engine ?? "none"}`,
        });
        console.error(
          `[gpuQueue] timeout ${engineKey} GPU${gpuIndex}: lock wait ${Math.round(waitedMs / 1000)}s > ${Math.round(timeoutMs / 1000)}s (held by ${lock.holder?.engine})`,
        );
        w.evict(new QueueTimeoutError({ engine: engineKey, gpuIndex, waitedMs }));
      }, timeoutMs);
      w.timer.unref?.();
    }

    // 客户端断连 → 摘除 waiter (仅排队阶段; 已 grant 的由 settled 守卫兜底)
    if (opts.signal) {
      w.onAbort = () => {
        recordEvent({
          at: new Date().toISOString(),
          event: "aborted",
          engine: engineKey,
          gpuIndex,
          detail: "client disconnected while waiting; waiter removed",
        });
        console.warn(`[gpuQueue] aborted ${engineKey} GPU${gpuIndex}: client disconnected while queued — waiter removed`);
        w.evict(new QueueAbortedError({ engine: engineKey, gpuIndex }));
      };
      opts.signal.addEventListener("abort", w.onAbort, { once: true });
    }

    lock.waiters.push(w);
  });
}

/**
 * withGpuQueue 计时元数据 (2026-08-16 P10 双重超时根因修复)。
 *
 * 事故: 队列等待 677s 侵占了下游所有预算 — KAP pollTimeout 从 submit 起算没问题,
 * 但 KMC 客户端 360s < 排队+作业总时长 → ReadTimeout; 且 poll 弃单后 ComfyUI 侧
 * 任务继续跑成孤儿。修复原则: **排队等待不计入作业预算** — 调用方用 queueWaitMs
 * 把 poll/客户端预算等量延长 (pollUntilDone(pid, queueWaitMs))。
 */
export interface GpuQueueResult<T> {
  data: T;
  /** 排队 + vram_retry 总耗时 — fn 开始前消耗的等待, 不属于作业本身预算 */
  queueWaitMs: number;
  /** fn 实际执行时长 (提交 + 轮询等) */
  heldMs: number;
}

/**
 * 全局引擎队列 — 把「显存预检 + 提交 + 等完成」包进同 GPU 全局互斥锁。
 *
 * 同 GPU 上所有重型引擎互斥: 后来者排队等待 (可观测 log), 而不是 fail-fast 崩管线。
 * fn 内部的长时间轮询 (ComfyUI 作业 ≤45min) 会一直持有锁 — 这是设计意图: 占着
 * 显存的作业没结束前, 别的引擎不该装载。
 *
 * fn 收到 queueWaitMs 实参 (本次排队+vram_retry 实测耗时) — 轮询类调用方应把
 * 自身 poll 预算延长 queueWaitMs, 避免「排队成功 → 预算耗尽被判超时」。
 *
 * @param engineKey  ENGINE_VRAM_REQUIREMENTS 键 (qwen_tts/minimax_h3/music3/...)
 * @param fn         锁内执行的动作 (提交 + 等结果完成; 纯代理类=HTTP 返回即完成)
 * @param opts.gpuIndex  GPU 索引 (默认 env KAP_VRAM_GPU_INDEX / 1)
 * @param opts.comfyuiUrl ComfyUI 基地址 (传给 ensureVram 做 /free 驱逐; 可省略)
 * @param opts.skipVram   跳过显存预检 (调用方已自行预检过时用)
 * @param opts.requireVramMiB 显存需求覆盖 (MiB, 透传 ensureVram) — 常驻 server
 *   引擎按「生成增量」而非表值预检时用; 不传走 ENGINE_VRAM_REQUIREMENTS
 * @param opts.signal AbortSignal — 仅排队阶段生效 (客户端断连摘除 waiter);
 *   已获锁后作业照常跑完, 完成时若 signal.aborted 记 orphaned_completion 事件
 */
export async function withGpuQueueTimed<T>(
  engineKey: string,
  fn: (queueWaitMs: number) => Promise<T>,
  opts: {
    gpuIndex?: number;
    comfyuiUrl?: string;
    skipVram?: boolean;
    requireVramMiB?: number;
    signal?: AbortSignal;
    lockWaitTimeoutMs?: number;
  } = {},
): Promise<GpuQueueResult<T>> {
  const gpuIndex = opts.gpuIndex ?? engineGpuIndex(engineKey);
  const lockWaitTimeoutMs =
    opts.lockWaitTimeoutMs !== undefined ? opts.lockWaitTimeoutMs : LOCK_WAIT_TIMEOUT_MS;

  // ── 防死锁: 同请求嵌套获取 → 放行内层 (外层已持有该 GPU 的锁) ──
  const held = heldGpus.getStore();
  if (held?.has(gpuIndex)) {
    recordEvent({
      at: new Date().toISOString(),
      event: "nested_pass_through",
      engine: engineKey,
      gpuIndex,
      detail: `outer lock already holds GPU${gpuIndex}; running inner without re-acquire`,
    });
    console.warn(
      `[gpuQueue] nested withGpuQueue("${engineKey}") inside an outer GPU${gpuIndex} holder — passing through (outer lock already serializes)`,
    );
    const nestedStart = Date.now();
    const data = await fn(0);
    return { data, queueWaitMs: 0, heldMs: Date.now() - nestedStart };
  }

  const lock = getGpuLock(gpuIndex);
  const enqueuedAt = Date.now();
  let vramRetryWaitedMs = 0;

  // ── 排队 (FIFO): 无人持锁直接拿, 否则挂 waiter (deadline + abort 可摘除) ──
  await enqueueAcquire(lock, engineKey, gpuIndex, { lockWaitTimeoutMs, signal: opts.signal });

  const waitMs = Date.now() - enqueuedAt;
  recordEvent({
    at: new Date().toISOString(),
    event: "acquire",
    engine: engineKey,
    gpuIndex,
    waitMs,
  });
  console.log(`[gpuQueue] acquire ${engineKey} GPU${gpuIndex}${waitMs > 0 ? ` (waited ${(waitMs / 1000).toFixed(1)}s)` : ""}`);

  // ── 跨进程门控 (P3-A/D4): 进程内获锁后过 redis 门 —
  // mirror 只写镜像+碰撞检测; strict 还要等互斥锁; off no-op。
  // 门获取失败 (strict 超时) 必须归还进程内锁再抛, 否则队列死锁。
  const gate = await getQueueGate();
  const gateStart = Date.now();

  // 释放锁 + 唤醒队首 (finally 兜底: fn 抛错/超时也必须释放, 否则永久阻塞后续作业)。
  // 对象身份判断: 若锁已被「转交」给服务级占用 (acquireEngineOccupancy 重写了 holder),
  // 本次 release 是 no-op — 占用由 releaseEngineOccupancy 负责。
  const myHolder = lock.holder!;
  const release = () => {
    if (lock.holder !== myHolder) {
      console.log(`[gpuQueue] release ${engineKey} GPU${gpuIndex} skipped — lock handed off to service occupancy (${lock.holder?.engine})`);
      return;
    }
    const heldMs = Date.now() - myHolder.acquiredAt;
    const next = lock.waiters.shift();
    if (next) {
      next.grant(); // 直接交接给队首 (holder 在 grant 内重写)
    } else {
      lock.holder = null;
    }
    gate.release(gpuIndex, engineKey); // best-effort (TTL 兜底), 不抛
    recordEvent({
      at: new Date().toISOString(),
      event: "release",
      engine: engineKey,
      gpuIndex,
      heldMs,
    });
    console.log(`[gpuQueue] release ${engineKey} GPU${gpuIndex} (held ${(heldMs / 1000).toFixed(1)}s)`);
  };

  try {
    // gate 等待上限: 锁等待超时禁用时也要封顶 (异主 xlock 崩溃残留靠 TTL 40min 过期,
    // 不能让 waiter 无限等 — D1 教训同样适用于跨进程层)
    const gateDeadline = lockWaitTimeoutMs > 0 ? lockWaitTimeoutMs : 40 * 60 * 1000;
    await gate.acquire(gpuIndex, engineKey, gateDeadline);
    if (Date.now() - gateStart > 100) {
      console.log(`[gpuQueue] crossproc gate ${engineKey} GPU${gpuIndex}: waited ${((Date.now() - gateStart) / 1000).toFixed(1)}s`);
    }
  } catch (err) {
    release(); // 归还进程内锁 (队首 waiter 接管后自己去过门)
    throw err;
  }

  // AsyncLocalStorage 让 fn 内部再调 withGpuQueue 时能识别嵌套
  return heldGpus.run(new Set([gpuIndex]), async () => {
    try {
      // ── 锁内: 显存预检 + 排队重试 (不 fail-fast) ──
      if (!opts.skipVram) {
        const deadline = Date.now() + QUEUE_TIMEOUT_MS;
        let attempt = 0;
        let lastErr: VramInsufficientError | null = null;
        while (Date.now() < deadline) {
          try {
            await ensureVram(engineKey, gpuIndex, opts.comfyuiUrl, opts.requireVramMiB);
            lastErr = null;
            break;
          } catch (err) {
            if (!(err instanceof VramInsufficientError)) throw err;
            lastErr = err;
            const backoff = RETRY_BACKOFF_MS[Math.min(attempt, RETRY_BACKOFF_MS.length - 1)];
            attempt++;
            const waitedMs = Date.now() - (deadline - QUEUE_TIMEOUT_MS);
            if (Date.now() + backoff > deadline) break;
            recordEvent({
              at: new Date().toISOString(),
              event: "vram_retry",
              engine: engineKey,
              gpuIndex,
              detail: `free ${err.freeMiB}MiB < need ${err.requiredMiB}MiB; retry in ${backoff / 1000}s (waited ${(waitedMs / 1000).toFixed(0)}s)`,
            });
            console.log(
              `[gpuQueue] vram_retry ${engineKey} GPU${gpuIndex}: free ${err.freeMiB}MiB < need ${err.requiredMiB}MiB, retry in ${backoff / 1000}s (waited ${(waitedMs / 1000).toFixed(0)}s/${QUEUE_TIMEOUT_MS / 1000}s)`,
            );
            await new Promise((r) => setTimeout(r, backoff));
            vramRetryWaitedMs += backoff;
          }
        }
        if (lastErr) {
          recordEvent({
            at: new Date().toISOString(),
            event: "timeout",
            engine: engineKey,
            gpuIndex,
            detail: `queue wait exceeded ${QUEUE_TIMEOUT_MS / 1000}s; last: free ${lastErr.freeMiB}MiB < need ${lastErr.requiredMiB}MiB`,
          });
          // R5 可观测性 (2026-09-06): 注册表外常驻占用是 vram_retry 空转的主要
          // 隐形因子 — ComfyUI /free 驱逐不到它们, 超时前留一条诊断线索, 让
          // 「最长 10min 停滞后 TTL 自卸自愈」这类事件可归因 (不改重试逻辑本身)。
          recordEvent({
            at: new Date().toISOString(),
            event: "vram_retry",
            engine: engineKey,
            gpuIndex,
            detail: `suspect out-of-registry resident occupancy: breeze-tts :5130 (idle TTL 600s 自卸) / systemd 常驻服务不在 /free 驱逐范围 — 对照 nvidia-smi 与 GET :5130/health 的 model_loaded 定位`,
          });
          console.error(
            `[gpuQueue] timeout ${engineKey} GPU${gpuIndex}: waited >${QUEUE_TIMEOUT_MS / 1000}s for vram (free ${lastErr.freeMiB}MiB < need ${lastErr.requiredMiB}MiB)`,
          );
          throw lastErr;
        }
      }

      // ── 锁内: 执行作业 (提交 + 等完成) ──
      // queueWaitMs = 锁等待 + vram_retry 等待 — fn 的下游轮询预算按此延长
      const queueWaitMs = waitMs + vramRetryWaitedMs;
      const fnStart = Date.now();
      const data = await fn(queueWaitMs);
      if (opts.signal?.aborted) {
        // 客户端已断连但作业跑完 — 留痕 (GPU/配额已花, 结果无人收)
        recordEvent({
          at: new Date().toISOString(),
          event: "orphaned_completion",
          engine: engineKey,
          gpuIndex,
          heldMs: Date.now() - fnStart,
          detail: "client disconnected during job; job completed but response unreachable",
        });
      }
      return { data, queueWaitMs, heldMs: Date.now() - fnStart };
    } finally {
      release();
    }
  });
}

/**
 * 向后兼容签名 — 13 处既有调用点 (flux/music3/sa3/ace/indextts2/rtx-vsr/...) 不动。
 * 与 withGpuQueueTimed 同一把锁同一套语义, 只是丢弃计时元数据。
 */
export async function withGpuQueue<T>(
  engineKey: string,
  fn: () => Promise<T>,
  opts: { gpuIndex?: number; comfyuiUrl?: string; skipVram?: boolean; requireVramMiB?: number; signal?: AbortSignal } = {},
): Promise<T> {
  const { data } = await withGpuQueueTimed(engineKey, () => fn(), opts);
  return data;
}

// ─── B5a. 向后兼容: withEngineLock 委托 withGpuQueue ────────────────────────
//
// 旧签名 (engineKey, fn) — 行为升级为全局队列 (旧版只按引擎串行), 显存预检
// 由调用方自己做 (与旧接入点 qwenTts/minimax-h3 的既有 ensureVram 调用兼容)。

export async function withEngineLock<T>(engineKey: string, fn: () => Promise<T>): Promise<T> {
  return withGpuQueue(engineKey, fn, { skipVram: true });
}

// ─── B5b. 服务级占用 (qwen_eye 等跨请求持锁的引擎) ──────────────────────────
//
// withGpuQueue 的锁在 fn 返回时释放 — 适合「一请求一作业」的引擎。
// qwen-eye 语义不同: allocate 拉起后服务常驻 (~14.7G), 占用横跨多个 HTTP 请求,
// 直到显式 /release 或 idle 超时。acquireEngineOccupancy 走同一把 GPU 锁,
// 但持锁直到 releaseEngineOccupancy 被调 — 期间 TTS/H3/music3 等在队列里等待。
//
// 2026-08-19 三期: 占用看门狗。opts.healthUrl 注册后按 intervalMs 轮询健康,
// 连续 failThreshold 次失败 → 自动 releaseEngineOccupancy (只解队列占位,
// 不停服务 — 服务生命周期归 GpuScheduler)。事故回归: :8125 死后无新请求,
// 占位孤儿化 5h+ → 看门狗 ≤ intervalMs×threshold 自愈。

/** 默认队列 GPU 索引 (env KAP_VRAM_GPU_INDEX / 1) — 供 llm 等模块引用 */
export const GPU_QUEUE_DEFAULT_INDEX = defaultGpuIndex();

const WATCHDOG_ENABLED = process.env.KAP_GPU_WATCHDOG !== "0";
const WATCHDOG_INTERVAL_MS = envInt("KAP_GPU_WATCHDOG_INTERVAL_MS", 30_000);
const WATCHDOG_FAIL_THRESHOLD = envInt("KAP_GPU_WATCHDOG_FAIL_THRESHOLD", 2);
const WATCHDOG_PROBE_TIMEOUT_MS = 3_000;

interface OccupancyWatch {
  engine: string;
  gpuIndex: number;
  healthUrl: string;
  intervalMs: number;
  threshold: number;
  fails: number;
  timer: ReturnType<typeof setTimeout>;
}

/** 占用看门狗注册表 key = `${gpuIndex}:${engine}` */
const occupancyWatches = new Map<string, OccupancyWatch>();

function watchKey(engine: string, gpuIndex: number): string {
  return `${gpuIndex}:${engine}`;
}

async function probeHealth(url: string): Promise<boolean> {
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(WATCHDOG_PROBE_TIMEOUT_MS) });
    return resp.ok;
  } catch {
    return false;
  }
}

function startOccupancyWatch(
  engine: string,
  gpuIndex: number,
  healthUrl: string,
  opts: { intervalMs?: number; failThreshold?: number } = {},
): void {
  const key = watchKey(engine, gpuIndex);
  stopOccupancyWatch(engine, gpuIndex); // 幂等: 重占用时重置计数
  const intervalMs = opts.intervalMs ?? WATCHDOG_INTERVAL_MS;
  const threshold = opts.failThreshold ?? WATCHDOG_FAIL_THRESHOLD;
  const watch: OccupancyWatch = {
    engine,
    gpuIndex,
    healthUrl,
    intervalMs,
    threshold,
    fails: 0,
    timer: null as unknown as OccupancyWatch["timer"],
  };
  watch.timer = setInterval(async () => {
    const healthy = await probeHealth(watch.healthUrl);
    if (healthy) {
      watch.fails = 0;
      return;
    }
    watch.fails += 1;
    console.warn(
      `[gpuQueue] watchdog ${engine} GPU${gpuIndex}: health FAIL ${watch.fails}/${watch.threshold} (${watch.healthUrl})`,
    );
    if (watch.fails >= watch.threshold) {
      const heldMs = Date.now() - (getGpuLock(gpuIndex).holder?.acquiredAt ?? Date.now());
      recordEvent({
        at: new Date().toISOString(),
        event: "watchdog_release",
        engine,
        gpuIndex,
        heldMs,
        detail: `health ${watch.healthUrl} failed ${watch.fails} consecutive probes`,
      });
      console.error(
        `[gpuQueue] watchdog_release ${engine} GPU${gpuIndex}: ${watch.fails} consecutive health failures — releasing occupancy (service lifecycle untouched)`,
      );
      releaseEngineOccupancy(engine, gpuIndex); // 内部会 stopOccupancyWatch
    }
  }, intervalMs);
  watch.timer.unref?.();
  occupancyWatches.set(key, watch);
  console.log(
    `[gpuQueue] watchdog on ${engine} GPU${gpuIndex}: ${watch.healthUrl} every ${intervalMs}ms, threshold ${threshold}`,
  );
}

function stopOccupancyWatch(engine: string, gpuIndex: number): void {
  const key = watchKey(engine, gpuIndex);
  const watch = occupancyWatches.get(key);
  if (watch) {
    clearInterval(watch.timer);
    occupancyWatches.delete(key);
  }
}

/** 占用看门狗观测 (测试/状态端点用) */
export function getOccupancyWatches(): Array<{
  engine: string;
  gpuIndex: number;
  healthUrl: string;
  fails: number;
  threshold: number;
}> {
  return Array.from(occupancyWatches.values()).map((w) => ({
    engine: w.engine,
    gpuIndex: w.gpuIndex,
    healthUrl: w.healthUrl,
    fails: w.fails,
    threshold: w.threshold,
  }));
}

export interface OccupancyOptions {
  /** 健康探测 URL — 传入即启用看门狗 (env KAP_GPU_WATCHDOG=0 全局关闭) */
  healthUrl?: string;
  watchdogIntervalMs?: number;
  watchdogFailThreshold?: number;
}

/**
 * 排队并持有 GPU 锁 (跨请求, 直到 releaseEngineOccupancy)。与 withGpuQueue
 * 共享同一把锁与等待队列。两种调用形态:
 *   a) 独立调用 — 排队 → 获得锁 → 持有到 release
 *   b) 在 withGpuQueue 的 fn 内调用 (qwen-eye allocate 模式) — 本请求已持锁,
 *      直接把 holder 对象「转交」给自己: 外层 withGpuQueue 的 release 变 no-op,
 *      锁由服务级占用接管直到 release。
 * ⚠️ granted 路径必须与 releaseEngineOccupancy 配对 (失败路径也要释放), 否则锁死队列。
 *    (看门狗是逃生网, 不是配对替代)
 */
export async function acquireEngineOccupancy(
  engineKey: string,
  gpuIndex: number = GPU_QUEUE_DEFAULT_INDEX,
  opts: OccupancyOptions = {},
): Promise<void> {
  const lock = getGpuLock(gpuIndex);
  const held = heldGpus.getStore();

  // 形态 b: 本异步上下文已持有该 GPU 的锁 → 转交 (不重新排队)
  if (held?.has(gpuIndex) && lock.holder) {
    lock.holder = { engine: engineKey, acquiredAt: lock.holder.acquiredAt, occupancy: true };
    recordEvent({
      at: new Date().toISOString(),
      event: "acquire",
      engine: engineKey,
      gpuIndex,
      detail: `service occupancy handoff from ${engineKey === lock.holder.engine ? engineKey : "outer holder"} (holds until releaseEngineOccupancy)`,
    });
    console.log(`[gpuQueue] acquire ${engineKey} GPU${gpuIndex} (service occupancy handoff — holds until release)`);
    if (opts.healthUrl && WATCHDOG_ENABLED) {
      startOccupancyWatch(engineKey, gpuIndex, opts.healthUrl, {
        intervalMs: opts.watchdogIntervalMs,
        failThreshold: opts.watchdogFailThreshold,
      });
    }
    return;
  }

  // 形态 a: 独立调用 — 排队等待 (同 deadline 语义)
  await enqueueAcquire(lock, engineKey, gpuIndex, {
    lockWaitTimeoutMs: LOCK_WAIT_TIMEOUT_MS,
    detail: `service occupancy; waiting behind ${lock.holder?.engine ?? "none"}`,
  });
  // enqueueAcquire 的 grant 写的 holder 没有 occupancy 标记 — 补上
  if (lock.holder?.engine === engineKey) lock.holder.occupancy = true;
  // 跨进程门控 (失败要归还占用再抛, 否则队列死锁)
  const gate = await getQueueGate();
  try {
    await gate.acquire(gpuIndex, engineKey, LOCK_WAIT_TIMEOUT_MS > 0 ? LOCK_WAIT_TIMEOUT_MS : 40 * 60 * 1000);
  } catch (err) {
    releaseEngineOccupancy(engineKey, gpuIndex);
    throw err;
  }
  recordEvent({
    at: new Date().toISOString(),
    event: "acquire",
    engine: engineKey,
    gpuIndex,
    detail: "service occupancy (holds until releaseEngineOccupancy)",
  });
  console.log(`[gpuQueue] acquire ${engineKey} GPU${gpuIndex} (service occupancy — holds until release)`);
  if (opts.healthUrl && WATCHDOG_ENABLED) {
    startOccupancyWatch(engineKey, gpuIndex, opts.healthUrl, {
      intervalMs: opts.watchdogIntervalMs,
      failThreshold: opts.watchdogFailThreshold,
    });
  }
}

/** 释放服务级占用 (唤醒队首等待者)。非持有者调用是 no-op (幂等)。 */
export function releaseEngineOccupancy(engineKey: string, gpuIndex: number = GPU_QUEUE_DEFAULT_INDEX): void {
  stopOccupancyWatch(engineKey, gpuIndex);
  const lock = getGpuLock(gpuIndex);
  if (lock.holder?.engine !== engineKey) return;
  const heldMs = Date.now() - lock.holder.acquiredAt;
  const next = lock.waiters.shift();
  if (next) {
    next.grant();
  } else {
    lock.holder = null;
  }
  void getQueueGate().then((gate) => gate.release(gpuIndex, engineKey)).catch(() => undefined);
  recordEvent({
    at: new Date().toISOString(),
    event: "release",
    engine: engineKey,
    gpuIndex,
    heldMs,
    detail: "service occupancy released",
  });
  console.log(`[gpuQueue] release ${engineKey} GPU${gpuIndex} (service occupancy held ${(heldMs / 1000).toFixed(1)}s)`);
}

// ─── B5c. 管理原语 (POST /api/production/gpu-queue/force-release 等, 2026-08-19) ──
//
// 运维手术刀 — 今天之前唯一能解孤儿占位的手段是重启进程 (清空整个内存队列)。
// forceReleaseOccupancy 只对**服务级占用** holder 生效: 作业中的普通 holder
// 强制放行会造成双引擎同卡 (fn 还在跑, release 是它的 finally 责任), 拒绝之。

export interface ForceReleaseResult {
  released: boolean;
  reason?: string;
  engine?: string;
  heldMs?: number;
}

export function forceReleaseOccupancy(
  engineKey?: string,
  gpuIndex: number = GPU_QUEUE_DEFAULT_INDEX,
): ForceReleaseResult {
  const lock = getGpuLock(gpuIndex);
  const holder = lock.holder;
  if (!holder) {
    return { released: false, reason: `GPU${gpuIndex} idle — nothing to release` };
  }
  if (engineKey && holder.engine !== engineKey) {
    return { released: false, reason: `GPU${gpuIndex} held by ${holder.engine}, not ${engineKey}`, engine: holder.engine };
  }
  if (!holder.occupancy) {
    return {
      released: false,
      reason: `GPU${gpuIndex} held by in-flight job ${holder.engine} (non-occupancy) — cannot force; wait for job completion`,
      engine: holder.engine,
    };
  }
  const heldMs = Date.now() - holder.acquiredAt;
  recordEvent({
    at: new Date().toISOString(),
    event: "admin_release",
    engine: holder.engine,
    gpuIndex,
    heldMs,
    detail: "force-released via admin API",
  });
  console.warn(`[gpuQueue] admin_release ${holder.engine} GPU${gpuIndex} (occupancy held ${(heldMs / 1000).toFixed(1)}s) — force release`);
  releaseEngineOccupancy(holder.engine, gpuIndex);
  return { released: true, engine: holder.engine, heldMs };
}

export function purgeWaiters(
  engineKey?: string,
  gpuIndex?: number,
): { purged: number } {
  let purged = 0;
  for (const [idx, lock] of gpuLocks) {
    if (gpuIndex !== undefined && idx !== gpuIndex) continue;
    // 倒序遍历 — evict 会 splice 数组
    for (let i = lock.waiters.length - 1; i >= 0; i--) {
      const w = lock.waiters[i];
      if (engineKey && w.engine !== engineKey) continue;
      recordEvent({
        at: new Date().toISOString(),
        event: "purged",
        engine: w.engine,
        gpuIndex: idx,
        waitMs: Date.now() - w.enqueuedAt,
        detail: "purged via admin API",
      });
      console.warn(`[gpuQueue] purged ${w.engine} GPU${idx} (waited ${Math.round((Date.now() - w.enqueuedAt) / 1000)}s) — admin purge`);
      w.evict(new QueuePurgedError({ engine: w.engine, gpuIndex: idx }));
      purged++;
    }
  }
  return { purged };
}

// ─── B6. 队列状态观测 (GET /api/production/gpu-queue) ───────────────────────

export interface GpuQueueWaiterInfo {
  engine: string;
  gpuIndex: number;
  waitedMs: number;
  position: number;
}

export interface GpuQueueStatus {
  /** 每张 GPU 当前持锁引擎 (null = 空闲) */
  holders: Record<number, { engine: string; acquiredAt: string; heldMs: number; occupancy: boolean } | null>;
  /** 各引擎当前排队数 */
  waitingByEngine: Record<string, number>;
  /** 锁获取顺序 (ENGINE_VRAM_REQUIREMENTS 键排序, 防死锁约定) */
  engineOrder: string[];
  /** 最近 20 条事件 */
  recentEvents: GpuQueueEvent[];
  /** 排队 waiter 明细 (2026-08-19 三期 — 管理面观测) */
  waiters: GpuQueueWaiterInfo[];
  /** 占用看门狗状态 */
  occupancyWatches: Array<{ engine: string; gpuIndex: number; healthUrl: string; fails: number; threshold: number }>;
}

export function getGpuQueueStatus(): GpuQueueStatus {
  const holders: GpuQueueStatus["holders"] = {};
  const waiters: GpuQueueWaiterInfo[] = [];
  for (const [gpuIndex, lock] of gpuLocks) {
    holders[gpuIndex] = lock.holder
      ? {
          engine: lock.holder.engine,
          acquiredAt: new Date(lock.holder.acquiredAt).toISOString(),
          heldMs: Date.now() - lock.holder.acquiredAt,
          occupancy: lock.holder.occupancy === true,
        }
      : null;
    lock.waiters.forEach((w, i) => {
      waiters.push({
        engine: w.engine,
        gpuIndex,
        waitedMs: Date.now() - w.enqueuedAt,
        position: i + 1,
      });
    });
  }
  return {
    holders,
    waitingByEngine: Object.fromEntries(waitingByEngine),
    engineOrder: ENGINE_ORDER,
    recentEvents: eventRing.slice(-20),
    waiters,
    occupancyWatches: getOccupancyWatches(),
  };
}
