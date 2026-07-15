---
phase: 47-historical-backfill-archival
plan: 01
wave: 1
requirements: [BACKFILL-01]
status: complete
autonomous: false
commits:
  - "da6ff9c6 docs(47-01): capture pre-apply baseline snapshot"
  - "564cb350 feat(47-01): apply backfill + verify post-run state"
key-files:
  modified:
    - data/db2.sqlite  # 591 asset rows mutated
  created:
    - data/db2-backup-pre-phase-47.sqlite  # 328MB, gitignored
    - .planning/phases/47-historical-backfill-archival/baseline-snapshot.txt
    - .planning/phases/47-historical-backfill-archival/apply-log.txt
    - .planning/phases/47-historical-backfill-archival/post-run-verify.txt
---

# 47-01 — Backfill Apply (autonomous: false — DB mutation)

## What was done

Three sequential tasks against the live dev DB at `data/db2.sqlite`:

### Task 1: Pre-flight contract gate + baseline snapshot
- `npm run verify:phase-46-contracts` green (62 assertions, ~1.5s)
- Dry-run baseline captured: 751 total asset nodes, 591 would change, 0 no-signal-reported (bug; see below)
- Baseline committed to `.planning/phases/47-historical-backfill-archival/baseline-snapshot.txt`

### Task 2: Backup + apply (user-approved checkpoint)
- Backup: `cp data/db2.sqlite data/db2-backup-pre-phase-47.sqlite` (328MB, gitignored)
- Apply: `python3 scripts/backfill-asset-descriptions.py --apply` exited 0
- 591 asset rows mutated: 328 description→prompt mirroring + 257 synthesize + 6 params.* flatten
- Apply log committed to `.planning/phases/47-historical-backfill-archival/apply-log.txt`

### Task 3: Post-run verify
- Empty-shell count: 417 (pre-planning snapshot) → 160 (post-apply)
- Reduction: **61%** (threshold was <50% — PASS)
- 3 sample nodes inspected: all carry meaningful descriptions ≥20 chars

## Notable findings

### The script's reporting bug (cosmetic, not data-affecting)

The dry-run output reported `Already complete: 160` + `No signal: 0`.
The actual breakdown is:
- 591 nodes were genuinely repairable (description existed but prompt
  didn't, OR vice versa, OR both empty with provenance signal) → all
  repaired
- 160 nodes had NO useful provenance signal (only `label`, which
  `mint_description` doesn't use) → unrepairable, correctly returned
  None

The script's `if not actions: already_complete += 1` branch conflates
"truly complete" with "unrepairable" because failed `mint_description`
leaves the actions list empty. The `no_signal` counter on line 144 is
unreachable in practice (synthesize always sets prompt when it
succeeds). The DATA outcome is correct; only the reporting label is
misleading. Documented in 47-VERIFICATION.md.

### What the 160 unrepairable nodes look like

All 160 have keyset `['assetId', 'assetType', 'label', 'uuid']` (157
of 160 have `label`; the other 3 are even sparser). No archetype/role,
no scene_id, no filename/name, no output_key. These are pure
scaffolding nodes from the earliest canvas imports — predating even
the basic structured-param convention. Future Phase 48+ work could
mint descriptions from `label` + `assetType` (e.g. "P04 角色 · 小橘 ·
character turnaround") but that's beyond v2.0 scope.

## Verification

```
Pre-apply baseline:
  Total asset nodes: 751
  Already complete: 160
  Would change: 591
  No signal: 0 (bug; actually 160 unrepairable)

Post-apply:
  Empty-shell count: 160 (down from 417 — 61% reduction)
  Non-empty: 591 (up from 334)
  Sample descriptions: 27岁 3D美术师 温柔内敛 敏感细腻 L1-L4资产库 (28 chars)
                       78岁 退休教师 慈爱坚韧 轻度阿尔茨海默 奶奶形象
                       20代中期 时尚造型师 开朗健谈 性格直率 职场朋友

Audit trail:
  ✓ baseline-snapshot.txt (132 lines)
  ✓ apply-log.txt (apply output + EXIT=0)
  ✓ post-run-verify.txt (count + reduction analysis)
  ✓ data/db2-backup-pre-phase-47.sqlite (328MB, gitignored)
```

## Rollback procedure (if needed)

```bash
# Stop the dev server first to release DB locks
cp data/db2-backup-pre-phase-47.sqlite data/db2.sqlite
# Restart the dev server
```

The backup is byte-identical to the pre-apply state. No data loss
risk.

## Forward enables

- Plan 47-02 archives the script + adds the Phase 47 verifier
- v2.0 milestone can close once the manual sampling checklist is
  signed off
- The contract gate (Phase 42 + Phase 44) prevents new empty-shells
  going forward — this backfill is genuinely one-shot
