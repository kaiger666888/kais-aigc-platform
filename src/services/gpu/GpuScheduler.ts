/**
 * src/services/gpu/GpuScheduler.ts — GPU 显存调度器核心
 *
 * 项目级基础设施, 管理 RTX 3090 (24GB) 上的所有 GPU 服务。
 *
 * 设计原则:
 *   - 所有 GPU 服务按需拉起, 空闲超时后自动释放 (idleTimeoutMs=0 的除外)
 *   - 显存不足时自动暂停低优先级服务
 *   - 服务状态通过 nvidia-smi + 健康检查端点监控
 *   - 支持服务变体 (同一服务的不同模型/配置)
 */

import { execFile } from "child_process";
import { promisify } from "util";
import axios from "axios";
// 2026-08-19 (docs/gpu-unified-scheduling-plan.md D5): 停服务时联动释放
// gpuVramManager 的服务级占位 — 此前 idle 超时/GpuScheduler.release 只停服务,
// 队列占位残留孤儿化 (ep-ccport-test01 p11a 5h 死锁的 D5 因子)。
// M1 双卡调度: scheduling 快照的 queueDepth 亦从其 waiters 聚合 (§2.5)。
import { releaseEngineOccupancy, getGpuQueueStatus, gpuFloorMib } from "@/lib/gpuVramManager";
// 双3090 Phase A (docs/gpu-dual-3090-expansion.md): 角色→UUID→索引解析库。
// 索引一律运行时解析 (PCIe 枚举漂移免疫); 全链失败静默回退硬编码, 绝不抛异常。
import { getGpuDevices, resolveServiceIndex, resolveServiceIndexSync } from "./gpuRoles";
// M1 双卡调度 (docs/gpu-scheduling-architecture.md): 优先级类校验 (纯函数)。
import {
  validatePriorityOptions,
  isDevClass,
  DEFAULT_DEV_TTL_MIN,
  MAX_DEV_TTL_MIN,
} from "./priority";
import type {
  GpuDevice,
  ServiceProfile,
  ServiceState,
  ServiceStatus,
  ServiceStartMethod,
  AllocationRequest,
  AllocationResult,
  SchedulerState,
  PriorityClass,
  DevTtlState,
  GpuPreemptState,
  GpuSchedulingEntry,
  SchedulingSnapshot,
  SchedulingEvent,
  PersonaGateVerdict,
} from "./types";
import type { StateStore } from "./stateStore";
import { MemoryStateStore } from "./memoryStateStore";

const execFileAsync = promisify(execFile);

// ─── 服务注册表 ───────────────────────────────────────

/**
 * 注册所有 GPU 服务档案。
 * 在实际使用中可以从配置文件/YAML加载, 这里先硬编码已知服务。
 */
export function getRegisteredServices(): ServiceProfile[] {
  return [
    // ComfyUI Primary — GPU 1 (3090), 仅在 VRAM 不足时被踢
    // ⚠️ 2026-08-19 D9 排查注记: 容器本体在跑 (docker ps 可见), 但宿主机上另存在
    // 容器外手动拉起的裸 ComfyUI 进程 (python3.13 ./ComfyUI/main.py) — 它们不在
    // 本注册表管辖内, 生命周期指令 (docker start/stop) 对其无效。裸进程的清除走
    // ensureVram 尾部的 killExternalGpuProcesses (scripts/gpu-kill-external.sh,
    // operator 部署到 /usr/local/bin; R2 2026-09-06 复活接线, 之前是零调用死代码) —
    // 只在注册表驱逐完仍不足时触发, 且脚本自带容器/守护进程/常驻引擎防误杀护栏;
    // 新增服务前先确认没有重复的手动实例在跑 (docs/gpu-unified-scheduling-plan.md §D9)。
    {
      id: "comfyui-primary",
      name: "ComfyUI Primary",
      gpuId: 1,
      vramEstMb: 14_700,
      priority: 0,
      category: "comfyui",
      start: { type: "docker-start", containerName: "comfyui-primary" },
      stop: { type: "docker-stop", containerName: "comfyui-primary" },
      healthUrl: "http://127.0.0.1:8188/system_stats",
      healthTimeoutMs: 10_000,
      idleTimeoutMs: 0,
    },
    // ComfyUI Auxiliary — GPU 0 (3060Ti), 空闲 10min 释放 (D9 注记同上)
    // 双3090 Phase A: 不写 gpuRole, 默认按 id 命中 conf `comfyui-auxiliary_role=AUX_LIGHT`
    // (chatterbox 同理) → AUX_LIGHT_UUID=3060Ti → 索引 0 = gpuId 兜底值, 行为不变。
    {
      id: "comfyui-auxiliary",
      name: "ComfyUI Auxiliary",
      gpuId: 0,
      // 2026-09-06: 6400 → 2800。GPU0 启用桌面空闲地板 (gpuVramManager B2a,
      // floor=1792) 后, 旧 6400 (非 lowvram 全量口径) + floor = 8192 = 物理总量,
      // allocate 预检结构性拒绝上卡。2800 = --lowvram 实测峰值 ~2.5G + 余量;
      // 2800+1792=4592 ≤ 静止桌面态 free~5600, GUI 峰值态 free~4300 自动拒上 — 恰是想要的语义。
      vramEstMb: 2_800,
      priority: 0,
      category: "comfyui",
      start: { type: "docker-start", containerName: "comfyui-auxiliary" },
      stop: { type: "docker-stop", containerName: "comfyui-auxiliary" },
      healthUrl: "http://127.0.0.1:8189/system_stats",
      healthTimeoutMs: 10_000,
      idleTimeoutMs: 10 * 60 * 1000,
    },
    // CosyVoice — GPU 1 (3090), 空闲 10min 释放
    {
      id: "cosyvoice",
      name: "CosyVoice TTS (bilingual)",
      gpuId: 1,
      // 实际宿主是 kais-gold-team 容器 (tts_manager.py) → 角色键跟 conf 的
      // kais-gold-team_role 走, 不用 profile.id (conf 无 cosyvoice_role 行)。
      gpuRole: "kais-gold-team",
      vramEstMb: 3_500,
      priority: 1,
      category: "tts",
      start: { type: "script", command: "python3", args: ["/home/kai/workspace/kais-gold-team/scripts/tts_manager.py", "start", "bilingual"] },
      stop: { type: "script", command: "python3", args: ["/home/kai/workspace/kais-gold-team/scripts/tts_manager.py", "stop", "bilingual"] },
      healthUrl: null,
      healthTimeoutMs: 10_000,
      idleTimeoutMs: 10 * 60 * 1000,
    },
    // Chatterbox — GPU 0 (3060Ti), 空闲 10min 释放
    {
      id: "chatterbox",
      name: "Chatterbox TTS (en)",
      gpuId: 0,
      vramEstMb: 2_800,
      priority: 1,
      category: "tts",
      start: { type: "script", command: "python3", args: ["/home/kai/workspace/kais-gold-team/scripts/tts_manager.py", "start", "en"] },
      stop: { type: "script", command: "python3", args: ["/home/kai/workspace/kais-gold-team/scripts/tts_manager.py", "stop", "en"] },
      healthUrl: null,
      healthTimeoutMs: 10_000,
      idleTimeoutMs: 10 * 60 * 1000,
    },
    // LoRA Trainer — GPU 1 (3090), 按需启动
    {
      id: "lora-trainer",
      name: "FLUX LoRA Trainer",
      gpuId: 1,
      vramEstMb: 15_000, // fp8_base 模式约 14GB
      priority: 3, // 低优先级, 可被高优先级服务踢
      category: "training",
      start: { type: "docker-start", containerName: "kais-lora-trainer" },
      stop: { type: "docker-stop", containerName: "kais-lora-trainer" },
      healthUrl: "http://127.0.0.1:8070/health",
      healthTimeoutMs: 30_000,
      idleTimeoutMs: 30 * 60 * 1000, // 30min idle 后释放
    },
    // Qwen3.8-27B local LLM — GPU 1 (3090), 串行调度 (渲染高峰时可被驱逐让位)
    // 2026-08-19 起 q4-only: GPU1 串行独占策略, q3 共存档退役 (13.4G 文件已删)。
    {
      id: "qwen-llm",
      name: "Qwen3.8-27B LLM (llama.cpp, UD-Q4_K_XL)",
      gpuId: 1,
      // 双3090 Phase A: gpuRole = gpu.conf 服务键 (此处与 id 同名, 插卡日 conf 翻
      // qwen-llm_role=QC_GEN2 即切卡, 免改代码); 缺省本就用 id, 显式写出作机制示例。
      gpuRole: "qwen-llm",
      vramEstMb: 20_500, // Q4 独占档 17.9G 权重 + 64K ctx 双 slot KV; kap-llm NEED_MB 20500 同源
      priority: 2, // 高于 comfyui(0)/tts(1), 低于 lora-trainer(3); 常驻低频服务, 渲染时让位
      category: "llm",
      start: { type: "script", command: "bash", args: ["/opt/qwen-llm/kap-llm.sh", "start", "q4"], timeoutMs: 600_000 }, // 脚本内 VRAM 窗口等待 ≤280s + q4 NTFS 冷读 wait_ready ≤240s
      stop: { type: "script", command: "bash", args: ["/opt/qwen-llm/kap-llm.sh", "stop"] },
      healthUrl: "http://127.0.0.1:8125/health",
      healthTimeoutMs: 360_000, // 外层保险 (脚本内 wait_ready 240s 已兜底); 17.9G NTFS 冷读
      idleTimeoutMs: 30 * 60 * 1000, // 30min 空闲释放
    },
    // Qwen3-Omni-30B-A3B audio LLM — GPU 1 (3090), 音频判定引擎 qwen-ear (:8126)。
    // 与 qwen-llm (qwen-eye) 显存互斥 (13.4~17.9GB + 19.9GB > 24GB): 单卡放不下双驻留,
    // ensureVram 按 VRAM 需求互相驱逐 — 先到先得, 后到 allocate 踢掉先到。
    {
      id: "qwen-ear",
      name: "Qwen3-Omni-30B-A3B audio LLM (llama.cpp)",
      gpuId: 1,
      vramEstMb: 21_500, // Q4_K_M 18.56GB + mmproj-Q8_0 1.33GB + KV/计算余量 (kap-ear.sh NEED_MB 同源)
      priority: 2, // 与 qwen-llm 同级 (常驻低频判定服务)
      category: "llm",
      start: { type: "script", command: "bash", args: ["/opt/qwen-ear/kap-ear.sh", "start"], timeoutMs: 600_000 }, // 脚本内 VRAM 窗口等待 ≤280s + NTFS 冷读 wait_ready ≤300s
      stop: { type: "script", command: "bash", args: ["/opt/qwen-ear/kap-ear.sh", "stop"], timeoutMs: 60_000 },
      healthUrl: "http://127.0.0.1:8126/health",
      healthTimeoutMs: 330_000, // 外层保险 (脚本内 wait_ready 300s 已兜底); 18.6GB NTFS 冷读
      idleTimeoutMs: 30 * 60 * 1000, // 30min 空闲释放 (与 qwen-llm 同策略)
    },
    // Qwen3.8-27B vLLM (Huihui-Abliterated W4A16) — GPU 1, 纯文本批量推理档 :18020。
    // 2026-08-29 收编: 之前是调度盲区(手动 qwen38.sh 拉起), 渲染/p11c 拉起 :8125 时抢卡。
    // 与 qwen-llm(:8125) 显存互斥 (17.5G + 20.5G > 24G), ensureVram 按 VRAM 互相驱逐。
    {
      id: "qwen-vllm",
      name: "Qwen3.8-27B vLLM (Huihui-Abliterated W4A16, batch)",
      gpuId: 1,
      vramEstMb: 17_500,
      priority: 2, // 与 qwen-llm/qwen-ear 同级 (常驻低频服务, 渲染时让位)
      category: "llm",
      start: { type: "script", command: "bash", args: ["/opt/qwen-llm/kap-llm.sh", "start", "vllm-huihui"], timeoutMs: 1_200_000 },
      stop: { type: "script", command: "bash", args: ["/opt/qwen-llm/kap-llm.sh", "stop"], timeoutMs: 120_000 },
      healthUrl: "http://127.0.0.1:18020/health",
      healthTimeoutMs: 960_000,
      idleTimeoutMs: 30 * 60 * 1000,
    },
  ];
}

