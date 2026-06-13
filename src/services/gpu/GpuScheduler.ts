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
import type {
  GpuDevice,
  ServiceProfile,
  ServiceState,
  ServiceStatus,
  ServiceVariant,
  ServiceStartMethod,
  AllocationRequest,
  AllocationResult,
  SchedulerState,
} from "./types";

const execFileAsync = promisify(execFile);

// ─── 服务注册表 ───────────────────────────────────────

/**
 * 注册所有 GPU 服务档案。
 * 在实际使用中可以从配置文件/YAML加载, 这里先硬编码已知服务。
 */
export function getRegisteredServices(): ServiceProfile[] {
  return [
    // ComfyUI Primary — GPU 1 (3090), 仅在 VRAM 不足时被踢
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
    // ComfyUI Auxiliary — GPU 0 (3060Ti), 空闲 10min 释放
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
    // ACE-Step — GPU 1 (3090), 按需, 非常驻
    {
      id: "ace-step",
      name: "ACE-Step Music Gen",
      gpuId: 1,
      vramEstMb: 17_600, // 默认 variant (turbo)
      priority: 2,
      category: "ace-step",
      start: [],
      stop: { type: "docker-stop", containerName: "kais-acestep" },
      healthUrl: "http://kais-acestep:8001/health",
      healthTimeoutMs: 120_000,
      variants: [
        {
          variantId: "turbo",
          displayName: "XL-turbo + 1.7B LM (pt)",
          envVars: {
            ACESTEP_CONFIG_PATH: "acestep-v15-xl-turbo",
            ACESTEP_CONFIG_PATH2: "acestep-v15-xl-turbo",
            ACESTEP_LM_MODEL_PATH: "acestep-5Hz-lm-1.7B",
            ACESTEP_LLM_BACKEND: "pt",
          },
          vramEstMb: 17_600,
        },
        {
          variantId: "xl-sft",
          displayName: "XL-SFT + 1.7B LM (pt, high quality)",
          envVars: {
            ACESTEP_CONFIG_PATH: "acestep-v15-xl-sft",
            ACESTEP_CONFIG_PATH2: "acestep-v15-xl-sft",
            ACESTEP_LM_MODEL_PATH: "acestep-5Hz-lm-1.7B",
            ACESTEP_LLM_BACKEND: "pt",
          },
          vramEstMb: 10_000,
        },
      ],
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
  ];
}

// ─── GPU 设备 ─────────────────────────────────────────

export const GPU_DEVICES: GpuDevice[] = [
  { id: 0, name: "RTX 3060 Ti", totalMb: 8192, gpusFlag: '"device=0"' },
  { id: 1, name: "RTX 3090", totalMb: 24576, gpusFlag: '"device=1"' },
];

// ─── 调度器类 ─────────────────────────────────────────

export class GpuScheduler {
  private services: Map<string, ServiceState> = new Map();
  private profiles: Map<string, ServiceProfile> = new Map();
  private locks: Map<number, string | null> = new Map();
  private idleTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor() {
    // Init GPU locks
    for (const gpu of GPU_DEVICES) {
      this.locks.set(gpu.id, null);
    }
    // Register services
    for (const profile of getRegisteredServices()) {
      this.profiles.set(profile.id, profile);
      this.services.set(profile.id, {
        profileId: profile.id,
        variantId: null,
        status: "stopped",
        instanceId: null,
        actualVramMb: 0,
        lastTransitionAt: null,
        lastRequestAt: null,
      });
    }
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
          await execFileAsync(step.command, step.args, { timeout: 30_000, cwd: step.cwd });
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
    const startTime = Date.now();
    const profile = this.profiles.get(req.serviceId);
    if (!profile) {
      return { granted: false, serviceId: req.serviceId, variantId: null, accessUrl: null, scheduledMs: 0, error: `Unknown service: ${req.serviceId}` };
    }

    // Record request time
    const state = this.services.get(req.serviceId)!;
    state.lastRequestAt = new Date().toISOString();

    // Reset idle timer (if any)
    this.resetIdleTimer(req.serviceId);

    // Already running + healthy with correct variant?
    if (state.status === "healthy" && state.variantId === (req.variantId || null)) {
      return { granted: true, serviceId: req.serviceId, variantId: state.variantId, accessUrl: profile.healthUrl, scheduledMs: Date.now() - startTime };
    }

    // Acquire GPU lock
    const TRANSITION_LOCK_TIMEOUT_MS = 5 * 60 * 1000; // 5 min deadlock prevention
    const gpuLock = this.locks.get(profile.gpuId);
    if (gpuLock && gpuLock !== req.caller) {
      return { granted: false, serviceId: req.serviceId, variantId: null, accessUrl: null, scheduledMs: 0, error: `GPU ${profile.gpuId} locked by ${gpuLock}` };
    }
    this.locks.set(profile.gpuId, req.caller);
    let lockTimeout: NodeJS.Timeout | null = null;
    const autoReleaseLock = () => {
      if (lockTimeout) clearTimeout(lockTimeout);
      if (this.locks.get(profile.gpuId) === req.caller) {
        this.locks.set(profile.gpuId, null);
      }
    };
    lockTimeout = setTimeout(autoReleaseLock, TRANSITION_LOCK_TIMEOUT_MS);

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

      // For ACE-Step, we need special handling: docker run with env vars
      if (profile.id === "ace-step" && variant) {
        await this.startAceStep(variant, profile.gpuId);
      } else {
        const envVars = variant?.envVars;
        await this.executeStartStep(profile, envVars);
      }

      // Wait for healthy
      if (profile.healthUrl) {
        state.status = "starting";
        const healthy = await this.waitForHealthy(profile);
        state.status = healthy ? "healthy" : "error";
        if (!healthy) {
          return { granted: false, serviceId: req.serviceId, variantId: variant?.variantId || null, accessUrl: null, scheduledMs: Date.now() - startTime, evictedServices: evicted, error: "Service failed health check" };
        }
      } else {
        // No health check — assume started
        state.status = "running";
      }

      state.variantId = variant?.variantId || null;
      state.instanceId = profile.id;

      // Set idle auto-release timer (use profile's configured timeout)
      const autoRelease = req.autoRelease !== false;
      const idleTimeout = req.idleTimeoutMs ?? profile.idleTimeoutMs;
      if (autoRelease && idleTimeout > 0) {
        this.setIdleTimer(req.serviceId, idleTimeout);
      }

      return { granted: true, serviceId: req.serviceId, variantId: state.variantId, accessUrl: profile.healthUrl, scheduledMs: Date.now() - startTime, evictedServices: evicted };
    } catch (err: any) {
      state.status = "error";
      return { granted: false, serviceId: req.serviceId, variantId: null, accessUrl: null, scheduledMs: Date.now() - startTime, error: err.message || String(err) };
    } finally {
      autoReleaseLock();
    }
  }

  /**
   * 显式释放服务 (不等待空闲超时)。
   */
  async release(serviceId: string, caller?: string): Promise<void> {
    this.clearIdleTimer(serviceId);
    const profile = this.profiles.get(serviceId);
    const state = this.services.get(serviceId);
    if (!profile || !state) return;

    if (state.status !== "stopped") {
      state.status = "stopping";
      await this.executeStopStep(profile);
      state.status = "stopped";
      state.instanceId = null;
      state.variantId = null;
      state.lastTransitionAt = new Date().toISOString();
    }
  }

  /**
   * 释放指定 GPU 上的所有非锁定服务。
   */
  async releaseAllOnGpu(gpuId: number, exceptServiceId?: string): Promise<void> {
    for (const [id, state] of this.services) {
      if (id === exceptServiceId) continue;
      const profile = this.profiles.get(id)!;
      if (profile.gpuId === gpuId && state.status !== "stopped") {
        await this.release(id);
      }
    }
  }

  /**
   * 获取调度器完整状态。
   */
  async getState(): Promise<SchedulerState> {
    const states = Array.from(this.services.values());
    return {
      devices: GPU_DEVICES.map(g => ({ ...g })),
      services: states,
      pendingAllocation: null,
      locks: Object.fromEntries(this.locks),
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
        const p = this.profiles.get(s.profileId)!;
        return p.gpuId === gpuId;
      })
      .sort((a, b) => {
        const pa = this.profiles.get(a.profileId)!;
        const pb = this.profiles.get(b.profileId)!;
        return pb.priority - pa.priority; // lowest priority first to evict
      });

    let currentFree = freeMb;
    for (const candidate of candidates) {
      if (currentFree >= neededMb) break;
      const profile = this.profiles.get(candidate.profileId)!;
      candidate.status = "stopping";
      await this.executeStopStep(profile);
      candidate.status = "stopped";
      candidate.instanceId = null;
      candidate.lastTransitionAt = new Date().toISOString();
      currentFree = await this.getGpuVramFree(gpuId);
      evicted.push(candidate.profileId);
    }

    return evicted;
  }

  private async startAceStep(variant: ServiceVariant, gpuId: number): Promise<void> {
    // Remove old container if any
    try { await execFileAsync("docker", ["stop", "kais-acestep"], { timeout: 15_000 }); } catch { /* ok */ }
    try { await execFileAsync("docker", ["rm", "kais-acestep"], { timeout: 10_000 }); } catch {  }

    // Force-free GPU: kill external processes if not enough VRAM
    const neededFreeMb = variant.vramEstMb + 2000;
    const currentFreeMb = await this.getGpuVramFree(gpuId);
    if (currentFreeMb < neededFreeMb) {
      console.log(`[GPU Scheduler] GPU ${gpuId} ${currentFreeMb}MB free < ${neededFreeMb}MB needed. Killing external processes...`);
      await this.killExternalGpuProcesses(gpuId, neededFreeMb);
    }

    const gpu = GPU_DEVICES.find(g => g.id === gpuId)!;
    const baseEnv: Record<string, string> = {
      NVIDIA_VISIBLE_DEVICES: String(gpuId),
      ACESTEP_MODE: "api",
      ACESTEP_API_HOST: "0.0.0.0",
      ACESTEP_API_PORT: "8001",
      ACESTEP_INIT_SERVICE: "true",
      TOKENIZERS_PARALLELISM: "false",
      HF_HUB_OFFLINE: "1",
      TRANSFORMERS_OFFLINE: "1",
    };

    // Merge variant env vars
    const env = { ...baseEnv, ...variant.envVars };
    const envFlags = Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]);

    const args = [
      "run", "-d",
      "--name", "kais-acestep",
      "--gpus", gpu.gpusFlag,
      "--restart", "unless-stopped",
      "--network", "kais-net",
      "-p", "127.0.0.1:8009:8001",
      ...envFlags,
      "-v", "/data/models/ACE-Step1.5:/app/checkpoints",
      "-v", "/mnt/agents/output:/app/output",
      "--shm-size=4g",
      "kais-acestep:latest",
    ];

    await execFileAsync("docker", args, { timeout: 30_000 });
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
        // Check container still exists
        if (profile.id === "ace-step") {
          try {
            const { stdout } = await execFileAsync("docker", ["ps", "--filter", "name=kais-acestep", "--format", "{{.Names}}"]);
            if (stdout.trim() !== "kais-acestep") return false;
          } catch { return false; }
        }
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
    if (state) state.lastRequestAt = new Date().toISOString();
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

export function getGpuScheduler(): GpuScheduler {
  if (!_instance) {
    _instance = new GpuScheduler();
  }
  return _instance;
}
