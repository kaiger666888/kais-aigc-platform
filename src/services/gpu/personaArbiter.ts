/**
 * src/services/gpu/personaArbiter.ts — GPU2 双人格仲裁器 (M2)
 *
 * 设计文档: docs/gpu-scheduling-architecture.md §2.4。
 *
 * 人格:
 *   A = QC 驻留 (现状)   — qwen-ear/qwen-llm/qwen-vllm/music3 常驻 (音频/判定/LLM)
 *   B = 渲染溢出         — QC 服务全停, comfyui-secondary 满配容器 @GPU2 :8190
 *
 * 切换条件 (§2.4):
 *   A→B: 渲染队列深度 >2 (或 P11 phase 活跃) ∧ QC 服务零排队零活跃
 *   B→A: QC 任务到达 (B 侧当前镜头完成边界让卡, T1 语义 ≤15min) ∨ 渲染队列空闲 5min
 *
 * 实现约束与本批边界 (工单 M2):
 *   - 状态机只输出「期望人格」; 生效翻转在本类内完成 (逻辑态 + 持久化),
 *     实际切换执行器 (停 QC 服务序列/起容器) 留 TODO 接口 PersonaSwitchExecutor,
 *     本批仅交付可被 API 触发的 dry-run (buildSwitchPlan)。
 *   - 人格状态持久化进 StateStore (kais:gpu:kv:persona:qc-gpu2), KAP 重启恢复正确人格。
 *   - 队列深度信号本批 mock (PersonaSignals 缺省全零); 真实信号 (ComfyUI /queue 等) M3 接入。
 *   - B 期间 QC allocate 走 T1 等待 (≤15min): qcGate()/onQcGateTimeout() 由 GpuScheduler
 *     经 setPersonaArbiterHooks 消费 — 人格 A 时闸门全放行 (今日行为)。
 */

import { resolveServiceRole } from "./gpuRoles";
import type { PersonaGateVerdict, PriorityClass } from "./types";
import type { StateStore } from "./stateStore";
import { MemoryStateStore } from "./memoryStateStore";

// ─── 类型 ─────────────────────────────────────────────────

export type Persona = "A" | "B";

/** 人格状态 (持久化单元; KAP 重启经 store 恢复) */
export interface PersonaState {
  /** 生效人格 (逻辑态; 容器级副作用由 executor 负责, 本批 dry-run) */
  persona: Persona;
  /** 期望人格 (状态机输出; = persona 时无挂起切换) */
  desired: Persona;
  /** 生效时刻 ISO */
  since: string;
  /** 最近一次切换原因 */
  reason: string;
  /** 边界让卡截止 ISO (B→A 的 T1 语义; null = 无挂起等待) */
  pendingDeadlineAt: string | null;
  /** 切换历史 (新的在前, 上限 50) */
  history: PersonaHistoryEntry[];
}

export interface PersonaHistoryEntry {
  at: string;
  from: Persona;
  to: Persona;
  reason: string;
  requester: string | null;
  /** true = T1 边界让卡超时升级 (T2 类比), 未经边界确认 */
  escalated: boolean;
}

/** 人格事件环 (GET /api/production/gpu/persona 透出) */
export interface PersonaEvent {
  at: string;
  type: "switch-requested" | "switch-applied" | "switch-escalated" | "manual-request" | "dry-run";
  from: Persona;
  to: Persona;
  reason: string;
  requester: string | null;
}

/**
 * 负载信号源 (M2 全部可注入/mock; M3 接真实信号):
 *   renderQueueDepth — 渲染队列深度 (M3: ComfyUI /queue)
 *   qcQueueDepth     — QC 服务排队数 (M3: QC 服务队列)
 *   qcActiveCount    — QC 活跃任务数
 *   p11Active        — P11 phase 活跃信号 (A→B 的或条件)
 */
export interface PersonaSignals {
  renderQueueDepth: () => number | Promise<number>;
  qcQueueDepth: () => number | Promise<number>;
  qcActiveCount: () => number | Promise<number>;
  p11Active: () => boolean | Promise<boolean>;
}

/** 切换计划 (dry-run 输出 / executor 输入) */
export interface PersonaSwitchPlan {
  to: Persona;
  /** A→B: 需逐个 stop 的 QC 服务 (释放 ~21.9GB); B→A: 空 */
  stopServices: string[];
  /** A→B: comfyui-secondary; B→A: 需停的容器名 */
  startContainer: string | null;
  stopContainer: string | null;
  notes: string[];
}

