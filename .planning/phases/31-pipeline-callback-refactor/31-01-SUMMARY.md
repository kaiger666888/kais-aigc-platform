---
phase: 31-pipeline-callback-refactor
plan: 01
subsystem: skill-contract
tags: [skill-manifest, source-of-truth-transition, phase-taxonomy, inlining]

# Dependency graph
requires:
  - phase: 28-skill-manifest-contract
    provides: SkillManifest / PhaseDecl / IngestOutput contract types
  - phase: 29-skill-registry-loader
    provides: registry singleton + validateManifest runtime guard
  - phase: 30-skill-rest-api-default-seed
    provides: MOVIE_V1_MANIFEST (derived form) + verify-phase-30.ts harness
provides:
  - "MOVIE_V1_MANIFEST.phase_taxonomy as a literal 12-entry inline array (no imports from pipeline callback files)"
  - "Zero references to REVIEW_REQUIRED_PHASES / PHASE_INGEST_MAP / PHASE_ORDER in src/skills/defaultSkill.ts and scripts/verify-phase-30.ts (clears Plan 02 pre-flight grep gate)"
  - "verify-phase-30.ts patched to read expected values from literals / manifest instead of deleted constants (61/61 assertions still pass)"
affects:
  - 31-pipeline-callback-refactor (Plan 02 constant deletion)
  - 31-pipeline-callback-refactor (Plan 03 callback registry integration)
  - 33-skill-negative-tests (regression guards consume the literal manifest)

# Tech tracking
tech-stack:
  added: []  # no new libraries — pure refactor
  patterns:
    - "Inline-literal manifest as single source of truth (replaces import-based derivation)"

key-files:
  created: []
  modified:
    - src/skills/defaultSkill.ts
    - scripts/verify-phase-30.ts

key-decisions:
  - "Inline all 12 PhaseDecl entries as object literals in defaultSkill.ts (no helper functions, no derivation) — the manifest becomes a pure literal constant"
  - "Replace every comment/JSDoc mention of the three constant identifiers with generic references to 'the pre-refactor pipeline callback constants (now deleted)' so Plan 02's pre-flight grep returns zero matches across src/"
  - "verify-phase-30.ts Test 1d upgraded from a set-equality check to strict-order equality against a hardcoded canonical 12-phase list (stronger regression guard)"
  - "verify-phase-30.ts Test 1e spot-check assertions use literal booleans/numbers (true/false, 5/3/1) instead of constant lookups — assertions still meaningful as regression locks"

patterns-established:
  - "Source-of-truth transition pattern: when deleting constants that feed a derived structure, first inline the derived values verbatim (Plan 01), then delete the constants in a separate plan (Plan 02) — keeps the pre-flight grep gate honest"

requirements-completed: [PIPELINE-02]

# Metrics
duration: ~15min
completed: 2026-06-15
---

# Phase 31 Plan 01: Inline phase_taxonomy into MOVIE_V1_MANIFEST Summary

**Literal 12-entry phase_taxonomy inlined into MOVIE_V1_MANIFEST; pipeline callback constant imports + all comment references removed from defaultSkill.ts and verify-phase-30.ts — source-of-truth transition complete for the skill layer**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-06-15T13:30Z (approx)
- **Completed:** 2026-06-15T13:48Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- `MOVIE_V1_MANIFEST.phase_taxonomy` is now a literal inline array of 12 PhaseDecl entries (orders 0-11), with no derivation from external constants
- All imports of `REVIEW_REQUIRED_PHASES`, `PHASE_INGEST_MAP`, `PHASE_ORDER` removed from `src/skills/defaultSkill.ts`; the `mapIngest()` and `buildPhaseTaxonomy()` translation helpers deleted (no longer needed)
- Every comment / JSDoc / docblock in `defaultSkill.ts` that mentioned the three constant identifiers by name has been rewritten — `grep -cE "REVIEW_REQUIRED_PHASES|PHASE_INGEST_MAP|PHASE_ORDER" src/skills/defaultSkill.ts` returns 0
- `scripts/verify-phase-30.ts` patched: removed the two constant imports, rewrote Test 1d and Test 1e to use literals / the manifest directly; all 61 assertions still pass with exit code 0
- Plan 02's pre-flight grep (`grep -rE "REVIEW_REQUIRED_PHASES|PHASE_INGEST_MAP|PHASE_ORDER" src/ --include="*.ts"`) will no longer trip on `defaultSkill.ts`

## Task Commits

Each task was committed atomically:

1. **Task 1: Inline phase_taxonomy into MOVIE_V1_MANIFEST and remove constant imports + ALL comment references** - `47cc72d` (refactor)
2. **Task 2: Patch verify-phase-30.ts to read from MOVIE_V1_MANIFEST instead of deleted constants** - `1b10ed7` (refactor)

