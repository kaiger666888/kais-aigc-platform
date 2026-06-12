# Roadmap

## Milestones

- ✅ **v1.0 MVP** - Phases 1-6 (shipped)
- ✅ **v1.1 Hermes Intelligent Decision Engine** - Phases 7-10 (shipped 2026-06-06)
- ✅ **v1.2 Integration Testing** - Phases 11-14 (shipped 2026-06-07)
- 🚧 **v1.3 Architecture Alignment** - Phases 15-19 (in progress)

## Phases

**Phase Numbering:**

- Integer phases (1-14): Shipped in previous milestones
- Integer phases (15-19): Planned v1.3 milestone work
- Decimal phases (e.g., 15.1): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

### ✅ Previous Milestones (Shipped)

<details>
<summary>Phases 1-14: v1.0 MVP, v1.1 Hermes, v1.2 Integration Testing</summary>

#### v1.0 MVP (Phases 1-6)

Core video/image/audio generation pipeline via ComfyUI + cloud fallback.

#### v1.1 Hermes Intelligent Decision Engine (Phases 7-10)

Domain-agnostic REST API with self-learning loop. 21 requirements satisfied.

#### v1.2 Integration Testing (Phases 11-14)

Complete hermes-agent integration test suite. 42+ tests, CI pipeline. 22 requirements satisfied.

</details>

### 🚧 v1.3 Architecture Alignment — Engine Consolidation (In Progress)

**Milestone Goal:** Eliminate all gaps between Notion V5 architecture and actual codebase. Unify gold-team v6 engine system so deploy repo encompasses all research features.

- [ ] **Phase 15: Production Stability Fixes** - Fix ACE-Step container permissions and remove movie-agent dead code
- [ ] **Phase 16: v6 Code Merge** - Merge research repo engine code into deploy repo with regression testing
- [x] **Phase 17: Workflow Builder Expansion** - Implement 7 missing workflow builders and update routing table (completed 2026-06-12)
- [ ] **Phase 18: Engine Registration & Task Routing** - Unify engine registration by backend type and enable params.extra routing
- [ ] **Phase 19: Integration Verification** - End-to-end validation that all merged engines and new workflows work through the unified API

## Phase Details

### Phase 15: Production Stability Fixes

**Goal**: ACE-Step container runs stably without restarts, and movie-agent is fully removed from the codebase
**Depends on**: Nothing (first phase of v1.3, unblocks everything else)
**Requirements**: FIX-01, FIX-02, FIX-03, CLN-01, CLN-02, CLN-03
**Success Criteria** (what must be TRUE):

  1. ACE-Step container starts healthy and stays running (no PermissionError in logs)
  2. Music generation request succeeds through the unified API end-to-end
  3. Docker Compose files contain zero movie-agent service definitions
  4. No source code references to movie-agent remain (imports, configs, env vars)
  5. OpenClaw Agent can be verified as the replacement for movie-agent orchestration duties

**Plans**: 2 plans in 1 wave

Plans:

- [ ] 15-01-PLAN.md — Fix ACE-Step container permissions (user directive) and verify healthy start + music generation
- [ ] 15-02-PLAN.md — Remove movie-agent from Docker Compose, source code, env vars, build scripts; verify OpenClaw Agent coverage

### Phase 16: v6 Code Merge

**Goal**: Deploy repo contains all research repo engine features, verified by regression tests
**Depends on**: Phase 15 (clean codebase before merging)
**Requirements**: MERGE-01, MERGE-02, MERGE-03, MERGE-04
**Success Criteria** (what must be TRUE):

  1. Diff report exists listing every file changed between research and deploy repos
  2. Hunyuan3D-2mv and Wan2.1 GGUF engine code from research repo runs in deploy repo
  3. Updated Dockerfile and Python dependencies build successfully
  4. All existing deploy-repo features pass regression tests after merge (video gen, image gen, TTS, cloud fallback)

**Plans**: 3 plans in 3 waves

Plans:

- [ ] 16-01-PLAN.md — Generate diff report and change manifest (research vs deploy)
- [ ] 16-02-PLAN.md — Merge research engine code into deploy repo (new files, modified files, main.py merge)
- [ ] 16-03-PLAN.md — Update Dockerfile and dependencies, run regression tests

### Phase 17: Workflow Builder Expansion