/**
 * 真实切换执行器 (M3 TODO 接口): 停 QC 服务序列 → 起/停 comfyui-secondary 容器。
 * 本批 null = 只做逻辑人格翻转 + dry-run 计划, 不触 docker。
 */
export interface PersonaSwitchExecutor {
  apply(
    to: Persona,
    ctx: { reason: string; requester: string | null; plan: PersonaSwitchPlan },
  ): Promise<{ ok: boolean; actions: string[]; error?: string }>;
}

export interface PersonaArbiterOpts {
  /** 信号源 (缺省全零 mock) */
  signals?: Partial<PersonaSignals>;
  /** 时钟 (测试注入假钟) */
  now?: () => number;
  /** B→A 边界让卡上限 ms (T1 语义, 缺省 15min) */
  t1TimeoutMs?: number;
  /** 渲染队列空闲判定窗口 ms (缺省 5min) */
  renderIdleMs?: number;
  /** A→B 渲染队列深度阈值 (缺省 2, §2.4) */
  renderQueueDepthThreshold?: number;
  /** 定时评估间隔 ms (缺省 30s; autoEvaluate=false 时不武装) */
  evaluateIntervalMs?: number;
  /** 定时评估 (缺省 true = 仲裁自动跟随负载; 测试关掉手动 evaluate) */
  autoEvaluate?: boolean;
  /** 真实切换执行器 (本批缺省 null = dry-run) */
  executor?: PersonaSwitchExecutor | null;
  /** StateStore (缺省 MemoryStateStore; 生产传调度器的 store 做跨进程持久化) */
  store?: StateStore;
}

// ─── 常量 ─────────────────────────────────────────────────

const T1_TIMEOUT_MS_DEFAULT = 15 * 60 * 1000;
const RENDER_IDLE_MS_DEFAULT = 5 * 60 * 1000;
const RENDER_QUEUE_DEPTH_THRESHOLD_DEFAULT = 2;
const EVALUATE_INTERVAL_MS_DEFAULT = 30_000;
const PERSONA_KV_KEY = "persona:qc-gpu2";
const HISTORY_CAP = 50;
const EVENTS_CAP = 200;

/** 人格 A 的 QC 承载服务 (设计文档 §2.4 表; conf 角色翻转后经 QC_GEN2 角色双保险命中) */
export const QC_PERSONA_SERVICES: readonly string[] = ["qwen-ear", "qwen-llm", "qwen-vllm", "music3"];

/** 缺省信号源: 全零 mock (M3 换真实信号) */
function defaultSignals(): PersonaSignals {
  return {
    renderQueueDepth: () => 0,
    qcQueueDepth: () => 0,
    qcActiveCount: () => 0,
    p11Active: () => false,
  };
}

function defaultState(now: () => number): PersonaState {
  return {
    persona: "A",
    desired: "A",
    since: new Date(now()).toISOString(),
    reason: "boot-default-qc-resident",
    pendingDeadlineAt: null,
    history: [],
  };
}

// ─── 仲裁器 ───────────────────────────────────────────────

export class PersonaArbiter {
  private store: StateStore;
  private signals: PersonaSignals;
  private tuning: {
    now: () => number;
    t1TimeoutMs: number;
    renderIdleMs: number;
    renderQueueDepthThreshold: number;
    evaluateIntervalMs: number;
  };
  private executor: PersonaSwitchExecutor | null;
  private state: PersonaState = defaultState(() => Date.now());
  private events: PersonaEvent[] = [];
  /** 渲染队列连续空闲起点 (B→A 的 5min 空闲条件; depth>0 即清) */
  private renderIdleSince: number | null = null;
  private evaluateTimer: NodeJS.Timeout | null = null;
  private evaluating: Promise<PersonaState> | null = null;
  /** Resolves when persona state has been loaded (or defaulted) from the store. */
  private initialized: Promise<void>;

  constructor(opts?: PersonaArbiterOpts) {
    this.store = opts?.store ?? new MemoryStateStore();
    const dflt = defaultSignals();
    this.signals = {
      renderQueueDepth: opts?.signals?.renderQueueDepth ?? dflt.renderQueueDepth,
      qcQueueDepth: opts?.signals?.qcQueueDepth ?? dflt.qcQueueDepth,
      qcActiveCount: opts?.signals?.qcActiveCount ?? dflt.qcActiveCount,
      p11Active: opts?.signals?.p11Active ?? dflt.p11Active,
    };
    this.tuning = {
      now: opts?.now ?? Date.now,
      t1TimeoutMs: opts?.t1TimeoutMs ?? T1_TIMEOUT_MS_DEFAULT,
      renderIdleMs: opts?.renderIdleMs ?? RENDER_IDLE_MS_DEFAULT,
      renderQueueDepthThreshold: opts?.renderQueueDepthThreshold ?? RENDER_QUEUE_DEPTH_THRESHOLD_DEFAULT,
      evaluateIntervalMs: opts?.evaluateIntervalMs ?? EVALUATE_INTERVAL_MS_DEFAULT,
    };
    this.executor = opts?.executor ?? null;
    this.initialized = this.initialize();
    if (opts?.autoEvaluate !== false) {
      this.evaluateTimer = setInterval(() => {
        void this.evaluate().catch((err) => console.warn("[PersonaArbiter] evaluate failed:", err));
      }, this.tuning.evaluateIntervalMs);
      this.evaluateTimer.unref?.();
    }
  }

