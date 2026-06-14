/**
 * StateStore abstraction for GpuScheduler.
 *
 * Allows state (services, profiles, locks) to live in either in-process memory
 * (single-process default) or Redis (cross-process coordination).
 *
 * Selection happens at factory time in `getGpuScheduler()`. Once a scheduler
 * is constructed, its store is fixed for the lifetime of that instance.
 *
 * Concurrency semantics:
 *   - `setLock` and `clearLock` use atomic semantics (compare-and-swap)
 *   - All operations are async (even memory — keeps the GpuScheduler code uniform)
 */

export interface StateStore {
  /** Human-readable backend name, e.g. "memory" or "redis" */
  readonly kind: "memory" | "redis";

  // ─── Service state (key: serviceId) ────────────────────
  getService(serviceId: string): Promise<any | null>;
  setService(serviceId: string, state: any): Promise<void>;
  getAllServices(): Promise<Array<[string, any]>>;
  deleteService(serviceId: string): Promise<void>;

  // ─── Service profiles (key: profileId, immutable after register) ──
  getProfile(profileId: string): Promise<any | null>;
  setProfile(profileId: string, profile: any): Promise<void>;
  getAllProfiles(): Promise<Array<[string, any]>>;

  // ─── GPU locks (key: gpuId number) ─────────────────────
  /**
   * Atomically acquire a lock on a GPU.
   * Returns true if acquired, false if already held by another caller.
   * If `holder` already holds the lock, returns true (re-entrant).
   */
  acquireLock(gpuId: number, holder: string, ttlMs: number): Promise<boolean>;
  /** Release a lock; only succeeds if `holder` currently holds it. */
  releaseLock(gpuId: number, holder: string): Promise<boolean>;
  /** Get current lock holder for a GPU (null if unheld or expired). */
  getLock(gpuId: number): Promise<string | null>;
  /** Read all current locks; values are holder strings or null. */
  getAllLocks(): Promise<Array<[number, string | null]>>;

  // ─── Lifecycle ─────────────────────────────────────────
  /** Cleanup resources (close connections, etc). Idempotent. */
  close(): Promise<void>;
}
