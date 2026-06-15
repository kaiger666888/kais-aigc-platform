# Roadmap

## Milestones

- ✅ **v1.0 MVP** — Phases 1-6 (shipped)
- ✅ **v1.1 Hermes Intelligent Decision Engine** — Phases 7-10 (shipped 2026-06-06)
- ✅ **v1.2 Integration Testing** — Phases 11-14 (shipped 2026-06-07)
- ✅ **v1.3 Architecture Alignment** — Phases 15-19.1 (shipped 2026-06-13)
- ✅ **v1.4 Production Verification + Repo Governance** — Phases 20-22 (shipped 2026-06-13, partial)
- ✅ **v1.5 Architecture Hardening + Code Hygiene** — Phases 23-27 (shipped 2026-06-14)
- 🚧 **v1.6 Workflow Skill Contract** — Phases 28-34 (in progress)

## Phases

**Phase Numbering:**

- Integer phases (1-14): Shipped in v1.0-v1.2
- Integer phases (15-19) + decimal (19.1): Shipped v1.3
- Integer phases (20-22): v1.4
- Integer phases (23-27): v1.5
- Integer phases (28-34): v1.6 (this milestone)
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

### 🚧 v1.6 Workflow Skill Contract (In Progress)

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

- [ ] **Phase 28: Skill Contract Spec + TS Interface** — Manifest schema, zod validator, namespacing rule, descriptive-only contract principle
- [ ] **Phase 29: DB Migration + Registry Skeleton** — `o_skillRegistry` table, `o_assets` + `kv_pipelineRun` skill_id columns, orphan backfill, registry/loader singletons
- [ ] **Phase 30: Default Skill Seed + REST API** — movie-v1 default manifest, 5 REST endpoints, zero-config boot seeding
- [ ] **Phase 31: Pipeline Callback Refactor** — Replace 4 hardcoded phase constants with registry lookups, equivalence regression guard
- [ ] **Phase 32: Canvas Node Type Registry Integration** — Dynamic nodeTypes map from API, built-in renderers stay, FallbackNode for unknown types
- [ ] **Phase 33: kais-movie-agent Compliance + E2E** — Install-ready movie-v1 manifest, live registration, E2E golden-path, negative tests
- [ ] **Phase 34: Skill Author Documentation** — Field reference, deploy order, anti-features section, annotated manifest example

## Phase Details

### Phase 28: Skill Contract Spec + TS Interface
**Goal**: Any party can read a single source of truth (spec + zod schema + TS types) describing what a workflow Skill Manifest must contain, what versioning rules apply, and that manifests carry descriptive data only — no executable behavior
**Depends on**: Nothing (first phase of v1.6; pure design + types, no code imports from later phases)
**Requirements**: CONTRACT-01, CONTRACT-02, CONTRACT-03, CONTRACT-04, CONTRACT-05, CONTRACT-06
**Success Criteria** (what must be TRUE):
  1. A developer reading `.planning/specs/SKILL-CONTRACT.md` can enumerate every required and optional manifest field without opening any other file
  2. Feeding a malformed manifest (missing required field, wrong type, bare node type ID like `script` instead of `movie-v1::script`) to `validateManifest()` returns a structured rejection naming the violated rule
  3. The spec doc cannot silently drift from the validator — either the doc is generated from the zod schema, or a field-equality test fails CI when they diverge
  4. The spec explicitly states the four "contract invariants": manifest is descriptive only, version is `major.minor` (additive minor), platform accepts any `1.x`, node type IDs are `<skill_id>::<type>`
**Plans**: 2 plans
Plans:
- [x] 28-01-PLAN.md — Create src/skills/contract.ts (SkillManifest interface + sub-types + ManifestValidationError) + src/skills/validator.ts (zod v4 schema + validateManifest with namespacing/version/strict rules)
- [ ] 28-02-PLAN.md — Write .planning/specs/SKILL-CONTRACT.md (field reference + contract invariants + versioning rules) + src/skills/__tests__/contract.test.ts (drift test + negative validator tests) + scripts/verify-phase-28.ts runner

### Phase 29: DB Migration + Registry Skeleton
**Goal**: The platform has a persisted skill registry (`o_skillRegistry`) with existing data backfilled to `movie-v1`, plus an in-memory registry/cache layer that later phases can look up synchronously without touching SQL
**Depends on**: Phase 28 (registry/loader code imports `SkillManifest` type and zod validator from `src/skills/contract.ts` + `validator.ts`)
**Requirements**: REGISTRY-01, REGISTRY-02, REGISTRY-03, REGISTRY-04, REGISTRY-05, REGISTRY-06
**Success Criteria** (what must be TRUE):
  1. After running the migration on a database with pre-existing `o_assets` and `kv_pipelineRun` rows, every previously-NULL `skill_id` column is populated with `movie-v1` (no orphans, no rows left NULL where default applies) — including assets whose `projectId` was already deleted
  2. On platform boot with a populated `o_skillRegistry` table, `registry.list()` returns every active row without any additional SQL hit during subsequent lookups in the same process
  3. On platform boot with an empty `o_skillRegistry` table, the platform does not crash and `registry.list()` returns an empty list (default seeding is a Phase 30 concern)
  4. `registry.phaseById(skillId, phaseId)` and `registry.nodeTypeById(skillId, typeId)` return the declared object for known IDs and `undefined` for unknown IDs (no silent fallback to movie-v1)
