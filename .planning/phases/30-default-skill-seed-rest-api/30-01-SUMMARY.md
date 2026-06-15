---
phase: 30-default-skill-seed-rest-api
plan: 01
subsystem: skills
tags: [skill-contract, default-seed, boot, manifest-derivation]
requires:
  - "Phase 28 CONTRACT (validateManifest + SkillManifest/PhaseDecl/NodeTypeDecl types)"
  - "Phase 29 REGISTRY-05 (registry singleton with register/get/list/phaseById/nodeTypeById)"
  - "Phase 29 REGISTRY-06 (loadAllFromDB boot loader + o_skillRegistry table)"
provides:
  - "src/skills/defaultSkill.ts — MOVIE_V1_MANIFEST constant (derived from PHASE_ORDER + REVIEW_REQUIRED_PHASES + PHASE_INGEST_MAP) + seedDefaultIfEmpty(knex) idempotent boot seed"
  - "Boot wiring in src/utils/db.ts — seedDefaultIfEmpty(db) called after loadAllFromDB(db) in the IIFE"
  - "Exported REVIEW_REQUIRED_PHASES + PHASE_INGEST_MAP (phase-complete.ts) and PHASE_ORDER (resume.ts, hoisted to module scope) — transitional exports consumed by defaultSkill.ts; Phase 31 deletes them"
affects:
  - "Phase 31 callback refactor: replaces the three exported constants with registry.phaseById('movie-v1', phaseId) lookups — the derived manifest must produce identical requires_review + ingest_outputs + order values"
  - "Phase 30 Plan 02 REST API: GET /api/v1/skills will return movie-v1 on empty-DB boot because seedDefaultIfEmpty populated the registry"
  - "Phase 33 E2E: the kais-movie-agent install artifact (docs/skill-author-guide/movie-v1.manifest.json) must reproduce the manifest derived here"
tech-stack:
  added: []
  patterns:
    - "Manifest as a pure-data TS constant derived at module-load time by translating existing constants (translation, not invention — ROADMAP SC #5)"
    - "Module-load-time validateManifest() self-check that throws on field drift before boot proceeds (T-30-01 mitigation)"
    - "Idempotent seed via SELECT COUNT(*) — populated DBs are a no-op returning false"
    - "Boot ordering: initDB → fixDB → loadAllFromDB → seedDefaultIfEmpty (CONTEXT.md D-03)"
    - "No try/catch around boot helpers — failures surface as unhandled promise rejections (29-02 decision)"
key-files:
  created:
    - src/skills/defaultSkill.ts
  modified:
    - src/utils/db.ts
    - src/routes/v1/pipeline/callback/phase-complete.ts
    - src/routes/v1/pipeline/resume.ts
decisions:
  - "Manifest derived by importing (not duplicating) the three pipeline constants — future edits to PHASE_ORDER/REVIEW_REQUIRED_PHASES/PHASE_INGEST_MAP flow into the manifest automatically until Phase 31 deletes them"
  - "PHASE_ORDER hoisted from inside resume.ts handler body to module scope before adding export — purely structural, no value change"
  - "requirement phase (order 0) is in PHASE_ORDER but absent from PHASE_INGEST_MAP — the ?? [] fallback in mapIngest yields ['none'] for it"
  - "Module-load-time self-check throws on validation failure (no try/catch) — manifest is a code constant so failure is a code bug"
  - "seedDefaultIfEmpty re-validates before INSERT even though the self-check ran — defensive invariant for registry.register()'s contract"
metrics:
  duration: "~237s"
  completed: "2026-06-15"
  tasks: 2
  files: 4
---

# Phase 30 Plan 01: Default Skill Seed (MOVIE_V1_MANIFEST + seedDefaultIfEmpty) Summary

Derived the `movie-v1` SkillManifest by translating the three existing hardcoded pipeline constants (`PHASE_ORDER`, `REVIEW_REQUIRED_PHASES`, `PHASE_INGEST_MAP`) into a `phase_taxonomy[]`, plus an idempotent `seedDefaultIfEmpty(knex)` that self-seeds the registry on empty-DB boot — closing API-06 (zero-config upgrade) and establishing the Phase 31 baseline.

## What Was Built

### src/skills/defaultSkill.ts (new) — manifest derivation + idempotent seed

Exports two symbols:

