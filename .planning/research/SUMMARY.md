# Research Summary: Workflow Skill Contract (v1.6)

**Milestone:** v1.6 — Workflow Skill Contract
**Researched:** 2026-06-15
**Inputs:** ARCHITECTURE.md (599 lines, codebase-audited) + PITFALLS.md (inline-written after researcher agent hit 3× consecutive 529s)
**Skipped inputs:** STACK.md (project follows zero-npm-deps principle; only relevant decision is JSON Schema validator = zod, already decided in Architecture), FEATURES.md (cross-ecosystem survey deferred to plan-phase per-dimension)

---

## Stack Additions

Architecture already specified the stack:
- **TypeScript types only** — `src/skills/contract.ts` as `SkillManifest` interface (no runtime library)
- **zod** for manifest validation (project already uses zod elsewhere; consistent)
- **No new containers / services** — skills run external to the platform (existing pattern: OpenClaw + HTTP)
- **No new build infrastructure** — follows BaseEngine/BackendType precedent

**Stack decision is closed.** No additional libraries needed.

---

## Feature Categories

### Table Stakes (Must)

From Architecture's anti-patterns + milestone decisions:

- **Skill Contract TypeScript interface** — `SkillManifest` describes `skill_id`, `node_types[]`, `phase_taxonomy[]`, `runtime`
- **o_skillRegistry table** — NEW; do NOT reuse `o_skillList` (legacy markdown prompt library, different schema)
- **Skill Registry singleton + boot loader** — load `o_skillRegistry` rows into in-memory cache on platform boot
- **Default skill seed** — `defaultSkill.ts` provides `movie-v1` baked-in fallback for zero-config upgrades
- **REST API surface** — `GET /api/v1/skills`, `GET /api/v1/skills/:id`, `POST /api/v1/skills/register`, `GET /api/v1/skills/:id/node-types`, `GET /api/v1/skills/:id/phases`
- **Phase-name hardcoding removal** — 4 files refactored (see Architecture for line numbers)
- **Asset schema migration** — `o_assets` + `kv_pipelineRun` both get `skill_id` (and `workflow_phase` on assets, closing the "phase asset management" gap from earlier audit)
- **Movie-v1 compliance** — translate existing constants into a manifest; verify zero regression

### Differentiators (Nice — defer to v1.7+)

- **Custom node renderers over HTTP** — Architecture AP-4 explicitly defers to v1.7+
- **Multi-skill coexistence in one project** — current scope is one skill per project (`o_project.projectType` acts as binding)
- **Capability negotiation / permission matrix** — over-engineered for single-tenant creative platform
- **Hot-reload for skill authors** — nice DX, not blocking
- **Skill health tracking** — could reuse hermes EWMA pattern from v1.1 (flagged for v1.7)

### Anti-Features (Avoid — explicit Out of Scope)

- **Sandboxing** — single-tenant creative platform, not multi-tenant SaaS
- **Plugin marketplace / discovery** — skills are installed manually via `POST /register`
- **Runtime dynamic React component loading** — version-skew brittle; built-in renderers cover 80% need
- **Skill-as-code execution in manifest** — manifest is descriptive only; behavior stays platform-side
- **Generality beyond Phase 28's frozen field set** — defer until a second skill actually needs more

---

## Suggested Phase Structure (Phases 28–34)

Architecture proposed this ordering; PITFALLS.md mapped pitfalls to phases:

| Phase | Topic | Key Outputs | Depends On | Critical Pitfalls Addressed |
|-------|-------|-------------|------------|------------------------------|
| 28 | Skill Contract spec + TS interface | `src/skills/contract.ts`, `.planning/specs/SKILL-CONTRACT.md`, zod validator | — | A1 (bloat), A2 (versioning), A4 (data-vs-code), C1 (spec drift) |
| 29 | DB migration + registry skeleton | `o_skillRegistry` table, `o_assets.skill_id` + `workflow_phase`, `kv_pipelineRun.skill_id`, `src/skills/{registry,loader}.ts` | 28 | A3 (node ID namespacing), C2 (orphan backfill) |
| 30 | Default skill seed + REST API | `defaultSkill.ts`, `src/routes/v1/skills/{list,get,register,node-types,phases}.ts` | 29 | B1 (derive manifest from constants), B5 (TS interop) |
| 31 | Pipeline callback refactor | 4 files refactored to use registry lookup; constants deleted | 30 | B1 (equivalence tests) — CRITICAL regression risk |
| 32 | Canvas integration | `FlowCanvas.tsx` loads node types from `/api/v1/skills/:id/node-types`; built-in renderers stay | 30 | (architecture phase-specific warning) |
| 33 | kais-movie-agent compliance + E2E | Side-artifact: `docs/skill-author-guide/movie-v1.manifest.json` for OpenClaw install; E2E regression test | 31, 32 | B1 (no regression), B2 (lockstep deploy), B4 (skip-vs-fail), C3 (deprecation cycle) |
| 34 | Skill author documentation | `docs/skill-author-guide.md` with deploy order, manifest examples, "what NOT to do" section | 33 | A4 (data-vs-code rule), B2 (deploy order) |

