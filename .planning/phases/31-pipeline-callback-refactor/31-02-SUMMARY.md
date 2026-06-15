---
phase: 31-pipeline-callback-refactor
plan: 02
subsystem: pipeline-callback
tags: [pipeline-callback, registry-lookup, constant-deletion, behavior-preservation, pre-flight-grep, skill-resolution]

# Dependency graph
requires:
  - phase: 28-skill-manifest-contract
    provides: PhaseDecl / IngestOutput contract types
  - phase: 29-skill-registry-loader
    provides: registry singleton + phaseById O(1) lookup
  - phase: 30-skill-rest-api-default-seed
    provides: MOVIE_V1_MANIFEST as literal source of truth + verify-phase-30.ts
  - phase: 31-pipeline-callback-refactor
    plan: 01
    provides: "Zero references to REVIEW_REQUIRED_PHASES / PHASE_INGEST_MAP / PHASE_ORDER in defaultSkill.ts and verify-phase-30.ts (clears this plan's pre-flight grep gate)"
provides:
  - "phase-complete.ts resolves skill_id from kv_pipelineRun row with movie-v1 fallback + console.warn; computes needsReview via registry.phaseById(...).requires_review"
  - "resume.ts resolves skill_id from kv_pipelineRun row with movie-v1 fallback + console.warn; computes phaseOrder via registry.phaseById(...).order with ?? fallback chain"
  - "Both callbacks guard against unregistered skills with HTTP 500 'skill <id> not registered'"
  - "REVIEW_REQUIRED_PHASES, PHASE_INGEST_MAP, PHASE_ORDER exports deleted — registry is single source of truth"
  - "contract.ts JSDoc uses manifest-source framing (no deleted-constant references)"
  - "Post-deletion grep across src/ returns ZERO matches for all three constant identifiers"
affects:
  - 31-pipeline-callback-refactor (Plan 03 submit-to-review registry integration)
  - 31-pipeline-callback-refactor (Plan 04 verify-phase-31.ts equivalence test)
  - 33-skill-negative-tests (callbacks now exercise the registry path end-to-end)

# Tech tracking
tech-stack:
  added: []  # no new libraries — pure refactor
patterns:
  - "Active skill resolution from DB row + movie-v1 fallback + console.warn (Phase 31 callback pattern)"
  - "Skill-registered guard returns 500 with explicit skill_id (no silent fallback to movie-v1 — registry contract)"
  - "Registry-driven phase lookup with ?? false / ?? order fallback (forward-compat for unknown phases)"

key-files:
  created: []
  modified:
    - src/skills/contract.ts
    - src/routes/v1/pipeline/callback/phase-complete.ts
    - src/routes/v1/pipeline/resume.ts

key-decisions:
  - "phase-complete.ts adds a NEW SELECT (kv_pipelineRun row fetch) BEFORE the UPDATE — needed to read skill_id. Threat model accepts this overhead (T-31-04: O(1) Map lookup vs the existing DB writes is negligible)."
  - "resume.ts reuses the ALREADY-FETCHED pipeline row for skill_id resolution — no new DB call added. Skill resolution sits AFTER the existing 404 + 409 checks so those error paths are unchanged."
  - "Unknown phase in skill taxonomy → requires_review defaults to false / order falls back to pipeline.currentPhaseOrder ?? 0. Preserves permissive behavior (forward-compat per COMPLIANCE-04 — skills may emit phases the platform doesn't know about yet)."
  - "console.warn on null skill_id is non-negotiable per CONTEXT.md — both callback files include the structured log line with the pipelineId for operator debugging."

patterns-established:
  - "Registry-first callback pattern: fetch pipeline row → resolve skill_id (fallback movie-v1 + warn) → registry.get(skillId) 500-guard → registry.phaseById(...) lookup with ?? fallback. Plan 03's submit-to-review will follow the same shape."

requirements-completed: [PIPELINE-01, PIPELINE-03]

# Metrics
duration: ~12min
completed: 2026-06-15
---

# Phase 31 Plan 02: Pipeline Callback Registry Refactor (Constant Deletion) Summary