**Plans**: TBD

### Phase 30: Default Skill Seed + REST API
**Goal**: The platform is operable end-to-end as a skill registry — it self-seeds the `movie-v1` manifest on empty-DB boot (zero-config upgrade), and exposes a REST surface that any client (OpenClaw, curl, future skill) can use to list, inspect, register, and pull node-type/phase declarations from registered skills
**Depends on**: Phase 29 (REST handlers call `registry.register/get/list`; default seed writes to `o_skillRegistry` via the loader)
**Requirements**: API-01, API-02, API-03, API-04, API-05, API-06
**Success Criteria** (what must be TRUE):
  1. Booting the platform against a fresh empty database results in `GET /api/v1/skills` returning one entry (`movie-v1`) with no manual operator action — zero-config upgrade
  2. `POST /api/v1/skills/register` with a valid manifest succeeds, persists the row, updates the in-memory cache without restart, and the same manifest is then retrievable via `GET /api/v1/skills/:skillId`
  3. `POST /api/v1/skills/register` with a malformed manifest (zod rejection or bare node type ID) returns a structured 4xx error and does NOT mutate the registry or DB
  4. `GET /api/v1/skills/:skillId/node-types` and `GET /api/v1/skills/:skillId/phases` return the declared arrays from the manifest, not derived constants
  5. `movie-v1` default manifest is derived from the existing `REVIEW_REQUIRED_PHASES` / `PHASE_INGEST_MAP` / `PHASE_ORDER` constants (translation, not invention) so Phase 31 has a known baseline
**Plans**: TBD

### Phase 31: Pipeline Callback Refactor
**Goal**: The platform's pipeline callback hot path makes phase decisions by asking the registry, not by reading hardcoded constants — eliminating the implicit movie-v1 coupling while provably preserving current movie-v1 behavior
**Depends on**: Phase 30 (refactored callbacks call `registry.phaseById` and `registry.nodeTypeById`; movie-v1 must already be registered so lookups succeed)
**Requirements**: PIPELINE-01, PIPELINE-02, PIPELINE-03, PIPELINE-04, PIPELINE-05
**Success Criteria** (what must be TRUE):
  1. A phase-complete callback for every phase that used to live in `REVIEW_REQUIRED_PHASES` produces the same `awaiting-review` vs `running` state transition it produced before the refactor — verifiable by the equivalence test
  2. A phase-complete callback's output ingest routing matches the old `PHASE_INGEST_MAP` behavior for every key that used to exist — verifiable by the equivalence test
  3. `POST /submit-to-review` accepts any phase string that exists in the active skill's manifest and rejects (4xx) any phase string that does not — no closed enum, no silent acceptance of unknown phases
  4. The constants `REVIEW_REQUIRED_PHASES`, `PHASE_INGEST_MAP`, `PHASE_ORDER`, and the closed phase enum are deleted (or kept only as a labeled deprecation marker per Pitfalls D3) — the registry is the single source of truth, not a fallback layer
  5. The equivalence test is checked into the repo and runs in the project's verify harness — future regressions to the callback path are caught
**Plans**: TBD

### Phase 32: Canvas Node Type Registry Integration
**Goal**: The infinite-canvas bundle renders any node type the active skill declares, falls back gracefully for unknown types, and stops hardcoding the movie-v1 node shape — enabling future skills to contribute their own node types without a canvas bundle repack
**Depends on**: Phase 30 (canvas fetches `/api/v1/skills/:skillId/node-types`, which must exist and be populated); partially overlap-able with Phase 31
**Requirements**: CANVAS-01, CANVAS-02, CANVAS-03, CANVAS-04
**Success Criteria** (what must be TRUE):
  1. Opening a project bound to `movie-v1` renders the same five node types (script / asset / storyboard / video / audio) as before the refactor — no visual regression
  2. A skill manifest that declares a sixth node type (e.g., `movie-v1::planning-note`) causes the canvas to render that node using its declared `default_renderer` without a bundle repack — proven by a test or manual exercise against a synthetic manifest
  3. A node type not present in any registered manifest (or a typo) renders via a `FallbackNode` component — the canvas does not crash, does not render blank, and surfaces a visible "unknown node type" indicator
  4. The five built-in renderers (script/asset/storyboard/video/audio) remain platform primitives keyed by `default_renderer` — they are NOT re-attributed to movie-v1 in code comments, types, or docs (Pitfalls AP-4 / CANVAS-02)
  5. `src/routes/canvas/projectData.ts` no longer references the old hardcoded `NODE_TYPES` constant — node type declarations come from the registry
**Plans**: TBD
**UI hint**: yes

