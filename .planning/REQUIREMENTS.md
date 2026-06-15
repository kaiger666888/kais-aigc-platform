# Requirements: KAIS AIGC Platform

**Defined:** 2026-06-15
**Core Value:** AI creative production pipeline that runs end-to-end, pluggable across multiple creative workflows (movie / podcast / ads / interactive) via a published skill contract.

## v1.6 Requirements — Workflow Skill Contract

Each requirement maps to a phase in ROADMAP.md (Phase 28-34). Traceability filled during roadmap creation.

### CONTRACT — Skill Contract Spec + TS Interface (Phase 28)

- [x] **CONTRACT-01**: SkillManifest TypeScript interface exists at `src/skills/contract.ts` declaring fields `skill_id`, `version`, `node_types[]`, `phase_taxonomy[]`, `runtime`
- [x] **CONTRACT-02**: zod validator at `src/skills/validator.ts` parses and rejects malformed manifests
- [x] **CONTRACT-03**: Spec doc at `.planning/specs/SKILL-CONTRACT.md` documents the contract; spec is generated from or field-equality-tested against the zod schema (no drift)
- [x] **CONTRACT-04**: Manifest versioning rule documented — `major.minor` only; minor = additive; platform accepts any `1.x` manifest at runtime
- [x] **CONTRACT-05**: Node type ID namespacing enforced — validator rejects bare IDs; all node types must use `<skill_id>::<type>` format
- [x] **CONTRACT-06**: Spec explicitly states "manifest is descriptive; behavior is platform-side" — no executable code in manifest

### REGISTRY — DB Migration + Registry Skeleton (Phase 29)

- [x] **REGISTRY-01**: `o_skillRegistry` table created (NEW) with columns `skill_id` (PK), `version`, `manifest` (TEXT JSON blob), `registered_at`
- [x] **REGISTRY-02**: `o_assets` table extended with `skill_id` + `workflow_phase` columns (closes prior audit gap on phase asset management)
- [x] **REGISTRY-03**: `kv_pipelineRun` table extended with `skill_id` column (avoids join-through-`o_project` latency in callback hot path)
- [x] **REGISTRY-04**: Backfill migration sets existing rows to `movie-v1` using `WHERE skill_id IS NULL` (handles orphaned assets correctly)
- [x] **REGISTRY-05**: `src/skills/registry.ts` singleton with lookup methods: `get(skillId)`, `list()`, `phaseById(skillId, phaseId)`, `nodeTypeById(skillId, typeId)`
- [x] **REGISTRY-06**: `src/skills/loader.ts` boot loader hydrates in-memory cache from `o_skillRegistry` on platform start

### API — REST Endpoints (Phase 30)

- [ ] **API-01**: `GET /api/v1/skills` returns list of registered skills (id, version, registered_at)
- [ ] **API-02**: `GET /api/v1/skills/:skillId` returns full manifest
- [ ] **API-03**: `POST /api/v1/skills/register` validates manifest via zod and UPSERTs into `o_skillRegistry`
- [ ] **API-04**: `GET /api/v1/skills/:skillId/node-types` returns node type declarations
- [ ] **API-05**: `GET /api/v1/skills/:skillId/phases` returns phase taxonomy
- [ ] **API-06**: `defaultSkill.ts` seeds `movie-v1` manifest into `o_skillRegistry` on empty-DB boot (zero-config upgrade path)

### PIPELINE — Callback Refactor (Phase 31)

- [ ] **PIPELINE-01**: `src/routes/v1/pipeline/callback/phase-complete.ts` uses `registry.phaseById(skill_id, phase).requires_review` instead of `REVIEW_REQUIRED_PHASES` constant
- [ ] **PIPELINE-02**: `src/routes/v1/pipeline/callback/phase-complete.ts` uses `phaseDecl.ingest_outputs` instead of `PHASE_INGEST_MAP` constant
- [ ] **PIPELINE-03**: `src/routes/v1/pipeline/resume.ts` uses registry's phase order instead of `PHASE_ORDER` constant
- [ ] **PIPELINE-04**: `src/routes/v1/pipeline/submit-to-review.ts` validates phase string against registry instead of closed enum
- [ ] **PIPELINE-05**: Equivalence test asserts new code path produces identical behavior to old constants for movie-v1 manifest (regression guard)

