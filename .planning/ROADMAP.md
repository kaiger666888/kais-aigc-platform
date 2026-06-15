# Roadmap

## Milestones

- ✅ **v1.0 MVP** — Phases 1-6 (shipped)
- ✅ **v1.1 Hermes Intelligent Decision Engine** — Phases 7-10 (shipped 2026-06-06)
- ✅ **v1.2 Integration Testing** — Phases 11-14 (shipped 2026-06-07)
- ✅ **v1.3 Architecture Alignment** — Phases 15-19.1 (shipped 2026-06-13)
- ✅ **v1.4 Production Verification + Repo Governance** — Phases 20-22 (shipped 2026-06-13, partial)
- ✅ **v1.5 Architecture Hardening + Code Hygiene** — Phases 23-27 (shipped 2026-06-14)
- ✅ **v1.6 Workflow Skill Contract** — Phases 28-34 (shipped 2026-06-15)

## Phases

**Phase Numbering:**

- Integer phases (1-14): Shipped in v1.0-v1.2
- Integer phases (15-19) + decimal (19.1): Shipped v1.3
- Integer phases (20-22): v1.4
- Integer phases (23-27): v1.5
- Integer phases (28-34): v1.6 (shipped)
- Decimal phases (e.g., 28.1): Urgent insertions

Decimal phases appear between their surrounding integers in numeric order.

### ✅ Previous Milestones (Shipped)

<details>
<summary>Phases 1-22: v1.0, v1.1, v1.2, v1.3, v1.4 — collapsed</summary>

#### v1.0 MVP (Phases 1-6)

Core video/image/audio generation pipeline via ComfyUI + cloud fallback.

#### v1.1 Hermes Intelligent Decision Engine (Phases 7-10)

Domain-agnostic REST API with self-learning loop. 21 requirements satisfied.

#### v1.2 Integration Testing (Phases 11-14)

Complete hermes-agent integration test suite. 42+ tests, CI pipeline. 22 requirements satisfied.

#### v1.3 Architecture Alignment (Phases 15-19.1)

Engine consolidation, workflow builder expansion, BackendType classification. 102/102 tests passing. Shipped 2026-06-13 with 4 deferred gaps (FIX-02/03, MERGE-03, ENG-04) carried into v1.4.

#### v1.4 Production Verification + Repo Governance (Phases 20-22)

ENG-04 fix shipped (commit 1d5996a). Live runtime verification partial — VERIFY-03 hardware-blocked. 19 sibling repos audited (commit 6c9c3b1). Mid-milestone acceleration: ACE route convergence (commits e3d649e, e817e18) closed v1.5 scope ahead of plan.

</details>

### ✅ v1.5 Architecture Hardening + Code Hygiene (Shipped 2026-06-14)

**Milestone Goal:** Close gaps exposed by v1.4 ACE route convergence — multi-process coordination, Python dead code, scattered output paths, vendored TS noise, router auto-gen root cause.

**Architecture decisions (v1.5):**

1. Phase numbering continues from v1.4 (Phase 23+)
2. v1.4 phase directories preserved as audit evidence
3. Scope strictly limited to 5 identified improvements, no new features
4. Hermes fix at main-project tsconfig level (exclude vendored dirs, not modify them)
5. Output paths: new convention + legacy alias (zero breaking changes)
6. router.ts auto-gen fix in core.ts (root cause) + cleanup of 12 existing config files

- [x] **Phase 23: GpuScheduler Redis Migration** — StateStore abstraction + memory/redis backends + factory with fallback (commit f302758)
- [x] **Phase 24: gold-team Python Cleanup** — Deleted acestep.py + docker_polling.py + 5 cleanup sites + Dockerfile stripping (commit 318e489)
- [x] **Phase 25: Output Path Convention** — src/lib/paths.ts + migration guide + ace/config demo (commit 25225a2)
- [x] **Phase 26: Hermes TS Exclude** — tsconfig.json exclude vendored dirs, 12,447 → 0 lint errors (commit a60b192)
- [x] **Phase 27: router.ts Auto-gen Fix** — core.ts SKIP_PATTERNS + cleanup of 12 config/shared files (commit 34393f1)

### ✅ v1.6 Workflow Skill Contract (Shipped 2026-06-15)

**Milestone Goal:** Introduce a workflow Skill Contract abstraction layer so the platform stops implicitly coupling to kais-movie-agent — any workflow skill (movie / animation / documentary / ads / short-video / poster / music-video / podcast / audiobook / interactive / game-cutscene) can register and drive the platform. The platform becomes skill-agnostic infrastructure; the manifest is the contract.

**Architecture decisions (v1.6):**

1. Phase numbering continues from v1.5 (Phase 28+)
2. **Contract lives in platform repo** — `src/skills/contract.ts` + `.planning/specs/SKILL-CONTRACT.md`; platform is source of truth
3. **Breaking changes allowed** — no legacy adapter layer; kais-movie-agent upgraded in lockstep
4. **Highly generic** — manifest must support all target skill variants, not hardcode movie shape
5. **Only one reference skill this milestone** — kais-movie-agent validates the abstraction; second skill is v1.7+
6. **No movie-agent feature work** — only minimal compliance upgrade (write manifest + register)
7. **Close phase-asset-management gap** as a byproduct (add `skill_id` + `workflow_phase` to `o_assets`)
8. **Manifest is descriptive, behavior is platform-side** (Pitfalls A4) — no executable code in manifest
9. **Registry is source of truth** (Architecture Pattern 3) — delete hardcoded constants, do not wrap them
10. **zod is source of truth for schema** — markdown spec generated or field-equality-tested against it (Pitfalls C1)
11. **Node type IDs are namespaced** `<skill_id>::<type>` (Pitfalls A3) — validator rejects bare IDs