// ─── 服务 ↔ 队列占用映射 (2026-08-19 D5 联动) ─────────────────────────────
//
// GpuScheduler 管**服务生命周期** (docker/script 拉停), gpuVramManager 管**队列
// 占位** — 两层各管各的导致停服务后占位残留。此映射让 release() 停完服务后
// 顺手解掉对应引擎的队列占位 (releaseEngineOccupancy 幂等: 非持有者 no-op)。
const SERVICE_TO_QUEUE_ENGINE: Record<string, { engine: string }> = {
  "qwen-llm": { engine: "qwen_eye" }, // :8125 ↔ llm 路由的 QWEN_EYE_QUEUE_KEY
  "qwen-ear": { engine: "qwen_ear" }, // :8126 ↔ ear 路由
};

// ─── GPU 设备 ─────────────────────────────────────────

/**
 * 兼容导出 — 模块加载时经 gpuRoles.getGpuDevices() 探测一次的快照
 * (nvidia-smi 失败静默回退今日两卡硬编码, 启动路径零异常)。
 * 动态视图 (插卡后 3 卡 / getState 实时设备表) 请用 getGpuDevices();
 * 本常量仅为既有 import 点 (services/gpu/index.ts, scripts/verify-phase-23.ts) 保形。
 */
export const GPU_DEVICES: GpuDevice[] = getGpuDevices();

/**
 * Profile → 当前 GPU 索引 (双3090 Phase A 角色化)。
 * 解析链: profile.gpuRole ?? profile.id → gpu.conf `<键>_role` → 角色 → UUID
 * → nvidia-smi 实时索引 (进程内 5s TTL 缓存); 任何一环失败落回 profile.gpuId
 * 静态值 (= 今日拓扑), 不抛异常。
 */
export function profileGpuIndex(profile: ServiceProfile): number {
  return resolveServiceIndexSync(profile.gpuRole ?? profile.id) ?? profile.gpuId;
}

// ─── 调度器类 ─────────────────────────────────────────

const LOCK_TTL_MS = 5 * 60 * 1000; // 5 min — must exceed any single allocate() duration

/** M1 T1 边界让卡上限 (docs/gpu-scheduling-architecture.md §2.2: 上限 15min, 超时自动升 T2) */
const T1_TIMEOUT_MS_DEFAULT = 15 * 60 * 1000;
/** T1/dev-TTL 等待轮询间隔 (默认 2s; 测试可注入缩短) */
const WAIT_POLL_MS_DEFAULT = 2_000;
/** preempt/TTL 状态的 store KV 镜像键前缀 (跨进程观测; 计时器仍在进程内) */
const PREEMPT_KV_PREFIX = "preempt:";

/**
 * 调度器可注入参数 (M1 双卡调度)。全部可选 — 缺省即生产语义, 仅为单测 hermetic 而设。
 */
export interface SchedulerTuningOpts {
  /** 时钟 (TTL/preempt 截止判定; 缺省 Date.now。测试注入假钟做时间跳跃) */
  now?: () => number;
  /** T1 边界让卡上限 ms (缺省 15min) */
  t1TimeoutMs?: number;
  /** T1/persona 等待轮询间隔 ms (缺省 2s) */
  waitPollMs?: number;
  /** 等待休眠原语 (缺省 setTimeout; 测试注入即时返回) */
  sleep?: (ms: number) => Promise<void>;
}

/** preempt 记录的进程内形态 (公开快照用 GpuPreemptState, 不暴露 waiters) */
interface PreemptRuntime extends GpuPreemptState {
  /** 正在等待让卡的 dev 请求数 (0 = 无人等待, 超时/放弃时可能撤销记录) */
  waiters: number;
}

export class GpuScheduler {
  /** In-process service state cache. Authoritative within this process. */
  private services = new Map<string, ServiceState>();
  /** In-process profile cache (immutable after construction). */
  private profilesCache = new Map<string, ServiceProfile>();
  /**
   * StateStore backend (memory or redis).
   * Authoritative for locks (cross-process coordination).
   * Services are mirrored here for cross-process observability.
   */
  private store: StateStore;
  /** Idle timers are always in-process (Node setTimeout doesn't serialize). */
  private idleTimers = new Map<string, NodeJS.Timeout>();
  /** Resolves when initial state has been registered into the store. */
  private initialized: Promise<void>;