### CANVAS — Node Type Registry Integration (Phase 32)

- [ ] **CANVAS-01**: `packages/infinite-canvas` loads node types from `/api/v1/skills/:skillId/node-types` instead of hardcoded `nodeTypes` map
- [ ] **CANVAS-02**: Built-in renderers (`script`, `asset`, `storyboard`, `video`, `audio`) remain as platform primitives — they are NOT movie-v1 properties
- [ ] **CANVAS-03**: Unknown node types render via `FallbackNode` component (platform does not crash on unfamiliar types)
- [ ] **CANVAS-04**: `src/routes/canvas/projectData.ts` uses registry lookup instead of hardcoded `NODE_TYPES` constant

### COMPLIANCE — kais-movie-agent Manifest + E2E (Phase 33)

- [ ] **COMPLIANCE-01**: `movie-v1.manifest.json` exists at `docs/skill-author-guide/movie-v1.manifest.json` as install-ready artifact for OpenClaw workspace
- [ ] **COMPLIANCE-02**: `movie-v1.manifest.json` registers successfully via `POST /api/v1/skills/register` against live platform
- [ ] **COMPLIANCE-03**: End-to-end test runs existing movie pipeline through refactored callbacks without regression (golden path)
- [ ] **COMPLIANCE-04**: Negative test — registering a manifest with unknown phase does not crash platform; treats unknown phase as `requires_review: false, ingest_outputs: []`
- [ ] **COMPLIANCE-05**: Phase 33 VERIFICATION.md distinguishes "skipped" (yellow) from "passed" (green) from "failed" (red) — no silent test skips

### DOCS — Skill Author Guide (Phase 34)

- [ ] **DOCS-01**: `docs/skill-author-guide.md` exists with manifest field reference, examples, and versioning rules
- [ ] **DOCS-02**: Deploy order documented — platform first → register manifest via API → upgrade OpenClaw-side skill
- [ ] **DOCS-03**: "What NOT to do" section included — explicit anti-features (no sandboxing, no executable manifest code, no dynamic React loading)
- [ ] **DOCS-04**: Includes the `movie-v1.manifest.json` example inline with annotated comments

## v2 Requirements (Deferred to v1.7+)

Acknowledged but not in current roadmap. Will be planned when a second workflow skill is actually built.

### Skill Authoring DX

- **AUTHOR-01**: Skill scaffolding CLI (`kais-skill new`) generates manifest skeleton
- **AUTHOR-02**: Hot-reload — skill authors see manifest changes reflected without platform restart
- **AUTHOR-03**: Manifest validator CLI (`kais-skill validate manifest.json`) for offline testing

### Multi-Skill Capabilities

- **MULTI-01**: Single project can host multiple skills (current v1.6 is one skill per project via `o_project.projectType`)
- **MULTI-02**: Conflict resolution when two skills register overlapping node type IDs
- **MULTI-03**: Skill marketplace / discovery (vs current manual install via POST register)

### Advanced Renderer System

- **RENDER-01**: Custom node renderers via HTTPS module URLs (Architecture AP-4 explicitly defers)
- **RENDER-02**: Renderer version negotiation (skill declares compatible renderer versions)

### Health & Telemetry

- **HEALTH-01**: Per-skill success/failure tracking (reuse hermes EWMA pattern from v1.1)
- **HEALTH-02**: Skill health dashboard
- **HEALTH-03**: Auto-disable skills with sustained failure rate

## Out of Scope

Explicitly excluded from v1.6 to prevent scope creep. Documented reasoning below.

