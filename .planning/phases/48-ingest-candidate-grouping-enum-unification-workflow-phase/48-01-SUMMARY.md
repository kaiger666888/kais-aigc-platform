---
phase: 48
plan: 01
subsystem: asset-ingest
tags: [assetTypes, candidate-grouping, ingest, enum-unification, workflow-phase]
requires:
  - "assets-registry z.enum vocabulary (src/routes/v1/assets-registry/index.ts:21)"
  - "kmc iframe-manifest.json shape (read-only, cross-repo)"
provides:
  - "src/lib/assetTypes.ts — o_assets.type 单一真值源 (normalize/expand + 13-value ingest input enum)"
  - "src/lib/candidateGrouping.ts — planGroups/parseVariantName/deriveWorkflowPhase pure contracts shared by Plan 48-02 route + Phase 50 backfill"
  - "scripts/fixtures/phase48-p11-manifest.fixture.json — Phase 50 GUARD-01 contract-test fixture"
  - "npm run verify:phase-48 — 64-assertion Part-1 gate (extensible at Part 2 marker)"
affects:
  - "Plan 48-02 (ingest route rewrite + registry compat imports from these modules)"
  - "Phase 50 GUARD-01 (re-ingests the fixture through the same planGroups)"
tech-stack:
  added: []
  patterns:
    - "truth source = single copy + consumers import (no inline enums)"
    - "pure lib module: data in → plans out, DB policy stays at service layer"
    - "verify-phase-N script + kmc-shape fixture as cross-phase contract test"
key-files:
  created:
    - src/lib/assetTypes.ts
    - src/lib/candidateGrouping.ts
    - scripts/fixtures/phase48-p11-manifest.fixture.json
    - scripts/verify-phase-48.ts
  modified:
    - package.json
key-decisions:
  - "manifest↔batch matching disambiguated by parent-dir+basename (kmc shot dirs repeat identical frame basenames); basename-only fallback only when the batch does not preserve shot dirs"
  - "resolution mode chosen per frame-list and applied exclusively — never mixed within one list, preventing cross-shot stealing on partial batches"
  - "D-05 state policy (active-only) deliberately NOT in candidateGrouping.ts — enforced at Plan 48-02 service layer"
requirements-completed: [INGEST-01, INGEST-02, INGEST-03, PHASE-01]
duration: 9 min
completed: 2026-08-19
---

# Phase 48 Plan 01: Ingest Contract Layer (assetType truth source + candidate grouping + workflow_phase) Summary

**One-liner:** Pure contract layer locking the o_assets.grouping engine — assetTypes.ts single truth source (11 canonical + role/tool aliases), candidateGrouping.ts dual-channel planGroups (manifest first, naming fallback, selected>canonical>v1 primary, shot-dir disambiguation) and never-guessing deriveWorkflowPhase, proven by a 64-assertion verify:phase-48 against a kmc-shape fixture.

## What Was Built

| Task | Deliverable | Commit |
|------|-------------|--------|
| 1 | `src/lib/assetTypes.ts` — CANONICAL_ASSET_TYPES (11 registry values value-for-value) + LEGACY_ASSET_TYPE_ALIASES (role→character, tool→prop) + INGEST_INPUT_ASSET_TYPES (13) + normalizeAssetType (unknown→null, never throws) + expandTypesForQuery (whereIn-safe passthrough) | 6c2c6314 |
| 2 | `src/lib/candidateGrouping.ts` — parseVariantName (`_v{N}`, canonical/`.1` legacy → null), planGroups (manifest channel first with 1-based selected_*_-variant primary + first-present fallback; naming channel canonical > lowest-variant; turnaround characterId + meta.subtype=turnaround_sheet; standalone passthrough), deriveWorkflowPhase (phase string word-boundary p{NN} → exact path segment p{NN}, lowercase zero-padded, null when underivable) | eed98f54, cd9d0379 |
| 3 | kmc-shape fixture (2 entries, selected_first_variant 1-based / null semantics) + `scripts/verify-phase-48.ts` (64 assertions, dynamic imports of the real modules, Part-2 placeholder for Plan 48-02) + `verify:phase-48` npm registration | 573a4ff9 |

