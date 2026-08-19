---
phase: 50-historical-backfill-contract-guards
reviewed: 2026-08-19T10:52:01Z
depth: standard
files_reviewed: 3
files_reviewed_list:
  - scripts/backfill-candidate-groups.ts
  - scripts/verify-phase-50.ts
  - package.json
findings:
  critical: 0
  warning: 2
  info: 5
  total: 7
status: issues_found
---

# Phase 50: Code Review Report

**Reviewed:** 2026-08-19T10:52:01Z
**Depth:** standard
**Files Reviewed:** 3 (+ 5 `scripts/canvas/register_*.py` confirmed comment-only via `git diff 0f204cc9^..HEAD`)
**Status:** issues_found

## Summary

Reviewed the Phase 50 one-off backfill (`scripts/backfill-candidate-groups.ts`), the GUARD verify suite (`scripts/verify-phase-50.ts`), and the two `package.json` script additions. Cross-referenced every import the code delegates to: `src/lib/candidateGrouping.ts` (planGroups / deriveWorkflowPhase), `src/lib/ingestAssets.ts` (ingestImagesPayload signature and return shape), `src/lib/assetTypes.ts` (canonical vocabulary / aliases / expandTypesForQuery), `src/lib/initDB.ts` (o_assets DDL), the fixture `scripts/fixtures/phase48-p11-manifest.fixture.json`, and the phase audit trail.

What holds up under adversarial tracing:

- **planBackfill/applyBackfill core logic is sound.** I independently recomputed every Section 2 expected value (11 diff rows = 6 grouping + 5 wf-only; 5 assetsId writes; 2 hero demotions; 1 env promotion; wf attribution 9 path / 2 meta / 1 underivable) against the seed data and the imported pure functions — all match. Production audit numbers are internally consistent (scanned 1285 = 534 wf writes + 156 already-set + 595 underivable; 394 grouped + 709 standalone + 47 dup-skipped + 135 no-filePath).
- **D-05 eliminated red line is genuinely enforced twice**: excluded at SELECT level (line 179) and `whereRaw("state != 'eliminated'")` on every UPDATE (line 366). The apply runs in ONE transaction with real in-transaction assertions (exactly-one primary, primary state active, member linkage) that throw and roll back.
- **Idempotency-by-construction is real** (columns enter a diff only when they differ from target) and proven by the audit log re-run (0 planned / 0 executed).
- **CLI gating is correct**: `--apply` refuses before knex is even constructed.
- **verify-phase-50 assertion quality is high**: no vacuous assertions found — every constant is discriminating (a `find()` miss or missing groupKey produces a FAIL, not a skip); real module imports (candidateGrouping, ingestAssets, assetTypes, and the backfill core itself); every DB is `:memory:` with pools destroyed in `finally`; `grep -c "db2" scripts/verify-phase-50.ts` = 0, so the no-production-filename claim holds; the fixture's selected variants (2/null/null/2) match the expected primaries exactly. Suite is green at HEAD: **104/104, exit 0**.
- `ingestImagesPayload` call in Section 1(b) matches the real signature (`projectId/phase/images/manifests` → `count/assets/groups{groupKey,primaryAssetId,memberAssetIds}`) and inserts its own o_image rows, so the unseeded tempDb is correct.
- `package.json` adds only the two npm scripts; the odd `engines.node: ">=1.0.0"` is pre-existing, not part of this diff.
- The 5 `scripts/canvas/register_*.py` changes are exactly 7 comment lines of deprecation header each — no code changes.

The one substantive defect: the backfill's state handling only red-lines `'eliminated'`, but the actual o_assets state domain is `active | archived | eliminated` — an `archived` row inside a candidate family would be silently resurrected to `active` (WR-01). It did not manifest in the applied run (`state writes: 0` in the baseline dry-run), so no production harm occurred, but the code and its guard suite both leave the hazard open for any future re-run.

