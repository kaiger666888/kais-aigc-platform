/**
 * In-process memory StateStore. Wraps Maps with async semantics so the
 * GpuScheduler code can be store-agnostic.
 *
 * Used when REDIS_URL is not set (single-process mode). Has no cross-process
 * visibility — only suitable for single Node process or when cross-process
 * coordination is explicitly not needed.
 *
 * 锁 TTL 惰性过期 (R1 关联缺陷修复, 2026-09-06): acquireLock 此前忽略 _ttlMs —
 * 持有者崩溃后锁永不过期, 只能重启进程。现锁记录带 acquiredAt+ttlMs, 读取路径
 * (acquire/get/getAll) 惰性清扫: 过期记录视为无锁, 他人可立即获取; 原 holder
 * 对已过期锁的 release 仍幂等成功 (但若已被他人重新获取则让位失败, 不误伤新
 * holder)。RedisStateStore 上线后本缺陷退化为 dev-only, 此处对齐语义。
 */

import type { StateStore } from "./stateStore";

interface LockRecord {
  holder: string;
  acquiredAt: number;
  ttlMs: number;
}

export class MemoryStateStore implements StateStore {
  readonly kind = "memory" as const;

  /** 可注入时钟 (单测做 TTL 时间跳跃); 缺省 Date.now */
  private now: () => number;

  private services = new Map<string, any>();
  private profiles = new Map<string, any>();
  private locks = new Map<number, LockRecord | null>();
  private kv = new Map<string, any>();

  constructor(opts?: { now?: () => number }) {
    this.now = opts?.now ?? Date.now;
  }

  /** 记录是否仍在 TTL 有效期内 (null = 未持有) */
  private liveRecord(gpuId: number): LockRecord | null {
    const rec = this.locks.get(gpuId);
    if (!rec) return null;
    if (this.now() - rec.acquiredAt >= rec.ttlMs) {
      this.locks.set(gpuId, null); // 惰性清扫: 过期即视为无锁
      return null;
    }
    return rec;
  }

  // ─── Services ──────────────────────────────────────────
  async getService(serviceId: string): Promise<any | null> {
    return this.services.get(serviceId) ?? null;
  }
  async setService(serviceId: string, state: any): Promise<void> {
    this.services.set(serviceId, state);
  }
  async getAllServices(): Promise<Array<[string, any]>> {
    return Array.from(this.services.entries());
  }
  async deleteService(serviceId: string): Promise<void> {
    this.services.delete(serviceId);
  }

  // ─── Profiles ──────────────────────────────────────────
  async getProfile(profileId: string): Promise<any | null> {
    return this.profiles.get(profileId) ?? null;
  }
  async setProfile(profileId: string, profile: any): Promise<void> {
    this.profiles.set(profileId, profile);
  }
  async getAllProfiles(): Promise<Array<[string, any]>> {
    return Array.from(this.profiles.entries());
  }

  // ─── Locks ─────────────────────────────────────────────
  async acquireLock(gpuId: number, holder: string, ttlMs: number): Promise<boolean> {
    const current = this.liveRecord(gpuId);
    if (current) {
      if (current.holder !== holder) return false;
      current.acquiredAt = this.now(); // 重入视为活跃信号, 刷新 TTL 起点
      return true;
    }
    this.locks.set(gpuId, { holder, acquiredAt: this.now(), ttlMs });
    return true;
  }
  async releaseLock(gpuId: number, holder: string): Promise<boolean> {
    const rec = this.locks.get(gpuId);
    if (!rec) return false;
    if (rec.holder !== holder) return false; // 已被他人重新获取 — 不误伤新 holder
    this.locks.set(gpuId, null); // 过期未易主也在此幂等清掉
    return true;
  }
  async getLock(gpuId: number): Promise<string | null> {
    return this.liveRecord(gpuId)?.holder ?? null;
  }
  async getAllLocks(): Promise<Array<[number, string | null]>> {
    // 触发全部过期清扫 (读路径投影, 不改既有 [gpuId, holder|null] 形状)
    for (const gpuId of Array.from(this.locks.keys())) {
      this.liveRecord(gpuId);
    }
    return Array.from(this.locks.entries(), ([gpuId, rec]) => [gpuId, rec?.holder ?? null] as [number, string | null]);
  }

  // ─── Generic KV ────────────────────────────────────────
  async getKV<T = any>(key: string): Promise<T | null> {
    return this.kv.get(key) ?? null;
  }
  async setKV(key: string, value: any): Promise<void> {
    this.kv.set(key, value);
  }
  async deleteKV(key: string): Promise<void> {
    this.kv.delete(key);
  }

  // ─── Lifecycle ─────────────────────────────────────────
  async close(): Promise<void> {
    this.services.clear();
    this.profiles.clear();
    this.locks.clear();
    this.kv.clear();
  }
}
