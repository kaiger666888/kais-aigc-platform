# Phase 30: Default Skill Seed + REST API - Context

**Gathered:** 2026-06-15
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous mode)

<domain>
## Phase Boundary

Phase 30 makes the skill registry *operable end-to-end*:

1. **Default skill seed** — on empty-DB boot, the platform self-seeds `movie-v1` into `o_skillRegistry` and registers it in-memory. Zero-config upgrade (no operator action required).
2. **REST API surface** — 5 endpoints under `/api/v1/skills...` that any client (OpenClaw, curl, future skill author) can use to list, inspect, register, and pull node-type/phase declarations.

Out of scope:
- **Phase 31** owns replacing the hardcoded constants (`REVIEW_REQUIRED_PHASES`, `PHASE_INGEST_MAP`, `PHASE_ORDER`) with `registry.phaseById` / `registry.nodeTypeById` calls.
- **Phase 33** owns the kais-movie-agent compliance work (writing the install-ready `movie-v1.manifest.json` artifact that matches what Phase 30 derives).
- **Phase 34** owns skill-author documentation.
- Auth/middleware — v1.6 assumes trusted internal network (matches existing /api/v1/* routes).

The success criteria require: empty-DB boot → `GET /api/v1/skills` returns one entry (`movie-v1`); POST register with valid manifest succeeds + updates cache without restart; POST register with malformed manifest returns structured 4xx + does not mutate; GET node-types/phases return declared arrays; manifest is *derived* from existing constants (translation, not invention).

</domain>

<decisions>
## Implementation Decisions

### Manifest Derivation Strategy
- **Hardcode the manifest as a TS constant in `src/skills/defaultSkill.ts`** that TRANSLATES the existing constants:
  - `PHASE_ORDER` (resume.ts) → `phase_taxonomy[].order`
  - `REVIEW_REQUIRED_PHASES` (phase-complete.ts) → `phase_taxonomy[].requires_review`
  - `PHASE_INGEST_MAP` (phase-complete.ts) → `phase_taxonomy[].ingest_outputs`
- Single source of truth. The manifest constant references the existing constants at module-load time so any future change to PHASE_ORDER/REVIEW_REQUIRED_PHASES/PHASE_INGEST_MAP flows into the derived manifest automatically (until Phase 31 deletes those constants — at that point the manifest becomes the new source of truth).
- Per ROADMAP SC #5: "translation, not invention."
- **Descriptive fields** (label/icon/color/data_schema_uri/default_renderer) hardcoded with minimal sensible values in defaultSkill.ts — refined in v1.7+.
- **Runtime block** hardcoded as `{ type: 'external-http', endpoint: 'http://localhost:8001', healthcheck_path: '/health' }` — matches existing kais-movie-agent deployment.
- **Rejected:** runtime derivation by reading constants at seed-time (couples seed to those files' export shape, harder to test); env-var runtime config (premature for single skill).

### REST Route File Structure
- **5 separate route files** matching the existing v1 pattern (each existing route is one file with one handler):
  - `src/routes/v1/skills/list.ts` — `GET /api/v1/skills`
  - `src/routes/v1/skills/get.ts` — `GET /api/v1/skills/:skillId`
  - `src/routes/v1/skills/register.ts` — `POST /api/v1/skills/register`
  - `src/routes/v1/skills/node-types.ts` — `GET /api/v1/skills/:skillId/node-types`
  - `src/routes/v1/skills/phases.ts` — `GET /api/v1/skills/:skillId/phases`
- 5 new `app.use(...)` lines in `src/router.ts` (route206 through route210, continuing the existing numbering).
- Routes match ROADMAP SC #2/#4 verbatim.
- **Rejected:** single `index.ts` with all 5 handlers (breaks existing one-file-per-route convention).

### Default Seed Trigger
- **`src/skills/defaultSkill.ts` exports `seedDefaultIfEmpty(knex): Promise<boolean>`**:
  1. `SELECT COUNT(*) FROM o_skillRegistry` — if > 0, return false (no-op, idempotent).
  2. If 0: build the movie-v1 manifest constant, validate via `validateManifest()` from Phase 28.
  3. INSERT row into `o_skillRegistry` (skill_id='movie-v1', manifest_json=JSON.stringify(manifest), version, active=1, registered_at=Date.now()).
  4. Call `registry.register(manifest)` to update the in-memory cache.
  5. Return true.
- **Called from `src/utils/db.ts` IIFE AFTER `await loadAllFromDB(db)`** — order is: initDB → fixDB → loadAllFromDB → seedDefaultIfEmpty → routes start.
- **Idempotency:** count check makes re-runs on populated DBs a no-op.
- **Validation failure handling:** throw — boot fails with clear error. The manifest is hardcoded; validation failure means a code bug, not a data bug.
- **Rejected:** inline in loadAllFromDB (couples seeding to loader; violates separation).

### API Contract Details
- **`GET /api/v1/skills`** → `200 { ok: true, skills: [{ skill_id, version, display_name, description }] }` (summary objects — manifests can be large, list shouldn't ship full JSON).
- **`GET /api/v1/skills/:skillId`** → `200 { ok: true, skill: <full SkillManifest> }` OR `404 { ok: false, error: "skill '<skillId>' not found" }`.
- **`POST /api/v1/skills/register`** success → `201 { ok: true, skill: { skill_id, version, display_name } }` (echoes registry view, not full manifest — caller just sent it).
- **`POST /api/v1/skills/register`** failure → `400 { ok: false, errors: [<ManifestValidationError>] }` — echoes Phase 28's result shape verbatim (ruleId + field + message + raw). Critical for Phase 33 negative tests which assert on ruleId.
- **`GET /api/v1/skills/:skillId/node-types`** → `200 { ok: true, node_types: <NodeTypeDecl[]> }` OR `404`.
- **`GET /api/v1/skills/:skillId/phases`** → `200 { ok: true, phases: <PhaseDecl[]> }` OR `404`.
- **Unknown skillId:** 404 with `{ ok: false, error: "skill '<skillId>' not found" }` — NO fallback to movie-v1 (consistent with registry semantics from Phase 29).
- **Auth:** none in v1.6 — internal API for OpenClaw + skill authors. Matches existing /api/v1/* routes which have no auth middleware.

### Claude's Discretion
- Exact `display_name`/`description` copy for movie-v1 (suggested: "Movie v1" / "Reference workflow skill for movie/short-video production — script→assets→storyboard→video").
- Exact icon/color values for node types (suggested: use semantic names like "page", "film", "image" for icons and a neutral palette for colors — refined later).
- Whether to add a `register` event log (deferred — not in scope).
- Whether to expose `DELETE /api/v1/skills/:skillId` (the registry has `delete()` from Phase 29 WR-05 fix, but no REST endpoint in v1.6 — defer to a future admin-API phase).

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`src/skills/registry.ts`** (Phase 29) — `registry.list()`, `registry.get(skillId)`, `registry.register(manifest)`, `registry.phaseById(skillId, phaseId)`, `registry.nodeTypeById(skillId, typeId)`, `registry.delete(skillId)`. REST handlers call these directly.
- **`src/skills/loader.ts`** (Phase 29) — `loadAllFromDB(knex)`. Called from boot.
- **`src/skills/contract.ts`** (Phase 28) — `SkillManifest`, `PhaseDecl`, `NodeTypeDecl`, `ManifestValidationError`, `ManifestValidationRuleId`.
- **`src/skills/validator.ts`** (Phase 28) — `validateManifest(input): ManifestValidationResult`.
- **`src/lib/responseFormat.ts`** — `success(data)` / `error(msg)` helpers (existing v1 pattern).
- **`src/middleware/middleware.ts`** — `validateFields(zodSchema)` for body validation (used by phase-complete.ts).
- **`src/utils/db.ts`** — Knex singleton + boot IIFE.
- **Existing route files** (`src/routes/v1/pipeline/callback/phase-complete.ts`, `src/routes/v1/pipeline/resume.ts`) — pattern to replicate for the 5 new endpoints.

### Source Constants for Manifest Derivation
- **`src/routes/v1/pipeline/callback/phase-complete.ts` line 9** — `REVIEW_REQUIRED_PHASES = ["storyboard", "character", "scene", "camera-preview", "camera-final", "quality-gate"]`
- **`src/routes/v1/pipeline/callback/phase-complete.ts` line 13** — `PHASE_INGEST_MAP: Record<string, string[]>` (10 phases mapped to ingest output arrays)
- **`src/routes/v1/pipeline/resume.ts` line 47** — `PHASE_ORDER: Record<string, number>` (inline in resume handler)
- All three must be imported into `src/skills/defaultSkill.ts` and translated into the movie-v1 manifest's `phase_taxonomy[]`.

### Established Patterns
- **Route file shape:** `import express from "express"; const router = express.Router(); export default router.<method>("/", ...handlers, async (req, res) => { ... });`
- **Route registration:** `app.use("/api/v1/<path>", route<N>);` in `src/router.ts` (continuing the route<N> numbering — Phase 30 adds route206-210).
- **Response format:** `res.status(N).send(success(data))` for success, `res.status(N).send(error(msg))` for simple errors, raw object send for structured errors (Phase 30 will need to send the errors array directly).
- **Body validation:** `validateFields(zodSchema)` middleware — but for register, we want to run our own `validateManifest()` and return its errors verbatim, so the route will skip validateFields and call validateManifest directly.
- **DB access:** `import u from "@/utils"; const rows = await u.db("table").where(...).select(...)` OR `import db from "@/utils/db"; const rows = await db("table")...`. Both work; routes use `u.db`.

### Integration Points
- **`src/router.ts`** — append 5 new `app.use(...)` lines + 5 new `import route<N> from "./routes/v1/skills/..."` lines.
- **`src/utils/db.ts`** — insert `await seedDefaultIfEmpty(db)` after `await loadAllFromDB(db)` in the boot IIFE.
- **Phase 31 consumer** — calls `registry.phaseById('movie-v1', phaseId)` + `registry.nodeTypeById('movie-v1', typeId)` instead of reading the constants directly. The seed ensures movie-v1 is in the registry at boot.
- **Phase 33 consumer** — installs the matching `docs/skill-author-guide/movie-v1.manifest.json` artifact that reproduces what Phase 30 derives.

</code_context>

<specifics>
## Specific Ideas

- The default seed MUST be invoked even when the registry loader returned 0 rows from `o_skillRegistry` (the empty-DB case). After seedDefaultIfEmpty succeeds, `registry.list()` returns `[movie-v1 manifest]`. This is what makes GET /api/v1/skills return one entry on a fresh boot (SC #1).
- The register endpoint MUST update the in-memory cache without restart. Flow: validate → INSERT row → `registry.register(manifest)` → return 201. If INSERT succeeds but register throws (e.g., race condition with boot), the row is in DB but not in cache — the next boot's loadAllFromDB picks it up. Acceptable for v1.6 (no concurrent register calls expected).
- Phase 33 negative tests will POST malformed manifests and assert on `errors[0].ruleId`. The response shape must be `{ ok: false, errors: [...] }` verbatim — not wrapped, not flattened.
- The descriptive fields (label/icon/color/data_schema_uri) in the derived movie-v1 manifest don't need to match any existing config — they're declarative and refined later. Use sensible defaults: icon names from common icon libraries, neutral hex colors, placeholder data_schema_uri (""). What matters is that the fields exist with valid types per the contract.

</specifics>

<deferred>
## Deferred Ideas

- **Auth middleware on /api/v1/skills/register** — necessary before opening the API to untrusted clients. v1.6 assumes trusted internal network.
- **Rate limiting on register** — no abuse vector in v1.6 (single skill, internal callers).
- **Version negotiation on register** — accepting `1.x` for any major-1 manifest is a Phase 28 contract invariant; the loader/register already enforce it. No additional endpoint work needed.
- **Pagination on GET /api/v1/skills** — list stays small in v1.6 (single skill). Add when v1.7+ ships multiple skills.
- **DELETE endpoint** — registry.delete() exists from Phase 29 WR-05, but no REST surface in v1.6. Add to a future admin-API phase.
- **Audit log of register/unregister events** — deferred per CONTEXT.md Phase 29 decision (registry is a cache, o_skillRegistry is source of truth).

</deferred>
