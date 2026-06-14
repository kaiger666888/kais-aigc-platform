# Phase 23: GpuScheduler Redis Migration - Context

**Gathered:** 2026-06-14
**Status:** Ready for planning
**Mode:** Auto-generated from autonomous workflow (discuss skipped — requirements are well-scoped)

<domain>
## Phase Boundary

Migrate GpuScheduler state from in-memory module-level singleton (`let _instance`) to a Redis-backed store, with automatic memory fallback when REDIS_URL is unset. This closes the cross-process coordination gap exposed after ACE route convergence (commit e3d649e/e817e18) — multiple Node processes (dev + prod parallel, cluster workers, test runners) currently maintain independent GPU lock state and can corrupt each other.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion. Use ROADMAP phase goal, success criteria, and codebase conventions to guide decisions.

### Required
- REDIS_URL env var presence → Redis backend
- REDIS_URL absence → in-memory singleton (current behavior) + explicit WARN log
- Redis operations must be non-blocking; Redis outage should degrade gracefully to memory mode

### Suggested Approach
1. Extract state from `GpuScheduler` class members:
   - `private services: Map<string, ServiceState>`
   - `private profiles: Map<string, ServiceProfile>`
   - `private locks: Map<number, string | null>`
   - `private idleTimers: Map<string, NodeJS.Timeout>`
2. Define a `StateStore` interface with `get/set/del/has` semantics for each Map
3. Implement `MemoryStateStore` (current behavior, wrapped)
4. Implement `RedisStateStore` using `ioredis` (already in package.json — verify)
5. `getGpuScheduler()` factory: detect REDIS_URL → Redis; else memory + WARN log
6. Idle timers stay in-process (Node setTimeout); only persisted state moves to Redis
7. Add integration test: spawn 2 Node processes pointing at same Redis, verify they see same lock state

</decisions>

<code_context>
## Existing Code Insights

- `src/services/gpu/GpuScheduler.ts:478-484` — current `getGpuScheduler()` factory using module-level `let _instance`
- `src/services/gpu/GpuScheduler.ts:158-182` — `GpuScheduler` constructor initializes `services`/`profiles`/`locks` Maps
- `src/services/gpu/types.ts` — ServiceProfile, ServiceState, SchedulerState types
- `src/routes/v1/ace/_shared/asyncCallback.ts:60-80` — similar singleton pattern (`activeTrackers` Map) that could later benefit from same Redis backend, but **out of scope for this phase**
- `redis` service already in docker-compose.v9.yml (line ~?), `REDIS_URL=redis://redis:6379` already passed to core-backend (line 177)
- Existing deps: check `package.json` for `ioredis` — add if missing

</code_context>

<specifics>
## Specific Ideas

- Idle timers MUST stay in-process (Node setTimeout doesn't serialize). Only the data they manipulate moves to Redis.
- Lock TTL: GPU locks should have a TTL in Redis (e.g., 60s) so a crashed process can't hold a lock forever. Renew via heartbeat if the process is alive.
- Tests should run against both backends (parametrized), not just Redis.

</specifics>

<deferred>
## Deferred Ideas

- Redis pub/sub for real-time state sync notifications (e.g., when one process acquires a lock, others should refresh their view) — overkill for v1.5, polling is fine.
- Migrating `asyncCallback.ts` tracker Map to Redis — separate concern, not Phase 23 scope.
- Distributed GPU allocation fairness across processes — current "first-come first-served" via Redis SET NX is sufficient.

</deferred>
