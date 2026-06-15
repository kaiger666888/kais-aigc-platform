# Architecture Patterns: Workflow Skill Contract Integration (v1.6)

**Domain:** Pluggable skill abstraction over existing Node.js + Express + TypeScript AIGC platform
**Researched:** 2026-06-15
**Confidence:** HIGH (source-of-truth = this repo's own code; no external libraries involved)

---

## Executive Summary

The platform already has **two prior "skill" concepts** that must be carefully distinguished from the v1.6 SkillContract. The design is a **new third concept** that supersedes them in scope but reuses their tables and routes. v1.6 is a **decoupling refactor**, not a new feature: it externalizes the implicit movie-agent coupling in 4 hardcoded layers (canvas node types, phase taxonomy, asset ownership, review pipeline) into a manifest-driven registry that any future skill (podcast / ads / interactive / etc.) can register against.

**Key finding — three "skill" concepts, do not conflate:**

| Concept | Location | What it is | v1.6 action |
|---------|----------|-----------|-------------|
| OpenClaw sub-skills | `~/.openclaw/workspace/skills/kais-movie-agent/` (external) | 14 LLM-driven sub-agents (topic-selector, scenario-writer, etc.) | Untouched — those are movie-agent's internal concern |
| Legacy skillManagement routes | `src/routes/setting/skillManagement/{getSkillList,getSkillContent,saveSkillContent}.ts` + `o_skillList` table | A filesystem-doc browser for editing markdown skill prompts ("skills" as LLM prompt files) | Kept as-is, renamed conceptually to "prompt library" — **out of scope for v1.6 contract** |
| **v1.6 SkillContract** | `src/skills/contract.ts` (NEW) + `o_skillRegistry` (NEW) | A workflow-shape declaration: node types, phases, asset categories, review policy | This is what v1.6 introduces |

The research confirms: **reuse `o_skillList` table name is NOT recommended** — its schema (path/md5/embedding for markdown files) is wrong-fit for workflow manifests. Create a new `o_skillRegistry` table instead, and leave `o_skillList` alone (the prompt-library feature may continue to use it).

---

## Recommended Architecture

### High-Level Integration Topology

```
┌─────────────────────────────────────────────────────────────────────┐
│  EXTERNAL SKILLS (run wherever they want — OpenClaw / HTTP / etc.)  │
│                                                                     │
│   kais-movie-agent (OpenClaw)        future: kais-podcast-agent     │
│   ┌────────────────────────┐         ┌────────────────────────┐     │
│   │ skill.manifest.json    │         │ skill.manifest.json    │     │
│   │  skill_id: movie-v1    │         │  skill_id: podcast-v1  │     │
│   │  node_types: [5]       │         │  node_types: [3]       │     │
│   │  phases: [8]           │         │  phases: [4]           │     │
│   │  asset_categories:[6]  │         │  asset_categories:[2]  │     │
│   │  review_policy: {...}  │         │  review_policy: {...}  │     │
│   └────────────────────────┘         └────────────────────────┘     │
│              │ HTTP POST                        │ HTTP POST          │
│              ▼                                  ▼                    │
└─────────────────────────────────────────────────────────────────────┘
               │ registration (one-time per skill install)
               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  PLATFORM (kais-core-backend :8000) — SKILL-AGNOSTIC                │
│                                                                     │
│   ┌───────────────────────────────────────────────────────────┐     │
│   │ src/skills/                      (NEW — contract source)  │     │
│   │   contract.ts        TypeScript interface (SkillManifest) │     │
│   │   registry.ts        SkillRegistry singleton              │     │
│   │   loader.ts          DB → cache loader (boot)             │     │
│   │   validator.ts       zod schema + structural check        │     │
│   │   defaultSkill.ts    "movie-v1" baked-in fallback         │     │
│   └───────────────────────────────────────────────────────────┘     │
│                                                                     │
│   ┌───────────────────────────────────────────────────────────┐     │
│   │ src/routes/v1/skills/            (NEW — registry API)     │     │
│   │   list.ts            GET /api/v1/skills                   │     │
│   │   get.ts             GET /api/v1/skills/:skillId          │     │
│   │   register.ts        POST /api/v1/skills/register         │     │
│   │   node-types.ts      GET /api/v1/skills/:id/node-types    │     │
│   │   phases.ts          GET /api/v1/skills/:id/phases        │     │
│   └───────────────────────────────────────────────────────────┘     │
│                                                                     │
│   ┌───────────────────────────────────────────────────────────┐     │
│   │ MODIFIED — phase-name hardcoding removed                  │     │
│   │   src/routes/canvas/projectData.ts  (NODE_TYPES → API)    │     │
│   │   src/routes/v1/pipeline/callback/phase-complete.ts       │     │
│   │       (REVIEW_REQUIRED_PHASES + PHASE_INGEST_MAP → lookup)│     │
│   │   src/routes/v1/pipeline/resume.ts (PHASE_ORDER → lookup) │     │
│   │   src/routes/v1/pipeline/submit-to-review.ts              │     │
│   │       (phase enum → free string + validate vs registry)   │     │
│   └───────────────────────────────────────────────────────────┘     │
│                                                                     │
│   DB: o_skillRegistry (NEW)  +  o_assets +skill_id/workflow_phase    │
└─────────────────────────────────────────────────────────────────────┘
               ▲                              ▲
               │ fetches node-types & phases  │
┌──────────────┴──────────────────────────────┴───────────────────────┐
│  CANVAS (packages/infinite-canvas — ReactFlow v12)                  │
│                                                                     │
│   Currently: 5 hardcoded node components in main.tsx nodeTypes map  │
│   v1.6: dynamic nodeTypes map built from GET /api/v1/skills/:id/    │
│         node-types. Skill declares a React component URL (or the    │
│         platform serves a default renderer keyed on data schema).   │
└─────────────────────────────────────────────────────────────────────┘
```

### Component Boundaries

| Component | Responsibility | Communicates With | NEW / MODIFIED / DEPRECATED |
|-----------|---------------|-------------------|-----------------------------|
| `src/skills/contract.ts` | TypeScript interface for `SkillManifest` | Imported by registry, validator, routes | **NEW** |
| `src/skills/registry.ts` | In-memory cache of installed skills; lookup by `skill_id` | Loader (boot), routes (queries), pipeline callback (validation) | **NEW** |
| `src/skills/loader.ts` | Reads `o_skillRegistry` rows at boot, builds cache | DB (`o_skillRegistry`) | **NEW** |
| `src/skills/validator.ts` | Zod schema for manifest; structural validation on register | contract.ts | **NEW** |
| `src/skills/defaultSkill.ts` | In-repo definition of `movie-v1` (the legacy baseline) — auto-registered on first boot if DB empty | registry.ts | **NEW** (movie-v1 manifest lives in repo as data) |
| `src/routes/v1/skills/*.ts` | REST endpoints for skill registry CRUD | registry.ts | **NEW** (5 route files; auto-registered by `src/core.ts` glob) |
| `src/routes/canvas/projectData.ts` | `NODE_TYPES` constant becomes a proxy call to registry | Was hardcoded; now `registry.getNodeTypes(activeSkillId)` | **MODIFIED** |
| `src/routes/v1/pipeline/callback/phase-complete.ts` | `REVIEW_REQUIRED_PHASES` + `PHASE_INGEST_MAP` constants → registry lookup | Was hardcoded arrays | **MODIFIED** |
| `src/routes/v1/pipeline/resume.ts` | `PHASE_ORDER` hardcoded map → registry lookup | Was hardcoded 12-entry map | **MODIFIED** |
| `src/routes/v1/pipeline/submit-to-review.ts` | `phase: z.enum([...])` → `phase: z.string()` + registry validate | Was closed enum | **MODIFIED** |
| `o_assets` table | Add `skill_id` (TEXT, default `'movie-v1'`) + `workflow_phase` (TEXT, nullable) | Migration script | **MODIFIED** (additive) |
| `o_skillRegistry` table | Persist registered skill manifests | Created by migration | **NEW** |
| `packages/infinite-canvas/src/components/FlowCanvas.tsx` | `nodeTypes` map becomes dynamic (built from API response) | Fetches `/api/v1/skills/:id/node-types` on project load | **MODIFIED** |
| `packages/infinite-canvas/src/types/canvas.ts` | `CanvasNodeType` enum → open string + per-node schema lookup | Type-system change | **MODIFIED** |
| `src/routes/setting/skillManagement/*` | Existing markdown-prompt-browser — untouched | — | Unchanged (different concept; out of scope) |
| `o_skillList` / `o_skillAttribution` tables | Existing prompt-library tables — untouched | — | Unchanged |

---

## Detailed Integration Point Analysis (Q1–Q9 from the brief)

### Q1. Where does `SkillContract.ts` live?

**Decision: `src/skills/contract.ts`** (single file, in the main repo, exported as a TypeScript interface).

**Rationale:**
- The platform is the **source of truth** for the contract (per v1.6 architecture decision #2 in PROJECT.md). Not a separate npm package — only one consumer today, and a package adds publishing overhead with zero benefit.
- Skill authors who write external skills (like kais-movie-agent in OpenClaw) need the contract too. Solution: export a JSON Schema (`src/skills/contract.schema.json`) generated from the TS interface, and publish the manifest format spec in `docs/skill-author-guide.md`. External skills validate against the JSON Schema; they don't need the TS file.
- This mirrors how the existing `BackendType` enum lives in `docker/gold-team/src/v6/models/task.py` (single source) and is consumed via API contracts — not via a shared library.

**File layout (NEW directory):**

```
src/skills/
├── contract.ts          // SkillManifest interface + exported types
├── contract.schema.json // JSON Schema derivable from contract.ts (for external skills)
├── registry.ts          // SkillRegistry class — in-memory cache + lookup methods
├── loader.ts            // Boot loader: SELECT * FROM o_skillRegistry → registry.hydrate()
├── validator.ts         // zod schema mirroring contract.ts; validateManifest()
├── defaultSkill.ts      // movie-v1 manifest as a TS object literal (auto-seed on empty DB)
└── index.ts             // re-exports public API
```

**Contract surface (sketch — full design belongs in `.planning/specs/SKILL-CONTRACT.md`):**

```typescript
// src/skills/contract.ts
export interface SkillManifest {
  skill_id: string;                  // 'movie-v1', 'podcast-v1' — unique registry key
  version: string;                   // semver of the manifest itself
  display_name: string;
  description: string;
  media_types: MediaType[];          // ['video','image','audio','3d'] — what this skill produces

  node_types: NodeTypeDecl[];        // canvas node types this skill contributes
  phase_taxonomy: PhaseDecl[];       // ordered pipeline phases
  asset_categories: AssetCategoryDecl[];  // what kinds of assets this skill owns
  review_criteria: ReviewCriteriaDecl;    // scoring dimensions + auto/human thresholds
  engine_task_types: string[];       // subset of gold-team TaskType enum this skill uses

  // How the platform talks to the live skill orchestrator (Q6)
  runtime: SkillRuntimeDecl;
}

export interface NodeTypeDecl {
  type: string;                      // 'script' | 'asset' | 'storyboard' | 'video' | 'audio' | <custom>
  label: string;                     // "剧本" / "Storyboard" — i18n string
  icon: string;                      // emoji or icon URL
  color: string;                     // hex color for canvas rendering
  data_schema_uri: string;           // JSON Schema URI describing node.data shape
  default_renderer: 'script' | 'asset' | 'storyboard' | 'video' | 'audio' | 'custom';
  custom_renderer_url?: string;      // if default_renderer === 'custom' — URL to a React component bundle
}

export interface PhaseDecl {
  id: string;                        // 'requirement' | 'art-direction' | ... | custom
  order: number;                     // 0,1,2,... — execution order
  label: string;
  requires_review: boolean;          // gates on phase-complete callback
  ingest_outputs: ('images' | 'videos' | 'storyboard' | 'audio' | 'none')[];
  // for PHASE_INGEST_MAP replacement
}

export interface SkillRuntimeDecl {
  type: 'external-http' | 'in-process';   // Q6
  endpoint?: string;                       // for external-http: base URL of skill orchestrator
  healthcheck_path?: string;               // GET path appended to endpoint
  callback_url_template?: string;          // platform's callback URL pattern skill should use
}
```

**Why a single TS file and not a separate package:** the existing pattern in this repo (`BaseEngine` in gold-team, `BackendType` enum) is "single source file in primary repo, contract enforced via API/JSON" — not "shared library." Following that pattern is more important than abstract purity.

---

### Q2. Skill Registry architecture

**Decision: DB table `o_skillRegistry` as source of truth + in-memory cache hydrated at boot. No filesystem scan.**

**Three options considered:**

| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| DB only (no cache) | Simple, always fresh | Per-request SQL for every phase lookup; phase-complete callback is hot path | Reject — perf |
| **DB + in-memory cache (hydrated at boot)** | Fast lookups; persistent across restarts; survives crashes; SELECT-then-cache is the standard pattern in this codebase (cf. `o_agentDeploy` vendor configs already loaded this way) | Stale cache if manifest changes without restart — needs invalidation API | **Accept** |
| Filesystem scan (e.g., `skills/*/manifest.json`) | No DB row needed; "convention over configuration" | Conflicts with Docker deployment (manifest lives outside container); multi-instance coordination requires shared FS; doesn't match existing pattern (vendor config lives in DB, not files) | Reject — wrong fit for this architecture |

**DB schema for `o_skillRegistry` (NEW table):**

```sql
CREATE TABLE o_skillRegistry (
  id           INTEGER PRIMARY KEY,
  skill_id     TEXT NOT NULL UNIQUE,        -- 'movie-v1'
  version      TEXT NOT NULL,               -- semver
  display_name TEXT NOT NULL,
  is_active    INTEGER NOT NULL DEFAULT 1,  -- boolean: can be selected for new projects
  is_default   INTEGER NOT NULL DEFAULT 0,  -- one row should have this = 1 (fallback)
  manifest     TEXT NOT NULL,               -- full SkillManifest JSON (single source)
  registered_at INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX idx_skillRegistry_skill_id ON o_skillRegistry(skill_id);
CREATE INDEX idx_skillRegistry_is_default ON o_skillRegistry(is_default);
```

Why `manifest` as JSON blob (not normalized columns): the manifest is read as a unit on every cache hydration; we never query "find all skills with media_types containing 'video'". A JSON blob matches the access pattern. (Same pattern as `o_agentWorkData.data` and `kv_pipelineRun.config` already in this codebase.)

**Registry lookup methods:**

```typescript
// src/skills/registry.ts
class SkillRegistry {
  private byId: Map<string, SkillManifest> = new Map();
  private defaultId: string;

  hydrate(rows: o_skillRegistry[]) { /* called by loader at boot */ }
  get(skillId: string): SkillManifest { /* throw if missing */ }
  getDefault(): SkillManifest { /* the row with is_default=1 */ }
  list(): SkillManifest[] { /* active skills only */ }
  nodeType(skillId: string, type: string): NodeTypeDecl | undefined { /* convenience */ }
  phaseById(skillId: string, phaseId: string): PhaseDecl | undefined { /* for phase-complete cb */ }
  isReviewRequired(skillId: string, phaseId: string): boolean { /* for callback */ }
  register(manifest: SkillManifest): void { /* validate → upsert DB → update cache */ }
}
```

**Boot sequence (in `src/app.ts` startup, after DB connection but before routes serve):**

```
1. App starts → DB pool ready
2. SkillLoader.load() → SELECT * FROM o_skillRegistry WHERE is_active = 1
3. If 0 rows returned → seed from src/skills/defaultSkill.ts (movie-v1 manifest)
4. registry.hydrate(rows)
5. Routes mount — registry is now queryable synchronously from any route handler
```

**Cache invalidation:** `POST /api/v1/skills/register` calls `registry.register(...)` which updates DB then refreshes the in-memory entry. No restart needed. (TTL refresh not required — manifest changes are explicit admin actions.)

---

### Q3. Node type registry integration with ReactFlow

This is the **most invasive change** because it touches the ReactFlow canvas bundle (`packages/infinite-canvas`), which is built separately and shipped to the Electron app.

**Current state (precise inventory):**

- `packages/infinite-canvas/src/components/FlowCanvas.tsx:30-36` — hardcoded `nodeTypes` map with 5 entries (`script`, `asset`, `storyboard`, `video`, `audio`).
- `packages/infinite-canvas/src/components/nodes/{Script,Asset,Storyboard,Video,Audio}Node.tsx` — 5 hardcoded React components.
- `packages/infinite-canvas/src/types/canvas.ts` — `CanvasNodeType` union type hardcoded to those 5 strings; per-node `*NodeData` interfaces hardcoded.
- `src/routes/canvas/projectData.ts:9-20` — `NODE_TYPES` constant exposed via `/api/canvas/projectData/node-types` (10 entries, slightly different from canvas bundle's 5).

**Target state:**

The `nodeTypes` map on the canvas side becomes **dynamic, built at project-load time** from a fetched manifest. The 5 default node components (`ScriptNode`, `AssetNode`, etc.) remain in the canvas bundle as **built-in renderers**. Skills declare `default_renderer: 'script' | 'asset' | ...` to use them, or `default_renderer: 'custom'` + `custom_renderer_url` for novel node shapes (loaded as async React component / iframe).

**Why not lazy-load custom React components dynamically over HTTP:** dynamic component loading across the Electron boundary is brittle (CSP, bundler output, version skew). The 80% case (movie, podcast, ads) all map cleanly onto the 5 existing renderer shapes (text content, image/video preview, audio waveform, etc.). **Custom renderers are a v1.7+ concern; v1.6 only needs to support the 5 built-in renderers keyed by `default_renderer`.**

**Data flow on canvas load:**

```
1. User opens project (projectId=X)
2. Canvas bundle fetches GET /api/v1/projects/X → includes project.skill_id
3. Canvas fetches GET /api/v1/skills/:skillId/node-types → [{type, label, icon, color, default_renderer, data_schema_uri}, ...]
4. Canvas builds nodeTypes map:
   nodeTypes = {}
   for (decl of fetched) {
     nodeTypes[decl.type] = BUILTIN_RENDERERS[decl.default_renderer] ?? FallbackNode;
   }
5. ReactFlow renders with dynamic nodeTypes; <ReactFlow nodeTypes={nodeTypes} />
6. When loading existing graph, each node.data carries its own type; canvas looks up renderer in nodeTypes
```

**This requires MODIFIED `FlowCanvas.tsx`** (replace static `nodeTypes` const with a `useMemo` over fetched manifest) and **NEW** `src/routes/v1/skills/node-types.ts` route.

**Per-node data schemas:** the canvas does not need to statically know the data shape. `data_schema_uri` is for validation (zod on the save endpoint), not for static typing in the canvas. The TypeScript types in `canvas.ts` become open: `CanvasNodeType = string` and node data becomes `Record<string, unknown> & { label: string, type: string, state: NodeState }` (a minimal base contract).

---

### Q4. Phase taxonomy as data

**Current state — phase names are baked into 4 places:**

| File | Hardcoding | What it does |
|------|-----------|--------------|
| `src/routes/v1/pipeline/callback/phase-complete.ts:9` | `REVIEW_REQUIRED_PHASES = ["storyboard","character","scene","camera-preview","camera-final","quality-gate"]` | Decides whether to set state to "awaiting-review" |
| `src/routes/v1/pipeline/callback/phase-complete.ts:13-25` | `PHASE_INGEST_MAP = {"art-direction": ["images"], ...}` | Routes phase outputs into the correct ingest pipeline |
| `src/routes/v1/pipeline/resume.ts:47-59` | `PHASE_ORDER = {requirement:0, ..., delivery:11}` (12 entries) | Maps phase name back to ordinal for `currentPhaseOrder` |
| `src/routes/v1/pipeline/submit-to-review.ts:34` | `phase: z.enum(["storyboard","character","image","video","audio","compose"])` | Closed enum — rejects unknown phases |

These are **exactly the data that `PhaseDecl[]` in the manifest is designed to externalize.** Each phase entry carries `requires_review` (replaces #1), `ingest_outputs` (replaces #2), `order` (replaces #3). For #4, the closed enum becomes `z.string().min(1)` with a runtime lookup `registry.get(skillId).phases.find(p => p.id === phase)`.

**Where the state machine lives:** the **state machine is split between skill and platform**:

- **Skill (movie-agent) decides** "what runs next" — it's the orchestrator, it polls `kv_pipelineRun.state` and decides which phase to execute. The platform does NOT advance phases autonomously; the comment in `review-result.ts:97-98` already confirms this: *"the orchestrator (OpenClaw agent) will set it when it picks up the next phase."*
- **Platform only knows the protocol**: states are `idle | running | awaiting-review | revision-needed | winner-selected | compare-completed | failed | paused`. Phase transitions (`phase-complete` callback, `review-result` callback) only update the `kv_pipelineRun` row + emit WebSocket events. Phase *progression logic* (which phase comes after storyboard) lives in the skill orchestrator.
- **The manifest's `phase_taxonomy` is descriptive metadata**, not executable state machine. It tells the platform: "for phase X of this skill, is review required?" and "if a phase-X output arrives, where does it go?" The platform uses this to *react* to phase events; it doesn't drive them.

This split is **already the de facto architecture** — the v1.6 refactor just makes the platform side data-driven instead of hardcoded.

---

### Q5. Asset schema migration

**Migration plan for `o_assets`:**

```sql
-- Step 1: Add columns (additive — backwards compatible)
ALTER TABLE o_assets ADD COLUMN skill_id TEXT;
ALTER TABLE o_assets ADD COLUMN workflow_phase TEXT;

-- Step 2: Backfill existing rows. Per v1.6 decision #3, breaking changes are allowed
-- and movie-agent is the implicit default. The default skill is movie-v1.
UPDATE o_assets SET skill_id = 'movie-v1' WHERE skill_id IS NULL;

-- Step 3: Add NOT NULL constraint (separate statement; some SQLite/PG versions require this dance)
-- For SQLite (used in dev/test sync): skip NOT NULL — SQLite ALTER TABLE is limited.
-- For PostgreSQL (primary DB): apply NOT NULL after backfill.
ALTER TABLE o_assets ALTER COLUMN skill_id SET NOT NULL;
-- workflow_phase stays nullable (legacy rows have no phase info; new rows get it from ingest)

-- Step 4: Index for skill-scoped queries (e.g., "all assets for movie-v1 in storyboard phase")
CREATE INDEX idx_assets_skill_phase ON o_assets(skill_id, workflow_phase);
```

**Where `skill_id` is written:** every code path that inserts into `o_assets` must now pass `skill_id`. The relevant call sites are:
- `src/routes/v1/pipeline/callback/phase-complete.ts:135` — `ingestImages()` inserts assets; needs to read skill_id from the pipeline run (kv_pipelineRun should also gain a `skill_id` column, see below).
- `src/routes/assets/addAssets.ts` — direct asset creation endpoint; should accept `skillId` in body (default to project's `skill_id`).
- `src/routes/v1/assets/from_node.ts` — canvas → asset binding.

**Related change — `kv_pipelineRun` also needs a `skill_id` column** to scope the run. Currently `kv_pipelineRun.config` (JSON blob) carries whatever the skill passed in; we should extract `skill_id` as a top-level column for fast indexing.

```sql
ALTER TABLE kv_pipelineRun ADD COLUMN skill_id TEXT;
UPDATE kv_pipelineRun SET skill_id = 'movie-v1' WHERE skill_id IS NULL;
```

**`o_project.projectType` already exists** (`src/routes/project/addProject.ts:12`) — it's a free string. v1.6 should formalize this as the project's bound skill_id: on project creation, default it to `'movie-v1'` (the registry's default row). No new column needed on `o_project`; just a semantic repurposing of `projectType`.

---

### Q6. Skill-host communication

**Decision: hybrid abstraction, defaulting to `external-http` for v1.6.**

The contract's `SkillRuntimeDecl` supports both `in-process` (Node import) and `external-http`. Today movie-agent runs in OpenClaw (external), so `external-http` is the practical baseline. The platform doesn't need to import skill code; it only needs to:

1. Validate that a skill is alive (healthcheck): optional, used for UI badge.
2. Receive callbacks from skills: this is already the architecture — `POST /api/v1/pipeline/callback/*`.
3. Send review results to skills: WebSocket broadcast + skill polls `/api/v1/pipeline/status`.

**The contract abstracts this by being symmetric**: from the platform's perspective, the skill is a black box that POSTs to `/api/v1/pipeline/callback/phase-complete` with `{pipelineId, phase, status, outputs}`. Whether the skill is OpenClaw or an in-process Node module doesn't change the platform's behavior. The manifest's `runtime` field is **informational** (so UI can show "skill endpoint: http://kais-movie-agent:8001"); the platform doesn't dispatch to it.

**Implication:** no new HTTP client code, no new container, no inter-process protocol. The skill contract is **a data contract** (the manifest) layered on top of the existing callback protocol. This is the smallest possible change that achieves decoupling.

---

### Q7. Build/deployment implications

**No new container.** No docker-compose changes. v1.6 is purely in-repo code changes:

- New files under `src/skills/` — compiled into the existing `kais-core-backend` container.
- New routes under `src/routes/v1/skills/` — auto-registered by `src/core.ts` glob (already covered by the existing SKIP_PATTERNS exclusion logic, since these are valid route files).
- New DB migration — applied at deploy time (the project uses an existing migration mechanism; check `src/utils/db.ts` for the actual approach — likely a migrations runner or manual SQL).
- Canvas bundle (`packages/infinite-canvas`) gets a new bundled version — Electron app pulls the latest on next build.

**The only operational change:** the boot sequence now includes `SkillLoader.load()` between DB-ready and routes-serving. If `o_skillRegistry` is empty on first boot (fresh deploy), `defaultSkill.ts` auto-seeds the movie-v1 manifest — zero-config migration.

---

### Q8. Suggested build order (dependency-respecting)

This is the critical output for the roadmapper. Phases are numbered from 28 (v1.5 ended at 27).

#### Phase 28: Skill Contract spec + TS interface + JSON Schema
- **Output:** `.planning/specs/SKILL-CONTRACT.md` + `src/skills/contract.ts` + `src/skills/contract.schema.json`
- **Dependencies:** none (pure design + types)
- **Why first:** every other phase imports from `contract.ts`. The spec doc is the source of truth that kais-movie-agent's manifest authoring (Phase 32) depends on.

#### Phase 29: DB migration + Registry skeleton
- **Output:** SQL migration for `o_skillRegistry` + `o_assets.skill_id` + `o_assets.workflow_phase` + `kv_pipelineRun.skill_id` backfill. Plus `src/skills/{registry,loader,validator}.ts` (skeleton — methods stubbed, no callers yet).
- **Dependencies:** Phase 28 (contract types)
- **Why second:** the migration is the only "blocking" infrastructure change. Once `o_assets` has `skill_id`, downstream code can start writing it.

#### Phase 30: Default skill seed + Skill Registry REST API
- **Output:** `src/skills/defaultSkill.ts` (movie-v1 manifest as data, derived from current `REVIEW_REQUIRED_PHASES` + `PHASE_INGEST_MAP` + `PHASE_ORDER` constants). `src/routes/v1/skills/{list,get,register,node-types,phases}.ts`. Boot hook to auto-seed if DB empty.
- **Dependencies:** Phase 29 (registry class exists)
- **Why third:** makes the registry observable and testable end-to-end before touching any existing route.

#### Phase 31: Pipeline callback refactor — replace hardcoded phase constants
- **Output:** Modified `src/routes/v1/pipeline/callback/phase-complete.ts` (REVIEW_REQUIRED_PHASES + PHASE_INGEST_MAP → registry lookups by `pipeline.skill_id`). Modified `src/routes/v1/pipeline/resume.ts` (PHASE_ORDER → registry lookup). Modified `src/routes/v1/pipeline/submit-to-review.ts` (closed enum → string + validate). All `o_assets` inserts now write `skill_id`.
- **Dependencies:** Phase 30 (registry populated)
- **Why fourth:** this is where the platform actually becomes skill-agnostic. Order matters — must come after the registry is live so lookups succeed.

#### Phase 32: Canvas integration — dynamic node types
- **Output:** Modified `packages/infinite-canvas/src/components/FlowCanvas.tsx` (dynamic `nodeTypes`). Modified `packages/infinite-canvas/src/types/canvas.ts` (open type). Modified `src/routes/canvas/projectData.ts` (NODE_TYPES → registry lookup).
- **Dependencies:** Phase 30 (node-types endpoint exists), Phase 31 (projects carry skill_id)
- **Why fifth:** can be done in parallel with 31 if the canvas team is independent, but ships after to validate against real refactored pipeline state.

#### Phase 33: kais-movie-agent manifest authoring + compliance test
- **Output:** In the kais-movie-agent repo (external): author `skill.manifest.json` matching the contract. In this repo: integration test that POSTs the manifest to `/api/v1/skills/register`, then runs an end-to-end pipeline and verifies the callback path uses registry data.
- **Dependencies:** Phase 31 + Phase 32 (platform must be manifest-driven first)
- **Why sixth:** validates the whole stack. This is the milestone's acceptance test.

#### Phase 34: Skill author documentation
- **Output:** `docs/skill-author-guide.md` — how to write a manifest, how to register, what the runtime protocol is, examples.
- **Dependencies:** Phase 33 (validated contract)
- **Why last:** documents the finalized, tested contract — not a moving target.

**Dependency graph:**

```
28 (contract)
    ↓
29 (migration + registry skeleton)
    ↓
30 (default skill + REST API)
    ↓
31 (pipeline refactor) ──┐
                          ↓
32 (canvas integration) ─┤
                          ↓
33 (movie-agent compliance test)
                          ↓
34 (docs)
```

Phases 28→29→30 are strictly serial. 31 and 32 can partially overlap. 33 needs both done. 34 is independent writing but logically last.

---

### Q9. Existing patterns to extend

**Yes — mirror BaseEngine + BackendType.** This is not just stylistic; it's the right move for codebase consistency.

| Pattern (existing) | Skill Contract Analog (new) |
|---|---|
| `docker/gold-team/src/v6/engines/base.py` — `BaseEngine` abstract class | `src/skills/contract.ts` — `SkillManifest` interface |
| `BackendType` enum (COMFYUI/SUBPROCESS/CLOUD/DOCKER/MOCK) | `SkillRuntimeDecl.type` ('external-http' \| 'in-process') |
| `engine_registry.py` — register concrete engine subclasses | `src/skills/registry.ts` — register manifests |
| Each engine self-registers in `main.py` | Each skill self-registers via `POST /api/v1/skills/register` |
| Engine lookup by `TaskType` | Skill lookup by `skill_id` (from `o_project.projectType`) |
| Engine interface methods: `submit/poll/cancel/health` | Skill callback protocol: `phase-complete/review-result` (already exists) |

The skill contract layer is **architecturally a sibling of the engine layer** — both are plugin patterns, one for execution backends, one for workflow shapes. Following the same structural pattern (abstract contract → concrete instances registered in a registry → looked up by key at runtime) makes the codebase coherent.

---

## Patterns to Follow

### Pattern 1: Manifest as JSON blob in DB (not normalized columns)
**What:** store the full SkillManifest in a single `manifest TEXT` column.
**When:** when read pattern is "load all rows, hydrate cache, never query inner fields."
**Why:** matches existing `o_agentWorkData.data` and `kv_pipelineRun.config` patterns. Avoids schema migrations when the manifest shape evolves — just bump `version`.

### Pattern 2: Default seed on empty DB
**What:** on boot, if `SELECT COUNT(*) FROM o_skillRegistry` is 0, insert the movie-v1 row from `defaultSkill.ts`.
**When:** first deploy after migration.
**Why:** zero-config upgrade. Operators don't need to manually register a skill to boot.

### Pattern 3: Registry lookup replaces constants (not wraps them)
**What:** delete `REVIEW_REQUIRED_PHASES`, `PHASE_INGEST_MAP`, `PHASE_ORDER`, `NODE_TYPES` constants entirely. Replace call sites with `registry.phaseById(skillId, phase).requires_review` etc.
**When:** Phase 31.
**Why:** wrapping (constant defaults if registry returns nothing) reintroduces the coupling. The registry is the source of truth; if it's missing data, that's a bug to fix, not paper over.

**Anti-pattern to avoid:** `needsReview = REVIEW_REQUIRED_PHASES.includes(phase) || registry.phaseById(...).requires_review` — this is the "training wheels" version that keeps the hardcoded array alive. Per v1.6 decision #3 (breaking changes allowed), delete the constant.

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: "Pluggable" registry that secretly assumes movie-v1 shape
**What:** writing the registry interface as generic but hardcoding movie-v1's 5 node types or 8 phases somewhere in the platform.
**Why bad:** defeats the point of v1.6. When podcast-v1 registers with 3 node types, the platform must not crash.
**Instead:** every code path that touches node types or phases must go through `registry.lookup(...)` and handle missing entries with explicit error, not silent fallback.

### Anti-Pattern 2: Putting the skill_id on `o_assets` only (forgetting `kv_pipelineRun`)
**What:** adding `skill_id` to `o_assets` but not to `kv_pipelineRun`.
**Why bad:** phase-complete callback receives `{pipelineId, phase, ...}` — to look up the skill, it would have to join through `o_project`, adding latency. The pipeline run row is the natural place.
**Instead:** add `skill_id` to both `o_assets` and `kv_pipelineRun` (Phase 29).

### Anti-Pattern 3: Treating `o_skillList` (legacy prompt library table) as the skill registry
**What:** reusing `o_skillList` because "it's already there."
**Why bad:** its schema (`path`, `md5`, `embedding`, `type`) is for markdown prompt files. Workflow manifests have node_types, phases, asset_categories — completely different shape.
**Instead:** new table `o_skillRegistry`; leave `o_skillList` for the prompt-library feature.

### Anti-Pattern 4: Custom React component dynamic loading over HTTP in v1.6
**What:** shipping the canvas integration with a `custom_renderer_url` mechanism for skills to provide their own React components.
**Why bad:** cross-bundle dynamic React component loading is brittle (version skew, CSP, bundler chunk boundaries). The 80% need (movie / podcast / ads) is covered by the 5 built-in renderers.
**Instead:** v1.6 supports only `default_renderer ∈ {'script','asset','storyboard','video','audio'}` + a `FallbackNode` for unknown. Custom renderers are explicitly deferred to v1.7+ with a separate design.

---

## Data Flow Diagrams

### Skill registration flow

```
[Skill author] writes skill.manifest.json
        ↓
[Skill orchestrator, e.g., kais-movie-agent]
   POST /api/v1/skills/register { manifest: {...} }
        ↓
[Platform: src/routes/v1/skills/register.ts]
   1. validator.validateManifest(manifest) → zod parse
   2. registry.register(manifest)
      a. UPSERT o_skillRegistry WHERE skill_id = manifest.skill_id
      b. Update in-memory cache
   3. Return { skill_id, version, registered_at }
```

### Project creation with skill binding

```
[User] creates project in UI
        ↓
POST /api/project/addProject { name, projectType: 'movie-v1', ... }
        ↓
[Platform: src/routes/project/addProject.ts]
   - projectType stored on o_project.projectType (acts as skill_id binding)
        ↓
Future: all phase callbacks for this project look up registry.get(project.projectType)
```

### Phase completion (refactored)

```
[Skill orchestrator] completes 'storyboard' phase
        ↓
POST /api/v1/pipeline/callback/phase-complete
   { pipelineId: 'pipe_001', phase: 'storyboard', status: 'completed', outputs: [...] }
        ↓
[Platform: src/routes/v1/pipeline/callback/phase-complete.ts] (MODIFIED)
   1. pipeline = SELECT kv_pipelineRun WHERE id = pipelineId
   2. skill = registry.get(pipeline.skill_id)        ← was implicit
   3. phaseDecl = skill.phaseById('storyboard')       ← was REVIEW_REQUIRED_PHASES.includes
   4. needsReview = phaseDecl.requires_review
   5. ingestTargets = phaseDecl.ingest_outputs         ← was PHASE_INGEST_MAP
   6. UPDATE kv_pipelineRun SET state = needsReview ? 'awaiting-review' : 'running'
   7. for output in outputs: route to ingest[ingestTargets]
      - each inserted o_assets row gets skill_id = pipeline.skill_id  ← was implicit
```

---

## Scalability Considerations

| Concern | Today (1 skill, 1 user) | At 5 skills, 100 projects | At 50 skills, 10K projects |
|---------|-------------------------|----------------------------|----------------------------|
| Registry cache lookup | N/A (constants) | O(1) Map lookup — same as today | O(1) — no regression |
| DB write per asset (extra skill_id column) | N/A | +1 column write, negligible | +1 column write, negligible; indexed for skill-scoped queries |
| Boot load time | N/A | +1 SELECT FROM o_skillRegistry (~5 rows) — <1ms | Still <10ms even at 50 rows |
| Canvas bundle size | 5 hardcoded renderers | Same (built-ins stay; custom renderer URLs are v1.7+) | Same unless custom renderer feature ships |
| Per-pipeline-callback latency | constant lookup | +1 Map.get — negligible | No regression |

---

## Phase-Specific Warnings (for PITFALLS.md cross-reference)

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| 28 (contract) | Over-engineering the manifest with fields nobody uses yet | Only include fields the platform actually reads today: `skill_id`, `node_types[].{type,label,icon,color,default_renderer}`, `phase_taxonomy[].{id,order,label,requires_review,ingest_outputs}`, `runtime.type`. Everything else is reserved for v1.7. |
| 29 (migration) | Backfilling `o_assets.skill_id` for assets that belong to deleted projects | Use `WHERE skill_id IS NULL` (not `WHERE projectId IN (...)`) — let all rows backfill to `movie-v1`. Deletion edge cases are not our problem. |
| 31 (pipeline refactor) | Breaking the existing kais-movie-agent pipeline because the manifest doesn't exactly match the old constants | The movie-v1 manifest MUST be authored by reading the existing constants line-by-line and translating them. Treat `REVIEW_REQUIRED_PHASES` as the source of truth for the manifest's `requires_review` flags. |
| 32 (canvas) | Custom Electron caching ships stale canvas bundle that doesn't know about new node types | Bump canvas bundle version + add a `?skill_id=` query param to the canvas HTML so different skills can coexist during transition. |
| 33 (compliance test) | Test only the happy path; miss edge cases where skill manifest declares a phase the platform's callback code doesn't handle | Add a negative test: skill registers with phase `'unknown-phase'` and the platform must not crash — it should treat unknown phases as `requires_review = false, ingest_outputs = []`. |

---

## Sources

- `src/router.ts` (auto-gen, 236 routes) — confirmed route inventory and auto-gen pattern
- `src/core.ts` — confirmed SKIP_PATTERNS regex (new skill routes will auto-register correctly)
- `src/types/database.d.ts` — confirmed existing `o_skillList`, `o_skillAttribution`, `o_assets`, `kv_pipelineRun` schemas
- `src/routes/canvas/{load,save,projectData}.ts` — confirmed canvas persistence model (JSON blob in `o_agentWorkData`) and hardcoded `NODE_TYPES` constant
- `src/routes/v1/pipeline/callback/{phase-complete,review-result,phase-progress}.ts` — confirmed phase-name hardcoding (`REVIEW_REQUIRED_PHASES`, `PHASE_INGEST_MAP`)
- `src/routes/v1/pipeline/resume.ts` — confirmed `PHASE_ORDER` hardcoded map
- `src/routes/v1/pipeline/submit-to-review.ts` — confirmed closed `phase` enum
- `packages/infinite-canvas/src/components/FlowCanvas.tsx` — confirmed hardcoded 5-node `nodeTypes` map
- `packages/infinite-canvas/src/types/canvas.ts` — confirmed `CanvasNodeType` union + per-node data interfaces
- `docker/gold-team/src/v6/models/task.py` — confirmed `BackendType` / `TaskType` enum pattern (precedent for contract.ts)
- `docs/architecture.md` (V6.1) — confirmed system topology, callback protocol, deployment constraints
- `docs/kais-movie-agent.md` — confirmed external OpenClaw skill model, three-layer sub-skill architecture
- `.planning/PROJECT.md` — confirmed v1.6 architecture decisions (#1-7), especially #2 (platform is source of truth for contract), #3 (breaking changes allowed), #4 (must be highly generic)
- `.planning/ROADMAP.md` — confirmed Phase 27 was last v1.5 phase; v1.6 starts at Phase 28