  private async initialize(): Promise<void> {
    try {
      const saved = await this.store.getKV<PersonaState>(PERSONA_KV_KEY);
      if (saved && (saved.persona === "A" || saved.persona === "B")) {
        // 跨进程/跨重启恢复; 字段缺省兼容旧版快照
        this.state = { ...defaultState(this.tuning.now), ...saved };
      }
    } catch (err) {
      console.warn("[PersonaArbiter] persona state load failed — defaulting to A:", err);
    }
  }

  /** 当前人格状态 (等待初始化完成后返回)。 */
  async getState(): Promise<PersonaState> {
    await this.initialized;
    return { ...this.state, history: [...this.state.history] };
  }

  /** 最近人格事件 (新的在前)。 */
  getEvents(): PersonaEvent[] {
    return [...this.events].reverse();
  }

  /**
   * 人格落地: 逻辑翻转 + 持久化; 有 executor 则执行副作用, 无则记 dry-run 事件。
   * from===to 时零动作原样返回计划 (幂等)。
   */
  async applyPersona(
    to: Persona,
    ctx: { reason: string; requester: string | null; escalated?: boolean },
  ): Promise<PersonaSwitchPlan> {
    await this.initialized;
    const from = this.state.persona;
    const plan = this.buildSwitchPlan(to);
    if (from === to) return plan;

    const now = this.tuning.now();
    this.state.desired = to;
    this.state.persona = to;
    this.state.since = new Date(now).toISOString();
    this.state.reason = ctx.reason;
    this.state.pendingDeadlineAt = null;
    this.state.history.unshift({
      at: this.state.since,
      from,
      to,
      reason: ctx.reason,
      requester: ctx.requester,
      escalated: ctx.escalated ?? false,
    });
    if (this.state.history.length > HISTORY_CAP) this.state.history.length = HISTORY_CAP;
    this.events.push({
      at: this.state.since, type: "switch-applied", from, to,
      reason: ctx.reason, requester: ctx.requester,
    });
    if (this.events.length > EVENTS_CAP) this.events.splice(0, this.events.length - EVENTS_CAP);
    await this.persist();
    if (this.executor) {
      try {
        const res = await this.executor.apply(to, { reason: ctx.reason, requester: ctx.requester, plan });
        if (!res.ok) {
          console.error(`[PersonaArbiter] executor apply ${from}→${to} failed:`, res.error);
        }
      } catch (err) {
        console.error(`[PersonaArbiter] executor apply ${from}→${to} threw:`, err);
      }
    } else {
      // TODO(M3): 接入真实执行器 (停 QC 服务序列 → 起/停 comfyui-secondary 容器)。
      // 本批 dry-run: 计划已生成, 副作用零触碰 (docker 零接触红线)。
      this.events.push({
        at: new Date(this.tuning.now()).toISOString(), type: "dry-run", from, to,
        reason: `plan: stop=[${plan.stopServices.join(",")}] start=${plan.startContainer} stopContainer=${plan.stopContainer}`,
        requester: ctx.requester,
      });
    }
    return plan;
  }

  /**
   * 状态机评估 (决策与执行分离: 本方法只算「期望人格」并落地切换)。
   * 定时器周期调用 + API 惰性调用; 并发调用去重 (单飞)。
   */
  async evaluate(): Promise<PersonaState> {
    await this.initialized;
    if (this.evaluating) return this.evaluating;
    this.evaluating = this.doEvaluate().finally(() => { this.evaluating = null; });
    return this.evaluating;
  }