## Critical Issues

(none)

## Warnings

### WR-01: Backfill silently resurrects `archived` rows — red line covers `eliminated` only, and the WR-3 assertion cannot catch it

**File:** `scripts/backfill-candidate-groups.ts:275` (also `:179` scan predicate, `:366` UPDATE guard, `:388` assertion)
**Issue:** The o_assets `state` domain is `["active", "archived", "eliminated"]` (`src/routes/v1/assets-registry/index.ts:191` update enum; `src/lib/initDB.ts:469` column comment `active | archived`), and the candidateGrouping D-05 policy states that *elimination and archiving are human actions*. But the backfill scans with `a.state != 'eliminated'` and, for every grouped member (including the primary), plans `if (m.state !== "active") getDiff(m.id).state = "active"` — so a user-archived row that sits in a `_v{N}` family or is a canonical gets:

1. its `archived` flag overwritten to `active` (loss of a human decision),
2. members linked onto it if it is the chosen primary (`assetsId → archived primary`),
3. a clean pass through the in-transaction WR-3 assertion, which only checks `primary.state !== "active"` *after the backfill itself just set it to active*.

This also breaks the "idempotent by construction / re-run is a no-op" guarantee with respect to the human archive action: after a user archives a family member, a later `npm run backfill:phase-50 -- --apply --i-backed-up-db` would plan a `state writes: N > 0` re-run and un-archive it. The npm script stays registered in `package.json:44` indefinitely.

Mitigating facts (why this is WARNING, not BLOCKER): the run is already applied and archived, the header forbids re-running, `--apply` requires the backup flag, and the baseline dry-run proves `state writes: 0` — zero archived rows were in groups at apply time, so no production data was harmed.
**Fix:**
```ts
// 1. Scan level (line 179): exclude archived the same way as eliminated
.whereRaw("a.state NOT IN ('eliminated','archived')")

// 2. UPDATE guard (line 366): same red line in every statement
.whereRaw("a.state NOT IN ('eliminated','archived')")

// 3. Member loop (line 275): never coerce human-set states; only 'active' targets
//    (drop the state column from BackfillDiffRow entirely if no legacy state
//     normalization is actually needed — production evidence says it never fired)
```
At minimum, skip the state coercion and refuse to link members onto an archived primary; and add an `archived` seed row to verify-phase-50 Section 2 asserting its grouping columns and state stay byte-untouched.

### WR-02: verify-phase-50 never seeds the "already-set workflow_phase is never rewritten" invariant

**File:** `scripts/verify-phase-50.ts:290-312` (seed table), `:299` (untested code path)
**Issue:** The backfill's documented invariant "pre-existing values never touched (idempotency)" (`backfill-candidate-groups.ts:299-302`, `printReport` line 436) is a core safety property — 156 production rows carried values. Yet all 13 Section 2 seeds are inserted with `workflow_phase: null`, so `wfAlreadySet` is always 0 in the suite. A regression that rewrote existing workflow_phase values (e.g. dropping the `current.length > 0` early-continue) would still pass 104/104. Same gap for `archived` state (no seed), tying into WR-01.
**Fix:** Add seeds, e.g.:
```ts
// a p08-path row that ALREADY has workflow_phase='p08_custom' — must never be touched
{ id: 14, filePath: "/oss/1/p08/sheets/locked.png", state: "active",
  isPrimaryView: 0, assetsId: null, meta: null },  // insert with workflow_phase: 'p08_custom'
// an archived member of a family — grouping columns and state must stay untouched (WR-01)
```
and assert post-apply: `row 14 workflow_phase === 'p08_custom'`, `plan1.wfAlreadySet === 1`, and the archived row byte-identical.

## Info

### IN-01: DDL mirror claim "column-for-column" is off by one column

