# Phase 28: Skill Contract Spec + TS Interface - Context

**Gathered:** 2026-06-15
**Status:** Ready for planning
**Mode:** Smart Discuss (autonomous)

<domain>
## Phase Boundary

This phase delivers the **single source of truth** for the workflow Skill Manifest contract — a TypeScript interface, a zod validator, and a human-readable spec doc. It is purely descriptive: types, validation rules, and documentation. No runtime registry, no DB writes, no REST endpoints, no behavior. Downstream phases (29+) import from `src/skills/contract.ts` and `src/skills/validator.ts`.

**Out of scope (handled by later phases):**
- `o_skillRegistry` DB table — Phase 29
- `registry.ts` / `loader.ts` runtime layer — Phase 29
- `defaultSkill.ts` movie-v1 manifest literal — Phase 30
- REST endpoints (`/api/v1/skills/...`) — Phase 30
- Pipeline callback refactor — Phase 31
- Canvas integration — Phase 32

**Files produced this phase:**
- `src/skills/contract.ts` — `SkillManifest` interface + exported sub-types + `ManifestValidationError` type
- `src/skills/validator.ts` — zod schema + `validateManifest()` function
- `.planning/specs/SKILL-CONTRACT.md` — human-readable contract spec
- `src/skills/__tests__/contract.test.ts` — field-equality drift test + negative-input validator tests

</domain>

<decisions>
## Implementation Decisions

### Spec Drift Prevention
- Hand-write the spec doc at `.planning/specs/SKILL-CONTRACT.md`; do NOT auto-generate from zod (preserves explanatory prose).
- A field-equality test (`src/skills/__tests__/contract.test.ts`) walks the zod `.shape` and asserts every field appears in the spec's field table, and vice versa. Equality = field names + required-flags + types.
- Test failure message format: `"Field '<name>' present in zod but missing in spec"` (or reverse), per-field diagnostic.

### Validator Error Structure
- `validateManifest()` returns `{ ok: true, value: SkillManifest } | { ok: false, errors: ManifestValidationError[] }`.
- `ManifestValidationError = { ruleId: string; field: string; message: string; raw: zodError }` — exported from `contract.ts`.
- Rule IDs use SCREAMING_SNAKE_CASE and align with the requirement codes that motivated them:
  - `MANIFEST_REQUIRED_FIELD` — missing required field
  - `MANIFEST_TYPE_MISMATCH` — wrong type
  - `MANIFEST_VERSION_FORMAT` — version not `major.minor`
  - `NODE_ID_NAMESPACING` — bare node type ID like `script` instead of `movie-v1::script`
  - `MANIFEST_UNKNOWN_FIELD` — strict mode rejects unknown keys
- Custom zod `.refine()` rules handle invariants (namespacing, version format, "no executable code" structural guard). Built-ins handle type checks.

### Versioning Semantics
- Version string format: `major.minor` (e.g., `1.0`, `1.1`, `2.0`). No patch segment.
- Platform runtime accepts any `1.x` manifest (major must match the platform's major).
- **Minor bump = strictly additive**: only OPTIONAL fields with safe defaults may be added. No new required fields, no field removals, no enum narrowing.
- **Major bump**: required-field additions, removals, type changes, enum narrowing — anything breaking.
- zod schema uses `z.strict()` on the root object — unknown fields rejected (forces explicit declaration, catches typos).

### Naming Convention & File Layout
- All manifest fields use **snake_case** in both TS and JSON (`skill_id`, `node_types`, `phase_taxonomy`, `requires_review`, `ingest_outputs`) — matches Python skill-author conventions and the JSON format kais-movie-agent/OpenClaw will read directly.
- JSON Schema (`src/skills/contract.schema.json`) is **generated from zod at build time** via `zod-to-json-schema` (no hand-written schema).
- Spec doc lives at `.planning/specs/SKILL-CONTRACT.md` (per CONTRACT-03). `docs/skill-author-guide.md` is owned by Phase 34, not this phase.
- **This phase only creates two source files**: `contract.ts` and `validator.ts` (plus tests). `registry.ts` / `loader.ts` / `defaultSkill.ts` / `index.ts` are NOT created this phase — premature scaffolding.

### Claude's Discretion
- Sub-field shape details for `NodeTypeDecl`, `PhaseDecl`, `SkillRuntimeDecl`, etc. — follow the architecture doc's sketch (research/ARCHITECTURE.md lines 142-185) unless a hard requirement contradicts.
- Test framework: follow repo convention (likely vitest or jest — verify in plan-phase).
- Exact prose structure of SKILL-CONTRACT.md sections — Claude's discretion as long as all required/optional fields are enumerated and the four contract invariants are explicitly stated.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- Project already uses **zod v4** (`package.json` shows `"zod": "^4.3.5"`) — no new validation library.
- Express + zod middleware pattern (`validateFields`) is established in `src/middleware/middleware.ts` — Phase 30 will reuse, not this phase.
- `src/lib/initDB.ts` uses Knex migrations via `TableSchema` config pattern — informs Phase 29 schema additions (this phase doesn't touch DB).

### Established Patterns
- **Constants live in route files** (`src/routes/v1/pipeline/callback/phase-complete.ts:9,13`): `REVIEW_REQUIRED_PHASES`, `PHASE_INGEST_MAP`. `src/routes/v1/pipeline/resume.ts:47` has inline `PHASE_ORDER`. Phase 28 will define the contract these constants will be replaced by (Phase 31 does the replacement).
- TypeScript-first validation: `zod` is imported throughout the codebase (e.g., `import { z } from "zod"` in `phase-complete.ts`).
- **Single-source-of-truth convention**: `BackendType` enum lives in `docker/gold-team/src/v6/models/task.py`, consumed via API contract — analogous to where `SkillManifest` lives (`src/skills/contract.ts`).

### Integration Points
- `src/skills/` is a NEW directory (does not exist yet) — this phase creates it.
- `.planning/specs/` is a NEW directory — this phase creates it.
- Downstream phases (29-32) import from `src/skills/contract.ts` (types) and `src/skills/validator.ts` (`validateManifest()`). No existing files import from these yet — clean greenfield.

</code_context>

<specifics>
## Specific Ideas

- The validator's `ruleId` field MUST be exported as a stable type — Phase 33's negative tests assert on specific ruleIds (e.g., `expect(error.ruleId).toBe('NODE_ID_NAMESPACING')`).
- The four "contract invariants" must be explicitly stated in SKILL-CONTRACT.md (not just enforced by the validator):
  1. Manifest is descriptive only — no executable code
  2. Version is `major.minor` (additive minor)
  3. Platform accepts any `1.x` manifest at runtime
  4. Node type IDs are `<skill_id>::<type>` — no bare IDs
- Strict mode (`z.strict()`) is intentional — we want manifest authors to declare every field. This catches typos and undocumented experimental fields.
- The contract's TypeScript interface should NOT use runtime behavior (no methods, no functions) — it's purely a data shape declaration.

</specifics>

<deferred>
## Deferred Ideas

- A standalone JSON Schema file at `src/skills/contract.schema.json` — will be auto-generated at build time during plan-phase (not a design decision, an implementation detail).
- `index.ts` barrel export for `src/skills/` — premature until Phase 29/30 adds more files. The test file can import directly from `contract.ts` / `validator.ts`.
- Spec doc translation to English — current repo mixes Chinese (PROJECT.md) and English (code comments). Spec doc will be English-first for skill-author portability (kais-movie-agent + future OpenClaw skills). Phase 34 docs may have bilingual variants.

</deferred>
