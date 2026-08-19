---
phase: 50-historical-backfill-contract-guards
plan: 01
subsystem: asset-ingest
tags: [backfill, candidate-grouping, o_assets, workflow-phase, sqlite, knex, one-off, audit-trail]
requires:
  - "src/lib/candidateGrouping.ts (Phase 48-01 planGroups/deriveWorkflowPhase pure contract layer)"
  - "src/lib/ingestAssets.ts (Phase 48-02 transaction + in-trx exactly-one-primary assertion pattern)"
  - "Phase 47 dry-run/--apply/--i-backed-up-db backfill convention (git history, scripts/canvas/oneoffs/)"
provides:
  - "scripts/backfill-candidate-groups.ts — exported planBackfill(db)/applyBackfill(db): Phase 50-02 verify drives these on :memory: databases"
  - "npm run backfill:phase-50 — dry-run-default, backup-gated one-off CLI"
  - "PRODUCTION data/db2.sqlite backfilled: 154 candidate groups, 240 member links, 534 workflow_phase values"
  - "committed audit trail: backfill-baseline-dryrun.txt / backfill-apply-log.txt / backfill-post-run-verify.txt"
affects:
  - "Phase 50-02 GUARD-01/GUARD-02 (verify:phase-50 imports planBackfill/applyBackfill for :memory: idempotency assertions)"
  - "asset-center /project/:id + variants read paths (now see grouped historical rows)"
  - "SC-4 kmc consumption half-loop (still deferred, 49-HUMAN-UAT)"
tech-stack:
  added: []
  patterns:
    - "dry-run default + --apply hard-gated on --i-backed-up-db + consistency-safe sqlite3 .backup BEFORE any write"
    - "diff-only plan (only actual value changes) => idempotency by construction, proven by 0/0 re-run"
    - "single-transaction bulk UPDATE with per-group in-trx assertion (exactly-one-primary + primary.state='active' WR-3 + member linkage) copied from ingestAssets"
    - "D-05 red line enforced twice: SELECT-level exclusion AND state != 'eliminated' inside every UPDATE; proven by 386-row byte-diff"
key-files:
  created:
    - scripts/backfill-candidate-groups.ts
    - .planning/phases/50-historical-backfill-contract-guards/backfill-baseline-dryrun.txt
    - .planning/phases/50-historical-backfill-contract-guards/backfill-apply-log.txt
    - .planning/phases/50-historical-backfill-contract-guards/backfill-post-run-verify.txt
  modified:
    - package.json
key-decisions:
  - "BL-1 fallback implemented: workflow_phase signal = meta.phase, falling back to nested meta.provenance.phase — 237 of 534 derived values came from meta (129 rows carry phase ONLY in provenance)"
  - "Pre-existing workflow_phase values (p04_turnaround, voice_design, ...) NEVER rewritten — idempotency mandate; backfill only writes normalized 2-digit forms"
  - "Duplicate filePaths within a project bucket skipped deterministically (47 rows / 18 paths) — no arbitrary twin pick; they still receive wf targets"
  - "154 groups formed: 121 with >=2 rows (240 members linked) + 33 single-variant groups whose lone row becomes its own primary"
requirements-completed: [INGEST-04, PHASE-02]
duration: 9 min
completed: 2026-08-19
---

# Phase 50 Plan 01: Historical Backfill (INGEST-04 + PHASE-02) Summary

**One-liner:** One-off gated backfill regrouped the 1612-row flat stock of o_assets via the Phase 48 pure contract layer — 154 candidate groups (240 members linked, exactly-one-active-primary each, 386 eliminated rows byte-untouched) and 534 workflow_phase values derived meta-first (237 meta.provenance-aware + 297 path) — applied to production db2.sqlite with a full dry-run → backup → single-transaction apply → proof-chain audit trail.

## Performance

- **Duration:** 9 min
- **Started:** 2026-08-19T10:26:26Z
- **Completed:** 2026-08-19T10:35:02Z
- **Tasks:** 2
- **Files modified:** 5 (1 script + package.json + 3 audit txt)

## Headline Before/After Numbers (v2.1 milestone-close evidence)

| Metric | Before | After | Delta |
|---|---|---|---|
| o_assets total | 1612 | 1612 | 0 |
| state='eliminated' (red line) | 386 | 386 | 0 — byte-identical pre/post snapshot diff |
| candidate groups | 0 (flat stock) | 154 formed | 121 multi-row + 33 single-variant |
| member rows with assetsId set | 0 | 240 | +240 |
| isPrimaryView=1 total | 768 | 710 | −61 demotions (31 convergence decisions) +3 promotions |
| workflow_phase NULL/empty | 1456 | 922 | **−534** (from meta: 237, from path: 297) |
| workflow_phase populated | 156 | 690 | +534, all normalized 2-digit forms |
| Planned/Executed (apply) | 538 / 0 (dry) | 538 / 538 | second apply: **0 / 0** (idempotent) |