1. **`MOVIE_V1_MANIFEST: SkillManifest`** — built at module-load time as a pure data expression. The `phase_taxonomy[]` is derived by `buildPhaseTaxonomy()`, which iterates the keys of `PHASE_ORDER` (the canonical 12-phase list) and for each phase `P` emits:
   - `id: P`
   - `order: PHASE_ORDER[P]`
   - `label: P`
   - `requires_review: REVIEW_REQUIRED_PHASES.includes(P)`
   - `ingest_outputs: mapIngest(PHASE_INGEST_MAP[P] ?? [])` — empty arrays become `["none"]` (the contract sentinel); non-empty arrays pass through unchanged.

   Descriptive fields are hardcoded minimal sensible values per CONTEXT.md "Claude's Discretion":
   - 5 node types (`movie-v1::script/asset/storyboard/video/audio`) mapped to the five `BuiltinRenderer` primitives
   - 3 asset categories (`character-image`, `scene-image`, `voice-sample`)
   - `review_criteria: { auto_threshold: 0.8, human_threshold: 0.6 }`
   - `engine_task_types: ["IMAGE_DRAW", "IMAGE_REFINE", "VIDEO_GEN", "TTS", "MUSIC_GEN"]`
   - `runtime: { type: "external-http", endpoint: "http://localhost:8001", healthcheck_path: "/health" }`

   A module-load-time `validateManifest(MOVIE_V1_MANIFEST)` self-check throws on any field drift (no try/catch) — surfacing a code bug at the earliest possible point rather than letting a corrupt manifest propagate silently.

2. **`seedDefaultIfEmpty(knex): Promise<boolean>`** — implements the CONTEXT.md "Default Seed Trigger" verbatim:
   1. `SELECT COUNT(*) FROM o_skillRegistry` — single row, single column.
   2. If count > 0 → return false (idempotent no-op on populated DBs).
   3. Re-validate the manifest (defensive — guards against future code drift).
   4. INSERT one row: `{ skill_id: "movie-v1", manifest_json: JSON.stringify(MOVIE_V1_MANIFEST), version: "1.0", active: 1, registered_at: Date.now() }`.
   5. `registry.register(MOVIE_V1_MANIFEST)` — hydrate the in-memory cache so the just-seeded skill is immediately lookup-able.
   6. Return true.

### Transitional exports (Phase 31 will delete these constants)

- `src/routes/v1/pipeline/callback/phase-complete.ts` — `REVIEW_REQUIRED_PHASES` and `PHASE_INGEST_MAP` changed from module-private `const` to `export const`. No value or behavior change.
- `src/routes/v1/pipeline/resume.ts` — `PHASE_ORDER` was declared inside the route handler body; hoisted to module scope above `router` and changed to `export const`. The handler now references the module-scope constant. No value or behavior change for the handler's consumers.

### Boot wiring: src/utils/db.ts

Added `import { seedDefaultIfEmpty } from "@/skills/defaultSkill"` and inserted `await seedDefaultIfEmpty(db)` into the boot IIFE immediately after `await loadAllFromDB(db)` and before the `NODE_ENV` check:

```typescript
(async () => {
  await initDB(db);
  await fixDB(db);
  await loadAllFromDB(db);
  await seedDefaultIfEmpty(db);
  if (process.env.NODE_ENV == "dev") initKnexType(db);
})();
```

No try/catch wraps the seed — boot failures surface as unhandled promise rejections (correct signal per the 29-02 decision). Ordering matches CONTEXT.md D-03: initDB → fixDB → loadAllFromDB → seedDefaultIfEmpty.

## Deviations from Plan

None — plan executed exactly as written.

## Verification Results

| Check | Expected | Actual | Status |
|-------|----------|--------|--------|
| `npx tsc --noEmit` | 0 errors | 0 errors | PASS |
| `grep -q "export const MOVIE_V1_MANIFEST" src/skills/defaultSkill.ts` | match | match | PASS |
| `grep -q "export async function seedDefaultIfEmpty" src/skills/defaultSkill.ts` | match | match | PASS |
| `grep -qE "import.*REVIEW_REQUIRED_PHASES.*from" src/skills/defaultSkill.ts` | match | match | PASS |
| `grep -qE "import.*PHASE_INGEST_MAP.*from" src/skills/defaultSkill.ts` | match | match | PASS |
| `grep -qE "import.*PHASE_ORDER.*from" src/skills/defaultSkill.ts` | match | match | PASS |
| `grep -qE "export const (REVIEW_REQUIRED_PHASES\|PHASE_INGEST_MAP)" src/routes/v1/pipeline/callback/phase-complete.ts` | match (×2) | match (×2) | PASS |
| `grep -qE "export const PHASE_ORDER" src/routes/v1/pipeline/resume.ts` | match | match | PASS |
| Module-load-time `validateManifest(MOVIE_V1_MANIFEST)` self-check present | yes | yes | PASS |
| Derived manifest's `node_types[].type` all match `^movie-v1::[a-z0-9-]+$` | 5/5 | 5/5 | PASS |
| Derived manifest's `phase_taxonomy[].id` set equals PHASE_ORDER keys | 12 phases | 12 phases | PASS |
| `grep -q 'import { seedDefaultIfEmpty } from "@/skills/defaultSkill"' src/utils/db.ts` | match | match | PASS |
| `await seedDefaultIfEmpty(db)` immediately after `await loadAllFromDB(db)` | yes | yes | PASS |
| No try/catch wraps seedDefaultIfEmpty in db.ts | yes | yes (only try is in initKnexType) | PASS |

