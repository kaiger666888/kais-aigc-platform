# Phase 29: DB Migration + Registry Skeleton - Context

**Gathered:** 2026-06-15
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous mode)

<domain>
## Phase Boundary

Phase 29 introduces the persistence + in-memory cache layers for the Skill Contract. It delivers:

1. **DB schema changes** — new `o_skillRegistry` table + new nullable `skill_id` column on `o_assets` and `kv_pipelineRun`.
2. **One-time backfill** — every existing NULL `skill_id` row is set to `movie-v1` (including orphaned assets whose `projectId` was already deleted).
3. **In-memory registry/cache** — singleton `registry` object with `list()`, `phaseById()`, `nodeTypeById()`, `register()` plus a `loader.loadAllFromDB()` that hydrates the registry once at boot.

Out of scope:
- **Phase 30** owns the default seed (writing `movie-v1` into `o_skillRegistry` on empty-DB boot) and the REST API.
- **Phase 31** owns the callback refactor that consumes `registry.phaseById` / `registry.nodeTypeById`.
- No UI changes. No REST surface.

The success criteria require: boot with populated table → `registry.list()` returns all rows with zero additional SQL during subsequent lookups in the same process; boot with empty table → no crash, `list()` returns `[]`; lookups for unknown IDs return `undefined` (no silent fallback to movie-v1).

</domain>

<decisions>
## Implementation Decisions

### Migration Mechanism
- **Extend the existing `src/lib/initDB.ts` table array** with a new `o_skillRegistry` schema entry (idempotent via existing `if (!hasTable)` guard). Matches the v1.0–v1.5 pattern; no new tooling.
- **Extend `src/lib/fixDB.ts`** with two `addColumn('o_assets', 'skill_id', 'string')` and `addColumn('kv_pipelineRun', 'skill_id', 'string')` calls. These are already idempotent (`hasColumn` guard).
- **One-time backfill** lives inside the migration helper (in `fixDB.ts` or a new sibling) — `UPDATE o_assets SET skill_id = 'movie-v1' WHERE skill_id IS NULL` + same for `kv_pipelineRun`. Idempotent: re-running on a populated column is a no-op.
- **Rejected alternatives:** new `migrations/` dir with `knex migrate:latest` (new tool, requires knexfile config); CLI script `yarn backfill:skill-id` (one-shot, easy to forget on rebuild).
- **Resolves STATE.md blocker:** "Phase 29 DB migration runner mechanism (Knex? Custom? Manual SQL?)" → Use existing `initDB.ts`/`fixDB.ts` pattern (Knex schema builder, idempotent, no new tool).

### Registry / Loader Architecture
- **Singleton module** at `src/skills/registry.ts` exporting a `registry` object literal (frozen) with `list()`, `phaseById(skillId, phaseId)`, `nodeTypeById(skillId, typeId)`, `register(manifest)`, and `get(skillId)`. Imports the `SkillManifest` type from `src/skills/contract.ts`.
- **In-memory representation:** primary `Map<skillId, SkillManifest>` plus two secondary indexes — `Map<skillId, Map<phaseId, PhaseDecl>>` and `Map<skillId, Map<nodeTypeId, NodeTypeDecl>>` — built once when a skill is registered. This makes the synchronous `phaseById`/`nodeTypeById` lookups O(1) as required by success criterion #4.
- **Loader:** `src/skills/loader.ts` exports `loadAllFromDB(knex)` that `SELECT skill_id, manifest_json FROM o_skillRegistry WHERE active = 1`, runs each row through `validateManifest()` (Phase 28), and calls `registry.register()` for each valid manifest. Invalid rows are logged + skipped (does not crash boot).
- **Rejected alternatives:** class-based service via DI (no DI container in this codebase — introduces a new pattern); eager instantiation at module import (couples DB to import time, hard to test).

