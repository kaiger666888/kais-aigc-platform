# Roadmap

## Milestones

- ✅ **v1.0 MVP** - Phases 1-6 (shipped)
- ✅ **v1.1 Hermes Intelligent Decision Engine** - Phases 7-10 (shipped 2026-06-06)
- ✅ **v1.2 Integration Testing** - Phases 11-14 (shipped 2026-06-07)
- ✅ **v1.3 Architecture Alignment** - Phases 15-19.1 (shipped 2026-06-13)
- 🚧 **v1.4 Production Verification + Repo Governance** - Phases 20-22 (in progress)
- 🚧 **v1.5 Architecture Hardening + Code Hygiene** - Phases 23-27 (defined)

## Phases

**Phase Numbering:**

- Integer phases (1-14): Shipped in previous milestones (v1.0-v1.2)
- Integer phases (15-19) + decimal (19.1): Shipped v1.3 milestone
- Integer phases (20-22): Current v1.4 milestone work
- Integer phases (23-27): Current v1.5 milestone work (Architecture Hardening + Code Hygiene)
- Decimal phases (e.g., 20.1): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

### ✅ Previous Milestones (Shipped)

<details>
<summary>Phases 1-19.1: v1.0 MVP, v1.1 Hermes, v1.2 Integration Testing, v1.3 Architecture Alignment</summary>

#### v1.0 MVP (Phases 1-6)

Core video/image/audio generation pipeline via ComfyUI + cloud fallback.

#### v1.1 Hermes Intelligent Decision Engine (Phases 7-10)

Domain-agnostic REST API with self-learning loop. 21 requirements satisfied.

#### v1.2 Integration Testing (Phases 11-14)

Complete hermes-agent integration test suite. 42+ tests, CI pipeline. 22 requirements satisfied.

#### v1.3 Architecture Alignment (Phases 15-19.1)

Engine consolidation, workflow builder expansion, BackendType classification. 102/102 tests passing. Shipped 2026-06-13 with 4 deferred gaps (FIX-02/03, MERGE-03, ENG-04) carried into v1.4.

</details>

### 🚧 v1.4 Production Verification + Repo Governance (In Progress)

**Milestone Goal:** Close the 4 deferred v1.3 gaps with live runtime verification and ENG-04 code fix, then audit and govern the 19 sibling repos to make the warehouse layout comprehensible to newcomers.

**Architecture decisions (v1.4):**
1. Priority order: stabilize first (FIX → VERIFY), then govern (REPO)
2. Phase numbering continues from v1.3 (Phase 20+)
3. v1.3 phase directories preserved as audit evidence (NOT archived)
4. Repo governance uses "classify, don't destroy" — `git mv` to `.archive/repos/` or DEPRECATED marker, no deletion

- [ ] **Phase 20: ACEStepEngine Backend Type Fix** - Fix the ENG-04 classification bug so ACE-Step is correctly typed as DOCKER and explicitly registered
- [ ] **Phase 21: Live Runtime Verification** - Bring up the full docker-compose.v9.yml stack and verify health, ACE-Step E2E music generation, and Dockerfile builds
- [ ] **Phase 22: Sibling Repo Governance** - Audit 19 sibling repos, classify active/legacy/archived, archive dead repos, produce inventory + dependency map + newcomer docs

### 🚧 v1.5 Architecture Hardening + Code Hygiene (Defined)

**Milestone Goal:** Close the engineering-coordination gaps exposed after ACE route convergence (commits e3d649e/e817e18) — cross-process coordination, legacy Python retirement, scattered path variables, router auto-gen meta-issue, and embedded-project type hygiene. No new features.

**Architecture decisions (v1.5):**
1. Phase numbering continues from v1.4 (Phase 23+)
2. Scope strictly limited to 5 identified improvements; no new features
3. Phases 23 (Redis) and 24 (Python cleanup) are independent — may run in parallel
4. Hermes fix: exclude from main tsconfig.json, do NOT modify vendored React project
5. Output paths: unified convention in `src/lib/paths.ts`, new code forced, old code migrated progressively
6. Router fix: skip rule in `src/core.ts` glob is the source-of-truth fix, not manual router.ts edits

- [ ] **Phase 23: GpuScheduler Redis Migration** - Move scheduler state from in-memory singleton to Redis-backed store with memory fallback so multiple Node processes share GPU lock/service state
- [ ] **Phase 24: gold-team Python Cleanup** - Delete acestep.py + 4 other dead-code sites; rebuild image; verify no ACESTEP traces in startup logs
- [ ] **Phase 25: Output Path Convention** - Create src/lib/paths.ts with unified OUTPUT_ROOT + engine subdirs; consolidate 6+ env vars with backwards-compatible aliases
- [ ] **Phase 26: Hermes TS Exclude** - Add exclude rule to main tsconfig.json so yarn lint/build no longer scans the vendored React project (41 errors disappear)
- [ ] **Phase 27: router.ts Auto-gen Fix** - Modify src/core.ts glob to skip config-only files + clean up wrongly-registered default exports; verify route list contains no config files

