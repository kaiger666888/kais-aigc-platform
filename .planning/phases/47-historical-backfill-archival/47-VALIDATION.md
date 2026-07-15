---
phase: 47
slug: historical-backfill-archival
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-07-16
completed: 2026-07-16
---

# Phase 47 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
>
> Phase 47 is operational: it runs a one-shot DB mutation + archives
> the script + signs off on manual sampling. The verify structure
> follows Phase 46's safe-tier pattern (no docker in CI).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | None (standalone tsx verify script + Python backfill script) |
| **Config file** | none — scripts are self-contained |
| **Quick run command** | `npm run verify:phase-47-backfill` (after both plans land) |
| **Full suite command** | `npm run verify:phase-46-contracts && npm run verify:phase-47-backfill` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **Before apply (Plan 47-01 Task 1):** `verify:phase-46-contracts` must be green
- **After apply (Plan 47-01 Task 3):** post-run-verify.txt captures reduction analysis
- **After archival (Plan 47-02):** `verify:phase-47-backfill` confirms the contract + archival
- **Before v2.0 milestone close:** operator signs manual sampling checklist in 47-VERIFICATION.md

---

## Per-Task Verification Map

### Wave 1 (Plan 47-01 — backfill apply, autonomous: false)

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|--------|
| 47-01-01 | 01 | 1 | BACKFILL-01 | T-47-01 | Pre-flight contract gate green + dry-run baseline captured | integration (contract gate + dry-run) | `npm run verify:phase-46-contracts && python3 scripts/backfill-asset-descriptions.py` | ✅ green |
| 47-01-02 | 01 | 1 | BACKFILL-01 | T-47-05 | DB backup + apply run to completion | integration (DB backup + apply) | `cp data/db2.sqlite data/db2-backup-pre-phase-47.sqlite && python3 scripts/backfill-asset-descriptions.py --apply` | ✅ green |
| 47-01-03 | 01 | 1 | BACKFILL-01 | T-47-01 | Post-run empty-shell count < 50% of baseline | integration (SQL count + comparison) | `python3 -c "..."` (inline count + reduction analysis) | ✅ green |

### Wave 2 (Plan 47-02 — archival + manual sampling, autonomous: true)

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|--------|
| 47-02-01 | 02 | 2 | BACKFILL-03 | T-47-07 | Script moved to scripts/oneoffs/ with deprecation header | static (file existence + grep) | `! test -f scripts/backfill-asset-descriptions.py && head -2 scripts/oneoffs/backfill-asset-descriptions.py \| grep -q DEPRECATED` | ✅ green |
| 47-02-02 | 02 | 2 | BACKFILL-03 | T-47-08 | README documents one-off convention + audit trail | static (file existence + grep) | `test -f scripts/oneoffs/README.md && grep -q "Audit trail" scripts/oneoffs/README.md` | ✅ green |
| 47-02-03 | 02 | 2 | BACKFILL-01, BACKFILL-03 | T-47-09 | Phase 47 verifier: archival + contract gate + DB backup | integration (4-5 assertions + spawnSync Phase 46) | `npm run verify:phase-47-backfill` | ✅ green |

### Manual sampling (Plan 47-02 — operator sign-off, autonomous: false sub-step)

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|--------|
| 47-02-MANUAL | 02 | 2 | BACKFILL-02 | — | Visual inspection of 10 nodes each from P04 / P07 / P08 via Phase 45 search filter | manual (UI inspection) | (operator fills checklist in 47-VERIFICATION.md) | ⏸ deferred (manual; sign-off in 47-VERIFICATION.md) |

---

## Wave 0 Requirements

- [x] `data/db2-backup-pre-phase-47.sqlite` — pre-apply DB backup (Plan 47-01 Task 2)
- [x] `.planning/phases/47-historical-backfill-archival/baseline-snapshot.txt` — pre-apply dry-run capture (Plan 47-01 Task 1)
- [x] `.planning/phases/47-historical-backfill-archival/apply-log.txt` — apply run output (Plan 47-01 Task 2)
- [x] `.planning/phases/47-historical-backfill-archival/post-run-verify.txt` — reduction analysis (Plan 47-01 Task 3)
- [x] `scripts/oneoffs/backfill-asset-descriptions.py` — archived script with deprecation header (Plan 47-02 Task 1)
- [x] `scripts/oneoffs/README.md` — one-off convention doc (Plan 47-02 Task 2)
- [x] `scripts/verify-phase-47-backfill.ts` — Phase 47 verifier (Plan 47-02 Task 3)
- [x] `package.json` — verify:phase-47-backfill entry (Plan 47-02 Task 3)

---

## Manual Sampling Procedure (Plan 47-02 BACKFILL-02)

**When to run:** after Plan 47-01 completes (DB has been repaired), before
marking Phase 47 / v2.0 milestone complete.

**Setup:**

1. Ensure the dev server is running:
   ```bash
   # In one terminal:
   npm run dev
   ```

2. Open the canvas UI in a browser (typically http://localhost:5173 or
   wherever the vite dev server binds)

3. Load a project that has P04 / P07 / P08 nodes (typically the
   project ID 1 used in the backfill)

**Sampling steps:**

For each of P04, P07, P08:

1. Type the phase prefix (e.g. "P04") into the toolbar search filter
   (Phase 45 Tier 2 search input)
2. The canvas narrows to nodes matching "P04" in label / description
3. Click 10 visible nodes one at a time
4. For each: open NodeDetailPanel, confirm the 描述 (description) section
   shows meaningful text — not just a label echo
5. Record pass/fail per node

**Pass criteria:**
- ≥ 8 of 10 sampled nodes per phase show meaningful description (≥ 20 chars, not a bare label echo like "角色 A" or "场景 S01")
- If any phase has < 8/10 pass, document the failure pattern in 47-VERIFICATION.md
  and decide whether to re-run backfill or accept the gap

**Sign-off:**

Fill in the MANUAL SAMPLING CHECKLIST section in
`.planning/phases/47-historical-backfill-archival/47-VERIFICATION.md`:

```markdown
## Manual Sampling Checklist (BACKFILL-02)

**Sampled:** 2026-07-16 by <operator>
**Project:** 1

### P04 (character design — target 10 nodes)
| Node ID | Pass? | Description text (first 50 chars) |
|---------|-------|----------------------------------|
| ... | ... | ... |

P04 pass rate: N/10

### P07 (scene generation — target 10 nodes)
...

### P08 (scene selection — target 10 nodes)
...

**Overall:** <all-pass / mixed / failed>
**Action:** <sign off / re-run backfill / open follow-up issue>
```

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Visual inspection of repaired nodes via canvas UI | BACKFILL-02 | Requires browser + dev server + visual judgment of "meaningful" description | See "Manual Sampling Procedure" above |
| Decision: re-run backfill or accept gap | BACKFILL-02 | Operator judgment based on sampling outcome | Documented in 47-VERIFICATION.md sign-off section |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: pre-flight + post-run + archival all gated by automated checks
- [x] Wave 0 covers all 3 BACKFILL-XX requirements
- [x] No watch-mode flags
- [x] Feedback latency < 5s for verify:phase-47-backfill; ~30s for backfill --apply
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** ready
