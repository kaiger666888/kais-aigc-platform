# Roadmap

## Milestones

- ✅ **v1.0 MVP** - Phases 1-6 (shipped)
- ✅ **v1.1 Hermes Intelligent Decision Engine** - Phases 7-10 (shipped 2026-06-06)
- ✅ **v1.2 Integration Testing** - Phases 11-14 (shipped 2026-06-07)
- ✅ **v1.3 Architecture Alignment** - Phases 15-19.1 (shipped 2026-06-13)
- 🚧 **v1.4 Production Verification + Repo Governance** - Phases 20-22 (in progress)

## Phases

**Phase Numbering:**

- Integer phases (1-14): Shipped in previous milestones (v1.0-v1.2)
- Integer phases (15-19) + decimal (19.1): Shipped v1.3 milestone
- Integer phases (20-22): Current v1.4 milestone work
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

## Progress

**Execution Order:**
Phases execute in numeric order: 20 → 21 → 22

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 20. ACEStepEngine Backend Type Fix | v1.4 | 0/0 | Not started | - |
| 21. Live Runtime Verification | v1.4 | 0/0 | Not started | - |
| 22. Sibling Repo Governance | v1.4 | 0/0 | Not started | - |

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