## Phase Details

### Phase 20: ACEStepEngine Backend Type Fix

**Goal**: ACEStepEngine is correctly classified as BackendType.DOCKER, explicitly registered in production, and protected by a regression test so the classification cannot silently revert
**Depends on**: Phase 19.1 (v1.3 closeout complete — codebase is the post-v1.3 baseline)
**Requirements**: FIX-04, FIX-05, FIX-06
**Success Criteria** (what must be TRUE):

  1. `ACEStepEngine().backend_type` returns `BackendType.DOCKER` (verified by `test_acestep_backend_type` assertion — no longer inherits MOCK)
  2. `ACEStepEngine` is explicitly instantiated and registered in `docker/gold-team/src/v6/main.py` engine registration section (not relying on YAML registry fallback)
  3. `GET /api/v1/engines` response classifies ACE-Step under `backend_type: "docker"` (not `"mock"`)
  4. Regression test `test_acestep_backend_type` runs in the existing test suite and passes alongside the 102 prior tests with zero regressions

**Plans**: TBD

### Phase 21: Live Runtime Verification

**Goal**: The full docker-compose.v9.yml stack starts, passes healthchecks, and produces real (non-mock) ACE-Step music output end-to-end — closing the 3 v1.3 deferred gaps that required Docker runtime
**Depends on**: Phase 20 (ENG-04 fix must be merged so ACE-Step is correctly classified during live verification)
**Requirements**: VERIFY-01, VERIFY-02, VERIFY-03, VERIFY-04
**Success Criteria** (what must be TRUE):

  1. `docker compose -f docker-compose.v9.yml up -d` brings up the core 7 services (comfyui-primary, comfyui-auxiliary, kais-core-backend, kais-gold-team, audit-db, redis, hermes-agent) and `docker compose ps` shows all 7 as `healthy` within their `start_period` windows
  2. `docker compose -f docker-compose.v9.yml --profile ace up -d kais-acestep` starts the ACE-Step container, `docker compose ps kais-acestep` shows `Status: healthy`, and `docker compose logs kais-acestep` contains zero `PermissionError` entries
  3. `POST http://localhost:8002/api/v1/tasks {"task_type":"music", ...}` returns a `task_id`; polling that task reaches a terminal state with an `.mp3` output artifact larger than 0 bytes (real ACE-Step output, not mock)
  4. `docker compose -f docker-compose.v9.yml build kais-core-backend kais-gold-team` completes with exit code 0 — both Dockerfiles build and all dependency installs succeed without errors

**Notes**: This phase requires Docker runtime with GPU access (RTX 3090). Verification commands must be run on the production host, not in CI/planning context. The deferred v1.3 requirements FIX-02, FIX-03, MERGE-03 are closed here.

**Plans**: TBD

### Phase 22: Sibling Repo Governance

**Goal**: A newcomer can understand the 19-repo warehouse layout in 5 minutes — every repo is classified, dead repos are archived (not deleted), and the Service-to-Repo dependency boundary is explicit
**Depends on**: Phase 21 (stabilization complete before governance — "先稳定再治理")
**Requirements**: REPO-01, REPO-02, REPO-03, REPO-04, REPO-05, REPO-06
**Success Criteria** (what must be TRUE):

  1. All 19 sibling repos are classified into exactly one of three states: active / legacy / archived (no repo unclassified)
  2. `.planning/REPO-INVENTORY.md` exists with 19 rows; every row has non-empty values for all four metadata fields: role description, last git commit date, referenced-by-compose flag, referenced-by-other-repo flag
  3. Every repo classified as dead/archived has been either `git mv`'d to `.archive/repos/` OR has a `DEPRECATED` marker at the top of its README — no repo is physically deleted, git history is preserved
  4. `docs/REPO-MAP.md` exists and contains: (a) the active repo list, (b) a Service-to-Repo dependency map showing which `build.context` each compose service comes from, (c) a call-relationship diagram — sufficient for a newcomer to orient in under 5 minutes
  5. No service in `docker-compose.v9.yml` has a missing or orphaned `build.context` path — every compose service's source repo is identified in the dependency map

**Plans**: TBD

### Phase 23: GpuScheduler Redis Migration