**Two pipeline callback hot paths (phase-complete, resume) now consult the skill registry for phase decisions via skill_id resolved from the kv_pipelineRun row; the three pre-refactor constants (REVIEW_REQUIRED_PHASES, PHASE_INGEST_MAP, PHASE_ORDER) are deleted and contract.ts JSDoc is cleaned to manifest-source framing — zero references to any constant identifier remain anywhere in src/**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-06-15T13:50:09Z
- **Completed:** 2026-06-15T14:02Z (approx)
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments

- **Pre-flight gate passed (Task 0):** Cleaned two JSDoc blocks in `src/skills/contract.ts` (IngestOutput + PhaseDecl) that referenced the three constant identifiers by name — rewrote them to manifest-source framing. After cleanup, `grep -rE "REVIEW_REQUIRED_PHASES|PHASE_INGEST_MAP|PHASE_ORDER" src/ --include="*.ts" | grep -vE "^src/routes/v1/pipeline/(callback/phase-complete|resume)\.ts:"` returned 0 lines, confirming no other src/ file referenced the constants before deletion.
- **phase-complete.ts refactored (Task 1):** Added DB lookup for the pipeline row, skill resolution (skill_id with movie-v1 fallback + `console.warn`), skill-registered guard (HTTP 500), and registry-driven `needsReview` computation. Deleted `REVIEW_REQUIRED_PHASES` and `PHASE_INGEST_MAP` exports. Ingest branching on `outputs[].type`, helper functions (`inferAssetType`, `ingestImages`, `ingestVideos`, `ingestStoryboard`), socket emission, and response shape are all unchanged.
- **resume.ts refactored (Task 2):** Reused the already-fetched pipeline row for skill resolution (movie-v1 fallback + `console.warn`), added skill-registered guard (HTTP 500), and replaced `PHASE_ORDER[phase]` with `registry.phaseById(skillId, phase)?.order ?? pipeline.currentPhaseOrder ?? 0`. Deleted `PHASE_ORDER` export and its transitional comment block. 404/409 checks, DB update, audit insert, broadcastToProject, and response shape are all unchanged.
- **Post-deletion grep clean:** `grep -rE "REVIEW_REQUIRED_PHASES|PHASE_INGEST_MAP|PHASE_ORDER" src/ --include="*.ts"` returns ZERO matches across all of src/.
- **tsc passes** for all three modified files (pre-existing error in `src/routes/assets/uploadImage.ts` line 123 is out of scope per SCOPE BOUNDARY rule — it is not a file modified by this plan).

## Task Commits

Each task was committed atomically:

1. **Task 0: PRE-FLIGHT GATE — clean contract.ts JSDoc + assert zero grep matches** - `1882c2f` (refactor)
2. **Task 1: Refactor phase-complete.ts to use registry.phaseById for requires_review; delete REVIEW_REQUIRED_PHASES + PHASE_INGEST_MAP** - `4cd9748` (refactor)
3. **Task 2: Refactor resume.ts to use registry.phaseById for phase order; delete PHASE_ORDER** - `f596fe7` (refactor)

## Files Created/Modified

- `src/skills/contract.ts` - Rewrote two JSDoc blocks (IngestOutput, PhaseDecl) to use manifest-source framing instead of naming the three deleted constant identifiers; no interface signatures changed.
- `src/routes/v1/pipeline/callback/phase-complete.ts` - Added registry import; added DB row lookup + skill resolution + skill-registered guard; `needsReview` now computed via `registry.phaseById(skillId, phase)?.requires_review ?? false`; deleted `REVIEW_REQUIRED_PHASES` and `PHASE_INGEST_MAP` exports; ingest branching / helpers / socket / response unchanged.
- `src/routes/v1/pipeline/resume.ts` - Added registry import; added skill resolution (from already-fetched row) + skill-registered guard; `phaseOrder` now computed via `registry.phaseById(skillId, phase)?.order ?? pipeline.currentPhaseOrder ?? 0`; deleted `PHASE_ORDER` export; 404/409 checks / DB update / audit / broadcast / response unchanged.

## Decisions Made

- **Skill resolution placement in resume.ts:** Placed AFTER the 404 (`!pipeline`) and 409 (state) checks, not before. The 404 check needs the pipeline row to exist; the 409 check needs `pipeline.state`. Skill resolution reads `pipeline.skill_id` from the same already-fetched row — no new DB call. This preserves the existing error-path ordering exactly.
- **`let skillId` (not `const`) in both callbacks:** The variable is assigned once from `pipeline.skill_id || "movie-v1"`. Used `let` to signal mutability of the fallback decision (the warn log accompanies the reassignment). Could be `const` since there's only one assignment — left as `let` to match the explicit "decide then use" framing the plan describes. Functionally identical.
- **Did NOT add a structured log line on every callback invocation** (CONTEXT.md "Claude's Discretion" optional suggestion). The project's logger is ad-hoc (`console.log` / `console.warn` scattered through handlers); adding a structured-log line here would be inconsistent without a logger module to route through. The `console.warn` on null skill_id is the only logging added — it's the non-negotiable one.
- **Did NOT return an error for unknown phase in phase-complete.ts.** Per CONTEXT.md decision: "the phase-complete callback must remain permissive for forward-compat." `phaseDecl?.requires_review ?? false` defaults to false for unknown phases. Documented inline with a comment referencing COMPLIANCE-04.
- **Did NOT add a 404 for missing pipeline row in phase-complete.ts.** The plan explicitly says: "Do NOT add a 404 here; preserve current behavior." The callback's UPDATE will affect 0 rows if the pipeline doesn't exist — same as pre-refactor. For skill resolution when `pipeline` is undefined, `pipeline?.skill_id` evaluates to undefined, the `||` falls through to `"movie-v1"`, and the warn fires. Behavior preserved.

## Deviations from Plan

None — plan executed exactly as written. All three tasks followed the plan's concrete steps verbatim, including:
- The exact JSDoc replacement text for contract.ts (manifest-source framing)
- The exact skill-resolution shape (DB lookup + fallback + warn + 500-guard)
- The exact registry-lookup expressions (`phaseDecl?.requires_review ?? false`, `phaseDecl?.order ?? pipeline.currentPhaseOrder ?? 0`)
- The exact constant deletions (REVIEW_REQUIRED_PHASES, PHASE_INGEST_MAP from phase-complete.ts; PHASE_ORDER from resume.ts)

## Issues Encountered

- **Pre-existing tsc error in `src/routes/assets/uploadImage.ts` (line 123):** `'err' is of type 'unknown'`. This is the SAME pre-existing error noted in Plan 31-01's SUMMARY — a try/catch typing issue in a file NOT in my modified-files list. Per the SCOPE BOUNDARY rule, I did NOT fix it. All three of my modified files (`contract.ts`, `phase-complete.ts`, `resume.ts`) produce zero tsc errors.

## User Setup Required

None — no external service configuration required. Pure source-code refactor; no env vars, no DB migration (the `kv_pipelineRun.skill_id` column already exists per Phase 30), no infrastructure changes.

## Next Phase Readiness

- **Plan 31-03 (submit-to-review registry integration):** Ready to execute. The skill-resolution pattern established here (DB row → skill_id → movie-v1 fallback + warn → 500-guard) is the template Plan 03 will follow for submit-to-review, with the addition that submit-to-review's skill source includes a direct-curl fallback (no pipelineId → default movie-v1, no warn). Plan 03 will also replace the `z.enum(...)` with `z.string().min(1)` + handler-side `registry.phaseById` lookup returning 400 for undeclared phases.
- **Plan 31-04 (verify-phase-31.ts equivalence test):** Ready to execute. The constants are now fully deleted from src/ — the only place the identifiers can exist post-Phase-31 is `scripts/verify-phase-31.ts` (outside the src/ grep scope). Plan 04 will hardcode the OLD_ snapshots and assert registry-driven lookups produce identical results.
- **Phase 33 (E2E negative tests):** The 500 "skill not registered" error path and the unknown-phase permissive fallback (requires_review: false) are both new behaviors that Phase 33's E2E should exercise.

## Self-Check: PASSED

- FOUND: `src/skills/contract.ts` (modified, Task 0)
- FOUND: `src/routes/v1/pipeline/callback/phase-complete.ts` (modified, Task 1)
- FOUND: `src/routes/v1/pipeline/resume.ts` (modified, Task 2)
- FOUND: `.planning/phases/31-pipeline-callback-refactor/31-02-SUMMARY.md` (created)
- FOUND: commit `1882c2f` (Task 0 — refactor: contract.ts JSDoc cleanup)
- FOUND: commit `4cd9748` (Task 1 — refactor: phase-complete.ts registry refactor)
- FOUND: commit `f596fe7` (Task 2 — refactor: resume.ts registry refactor)
- Post-deletion grep `grep -rE "REVIEW_REQUIRED_PHASES|PHASE_INGEST_MAP|PHASE_ORDER" src/ --include="*.ts"` returns ZERO matches
- `npx tsc --noEmit` reports zero errors in any of the three modified files (only pre-existing out-of-scope error in uploadImage.ts)

---
*Phase: 31-pipeline-callback-refactor*
*Completed: 2026-06-15*