### Phase 33: kais-movie-agent Compliance + E2E
**Goal**: The full v1.6 stack is validated end-to-end: an install-ready `movie-v1.manifest.json` registers against the live platform, the existing movie pipeline runs through the refactored callbacks without regression, and negative cases (unknown phase, malformed manifest) fail safe rather than crash
**Depends on**: Phase 31 + Phase 32 (callbacks refactored AND canvas integrated — full stack must be manifest-driven before E2E has meaning)
**Requirements**: COMPLIANCE-01, COMPLIANCE-02, COMPLIANCE-03, COMPLIANCE-04, COMPLIANCE-05
**Success Criteria** (what must be TRUE):
  1. The artifact `docs/skill-author-guide/movie-v1.manifest.json` exists, validates against the zod schema, uses namespaced node IDs (`movie-v1::*`), and can be copy-installed into an OpenClaw workspace without further editing
  2. `POST /api/v1/skills/register` with the movie-v1 manifest against a live, running platform succeeds and the manifest is retrievable via `GET /api/v1/skills/movie-v1` (round-trip integrity)
  3. An end-to-end movie pipeline run (golden path: requirement → script → storyboard → … → delivery) executes through the refactored callbacks and produces the same final state and asset set as an equivalent pre-v1.6 run — no state regression
  4. Registering a manifest with an unknown phase (e.g., `'made-up-phase'`) and then firing a phase-complete callback for that phase does NOT crash the platform — the platform treats it as `requires_review: false, ingest_outputs: []` (Pitfalls phase-33 warning)
  5. Phase 33 VERIFICATION.md distinguishes "skipped" (yellow — environment unavailable), "passed" (green — assertion ran and succeeded), and "failed" (red — assertion ran and failed) — no assertion silently skips (Pitfalls B4)
**Plans**: TBD

### Phase 34: Skill Author Documentation
**Goal**: A third-party skill author can read `docs/skill-author-guide.md` cover-to-cover and produce a valid manifest, register it, deploy in the correct order, and know what NOT to do — without needing to ask the platform maintainer any questions
**Depends on**: Phase 33 (docs describe the finalized, tested contract — not a moving target)
**Requirements**: DOCS-01, DOCS-02, DOCS-03, DOCS-04
**Success Criteria** (what must be TRUE):
  1. `docs/skill-author-guide.md` contains a complete field reference covering every field the zod validator enforces — no field is documented only in code
  2. The guide documents the deploy order explicitly: platform first → register manifest via `POST /api/v1/skills/register` → upgrade the OpenClaw-side skill — and the rollback path if any step fails (Pitfalls B2)
  3. The guide contains an explicit "What NOT to do" section naming the v1.6 anti-features: no sandboxing, no executable code in manifest, no dynamic React loading over HTTP, no skill-as-code drift (Pitfalls A4)
  4. The guide includes the `movie-v1.manifest.json` inline with annotated comments explaining each field — the reader sees a worked example, not just a schema
**Plans**: TBD

## Progress

**Execution Order:**

v1.6: Phases 28 → 29 → 30 are strictly serial (each imports from the prior). Phases 31 and 32 may overlap if execution supports it. Phase 33 is a validation gate — must come after 31 AND 32 both complete. Phase 34 (docs) is last, written after we know what actually shipped.

```
28 (contract)
    ↓
29 (migration + registry skeleton)
    ↓
30 (default skill + REST API)
    ↓
31 (pipeline refactor)  ──┐
                          ↓
32 (canvas integration)  ─┤
                          ↓
33 (movie-agent compliance + E2E)
                          ↓
34 (skill author docs)
```

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 23. GpuScheduler Redis Migration | v1.5 | ✅ | Complete | 2026-06-14 |
| 24. gold-team Python Cleanup | v1.5 | ✅ | Complete | 2026-06-14 |
| 25. Output Path Convention | v1.5 | ✅ | Complete | 2026-06-14 |
| 26. Hermes TS Exclude | v1.5 | ✅ | Complete | 2026-06-14 |
| 27. router.ts Auto-gen Fix | v1.5 | ✅ | Complete | 2026-06-14 |
| 28. Skill Contract Spec + TS Interface | v1.6 | 1/2 | In Progress|  |
| 29. DB Migration + Registry Skeleton | v1.6 | 0/TBD | Not started | - |
| 30. Default Skill Seed + REST API | v1.6 | 0/TBD | Not started | - |
| 31. Pipeline Callback Refactor | v1.6 | 0/TBD | Not started | - |
| 32. Canvas Node Type Registry Integration | v1.6 | 0/TBD | Not started | - |
| 33. kais-movie-agent Compliance + E2E | v1.6 | 0/TBD | Not started | - |
| 34. Skill Author Documentation | v1.6 | 0/TBD | Not started | - |

### Completed Milestones

| Phase | Milestone | Status | Completed |
|-------|-----------|--------|-----------|
| 20-22 | v1.4 Production Verification + Repo Governance | ✅ Partial Complete | 2026-06-13 |
| 15-19.1 | v1.3 Architecture Alignment | ✅ Complete | 2026-06-13 |
| 11-14 | v1.2 Integration Testing | ✅ Complete | 2026-06-07 |
| 7-10 | v1.1 Hermes Decision Engine | ✅ Complete | 2026-06-06 |
| 1-6 | v1.0 MVP | ✅ Complete | - |
