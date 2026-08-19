---
phase: 50-historical-backfill-contract-guards
verified: 2026-08-19T11:08:12Z
status: passed
score: 6/6 must-haves verified
overrides_applied: 0
---

# Phase 50: Historical Backfill + Contract Guards Verification Report

**Phase Goal:** 存量 o_assets 获得与新增资产相同的组织性（候选建组 + `workflow_phase` 非空），且 v2.1 全部行为由自动化契约测试守住——候选分组形状、选定回写链路、双端枚举映射不再回归。
**Verified:** 2026-08-19T11:08:12Z
**Status:** passed
**Re-verification:** No — initial verification

**Baseline note:** ROADMAP Phase 50 header says "存量 368 条" — that is the stale `.task-pipeline-asset-gap-analysis.md` figure. Plans superseded it with the live read-only baseline (1612 rows, 1456 workflow_phase-NULL). All criteria below are assessed against the live baseline, per the plans' documented production-baseline facts (verified independently against the pre-apply backup DB: 1612 total / 0 grouped / 1456 wf-NULL / 386 eliminated / 768 isPrimaryView=1).

## Goal Achievement

### Observable Truths

Merged must-haves: 4 ROADMAP Success Criteria (contract) + 2 PLAN truths adding detail beyond the SCs. All 12 plan-level truths (6 per plan) map into these 6; none reduced scope.

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | SC1: Backfill script (INGEST-04+PHASE-02 merged) runs dry-run first with a baseline report, takes a DB backup before `--apply`, and is idempotent — second `--apply` changes 0 rows | ✓ VERIFIED | `backfill-baseline-dryrun.txt`: 538 planned / 0 executed, exit 0. Backup `data/db2-backup-pre-phase-50.sqlite` exists (371,773,440 bytes, `git check-ignore` confirms gitignored). Apply log: 538/538 + "IDEMPOTENCY RE-RUN" section 0/0. **Independently re-run this session:** `npm run backfill:phase-50` (dry-run, read-only) against live production → `Planned changes: 0 / Executed updates: 0`. Gate check: `npx tsx scripts/backfill-candidate-groups.ts --apply` → exit 1 + prints the `sqlite3 ... .backup` / `cp` backup command (D-02). |
| 2 | SC2: After `--apply`, workflow_phase NULL count drops significantly from baseline; remaining NULLs are only underivable rows; sampled p04/p07 assets carry correct phase values | ✓ VERIFIED | Recorded 1456 → 922 (−534; meta 237 / path 297). Live now: 923 = 327 eliminated + 596 active — the +1 vs 922 is row id 1709 (`/oss/pipeline/fd99c59f/master.mp4`, ingested post-backfill, no p{NN} segment, correctly underivable). All 89 wf-NULL `/p07/`-path rows are eliminated; every active `/p07/` row carries exactly `p07` (44/44); `/p11/` → `p11` only; all 11 formerly-NULL `/p04/` rows now `p04` (27 other `/p04/` rows keep pre-existing legacy values `p04_turnaround`/`p04_character_design`/`p09_shot_breakdown` — never rewritten by the plan's own idempotency mandate, decomposed against the backup in post-run-verify §d). |
| 3 | SC3: Candidate-grouping contract test ingests a fixture manifest and asserts o_assets shape — group count, exactly-one isPrimaryView per group, state domain, assetsId self-consistency — violations fail the suite | ✓ VERIFIED | `scripts/verify-phase-50.ts` Section 1: fixture batch → `planGroups` → 6 groups (4 `shot:` manifest keys subset), then the REAL `ingestImagesPayload` on `:memory:` with per-group exactly-one-primary / primary assetsId NULL / member linkage / all-active state / wf='p11' SQL asserts. Ran it: exit 0. Forced-failure sanity documented (flip 6→7 → exit 1 FAIL, restored) in 50-02-SUMMARY + 50-REVIEW-FIX (also re-proven for both WR guard families). |
| 4 | SC4: `scripts/verify-phase-50.ts` aggregates INGEST/SELECT/PHASE behaviors + dual-side enum/vocabulary no-drift, registered in package.json per the v2.0 verify tradition | ✓ VERIFIED | Sections 2–4: backfill idempotency + D-05 red line + D-04 meta/provenance/path priority + WR-01/WR-02 archived-state and pre-set-wf guards on `:memory:`; enum no-drift by import identity (`CANONICAL_ASSET_TYPES` / `LEGACY_ASSET_TYPE_ALIASES` / `expandTypesForQuery` from `../src/lib/assetTypes`, lines 40–44); Phase 48/49 spot invariants. `package.json` line 43: `"verify:phase-50": "npx tsx scripts/verify-phase-50.ts"`. Ran it: **114/114 assertions passed, exit 0** (post-review-fix count; SUMMARY's 104 was pre-fix). |
| 5 | PLAN 50-02: verify output ends with a Summary line + PASS/FAIL verdict, exit code follows the verdict, and prints exactly one `[WARN]` SC-4 debt line | ✓ VERIFIED | Output ends `=== Summary: 114/114 assertions passed ===` + `✅ … PASSED` verdict, `process.exit(0|1)` (lines 591–598). Exactly 1 `[WARN]` line (grep count on this session's run) referencing SC-4 / 49-HUMAN-UAT G-1. |
| 6 | PLAN 50-02: All five manual register_*.py scripts carry DEPRECATED headers pointing at the Phase 48 ingest chain; none deleted (D-12) | ✓ VERIFIED | All 5 files on disk; each `head -10` contains `[DEPRECATED — Phase 50, 2026-08-19]` + `pipeline/ingest/images` substring; `python3 -m py_compile` passes for all five. Backfill script header carries "APPLIED AND ARCHIVED — do not run again" + backup filename + audit pointers. |

**Score:** 6/6 truths verified

### Production Audit Trail (independent DB evidence)

Read-only `sqlite3 -readonly` against `data/db2.sqlite` and the pre-apply backup:

| Check | Result |
|-------|--------|
| Backup vs live totals | backup 1612/0 grouped/1456 wf-NULL/386 elim/768 primary → live 1613 (+1 post-backfill ingest)/240/923/386/710 — matches every headline number claimed |
| Eliminated red line | 386-row snapshot `id,assetsId,isPrimaryView,workflow_phase,state` byte-identical backup vs live (diff empty) |
| Exactly-one-primary | 121 distinct member-groups; all 121 referenced primaries exist, isPrimaryView=1, assetsId NULL; 0 members with isPrimaryView=1; 0 orphans/unflagged; all grouped primaries state='active' |
| p11 manifest family | `/oss/…/p11/iframes/S01_B01_first_v{1,2,3}.png` → row 758 primary (assetsId NULL, isPrimaryView=1) + 759/760 members linked (assetsId=758); wf='p11' only distinct value on /p11/ active rows |
| p04 turnaround family | active survivors are single-variant primaries (isPrimaryView=1, assetsId NULL, wf='p04'); eliminated `_v{N}` siblings untouched (assetsId NULL, wf NULL) — red line visible in the family itself |
| Audit files committed | baseline-dryrun / apply-log / post-run-verify all `git ls-files` tracked |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `scripts/backfill-candidate-groups.ts` | ONE-OFF idempotent backfill: planBackfill/applyBackfill + gated CLI | ✓ VERIFIED | 569 lines, substantive: read-only plan (diff-only ⇒ idempotent by construction), single-transaction apply with in-trx exactly-one-primary + WR-3 primary-active + linkage assertions, D-05 guard at SELECT and UPDATE level, WR-01 archived-state red line, `require.main` guard, dry-run default, D-02 gate exits 1 before any write |
| `package.json` | `backfill:phase-50` + `verify:phase-50` entries | ✓ VERIFIED | lines 43–44, exact expected commands |
| `scripts/verify-phase-50.ts` | GUARD-01 contract group + GUARD-02 aggregate gate | ✓ VERIFIED | 604 lines, 5 sections + WARN; drives REAL modules (`planBackfill`/`applyBackfill`/`ingestImagesPayload`/`planGroups`/assetTypes) on `:memory:` only — 0 occurrences of `db2.sqlite` |
| `.planning/…/backfill-baseline-dryrun.txt` | Pre-apply baseline report | ✓ VERIFIED | 1612 scanned scale, 154 groups / 240 links / 534 wf planned, `Planned changes: 538` / `Executed updates: 0`, full 595-row underivable itemization |
| `backfill-apply-log.txt` / `backfill-post-run-verify.txt` | Apply + proof chain | ✓ VERIFIED | 538/538 + idempotency re-run 0/0; proofs (a)–(e) incl. backup-vs-live /p04/ decomposition |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `scripts/backfill-candidate-groups.ts` | `src/lib/candidateGrouping.ts` | `import { planGroups, deriveWorkflowPhase }` | ✓ WIRED | line 68–72; 10 usages of planGroups/deriveWorkflowPhase — zero logic duplication (D-03) |
| `scripts/backfill-candidate-groups.ts` | production DB | self-built knex (better-sqlite3) | ✓ WIRED | lines 535–539; 0 occurrences of `@/utils` |
| `scripts/verify-phase-50.ts` | `scripts/backfill-candidate-groups.ts` | `import { planBackfill, applyBackfill }` | ✓ WIRED | line 46; both driven on `:memory:` (lines 352, 414, 435, 437) |
| `scripts/verify-phase-50.ts` | `src/lib/ingestAssets.ts` | `ingestImagesPayload` on temp `:memory:` | ✓ WIRED | dynamic import line 125, invoked line 228 |
| `scripts/verify-phase-50.ts` | `src/lib/assetTypes.ts` | import CANONICAL_ASSET_TYPES / aliases / expandTypesForQuery | ✓ WIRED | lines 40–44, consumed in Section 3 |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|--------------------|--------|
| backfill report | diffs/groups/wf counters | live `o_assets` ⋈ `o_image` SELECT | Yes — cross-checked against read-only production queries this session | ✓ FLOWING |
| verify-phase-50 assertions | landed rows / plan diffs | real ingestImagesPayload + planBackfill/applyBackfill on `:memory:` seeded stock | Yes — 114/114 pass driving the real modules | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Final gate green | `npm run verify:phase-50` | exit 0, 114/114, 0 FAIL, 1 WARN | ✓ PASS |
| Gate 48 regression | `npm run verify:phase-48` | exit 0, 135/135 | ✓ PASS |
| Gate 49 regression | `npm run verify:phase-49` | exit 0, 79/79 | ✓ PASS |
| Gate 49-bridge regression | `npm run verify:phase-49-bridge` | exit 0, 63/63 | ✓ PASS |
| Gate 49-linkage regression | `npm run verify:phase-49-linkage` | exit 0, 50/50 | ✓ PASS |
| Type-check | `npx tsc --noEmit` | exit 0 | ✓ PASS |
| D-02 apply gate refuses | `npx tsx scripts/backfill-candidate-groups.ts --apply` | exit 1 + prints backup command | ✓ PASS |
| Production idempotency (read-only) | `npm run backfill:phase-50` (dry-run) | exit 0, `Planned changes: 0` / `Executed updates: 0` | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| INGEST-04 | 50-01 | 存量已平铺资产回填建组——一次性幂等脚本 (dry-run 基线 + `--apply` + DB 备份先行) | ✓ SATISFIED | 240 members linked into 121 groups, exactly-one-active-primary each, 0/0 re-run, backup + audit trail |
| PHASE-02 | 50-01 | 存量 o_assets 回填 workflow_phase (与 INGEST-04 合流) | ✓ SATISFIED | 534 values (meta.provenance-aware meta-first, path fallback), underivable stay NULL itemized |
| GUARD-01 | 50-02 | 候选分组契约测试 (组数 / isPrimaryView 唯一 / state 值域 / assetsId 自洽) | ✓ SATISFIED | verify-phase-50 Section 1, fixture→planGroups→landed shape, in the permanent 114-assertion gate |
| GUARD-02 | 50-02 | verify-phase-N 汇总脚本 + 双端枚举/词汇映射无 drift | ✓ SATISFIED | Sections 2–4 (idempotency/red-line/no-drift/spot invariants), package.json registered, exit 0 |

Orphaned requirements: none — REQUIREMENTS.md traceability maps exactly INGEST-04, PHASE-02, GUARD-01, GUARD-02 to Phase 50, all four claimed by the two plans.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| scripts/verify-phase-50.ts | 66–68 | IN-01: DDL mirror omits nullable `promptErrorReason` vs "column-for-column" comment claim | ℹ️ Info | None — column unused by code under test (review finding, out of fix scope) |
| scripts/backfill-candidate-groups.ts | 179 | IN-02: NULL-state rows would fall out of scan+guard accounting | ℹ️ Info | None on production — live states are only active/eliminated/archived; report arithmetic reconciles (1612 = 1226 + 386) |
| scripts/backfill-candidate-groups.ts | 132–149 | IN-03: non-string `meta.phase` itemized as "no meta.phase" | ℹ️ Info | Audit-wording only; never-guess policy holds |
| scripts/backfill-candidate-groups.ts | 24–26 | IN-04: duplicated audit-trail header block | ℹ️ Info | Cosmetic |
| scripts/verify-phase-50.ts | 432–450 | IN-05: positive source-greps could match commented-out code | ℹ️ Info | Inherent to repo grep-guard convention; flagged for awareness |

Debt-marker scan (TBD/FIXME/XXX/TODO/HACK/PLACEHOLDER/stub patterns) over all 7 phase-modified files: **zero matches**.

### Human Verification Required

None. All material checks were programmatic: read-only DB inspection performed directly this session (grouping integrity, red line, phase values, backup comparison), all five gates re-run, gate-refusal and idempotency re-proven. The only registered follow-up debt is SC-4 kmc consumer-side half-loop — cross-repo, out of scope per D-11, already tracked as G-1 in `.planning/phases/49-*/49-HUMAN-UAT.md` and surfaced by the gate's WARN line (carry-over, not a Phase 50 gap).

### Gaps Summary

No gaps. Every must-have verified against the codebase and the production audit trail. Notable observations, none affecting the goal:

1. **Live-DB drift +1 row** (id 1709, post-backfill ingest) — explains 1613/923 vs the recorded 1612/922; correctly underivable NULL; current dry-run still reports 0 planned changes.
2. **Assertion count is 114, not 104** — post-execution review fix (bca8bc21, 6a1cda94) added 10 guard assertions (WR-01/WR-02); SUMMARY figures predate the fix; REVIEW-FIX documents the delta. Current state re-verified green.
3. **ROADMAP header "368 条" is stale** (gap-analysis figure); the plans' live baseline 1612 supersedes it — SC2 assessed against the live baseline. Consider updating the ROADMAP header figure at milestone close.

---

_Verified: 2026-08-19T11:08:12Z_
_Verifier: Claude (gsd-verifier)_