**Goal**: All architecture-required workflow builders exist and are registered to correct TaskTypes
**Depends on**: Phase 16 (merged codebase as the working base)
**Requirements**: WFB-01, WFB-02, WFB-03, WFB-04, WFB-05, WFB-06, WFB-07, WFB-08
**Success Criteria** (what must be TRUE):

  1. FLUX Dev text-to-image workflow generates images via workflow_builder
  2. FLUX + IP-Adapter face-preservation workflow produces face-consistent images
  3. Hunyuan3D and TRELLIS2 3D generation workflows produce 3D output files
  4. FLUX + TRELLIS2 full chain produces 3D output from text prompt
  5. Lip sync and frame interpolation workflows are callable and route via params.extra.mode
  6. Workflow builder routing table includes all new builders mapped to their TaskTypes

**Plans**: 4 plans in 2 waves

Plans:
**Wave 1**

- [x] 17-01-PLAN.md — Create test scaffold and verify existing builders (WFB-01, WFB-02, WFB-03)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 17-02-PLAN.md — Implement new builders: lipsync (WFB-06) and frame_interpolate (WFB-07)
- [x] 17-03-PLAN.md — Add TRELLIS routing to executor and router (WFB-04, WFB-05)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 17-04-PLAN.md — Add lip_sync and frame_interp routing to executor (WFB-08)

### Phase 18: Engine Registration & Task Routing

**Goal**: Engines register by backend type (not by model), and TaskType routing supports params.extra for fine-grained capability selection
**Depends on**: Phase 17 (all workflows in place before wiring routing)
**Requirements**: ENG-01, ENG-02, ENG-03, ENG-04, TASK-01, TASK-02, TASK-03, TASK-04
**Success Criteria** (what must be TRUE):

  1. Engine registration log shows engines grouped by backend type (ComfyUI / Independent API / Cloud / Subprocess)
  2. No per-model Engine subclasses exist for ComfyUI models -- all go through ComfyUIEngine + workflow_builder
  3. Submitting a VIDEO_FINAL task with params.extra.mode = "lip_sync" triggers the lip sync workflow
  4. Submitting an UPSCALE task with params.extra.mode = "frame_interp" triggers frame interpolation
  5. Submitting an IMAGE_DRAW task with IP-Adapter/InstantID/PhotoMaker params triggers the correct character consistency workflow
  6. ACE-Step (DockerPollingAPIEngine) and CloudEngine (Kling/Jimeng) continue working after registration refactor

**Plans**: TBD

Plans:

- [ ] 18-01: Refactor engine registration to backend-type grouping
- [ ] 18-02: Implement params.extra routing in executor for lip sync, frame interpolation, character consistency
- [ ] 18-03: Verify all engine types (ComfyUI, Docker polling, Cloud) function correctly

### Phase 19: Integration Verification

**Goal**: Every merged engine, new workflow, and routing path works end-to-end through the unified API
**Depends on**: Phase 18 (all wiring complete)
**Requirements**: None (cross-cutting validation phase using requirements from Phases 15-18)
**Success Criteria** (what must be TRUE):

  1. A complete short-drama pipeline test run succeeds: character image generation, video generation, lip sync, super-resolution, face restoration, frame interpolation
  2. Each TaskType (VIDEO, IMAGE, AUDIO, UPSCALE, VIDEO_FINAL, IMAGE_DRAW, IMAGE_REFINE) successfully routes to at least one engine
  3. Cloud fallback still works when ComfyUI engine is unavailable
  4. ACE-Step music generation succeeds through the unified API (regression from Phase 15 fix)
  5. No movie-agent references anywhere in the running system (regression from Phase 15 cleanup)

**Plans**: TBD

Plans:

- [ ] 19-01: End-to-end pipeline validation across all TaskTypes
- [ ] 19-02: Regression verification (ACE-Step, cloud fallback, movie-agent absence)

## Progress

**Execution Order:**
Phases execute in numeric order: 15 → 16 → 17 → 18 → 19

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 15. Production Stability Fixes | v1.3 | 0/2 | Not started | - |
| 16. v6 Code Merge | v1.3 | 0/3 | Not started | - |
| 17. Workflow Builder Expansion | v1.3 | 4/4 | Complete    | 2026-06-12 |
| 18. Engine Registration & Task Routing | v1.3 | 0/3 | Not started | - |
| 19. Integration Verification | v1.3 | 0/2 | Not started | - |

### Completed Milestones

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 11. Test Infrastructure | v1.2 | 2/2 | Complete | 2026-06-07 |
| 12. Movie-Agent Joint Integration | v1.2 | 2/2 | Complete | 2026-06-07 |
| 13. Stress & Stability Testing | v1.2 | 2/2 | Complete | 2026-06-07 |
| 14. CI Pipeline & Reporting | v1.2 | 2/2 | Complete | 2026-06-07 |
| 7-10. Hermes Decision Engine | v1.1 | 10/10 | Complete | 2026-06-06 |
| 1-6. MVP | v1.0 | - | Complete | - |