  // ─── M1 双卡调度状态 (docs/gpu-scheduling-architecture.md) ──────────────
  /** per-GPU preempt/TTL 记录 (phase: requested=打断窗口 / held=dev 占卡中) */
  private preempts = new Map<number, PreemptRuntime>();
  /** dev-TTL 到期计时器 (进程内; 惰性扫描兜底, 见 sweepExpiredPreempts) */
  private ttlTimers = new Map<number, NodeJS.Timeout>();
  /** 调度事件环 (preempt/TTL 生命周期; 新的在尾) */
  private events: SchedulingEvent[] = [];
  /** 可注入时钟/参数 */
  private tuning: Required<Pick<SchedulerTuningOpts, "now" | "t1TimeoutMs" | "waitPollMs">> & Pick<SchedulerTuningOpts, "sleep">;
  /**
   * M2 persona 闸门 (PersonaArbiter 注入; null = 未挂闸门, allocate 直通 = 今日行为)。
   * gate(serviceId) 返回 {wait:true} 时 allocate 阻塞等待至放行/截止;
   * 截止后调 onGateTimeout (仲裁器收卡回人格 A) 再放行 — T1 ≤15min 语义。
   */
  private personaGate: ((serviceId: string) => PersonaGateVerdict) | null = null;
  private personaGateTimeout: ((serviceId: string) => Promise<void>) | null = null;

  constructor(store?: StateStore, opts?: SchedulerTuningOpts) {
    this.store = store ?? new MemoryStateStore();
    this.tuning = {
      now: opts?.now ?? Date.now,
      t1TimeoutMs: opts?.t1TimeoutMs ?? T1_TIMEOUT_MS_DEFAULT,
      waitPollMs: opts?.waitPollMs ?? WAIT_POLL_MS_DEFAULT,
      sleep: opts?.sleep,
    };
    this.initialized = this.initialize();
  }

  /** M2: 注入 persona 闸门 (getPersonaArbiterAsync 装配; 传 null 卸载)。 */
  setPersonaArbiterHooks(
    gate: ((serviceId: string) => PersonaGateVerdict) | null,
    onGateTimeout?: ((serviceId: string) => Promise<void>) | null,
  ): void {
    this.personaGate = gate;
    this.personaGateTimeout = onGateTimeout ?? null;
  }

  /** M2: 调度器底层 StateStore (PersonaArbiter 共用同一后端做跨进程持久化)。 */
  get stateStore(): StateStore {
    return this.store;
  }

  private async initialize(): Promise<void> {
    for (const profile of getRegisteredServices()) {
      this.profilesCache.set(profile.id, profile);
      await this.store.setProfile(profile.id, profile);
      // Register initial "stopped" state into the store ONLY if no prior state exists
      // (so a second process booting up doesn't clobber an active service state
      // written by the first process).
      const existing = await this.store.getService(profile.id);
      if (!existing) {
        const initial: ServiceState = {
          profileId: profile.id,
          variantId: null,
          status: "stopped",
          instanceId: null,
          actualVramMb: 0,
          lastTransitionAt: null,
          lastRequestAt: null,
        };
        this.services.set(profile.id, initial);
        await this.store.setService(profile.id, initial);
      } else {
        // Adopt the state another process already wrote (so getState() is accurate).
        this.services.set(profile.id, existing);
      }
    }
  }

  /** Backend kind for diagnostics. */
  get backendKind(): "memory" | "redis" {
    return this.store.kind;
  }

  /**
   * Mirror a service state update to the store (fire-and-forget).
   * Lets other processes observe this process's actions via getState().
   */
  private mirrorService(serviceId: string, state: ServiceState): void {
    this.store.setService(serviceId, state).catch((err) => {
      console.warn(`[GpuScheduler] store.setService mirror failed for ${serviceId}:`, err);
    });
  }

  // ─── GPU Query ─────────────────────────────────────

  async getGpuVramFree(gpuId: number): Promise<number> {
    try {
      const { stdout } = await execFileAsync("nvidia-smi", [
        "--query-gpu=memory.free",
        "--format=csv,noheader,nounits",
        `--id=${gpuId}`,
      ]);
      return parseInt(stdout.trim(), 10) || 0;
    } catch {
      return 0;
    }
  }

  async getGpuVramUsed(gpuId: number): Promise<number> {
    try {
      const { stdout } = await execFileAsync("nvidia-smi", [
        "--query-gpu=memory.used",
        "--format=csv,noheader,nounits",
        `--id=${gpuId}`,
      ]);
      return parseInt(stdout.trim(), 10) || 0;
    } catch {
      return 0;
    }
  }

  // ─── 服务生命周期 ──────────────────────────────────

  // protected: 单测子类桩化 (docker/script 零接触); 生产行为不变
  protected async executeStartStep(profile: ServiceProfile, envVars?: Record<string, string>): Promise<void> {
    const steps = Array.isArray(profile.start) ? profile.start : [profile.start];
    for (const step of steps) {
      switch (step.type) {
        case "docker": {
          // Build docker run command
          const mergedEnv = { ...step.envVars, ...envVars };
          const envFlags = Object.entries(mergedEnv).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
          const volFlags = Object.entries(step.volumes || {}).flatMap(([host, container]) => ["-v", `${host}:${container}`]);
          const args = [
            "run", "-d", "--gpus", getGpuDevices().find(g => g.id === profileGpuIndex(profile))?.gpusFlag || '"device=1"',
            "--name", step.containerName,
            ...step.runArgs, ...envFlags, ...volFlags, step.image,
          ];
          await execFileAsync("docker", args, { timeout: 30_000 });
          break;
        }
        case "docker-start":
          await execFileAsync("docker", ["start", step.containerName], { timeout: 30_000 });
          break;
        case "script":
          await execFileAsync(step.command, step.args, { timeout: step.timeoutMs ?? 30_000, cwd: step.cwd });
          break;
        case "http-ready":
          // Wait for URL to be reachable
          const start = Date.now();
          while (Date.now() - start < step.timeoutMs) {
            try {
              await axios.get(step.url, { timeout: 3_000 });
              return;
            } catch { await new Promise(r => setTimeout(r, 5_000)); }
          }
          throw new Error(`HTTP ready timeout: ${step.url}`);
        case "internal":
          throw new Error("Internal start method not supported yet");
      }
    }
  }

  protected async executeStopStep(profile: ServiceProfile): Promise<void> {
    const steps = profile.stop ? (Array.isArray(profile.stop) ? profile.stop : [profile.stop])
      : this.inferStopSteps(profile);
    for (const step of steps) {
      switch (step.type) {
        case "docker-stop":
          try { await execFileAsync("docker", ["stop", step.containerName], { timeout: 30_000 }); } catch { /* ok */ }
          try { await execFileAsync("docker", ["rm", step.containerName], { timeout: 10_000 }); } catch { /* ok */ }
          break;
        case "script":
          try { await execFileAsync(step.command, step.args, { timeout: 15_000 }); } catch { /* ok */ }
          break;
      }
    }
  }

  private inferStopSteps(profile: ServiceProfile): ServiceStartMethod[] {
    const startSteps = Array.isArray(profile.start) ? profile.start : [profile.start];
    return startSteps.map(s => {
      switch (s.type) {
        case "docker": return { type: "docker-stop" as const, containerName: s.containerName };
        case "docker-start": return { type: "docker-stop" as const, containerName: s.containerName };
        case "script": return { type: "script" as const, command: s.command, args: s.args };
        default: return { type: "script" as const, command: "true", args: [] };
      }
    });
  }

  // ─── 核心分配 ─────────────────────────────────────