  private async doEvaluate(): Promise<PersonaState> {
    const now = this.tuning.now();
    const depth = await this.signals.renderQueueDepth();
    const qcQ = await this.signals.qcQueueDepth();
    const qcA = await this.signals.qcActiveCount();
    const p11 = await this.signals.p11Active();

    // 渲染队列空闲跟踪 (B→A 的 5min 条件)
    if (depth > 0) {
      this.renderIdleSince = null;
    } else if (this.renderIdleSince === null) {
      this.renderIdleSince = now;
    }
    const renderIdleMs = this.renderIdleSince !== null ? now - this.renderIdleSince : 0;

    const st = this.state;
    if (st.persona === "A") {
      // A→B: 渲染溢出需求 ∧ QC 零排队零活跃 (QC 安静本身就是任务边界)
      const overflowDemand = depth > this.tuning.renderQueueDepthThreshold || p11;
      const qcQuiet = qcQ === 0 && qcA === 0;
      if (overflowDemand && qcQuiet && st.desired === "A") {
        st.desired = "B";
        this.events.push({
          at: new Date(now).toISOString(), type: "switch-requested", from: "A", to: "B",
          reason: `render-overflow (depth=${depth}${p11 ? "+p11" : ""}), qc-quiet`, requester: null,
        });
        await this.applyPersona("B", { reason: `render-overflow (depth=${depth}${p11 ? "+p11" : ""})`, requester: "arbiter" });
      }
    } else {
      // persona B
      const qcArrived = qcQ > 0 || qcA > 0;
      if (qcArrived && st.desired === "B") {
        // B→A: QC 任务到达 → T1 边界让卡 (B 侧当前镜头收尾, 上限 15min)
        st.desired = "A";
        st.pendingDeadlineAt = new Date(now + this.tuning.t1TimeoutMs).toISOString();
        this.events.push({
          at: new Date(now).toISOString(), type: "switch-requested", from: "B", to: "A",
          reason: `qc-task-arrived (qcQ=${qcQ}, qcA=${qcA}), t1-deadline=${st.pendingDeadlineAt}`, requester: null,
        });
      } else if (renderIdleMs >= this.tuning.renderIdleMs && st.desired === "B") {
        // B→A: 渲染队列空闲 5min — 无 QC 等待即无边界可让, 即时回切
        st.desired = "A";
        this.events.push({
          at: new Date(now).toISOString(), type: "switch-requested", from: "B", to: "A",
          reason: `render-queue-idle-${Math.round(this.tuning.renderIdleMs / 1000)}s`, requester: null,
        });
        await this.applyPersona("A", { reason: `render-queue-idle-${Math.round(this.tuning.renderIdleMs / 1000)}s`, requester: "arbiter" });
      } else if (st.desired === "A" && st.pendingDeadlineAt && now >= Date.parse(st.pendingDeadlineAt)) {
        // T1 边界让卡超时 → 升级生效 (T2 类比)
        this.events.push({
          at: new Date(now).toISOString(), type: "switch-escalated", from: "B", to: "A",
          reason: `t1-deadline-passed (deadline=${st.pendingDeadlineAt})`, requester: null,
        });
        await this.applyPersona("A", { reason: "qc-reclaim-t1-timeout-escalated", requester: "arbiter", escalated: true });
      }
    }
    return { ...st, history: [...st.history] };
  }

  /**
   * 手动人格切换请求 (dev-P0 语义): 记录期望态并立即生效 (逻辑翻转)。
   * priorityClass 非 dev-P0 一律拒绝 (人工切换是高权限操作)。
   */
  async requestPersona(
    to: Persona,
    opts?: { requester?: string; priorityClass?: PriorityClass },
  ): Promise<{ ok: true; state: PersonaState; plan: PersonaSwitchPlan } | { ok: false; error: string }> {
    await this.initialized;
    const pc: PriorityClass = opts?.priorityClass ?? "dev-P0";
    if (pc !== "dev-P0") {
      return { ok: false, error: `手动人格切换是 dev-P0 语义 (收到 ${pc})` };
    }
    if (to !== "A" && to !== "B") {
      return { ok: false, error: `persona 只能是 "A" 或 "B" (收到 ${JSON.stringify(to)})` };
    }
    const from = this.state.persona;
    this.events.push({
      at: new Date(this.tuning.now()).toISOString(), type: "manual-request", from, to,
      reason: `manual-switch (${pc})`, requester: opts?.requester ?? null,
    });
    const plan = await this.applyPersona(to, { reason: `manual-switch (${pc})`, requester: opts?.requester ?? null });
    return { ok: true, state: { ...this.state, history: [...this.state.history] }, plan };
  }