**File:** `scripts/verify-phase-50.ts:66-68` (comment) vs `src/lib/initDB.ts:462`
**Issue:** The comment claims the mirror is "column-for-column (src/lib/initDB.ts builders)". Production o_assets has `promptErrorReason` (initDB.ts:462); the mirror omits it (as does verify-phase-48's mirror, which this one credits). Harmless — the omitted column is nullable and unused by the code under test — but the fidelity claim is inaccurate.
**Fix:** Add `t.text("promptErrorReason");` to the mirror, or soften the comment to "every column exercised by the code under test".

### IN-02: NULL-state rows silently fall out of both the scan and the UPDATE guard, unaccounted

**File:** `scripts/backfill-candidate-groups.ts:179` and `:366`
**Issue:** `state != 'eliminated'` in SQLite is NULL when `state` IS NULL, so a NULL-state row is silently excluded from the scan (never planned) and from every UPDATE — yet it is counted in `totalRows` but in neither `scanned` nor `excludedEliminated`, so the report's implicit invariant `total = scanned + excluded` can break with no warning line. The column is nullable in the DDL; only the column default makes NULL unlikely.
**Fix:** Use `whereRaw("(a.state IS NULL OR a.state != 'eliminated')")` and document the accounting, or add an explicit `nullState` count to the report so the arithmetic always reconciles.

### IN-03: `extractMetaPhase` ignores non-string `meta.phase`, and the itemization then misreports why

**File:** `scripts/backfill-candidate-groups.ts:132-149` and `:151-156`
**Issue:** `meta.phase` values that are not strings (e.g. `{"phase": 11}`) are treated as absent (the `typeof top === "string"` check), and `deriveWorkflowPhase` never sees them. The row lands in `underivableItems` with the reason "no meta.phase" — a misleading audit line for a row that *does* carry a (numeric) phase signal. Defensible under D-08 "never guess", but the reason string should distinguish "phase present but non-string".
**Fix:** In `underivableReason`, take the raw meta signal type and emit e.g. `meta.phase is number(11) — unsupported type` instead of `no meta.phase`.

### IN-04: Header documentation nits — duplicated audit-trail block and an over-broad "no-op" claim

**File:** `scripts/backfill-candidate-groups.ts:24-26` vs `:51-53`; `:343-344`
**Issue:** (a) The "Audit trail … backup file … gitignored" paragraphs appear twice in the file header. (b) The applyBackfill doc says a row eliminated between plan and apply is "a no-op instead of a write" — true per-statement, but any eliminated-mid-run *group member* then fails the in-transaction unlinked/primary assertion and aborts the ENTIRE apply (safe, but not the graceful per-row degradation the phrasing suggests; the MISMATCH branch in `main()` can never fire in that scenario because the transaction throws first).
**Fix:** Deduplicate the header block; rephrase to "the UPDATE is a no-op and the per-group assertion then rolls back the whole apply — fail loud, never partial".

### IN-05: Section 3/4 positive source-grep assertions can be satisfied by commented-out code

**File:** `scripts/verify-phase-50.ts:432-450`, `:487-506`
**Issue:** The positive regexes (`/from\s+"@\/lib\/assetTypes"/`, `includes("void resolveOpenReviewForSelection(")`, etc.) match anywhere in the file, including inside comments, so a future deletion of the real import that left a mention in a comment would still pass. The negative assertions fail safe (a comment containing an inline enum would false-FAIL, which is fine). Inherent limitation of this repo's grep-guard convention — flagging for awareness, not requesting a rewrite.
**Fix (optional):** Anchor positive checks to line starts excluding `//` prefixes, e.g. `src.split("\n").some(l => /^\s*import\b.*from\s+"@\/lib\/assetTypes"/.test(l))`.

---

 structural + narrative distinction: all findings above are narrative (AI reviewer). No `<structural_findings>` block was provided for this phase.

_Verified at HEAD: `npm run verify:phase-50` → 104/104 assertions passed, exit 0._

_Reviewed: 2026-08-19T10:52:01Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
