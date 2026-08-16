/**
 * src/services/gpu/types.ts — GPU 调度器类型定义
 *
 * 项目级 GPU 显存调度，管理所有 GPU 服务的生命周期。
 * 不局限于 ACE，任何需要 GPU 资源的服务都通过此调度器管理。
 *
 * 核心概念:
 *   - GPU 资源池: 每个 GPU 有固定的显存总量
 *   - 服务档案: 声明每个服务的显存需求和启动/停止方式
 *   - 按需分配: 请求时拉起，空闲超时后自动释放
 *   - 互斥控制: 服务间显存冲突时自动暂停低优先级服务
 */

// ─── GPU 设备 ──────────────────────────────────────────

export interface GpuDevice {
  /** GPU 索引 (nvidia-smi --id) */
  id: number;
  /** 设备名 */
  name: string;
  /** 总显存 MB */
  totalMb: number;
  /** Docker --gpus 参数值, e.g. '"device=1"' */
  gpusFlag: string;
}

// ─── 服务档案 ─────────────────────────────────────────

export type ServiceStartMethod =
  | { type: "docker"; containerName: string; image: string; runArgs: string[]; envVars: Record<string, string>; volumes: Record<string, string> }
  | { type: "docker-start"; containerName: string }
  | { type: "docker-stop"; containerName: string }
  | { type: "script"; command: string; args: string[]; cwd?: string; timeoutMs?: number }
  | { type: "http-ready"; url: string; timeoutMs: number }
  | { type: "internal"; init: string };

/** 服务优先级: 数字越小优先级越高 */
export type ServicePriority = 0 | 1 | 2 | 3 | 4 | 5;

export interface ServiceProfile {
  /** 唯一标识 */
  id: string;
  /** 显示名 */
  name: string;
  /** 所属 GPU */
  gpuId: number;
  /** 估计显存占用 MB */
  vramEstMb: number;
  /** 优先级 (0=最高, 5=最低) */
  priority: ServicePriority;
  /** 服务类型 */
  category: "comfyui" | "tts" | "training" | "llm" | "other";
  /** 启动方式 */
  start: ServiceStartMethod | ServiceStartMethod[];
  /** 停止方式 (默认和 start 相反, 可覆盖) */
  stop?: ServiceStartMethod | ServiceStartMethod[];
  /** 健康检查 URL (null = 不检查) */
  healthUrl: string | null;
  /** 健康检查超时 ms */
  healthTimeoutMs: number;
  /** 模型/配置变体 (可选, 一个服务可以有多种模式) */
  variants?: ServiceVariant[];
  /** 空闲自动释放超时 ms (0 = 不自动释放, 仅在 VRAM 不足时被踢). 默认: 600000 (10min) */
  idleTimeoutMs: number;
}

export interface ServiceVariant {
  variantId: string;
  displayName: string;
  /** 覆盖/追加的启动环境变量 */
  envVars: Record<string, string>;
  /** 估计显存 (覆盖基础档案) */
  vramEstMb: number;
}

// ─── 调度状态 ─────────────────────────────────────────

export type ServiceStatus = "stopped" | "starting" | "running" | "healthy" | "stopping" | "error";

export interface ServiceState {
  profileId: string;
  variantId: string | null;
  status: ServiceStatus;
  /** 实际占用的容器/PID */
  instanceId: string | null;
  /** 实际显存占用 (从 nvidia-smi 读取, 0=未运行) */
  actualVramMb: number;
  /** 最后状态变更时间 */
  lastTransitionAt: string | null;
  /** 最后请求时间 (用于空闲超时) */
  lastRequestAt: string | null;
}

export interface SchedulerState {
  devices: GpuDevice[];
  services: ServiceState[];
  /** 当前正在进行的分配操作 */
  pendingAllocation: string | null;
  /** GPU 间互斥锁 */
  locks: Record<number, string | null>;
}

// ─── 分配请求 ─────────────────────────────────────────

export interface AllocationRequest {
  /** 需要的服务 ID */
  serviceId: string;
  /** 指定变体 (可选) */
  variantId?: string;
  /** 调用者标识 (用于日志和锁) */
  caller: string;
  /** 请求的超时 ms (等待就绪) */
  waitTimeoutMs?: number;
  /** 请求完成后是否自动释放 (默认 true) */
  autoRelease?: boolean;
  /** 空闲多久后自动释放 ms (0=不自动释放, 默认 600000 = 10min) */
  idleTimeoutMs?: number;
}

export interface AllocationResult {
  granted: boolean;
  serviceId: string;
  variantId: string | null;
  /** 服务就绪的访问地址 (health URL 或其他) */
  accessUrl: string | null;
  /** 如果发生了模式切换 */
  evictedServices?: string[];
  /** 调度耗时 ms */
  scheduledMs: number;
  /** 错误信息 */
  error?: string;
}
