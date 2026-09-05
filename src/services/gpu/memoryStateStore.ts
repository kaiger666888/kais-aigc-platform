/**
 * In-process memory StateStore. Wraps Maps with async semantics so the
 * GpuScheduler code can be store-agnostic.
 *
 * Used when REDIS_URL is not set (single-process mode). Has no cross-process
 * visibility — only suitable for single Node process or when cross-process
 * coordination is explicitly not needed.
 */

import type { StateStore } from "./stateStore";

export class MemoryStateStore implements StateStore {
  readonly kind = "memory" as const;

  private services = new Map<string, any>();
  private profiles = new Map<string, any>();
  private locks = new Map<number, string | null>();
  private kv = new Map<string, any>();

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
  async acquireLock(gpuId: number, holder: string, _ttlMs: number): Promise<boolean> {
    const current = this.locks.get(gpuId);
    if (current === undefined || current === null) {
      this.locks.set(gpuId, holder);
      return true;
    }
    return current === holder;
  }
  async releaseLock(gpuId: number, holder: string): Promise<boolean> {
    const current = this.locks.get(gpuId);
    if (current === holder) {
      this.locks.set(gpuId, null);
      return true;
    }
    return false;
  }
  async getLock(gpuId: number): Promise<string | null> {
    return this.locks.get(gpuId) ?? null;
  }
  async getAllLocks(): Promise<Array<[number, string | null]>> {
    return Array.from(this.locks.entries());
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