Remaining 922 NULL = 327 eliminated (untouched by design) + 595 active underivable rows, itemized row-by-row in backfill-baseline-dryrun.txt (kais-movie-agent absolute paths, non-pipeline /oss/pipeline/* paths without a p{NN} segment, no-filePath-no-meta rows) — D-04/D-08: never guessed.

## Task Commits

1. **Task 1: Backfill script (planBackfill/applyBackfill + gated CLI) + npm registration** — `0f204cc9` (feat)
2. **Task 2: Production execution — baseline, backup, apply, red-line + idempotency proof** — `83b632b0` (test: audit trail + proof chain)

**Plan metadata:** (final docs commit below)

## Files Created/Modified

- `scripts/backfill-candidate-groups.ts` — ONE-OFF script: read-only planBackfill (per-project planGroups naming-channel reuse, duplicate-path skip, BL-1 meta.phase→meta.provenance.phase fallback, D-04 wf priority) + applyBackfill (single transaction, D-05 guard in every UPDATE, in-trx exactly-one-primary + WR-3 primary.state='active' + linkage assertions); CLI dry-run default, --apply gated on --i-backed-up-db (exit 1 + backup command before any write); runs only via `require.main === module` so Phase 50-02 importing it never touches production
- `package.json` — `backfill:phase-50` script entry
- `backfill-baseline-dryrun.txt` — pre-apply report (538 planned / 0 executed) + full underivable itemization
- `backfill-apply-log.txt` — apply log (538/538) + idempotency re-run section (0/0)
- `backfill-post-run-verify.txt` — headline numbers + all proofs (a)–(f)
- `data/db2-backup-pre-phase-50.sqlite` — created, gitignored, NOT committed (371,773,440 bytes = byte-scale of live DB)

## Decisions Made

- Naming channel only for grouping (planGroups without manifests): historical rows' kmc iframe-manifests were never persisted, so `*_v{N}` + canonical naming is the same — and only — family signal the online path would have used.
- Workflow_phase computed for EVERY active row (grouped, standalone, or no-filePath) with already-set rows skipped first; source attribution (meta vs path) via a secondary deriveWorkflowPhase(metaPhase, "") call.
- Backup via consistency-safe `sqlite3 .backup` (not raw cp) per plan Task 2 step 3, superseding the D-02 hint text.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Behavior-5 "/p04/ rows → only 'p04'" unsatisfiable as literally written**
- **Found during:** Task 2 step 5(d)
- **Issue:** DISTINCT workflow_phase over ALL /p04/-path rows returns 4 values (p04, p04_turnaround, p04_character_design, p09_shot_breakdown) — but 27 of those 38 rows carry PRE-EXISTING non-NULL raw values that the plan itself mandates NOT rewriting ("156 already carry values — NOT rewritten, idempotency"), and the backfill only ever writes normalized 2-digit forms.
- **Fix:** Verified against the pre-apply backup: PRE = {p04_turnaround 21, NULL 11, p04_character_design 4, p09_shot_breakdown 2}; POST = same 27 pre-existing values untouched + all 11 formerly-NULL rows now exactly 'p04'. Behavioral intent (every path-derived row carries the normalized phase) fully holds; /p07/→[p07] only, /p11/→[p11] only. Decomposition recorded in backfill-post-run-verify.txt §(d).
- **Files modified:** .planning/phases/50-historical-backfill-contract-guards/backfill-post-run-verify.txt
- **Verification:** backup-vs-live distribution query (committed in verify file)
- **Committed in:** 83b632b0

**2. [Rule 3 - Blocking] Plan's automated verify greps the apply log for "Executed updates: 0"**
- **Found during:** Task 2 step 5(e)
- **Issue:** The apply log ends with "Executed updates: 538"; the 0/0 idempotency evidence lived only in /tmp, so the plan's own verify command would grep 0 matches with no committed proof.
- **Fix:** Appended a marked "IDEMPOTENCY RE-RUN" section (command, exit 0, Planned changes: 0, Executed updates: 0) to backfill-apply-log.txt — staying within the plan's 3-file audit contract.
- **Files modified:** .planning/phases/50-historical-backfill-contract-guards/backfill-apply-log.txt
- **Verification:** grep -c "Executed updates: 0" apply-log → 1
- **Committed in:** 83b632b0

---

**Total deviations:** 2 auto-fixed (1 acceptance-conflict bug, 1 blocking)
**Impact:** Neither changes production writes; both make the mandated proof chain grep-able and honest.

## TDD Adaptation (Task 2 tdd="true")

The behaviors are properties of production data, so RED/GREEN ran as pre/post-apply SQL evidence instead of a unit harness (same adaptation as 48-01/48-02): RED captured pre-apply (wf NULL = 1456 fails "< 1456"; grouped members = 0), GREEN post-apply (922 / 240, all five behaviors PASS) — both recorded in backfill-post-run-verify.txt. Gate commits: test RED+GREEN evidence `83b632b0` follows feat `0f204cc9`.

## Issues Encountered

None — apply executed 538/538 in one transaction with zero assertion trips; no rollback, no partial state.

## Authentication Gates

None.

## Known Stubs

None — every path is a real implementation; no placeholder data introduced.

## Threat Flags

None beyond the plan's threat model — all five register mitigations landed: T-50-01 (dry-run default + gate + backup-before-write), T-50-02 (double red line + byte-diff proof), T-50-03 (committed audit trail), T-50-04 (diff-only + in-trx assertion + 0/0 re-run), T-50-SC (zero new packages).

## Next Phase Readiness

Plan 50-02 (GUARD-01 contract suite + GUARD-02 verify:phase-50) can import planBackfill/applyBackfill for its :memory: idempotency assertions — the module never self-executes (require.main guard). Historical stock now matches the Phase 48 ingest shape, so Phase 49 select-winner semantics cover old rows too.

## Self-Check: PASSED

- Files exist: script + 3 audit txt + SUMMARY ✓, package.json npm entry ✓
- Commits found: 0f204cc9 ✓, 83b632b0 ✓
- `npx tsc --noEmit` exit 0 ✓; final DB state member-is-primary = 0 ✓; backup gitignored ✓

