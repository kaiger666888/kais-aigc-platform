/**
 * src/lib/gpuQueueCrossProc.ts — GPU 队列跨进程门控 (2026-08-19 三期 P3-A / D4)
 *
 * 背景: withGpuQueue 的锁状态 (gpuLocks/waiters/事件环) 是模块级**进程内内存** —
 * 同机的 dev tsx 实例 ×2 + prod bundle 各持一把互不知情的"全局锁", 两个进程同时
 * 服务引擎路由就是 GPU 撞车 (docs/gpu-unified-scheduling-plan.md D4)。
 *
 * 三档模式 (env KAP_GPU_QUEUE_CROSSPROC, 默认: REDIS_URL 已设 → mirror, 未设 → off):
 *   - off     完全关闭 (单进程部署的默认, 行为与三期前一致)
 *   - mirror  观测 + 碰撞检测: 持锁信息镜像到 redis (带 TTL), 获锁时发现异主
 *             holder → ERROR log + 事件留痕, 但**不阻塞** — 运维兜底档
 *   - strict  互斥: 进程内 FIFO 获锁后, 还要拿到 redis 互斥锁 (SET NX PX + 心跳
 *             续期 + Lua 原子释放) 才执行 fn — 跨进程真正串行。进程崩溃由 TTL
 *             过期兜底 (默认 40min > 最长 H3 作业)。
 *
 * 语义边界 (诚实声明):
 *   - strict 提供跨进程**互斥安全**, 不提供全局 FIFO 公平 (进程内各自 FIFO,
 *     跨进程在 redis 锁上竞争) — 对 GPU 安全而言公平性不是刚需。
 *   - redis 不可达时 mirror/strict 均降级为 off + ERROR log (fail-open:
 *     业务不因协调面故障而停摆 — 与 GpuScheduler makeStore 的降级哲学一致)。
 *
 * env:
 *   KAP_GPU_QUEUE_CROSSPROC        — off | mirror | strict (默认按 REDIS_URL 推断)
 *   KAP_GPU_QUEUE_CROSSPROC_TTL_MS — strict 互斥锁 TTL (默认 2400000 = 40min)
 *   KAP_GPU_QUEUE_CROSSPROC_POLL_MS— strict 等锁轮询间隔 (默认 1000)
 *   REDIS_URL                      — redis 连接 (未设 = 强制 off)
 */

import { hostname } from "node:os";
import { randomBytes } from "node:crypto";

export type CrossProcMode = "off" | "mirror" | "strict";

/** 本进程唯一属主标识 (镜像/互斥锁 value — 区分"是不是自己") */
export const QUEUE_OWNER_ID = `${hostname()}:${process.pid}:${randomBytes(3).toString("hex")}`;

export class CrossProcGateTimeoutError extends Error {
  readonly kind = "queue_crossproc_timeout" as const;
  readonly gpuIndex: number;
  readonly engine: string;

  constructor(opts: { gpuIndex: number; engine: string; waitedMs: number }) {
    super(
      `queue_crossproc_timeout: engine=${opts.engine} waited ${Math.round(opts.waitedMs / 1000)}s for cross-process GPU${opts.gpuIndex} gate`,
    );
    this.name = "CrossProcGateTimeoutError";
    this.gpuIndex = opts.gpuIndex;
    this.engine = opts.engine;
  }
}

export interface QueueGate {
  readonly mode: CrossProcMode;
  readonly backend: "none" | "memory" | "redis";
  /**
   * strict: 等待并取得跨进程互斥锁 (超时抛 CrossProcGateTimeoutError);
   * mirror: 写持锁镜像 + 异主碰撞检测 (不阻塞); off: no-op。
   * @param deadlineMs strict 模式等锁上限 (默认无限等 — 与进程内锁等待语义对齐,
   *                   进程内 waiter 自身的 deadline/abort 由 gpuVramManager 管)
   */
  acquire(gpuIndex: number, engine: string, deadlineMs?: number): Promise<void>;
  /** 释放互斥锁/清除镜像。best-effort: 内部 catch, 永不抛 (TTL 兜底)。 */
  release(gpuIndex: number, engine: string): void;
  /** 镜像排队计数 (观测用, best-effort) */
  mirrorWaiting(gpuIndex: number, engine: string, count: number): void;
  /** 同步描述 (状态端点用) */
  describe(): { mode: CrossProcMode; backend: string; owner: string };
  close(): Promise<void>;
}