## Verification Results

- `npx tsc --noEmit` → exit 0 (whole repo)
- `npm run verify:phase-48` → exit 0, **64/64 assertions PASSED** (INGEST-03 normalize/expand + registry-enum parity extracted from source, parseVariantName, manifest channel incl. partial batch + selected/fallback primaries, naming channel canonical/lowest-variant + characterId input-wins, manifest priority, standalone, PHASE-01 incl. all null cases)
- Forced-failure path validated: temporarily asserting a wrong primary → exit 1 with FAIL line; restored, re-verified green
- Cumulative diff across the 4 commits = exactly the 5 files in PLAN files_modified

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Manifest↔batch matching collapsed shots sharing identical frame basenames**
- **Found during:** Task 3 (verify run) — RED/GREEN loop
- **Issue:** Real kmc layout repeats frame basenames across shot dirs (`iframes_S01_B01/first_frame_v1.png` vs `iframes_S02_B01/first_frame_v1.png`). Basename-only matching (first-occurrence-wins) claimed S02_B01's frames as S01_B01's, skipped the S02 groups entirely, and leaked `name:first_frame` naming groups; on partial batches the basename fallback also stole a sibling shot's file.
- **Fix:** Resolve manifest paths by parent-dir+basename (`iframes_{shot}/{frame}`) whenever the batch preserves the manifest's shot dirs; resolution mode chosen per frame-list and applied exclusively (basename-only only when the directory layout doesn't match at all).
- **Files modified:** src/lib/candidateGrouping.ts
- **Commit:** cd9d0379

### Process Notes (not defects)

- **Per-task TDD adapted:** Tasks 1-2 carry `tdd="true"`, but the plan's file layout assigns the test harness (verify-phase-48.ts) to Task 3 and its `<verification>` forbids extra files. RED/GREEN was therefore honored at the plan level: Task 3's first run exposed a real grouping bug (62/64 → FAIL), fixed in the lib, re-run green — the fail-first property was demonstrated on the actual implementation, and the exit-1 path was additionally validated via a forced wrong assertion.
- **Concurrent repo activity:** An unrelated agent committed gpu-queue work (d874a6b6, fd420ff6, f397db79) and transiently modified `src/routes/production/*` files between this executor's commits, briefly breaking repo-wide `tsc` (baseline captured: 9 pre-existing TS2339 errors in files this plan never touched). Those errors were resolved by their author before final verification — final `tsc --noEmit` exits 0 with zero errors. No files from this plan were affected; all 4 commits staged only plan files.

## Authentication Gates

None.

## Known Stubs

None — all exports are real implementations; the only intentional placeholder is the `Part 2 (Plan 48-02)` comment marker in scripts/verify-phase-48.ts where the ingest-on-temp-sqlite section will extend the script.

## Threat Flags

None — no new trust-boundary surface beyond the plan's threat model (pure modules, no HTTP/DB/fs).

## Next Step

Ready for 48-02 (route rewrite + registry compat): import normalizeAssetType/expandTypesForQuery into assets-registry + pipeline/ingest/images, build the DB-writing ingestAssets service on planGroups/deriveWorkflowPhase (state='active' only per D-05), and extend verify-phase-48 at the Part 2 marker.

## Self-Check: PASSED

- Files exist: src/lib/assetTypes.ts ✓, src/lib/candidateGrouping.ts ✓, scripts/fixtures/phase48-p11-manifest.fixture.json ✓, scripts/verify-phase-48.ts ✓
- Commits found: 6c2c6314 ✓, eed98f54 ✓, 573a4ff9 ✓, cd9d0379 ✓
- `npm run verify:phase-48` exit 0 (64/64) ✓; `npx tsc --noEmit` exit 0 ✓; `grep -c verify:phase-48 package.json` = 1 ✓