**Critical ordering:** 28→29→30 must be serial (each imports from prior). 31 and 32 can overlap if parallelizable. 33 validates the whole stack. 34 documents last (after we know what actually shipped).

---

## Watch Out For (Top 5 Risks)

Ranked by severity × likelihood:

1. **Breaking the live movie pipeline (B1)** — Phase 31 has highest regression risk. Mitigation: Phase 30 generates movie-v1 manifest from existing constants; Phase 31 has equivalence tests; Phase 33 runs E2E.

2. **Skill-as-data drift (A4)** — if not pinned in Phase 28 spec, Phase 32/33 will inevitably creep toward executable manifests. Mitigation: spec doc explicitly says "manifest is descriptive; behavior is platform-side."

3. **Node type ID collision (A3)** — without namespacing, v1.7's second skill will collide. Mitigation: Phase 28 spec mandates `<skill_id>::<type>` IDs; Phase 33 tests kais-movie-agent uses `movie-v1::*`.

4. **OpenClaw lockstep (B2)** — breaking change OK in platform code, but deployed OpenClaw instances also need the new manifest. Mitigation: Phase 33 produces install-ready manifest; Phase 34 docs include deploy order.

5. **Spec drift from validator (C1)** — markdown spec and zod schema inevitably diverge. Mitigation: zod IS the source of truth; markdown is generated or field-equality-tested.

---

## Architecture Decisions Reinforced

These are NOT new — they come from Architecture research. Listed here so gsd-roadmapper has them in one place:

1. **Reuse precedent, not tables** — pattern is BaseEngine + BackendType; data store is NEW `o_skillRegistry` (NOT `o_skillList`)
2. **Registry is source of truth** — delete hardcoded constants entirely (Architecture Pattern 3); do NOT wrap them as fallbacks
3. **Default seed on empty DB** — zero-config upgrade path (Architecture Pattern 2)
4. **Manifest as JSON blob** — store full manifest in one TEXT column (Architecture Pattern 1); matches existing `o_agentWorkData.data` pattern
5. **Built-in renderers stay** — `script/asset/storyboard/video/audio` are platform primitives, not movie-v1 properties; custom renderers are v1.7+
6. **Breaking changes allowed** (user decision #3) — but apply v1.5's "alias not breakage" lesson for migration discoverability

---

## Confidence Matrix

| Area | Confidence | Source |
|------|------------|--------|
| Integration points (file paths, NEW/MODIFIED) | HIGH | Architecture (line-cited) |
| Build order (phase dependencies) | HIGH | Architecture (traced through imports) |
| DB migration plan | HIGH | Architecture (schema-verified) |
| Canvas integration | HIGH | Architecture (ReactFlow v12 nodeTypes inspected) |
| Plugin-system pitfalls (A1-A4) | MEDIUM | Industry observation |
| Process pitfalls (B1-B5) | HIGH | v1.x retrospective lessons |
| Schema drift pitfalls (C1-C3) | MEDIUM | Industry observation |
| Suggested phase boundaries | HIGH | Architecture + this synthesis |
| Skill-author DX (Phase 34) | LOW | No external skill authors to interview |

---

## Open Questions for Plan-Phase

Don't try to resolve at roadmap level; let each plan-phase investigate:

1. **Phase 28**: zod-as-truth + zod-to-md generator vs hand-written doc with field-equality test
2. **Phase 29**: actual migration runner mechanism (Knex? Custom? Manual SQL?)
3. **Phase 30**: how does OpenClaw's `skill.manifest.json` get installed? Manual / scripted / HTTP on boot?
4. **Phase 32**: how does updated canvas bundle reach running Electron instances?
5. **Phase 33**: what's the rollback path if v1.6 ships and breaks something? (likely: revert platform, OpenClaw stays unaffected because manifest is no-op until registration)