- [x] **Phase 28: Skill Contract Spec + TS Interface** — `src/skills/contract.ts` (SkillManifest TS interface) + `src/skills/validator.ts` (zod v4) + `.planning/specs/SKILL-CONTRACT.md`. Namespacing rule, descriptive-only contract principle, drift test. 12/12 verify-phase-28 assertions.
- [x] **Phase 29: DB Migration + Registry Skeleton** — `o_skillRegistry` table; `o_assets` + `kv_pipelineRun` extended with `skill_id` (and `workflow_phase` on `o_assets`); orphan backfill to `movie-v1`; `registry.ts` singleton + `loader.ts` boot hydration. 29/29 verify-phase-29 assertions.
- [x] **Phase 30: Default Skill Seed + REST API** — `MOVIE_V1_MANIFEST` constant derived from prior constants; `seedDefaultIfEmpty()` zero-config boot seed; 5 REST endpoints (`GET/POST /api/v1/skills/*`). 61/61 verify-phase-30 assertions.
- [x] **Phase 31: Pipeline Callback Refactor** — `phase-complete.ts`, `resume.ts`, `submit-to-review.ts` consult `registry.phaseById` / `nodeTypeById`. Deleted `REVIEW_REQUIRED_PHASES`, `PHASE_INGEST_MAP`, `PHASE_ORDER`. Equivalence regression guard (`verify-phase-31.ts`). 91/91 assertions.
- [x] **Phase 32: Canvas Node Type Registry Integration** — `packages/infinite-canvas` fetches node types from `/api/v1/skills/:skillId/node-types`. Built-in renderers stay platform-side. `FallbackNode` handles unknown types. 39/39 verify-phase-32 assertions.
- [x] **Phase 33: kais-movie-agent Compliance + E2E** — Install-ready `docs/skill-author-guide/movie-v1.manifest.json`. 23 PASSED / 1 SKIPPED / 0 FAILED in verify-phase-33. **COMPLIANCE-03 (live Docker + GPU golden-path) deferred to pre-production sign-off** — environment-gated, not a code gap.
- [x] **Phase 34: Skill Author Documentation** — `docs/skill-author-guide.md` (field reference + deploy order + anti-features + annotated manifest example). 22/22 verify-phase-34 assertions.

**Full phase details:** see [milestones/v1.6-ROADMAP.md](milestones/v1.6-ROADMAP.md)
**Requirements archive:** see [milestones/v1.6-REQUIREMENTS.md](milestones/v1.6-REQUIREMENTS.md)
**Milestone audit:** see [milestones/v1.6-MILESTONE-AUDIT.md](milestones/v1.6-MILESTONE-AUDIT.md)

## Progress

**v1.6 Execution Order (shipped):**

```
28 (contract) → 29 (migration + registry) → 30 (default skill + REST API)
                                                ↓
                            31 (pipeline refactor) ──┐
                                                    ↓
                            32 (canvas integration) ─┤
                                                    ↓
                            33 (movie-agent compliance + E2E)
                                                    ↓
                            34 (skill author docs)
```

| Phase | Milestone | Plans / Verify | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 28. Skill Contract Spec + TS Interface | v1.6 | 2/2 + verify-phase-28 (12/12) | ✅ Complete | 2026-06-15 |
| 29. DB Migration + Registry Skeleton | v1.6 | 2/2 + verify-phase-29 (29/29) | ✅ Complete | 2026-06-15 |
| 30. Default Skill Seed + REST API | v1.6 | 2/2 + verify-phase-30 (61/61) | ✅ Complete | 2026-06-15 |
| 31. Pipeline Callback Refactor | v1.6 | 3/3 + verify-phase-31 (91/91) | ✅ Complete | 2026-06-15 |
| 32. Canvas Node Type Registry Integration | v1.6 | verify-phase-32 (39/39) | ✅ Complete | 2026-06-15 |
| 33. kais-movie-agent Compliance + E2E | v1.6 | verify-phase-33 (23/1/0) | ✅ Complete (1 deferred sign-off) | 2026-06-15 |
| 34. Skill Author Documentation | v1.6 | verify-phase-34 (22/22) | ✅ Complete | 2026-06-15 |

### Completed Milestones

| Phase | Milestone | Status | Completed |
|-------|-----------|--------|-----------|
| 28-34 | v1.6 Workflow Skill Contract | ✅ Complete (1 deferred sign-off) | 2026-06-15 |
| 23-27 | v1.5 Architecture Hardening + Code Hygiene | ✅ Complete | 2026-06-14 |
| 20-22 | v1.4 Production Verification + Repo Governance | ✅ Partial Complete | 2026-06-13 |
| 15-19.1 | v1.3 Architecture Alignment | ✅ Complete | 2026-06-13 |
| 11-14 | v1.2 Integration Testing | ✅ Complete | 2026-06-07 |
| 7-10 | v1.1 Hermes Decision Engine | ✅ Complete | 2026-06-06 |
| 1-6 | v1.0 MVP | ✅ Complete | - |
