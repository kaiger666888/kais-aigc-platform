---
phase: 29-db-migration-registry-skeleton
plan: 01
subsystem: persistence
tags: [database, migration, skill-contract, schema]
requires:
  - "Phase 28 CONTRACT (validateManifest) — not called by this plan but consumed by Plan 29-02"
provides:
  - "o_skillRegistry table (REGISTRY-01) — storage for SkillManifest rows"
  - "o_assets.skill_id column (REGISTRY-02) — skill attribution for assets"
  - "o_assets.workflow_phase column (REGISTRY-02) — closes phase-asset-management audit gap"
  - "kv_pipelineRun.skill_id column (REGISTRY-03) — skill attribution for pipeline runs"
  - "movie-v1 backfill (REGISTRY-04) — every pre-existing NULL skill_id row set to movie-v1"
affects:
  - "Plan 29-02 loader reads o_skillRegistry table created here"
  - "Phase 30 API-06 default seed writes into o_skillRegistry"
  - "Phase 31 callback refactor writes skill_id + workflow_phase on new rows"
tech-stack:
  added: []
  patterns:
    - "Existing TableSchema[] idempotent createTable loop in initDB.ts"
    - "Existing addColumn() hasColumn-guarded helper in fixDB.ts"
    - "Knex query builder UPDATE for backfill (whereNull + update)"
key-files:
  created: []
  modified:
    - src/lib/initDB.ts
    - src/lib/fixDB.ts
    - src/types/database.d.ts
decisions:
  - "Nullable TEXT columns with NO default — explicit-is-better; Phase 31 callbacks set values deliberately"
  - "workflow_phase added but NOT backfilled — Phase 29 does not own the writer; existing rows stay NULL"
  - "Backfill WHERE clause is skill_id IS NULL only — no projectId filter, so orphaned assets are covered"
  - "No initData on o_skillRegistry — seeding is Phase 30 (API-06) responsibility"
metrics:
  duration: "~265s"
  completed: "2026-06-15"
  tasks: 2
  files: 3
---

# Phase 29 Plan 01: DB Migration + Registry Skeleton Summary

Persistence layer for the Skill Contract: new `o_skillRegistry` table + nullable `skill_id`/`workflow_phase` columns on `o_assets` and `kv_pipelineRun`, with one-time `movie-v1` backfill for all pre-existing NULL rows.

## What Was Built

### REGISTRY-01: o_skillRegistry table (initDB.ts)

Appended a new `TableSchema` entry to the `tables[]` array in `src/lib/initDB.ts`. The table has 5 columns:

| Column | Type | Notes |
|--------|------|-------|
| `skill_id` | TEXT, NOT NULL | Primary key (e.g., `"movie-v1"`) |
| `manifest_json` | TEXT | Full JSON blob of SkillManifest |
| `version` | TEXT | Denormalized `major.minor` for queryability |
| `active` | INTEGER, default 1 | 0/1 boolean-as-integer (SQLite convention) |
| `registered_at` | INTEGER | Unix timestamp |

No `initData` function — default seeding is Phase 30 (API-06) responsibility. Idempotent via the existing `hasTable` guard in the createTable loop.

### REGISTRY-02 + REGISTRY-03: Nullable columns (fixDB.ts)

Three `addColumn` calls added to the default-export function in `src/lib/fixDB.ts`:

- `addColumn("o_assets", "skill_id", "string")` — nullable TEXT, no default
- `addColumn("o_assets", "workflow_phase", "string")` — nullable TEXT, no default (closes phase-asset-management audit gap)
- `addColumn("kv_pipelineRun", "skill_id", "string")` — nullable TEXT, no default

All three are idempotent via the existing `hasColumn` guard in the `addColumn` helper.

### REGISTRY-04: movie-v1 backfill (fixDB.ts)

Two backfill UPDATE statements using the Knex query builder:

```typescript
await db("o_assets").whereNull("skill_id").update({ skill_id: "movie-v1" });
await db("kv_pipelineRun").whereNull("skill_id").update({ skill_id: "movie-v1" });
```

Key properties:
- **No projectId filter** — orphaned assets (projectId deleted) are covered automatically
- **Idempotent** — re-running matches zero rows when no NULLs remain
- **workflow_phase intentionally NOT backfilled** — Phase 31's refactored callbacks own the writer; existing rows stay NULL until then

### Type definitions (database.d.ts)

Updated `src/types/database.d.ts` (auto-generated file) to include the new columns and table. This file regenerates on boot via `initKnexType(db)`, but committing the regenerated state ensures compile-time correctness without requiring a boot cycle.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking issue] Updated database.d.ts type definitions**
- **Found during:** Task 2 verification (TypeScript compilation)
- **Issue:** The auto-generated `src/types/database.d.ts` did not include the new `skill_id`/`workflow_phase` columns or the `o_skillRegistry` table. TypeScript reported `TS2353: Object literal may only specify known properties, and 'skill_id' does not exist in type 'DbRecordArr<o_assets>'` on the backfill UPDATE statements.
- **Fix:** Manually updated the type definitions to match the schema changes — added `skill_id` to `kv_pipelineRun`, `skill_id` + `workflow_phase` to `o_assets`, new `o_skillRegistry` interface, and `o_skillRegistry` entry in the `DB` interface. The plan's verification section explicitly states: "src/types/database.d.ts will regenerate on next dev boot via initKnexType(db); commit the regenerated file alongside these schema changes."
- **Files modified:** `src/types/database.d.ts`
- **Commit:** `49c1339`

## Verification Results

| Check | Expected | Actual | Status |
|-------|----------|--------|--------|
| `grep -c "o_skillRegistry" src/lib/initDB.ts` | >= 1 | 1 | PASS |
| `grep -c 'addColumn("o_assets", "skill_id"' src/lib/fixDB.ts` | 1 | 1 | PASS |
| `grep -c 'addColumn("o_assets", "workflow_phase"' src/lib/fixDB.ts` | 1 | 1 | PASS |
| `grep -c 'addColumn("kv_pipelineRun", "skill_id"' src/lib/fixDB.ts` | 1 | 1 | PASS |
| `grep -c "movie-v1" src/lib/fixDB.ts` | >= 2 | 4 | PASS |
| `grep -c 'defaultTo("movie-v1")' src/lib/fixDB.ts` | 0 | 0 | PASS |
| `grep -c 'whereNull("workflow_phase")' src/lib/fixDB.ts` | 0 | 0 | PASS |
| `npx tsc --noEmit` | 0 errors | 0 errors | PASS |

## Commits

| Hash | Type | Description |
|------|------|-------------|
| `f7cf71b` | feat | Add o_skillRegistry table to initDB.ts (Task 1) |
| `9d630ae` | feat | Add skill_id + workflow_phase columns + movie-v1 backfill to fixDB.ts (Task 2) |
| `49c1339` | fix | Regenerate database.d.ts with new schema columns (Rule 3) |

## Self-Check: PASSED

- [x] `src/lib/initDB.ts` — o_skillRegistry table entry exists with 5 columns + primary key
- [x] `src/lib/fixDB.ts` — 3 addColumn calls + 2 backfill UPDATEs, no defaultTo, no workflow_phase backfill
- [x] `src/types/database.d.ts` — all new columns and o_skillRegistry interface present
- [x] Commit `f7cf71b` exists in git log
- [x] Commit `9d630ae` exists in git log
- [x] Commit `49c1339` exists in git log
- [x] TypeScript compiles with 0 errors