## Files Created/Modified

- `src/skills/defaultSkill.ts` - MOVIE_V1_MANIFEST now contains a literal inline phase_taxonomy (12 entries); deleted imports of the three pipeline callback constants + the mapIngest/buildPhaseTaxonomy helpers; rewrote the top-of-file docblock and manifest JSDoc to frame the manifest as the literal single source of truth as of Phase 31
- `scripts/verify-phase-30.ts` - Removed imports of REVIEW_REQUIRED_PHASES, PHASE_INGEST_MAP, PHASE_ORDER; Test 1d uses a hardcoded canonical 12-phase list with strict-order equality; Test 1e spot-checks use literal expected values (true/false, 5/3/1)

## Decisions Made

- **Kept the `label === id` convention** for all 12 inline PhaseDecl entries (matches the previous `label: phaseId` derivation rule). The plan noted Phase 33 may refine labels; that's still a future-phase concern.
- **Upgraded Test 1d from set-equality to strict-order equality.** The old assertion (`phaseOrderKeys.every(k => phaseIds.includes(k))`) tolerated phase reordering as long as the set matched. The new assertion (`JSON.stringify(phaseIds) === JSON.stringify(expectedPhaseIds)`) locks the canonical order. This is a stronger regression guard for the same intent — the plan said "keeps the test meaningful as a regression guard against accidental phase reordering" and the strict-order form does that more directly.
- **Used literal booleans/numbers in Test 1e spot-checks** rather than re-deriving them from any structure. The plan called this out explicitly (replace `REVIEW_REQUIRED_PHASES.includes("storyboard")` with `true`, etc.). The assertions still lock the manifest values via direct equality.
- **Did NOT inline the comment-rewrite as a separate task.** The plan grouped all comment cleanup under Task 1's step 5, so all six comment blocks (top-of-file docblock, "Source-of-truth constants" header, "Translation helpers" header, mapIngest JSDoc, buildPhaseTaxonomy JSDoc, MOVIE_V1_MANIFEST JSDoc) were swept in the same edit. Verified zero residual references via grep after the edit.

## Deviations from Plan

None — plan executed exactly as written. Both tasks followed the plan's concrete steps verbatim, including the exact 12 PhaseDecl values, the comment-rewrite scope, and the verifier-patch shape.

## Issues Encountered

- **Pre-existing tsc error in `src/routes/assets/uploadImage.ts` (line 123):** `'err' is of type 'unknown'`. This is a pre-existing try/catch typing issue in a file NOT in my modified-files list. Per the SCOPE BOUNDARY rule, I did NOT fix it — it's out of scope for Plan 31-01. Both of my modified files (`defaultSkill.ts`, `verify-phase-30.ts`) produce zero tsc errors. The pre-existing error does not affect Plan 31-01's success criteria.

## User Setup Required

None — no external service configuration required. Pure source-code refactor; no env vars, no DB migration, no infrastructure changes.

## Next Phase Readiness

- **Plan 31-02 (constant deletion):** Ready to execute. The pre-flight grep across `src/` will return zero matches in `defaultSkill.ts` and `verify-phase-30.ts`. Plan 02 can delete `REVIEW_REQUIRED_PHASES` + `PHASE_INGEST_MAP` from `phase-complete.ts` and `PHASE_ORDER` from `resume.ts` without breaking any importer.
- **Plan 31-03 (callback registry integration):** Unblocked. The manifest is the literal source of truth; the registry lookups (`registry.phaseById(...)`) will read the inlined values.
- **Phase 33 (negative tests):** The 12 inline phase IDs are now stable literals; regression guards in `verify-phase-30.ts` lock both the canonical order and the per-phase field values.

## Self-Check: PASSED

- FOUND: `src/skills/defaultSkill.ts` (modified, Task 1)
- FOUND: `scripts/verify-phase-30.ts` (modified, Task 2)
- FOUND: `.planning/phases/31-pipeline-callback-refactor/31-01-SUMMARY.md` (created)
- FOUND: commit `47cc72d` (Task 1 — refactor: inline phase_taxonomy)
- FOUND: commit `1b10ed7` (Task 2 — refactor: patch verify-phase-30.ts)
- Cross-file grep `grep -cE "REVIEW_REQUIRED_PHASES|PHASE_INGEST_MAP|PHASE_ORDER" src/skills/defaultSkill.ts scripts/verify-phase-30.ts` returns 0 for both files
- `npx tsx scripts/verify-phase-30.ts` exits 0 with 61 passed / 0 failed

---
*Phase: 31-pipeline-callback-refactor*
*Completed: 2026-06-15*