  /**
   * 请求 GPU 资源分配。
   * 如果需要, 自动暂停低优先级服务; 拉起目标服务; 等待就绪。
   *
   * M1 双卡调度扩展 (docs/gpu-scheduling-architecture.md §2.1-§2.3):
   *   - priorityClass/force/ttlMin 三元组入口校验, 非法组合直接拒绝
   *   - T0 停派发: dev 打断/占用期间, 该卡的新 prod allocate 立即拒绝 (preempted:true)
   *   - T1 边界让卡 (dev 非 force 默认): 等 prod 在跑任务收尾让卡, 上限 15min 超时升 T2
   *   - T2 硬杀 (仅 dev-P0+force / T1 超时): 走既有 ensureVram 驱逐, 受害者标 evictedForDev
   *   - dev-TTL: dev 占卡默认 120min (上限 480), 到期自动归还 (停 dev 服务+清 preempt)
   * 缺省 (无 priorityClass = prod-P3, 无 preempt 记录) 时以上分支全部不进入 = 今日行为。
   */
  async allocate(req: AllocationRequest): Promise<AllocationResult> {
    await this.initialized;
    const startTime = this.tuning.now();

    // ─── M1: 优先级三元组校验 (纯函数; 非法组合零调度动作直接拒绝) ───
    const pv = validatePriorityOptions(req);
    if (!pv.ok) {
      return {
        granted: false, serviceId: req.serviceId, variantId: null, accessUrl: null,
        scheduledMs: 0, error: pv.reason,
        ...(req.priorityClass !== undefined ? { priorityClass: req.priorityClass } : {}),
      };
    }
    const { priorityClass: effectiveClass, force, ttlMin } = pv.value;
    const isDev = isDevClass(effectiveClass);

    const profile = this.profilesCache.get(req.serviceId);
    if (!profile) {
      return { granted: false, serviceId: req.serviceId, variantId: null, accessUrl: null, scheduledMs: 0, error: `Unknown service: ${req.serviceId}` };
    }

    // 双3090 Phase A: profile.gpuId 只是静态兜底, 实际索引按 gpu.conf 角色链运行时解析
    // (UUID→index 查询; 解析失败落 profile.gpuId, 不抛异常)。锁/驱逐/启动全程用同一索引。
    const gpuIndex = profileGpuIndex(profile);

    // ─── M1-T0 停派发: dev 打断/占用期间, prod 新派发立即拒绝 (在跑任务不受影响) ───
    // 调用方拿到 preempted:true 后可改投另一张卡或排队 (自动重排属 M3)。
    const existingPreempt = this.preempts.get(gpuIndex);
    if (!isDev && existingPreempt) {
      this.pushEvent({
        type: "prod-rejected-t0", gpuIndex, requester: req.caller,
        detail: { serviceId: req.serviceId, holder: existingPreempt.requester, phase: existingPreempt.phase, holderClass: existingPreempt.priorityClass },
      });
      return {
        granted: false, serviceId: req.serviceId, variantId: null, accessUrl: null,
        scheduledMs: 0, preempted: true, preemptInfo: publicPreemptView(existingPreempt),
        error: `GPU ${gpuIndex} 正被 dev 打断/占用 (${existingPreempt.priorityClass} by ${existingPreempt.requester}, phase=${existingPreempt.phase}) — 请改投其他卡或等待归还`,
        ...(req.priorityClass !== undefined ? { priorityClass: effectiveClass } : {}),
      };
    }

    // Record request time
    const state = this.services.get(req.serviceId)!;
    state.lastRequestAt = new Date(this.tuning.now()).toISOString();
    this.mirrorService(req.serviceId, state);

    // Reset idle timer (if any)
    this.resetIdleTimer(req.serviceId);

    // ─── M2: persona 闸门 (PersonaArbiter 注入; B 渲染溢出期间 QC allocate 走 T1 等待 ≤15min) ───
    if (this.personaGate) {
      const gatePassed = await this.awaitPersonaGate(req.serviceId, startTime, req.waitTimeoutMs);
      if (!gatePassed) {
        return {
          granted: false, serviceId: req.serviceId, variantId: null, accessUrl: null,
          scheduledMs: this.tuning.now() - startTime,
          error: "persona 等待被调用方 waitTimeoutMs 截断 (QC 服务在人格 B 期间排队让卡中)",
        };
      }
    }

    // Already running + healthy with correct variant?
    if (state.status === "healthy" && state.variantId === (req.variantId || null)) {
      // Verify real liveness — in-process state can be stale (external stop / crash / reboot)
      if (profile.healthUrl) {
        const alive = await this.checkServiceAlive(profile);
        if (!alive) {
          console.warn(`[GpuScheduler] ${req.serviceId} memory state "healthy" but health check failed — falling through to restart`);
          state.status = "stopped";
          this.mirrorService(req.serviceId, state);
        } else {
          // M1: 快速路径 = 服务已驻留, 未发生占卡 — 只记观测字段, 不建 preempt/TTL
          state.priorityClass = effectiveClass;
          this.mirrorService(req.serviceId, state);
          return { granted: true, serviceId: req.serviceId, variantId: state.variantId, accessUrl: profile.healthUrl, scheduledMs: this.tuning.now() - startTime };
        }
      } else {
        state.priorityClass = effectiveClass;
        this.mirrorService(req.serviceId, state);
        return { granted: true, serviceId: req.serviceId, variantId: state.variantId, accessUrl: profile.healthUrl, scheduledMs: this.tuning.now() - startTime };
      }
    }

    // Acquire GPU lock via store (atomic cross-process when Redis-backed)
    const acquired = await this.store.acquireLock(gpuIndex, req.caller, LOCK_TTL_MS);
    if (!acquired) {
      // Check if we already hold it (re-entrance is allowed)
      const current = await this.store.getLock(gpuIndex);
      if (current !== req.caller) {
        return { granted: false, serviceId: req.serviceId, variantId: null, accessUrl: null, scheduledMs: 0, error: `GPU ${gpuIndex} locked by ${current}` };
      }
    }
    // Auto-release safety net (in-process; TTL in store is the cross-process safety net)
    let lockTimeout: NodeJS.Timeout | null = null;
    const autoReleaseLock = async () => {
      if (lockTimeout) clearTimeout(lockTimeout);
      await this.store.releaseLock(gpuIndex, req.caller);
    };
    lockTimeout = setTimeout(() => { void autoReleaseLock(); }, LOCK_TTL_MS);

    // M1 dev 打断记录 (锁内维护, 所有退出路径在 finally 清理 waiters)
    let devPreemptRec: PreemptRuntime | null = null;
    let grantedResult: AllocationResult | null = null;

    try {
      const variant = req.variantId && profile.variants
        ? profile.variants.find(v => v.variantId === req.variantId) || profile.variants[0]
        : profile.variants?.[0]; // default variant

      const targetVram = variant?.vramEstMb || profile.vramEstMb;

      // ─── M1-T1/T2: dev 请求的打断语义 (锁内, per-GPU 原子) ───
      if (isDev) {
        const busy = this.runningServicesOnGpu(gpuIndex, req.serviceId);
        devPreemptRec = this.joinOrCreatePreempt(gpuIndex, {
          requester: req.caller,
          priorityClass: effectiveClass,
          force,
          tier: force ? "T2" : "T1",
          holderServiceId: req.serviceId,
          announce: busy.length > 0 || force,
        });
        if (busy.length > 0 && !force) {
          // T1 边界让卡: 等 prod 在跑任务收尾; 上限 15min, 超时自动升 T2
          const t1DeadlineMs = Date.parse(devPreemptRec.deadlineAt);
          const callerCapMs = req.waitTimeoutMs !== undefined ? startTime + req.waitTimeoutMs : Infinity;
          if (callerCapMs < t1DeadlineMs) {
            // 调用方自设更短预算: 到点放弃 (不升级 T2), finally 撤销记录
            await this.waitForBoundaryYield(gpuIndex, req.serviceId, Math.min(t1DeadlineMs, callerCapMs));
            return {
              granted: false, serviceId: req.serviceId, variantId: null, accessUrl: null,
              scheduledMs: this.tuning.now() - startTime, priorityClass: effectiveClass,
              error: `GPU ${gpuIndex} 的 T1 让卡等待被调用方 waitTimeoutMs 截断 (${Math.round(req.waitTimeoutMs! / 1000)}s) — preempt 已保留, 可重试或改投其他卡`,
            };
          }
          const outcome = await this.waitForBoundaryYield(gpuIndex, req.serviceId, t1DeadlineMs);
          if (outcome === "timeout") {
            devPreemptRec.tier = "T2";
            devPreemptRec.force = true;
            void this.mirrorPreempt(devPreemptRec);
            this.pushEvent({
              type: "t1-timeout-escalated", gpuIndex, requester: req.caller,
              detail: { serviceId: req.serviceId, waitedMs: this.tuning.now() - startTime, deadlineAt: devPreemptRec.deadlineAt },
            });
            // 落回下方 ensureVram 驱逐路径 (= T2 硬杀), 受害者标 evictedForDev
          }
        }
        // force=true: 不等待, 直接 T2 (ensureVram 驱逐)
      }

      // Evict lower-priority services if needed
      const evicted = await this.ensureVram(gpuIndex, targetVram, profile.priority, req.caller);
      let evictedForDev: string[] | undefined;
      if (isDev && evicted.length > 0) {
        evictedForDev = evicted;
        this.pushEvent({
          type: "t2-evicted", gpuIndex, requester: req.caller,
          detail: { evictedForDev: evicted, forced: force, tier: devPreemptRec?.tier ?? "T2" },
        });
      }

      // Start the target service
      state.status = "starting";
      state.lastTransitionAt = new Date(this.tuning.now()).toISOString();
      this.mirrorService(req.serviceId, state);

      const envVars = variant?.envVars;
      await this.executeStartStep(profile, envVars);

      // Wait for healthy
      if (profile.healthUrl) {
        state.status = "starting";
        this.mirrorService(req.serviceId, state);
        const healthy = await this.waitForHealthy(profile);
        state.status = healthy ? "healthy" : "error";
        this.mirrorService(req.serviceId, state);
        if (!healthy) {
          return {
            granted: false, serviceId: req.serviceId, variantId: variant?.variantId || null, accessUrl: null,
            scheduledMs: this.tuning.now() - startTime, evictedServices: evicted,
            ...(evictedForDev ? { evictedForDev } : {}), error: "Service failed health check",
          };
        }
      } else {
        // No health check — assume started
        state.status = "running";
        this.mirrorService(req.serviceId, state);
      }

      state.variantId = variant?.variantId || null;
      state.instanceId = profile.id;
      // M1: 记录生效优先级类 (scheduling API 优先级分布的观测来源)
      state.priorityClass = effectiveClass;
      this.mirrorService(req.serviceId, state);

      // Set idle auto-release timer (use profile's configured timeout)
      const autoRelease = req.autoRelease !== false;
      const idleTimeout = req.idleTimeoutMs ?? profile.idleTimeoutMs;
      if (autoRelease && idleTimeout > 0) {
        this.setIdleTimer(req.serviceId, idleTimeout);
      }

      // ─── M1: dev granted → preempt 转 held + TTL 起算 ───
      let devTtl: DevTtlState | undefined;
      if (isDev && devPreemptRec) {
        devTtl = this.promotePreemptToHeld(devPreemptRec, req.serviceId, ttlMin ?? DEFAULT_DEV_TTL_MIN) ?? undefined;
      }

      grantedResult = {
        granted: true, serviceId: req.serviceId, variantId: state.variantId, accessUrl: profile.healthUrl,
        scheduledMs: this.tuning.now() - startTime, evictedServices: evicted,
        ...(evictedForDev ? { evictedForDev } : {}),
        ...(req.priorityClass !== undefined ? { priorityClass: effectiveClass } : {}),
        ...(devTtl ? { devTtl } : {}),
      };
      return grantedResult;
    } catch (err: any) {
      state.status = "error";
      this.mirrorService(req.serviceId, state);
      return { granted: false, serviceId: req.serviceId, variantId: null, accessUrl: null, scheduledMs: this.tuning.now() - startTime, error: err.message || String(err) };
    } finally {
      await autoReleaseLock();
      // M1: 未 granted 的 dev 请求撤出 preempt 记录 (无人等待则整条撤销, 卡还 prod)
      if (isDev && devPreemptRec && !grantedResult) {
        this.leavePreempt(devPreemptRec, "allocate-not-granted");
      }
    }
  }