| Feature | Reason |
|---------|--------|
| Second reference skill implementation (podcast / ads / interactive) | v1.6 validates the abstraction against the existing kais-movie-agent only; a 2nd skill is v1.7+ work |
| Sandboxing / permission matrix for skills | Single-tenant creative platform; not multi-tenant SaaS; threat model doesn't justify complexity |
| Skill marketplace / discovery | Manual install via `POST /api/v1/skills/register` is sufficient for v1.6; marketplace is product strategy, not technical scope |
| Runtime dynamic React component loading | Architecture AP-4 — cross-bundle dynamic loading is brittle (version skew, CSP, chunk boundaries); built-in renderers cover 80% need |
| Skill-as-code execution in manifest | Manifest is descriptive only (CONTRACT-06); behavior stays platform-side; executable manifests drift toward Turing-complete config |
| Capability negotiation protocol | Over-engineered for current single-skill-per-project model; defer until multi-skill projects (v1.7+ MULTI-01) actually ship |
| Backwards-compat adapter layer | User explicitly chose "breaking change OK" — kais-movie-agent upgraded in lockstep; no legacy adapter needed |
| Per-skill database isolation | All skills share `o_assets` / `kv_pipelineRun`; `skill_id` column provides sufficient isolation at v1.6 scale |

## Traceability

Filled during roadmap creation. Each v1.6 requirement maps to exactly one phase (28-34).

| Requirement | Phase | Status |
|-------------|-------|--------|
| CONTRACT-01 | Phase 28 | Complete |
| CONTRACT-02 | Phase 28 | Complete |
| CONTRACT-03 | Phase 28 | Complete |
| CONTRACT-04 | Phase 28 | Complete |
| CONTRACT-05 | Phase 28 | Complete |
| CONTRACT-06 | Phase 28 | Complete |
| REGISTRY-01 | Phase 29 | Complete |
| REGISTRY-02 | Phase 29 | Complete |
| REGISTRY-03 | Phase 29 | Complete |
| REGISTRY-04 | Phase 29 | Complete |
| REGISTRY-05 | Phase 29 | Complete |
| REGISTRY-06 | Phase 29 | Complete |
| API-01 | Phase 30 | Pending |
| API-02 | Phase 30 | Pending |
| API-03 | Phase 30 | Pending |
| API-04 | Phase 30 | Pending |
| API-05 | Phase 30 | Pending |
| API-06 | Phase 30 | Pending |
| PIPELINE-01 | Phase 31 | Pending |
| PIPELINE-02 | Phase 31 | Pending |
| PIPELINE-03 | Phase 31 | Pending |
| PIPELINE-04 | Phase 31 | Pending |
| PIPELINE-05 | Phase 31 | Pending |
| CANVAS-01 | Phase 32 | Pending |
| CANVAS-02 | Phase 32 | Pending |
| CANVAS-03 | Phase 32 | Pending |
| CANVAS-04 | Phase 32 | Pending |
| COMPLIANCE-01 | Phase 33 | Pending |
| COMPLIANCE-02 | Phase 33 | Pending |
| COMPLIANCE-03 | Phase 33 | Pending |
| COMPLIANCE-04 | Phase 33 | Pending |
| COMPLIANCE-05 | Phase 33 | Pending |
| DOCS-01 | Phase 34 | Pending |
| DOCS-02 | Phase 34 | Pending |
| DOCS-03 | Phase 34 | Pending |
| DOCS-04 | Phase 34 | Pending |

**Coverage:**
- v1.6 requirements: 36 total (CONTRACT: 6, REGISTRY: 6, API: 6, PIPELINE: 5, CANVAS: 4, COMPLIANCE: 5, DOCS: 4)
- Mapped to phases: 36 / 36 ✓
- Unmapped: 0

---

*Requirements defined: 2026-06-15*
*Last updated: 2026-06-15 after v1.6 roadmap creation — traceability populated, 36/36 requirements mapped*