### Derivation smoke test (48 assertions, all pass)

A temporary tsx script imported `MOVIE_V1_MANIFEST` + the three source constants and asserted that for every phase `P` in `PHASE_ORDER`:
- `phase_taxonomy[i].order === PHASE_ORDER[P]`
- `phase_taxonomy[i].requires_review === REVIEW_REQUIRED_PHASES.includes(P)`
- `phase_taxonomy[i].ingest_outputs === (PHASE_INGEST_MAP[P]?.length ? PHASE_INGEST_MAP[P] : ["none"])`

All 12 phases × 3 fields + set/count equality + node-type namespacing + version format = 48 assertions, all PASS. The manifest is provably a translation of the constants (ROADMAP SC #5).

### seedDefaultIfEmpty smoke test (7 assertions, all pass) against `:memory:` SQLite

1. Empty-DB seed returns `true` and inserts exactly one row (skill_id=movie-v1, version=1.0, active=1).
2. `registry.list()` includes movie-v1 after seed.
3. Populated-DB seed returns `false` (idempotent no-op).
4. DB row count stays at 1 after the idempotent call (no duplicate INSERT).

The full behavioral proof (empty-DB boot → registry has movie-v1 end-to-end through the real boot IIFE) is exercised by `scripts/verify-phase-30.ts` in Plan 30-02 Task 3.

## Commits

| Hash | Type | Description |
|------|------|-------------|
| `de53a00` | feat | Task 1: src/skills/defaultSkill.ts (MOVIE_V1_MANIFEST derived from PHASE_ORDER + REVIEW_REQUIRED_PHASES + PHASE_INGEST_MAP + seedDefaultIfEmpty) + export the three constants |
| `65f0d57` | feat | Task 2: wire `await seedDefaultIfEmpty(db)` into boot IIFE in src/utils/db.ts after loadAllFromDB |

## Success Criteria

- [x] **API-06 closed:** defaultSkill.ts exists, exports MOVIE_V1_MANIFEST + seedDefaultIfEmpty(knex), wired into boot after loadAllFromDB.
- [x] **ROADMAP SC #5 closed:** manifest is provably derived from the three constants (all three are imported, not duplicated; 48-assertion derivation smoke test passes).
- [x] **Idempotency:** calling seedDefaultIfEmpty on a populated DB is a no-op returning false (verified via :memory: SQLite smoke test).
- [x] **Phase 31 readiness:** `registry.phaseById('movie-v1', phaseId)` will return the same requires_review + ingest_outputs + order values the existing constants produce (derivation smoke test proves field-by-field equality for all 12 phases).
- [x] `npx tsc --noEmit` exits 0.
- [x] seedDefaultIfEmpty against :memory: SQLite works (7-assertion smoke test passes).

## Self-Check: PASSED

- [x] `src/skills/defaultSkill.ts` exists — exports MOVIE_V1_MANIFEST + seedDefaultIfEmpty, 285 lines
- [x] `src/utils/db.ts` modified — `await seedDefaultIfEmpty(db)` wired after loadAllFromDB, before NODE_ENV check
- [x] `src/routes/v1/pipeline/callback/phase-complete.ts` — REVIEW_REQUIRED_PHASES + PHASE_INGEST_MAP now `export const`
- [x] `src/routes/v1/pipeline/resume.ts` — PHASE_ORDER hoisted to module scope + `export const`
- [x] Commit `de53a00` exists in git log
- [x] Commit `65f0d57` exists in git log
- [x] TypeScript compiles with 0 errors
