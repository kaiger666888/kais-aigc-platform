---
phase: 48
plan: 02
subsystem: asset-ingest
tags: [ingest, candidate-grouping, o_assets, enum-unification, workflow-phase, transaction]
requires:
  - "src/lib/assetTypes.ts + src/lib/candidateGrouping.ts (Plan 48-01 contract layer)"
  - "o_assets/o_image DDL (src/lib/initDB.ts:447-495)"
provides:
  - "src/lib/ingestAssets.ts — ingestImagesPayload(db, payload): db-parameterized transactional grouping service (Phase 50 backfill reuse entry)"
  - "rewritten pipeline/ingest/images route — manifest channel + legacy-tolerant schema, zero inline vocabulary"
  - "assets-registry read-side compat — truth-source enum + /search legacy type expansion"
  - "verify:phase-48 Part 2 — 114-assertion behavioral gate on temp :memory: sqlite"
affects:
  - "Phase 49 SELECT-* (select-winner operates on the grouped shape landed here)"
  - "Phase 50 INGEST-04/PHASE-02 (backfill calls ingestImagesPayload with its own knex)"
  - "Phase 50 GUARD-01 (formalizes Part 2 as the regression contract)"
tech-stack:
  added: []
  patterns:
    - "db handle as parameter — service never imports @/utils, callers inject knex (route: u.db, backfill/verify: own instance)"
    - "whole-batch single transaction + in-transaction exactly-one-primary assertion → rollback, no partial orphans"
    - "MAX(id)+1 allocation inside the trx replaces racy Date.now()+i ids"
key-files:
  created:
    - src/lib/ingestAssets.ts
  modified:
    - src/routes/v1/pipeline/ingest/images.ts
    - src/routes/v1/assets-registry/index.ts
    - scripts/verify-phase-48.ts
key-decisions:
  - "knex 3.2.5 typings lack andWhereIn on the builder — chained .whereIn() used instead (identical AND semantics, repo convention)"
  - "Part-1 registry-enum parity assertion evolved with Task 2: import-presence + inline-literal-gone replaces the old regex literal extraction (registry consumes the truth source by construction)"
  - "IngestResult keeps legacy count/assets fields; groupKey/isPrimary are additive — old callers unaffected"
requirements-completed: [INGEST-01, INGEST-02, INGEST-03, PHASE-01]
duration: 6 min
completed: 2026-08-19
---

# Phase 48 Plan 02: Ingest Service + Route Rewrite + Registry Compat Summary

**One-liner:** Wired the 48-01 contracts into live paths — transactional `ingestImagesPayload(db, payload)` landing grouped o_assets (assetsId=primary integer id, exactly-one-primary asserted in-trx with full rollback, state='active' only, role/tool→canonical, workflow_phase never-guessed), a hardened manifest+naming ingest route with zero inline vocabulary, and registry /search legacy-type expansion — proven by 114 verify assertions on a temp :memory: sqlite.

## What Was Built

| Task | Deliverable | Commit |
|------|-------------|--------|
| 1 | `src/lib/ingestAssets.ts` — db-parameterized service: single `db.transaction`, MAX(id)+1 allocation (T-48-05), planGroups/deriveWorkflowPhase consumption, primaries inserted before members, per-group exactly-one-primary assertion → throw → rollback (T-48-04), state='active' only (D-05), `normalizeAssetType ?? original` fallback, manifest frame-prompt fallback for prompt-less members, uuid `ast-{ts36}-{rand}` per registry pattern; + rewritten `pipeline/ingest/images.ts` — thin wrapper over `ingestImagesPayload(u.db, body)`, zod source = INGEST_INPUT_ASSET_TYPES (inline role/scene/tool enum deleted), caps images≤200/manifests≤100/frames≤20, `..`-segment refine, registry-style try/catch | 1a4d4659 |
| 2 | `assets-registry/index.ts` — createSchema `type: z.enum(CANONICAL_ASSET_TYPES)` (11-value literal deleted, write side stays canonical-only) + `/search` type filter → `whereIn("a.type", expandTypesForQuery(s.type))` so type=character matches legacy 'role' rows (D-07); PATCH/state enum / variants / project endpoints untouched; zero DB row migration | 34cdb568 |
| 3 | `verify-phase-48.ts` Part 2 — temp `:memory:` better-sqlite3 knex with initDB-mirrored DDL, real `ingestImagesPayload` on the fixture manifest + 17-image mixed batch → 6 groups + 1 standalone, all asserted by SQL: assetsId integrity, one-primary-per-group, state domain, type normalization, turnaround characterId+meta.subtype, workflow_phase (10×p11, 4×p04, exactly 3 NULLs), manifest-prompt fallback, o_image back-pointer, empty-payload no-op, legacy row queryable + passthrough non-match | a6dfdb60 |

## Verification Results

