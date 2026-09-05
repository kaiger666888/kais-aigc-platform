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
  /** 所属 GPU (静态兜底值; 实际索引经 gpuRole 角色链运行时解析, 见下) */
  gpuId: number;
  /**
   * GPU 角色解析键 (双3090 Phase A, docs/gpu-dual-3090-expansion.md)。
   * 传给 gpuRoles.resolveServiceIndexSync() 的服务名 — 命中
   * /opt/kais-gpu/gpu.conf 的 `<键>_role` 行 (env KAIS_GPU_<键大写>_ROLE 可覆盖);
   * 缺省用 profile.id。解析结果优先于 gpuId, 解析失败仍落 gpuId (今日拓扑)。
   */
  gpuRole?: string;
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
  /**
   * 最近一次 allocate 的任务优先级类 (M1 双卡调度, docs/gpu-scheduling-architecture.md §2.1)。
   * 调用方声明维度, 与 profile.priority (VRAM 驱逐用) 正交; 缺省 prod-P3。
   * 仅观测用 (scheduling API 优先级分布), 不参与调度决策。
   */
  priorityClass?: PriorityClass;
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

/**
 * 任务优先级类 (M1 双卡调度, docs/gpu-scheduling-architecture.md §2.1)。
 * 调用方声明的任务维度, 不改 profile.priority (VRAM 驱逐维度保持原样)。
 */
export type PriorityClass = "dev-P0" | "dev-P1" | "prod-P2" | "prod-P3";

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
  /**
   * 任务优先级类 (缺省 prod-P3 = 今日行为)。
   * dev 类可打断 prod 占卡 (T0/T1/T2), prod 类在 dev 占用期被 T0 拒绝。
   */
  priorityClass?: PriorityClass;
  /** 强制硬杀 (T2): 仅 dev-P0 合法, 其余组合在入口直接拒绝 */
  force?: boolean;
  /** dev 占用 TTL 分钟数: 仅 dev 类合法 (缺省 120, 上限 480); prod 类传入直接拒绝 */
  ttlMin?: number;
}

export interface AllocationResult {
  granted: boolean;
  serviceId: string;
  variantId: string | null;
  /** 服务就绪的访问地址 (health URL 或其他) */
  accessUrl: string | null;
  /** 如果发生了模式切换 */
  evictedServices?: string[];
  /**
   * T0 语义字段 (M1): true = 目标卡被 dev 占用, prod 新派发被拒绝。
   * 调用方可改投另一张卡或排队等待 (M3 队列消费者对接自动处理)。
   */
  preempted?: true;
  /** T0 拒绝时的占卡方信息 (requester/priorityClass/deadline 等), 见 GpuPreemptState */
  preemptInfo?: GpuPreemptState;
  /**
   * T2 硬杀语义 (M1): 因 dev 请求被驱逐的 prod 服务清单。
   * 被驱逐方应自行重排 (自动重入队属 M3, 本批不实现)。
   */
  evictedForDev?: string[];
  /** 本次请求的生效优先级类 (缺省折叠为 prod-P3) */
  priorityClass?: PriorityClass;
  /** dev 类 granted 时下发的占用 TTL (到期自动归还, 可续期) */
  devTtl?: DevTtlState;
  /** 调度耗时 ms */
  scheduledMs: number;
  /** 错误信息 */
  error?: string;
}

// ─── 双卡调度 (M1/M2): 打断 / dev-TTL / scheduling 快照 ──────────────────

/** dev 占用 TTL 状态 (docs/gpu-scheduling-architecture.md §2.3) */
export interface DevTtlState {
  /** 授予的 TTL 分钟数 (granted 时) / 续期分钟数 (renew 时) */
  grantedMin: number;
  /** 到期时刻 (ISO; 过期即自动归还) */
  expiresAt: string;
  /** 最近一次续期时刻 (ISO; 未续期过则缺省) */
  renewedAt?: string;
  /** 续期累计次数 */
  renewals: number;
}

/**
 * per-GPU preempt 状态机 (M1)。
 * phase=requested: dev 已到达, 打断窗口进行中 (T0 停派发 → T1 边界让卡 → 超时升 T2)
 * phase=held:      dev 已占卡 (granted), 直到 TTL 到期/显式释放
 */
export interface GpuPreemptState {
  /** GPU 索引 (运行时解析, 与锁同键) */
  gpuIndex: number;
  phase: "requested" | "held";
  /** 当前打断层级: T0 停派发 / T1 边界让卡 / T2 硬杀 (T2 为瞬时态, 随即转 held) */
  tier: "T0" | "T1" | "T2";
  /** 发起打断的调用方标识 */
  requester: string;
  /** 打断方声明/生效的优先级类 (必为 dev 类) */
  priorityClass: PriorityClass;
  /** 是否 force (T2 直达, 仅 dev-P0) */
  force: boolean;
  /** 打断请求到达时刻 (ISO) */
  requestedAt: string;
  /** T1 上限截止时刻 (ISO; 超时自动升 T2) */
  deadlineAt: string;
  /** dev 占用的目标服务 (TTL 归还时停掉它) */
  holderServiceId: string | null;
  /** dev-TTL (仅 held 态有意义) */
  ttl: DevTtlState | null;
}

/** scheduling API 的 per-GPU 视图 (GET /api/production/gpu/scheduling) */
export interface GpuSchedulingEntry {
  gpuIndex: number;
  name: string;
  totalMb: number;
  /** 在跑服务 (含各自优先级类) */
  running: Array<{
    serviceId: string;
    status: ServiceStatus;
    profilePriority: number;
    priorityClass: PriorityClass | null;
  }>;
  /** 在跑服务的优先级类分布 (含 null=旧状态未记录) */
  priorityDistribution: Record<string, number>;
  /** GPU 全局串行队列排队深度 (gpuVramManager waiters 按 gpuIndex 聚合) */
  queueDepth: number;
  /** dev 占用 TTL 剩余 (null = 无 dev 占用) */
  devTtl: (DevTtlState & { remainingMs: number }) | null;
  /** preempt 状态 (null = 无打断) */
  preempt: GpuPreemptState | null;
}

/** scheduling 快照 (含事件环) */
export interface SchedulingSnapshot {
  gpus: GpuSchedulingEntry[];
  /** 最近调度事件 (preempt/TTL 生命周期, 新的在前) */
  events: SchedulingEvent[];
}

/** 调度事件 (设计文档 §2.5: 谁让的卡/等待时长/被杀清单) */
export interface SchedulingEvent {
  at: string;
  type:
    | "preempt-requested" // T0: dev 到达, 停派发生效
    | "t1-timeout-escalated" // T1 15min 超时 → 升 T2
    | "t2-evicted" // T2 硬杀, 被杀 prod 清单
    | "dev-granted" // dev 占卡成功 (TTL 起算)
    | "dev-ttl-renewed"
    | "dev-ttl-expired" // TTL 到期自动归还
    | "preempt-released" // 显式释放/idle 停服归还
    | "prod-rejected-t0"; // prod allocate 被 T0 拒绝
  gpuIndex: number;
  requester: string | null;
  detail: Record<string, unknown>;
}

/** M2 persona 闸门裁决 (PersonaArbiter 提供, GpuScheduler 在 allocate 里消费) */
export interface PersonaGateVerdict {
  /** true = 该服务在当前人格下不可立即派发 (B 渲染溢出期间 QC allocate 走 T1 等待) */
  wait: boolean;
  /** 等待原因 (观测用) */
  reason?: string;
  /** 等待截止时刻 ISO (缺省由 scheduler 的 T1 上限兜底) */
  deadlineAt?: string | null;
}