  /**
   * 显式释放服务 (不等待空闲超时)。
   */
  async release(serviceId: string, caller?: string): Promise<void> {
    await this.initialized;
    this.clearIdleTimer(serviceId);
    const profile = this.profilesCache.get(serviceId);
    const state = this.services.get(serviceId);
    if (!profile || !state) return;

    if (state.status !== "stopped") {
      state.status = "stopping";
      this.mirrorService(serviceId, state);
      await this.executeStopStep(profile);
      state.status = "stopped";
      state.instanceId = null;
      state.variantId = null;
      state.lastTransitionAt = new Date().toISOString();
      this.mirrorService(serviceId, state);
      // D5 联动: 服务已停 → 队列占位同步解除 (幂等, 未占位时 no-op)。
      const queueEngine = SERVICE_TO_QUEUE_ENGINE[serviceId];
      if (queueEngine) {
        // 双3090 Phase A: 占位 GPU 索引按角色链运行时解析 (旧硬编码 1; 解析失败仍落 1)
        const gpuIndex = (await resolveServiceIndex(serviceId)) ?? 1;
        console.log(
          `[GpuScheduler] service ${serviceId} stopped — releasing queue occupancy for ${queueEngine.engine} GPU${gpuIndex}`,
        );
        releaseEngineOccupancy(queueEngine.engine, gpuIndex);
      }

      // M1 联动: 停的是 dev 占卡服务 (idle 超时/显式 release/TTL 到期皆经此) →
      // preempt 记录与 TTL 计时一并归还 (TTL 到期路径已先清记录, 此处幂等)。
      const heldRec = Array.from(this.preempts.values()).find((r) => r.holderServiceId === serviceId);
      if (heldRec) {
        await this.clearPreempt(heldRec.gpuIndex, "holder-released", { releasedBy: caller ?? null });
      }
    }
  }

  /**
   * 释放指定 GPU 上的所有非锁定服务。
   */
  async releaseAllOnGpu(gpuId: number, exceptServiceId?: string): Promise<void> {
    await this.initialized;
    for (const [id, state] of this.services) {
      if (id === exceptServiceId) continue;
      const profile = this.profilesCache.get(id)!;
      if (profileGpuIndex(profile) === gpuId && state.status !== "stopped") {
        await this.release(id);
      }
    }
  }

  // ─── M1 双卡调度: 打断 / dev-TTL / scheduling 快照 ──────────────────────
  // (docs/gpu-scheduling-architecture.md §2.2-§2.3+§2.5; API 挂
  //  /api/production/gpu/scheduling*)

  /**
   * scheduling 快照: per-GPU 在跑/优先级分布/队列深度/dev-TTL 剩余/preempt 态 + 事件环。
   * 读取即做一次惰性过期清扫 (TTL 到期归还、无人等待的陈旧 requested 记录撤销),
   * 与进程内计时器互为兜底 (注入时钟/进程重启场景计时器不可靠)。
   */
  async getSchedulingState(): Promise<SchedulingSnapshot> {
    await this.initialized;
    await this.sweepExpiredPreempts();
    const now = this.tuning.now();
    const devices = getGpuDevices();
    const queue = getGpuQueueStatus();
    const depthByGpu = new Map<number, number>();
    for (const w of queue.waiters ?? []) {
      depthByGpu.set(w.gpuIndex, (depthByGpu.get(w.gpuIndex) ?? 0) + 1);
    }
    const gpus: GpuSchedulingEntry[] = devices.map((d) => {
      const running = Array.from(this.services.values())
        .filter((s) => s.status !== "stopped")
        .filter((s) => {
          const p = this.profilesCache.get(s.profileId);
          return !!p && profileGpuIndex(p) === d.id;
        })
        .map((s) => ({
          serviceId: s.profileId,
          status: s.status,
          profilePriority: this.profilesCache.get(s.profileId)!.priority,
          priorityClass: s.priorityClass ?? null,
        }));
      const priorityDistribution: Record<string, number> = {};
      for (const r of running) {
        const k = r.priorityClass ?? "unset";
        priorityDistribution[k] = (priorityDistribution[k] ?? 0) + 1;
      }
      const rec = this.preempts.get(d.id) ?? null;
      const devTtl = rec?.phase === "held" && rec.ttl
        ? { ...rec.ttl, remainingMs: Math.max(0, Date.parse(rec.ttl.expiresAt) - now) }
        : null;
      return {
        gpuIndex: d.id,
        name: d.name,
        totalMb: d.totalMb,
        running,
        priorityDistribution,
        queueDepth: depthByGpu.get(d.id) ?? 0,
        devTtl,
        preempt: rec ? publicPreemptView(rec) : null,
      };
    });
    return { gpus, events: this.events.slice(-50).reverse() };
  }

  /**
   * dev-P0 续期: 重置 TTL 计时 (§2.3)。ttlMin 缺省沿用原授予值。
   */
  async renewDevTtl(
    gpuIndex: number,
    opts?: { ttlMin?: number; requester?: string },
  ): Promise<{ ok: true; ttl: DevTtlState } | { ok: false; error: string }> {
    await this.initialized;
    await this.sweepExpiredPreempts();
    const rec = this.preempts.get(gpuIndex);
    if (!rec || rec.phase !== "held" || !rec.ttl) {
      return { ok: false, error: `GPU ${gpuIndex} 无进行中的 dev 占用 (无可续期 TTL)` };
    }
    const ttlMin = opts?.ttlMin ?? rec.ttl.grantedMin;
    if (!Number.isFinite(ttlMin) || ttlMin < 1 || ttlMin > MAX_DEV_TTL_MIN) {
      return { ok: false, error: `ttlMin 必须为 1-${MAX_DEV_TTL_MIN} 的分钟数 (收到 ${opts?.ttlMin})` };
    }
    const now = this.tuning.now();
    const ttl: DevTtlState = {
      grantedMin: ttlMin,
      expiresAt: new Date(now + ttlMin * 60_000).toISOString(),
      renewedAt: new Date(now).toISOString(),
      renewals: rec.ttl.renewals + 1,
    };
    rec.ttl = ttl;
    this.armTtlTimer(gpuIndex, ttlMin * 60_000);
    void this.mirrorPreempt(rec);
    this.pushEvent({
      type: "dev-ttl-renewed", gpuIndex, requester: opts?.requester ?? rec.requester,
      detail: { ttlMin, expiresAt: ttl.expiresAt, renewals: ttl.renewals },
    });
    return { ok: true, ttl };
  }

