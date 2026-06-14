# Milestones

## v1.5 Architecture Hardening + Code Hygiene (Shipped: 2026-06-14)

**Status:** ✅ Archived
**Phases:** 23–27 | **Requirements:** 9/9 satisfied
**Status:** tech_debt — 0 blockers, 11 deferred items (all runtime verification or opportunistic migrations)

### Key Accomplishments

1. **GpuScheduler Redis backend** (Phase 23) — Introduced `StateStore` abstraction with memory + Redis implementations; cross-process GPU lock coordination via Lua atomic release; factory `getGpuSchedulerAsync()` with auto-fallback. 13/13 memory-path tests pass.
2. **gold-team ACE-Step retirement** (Phase 24) — Deleted `acestep.py` + `docker_polling.py` (395 lines) + 5 cleanup sites + 7 Dockerfile ENV vars. Music generation now exclusively via Node-layer ComfyUI routes.
3. **Unified output path convention** (Phase 25) — `src/lib/paths.ts` with typed `engineOutputDir()` + backwards-compatible legacy env var aliases. Migration guide at `docs/OUTPUT-PATH-CONVENTION.md`.
4. **TypeScript compile clean** (Phase 26) — Added 4 vendored project excludes to tsconfig.json. `yarn lint` errors: 12,447 → 0.
5. **router.ts auto-gen root-cause fix** (Phase 27) — `src/core.ts` SKIP_PATTERNS regex skips config/_shared files. router.ts routes: 248 → 236 (12 phantom routes removed). Fixed the bug that v1.4 commit 7a9393e tried to address manually.

### Stats

- Requirements: 9/9 satisfied (SCHED/GOLD/PATH/HERMES/CORE)
- Commits: 9 (`6ca8313..a117e42`)
- Tests: verify-phase-23.ts (13 assertions, memory path); Redis path coded & ready
- Audit: `v1.5-MILESTONE-AUDIT.md`

### Known Deferred Items at Close

11 items across 5 phases — documented in audit. Highlights:
- Live Redis integration test (Phase 23) — awaits `docker compose up redis`
- Live `docker compose build kais-gold-team` (Phase 24) — awaits Docker daemon
- 32 ComfyUI routes to migrate to paths.ts (Phase 25) — opportunistic
- Live `yarn dev` startup observation (Phase 27) — runtime test

### Archive

- Roadmap: [milestones/v1.5-ROADMAP.md](milestones/v1.5-ROADMAP.md)
- Requirements: [milestones/v1.5-REQUIREMENTS.md](milestones/v1.5-REQUIREMENTS.md)
- Audit: [milestones/v1.5-MILESTONE-AUDIT.md](milestones/v1.5-MILESTONE-AUDIT.md)

---

## v1.4 Production Verification + Repo Governance (Shipped: 2026-06-13)

**Status:** ✅ Archived (partial)
**Phases:** 20-22

### Key Accomplishments

1. **Phase 20 (FIX):** ACEStepEngine backend_type classification fixed (MOCK → DOCKER); commit `1d5996a`
2. **Phase 21 (VERIFY):** 3/4 live runtime verifications closed; VERIFY-03 hardware-blocked (24GB GPU insufficient for ACE-Step XL inference)
3. **Phase 22 (REPO):** 19 sibling repos audited, movie-agent archived, REPO-MAP.md created

Mid-milestone acceleration: ACE route convergence (commits e3d649e, e817e18) closed v1.5 scope ahead of plan.

---

## v1.3 — Architecture Alignment: Engine Consolidation (Shipped: 2026-06-13)

**Status:** ✅ Archived
**Phases:** 15-19.1 | **Plans:** 16 | **Tests:** 102/102 passing

### Key Accomplishments

1. v6 代码合并(研发版 → 部署版,消除分叉)
2. 7 个 workflow builder 补全(flux_dev, flux_ipadapter, hunyuan3d, trellis, flux_trellis_full, lipsync, frame_interpolate)
3. BackendType 枚举分类(COMFYUI/SUBPROCESS/CLOUD/DOCKER/MOCK)
4. movie-agent 完全清退(OpenClaw Agent 替代)
5. ACE-Step 权限修复

### Archive

- Audit: [v1.3-MILESTONE-AUDIT.md](v1.3-MILESTONE-AUDIT.md)

---

## v1.2 — Integration Testing: Hermes-Agent

**Shipped:** 2026-06-07
**Status:** ✅ Archived
**Phases:** 11–14 | **Plans:** 8

### Key Accomplishments

1. Built isolated test environment (docker-compose.test.yml) for hermes-agent integration testing
2. Created 14 integration test files with 42+ test cases covering all API endpoints
3. Validated hermes-client.js end-to-end chain with real LLM (decide/audit/degradation/retry)
4. Stress tested with concurrent requests (10 concurrent, 20 mixed) and 100-cycle stability loop
5. Set up GitHub Actions CI workflow for PR-triggered automated testing with reporting

### Stats

- Requirements: 22/22 satisfied (15 Must + 7 Should)
- Test cases: 42+ across 14 test files
- CI: GitHub Actions + local `make test-integration`

### Archive

- Roadmap: [milestones/v1.1-ROADMAP.md](milestones/v1.1-ROADMAP.md)
- Requirements: [milestones/v1.1-REQUIREMENTS.md](milestones/v1.1-REQUIREMENTS.md)
- Audit: [v1.2-MILESTONE-AUDIT.md](v1.2-MILESTONE-AUDIT.md)

---

## v1.1 — Hermes Intelligent Decision Engine

**Shipped:** 2026-06-06
**Status:** ✅ Archived
**Phases:** 7–10 | **Plans:** 10

### Key Accomplishments

1. Built domain-agnostic REST API wrapper (decide/audit/register/health) around NousResearch/hermes-agent
2. Implemented EWMA-based self-learning loop (audit → memory → confidence adaptation)
3. Registered movie-pipeline as first domain with 14 expert skills and seed parameter memory
4. Adapted hermes-client.js with HERMES_DEFAULTS fallback; deployed as Docker container
5. Retired legacy hermes-worker-agent and kais-hermes services

### Stats

- Requirements: 21/21 satisfied
- Verification: All 4 phases passed
- Cross-phase integration: 5/5 flows verified
- E2E flows: 3/3 passing

### Archive

- Roadmap: [milestones/v1.1-ROADMAP.md](milestones/v1.1-ROADMAP.md)
- Requirements: [milestones/v1.1-REQUIREMENTS.md](milestones/v1.1-REQUIREMENTS.md)
- Audit: [v1.1-MILESTONE-AUDIT.md](v1.1-MILESTONE-AUDIT.md)

---

_For current project status, see [ROADMAP.md](ROADMAP.md)_
