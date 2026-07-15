# scripts/oneoffs/ — archived one-shot scripts

Scripts in this directory are **archived one-off repairs**, not
maintained infrastructure. They're kept for audit and reproducibility.

## When to add a script here

A script belongs here when ALL of these are true:
- It was written to repair a specific historical data condition
- The underlying bug that produced the bad data has been fixed at the source
- Re-running the script on data that now satisfies the contract is
  unnecessary or harmful
- The script has a clear "DO NOT run on production without approval"
  semantic

## When NOT to run scripts from here

- As part of CI / cron / startup hooks
- On production data without explicit approval + DB backup
- On data that already satisfies the contract the script was
  designed to repair

## Audit trail requirements

Every archived one-off script MUST have accompanying artifacts in
`.planning/phases/<NN-...>/`:
- `baseline-snapshot.txt` — pre-apply dry-run output
- `apply-log.txt` — apply run output
- `post-run-verify.txt` — post-apply verification
- Pre-apply DB backup at `data/db2-backup-pre-phase-NN.sqlite` (gitignored by convention)

## Current one-offs

| Script | Archived | Reason | Phase |
|--------|----------|--------|-------|
| `backfill-asset-descriptions.py` | 2026-07-16 | Repaired 591 empty-shell asset nodes (417 empty-shells → 160 unrepairable; 61% reduction); Phase 42 hardened source-side contract; Phase 44 hardened receiver-side import; re-running would overwrite newer descriptions | Phase 47 |