  /**
   * 手动强制打断 (force 语义, dev-P0 专属): 立即 T2 硬杀卡上 prod 服务并占卡起算 TTL。
   * 不绑定具体服务 (holderServiceId=null), TTL 到期仅清记录还卡。
   */
  async forcePreempt(
    gpuIndex: number,
    opts: { requester: string; ttlMin?: number; priorityClass?: PriorityClass },
  ): Promise<{ ok: true; preempt: GpuPreemptState; evictedForDev: string[] } | { ok: false; error: string }> {
    await this.initialized;
    const pc = opts.priorityClass ?? "dev-P0";
    if (pc !== "dev-P0") {
      return { ok: false, error: `手动强制打断是 dev-P0 语义 (收到 ${pc})` };
    }
    if (!opts.requester || typeof opts.requester !== "string") {
      return { ok: false, error: "requester 必填 (打断审计归属)" };
    }
    const ttlMin = opts.ttlMin ?? DEFAULT_DEV_TTL_MIN;
    if (!Number.isFinite(ttlMin) || ttlMin < 1 || ttlMin > MAX_DEV_TTL_MIN) {
      return { ok: false, error: `ttlMin 必须为 1-${MAX_DEV_TTL_MIN} 的分钟数 (收到 ${opts.ttlMin})` };
    }

    // T2 硬杀: 停掉卡上全部在跑服务 (走既有 release → D5 队列占位联动一并解除)
    const evictedForDev: string[] = [];
    for (const s of this.runningServicesOnGpu(gpuIndex, null)) {
      await this.release(s.profileId, `force-preempt:${opts.requester}`);
      evictedForDev.push(s.profileId);
    }
    if (evictedForDev.length > 0) {
      this.pushEvent({
        type: "t2-evicted", gpuIndex, requester: opts.requester,
        detail: { evictedForDev, source: "manual-force-preempt" },
      });
    }

    // 建/转 held 记录 + TTL (已有 requested 记录直升 held; 已 held 则刷新 TTL)
    const now = this.tuning.now();
    let rec = this.preempts.get(gpuIndex);
    if (!rec) {
      rec = {
        gpuIndex,
        phase: "held",
        tier: "T2",
        requester: opts.requester,
        priorityClass: pc,
        force: true,
        requestedAt: new Date(now).toISOString(),
        deadlineAt: new Date(now).toISOString(),
        holderServiceId: null,
        ttl: null,
        waiters: 0,
      };
      this.preempts.set(gpuIndex, rec);
      this.pushEvent({
        type: "preempt-requested", gpuIndex, requester: opts.requester,
        detail: { priorityClass: pc, force: true, tier: "T2", source: "manual-force-preempt" },
      });
    }
    rec.phase = "held";
    rec.tier = "T2";
    rec.force = true;
    rec.holderServiceId = null;
    rec.ttl = {
      grantedMin: ttlMin,
      expiresAt: new Date(now + ttlMin * 60_000).toISOString(),
      renewals: 0,
    };
    this.armTtlTimer(gpuIndex, ttlMin * 60_000);
    void this.mirrorPreempt(rec);
    this.pushEvent({
      type: "dev-granted", gpuIndex, requester: opts.requester,
      detail: { source: "manual-force-preempt", ttlMin, expiresAt: rec.ttl.expiresAt, evictedForDev },
    });
    return { ok: true, preempt: publicPreemptView(rec), evictedForDev };
  }

  /**
   * 手动归还 dev 占用 (TTL 到期自动归还的人工对应; API POST /scheduling/release)。
   * 清 preempt/TTL, 若有 holder dev 服务则一并停掉 (既有 release 停服路径)。
   */
  async releaseDevOccupation(
    gpuIndex: number,
    requester?: string,
  ): Promise<{ ok: boolean; error?: string }> {
    await this.initialized;
    const rec = this.preempts.get(gpuIndex);
    if (!rec) {
      return { ok: false, error: `GPU ${gpuIndex} 无 dev 打断/占用记录` };
    }
    const holder = rec.holderServiceId;
    await this.clearPreempt(gpuIndex, "manual-release", { requester: requester ?? null });
    if (holder) {
      const st = this.services.get(holder);
      if (st && st.status !== "stopped") {
        await this.release(holder, `dev-release:${requester ?? "api"}`);
      }
    }
    return { ok: true };
  }

  // ─── M1 内部: preempt 状态机 ────────────────────────────────────────────

  /**
   * 加入或创建 per-GPU preempt 记录 (dev allocate 锁内调用)。
   * announce=false (卡空闲且非 force) 时静默建记录 — 只为 granted 后挂 TTL, 不发 T0 事件。
   */
  private joinOrCreatePreempt(
    gpuIndex: number,
    p: { requester: string; priorityClass: PriorityClass; force: boolean; tier: "T1" | "T2"; holderServiceId: string; announce: boolean },
  ): PreemptRuntime {
    const existing = this.preempts.get(gpuIndex);
    if (existing) {
      // 请求态: 与在等 dev 共享同一记录/截止时刻; held 态 (另一 dev 已占卡):
      // 不另建记录不重置 TTL — promote 时按 holder 归属决定是否刷新
      existing.waiters++;
      return existing;
    }
    const now = this.tuning.now();
    const rec: PreemptRuntime = {
      gpuIndex,
      phase: "requested",
      tier: p.tier,
      requester: p.requester,
      priorityClass: p.priorityClass,
      force: p.force,
      requestedAt: new Date(now).toISOString(),
      deadlineAt: new Date(now + this.tuning.t1TimeoutMs).toISOString(),
      holderServiceId: p.holderServiceId,
      ttl: null,
      waiters: 1,
    };
    this.preempts.set(gpuIndex, rec);
    void this.mirrorPreempt(rec);
    if (p.announce) {
      // T0 停派发自此刻生效 (prod 新 allocate 即拒)
      this.pushEvent({
        type: "preempt-requested", gpuIndex, requester: p.requester,
        detail: { priorityClass: p.priorityClass, force: p.force, tier: p.tier },
      });
    }
    return rec;
  }

  /** dev granted: requested → held, TTL 起算并武装计时器。已有 held 记录 (另一 dev 持有) 时不动, 返回 null。 */
  private promotePreemptToHeld(rec: PreemptRuntime, holderServiceId: string, ttlMin: number): DevTtlState | null {
    const now = this.tuning.now();
    if (rec.phase === "held") {
      if (rec.holderServiceId && rec.holderServiceId !== holderServiceId) {
        return null; // 卡已被另一 dev 服务持有, TTL 归原持有者
      }
    }
    rec.phase = "held";
    rec.holderServiceId = holderServiceId;
    const ttl: DevTtlState = {
      grantedMin: ttlMin,
      expiresAt: new Date(now + ttlMin * 60_000).toISOString(),
      renewals: 0,
    };
    rec.ttl = ttl;
    this.armTtlTimer(rec.gpuIndex, ttlMin * 60_000);
    void this.mirrorPreempt(rec);
    this.pushEvent({
      type: "dev-granted", gpuIndex: rec.gpuIndex, requester: rec.requester,
      detail: { holderServiceId, ttlMin, expiresAt: ttl.expiresAt },
    });
    return ttl;
  }

  /** dev 请求未 granted 的退出路径: 撤 waiters; 无人等待的 requested 记录整条撤销 (卡还 prod)。 */
  private leavePreempt(rec: PreemptRuntime, reason: string): void {
    rec.waiters = Math.max(0, rec.waiters - 1);
    if (rec.waiters === 0 && rec.phase === "requested") {
      void this.clearPreempt(rec.gpuIndex, reason);
    }
  }

  /** 清记录 + TTL 计时器 + store 镜像, 发 preempt-released 事件。幂等 (记录不存在则 no-op)。 */
  private async clearPreempt(gpuIndex: number, reason: string, detail?: Record<string, unknown>): Promise<void> {
    const rec = this.preempts.get(gpuIndex);
    if (!rec) return;
    this.preempts.delete(gpuIndex);
    const t = this.ttlTimers.get(gpuIndex);
    if (t) { clearTimeout(t); this.ttlTimers.delete(gpuIndex); }
    try { await this.store.deleteKV(PREEMPT_KV_PREFIX + gpuIndex); } catch { /* 镜像清理失败不影响归还 */ }
    this.pushEvent({
      type: "preempt-released", gpuIndex, requester: rec.requester,
      detail: { reason, phase: rec.phase, holderServiceId: rec.holderServiceId, ...detail },
    });
  }

