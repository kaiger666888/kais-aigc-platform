/**
 * Redis-backed StateStore for cross-process coordination.
 *
 * Uses key-prefix namespaces:
 *   - kais:gpu:services:<id>  → JSON ServiceState
 *   - kais:gpu:profiles:<id>  → JSON ServiceProfile
 *   - kais:gpu:locks:<gpuId>  → holder string (with TTL via SET NX EX)
 *
 * Cross-process semantics:
 *   - Locks use SET NX EX (atomic acquire with TTL)
 *   - Holder name disambiguates: only the original holder can release
 *   - TTL prevents dead-locks if a process crashes while holding a lock
 *
 * Failure modes:
 *   - If Redis is unreachable at construction: throws (factory should
 *     fall back to MemoryStateStore with WARN log)
 *   - If Redis goes down mid-operation: methods reject — caller (GpuScheduler)
 *     should catch and log; user-visible behavior is "no allocation" rather
 *     than "silent corruption"
 */

import Redis from "ioredis";
import type { StateStore } from "./stateStore";

const KEY_PREFIX_SERVICES = "kais:gpu:services:";
const KEY_PREFIX_PROFILES = "kais:gpu:profiles:";
const KEY_PREFIX_LOCKS = "kais:gpu:locks:";

const SCAN_COUNT = 100;

export class RedisStateStore implements StateStore {
  readonly kind = "redis" as const;
  private client: Redis;
  /** Set to true after close() so we don't keep issuing commands */
  private closed = false;

  constructor(redisUrl: string) {
    this.client = new Redis(redisUrl, {
      // Reasonable defaults for a single-process state store
      lazyConnect: false,
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      retryStrategy: (times) => Math.min(times * 200, 2000),
    });
  }

  /** Test connectivity — used by factory to validate before selecting. */
  async ping(): Promise<boolean> {
    try {
      const res = await this.client.ping();
      return res === "PONG";
    } catch {
      return false;
    }
  }

  // ─── Services ──────────────────────────────────────────
  async getService(serviceId: string): Promise<any | null> {
    const raw = await this.client.get(KEY_PREFIX_SERVICES + serviceId);
    return raw ? JSON.parse(raw) : null;
  }
  async setService(serviceId: string, state: any): Promise<void> {
    await this.client.set(KEY_PREFIX_SERVICES + serviceId, JSON.stringify(state));
  }
  async getAllServices(): Promise<Array<[string, any]>> {
    return this.scanKeyValues(KEY_PREFIX_SERVICES);
  }
  async deleteService(serviceId: string): Promise<void> {
    await this.client.del(KEY_PREFIX_SERVICES + serviceId);
  }

  // ─── Profiles ──────────────────────────────────────────
  async getProfile(profileId: string): Promise<any | null> {
    const raw = await this.client.get(KEY_PREFIX_PROFILES + profileId);
    return raw ? JSON.parse(raw) : null;
  }
  async setProfile(profileId: string, profile: any): Promise<void> {
    await this.client.set(KEY_PREFIX_PROFILES + profileId, JSON.stringify(profile));
  }
  async getAllProfiles(): Promise<Array<[string, any]>> {
    return this.scanKeyValues(KEY_PREFIX_PROFILES);
  }

  // ─── Locks ─────────────────────────────────────────────
  async acquireLock(gpuId: number, holder: string, ttlMs: number): Promise<boolean> {
    const key = KEY_PREFIX_LOCKS + gpuId;
    // First check if we already hold (re-entrance)
    const currentHolder = await this.client.get(key);
    if (currentHolder === holder) return true;

    // Atomic acquire: SET NX PX
    const ttlSec = Math.max(1, Math.ceil(ttlMs / 1000));
    const result = await this.client.set(key, holder, "PX", ttlSec, "NX");
    return result === "OK";
  }
  async releaseLock(gpuId: number, holder: string): Promise<boolean> {
    const key = KEY_PREFIX_LOCKS + gpuId;
    // Lua script: only delete if current value matches holder (atomic release)
    const script = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end`;
    const result = await this.client.eval(script, 1, key, holder);
    return result === 1;
  }
  async getLock(gpuId: number): Promise<string | null> {
    const holder = await this.client.get(KEY_PREFIX_LOCKS + gpuId);
    return holder ?? null;
  }
  async getAllLocks(): Promise<Array<[number, string | null]>> {
    const entries = await this.scanKeyValues(KEY_PREFIX_LOCKS);
    return entries.map(([k, v]) => [parseInt(k, 10), v as string | null]);
  }

  // ─── Lifecycle ─────────────────────────────────────────
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      await this.client.quit();
    } catch {
      // Force disconnect if quit fails
      this.client.disconnect();
    }
  }

  // ─── Internal helpers ──────────────────────────────────
  private async scanKeyValues(prefix: string): Promise<Array<[string, any]>> {
    const results: Array<[string, any]> = [];
    let cursor = "0";
    do {
      const [next, keys] = await this.client.scan(
        cursor,
        "MATCH",
        prefix + "*",
        "COUNT",
        SCAN_COUNT,
      );
      cursor = next;
      for (const fullKey of keys) {
        const id = fullKey.slice(prefix.length);
        const value = await this.client.get(fullKey);
        if (value === null) continue;
        try {
          results.push([id, JSON.parse(value)]);
        } catch {
          // Non-JSON value (e.g., raw lock holder string)
          results.push([id, value]);
        }
      }
    } while (cursor !== "0");
    return results;
  }
}
