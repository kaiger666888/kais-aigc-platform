---
phase: 50-historical-backfill-contract-guards
fixed_at: 2026-08-19T11:03:37Z
review_path: .planning/phases/50-historical-backfill-contract-guards/50-REVIEW.md
iteration: 1
findings_in_scope: 2
fixed: 2
skipped: 0
status: all_fixed
---

# Phase 50: Code Review Fix Report

**Fixed at:** 2026-08-19T11:03:37Z
**Source review:** .planning/phases/50-historical-backfill-contract-guards/50-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 2 (WR-01, WR-02 — Warning tier; Info findings skipped per fix scope)
- Fixed: 2
- Skipped: 0

**Verification:**
- `npm run verify:phase-50`: **114/114 assertions passed** (was 104/104 — 10 new guard assertions)
- `npx tsc --noEmit`: clean (exit 0)
- `grep -c "db2" scripts/verify-phase-50.ts` = 0 (no-production-filename gate still holds)
- Forced-failure sanity on BOTH new guard families:
  - Reintroducing the archived→active coercion (reverting the WR-01 member-loop guard): `FAIL: WR-01: zero state writes planned — actual: 1`, then the apply's in-transaction member-linkage assertion rolls the whole transaction back (`group name:sheets/env: member ids [15] not linked to primary id 5`) — fail loud, never a partial write.
  - Disabling the wfAlreadySet early-continue: 6 FAILs including `wf idempotency: row 14's pre-existing workflow_phase counted as already-set — actual: 0` and `pre-existing workflow_phase 'p08_custom' NOT rewritten to the path-derived 'p08' — actual: "p08"`.
- Production DB untouched: no `--apply` run; all verification on `:memory:` databases only. The applied/archived status of the production run is unchanged (its baseline dry-run already showed `state writes: 0`, so the new policy alters no applied data — it future-proofs the script and its re-run guarantee).

## Fixed Issues

### WR-01: Backfill silently resurrects `archived` rows — red line covers `eliminated` only

**Files modified:** `scripts/backfill-candidate-groups.ts`
**Commit:** bca8bc21
**Applied fix:** Extended the D-05 red line so `state='archived'` rows are never STATE-written, while they may still participate in grouping decisions that require no state change (the narrowest policy consistent with "回填只处理 active"):
1. **Member loop** — the state write is now `if (m.state !== "active" && m.state !== "archived") getDiff(m.id).state = "active";`: an archived member is never coerced to 'active' (human archive decision preserved) but still receives its `assetsId` / `isPrimaryView` / `workflow_phase` targets. Other legacy non-active values keep the original normalization behavior.
2. **Archived would-be primary** — a group whose planGroups-chosen primary is `archived` can never converge without a state write (WR-3 requires an active primary), so the whole group is skipped (zero grouping writes to ANY member; wf targets still apply), itemized in the new `BackfillPlan.archivedPrimarySkips` field, and reported in a dedicated `printReport` section. Members of skipped groups are counted in neither `groupedRows` nor `standaloneRows`.
3. **applyBackfill** — any UPDATE carrying a `state` set now also has `whereRaw("state != 'archived'")` (defense-in-depth for a row archived between plan and apply; the statement no-ops and the planned-vs-executed MISMATCH fails loudly). Grouping-only writes never carry `state`, so archived members' planned updates are unaffected.
4. Header/doc comments updated to document the WR-01 red line (noting it was added post-apply; production run planned `state writes: 0` so no data was affected) and the WR-3 assertion now covers user-archived primaries too.
- Note: REVIEW.md's suggested blanket `NOT IN ('eliminated','archived')` UPDATE guard was deliberately NOT applied as-is — it would have blocked legitimate no-state-change grouping writes to archived members, contradicting the refined policy (archived rows may participate when no state change is required). The `archived` exclusion is scoped to statements that write the state column.

### WR-02: verify-phase-50 never seeds the "already-set workflow_phase is never rewritten" invariant

**Files modified:** `scripts/verify-phase-50.ts`
**Commit:** 6a1cda94
**Applied fix:** Added 4 guard seeds to Section 2 (stock grows 13 → 17 rows) and 10 new assertions (suite 104 → 114):
- **Seed 14** (`/oss/1/p08/sheets/locked.png`, pre-set `workflow_phase='p08_custom'`): path derivation would compute `'p08'` — asserted `plan1.wfAlreadySet === 1` and post-apply `workflow_phase === 'p08_custom'` (never rewritten).
- **Seed 15** (`env_v4.png`, `state='archived'`, joins the p07 `_v{N}` family as a member with active primary row 5): asserted the archived member still participates in grouping (`memberRowIds` includes 15, `assetsId → 5`, `isPrimaryView` 0, `workflow_phase 'p07'`) AND keeps `state='archived'` after `applyBackfill`; plus plan-level `state writes === 0`.
- **Seeds 16+17** (`board.png` archived canonical + `board_v1.png` active sibling — the WR-01 "otherwise" branch): asserted the family is skipped whole and itemized (`archivedPrimarySkips` names `name:sheets/board` / row 16), both rows get workflow_phase targets ONLY (no grouping/state columns planned), the archived would-be primary is never promoted/linked, and the active sibling is NOT linked onto the archived primary.
- Updated expected counts for the grown stock: `totalRows` 17, `scanned` 16, `standaloneRows` 4, diffs 14 (7 grouping + 7 wf-only), assetsId writes 6, `wfFromPath` 12; `groups.length` stays 2 (the board family is skipped). Idempotency (0-diff re-plan, 0-update re-apply) and the eliminated-row byte-untouched red line still pass on the grown stock.

## Skipped Issues

None — both in-scope Warning findings were fixed. The 5 Info findings (IN-01 … IN-05) were out of scope per the fix scope (critical_warning tier).

---

_Fixed: 2026-08-19T11:03:37Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
