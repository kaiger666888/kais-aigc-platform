---
phase: 50-historical-backfill-contract-guards
plan: 02
subsystem: asset-ingest
tags: [contract-tests, verify-gate, guard, candidate-grouping, backfill-idempotency, vocabulary-no-drift, deprecation, v2.1-milestone-close]
requires:
  - "scripts/backfill-candidate-groups.ts planBackfill/applyBackfill (50-01 — driven, never copied)"
  - "src/lib/candidateGrouping.ts planGroups + src/lib/ingestAssets.ts ingestImagesPayload (Phase 48)"
  - "src/lib/assetTypes.ts CANONICAL_ASSET_TYPES / LEGACY_ASSET_TYPE_ALIASES / expandTypesForQuery"
  - "scripts/fixtures/phase48-p11-manifest.fixture.json (GUARD-01 fixture)"
provides:
  - "scripts/verify-phase-50.ts — 104-assertion milestone gate: GUARD-01 contract group + GUARD-02 aggregate (idempotency / red line / no-drift / spot invariants / SC-4 WARN)"
  - "npm run verify:phase-50 — final gate of the v2.0→v2.1 verify tradition"
  - "D-12: five manual register_*.py scripts deprecated with Phase 48 ingest-route pointers (kept as historical evidence, none deleted)"
  - "backfill-candidate-groups.ts archival record (applied-and-archived annotation with headline numbers)"
affects:
  - "CI/verify tradition: verify:phase-50 joins the phase-48/49 gate set as the v2.1 close-out check"
  - "kmc / review-platform SC-4 consumer-side debt — still deferred (WARN only, D-11)"
tech-stack:
  added: []
  patterns:
    - "contract guard = import-identity: the verify suite drives the REAL planBackfill/applyBackfill/ingestImagesPayload on :memory: databases — zero logic copies, zero production-DB references"
    - "aggregate gate without re-running sibling gates: Phase 48/49 covered by existence + identifier spot assertions (D-09④), keeping one maintainable verify script"
    - "forced-failure sanity as the anti-vacuous-pass proof (T-50-06): flip one expectation → exit 1 FAIL → restore → green"
key-files:
  created:
    - scripts/verify-phase-50.ts
  modified:
    - package.json
    - scripts/backfill-candidate-groups.ts
    - scripts/canvas/register_turnaround_b2.py
    - scripts/canvas/register_character_design.py
    - scripts/canvas/register_turnaround_costume.py
    - scripts/canvas/register_storyboard_sheets.py
    - scripts/canvas/register-scene-refs.py
key-decisions:
  - "GUARD-01 uses the full 17-image Part-2 batch asserting 6 groups with the 4 shot: manifest keys as a SUBSET (checker BL-2) — not the 4-group manifest-only variant in the behavior sketch"
  - "Section 2 seed pair uses a plain-named duplicate file (twin_ref.png) so no accidental third single-variant group forms — keeps the contracted groups=2 exactly countable"
  - "SC-4 stays a no-assertion WARN line pointing at 49-HUMAN-UAT G-1 (D-11: cross-repo debt out of scope)"
requirements-completed: [GUARD-01, GUARD-02]
duration: 4 min
completed: 2026-08-19
---

# Phase 50 Plan 02: GUARD Contract Suite + verify:phase-50 + D-12 Deprecation Summary

**One-liner:** v2.1 milestone locked behind a 104-assertion `verify:phase-50` gate — GUARD-01 formalizes the Phase 48 fixture→planGroups→landed o_assets contract (6 groups, exactly-one primary, assetsId self-consistency), GUARD-02 aggregates backfill idempotency (apply 11/11 → re-plan 0 diffs → re-apply 0 updates) with the D-05 eliminated-row red line, D-04 meta/meta.provenance phase priority, dual-side enum no-drift by import identity, Phase 48/49 spot invariants and the SC-4 WARN — plus D-12 deprecation headers on all five manual register scripts and the applied-and-archived backfill record.

## Performance

- **Duration:** 4 min
- **Started:** 2026-08-19T10:39:18Z
- **Completed:** 2026-08-19T10:44:15Z
- **Tasks:** 2
- **Files:** 8 (1 created, 7 modified)

## Milestone Status — v2.1 COMPLETE

This was the final plan of the v2.0→v2.1 milestone. All three phases green:
**48 ✓ (ingest candidate grouping + enum unification) 49 ✓ (selection write-back + asset-center linkage) 50 ✓ (historical backfill + contract guards).**
All five milestone gates exit 0: `verify:phase-48`, `verify:phase-49`, `verify:phase-49-bridge`, `verify:phase-49-linkage`, `verify:phase-50` (104/104).

## Task Commits

1. **Task 1: scripts/verify-phase-50.ts (GUARD-01 + GUARD-02) + npm registration** — `ef12a059` (test)
2. **Task 2: D-12 deprecation headers ×5 + backfill archival annotation** — `42aaf7eb` (chore)

## Files Created/Modified

