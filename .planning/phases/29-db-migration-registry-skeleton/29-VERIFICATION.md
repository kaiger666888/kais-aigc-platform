---
phase: 29-db-migration-registry-skeleton
verified: 2026-06-15T11:32:00Z
status: passed
score: 12/12 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 11/12
  gaps_closed:
    - "TypeScript compiles without error (Plan 29-01 acceptance criterion + Plan 29-02 acceptance criterion)"
  gaps_remaining: []
  regressions: []
---

# Phase 29: DB Migration + Registry Skeleton — Verification Report

**Phase Goal:** The platform has a persisted skill registry (`o_skillRegistry`) with existing data backfilled to `movie-v1`, plus an in-memory registry/cache layer that later phases can look up synchronously without touching SQL.
**Verified:** 2026-06-15T11:32:00Z
**Status:** passed
**Re-verification:** Yes — after gap closure (commit b75b20a)

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | After running initDB.ts on a fresh DB, the o_skillRegistry table exists with the 5 declared columns (skill_id PK, manifest_json, version, active, registered_at) | VERIFIED | `src/lib/initDB.ts` lines 1189-1200 declare the `o_skillRegistry` TableSchema entry with `table.text("skill_id").notNullable()`, `table.text("manifest_json")`, `table.text("version")`, `table.integer("active").defaultTo(1)`, `table.integer("registered_at")`, `table.primary(["skill_id"])`. Runner creates the same table in-memory and all tests pass. |
| 2 | After running fixDB.ts on an existing DB, o_assets.skill_id, o_assets.workflow_phase, kv_pipelineRun.skill_id columns exist as nullable TEXT | VERIFIED | `src/lib/fixDB.ts` lines 75-77: `addColumn("o_assets", "skill_id", "string")`, `addColumn("o_assets", "workflow_phase", "string")`, `addColumn("kv_pipelineRun", "skill_id", "string")` — each `addColumn` uses the existing `hasColumn` guard. |
| 3 | After fixDB.ts on a DB where o_assets rows have NULL skill_id, every NULL row → 'movie-v1' | VERIFIED | `src/lib/fixDB.ts` line 93: `db("o_assets").whereNull("skill_id").update({ skill_id: "movie-v1" })`. Runner Test 1 PASS: NULL rows become movie-v1, non-NULL rows untouched, orphan (projectId NULL) covered. |
| 4 | After fixDB.ts on a DB where kv_pipelineRun rows have NULL skill_id, every NULL row → 'movie-v1' | VERIFIED | `src/lib/fixDB.ts` line 99: `db("kv_pipelineRun").whereNull("skill_id").update({ skill_id: "movie-v1" })`. Runner Test 1 PASS. |
| 5 | Re-running initDB + fixDB on an already-migrated DB is a no-op (idempotent) | VERIFIED | `initDB.ts` `hasTable` guard skips table creation; `fixDB.ts` `hasColumn` guard skips addColumn; `whereNull("skill_id")` matches zero rows when no NULLs remain. |
| 6 | Orphaned assets (projectId deleted) are backfilled to 'movie-v1' (no projectId filter) | VERIFIED | `src/lib/fixDB.ts` line 80 comment confirms "Unconditional on projectId — orphaned assets are covered automatically." Runner Test 1 explicitly inserts an orphan row and asserts it is backfilled. |
| 7 | workflow_phase is added as nullable TEXT with NO default and NO backfill (intentional; Phase 31 owns the writer) | VERIFIED | `src/lib/fixDB.ts` line 76 addColumn; `grep -c 'whereNull("workflow_phase")'` returns 0; `grep -c 'defaultTo'` returns 0 in fixDB.ts. Runner Test 1 asserts workflow_phase stays NULL. |
| 8 | registry.list() returns every registered SkillManifest, no SQL during the call | VERIFIED | `src/skills/registry.ts` line 139: `list: (): SkillManifest[] => Array.from(manifests.values())` — pure Map read, no SQL. Runner Test 4 PASS. |
| 9 | registry.get(skillId) returns manifest for known, undefined for unknown (no fallback) | VERIFIED | `registry.ts` line 133: `get: (skillId) => manifests.get(skillId)`. Runner Test 4 asserts both known and unknown cases. |
| 10 | registry.phaseById / nodeTypeById return declared for known IDs, undefined for unknown (no fallback) | VERIFIED | `registry.ts` lines 146-156 use optional chaining `phaseIndex.get(skillId)?.get(phaseId)`. Secondary indexes built inside `register()` (lines 114-126). Runner Test 4 PASS: 6 assertions on known/unknown for both methods. |
| 11 | registry.register validates via validateManifest and throws on invalid (Pitfalls A5 guard) | VERIFIED | `registry.ts` lines 93-110: calls `validateManifest(manifest)`, throws `Error` with ruleId + field + message on failure. Runner Test 5 PASS: invalid manifest throws, registry not corrupted. |
| 12 | On boot with empty o_skillRegistry, loadAllFromDB resolves with 0 and registry.list() returns [] (no crash) | VERIFIED | `src/skills/loader.ts` lines 49-105: SELECT returns 0 rows, loop body never executes, returns 0. Runner Test 2 PASS: count=0, list length=0, no throw. |
| 13 | loadAllFromDB(db) is called after fixDB(db) in db.ts, before boot completes | VERIFIED | `src/utils/db.ts` IIFE lines 38-43: `await initDB(db); await fixDB(db); await loadAllFromDB(db); if (...)`. No try/catch wraps the loader. |
| 14 | TypeScript compiles without error | VERIFIED (re-verification) | Gap closed by commit b75b20a: both `.first()` results in `src/lib/fixDB.ts` lines 91 and 97 are wrapped with `as { c?: number } | undefined`. `npx tsc --noEmit` now exits 0 project-wide with zero errors. |