**Goal**: GpuScheduler state (locks, services, idleTimers) lives in Redis so multiple Node processes (dev + prod, cluster workers, test runners) share consistent GPU lock and service state — with a memory fallback so single-process deployments keep working when Redis is unavailable
**Depends on**: Phase 22 (v1.4 milestone work complete — v1.5 starts from stable baseline; no v1.4 dependency on this phase specifically, but milestone sequencing)
**Requirements**: SCHED-01, SCHED-02
**Success Criteria** (what must be TRUE):

  1. Two Node processes started simultaneously against the same Redis URL see the same GPU lock state — acquiring a lock in process A blocks/conflicts correctly in process B (verified by an integration test that spawns two processes or uses a shared Redis test DB)
  2. With `REDIS_URL` unset or unreachable, GpuScheduler falls back to the existing in-memory singleton and logs a single explicit `WARN GpuScheduler: REDIS_URL unavailable, falling back to in-process state (multi-process coordination disabled)` message — no silent degradation, no crash
  3. All existing GpuScheduler unit/behavior tests pass unchanged against the Redis backend (backward-compatible API: callers still see the same `acquire/release/listServices` interface)
  4. Idle-timer expiry and service stop triggers fire correctly under Redis backend (a service marked idle in one process is visible as stopped/released in another process reading the same Redis key)

**Plans**: TBD

### Phase 24: gold-team Python Cleanup

**Goal**: All ACE-Step subprocess-engine dead code is removed from gold-team Python sources and Dockerfile, the image rebuilds cleanly, and startup logs contain zero ACESTEP references — making the codebase match the architectural reality (ACE-Step is a standalone container managed at Node route layer, not a gold-team subprocess)
**Depends on**: Nothing (independent of Phase 23; can run in parallel)
**Requirements**: GOLD-01, GOLD-02
**Success Criteria** (what must be TRUE):

  1. `docker/gold-team/src/v6/engines/acestep.py` no longer exists; `grep -ri "acestep\|_build_acestep_payload\|ACESTEP_ENABLED" docker/gold-team/src/` returns zero matches across the 5 named sites (acestep.py, docker_polling.py `_build_acestep_payload`, engine_registry.py acestep entry, executor.py `extra.acestep` route, main.py ACESTEP_ENABLED block)
  2. `docker/gold-team/Dockerfile` no longer contains `ENV ACESTEP_API_HOST=127.0.0.1` (line 100) nor any ACESTEP-specific dependency install step — `grep -i "acestep" docker/gold-team/Dockerfile` returns zero matches
  3. `docker compose build kais-gold-team` completes with exit code 0 and the rebuilt image starts without import errors (no `ModuleNotFoundError` or `AttributeError` caused by the removals)
  4. `docker compose logs kais-gold-team` after fresh start contains zero lines matching `ACESTEP` / `acestep` (case-insensitive) — startup is clean of all ACE-Step references
  5. Existing gold-team tests still pass (no test depended on the removed code) — `pytest docker/gold-team/tests/` exits 0

**Plans**: TBD

### Phase 25: Output Path Convention

**Goal**: A single `src/lib/paths.ts` module defines the output path convention (`OUTPUT_ROOT` + per-engine subdirectories like `output/ace/`, `output/flux/`, `output/tts/`), the 6+ scattered env vars are consolidated under it with backwards-compatible aliases, and all NEW code is forced to use it — old routes continue to work unchanged via alias resolution
**Depends on**: Nothing (isolated work; large surface but additive)
**Requirements**: PATH-01, PATH-02
**Success Criteria** (what must be TRUE):

  1. `src/lib/paths.ts` exists and exports a typed API: at minimum `OUTPUT_ROOT`, `engineOutputDir(engine: EngineKind)`, and an `EngineKind` union covering ace/flux/tts/ltx/comfyui/etc. — importing it returns paths resolved from `OUTPUT_ROOT` (or its env override)
  2. Setting only `OUTPUT_ROOT=/mnt/agents/output` causes all of `OUTPUT_DIR`, `COMFYUI_OUTPUT_DIR`, `FLUX_OUTPUT_DIR`, `INDEXTTS2_OUTPUT_DIR`, `LTX_OUTPUT_DIR` to resolve to the correct subdirectories under it — the 6 legacy env vars remain as optional overrides/aliases and do not break existing deployments that set them directly
  3. A migration guide (`docs/OUTPUT-PATHS.md` or section in AGENTS.md) documents the new convention, the alias mapping, and how to migrate a route from legacy env vars to `src/lib/paths.ts` — sufficient for the 33-route progressive migration left to a future milestone
  4. At least one NEW or recently-touched route (e.g., one of the ACE routes added in the e3d649e convergence commit) imports `src/lib/paths.ts` and no longer reads a bespoke `*_OUTPUT_DIR` env var directly — proving the convention is usable in practice

**Plans**: TBD

### Phase 26: Hermes TS Exclude

