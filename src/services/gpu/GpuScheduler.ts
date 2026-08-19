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
import { releaseEngineOccupancy } from "@/lib/gpuVramManager";
import type {
  GpuDevice,
  ServiceProfile,
  ServiceState,
  ServiceStatus,
  ServiceStartMethod,
  AllocationRequest,
  AllocationResult,
  SchedulerState,
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
    // killExternalGpuProcesses (gpu-kill-external.sh) 兜底; 新增服务前先确认没有
    // 重复的手动实例在跑 (docs/gpu-unified-scheduling-plan.md §D9)。
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
    {
      id: "comfyui-auxiliary",
      name: "ComfyUI Auxiliary",
      gpuId: 0,
      vramEstMb: 6_400,
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
    {
      id: "qwen-llm",
      name: "Qwen3.8-27B LLM (llama.cpp)",
      gpuId: 1,
      vramEstMb: 15_500, // Q3 共存档实测 14.4GB + 余量
      priority: 2, // 高于 comfyui(0)/tts(1), 低于 lora-trainer(3); 常驻低频服务, 渲染时让位
      category: "llm",
      start: { type: "script", command: "bash", args: ["/opt/qwen-llm/kap-llm.sh", "start", "q3"], timeoutMs: 300_000 },
      stop: { type: "script", command: "bash", args: ["/opt/qwen-llm/kap-llm.sh", "stop"] },
      healthUrl: "http://127.0.0.1:8125/health",
      healthTimeoutMs: 300_000, // 模型加载 1-2 分钟; waitForHealthy 每 5s 轮询
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
  ];
}

// ─── 服务 ↔ 队列占用映射 (2026-08-19 D5 联动) ─────────────────────────────
//
// GpuScheduler 管**服务生命周期** (docker/script 拉停), gpuVramManager 管**队列
// 占位** — 两层各管各的导致停服务后占位残留。此映射让 release() 停完服务后
// 顺手解掉对应引擎的队列占位 (releaseEngineOccupancy 幂等: 非持有者 no-op)。
const SERVICE_TO_QUEUE_ENGINE: Record<string, { engine: string; gpuIndex: number }> = {
  "qwen-llm": { engine: "qwen_eye", gpuIndex: 1 }, // :8125 ↔ llm 路由的 QWEN_EYE_QUEUE_KEY
  "qwen-ear": { engine: "qwen_ear", gpuIndex: 1 }, // :8126 ↔ ear 路由
};

// ─── GPU 设备 ─────────────────────────────────────────

export const GPU_DEVICES: GpuDevice[] = [
  { id: 0, name: "RTX 3060 Ti", totalMb: 8192, gpusFlag: '"device=0"' },
  { id: 1, name: "RTX 3090", totalMb: 24576, gpusFlag: '"device=1"' },
];

// ─── 调度器类 ─────────────────────────────────────────

const LOCK_TTL_MS = 5 * 60 * 1000; // 5 min — must exceed any single allocate() duration

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

  constructor(store?: StateStore) {
    this.store = store ?? new MemoryStateStore();
    this.initialized = this.initialize();
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

  private async executeStartStep(profile: ServiceProfile, envVars?: Record<string, string>): Promise<void> {
    const steps = Array.isArray(profile.start) ? profile.start : [profile.start];
    for (const step of steps) {
      switch (step.type) {
        case "docker": {
          // Build docker run command
          const mergedEnv = { ...step.envVars, ...envVars };
          const envFlags = Object.entries(mergedEnv).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
          const volFlags = Object.entries(step.volumes || {}).flatMap(([host, container]) => ["-v", `${host}:${container}`]);
          const args = [
            "run", "-d", "--gpus", GPU_DEVICES.find(g => g.id === profile.gpuId)?.gpusFlag || '"device=1"',
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

  private async executeStopStep(profile: ServiceProfile): Promise<void> {
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
   */
  async allocate(req: AllocationRequest): Promise<AllocationResult> {
    await this.initialized;
    const startTime = Date.now();
    const profile = this.profilesCache.get(req.serviceId);
    if (!profile) {
      return { granted: false, serviceId: req.serviceId, variantId: null, accessUrl: null, scheduledMs: 0, error: `Unknown service: ${req.serviceId}` };
    }

    // Record request time
    const state = this.services.get(req.serviceId)!;
    state.lastRequestAt = new Date().toISOString();
    this.mirrorService(req.serviceId, state);

    // Reset idle timer (if any)
    this.resetIdleTimer(req.serviceId);

    // Already running + healthy with correct variant?
    if (state.status === "healthy" && state.variantId === (req.variantId || null)) {
      // Verify real liveness — in-process state can be stale (external stop / crash / reboot)
      if (profile.healthUrl) {
        let alive = false;
        try { await axios.get(profile.healthUrl, { timeout: 3_000 }); alive = true; } catch { /* stale */ }
        if (!alive) {
          console.warn(`[GpuScheduler] ${req.serviceId} memory state "healthy" but health check failed — falling through to restart`);
          state.status = "stopped";
          this.mirrorService(req.serviceId, state);
        } else {
          return { granted: true, serviceId: req.serviceId, variantId: state.variantId, accessUrl: profile.healthUrl, scheduledMs: Date.now() - startTime };
        }
      } else {
        return { granted: true, serviceId: req.serviceId, variantId: state.variantId, accessUrl: profile.healthUrl, scheduledMs: Date.now() - startTime };
      }
    }

    // Acquire GPU lock via store (atomic cross-process when Redis-backed)
    const acquired = await this.store.acquireLock(profile.gpuId, req.caller, LOCK_TTL_MS);
    if (!acquired) {
      // Check if we already hold it (re-entrance is allowed)
      const current = await this.store.getLock(profile.gpuId);
      if (current !== req.caller) {
        return { granted: false, serviceId: req.serviceId, variantId: null, accessUrl: null, scheduledMs: 0, error: `GPU ${profile.gpuId} locked by ${current}` };
      }
    }
    // Auto-release safety net (in-process; TTL in store is the cross-process safety net)
    let lockTimeout: NodeJS.Timeout | null = null;
    const autoReleaseLock = async () => {
      if (lockTimeout) clearTimeout(lockTimeout);
      await this.store.releaseLock(profile.gpuId, req.caller);
    };
    lockTimeout = setTimeout(() => { void autoReleaseLock(); }, LOCK_TTL_MS);

    try {
      const variant = req.variantId && profile.variants
        ? profile.variants.find(v => v.variantId === req.variantId) || profile.variants[0]
        : profile.variants?.[0]; // default variant

      const targetVram = variant?.vramEstMb || profile.vramEstMb;

      // Evict lower-priority services if needed
      const evicted = await this.ensureVram(profile.gpuId, targetVram, profile.priority, req.caller);

      // Start the target service
      state.status = "starting";
      state.lastTransitionAt = new Date().toISOString();
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
          return { granted: false, serviceId: req.serviceId, variantId: variant?.variantId || null, accessUrl: null, scheduledMs: Date.now() - startTime, evictedServices: evicted, error: "Service failed health check" };
        }
      } else {
        // No health check — assume started
        state.status = "running";
        this.mirrorService(req.serviceId, state);
      }

      state.variantId = variant?.variantId || null;
      state.instanceId = profile.id;
      this.mirrorService(req.serviceId, state);

      // Set idle auto-release timer (use profile's configured timeout)
      const autoRelease = req.autoRelease !== false;
      const idleTimeout = req.idleTimeoutMs ?? profile.idleTimeoutMs;
      if (autoRelease && idleTimeout > 0) {
        this.setIdleTimer(req.serviceId, idleTimeout);
      }

      return { granted: true, serviceId: req.serviceId, variantId: state.variantId, accessUrl: profile.healthUrl, scheduledMs: Date.now() - startTime, evictedServices: evicted };
    } catch (err: any) {
      state.status = "error";
      this.mirrorService(req.serviceId, state);
      return { granted: false, serviceId: req.serviceId, variantId: null, accessUrl: null, scheduledMs: Date.now() - startTime, error: err.message || String(err) };
    } finally {
      await autoReleaseLock();
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
        console.log(
          `[GpuScheduler] service ${serviceId} stopped — releasing queue occupancy for ${queueEngine.engine} GPU${queueEngine.gpuIndex}`,
        );
        releaseEngineOccupancy(queueEngine.engine, queueEngine.gpuIndex);
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
      if (profile.gpuId === gpuId && state.status !== "stopped") {
        await this.release(id);
      }
    }
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
    // Ensure all known GPUs appear in the response (null if unheld)
    for (const gpu of GPU_DEVICES) {
      if (!(gpu.id in locksObj)) locksObj[gpu.id] = null;
    }
    return {
      devices: GPU_DEVICES.map(g => ({ ...g })),
      services: Array.from(this.services.values()),
      pendingAllocation: null,
      locks: locksObj,
    };
  }

  // ─── 内部方法 ─────────────────────────────────────


  /**
   * Kill non-ACE GPU processes until enough VRAM is free.
   */
  private async killExternalGpuProcesses(gpuId: number, neededFreeMb: number): Promise<void> {
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
    const freeMb = await this.getGpuVramFree(gpuId);
    if (freeMb >= neededMb) return [];

    const evicted: string[] = [];
    // Collect all running services on this GPU (except the requester), sorted by priority desc (lowest priority first)
    const candidates = Array.from(this.services.values())
      .filter(s => s.status !== "stopped" && s.profileId !== caller)
      .filter(s => {
        const p = this.profilesCache.get(s.profileId)!;
        return p.gpuId === gpuId;
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

    return evicted;
  }

  private async waitForHealthy(profile: ServiceProfile, maxMs?: number): Promise<boolean> {
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