- `scripts/verify-phase-50.ts` — five sections + WARN: (1) GUARD-01 plan-level (17-image batch → 6 groups, 4 shot: keys subset, selected_first/last_variant honored, per-group single member primary) + landed shape via REAL `ingestImagesPayload` on `:memory:` (per-group exactly-one isPrimaryView=1 = planned primary, primary assetsId NULL, member linkage self-consistency, state domain all-active, workflow_phase='p11' on all 10 manifest rows); (2) seeded 13-row stock → REAL `planBackfill`/`applyBackfill` (11/11 executed, 0-diff re-plan, 0-update re-apply, eliminated row byte-untouched, meta 'p05_x'→p05 beats /p07/ path, nested meta.provenance 'p10_voice'→p10 on underivable path, no-signal stays NULL, duplicate pair skipped+reported+still ungrouped); (3) no-drift by identity (registry `z.enum(CANONICAL_ASSET_TYPES)` + truth-source imports, no inline role/tool enum in ingest route, alias table no orphans bidirectionally via expandTypesForQuery); (4) spot invariants (7 file existence + 5 identifier checks incl. `void resolveOpenReviewForSelection(` / `syncAssetPrimaryForWinner` / `selectWinnerInGroup` / `applyRegistrySelectionToCanvas`); (5) exactly one `[WARN]` SC-4 line. `:memory:` only (zero `db2.sqlite` occurrences), pools destroyed, no app-server import.
- `package.json` — `"verify:phase-50": "npx tsx scripts/verify-phase-50.ts"` directly after verify:phase-49-linkage (D-10).
- `scripts/backfill-candidate-groups.ts` — ONE-OFF header extended with the applied-and-archived record (538/538 + 0/0 re-run, 154 groups / 240 links / 534 wf values, 386 eliminated untouched, backup filename, 3 audit txt pointers); comment-only, no code path touched.
- 5 × `scripts/canvas/register_*.py` — `[DEPRECATED — Phase 50, 2026-08-19]` headers after the shebang pointing at `POST /api/v1/pipeline/ingest/images`; comment-only insertions, py_compile clean, files kept (D-12).

## Verification Evidence

- `npx tsc --noEmit` → exit 0
- `npm run verify:phase-50` → exit 0, `=== Summary: 104/104 assertions passed ===` + PASSED verdict, zero FAIL, exactly one `[WARN]` line, GUARD-01 banner present
- Forced-failure sanity: flipped Section 1(b) `isPrimaryView=1` count 6→7 → exit 1 with `FAIL: exactly 6 isPrimaryView=1 rows…` and `103/104`; restored → green again (T-50-06 proof the gate can fail)
- Cross-gate regression: `verify:phase-48` / `verify:phase-49` / `verify:phase-49-bridge` / `verify:phase-49-linkage` all exit 0
- `grep -c 'db2.sqlite' scripts/verify-phase-50.ts` → 0; `grep -c 'planBackfill\|applyBackfill'` → 6; package.json entry grep → 1
- Task 2: each script `head -8 | grep -c 'DEPRECATED — Phase 50'` → 1, route substring present, `python3 -m py_compile` PY-OK, `git diff --stat` insertions-only (54 insertions, 0 deletions), all five still on disk

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Section 2 seed initially produced 3 groups instead of the contracted 2**
- **Found during:** Task 1, first verify run (2 FAILs: groups=3, promotions=2)
- **Issue:** The duplicate-path pair was seeded as `board_v1.png`×2 next to a unique `board_v2.png` sibling; the lone `_v2` file forms its own single-variant group (production behavior proven by 50-01: "33 single-variant groups whose lone row became its own primary"), so the seed contradicted the plan's contracted `groups=2` / `1 promotion` expectations.
- **Fix:** Re-seeded the duplicate pair as a plain-named file (`/oss/1/p09/boards/twin_ref.png`×2, no variant sibling). Grouping target numbers re-derived and asserted exactly (11 diff rows, 5 assetsId writes, 1 promotion, wf split 2 meta / 9 path / 1 underivable, 3 standalone).
- **Files modified:** scripts/verify-phase-50.ts
- **Verification:** 104/104 green; duplicate-pair still skipped+reported+ungrouped after apply
- **Committed in:** ef12a059

---

**Total deviations:** 1 auto-fixed (seed-construction bug)
**Impact:** None on production or contract semantics — assertion expectations now match the real backfill behavior exactly.

## TDD Adaptation (Task 1 tdd="true")

The features under test already exist (Phase 48 contract layer + 50-01 backfill core); this plan formalizes them, so the suite is GREEN by construction on a correct codebase. The RED capability — the gate's power to fail — is proven by the mandated forced-failure sanity (flip Section 1(b) expectation → exit 1 + FAIL line → restore → green), recorded above. This mirrors the 48-01/50-01 adaptation and mitigates T-50-06 (vacuous pass).

## Issues Encountered

None.

## Authentication Gates

None.

## Known Stubs

None — every assertion drives real modules; the single WARN is an intentional no-assertion debt notice per D-11, not a stub.

## Threat Flags

None beyond the plan's threat model — all four register mitigations landed: T-50-05 (`:memory:` only, zero production-DB path strings, pools destroyed), T-50-06 (forced-failure sanity + printed count), T-50-07 (py_compile + insertions-only diff), T-50-SC (zero new packages).

## Next Phase Readiness

**v2.1 milestone complete: 48 ✓ 49 ✓ 50 ✓** — milestone-close tooling can pick this up. Historical stock now matches the Phase 48 ingest shape and is locked behind `verify:phase-50`; the only registered follow-up debt is the cross-repo SC-4 consumer-side half-loop (49-HUMAN-UAT G-1, deferred).

## Self-Check: PASSED

- Files exist: scripts/verify-phase-50.ts ✓, 5 register scripts ✓ (all present on disk), backfill-candidate-groups.ts ✓
- Commits found: ef12a059 ✓, 42aaf7eb ✓
- `npx tsc --noEmit` exit 0 ✓; `npm run verify:phase-50` exit 0 (104/104) ✓; package.json entry ✓