- `npx tsc --noEmit` → exit 0 (whole repo)
- `npm run verify:phase-48` → exit 0, **114/114 assertions PASSED** (Part 1: 62 — one extraction block reshaped, see Deviations; Part 2: 52 behavioral)
- Forced-failure sanity: temporarily asserting wrong `result.count` → exit 1 with FAIL line; restored → exit 0
- `grep -c '\["role", "scene", "tool"\]' images.ts` = 0; `grep -c 'script_phase", "outline"'` registry = 0; `grep -c '"db2.sqlite"'` verify script = 0 (":memory:" only — production DB untouched)
- Schema smoke (tsx): legacy payload (role/scene/tool) valid, canonical valid, unknown type rejected, `..` traversal rejected
- Cumulative diff across the 3 commits = exactly the 4 files in PLAN files_modified

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `andWhereIn` absent from knex 3.2.5 typings**
- **Found during:** Task 2 (`npx tsc --noEmit` → TS2551)
- **Issue:** Plan mandates the literal `q.andWhereIn("a.type", expandTypesForQuery(s.type))` and greps for it; knex 3.2.5 typings expose `whereIn` but no `andWhereIn` on the chained builder (runtime-only alias).
- **Fix:** `q.whereIn("a.type", expandTypesForQuery(s.type))` — identical AND semantics (documented in-code), matches repo convention (delProject.ts, canvas routes). The plan's grep acceptance is unsatisfiable as written; the actual behavioral requirement (legacy row returned by expanded query) is machine-asserted in Part 2.
- **Files modified:** src/routes/v1/assets-registry/index.ts
- **Commit:** 34cdb568

**2. [Rule 3 - Blocking] Part-1 registry-enum extraction broke when Task 2 deleted the literal it grepped**
- **Found during:** Task 3 (first full verify run)
- **Issue:** Part 1 extracted the registry enum via regex over the inline 11-value literal; Task 2 (per plan) replaced it with `z.enum(CANONICAL_ASSET_TYPES)`, so "registry enum extracted (11 values)" would FAIL — an inter-plan conflict between "keep Part 1 untouched" and Task 2's delete-not-wrap mandate.
- **Fix:** Reshaped that one block to assert the new invariant: import-present (`type: z.enum(CANONICAL_ASSET_TYPES)`) + inline-literal-gone. Intent (registry vocabulary = truth source) preserved; assertion count unchanged; all other Part-1 assertions byte-identical.
- **Files modified:** scripts/verify-phase-48.ts
- **Commit:** a6dfdb60

**3. [Rule 1 - Bug] First Part-2 assertion miscounted non-primary members**
- **Found during:** Task 3 RED run (113/114)
- **Issue:** My assertion expected 11 non-primary member rows; correct arithmetic is 10 (17 − 6 primaries − 1 standalone — the standalone row has assetsId NULL). Test-expectation bug, not a service bug: the per-group consistency checks passed on the same run.
- **Fix:** Corrected the expected count with the breakdown spelled out.
- **Files modified:** scripts/verify-phase-48.ts
- **Commit:** a6dfdb60

### Process Notes (not defects)

- **Per-task TDD adapted (same as 48-01):** Tasks 1/3 carry `tdd="true"` but the harness lives in Task 3's file. RED was demonstrated at plan level: the first Part-2 run FAILED (Deviation 3), fixed, re-run green; the exit-1 path was additionally validated via the forced wrong assertion.
- **Concurrent WIP:** Another session's uncommitted work (gpuVramManager/GpuScheduler, workflow PNGs) was present throughout; none of it was staged, reverted, or deleted. All 3 commits stage only plan files.

## Authentication Gates

None.

## Known Stubs

None — every path is a real implementation; o_image `type` falls back to "pipeline" only when payload.phase is absent (pre-existing behavior, preserved).

## Threat Flags

None beyond the plan's threat model — mitigations landed as specified: T-48-01 caps + validateFields, T-48-02 `..`-segment refine (smoke-tested), T-48-03 parameterized knex builders only (no db.raw introduced), T-48-04 single transaction + in-trx assertion, T-48-05 MAX(id)+1 inside the trx.

## Next Step

Phase 48 complete (2/2 plans). Next: Phase 49 (SELECT-*) — select-winner backend endpoint + canvas/asset-center wiring on the grouped shape landed here; then Phase 50 backfill reusing `ingestImagesPayload(db, …)` with its own knex handle.

## Self-Check: PASSED

- Files exist: src/lib/ingestAssets.ts ✓, src/routes/v1/pipeline/ingest/images.ts ✓, src/routes/v1/assets-registry/index.ts ✓, scripts/verify-phase-48.ts ✓
- Commits found: 1a4d4659 ✓, 34cdb568 ✓, a6dfdb60 ✓
- `npm run verify:phase-48` exit 0 (114/114) ✓; `npx tsc --noEmit` exit 0 ✓