  /** 切换计划 (dry-run; API POST /persona/dry-run 触发, 副作用零)。 */
  buildSwitchPlan(to: Persona): PersonaSwitchPlan {
    if (to === "B") {
      return {
        to,
        stopServices: [...QC_PERSONA_SERVICES],
        startContainer: "comfyui-secondary",
        stopContainer: null,
        notes: [
          "逐个 stop QC 服务 (qwen-ear/qwen-llm/qwen-vllm/music3, 释放 ~21.9GB)",
          "docker compose -f docker-compose.secondary.yml up -d comfyui-secondary (:8190, CDI 锚 KAIS_QC_GPU_UUID)",
          "切换窗口内新渲染任务只进 GPU1 (设计文档 §2.4 实现约束)",
        ],
      };
    }
    return {
      to,
      stopServices: [],
      startContainer: null,
      stopContainer: "comfyui-secondary",
      notes: [
        "docker stop comfyui-secondary (渲染溢出收尾)",
        "QC 服务按需由 GpuScheduler allocate 逐个重拉 (idle 常驻语义不变)",
      ],
    };
  }

  // ─── GpuScheduler 闸门 (setPersonaArbiterHooks 装配) ─────────────────────

  /**
   * QC allocate 闸门: 人格 B 期间 QC 服务等待 (T1 语义 ≤15min), 其余放行。
   * QC 判定 = conf 角色链 QC_GEN2 ∨ 显式 QC 服务清单 (hermetic 测试走清单)。
   */
  readonly qcGate = (serviceId: string): PersonaGateVerdict => {
    if (!this.isQcService(serviceId)) return { wait: false };
    if (this.state.persona !== "B") return { wait: false };
    const deadlineAt = this.state.pendingDeadlineAt
      ?? new Date(this.tuning.now() + this.tuning.t1TimeoutMs).toISOString();
    return { wait: true, reason: "persona-b-render-overflow", deadlineAt };
  };

  /**
   * 闸门截止回调 (GpuScheduler T1 等待超时): QC 收卡升级 — B→A 立即生效 (T2 类比)。
   */
  readonly onQcGateTimeout = async (_serviceId: string): Promise<void> => {
    if (this.state.persona === "B") {
      this.events.push({
        at: new Date(this.tuning.now()).toISOString(), type: "switch-escalated", from: "B", to: "A",
        reason: "qc-allocate-gate-t1-timeout", requester: "scheduler-gate",
      });
      await this.applyPersona("A", { reason: "qc-reclaim-gate-t1-timeout", requester: "scheduler-gate", escalated: true });
    }
  };

  /** QC 服务判定: conf 角色 QC_GEN2 (插卡日翻转后真值) ∨ 显式清单 (角色未翻转/测试兜底)。 */
  isQcService(serviceId: string): boolean {
    if ((QC_PERSONA_SERVICES as readonly string[]).includes(serviceId)) return true;
    try {
      return resolveServiceRole(serviceId) === "QC_GEN2";
    } catch {
      return false;
    }
  }

  /** 关闭定时评估 (测试/卸载)。 */
  stop(): void {
    if (this.evaluateTimer) {
      clearInterval(this.evaluateTimer);
      this.evaluateTimer = null;
    }
  }

  private async persist(): Promise<void> {
    try {
      await this.store.setKV(PERSONA_KV_KEY, this.state);
    } catch (err) {
      console.warn("[PersonaArbiter] persona state persist failed:", err);
    }
  }
}

// ─── 单例 ─────────────────────────────────────────────────

let _arbiter: PersonaArbiter | null = null;
let _arbiterPromise: Promise<PersonaArbiter> | null = null;

/**
 * 异步工厂 (优先入口): 复用 GpuScheduler 的 StateStore (同一 Redis 后端做跨进程
 * 持久化), 并把 QC 闸门装配进调度器。人格 A 时闸门全放行 = 今日行为。
 */
export async function getPersonaArbiterAsync(): Promise<PersonaArbiter> {
  if (_arbiter) return _arbiter;
  if (_arbiterPromise) return _arbiterPromise;
  _arbiterPromise = (async () => {
    const { getGpuSchedulerAsync } = await import("./GpuScheduler");
    const scheduler = await getGpuSchedulerAsync();
    const arbiter = new PersonaArbiter({ store: scheduler.stateStore });
    scheduler.setPersonaArbiterHooks(arbiter.qcGate, arbiter.onQcGateTimeout);
    _arbiter = arbiter;
    console.log("[PersonaArbiter] Initialized (persona A 默认; QC 闸门已挂调度器).");
    return arbiter;
  })();
  return _arbiterPromise;
}

/** 测试专用 — 重置单例并卸下调度器闸门。 */
export function __resetPersonaArbiterForTests(): void {
  _arbiter?.stop();
  _arbiter = null;
  _arbiterPromise = null;
}
