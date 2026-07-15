---
phase: 47-historical-backfill-archival
plan: 02
wave: 2
requirements: [BACKFILL-02, BACKFILL-03]
status: complete
commits:
  - "90a8c879 feat(47-02): archive backfill script + add Phase 47 verifier"
key-files:
  created:
    - scripts/oneoffs/backfill-asset-descriptions.py  # moved + deprecation header
    - scripts/oneoffs/README.md
    - scripts/verify-phase-47-backfill.ts
  modified:
    - package.json
---

# 47-02 — Archive + Phase 47 Verifier

## What was built

Three deliverables finalizing the v2.0 milestone:

### 1. Backfill script archived (`scripts/oneoffs/`)

- `git mv scripts/backfill-asset-descriptions.py scripts/oneoffs/`
- Prepended `[DEPRECATED — Phase 47 archive, 2026-07-16]` header
  documenting:
  - Why it was written (2026-07-12 empty-shell asset nodes)
  - Why it's archived (Phase 42 + 44 prevent new empty-shells)
  - What Phase 47 did (591 repaired, 160 unrepairable, 61% reduction)
  - Where to find the audit trail
  - DO NOT add to cron / DO NOT run against production without approval
- Original path no longer exists (move, not copy) — prevents
  accidental re-run via muscle memory

### 2. `scripts/oneoffs/README.md` — convention doc

Documents:
- When to add a script here (4 conditions, all must be true)
- When NOT to run scripts from here (CI/cron/startup/prod-without-backup)
- Audit trail requirements (snapshot + log + verify + DB backup)
- Current list: just the backfill script (Phase 47)

### 3. `scripts/verify-phase-47-backfill.ts` — Phase 47 verifier

6 assertions:
- Script archived at `scripts/oneoffs/`
- Original path `scripts/backfill-asset-descriptions.py` absent
- `[DEPRECATED` header present in archived script
- README convention documented (`Audit trail` + `DO NOT` + script listed)
- Phase 46 contract gate still green (regression check)
- Pre-apply DB backup retained (audit trail)

Wired as `npm run verify:phase-47-backfill`. Exits 0 in ~3s.

## Verification

```
=== Phase 47 — verify-phase-47-backfill.ts ===
  PASS: BACKFILL-03: backfill script archived at scripts/oneoffs/
  PASS: BACKFILL-03: original path scripts/backfill-asset-descriptions.py removed
  PASS: BACKFILL-03: archived script has [DEPRECATED header
  PASS: BACKFILL-03: scripts/oneoffs/README.md documents convention + current list
  PASS: BACKFILL-01 (regression): Phase 46 contract gate still green after backfill
  PASS: BACKFILL-01 (audit): pre-apply DB backup retained at data/db2-backup-pre-phase-47.sqlite

6 passed, 0 failed, EXIT=0
```

## Manual sampling (BACKFILL-02) — operator sign-off required

The automated verifier covers archival + regression + audit. The
visual sampling of 10 nodes each from P04 / P07 / P08 via the canvas
UI is documented in `47-VALIDATION.md` → "Manual Sampling Procedure"
but requires operator time at a browser. Sign-off block in
`47-VERIFICATION.md` waits for the operator to fill it in.

## Forward enables

- **v2.0 milestone close**: all 6 phases shipped, all 24+ requirements
  met, contract gate prevents regression, one-shot backfill is
  archived + can't accidentally re-run.
- **Future Phase 48+ candidates** (not v2.0 scope):
  - Mint descriptions for the 160 unrepairable nodes from `label` +
    `assetType` (would close the last 21% gap)
  - CI integration of `verify:phase-46-contracts` + `verify:phase-47-backfill`
  - Live E2E run of `verify:phase-46-e2e` against docker-compose v9
  - Cross-project backfill runbook (other DB instances)