// ─── off / no-op ────────────────────────────────────────────────────────────

class OffGate implements QueueGate {
  readonly mode = "off" as const;
  readonly backend = "none" as const;
  async acquire(): Promise<void> {}
  release(): void {}
  mirrorWaiting(): void {}
  describe() {
    return { mode: this.mode, backend: this.backend, owner: QUEUE_OWNER_ID };
  }
  async close(): Promise<void> {}
}

// ─── memory (strict 单机测试 / 无 redis 降级) ───────────────────────────────

interface MemLockEntry {
  owner: string;
  engine: string;
  expiresAt: number;
}

/**
 * 共享 map 版内存门 — 测试用它模拟"两个进程": 两个 MemoryGate 构造时传同一个
 * Map 即共享锁视野, TTL 过期语义与 redis PX 一致。
 */
export class MemoryGate implements QueueGate {
  readonly mode: CrossProcMode;
  readonly backend = "memory" as const;
  private held = new Set<number>();
  private readonly owner: string;

  constructor(
    private shared: Map<number, MemLockEntry> = new Map(),
    mode: CrossProcMode = "strict",
    private ttlMs = 40 * 60 * 1000,
    private pollMs = 20,
    /** 测试注入属主 — 两个 MemoryGate 共享 map + 不同 owner = 模拟两个进程 */
    owner: string = QUEUE_OWNER_ID,
  ) {
    this.mode = mode;
    this.owner = owner;
  }

  private liveEntry(gpuIndex: number): MemLockEntry | null {
    const entry = this.shared.get(gpuIndex);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.shared.delete(gpuIndex); // TTL 过期 — 崩溃属主的锁自动失效
      return null;
    }
    return entry;
  }

  async acquire(gpuIndex: number, engine: string, deadlineMs?: number): Promise<void> {
    if (this.mode === "off") return;
    const start = Date.now();
    for (;;) {
      const entry = this.liveEntry(gpuIndex);
      if (!entry || entry.owner === this.owner) {
        // 无主或重入 (同 owner 重入 — 与 StateStore.acquireLock 语义一致;
        // strict 下能走到这里说明异主 entry 已 TTL 过期)
        this.shared.set(gpuIndex, { owner: this.owner, engine, expiresAt: Date.now() + this.ttlMs });
        this.held.add(gpuIndex);
        return;
      }
      if (this.mode === "mirror") {
        // mirror 不阻塞 — 只留碰撞痕迹
        console.error(
          `[gpuQueue:crossproc] COLLISION GPU${gpuIndex}: this=${this.owner}(${engine}) vs foreign=${entry.owner}(${entry.engine}) — mirror mode, not blocking`,
        );
        return;
      }
      if (deadlineMs !== undefined && Date.now() - start >= deadlineMs) {
        throw new CrossProcGateTimeoutError({ gpuIndex, engine, waitedMs: Date.now() - start });
      }
      await new Promise((r) => setTimeout(r, this.pollMs));
    }
  }

  release(gpuIndex: number): void {
    const entry = this.shared.get(gpuIndex);
    if (entry?.owner === this.owner) this.shared.delete(gpuIndex);
    this.held.delete(gpuIndex);
  }

  mirrorWaiting(): void {}
  describe() {
    return { mode: this.mode, backend: this.backend, owner: this.owner };
  }
  async close(): Promise<void> {}
}

// ─── redis (mirror / strict) ───────────────────────────────────────────────

const KEY_HOLDER = "kais:gpuq:holder:";   // 镜像: JSON {engine, owner, at} (PX TTL)
const KEY_XLOCK = "kais:gpuq:xlock:";     // strict 互斥: owner 字符串 (PX TTL + 心跳续期)
const KEY_WAITING = "kais:gpuq:waiting:"; // 镜像: 排队计数

interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: unknown[]): Promise<unknown>;
  del(key: string): Promise<number>;
  eval(script: string, numKeys: number, ...args: unknown[]): Promise<unknown>;
  expire(key: string, ttlSec: number): Promise<unknown>;
  ping(): Promise<string>;
  quit(): Promise<unknown>;
  disconnect(): void;
}

const RELEASE_LUA = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end`;

class RedisGate implements QueueGate {
  readonly mode: CrossProcMode;
  readonly backend = "redis" as const;
  /** strict 心跳: gpuIndex → 续期定时器 (TTL/3) */
  private renewals = new Map<number, ReturnType<typeof setInterval>>();

  constructor(
    private client: RedisLike,
    mode: CrossProcMode,
    private ttlMs: number,
    private mirrorTtlMs: number,
    private pollMs: number,
  ) {
    this.mode = mode;
  }

  async acquire(gpuIndex: number, engine: string, deadlineMs?: number): Promise<void> {
    const start = Date.now();
    const holderKey = KEY_HOLDER + gpuIndex;
    const xlockKey = KEY_XLOCK + gpuIndex;

    // 镜像: 检测异主持锁 (mirror 与 strict 都做 — 可观测性)
    const existingRaw = await this.client.get(holderKey).catch(() => null);
    if (existingRaw) {
      try {
        const existing = JSON.parse(existingRaw) as { engine: string; owner: string };
        if (existing.owner !== QUEUE_OWNER_ID) {
          console.error(
            `[gpuQueue:crossproc] COLLISION GPU${gpuIndex}: this=${QUEUE_OWNER_ID}(${engine}) vs foreign=${existing.owner}(${existing.engine})${this.mode === "mirror" ? " — mirror mode, not blocking" : " — strict mode, waiting for exclusive lock"}`,
          );
        }
      } catch {
        // 非 JSON 残值 — 忽略
      }
    }

    if (this.mode === "mirror") {
      // 只写镜像不互斥
      await this.client
        .set(holderKey, JSON.stringify({ engine, owner: QUEUE_OWNER_ID, at: Date.now() }), "PX", this.mirrorTtlMs)
        .catch(() => undefined);
      return;
    }

    // strict: 抢互斥锁 (SET NX PX), 抢不到轮询到 deadline
    const ttlSec = Math.max(1, Math.ceil(this.ttlMs / 1000));
    for (;;) {
      const ok = await this.client.set(xlockKey, QUEUE_OWNER_ID, "PX", ttlSec, "NX").catch(() => null);
      if (ok === "OK") {
        // 心跳续期 (进程活着但作业超长时防止 TTL 过期被抢占)
        this.startRenewal(gpuIndex, xlockKey);
        // 同时写镜像 (观测)
        await this.client
          .set(holderKey, JSON.stringify({ engine, owner: QUEUE_OWNER_ID, at: Date.now() }), "PX", this.mirrorTtlMs)
          .catch(() => undefined);
        return;
      }
      if (deadlineMs !== undefined && Date.now() - start >= deadlineMs) {
        throw new CrossProcGateTimeoutError({ gpuIndex, engine, waitedMs: Date.now() - start });
      }
      await new Promise((r) => setTimeout(r, this.pollMs));
    }
  }

  private startRenewal(gpuIndex: number, xlockKey: string): void {
    if (this.renewals.has(gpuIndex)) return;
    const interval = Math.max(5_000, Math.floor(this.ttlMs / 3));
    const timer = setInterval(() => {
      const ttlSec = Math.max(1, Math.ceil(this.ttlMs / 1000));
      // 续期: 只有仍归我们时才延长 (GET 比对 + EXPIRE — 竞态窗口由 NX 抢锁侧兜底)
      void this.client
        .get(xlockKey)
        .then((owner) => {
          if (owner === QUEUE_OWNER_ID) return this.client.expire(xlockKey, ttlSec);
          return undefined;
        })
        .catch(() => undefined);
    }, interval);
    timer.unref?.();
    this.renewals.set(gpuIndex, timer);
  }

  release(gpuIndex: number): void {
    const renewal = this.renewals.get(gpuIndex);
    if (renewal) {
      clearInterval(renewal);
      this.renewals.delete(gpuIndex);
    }
    // Lua 原子释放 (只删归自己的); 镜像键一并清 (残留由 TTL 兜底)
    void this.client
      .eval(RELEASE_LUA, 1, KEY_XLOCK + gpuIndex, QUEUE_OWNER_ID)
      .catch(() => undefined);
    void this.client.del(KEY_HOLDER + gpuIndex).catch(() => undefined);
  }

  mirrorWaiting(gpuIndex: number, engine: string, count: number): void {
    void this.client
      .set(`${KEY_WAITING}${gpuIndex}:${engine}`, String(count), "PX", 10 * 60 * 1000)
      .catch(() => undefined);
  }

  describe() {
    return { mode: this.mode, backend: this.backend, owner: QUEUE_OWNER_ID };
  }

  async close(): Promise<void> {
    for (const timer of this.renewals.values()) clearInterval(timer);
    this.renewals.clear();
    try {
      await this.client.quit();
    } catch {
      this.client.disconnect();
    }
  }
}

// ─── 工厂 ──────────────────────────────────────────────────────────────────

function resolveMode(): CrossProcMode {
  const raw = process.env.KAP_GPU_QUEUE_CROSSPROC;
  if (raw === "off" || raw === "mirror" || raw === "strict") return raw;
  return process.env.REDIS_URL ? "mirror" : "off";
}

function envNum(name: string, fallback: number): number {
  const parsed = parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

let _gate: QueueGate | null = null;
let _gatePromise: Promise<QueueGate> | null = null;

/**
 * 获取跨进程门控单例 (首次调用可能连 redis — 异步工厂)。
 * redis 不可达 → 降级 OffGate + ERROR (fail-open, 业务不停摆)。
 */
export function getQueueGate(): Promise<QueueGate> {
  if (_gate) return Promise.resolve(_gate);
  if (_gatePromise) return _gatePromise;
  const mode = resolveMode();
  if (mode === "off" || !process.env.REDIS_URL) {
    _gate = new OffGate();
    return Promise.resolve(_gate);
  }
  _gatePromise = (async () => {
    try {
      const { default: Redis } = await import("ioredis");
      const client = new Redis(process.env.REDIS_URL as string, {
        lazyConnect: false,
        maxRetriesPerRequest: 2,
        enableReadyCheck: true,
        retryStrategy: (times: number) => Math.min(times * 200, 2000),
      }) as unknown as RedisLike;
      const pong = await client.ping();
      if (pong !== "PONG") throw new Error("ping failed");
      _gate = new RedisGate(
        client,
        mode,
        envNum("KAP_GPU_QUEUE_CROSSPROC_TTL_MS", 40 * 60 * 1000),
        2 * 60 * 1000, // 镜像 TTL 2min (无心跳, 短 TTL 防陈旧)
        envNum("KAP_GPU_QUEUE_CROSSPROC_POLL_MS", 1_000),
      );
      console.log(`[gpuQueue:crossproc] initialized mode=${mode} backend=redis owner=${QUEUE_OWNER_ID}`);
    } catch (err) {
      console.error(
        `[gpuQueue:crossproc] redis unreachable — degrading cross-process gate to OFF (${String(err)}). ` +
          `Multi-process GPU coordination unavailable; engine routes continue single-process.`,
      );
      _gate = new OffGate();
    }
    return _gate;
  })();
  return _gatePromise;
}

/** 测试用 — 重置单例 */
export function __resetQueueGateForTests(): void {
  _gate = null;
  _gatePromise = null;
}

/** 测试用 — 注入 gate 实例 (集成测试用; 用后 __resetQueueGateForTests 还原) */
export function __setQueueGateForTests(gate: QueueGate): void {
  _gate = gate;
  _gatePromise = null;
}
