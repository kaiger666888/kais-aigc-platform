---
phase: 47
slug: historical-backfill-archival
status: passed
verified: 2026-07-16
verifier: inline (Claude Code orchestrator, no subagent)
requirements_verified: [BACKFILL-01, BACKFILL-03]
requirements_deferred: [BACKFILL-02]
score: 2/3 verified + 1 deferred (manual sampling)
must_haves_total: 3
must_haves_verified: 2
must_haves_deferred: 1
---

# Phase 47 — Verification Report

## Goal

> Run the existing backfill script to repair historical empty-shell
> asset nodes; verify P04/P07/P08 panels show real content; archive
> the script as a one-off.

## Status: PASSED (2/3 verified + 1 deferred to operator)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| BACKFILL-01 — `--apply` runs successfully + significant reduction | ✓ Verified | 591 rows changed; empty-shell count 417 → 160 (61% reduction; threshold was <50%). Backup + audit trail in place. |
| BACKFILL-02 — manual sampling P04/P07/P08 panels | ⏸ Deferred | Manual browser inspection required; checklist below waits for operator sign-off |
| BACKFILL-03 — script archived with deprecation header | ✓ Verified | `git mv` to `scripts/oneoffs/`; `[DEPRECATED` header prepended; README convention documented; `verify:phase-47-backfill` 6/6 green |

## Verification Artifacts

- `npm run verify:phase-47-backfill` — 6 assertions pass, exit 0
- `npm run verify:phase-46-contracts` — 62 assertions still pass (no regression from DB mutation)
- Phase 44/45 regression: 41/41 + 13/13 still pass
- `npx tsc --noEmit` — 3 pre-existing errors, 0 new
- 3 atomic commits across 2 waves (1 tracking + 2 code/data)

## Apply Outcome Detail

### What was repaired
- **Total asset nodes scanned:** 751
- **Already complete (truly):** 0 (the script's `already_complete` counter is buggy; see "Reporting bug" below)
- **Changed:** 591
  - `description→prompt` mirror: 328 (description existed, prompt didn't)
  - `synthesize`: 257 (both empty, provenance signal available)
  - `params.*` flatten: 6 (params dict had fields not yet promoted to top-level)
- **No signal (actually unrepairable):** 160 (only `label` present; `mint_description` returned None)

### Reduction analysis
- Pre-planning snapshot (2026-07-16): 417 empty-shell asset nodes
- Post-apply count: 160 empty-shells
- **Reduction: 61%** (threshold was <50% of baseline)
- PASS

### The 160 unrepairable nodes

Keyset: `['assetId', 'assetType', 'label', 'uuid']` (157 of 160 have
label; 3 are even sparser). No archetype/role, no scene_id, no
filename/name, no output_key. These are scaffolding-only nodes from
the earliest canvas imports, predating even the basic structured-param
convention.

## Notable deviations from PLAN

1. **Script reporting bug discovered.** The dry-run output claimed
   `Already complete: 160` + `No signal: 0`. The actual reality:
   - The `no_signal` counter on `backfill-asset-descriptions.py:144`
     is unreachable in practice because successful synthesize always
     appends an action AND failed synthesize leaves `actions` empty,
     falling through to `already_complete`.
   - The DATA outcome is correct: 257 empty-shells with signal were
     repaired; 160 empty-shells without signal were correctly skipped.
   - Only the reporting label is wrong. Documented inline in the
     archived script's deprecation header.

2. **Pre-apply backup is gitignored.** 328MB binary file; the repo's
   gitignore correctly excludes it. The audit trail (3 .txt files in
   `.planning/phases/47-...`) IS committed, so the backup's
   existence + path is auditable even though the file itself isn't
   in version control.

## ⏸ Manual Sampling Checklist (BACKFILL-02) — operator sign-off

> **Status:** awaiting operator. Phase 47 + v2.0 milestone close
> recommend completing this checklist first, but the automated
> regression gate is in place either way.

**Setup:**
```bash
npm run dev  # in one terminal
# open browser to canvas UI (typically http://localhost:5173)
# load project 1 (the backfill target)
```

**For each of P04, P07, P08:**
1. Type the phase prefix (e.g. `P04`) into the Phase 45 toolbar search
   filter
2. Canvas narrows to matching nodes
3. Click 10 visible nodes, one at a time
4. For each: confirm NodeDetailPanel's 描述 (description) section
   shows meaningful text (≥20 chars, not a bare label echo)
5. Record pass/fail per node below

**Sign-off template** (fill in):

```markdown
### P04 (character design — target 10 nodes)
Sampled: <date> by <operator>
| Node ID | Pass? | Description text (first 50 chars) |
|---------|-------|----------------------------------|
| ... | ✓/✗ | ... |

P04 pass rate: N/10

### P07 (scene generation — target 10 nodes)
...

### P08 (scene selection — target 10 nodes)
...

**Overall:** <all-pass / mixed / failed>
**Action:** <sign off / investigate failures / open follow-up>
```

**Pass criteria:** ≥ 8 of 10 sampled nodes per phase show meaningful
description (≥20 chars, not bare label echo).

## Forward Enables

- **v2.0 milestone close**: with Phase 47 done, all 6 phases shipped,
  all 24+ requirements met (or explicitly deferred with rationale).
- **Regression prevention**: `verify:phase-46-contracts` +
  `verify:phase-47-backfill` together form a 68-assertion gate that
  catches future contract drift + ensures archival integrity.
- **One-shot integrity**: the archived backfill script's
  `[DEPRECATED]` header + `scripts/oneoffs/README.md` +
  `verify:phase-47-backfill` assertion that original path is gone —
  three layers of protection against accidental re-run.

## ⚠ Open items (deferred, non-blocking)

1. **BACKFILL-02 manual sampling** — operator should fill in the
   checklist above before declaring v2.0 fully closed at the
   creative-team level.
2. **160 unrepairable nodes** — could be addressed in a future phase
   that mints descriptions from `label` + `assetType`. Out of v2.0
   scope.
3. **CI integration** — `verify:phase-46-contracts` +
   `verify:phase-47-backfill` are CI-safe; future DevOps task to wire
   them into a GitHub Actions / similar workflow.
4. **Cross-project backfill runbook** — only the dev DB was repaired;
   production deployments would need their own runbook.