**Score:** 12/12 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/initDB.ts` | New o_skillRegistry TableSchema entry with 5 columns + PK | VERIFIED | Lines 1189-1200. All 5 columns + `table.primary(["skill_id"])` present. |
| `src/lib/fixDB.ts` | 3 addColumn calls + 2 backfill UPDATEs (with typed count guards) | VERIFIED | Lines 75-77 (3 addColumn), 91 + 97 (count guards with cast), 93 + 99 (2 backfill UPDATEs). No `defaultTo`, no `whereNull("workflow_phase")`. |
| `src/skills/registry.ts` | Frozen singleton with register/get/list/phaseById/nodeTypeById (+ bonus delete) | VERIFIED | Lines 79-177. `Object.freeze` applied, 6 methods (5 required + delete WR-05), 3 module-scoped Maps, secondary indexes built inside register(). |
| `src/skills/loader.ts` | loadAllFromDB(knex) boot loader with per-row validation | VERIFIED | Lines 48-106. SELECTs `o_skillRegistry WHERE active=1`, JSON.parse + validateManifest per row, per-row try/catch, logs + skips invalid. |
| `src/utils/db.ts` | loadAllFromDB(db) wired after fixDB(db) in IIFE | VERIFIED | Line 41: `await loadAllFromDB(db)`. |
| `scripts/verify-phase-29.ts` | Regression runner proving all 4 success criteria | VERIFIED | 465 lines, 29 assertions, all PASS, exit 0. |
| `src/types/database.d.ts` | Updated types for new columns + table | VERIFIED | Lines 34, 140, 143, 253-257, 350 confirm new columns and o_skillRegistry interface. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `src/skills/loader.ts` | `src/skills/validator.ts` | `import { validateManifest }` | WIRED | loader.ts line 32 imports validateManifest; line 71 calls it. |
| `src/skills/loader.ts` | `src/skills/registry.ts` | `registry.register()` | WIRED | loader.ts line 31 imports registry; line 73 calls register. |
| `src/skills/loader.ts` | `o_skillRegistry` table | `knex("o_skillRegistry").where("active", 1).select(...)` | WIRED | loader.ts lines 49-51. |
| `src/utils/db.ts` | `src/skills/loader.ts` | `import + await loadAllFromDB(db)` | WIRED | db.ts lines 11 + 41. |
| `src/skills/registry.ts` | `src/skills/contract.ts` | type import | WIRED | registry.ts line 31. |
| `fixDB.ts backfill` | `o_assets NULL skill_id rows` | `whereNull("skill_id").update({skill_id:"movie-v1"})` | WIRED | fixDB.ts line 93. |
| `fixDB.ts backfill` | `kv_pipelineRun NULL skill_id rows` | same pattern | WIRED | fixDB.ts line 99. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|-------------------|--------|
| `src/skills/registry.ts` (lookups) | `manifests` Map | Populated by `register()` from loader (DB SELECT) | Yes | FLOWING |
| `src/skills/registry.ts` (phaseById) | `phaseIndex` Map | Built inside `register()` from `manifest.phase_taxonomy` | Yes | FLOWING |
| `src/skills/registry.ts` (nodeTypeById) | `nodeTypeIndex` Map | Built inside `register()` from `manifest.node_types` | Yes | FLOWING |
| `src/skills/loader.ts` | `rows` from DB | `knex("o_skillRegistry").where("active",1).select(...)` | Yes (when table has rows) | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| All 4 success criteria + delete | `npx tsx scripts/verify-phase-29.ts` | 29 passed, 0 failed, exit 0 | PASS |
| InitDB greps (o_skillRegistry + 5 columns + PK) | `grep -A 7 'name: "o_skillRegistry"'` | 6 column declarations present | PASS |
| fixDB addColumn counts | `grep -c` for each addColumn | 1/1/1 as expected | PASS |
| Backfill UPDATEs present | `grep -c whereNull.skill_id.update.movie-v1` | 2 | PASS |
| No defaultTo('movie-v1') leak | `grep -c 'defaultTo("movie-v1")'` | 0 | PASS |
| No workflow_phase backfill | `grep -c 'whereNull("workflow_phase")'` | 0 | PASS |
| TypeScript compiles | `npx tsc --noEmit` | exit 0, 0 errors project-wide | PASS |

### Probe Execution

| Probe | Command | Result | Status |
|-------|---------|--------|--------|
| `scripts/verify-phase-29.ts` | `npx tsx scripts/verify-phase-29.ts` | exit 0, 29/29 PASS | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| REGISTRY-01 | 29-01 | o_skillRegistry table created (skill_id PK, manifest_json, version, active, registered_at) | SATISFIED | initDB.ts:1189-1200. NOTE: REQUIREMENTS.md lists `version, manifest, registered_at` (no `active`); the implementation adds `active` per CONTEXT.md Data Model decision. Columns supersede the requirements text — ROADMAP success criteria and CONTEXT.md are authoritative. |
| REGISTRY-02 | 29-01 | o_assets extended with skill_id + workflow_phase columns | SATISFIED | fixDB.ts:75-76 (both columns, nullable string, no default). |
| REGISTRY-03 | 29-01 | kv_pipelineRun extended with skill_id column | SATISFIED | fixDB.ts:77. |
| REGISTRY-04 | 29-01 | Backfill sets existing rows to movie-v1 using WHERE skill_id IS NULL (handles orphans) | SATISFIED | fixDB.ts:91-101. Runner Test 1 PASS: orphan (projectId NULL) is covered. |
| REGISTRY-05 | 29-02 | registry singleton with get/list/phaseById/nodeTypeById (no SQL on lookups) | SATISFIED | registry.ts:79-177. All lookups are Map reads. |
| REGISTRY-06 | 29-02 | Boot loader reads o_skillRegistry, validates via Phase 28 zod, populates cache | SATISFIED | loader.ts:48-106. db.ts:41 wires it into boot. |

All 6 REGISTRY requirements accounted for. No orphaned requirements.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (none) | — | — | — | Gap from prior pass closed by commit b75b20a; no new anti-patterns introduced. |

No TBD/FIXME/XXX markers, no TODO/HACK/PLACEHOLDER, no `return null/[]/{}/() => {}` stubs in the new files. The `as { c?: number } | undefined` casts added by b75b20a are a deliberate, type-safe narrowing of the Knex count-row shape — not an `as any` escape hatch.

### Human Verification Required

None. All Phase 29 success criteria are programmatic (backfill, in-memory lookups, empty-table boot, known/unknown semantics) and are fully covered by `scripts/verify-phase-29.ts` which passed 29/29. No UI, no visual inspection, no real-time behavior, no external service integration is in scope.

### Re-Verification Summary

**Previous verification (2026-06-15T10:54:56Z):** status=gaps_found, score=11/12. One gap — TypeScript errors at `src/lib/fixDB.ts:91,97` where `.c` was accessed on the typed row returned by `.first()` (Knex count shape).

**Gap closure commit b75b20a** (`fix(29-VERIF): cast Knex count() result to {c?:number} — closes typecheck gap`): wrapped both `.first()` results in `as { c?: number } | undefined` casts.

**Re-verification commands run:**

| Command | Result |
|---------|--------|
| `git log --oneline b75b20a -1` | Commit exists with expected message |
| `grep -n "as { c?: number } | undefined" src/lib/fixDB.ts` | 2 matches at lines 91 and 97 |
| `npx tsc --noEmit 2>&1 \| grep -c "error TS"` | `0` (zero errors project-wide) |
| `npx tsx scripts/verify-phase-29.ts` | `29 passed, 0 failed`, exit 0 |

**No regressions:** all 13 previously-passing truths remain VERIFIED (the 29/29 runner assertions cover the 6 REGISTRY requirements, 4 success criteria, and runtime behaviors). The fix touches only the cast wrapping of two read-only count queries — the runtime semantics are unchanged (the cast tells the compiler what Knex already returns).

**Outcome:** gap closed, status flipped to `passed`, score 12/12.

---

_Verified: 2026-06-15T11:32:00Z_
_Verifier: Claude (gsd-verifier)_
