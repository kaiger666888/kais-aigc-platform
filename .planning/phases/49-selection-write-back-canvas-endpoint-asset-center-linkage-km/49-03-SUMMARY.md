---
phase: 49-selection-write-back-canvas-endpoint-asset-center-linkage-km
plan: "03"
subsystem: api
tags: [express, knex, better-sqlite3, canvas, variant-groups, o-assets, asset-center, linkage, tdd]

requires:
  - phase: 49 plan 01
    provides: selectWinnerInGroup(trxDb, scope, groupId, winnerNodeId) + the canvas↔o_assets winner truth columns
provides:
  - findCanvasNodeForAsset(db, oAssetId) — o_assets→canvas node mapping (deterministic a-oasset-{id} + json_extract data.oAssetId fallback), projectId-scoped
  - applyRegistrySelectionToCanvas(db, oAssetId) — registry→canvas one-way linkage (D-06): never throws, three normal-path info skips, delegates all writes to selectWinnerInGroup
  - registry PATCH /:id selection hook — fires only on isPrimaryView===true, after the o_assets update, void+.catch fire-and-forget
  - npm run verify:phase-49-linkage behavioral gate (42 assertions) — replaces the 49-01 scaffold
affects: [49-02 (shared wave-2 gate naming space), Phase 50 backfill]

tech-stack:
  added: []  # zero new dependencies (T-49-SC accept)
  patterns:
    - "code-vs-prose source assertions: strip comments before asserting code shape — required documentation (loop prevention) legitimately names the very tokens the shape check forbids"
    - "direction-by-construction loop prevention: each linkage half writes only its own domain's tables and never calls the other's routes/HTTP (asserted as source shape, T-49-13)"

key-files:
  created:
    - src/lib/canvasAssetLinkage.ts
  modified:
    - src/routes/v1/assets-registry/index.ts
    - scripts/verify-phase-49-linkage.ts

key-decisions:
  - "Linkage writes are 100% delegated to 49-01 selectWinnerInGroup — the lib contains zero direct write builders (asserted), so winner semantics (multi_mode refusal, idempotency, atomicity) stay single-sourced"
  - "findCanvasNodeForAsset returns null for assets with NULL projectId — canvas nodes always belong to a project, so a projectless asset is unmappable (plan silent on this edge; covered by gate)"
  - "episodesId comes from the node row (node.episodes_id ?? 1, the sync-assets default) so the group lookup in selectWinnerInGroup shares the node's scope"
  - "Cross-project guard (T-49-12) asserted twice: find level (same-id node under foreign project invisible) and write level (foreign group untouched)"
  - "Route assertions (g) are source-shape only, per plan — no live PATCH dispatch, so the gate needs no spawned child process (unlike verify-phase-49.ts); the entire gate runs in-process on :memory: sqlite with chdir isolation"
  - "Route hook reads updates.isPrimaryView === true from the raw updates map — safe because zod's isPrimaryView boolean validation rejects non-boolean values before the update runs"

patterns-established:
  - "Pattern: injected-db lib module with header-documented directionality (loop prevention as prose) + gate asserting the code view"
  - "Pattern: staged TDD gate — route-shape assertions authored in RED, green at the later task that lands the route change (49-01 precedent)"

requirements-completed: [SELECT-03]

duration: 6min
completed: 2026-08-19
---

# Phase 49 Plan 03: SELECT-03 资产中心↔画布联动 Summary

**Registry→canvas one-way selection linkage (findCanvasNodeForAsset + applyRegistrySelectionToCanvas + PATCH :id isPrimaryView=true hook) reusing 49-01's selectWinnerInGroup, guarded by a 42-assertion behavioral gate.**

## Performance

- **Duration:** 6 min (03:20–03:26 UTC)
- **Started:** 2026-08-19T03:20:59Z
- **Completed:** 2026-08-19T03:26:30Z
- **Tasks:** 2/2
- **Files modified:** 3 (1 created, 2 modified)

## Commits

| Task | Commit | Type |
| ---- | ------ | ---- |
| Task 1 RED | 72016f22 | test(49-03): add failing gate for registry→canvas asset linkage |
| Task 1 GREEN | 33a3939e | feat(49-03): implement canvasAssetLinkage registry→canvas one-way linkage |
| Task 2 | 125d1386 | feat(49-03): hook registry PATCH selection into canvas linkage |

## Accomplishments