### Boot Lifecycle
- **Order:** `initDB.ts` → `fixDB.ts` (creates tables + adds columns + runs backfill) → `loader.loadAllFromDB(knex)` → routes start. The call site is most likely `src/app.ts` (or wherever `initDB` is currently invoked).
- **Empty-table behavior (Success Criterion #3):** `loadAllFromDB` resolves to `[]`; `registry.list()` returns `[]`; no error thrown. Default seeding is a Phase 30 concern.
- **Cache invalidation:** NONE in v1.6. The cache lives for the process lifetime. `registry.register()` (called by Phase 30's `POST /api/v1/skills/register`) updates the in-memory maps synchronously after the SQL INSERT succeeds. No TTL, no polling.
- **Rejected alternatives:** lazy load on first access (race condition on first concurrent request); TTL-based cache (unnecessary complexity for v1.6's single-skill world).

### Data Model
- **`o_skillRegistry` columns:** `skill_id` (TEXT, primary key), `manifest_json` (TEXT, full JSON blob), `version` (TEXT, denormalized from manifest for queryability), `active` (INTEGER 0/1, default 1), `registered_at` (INTEGER unix timestamp).
- **`o_assets.skill_id`** AND **`o_assets.workflow_phase`** AND **`kv_pipelineRun.skill_id`** are added as **nullable TEXT columns with no default**. The Phase 29 backfill populates existing rows' `skill_id` with `movie-v1`. `workflow_phase` is added but NOT backfilled — existing rows remain NULL until Phase 31's refactored callbacks populate them (Phase 29 does not own the writer). New rows are written by Phase 31's refactored callbacks (the writer is responsible for setting both skill_id and workflow_phase explicitly).
- **Why both columns on `o_assets`:** REGISTRY-02 verbatim is "skill_id + workflow_phase columns". ROADMAP architecture decision #7: "Close phase-asset-management gap as a byproduct (add skill_id + workflow_phase to o_assets)". PROJECT.md line 132: "asset schema 加 skill_id + workflow_phase". The `workflow_phase` column closes the prior audit gap on "阶段性资产管理" (phase-asset-management) — knowing which workflow phase produced each asset.
- **Validation at load time:** `loader.loadAllFromDB()` and `registry.register()` both invoke `validateManifest()` from Phase 28. Invalid manifests are rejected with a structured log entry. Closes Pitfalls A5 (bad manifest in DB would corrupt the registry → guarded).
- **Rejected alternatives:** normalizing the manifest into 11+ columns (hard to query, painful migrations); forcing NOT NULL with default 'movie-v1' on the new columns (masks bugs — explicit-is-better, and Phase 31 will set them deliberately).

### Claude's Discretion
- Exact placement of the `loadAllFromDB()` call in the boot sequence (likely `src/app.ts` near the existing `initDB`/`fixDB` invocation — researcher should confirm).
- Whether to expose `registry` as a frozen object literal or via a `getRegistry()` accessor (the latter is slightly safer for test isolation but adds a layer of indirection — pick what reads cleanest).
- Naming of the backfill helper — could be a new `backfillSkillId()` in `fixDB.ts`, or a sibling file `src/lib/backfillSkillId.ts`. Either is fine; prefer fewer files.
- Whether to add a `verify-phase-29.ts` runner that exercises the registry against a transient SQLite DB (recommended — follows v1.5 verify-phase-23/28 pattern).

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`src/utils/db.ts`** — Knex singleton (`db`). The loader and registry both import this for queries.
- **`src/lib/initDB.ts`** — `TableSchema[]` pattern with name + builder + optional initData. Add `o_skillRegistry` as a new entry here.
- **`src/lib/fixDB.ts`** — `addColumn(table, column, type)` helper, already idempotent via `hasColumn` guard. Perfect for adding `skill_id` to `o_assets` and `kv_pipelineRun`.
- **`src/skills/contract.ts` + `src/skills/validator.ts`** (Phase 28) — `SkillManifest` type + `validateManifest()`. Loader imports both.
- **`scripts/verify-phase-23.ts` / `scripts/verify-phase-28.ts`** — Standalone tsx test runner pattern. Replicate for `verify-phase-29.ts`.

### Established Patterns
- **Boot-time schema setup:** `initDB` (table creation) runs before `fixDB` (column add/drop). Both are idempotent. The Phase 29 migration slots cleanly into this pattern.
- **Knex schema builder, not raw SQL:** Every existing schema change uses the builder API. The new `o_skillRegistry` table should do the same — no raw `CREATE TABLE` strings.
- **No test framework (Pitfalls B3):** Plain TS modules + tsx runners. The verify-phase-29.ts runner follows the same `assert()` + `results[]` + `main().catch(exit 2)` shape.
- **TS ESM/CJS interop (Pitfalls B5):** Use standalone `.ts` scripts invoked via `tsx`, not `tsx -e`. Loader + registry must work both when imported by the running server and when invoked from a verify script.

### Integration Points
- **Boot call site:** Find where `initDB` + `fixDB` are currently invoked (likely `src/app.ts` or `src/index.ts`). Insert `await loadAllFromDB(db)` immediately after `fixDB` resolves and before routes start listening.
- **Phase 30 (Default Seed) consumer:** Will call `registry.register()` after writing to `o_skillRegistry`. The registry API must be stable before Phase 30 begins.
- **Phase 31 (Callback Refactor) consumer:** Will replace 4 hardcoded constants with `registry.phaseById('movie-v1', phaseId)` + `registry.nodeTypeById('movie-v1', typeId)`.

</code_context>

<specifics>
## Specific Ideas

- The registry's secondary indexes (`Map<skillId, Map<phaseId, PhaseDecl>>`) must be built inside `register()` so that `phaseById` is a pure map lookup with no per-call scanning. This is non-negotiable for success criterion #4 ("no silent fallback to movie-v1") — if the index is missing, the lookup must return `undefined`, not scan-and-guess.
- Backfill must include orphaned assets (rows whose `projectId` was deleted). The UPDATE statement is unconditional on `skill_id IS NULL` — it does not filter on `projectId`, so orphans are covered automatically.
- Pitfalls A5 (DB manifest validity): loader MUST validate every row's manifest_json against Phase 28's zod schema. A row that fails validation is logged with `skill_id` + ruleId and skipped, not loaded into the registry. This prevents a hand-edited bad manifest from corrupting the in-memory cache.

</specifics>

<deferred>
## Deferred Ideas

- **Migration versioning / rollback** — Knex's migration tool with up/down scripts. v1.6 doesn't need rollbacks (the columns are additive and idempotent). v1.7+ can introduce a migrations/ dir if rollback support becomes necessary.
- **Registry pub/sub** — emit events when skills are registered/unregistered. Not needed until Phase 32 (canvas) wants to reactively refresh its nodeTypes map, and even then Phase 32 can re-fetch via REST.
- **Per-skill health tracking** — flagged in STATE.md as deferred to v1.7+ (HEALTH-01/02/03). Reuse the hermes EWMA pattern then.
- **Multi-skill coexistence** — out of scope for v1.6 (single skill = movie-v1). The data model supports it (`skill_id` is the PK), but the loader/registry do not need to handle concurrent active skills yet.

</deferred>