  /** TTL 到期: 事件 + 清记录 + 停 holder dev 服务 (既有 idle-release 停服路径)。幂等。 */
  private async handleDevTtlExpiry(gpuIndex: number): Promise<void> {
    const rec = this.preempts.get(gpuIndex);
    if (!rec || rec.phase !== "held") return;
    if (rec.ttl && this.tuning.now() < Date.parse(rec.ttl.expiresAt)) return; // 续期后旧计时器误触发
    this.pushEvent({
      type: "dev-ttl-expired", gpuIndex, requester: rec.requester,
      detail: {
        holderServiceId: rec.holderServiceId,
        grantedMin: rec.ttl?.grantedMin ?? null,
        renewals: rec.ttl?.renewals ?? 0,
      },
    });
    const holder = rec.holderServiceId;
    await this.clearPreempt(gpuIndex, "dev-ttl-expired");
    if (holder) {
      const st = this.services.get(holder);
      if (st && st.status !== "stopped") {
        console.log(`[GpuScheduler] dev-TTL 到期: 归还 GPU${gpuIndex} — 停 dev 服务 ${holder}`);
        await this.release(holder, "dev-ttl-expiry");
      }
    }
  }

  /** 惰性过期清扫: held 过期 → 归还; 无人等待且过截止的 requested → 撤销。 */
  private async sweepExpiredPreempts(): Promise<void> {
    const now = this.tuning.now();
    for (const rec of Array.from(this.preempts.values())) {
      if (rec.phase === "held") {
        if (rec.ttl && now >= Date.parse(rec.ttl.expiresAt)) {
          await this.handleDevTtlExpiry(rec.gpuIndex);
        }
      } else if (rec.waiters === 0 && now > Date.parse(rec.deadlineAt) + 5_000) {
        await this.clearPreempt(rec.gpuIndex, "stale-requested-sweep");
      }
    }
  }

  private armTtlTimer(gpuIndex: number, delayMs: number): void {
    const prev = this.ttlTimers.get(gpuIndex);
    if (prev) clearTimeout(prev);
    // unref: 不阻进程退出 (server 常驻无感; 惰性扫描兜底到期归还)
    const t = setTimeout(() => { void this.handleDevTtlExpiry(gpuIndex); }, Math.max(0, delayMs));
    t.unref?.();
    this.ttlTimers.set(gpuIndex, t);
  }

  private async mirrorPreempt(rec: PreemptRuntime): Promise<void> {
    try {
      await this.store.setKV(PREEMPT_KV_PREFIX + rec.gpuIndex, publicPreemptView(rec));
    } catch (err) {
      console.warn(`[GpuScheduler] preempt mirror failed for GPU${rec.gpuIndex}:`, err);
    }
  }

  /** T1 等待环: 目标卡除本请求服务外无在跑任务 = 让卡完成。到截止返回 timeout。 */
  private async waitForBoundaryYield(gpuIndex: number, exceptServiceId: string, deadlineMs: number): Promise<"yielded" | "timeout"> {
    for (;;) {
      if (this.runningServicesOnGpu(gpuIndex, exceptServiceId).length === 0) return "yielded";
      const remaining = deadlineMs - this.tuning.now();
      if (remaining <= 0) return "timeout";
      await this.doSleep(Math.min(this.tuning.waitPollMs, remaining));
    }
  }

  /** M2 persona 闸门等待: 放行/截止; 截止先通知仲裁器收卡再复查, 仍不放行则兜底直通。 */
  private async awaitPersonaGate(serviceId: string, startTimeMs: number, waitTimeoutMs?: number): Promise<boolean> {
    if (!this.personaGate) return true;
    let verdict = this.personaGate(serviceId);
    if (!verdict.wait) return true;
    let deadlineMs = verdict.deadlineAt ? Date.parse(verdict.deadlineAt) : startTimeMs + this.tuning.t1TimeoutMs;
    if (waitTimeoutMs !== undefined) deadlineMs = Math.min(deadlineMs, startTimeMs + waitTimeoutMs);
    for (;;) {
      const remaining = deadlineMs - this.tuning.now();
      if (remaining <= 0) {
        if (this.personaGateTimeout) {
          await this.personaGateTimeout(serviceId); // 仲裁器收卡 (B→A, T2 类比)
        }
        verdict = this.personaGate(serviceId);
        if (!verdict.wait) return true;
        console.warn(`[GpuScheduler] persona gate deadline passed for ${serviceId} and still waiting — proceeding`);
        return true; // 闸门是观测性约束, 不无限阻塞业务
      }
      await this.doSleep(Math.min(this.tuning.waitPollMs, remaining));
      verdict = this.personaGate(serviceId);
      if (!verdict.wait) return true;
    }
  }

  /** 该 GPU 上在跑服务 (可排除本请求自身)。 */
  private runningServicesOnGpu(gpuIndex: number, exceptServiceId?: string | null): ServiceState[] {
    return Array.from(this.services.values()).filter((s) => {
      if (s.status === "stopped" || s.profileId === exceptServiceId) return false;
      const p = this.profilesCache.get(s.profileId);
      return !!p && profileGpuIndex(p) === gpuIndex;
    });
  }

  private pushEvent(ev: Omit<SchedulingEvent, "at">): void {
    this.events.push({ ...ev, at: new Date(this.tuning.now()).toISOString() });
    if (this.events.length > 200) this.events.splice(0, this.events.length - 200);
  }

  private async doSleep(ms: number): Promise<void> {
    if (this.tuning.sleep) return this.tuning.sleep(ms);
    await new Promise((r) => setTimeout(r, ms));
  }

  /**
   * 获取调度器完整状态。
   * Locks are read from store (cross-process authoritative).
   * Services are read from local cache (single-process view).
   */
  async getState(): Promise<SchedulerState> {
    await this.initialized;
    const lockEntries = await this.store.getAllLocks();
    const locksObj: Record<number, string | null> = {};
    for (const [gpuId, holder] of lockEntries) {
      locksObj[gpuId] = holder;
    }
    // Ensure all known GPUs appear in the response (null if unheld) —
    // 双3090 Phase A: 设备表动态探测, 插卡后含 GPU2
    const devices = getGpuDevices();
    for (const gpu of devices) {
      if (!(gpu.id in locksObj)) locksObj[gpu.id] = null;
    }
    return {
      devices: devices.map(g => ({ ...g })),
      services: Array.from(this.services.values()),
      pendingAllocation: null,
      locks: locksObj,
    };
  }

  // ─── 内部方法 ─────────────────────────────────────


  /**
   * Kill non-registry GPU processes until enough VRAM is free (R2, 2026-09-06 复活接线)。
   *
   * 调用 scripts/gpu-kill-external.sh (operator 部署到 /usr/local/bin; 脚本本体在
   * 仓内 scripts/, 首行契约 OK freed=xxx / SKIP <reason>)。防误杀护栏在脚本侧:
   * 跳过容器内进程 / systemd unit 进程 / nvidia 组件 / 已知常驻引擎
   * (breeze_server/music3-server/rtx_vsr, env GPU_KILL_EXTERNAL_EXCLUDE 可扩展)。
   * 本方法吞一切错误 (脚本缺失/超时/非零退出) — 外部清理是兜底, 失败不影响调用方
   * 原有流程 (与接线前行为一致, 仅多一条 ERROR log)。
   * protected: 单测子类桩化 (同 executeStartStep 桩法), 生产行为不变。
   */
  protected async killExternalGpuProcesses(gpuId: number, neededFreeMb: number): Promise<void> {
    try {
      const { stdout } = await execFileAsync("/usr/local/bin/gpu-kill-external.sh", [
        String(gpuId),
        String(neededFreeMb),
      ], { timeout: 60_000 });
      const result = stdout.trim();
      if (result.startsWith("OK")) {
        console.log(`[GPU Scheduler] GPU ${gpuId} freed via external script: ${result}`);
      } else {
        console.warn(`[GPU Scheduler] External kill script: ${result}`);
      }
    } catch (err) {
      console.error(`[GPU Scheduler] Error running gpu-kill-external.sh:`, err);
    }
  }