- **Linkage lib** (`src/lib/canvasAssetLinkage.ts`): `findCanvasNodeForAsset` reads only `o_assets.projectId`, then looks up the canvas node by deterministic id equality (`a-oasset-{id}`, sync-assets.ts:69 rule) scoped to that projectId, falling back to `whereRaw("json_extract(data, '$.oAssetId') = ?", [oAssetId])` (T-49-10 placeholder binding). `applyRegistrySelectionToCanvas` maps the asset→node→group and delegates to `selectWinnerInGroup`; the three normal paths (unmapped asset / groupless node / non-updated status incl. multi_mode and idempotent) are info-level skips, and a top-level try/catch makes the export never throw (T-49-11).
- **Registry hook** (`src/routes/v1/assets-registry/index.ts`): after the `o_assets` update succeeds and only when `updates.isPrimaryView === true`, fires `void applyRegistrySelectionToCanvas(u.db, id).catch(warn)` — fire-and-forget, response shape and every other PATCH behavior byte-identical. Comment documents D-06 + the true-only rationale + loop prevention (T-49-13).
- **Behavioral gate** (`scripts/verify-phase-49-linkage.ts`, replaced 49-01 scaffold): 42 assertions on `:memory:` sqlite — export gate, lib code-shape (no `@/utils`, exactly one `db("o_assets")` read, zero write builders, whereRaw placeholder, selectWinnerInGroup reuse, no HTTP/registry reference, header direction doc), find-level mapping (deterministic / json fallback / missing row / NULL projectId / foreign project), and behavior (a) winner migration with is_winner demote/promote, (b) re-selection migration + idempotent zero-writes, (c) groupless node skip, (d) unmapped asset skip, (e) multi group skip, (f) json_extract fallback end-to-end, (xp) cross-project write guard, (err) injected failure swallowed, (g) eight route source-shape assertions incl. hook-after-update, true-only guard, void+.catch, unchanged 200 shape, and select-winner↛assets-registry loop prevention.

## Verification Evidence

- `npm run verify:phase-49-linkage` → exit 0, **42/42 assertions PASS** (plan required ≥8), no "SKIP: scaffold" residue
- `npx tsc --noEmit` → exit 0
- `grep -c "applyRegistrySelectionToCanvas" src/routes/v1/assets-registry/index.ts` → **2** (import + call)
- `grep -c '"db2.sqlite"' scripts/verify-phase-49-linkage.ts` → **0** (memory-only + chdir temp isolation; the app-db boot writes only under os.tmpdir())
- `npm run verify:phase-49` re-run → exit 0, **65/65 PASS** (no 49-01 regression)
- **Forced-failure sanity performed**: flipped assertion (a) to expect `a-oasset-FLIPPED` → run exited 1 → reverted (`git checkout`) → 42/42 exit 0 again
- `git diff` across the plan's commits touches exactly the three `files_modified` files

## TDD Gate Compliance

RED commit (`test(49-03)` 72016f22) precedes the feat commits (33a3939e, 125d1386); the RED run failed structurally (3/9 pass, exit 1) before the lib existed, and the gate transitioned to 42/42 as implementation landed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Gate's lib source-shape assertions initially scanned documentation prose**
- **Found during:** Task 1 GREEN (first gate run after implementing the lib)
- **Issue:** `!libSrc.includes("@/utils")` and the loop-prevention regex `!/assets-registry|fetch|axios|express/` failed against the module HEADER — which the plan's action text explicitly requires to document loop prevention by naming the registry route and the no-@/utils rule. The assertions tested prose, not code.
- **Fix:** gate now strips block/line comments into a `libCode` view for all code-shape assertions; the header-documentation check (`registry→canvas` present) still runs on the full source.
- **Files modified:** scripts/verify-phase-49-linkage.ts
- **Commit:** 33a3939e

### Plan-shape notes (no action needed)

- Route assertions (g) were authored in the RED gate and therefore still failed at the Task 1 GREEN checkpoint (37/42) — they turned green with Task 2's route hook, mirroring the staged-gate precedent recorded in 49-01-SUMMARY. Task 1's own verify spec (`tsc` + grep) was green at its commit.
- Task 2's file list includes the gate, but the gate reached its final content in the GREEN commit; Task 2's commit contains only the route hook (13 insertions).

## Authentication Gates

None.

## Known Stubs

None. The 49-01 scaffold placeholder (SKIP + exit 0) was wholly replaced by the real gate as the plan specifies; every linkage path is backed by real DB writes/skips asserted in the gate.

## Threat Flags

None — the implementation covers the plan's threat model (T-49-10 whereRaw placeholder asserted; T-49-11 never-throw + void/.catch asserted at lib and route level; T-49-12 projectId scoping asserted at find and write level; T-49-13 loop prevention asserted as source shape in both directions; T-49-SC zero new dependencies). No security-relevant surface beyond the plan.

## Self-Check: PASSED

src/lib/canvasAssetLinkage.ts exists on disk; scripts/verify-phase-49-linkage.ts and src/routes/v1/assets-registry/index.ts modified as committed; all 3 task commits (72016f22, 33a3939e, 125d1386) present in git log on gsd/w-49-03.