**Goal**: The main project's `yarn lint` and `yarn build` no longer scan the vendored hermes-agent React project at `docker/hermes-agent/_hermes_source/**`, eliminating 41 TypeScript compile-noise errors from the main project build output
**Depends on**: Nothing (single-line tsconfig change; trivial but visible)
**Requirements**: HERMES-01
**Success Criteria** (what must be TRUE):

  1. `tsconfig.json` contains an `exclude` array entry matching `docker/hermes-agent/_hermes_source/**` (or equivalent glob) — verifiable by `jq '.exclude' tsconfig.json` returning an array containing the hermes path
  2. `yarn lint` (or `yarn tsc --noEmit`) completes with zero errors originating from files under `docker/hermes-agent/_hermes_source/` — the 41 prior errors are gone from main-project output
  3. `yarn build` still produces the main-project build artifact (e.g., `dist/` or compiled `router.ts`) without errors — the exclude does NOT accidentally drop main-project source files
  4. The vendored hermes-agent project itself is untouched (its own `docker/hermes-agent/_hermes_source/tsconfig.json` is NOT modified) — main project excludes, vendored project self-manages

**Plans**: TBD

### Phase 27: router.ts Auto-gen Fix

**Goal**: The `src/core.ts` fast-glob scan skips config-only and shared-module files (config.ts, `_shared/**`, `_lib/**`) so they are never registered as empty route handlers, AND existing wrongly-registered config files are cleaned up so `yarn dev` startup route list contains zero config/shared entries
**Depends on**: Nothing (independent; self-contained core.ts change)
**Requirements**: CORE-01, CORE-02
**Success Criteria** (what must be TRUE):

  1. `src/core.ts` glob pattern (or post-filter) explicitly skips files matching `config.ts`, `_shared/**`, and `_lib/**` — verifiable by reading the `entries` filtering logic in `src/core.ts` (an `ignore` option to `fg()` or an explicit `.filter()` step)
  2. Running `npx ts-node src/core.ts` (or whatever regenerates `src/router.ts`) produces a `router.ts` whose `app.use(...)` lines do NOT include any path under `config`, `_shared`, or `_lib` — `grep -E "config|_shared|_lib" src/router.ts` returns zero matches in the `app.use` registration block
  3. Existing config-only files (e.g., `src/routes/v1/ace/config.ts`, `src/routes/production/flux/config.ts`, and the 7 other identified sites) no longer `export default` a router (or no longer have a default export that core.ts picks up) — they export named config objects only
  4. `yarn dev` starts cleanly with no `TypeError: router.use is not a function` or similar empty-router warnings in startup logs; the registered route list printed at startup contains only real endpoints
  5. All existing functional routes still respond correctly after the cleanup (no working endpoint was accidentally dropped) — verified by hitting at least 3 representative endpoints (one from ace, one from flux, one from tts) and getting expected status codes

**Plans**: TBD

## Progress

**Execution Order:**

v1.4: Phases execute in numeric order: 20 → 21 → 22
v1.5: Phases 23 and 24 may run in parallel (independent); 25, 26, 27 are independent and self-contained. Suggested numeric order: 23 → 24 → 25 → 26 → 27 (but 23/24 parallelizable).

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 20. ACEStepEngine Backend Type Fix | v1.4 | 0/0 | Not started | - |
| 21. Live Runtime Verification | v1.4 | 0/0 | Not started | - |
| 22. Sibling Repo Governance | v1.4 | 0/0 | Not started | - |
| 23. GpuScheduler Redis Migration | v1.5 | 0/0 | Not started | - |
| 24. gold-team Python Cleanup | v1.5 | 0/0 | Not started | - |
| 25. Output Path Convention | v1.5 | 0/0 | Not started | - |
| 26. Hermes TS Exclude | v1.5 | 0/0 | Not started | - |
| 27. router.ts Auto-gen Fix | v1.5 | 0/0 | Not started | - |

### Completed Milestones

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 15. Production Stability Fixes | v1.3 | 2/2 | Complete | 2026-06-13 |
| 16. v6 Code Merge | v1.3 | 3/3 | Complete | 2026-06-13 |
| 17. Workflow Builder Expansion | v1.3 | 4/4 | Complete | 2026-06-12 |
| 18. Engine Registration & Task Routing | v1.3 | 3/3 | Complete | 2026-06-12 |
| 19. Integration Verification | v1.3 | 3/3 | Complete | 2026-06-12 |
| 19.1. Close v1.3 gaps (INSERTED) | v1.3 | 3/3 | Complete | 2026-06-13 |
| 11-14. Integration Testing | v1.2 | 8/8 | Complete | 2026-06-07 |
| 7-10. Hermes Decision Engine | v1.1 | 10/10 | Complete | 2026-06-06 |
| 1-6. MVP | v1.0 | - | Complete | - |