  private async ensureVram(gpuId: number, neededMb: number, requesterPriority: number, caller: string): Promise<string[]> {
    // 桌面卡空闲地板 (B2a, 2026-09-06): 入口一次性并入需求 — 下游注册表驱逐
    // 循环 / kill-external 触发 / 终判的比较基准自动含 floor, 与引擎队列侧
    // ensureVram (gpuVramManager) 同一放行口径。默认仅 GPU0=1792MiB, 其余卡 0。
    neededMb += gpuFloorMib(gpuId);
    const freeMb = await this.getGpuVramFree(gpuId);
    if (freeMb >= neededMb) return [];

    const evicted: string[] = [];
    // Collect all running services on this GPU (except the requester), sorted by priority desc (lowest priority first)
    const candidates = Array.from(this.services.values())
      .filter(s => s.status !== "stopped" && s.profileId !== caller)
      .filter(s => {
        const p = this.profilesCache.get(s.profileId)!;
        return profileGpuIndex(p) === gpuId;
      })
      .sort((a, b) => {
        const pa = this.profilesCache.get(a.profileId)!;
        const pb = this.profilesCache.get(b.profileId)!;
        return pb.priority - pa.priority; // lowest priority first to evict
      });

    let currentFree = freeMb;
    for (const candidate of candidates) {
      if (currentFree >= neededMb) break;
      const profile = this.profilesCache.get(candidate.profileId)!;
      candidate.status = "stopping";
      this.mirrorService(candidate.profileId, candidate);
      await this.executeStopStep(profile);
      candidate.status = "stopped";
      candidate.instanceId = null;
      candidate.lastTransitionAt = new Date().toISOString();
      this.mirrorService(candidate.profileId, candidate);
      currentFree = await this.getGpuVramFree(gpuId);
      evicted.push(candidate.profileId);
    }

    // ─── R2 尾部接线 (2026-09-06): 注册表驱逐完仍不足 → 裸进程外部清理兜底 ───
    // 卡上还有显存占用但已无注册表服务可驱逐 = 存在注册表外占卡者 (D9 裸进程/
    // 其他进程)。killExternalGpuProcesses 内部吞错, 失败仅 ERROR log — 调用方
    // 流程与接线前一致。free 足够时 (入口早退或驱逐循环已达标) 本分支零执行 =
    // 零行为变化。
    if (currentFree < neededMb) {
      try {
        await this.killExternalGpuProcesses(gpuId, neededMb);
      } catch (err) {
        // 兜底的双保险吞错 (方法本体已吞; 此处防桩化/子类实现抛出打断 allocate)
        console.error(`[GPU Scheduler] killExternalGpuProcesses wrapper caught:`, err);
      }
      currentFree = await this.getGpuVramFree(gpuId);
    }

    return evicted;
  }

  /** 服务存活探测 (fast-path 防陈旧态; protected 供测试子类桩化, 免真网络调用) */
  protected async checkServiceAlive(profile: ServiceProfile): Promise<boolean> {
    try {
      await axios.get(profile.healthUrl as string, { timeout: 3_000 });
      return true;
    } catch {
      return false;
    }
  }

  protected async waitForHealthy(profile: ServiceProfile, maxMs?: number): Promise<boolean> {
    if (!profile.healthUrl) return true;
    const timeout = maxMs || profile.healthTimeoutMs;
    const start = Date.now();
    while (Date.now() - start < timeout) {
      await new Promise(r => setTimeout(r, 5_000));
      try {
        await axios.get(profile.healthUrl, { timeout: 3_000 });
        return true;
      } catch {
        // Health endpoint not ready yet, keep waiting
      }
    }
    return false;
  }

  // ─── 空闲超时 ─────────────────────────────────────

  private setIdleTimer(serviceId: string, timeoutMs: number): void {
    this.clearIdleTimer(serviceId);
    this.idleTimers.set(serviceId, setTimeout(async () => {
      console.log(`[GPU Scheduler] Idle timeout: releasing ${serviceId}`);
      await this.release(serviceId, "idle-timeout");
    }, timeoutMs));
  }

  private resetIdleTimer(serviceId: string): void {
    const state = this.services.get(serviceId);
    if (state) {
      state.lastRequestAt = new Date().toISOString();
      this.mirrorService(serviceId, state);
    }
    // Don't reset timer here — allocate() handles it
  }

  private clearIdleTimer(serviceId: string): void {
    const timer = this.idleTimers.get(serviceId);
    if (timer) { clearTimeout(timer); this.idleTimers.delete(serviceId); }
  }

  private async restoreEvicted(evictorServiceId: string): Promise<void> {
    // No-op: all services are on-demand, no auto-restore needed
  }
}

// ─── M1 辅助 ─────────────────────────────────────────

/** 剥离进程内字段 (waiters) 的公开 preempt 视图 (快照/store 镜像/result 通用)。 */
function publicPreemptView(rec: PreemptRuntime): GpuPreemptState {
  return {
    gpuIndex: rec.gpuIndex,
    phase: rec.phase,
    tier: rec.tier,
    requester: rec.requester,
    priorityClass: rec.priorityClass,
    force: rec.force,
    requestedAt: rec.requestedAt,
    deadlineAt: rec.deadlineAt,
    holderServiceId: rec.holderServiceId,
    ttl: rec.ttl,
  };
}

// ─── 单例 ────────────────────────────────────────────

let _instance: GpuScheduler | null = null;
let _instancePromise: Promise<GpuScheduler> | null = null;

/**
 * Detect store backend from REDIS_URL env var.
 * Returns a StateStore (memory or redis) plus a human-readable reason.
 *
 * Decision logic:
 *   - REDIS_URL set + reachable → RedisStateStore (cross-process coordination)
 *   - REDIS_URL set + unreachable → MemoryStateStore + WARN log (degrade gracefully)
 *   - REDIS_URL unset → MemoryStateStore + WARN log (single-process mode)
 */
async function makeStore(): Promise<{ store: StateStore; reason: string }> {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    console.warn("[GpuScheduler] REDIS_URL not set — using in-memory state (single-process mode only). Multi-process coordination unavailable.");
    return { store: new MemoryStateStore(), reason: "memory (REDIS_URL unset)" };
  }
  // Lazy-import to avoid loading ioredis when not needed
  const { RedisStateStore } = await import("./redisStateStore");
  const candidate = new RedisStateStore(redisUrl);
  const ok = await candidate.ping();
  if (!ok) {
    console.warn(`[GpuScheduler] REDIS_URL=${redisUrl} set but unreachable — falling back to in-memory state. Cross-process coordination unavailable.`);
    await candidate.close();
    return { store: new MemoryStateStore(), reason: `memory (REDIS at ${redisUrl} unreachable)` };
  }
  console.log(`[GpuScheduler] Connected to Redis at ${redisUrl} — cross-process GPU coordination active.`);
  return { store: candidate, reason: `redis (${redisUrl})` };
}

/**
 * Synchronous getter — returns the existing instance or constructs a default
 * memory-backed one. Prefer `getGpuSchedulerAsync()` for first call to ensure
 * the REDIS_URL detection has completed.
 *
 * Behavior:
 *   - First call: synchronously constructs with MemoryStateStore (fallback).
 *     If REDIS_URL was set, the actual store swap happens via
 *     `getGpuSchedulerAsync()` — most call sites should use the async version
 *     at boot time.
 *   - Subsequent calls: returns the cached instance.
 */
export function getGpuScheduler(): GpuScheduler {
  if (!_instance) {
    _instance = new GpuScheduler(new MemoryStateStore());
    console.warn("[GpuScheduler] Synchronous getGpuScheduler() used before async init — defaulting to memory store. Call getGpuSchedulerAsync() at boot.");
  }
  return _instance;
}

/**
 * Async factory — preferred entry point. Detects REDIS_URL, validates
 * reachability, then constructs the scheduler with the correct backend.
 *
 * Subsequent calls return the cached instance immediately.
 */
export async function getGpuSchedulerAsync(): Promise<GpuScheduler> {
  if (_instance) return _instance;
  if (_instancePromise) return _instancePromise;
  _instancePromise = (async () => {
    const { store, reason } = await makeStore();
    _instance = new GpuScheduler(store);
    await _instance["initialized"];
    console.log(`[GpuScheduler] Initialized (backend=${reason}).`);
    return _instance;
  })();
  return _instancePromise;
}

/**
 * Test-only — reset the singleton so the next getGpuScheduler*() call
 * re-detects the backend. Used by integration tests that need to switch
 * backends.
 */
export function __resetGpuSchedulerForTests(): void {
  if (_instance) {
    void _instance["store"].close();
  }
  _instance = null;
  _instancePromise = null;
}
