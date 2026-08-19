---
phase: 49-selection-write-back-canvas-endpoint-asset-center-linkage-km
plan: "01"
subsystem: api
tags: [express, knex, better-sqlite3, zod, canvas, variant-groups, o-assets, tdd]

requires:
  - phase: 48-canvas-relational-store
    provides: canvas_nodes / canvas_variant_groups relational tables + canvasRelationalStore module
provides:
  - selectWinnerInGroup(trxDb, scope, groupId, winnerNodeId) — transactional winner write with full error semantics (updated/idempotent/not_found/not_in_group/multi_mode)
  - syncAssetPrimaryForWinner(trxDb, projectId, winnerOAssetId, memberOAssetIds) — D-07 scoped o_assets isPrimaryView swap (project-scoped, family+member demote set, empty-guard)
  - POST /api/canvas/v2/variant-groups/:groupId/select-winner endpoint (route167) with zod validation and 404/409x2/400/200 semantics
  - npm run verify:phase-49 behavioral gate (65 assertions) + verify:phase-49-bridge / verify:phase-49-linkage scaffold entries for wave-2
affects: [49-02 review bridge, 49-03 registry→canvas linkage, 49-04 kmc integration]

tech-stack:
  added: []  # no new libraries — express/knex/better-sqlite3/zod already in repo
  patterns:
    - "status-object store functions: store returns a discriminated status union, route maps status→HTTP code (no HTTP knowledge in the store layer)"
    - "D-07 direct-knex reverse linkage: cross-domain writes go through the store's own knex handle inside a warn-only try/catch, never via HTTP self-call"
    - "verify harness child-process isolation: live express dispatch runs in a spawned child with its own chdir temp db when sharing a process with a :memory: section corrupts the knex pool"

key-files:
  created:
    - src/routes/canvas/v2/select-winner.ts
    - scripts/verify-phase-49.ts
    - scripts/verify-phase-49-bridge.ts
    - scripts/verify-phase-49-linkage.ts
  modified:
    - src/lib/canvasRelationalStore.ts
    - src/router.ts
    - src/lib/initDB.ts
    - package.json

key-decisions:
  - "Winner truth = canvas_variant_groups.winner_node_id + canvas_nodes.is_winner columns; the node data JSON blob is deliberately NOT rewritten (v3 adapter treats group-level winnerNodeId as authoritative)"
  - "Idempotent branch returns BEFORE the D-07 swap and before broadcastToProject — re-selecting the same winner carries no new information (D-03)"
  - "D-07 failure isolation: syncAssetPrimaryForWinner runs in a warn-only try/catch after canvas commit — canvas is the truth source, o_assets lag must not fail the selection"
  - "Route registered as route167 (next free number after route166 tts), NOT route28 — route28 is taken by notion-proxy (exec-note verified against router.ts tail)"
  - "All three verify:phase-49* npm entries registered once in 49-01 so wave-2 plans replace their scaffold files without same-wave package.json conflicts"

patterns-established:
  - "Pattern: discriminated-status store function + thin status→HTTP route mapping"
  - "Pattern: generated-at-runtime child verify script inside scripts/ (tsx only resolves @/ aliases inside the repo tree), deleted in finally"

requirements-completed: [SELECT-01]

duration: 51min
completed: 2026-08-19
---

# Phase 49 Plan 01: Select-Winner Store + Endpoint Summary

**Transactional variant-group winner selection (selectWinnerInGroup + POST /api/canvas/v2/variant-groups/:groupId/select-winner) with D-07 o_assets isPrimaryView reverse swap, guarded by a 65-assertion behavioral gate.**

## Performance

- **Duration:** 51 min (02:24–03:15 UTC)
- **Started:** 2026-08-19T02:24:09Z
- **Completed:** 2026-08-19T03:15:15Z
- **Tasks:** 3/3
- **Files modified:** 8 (4 created, 4 modified)

## Commits

| Task | Commit | Type |
| ---- | ------ | ---- |
| Task 1 RED | aeebd0fa | test(49-01): add failing gate for selectWinnerInGroup + syncAssetPrimaryForWinner |
| Task 1 GREEN | 93f91ca1 | feat(49-01): implement transactional selectWinnerInGroup + D-07 syncAssetPrimaryForWinner |
| Task 2 | c3ed2722 | feat(49-01): add POST select-winner endpoint with D-07 hook (route167) |
| Task 3 | 55810b0e | test(49-01): register phase-49 verify gates + wave-2 scaffolds |

## Accomplishments

- **Store functions** (`src/lib/canvasRelationalStore.ts`): `selectWinnerInGroup` validates ordered short-circuit (not_found → multi_mode → not_in_group → idempotent zero-writes → updated single transaction); the updated path demotes all member rows and promotes the winner inside one `trxDb.transaction` (atomicity verified by injected-failure rollback assertion). `syncAssetPrimaryForWinner` swaps o_assets isPrimaryView scoped to projectId + (assetsId family ∪ member ids), with an empty-scope guard that prevents project-wide demotion and no-op `[]` returns for null/missing mappings.
- **Endpoint** (`src/routes/canvas/v2/select-winner.ts`): zod schema (projectId/episodesId number, winnerNodeId string min1 max128 — T-49-01), status→HTTP mapping (404 变体组不存在 / 409 winnerNodeId 不在组内 / 409 仅 single 组支持选定 / 400 参数校验失败 / 200 applied true|false), warn-only try/catch around the D-07 swap, `variant:selected` broadcast only on the updated path, and the `// [49-02] review bridge hook mounts here` seam.
- **Mount** (`src/router.ts`): `import route167` + `app.use("/api/canvas/v2/variant-groups", route167)` directly after the sync-assets mount.
- **Behavioral gate** (`scripts/verify-phase-49.ts`, 65 assertions): store-level updated/idempotent/dangling-winner/error-semantics/prefix-fallback/D-07 swap + cross-project guard/transaction rollback on a `:memory:` knex with production-DDL mirrors, plus endpoint-level live dispatch (all 404/409×2/400×3/200-updated/200-idempotent cases incl. DB persistence and D-07 effects) through the real express router.
- **Wave-2 scaffolds**: `verify-phase-49-bridge.ts` / `verify-phase-49-linkage.ts` print the SKIP marker and exit 0; all three npm entries registered in package.json after `verify:phase-48`.

## Verification Evidence

- `npm run verify:phase-49` → exit 0, **65/65 assertions PASS** (plan required ≥18)
- `npm run verify:phase-49-bridge` / `verify:phase-49-linkage` → exit 0, SKIP marker printed
- `npx tsc --noEmit` → exit 0
- `grep -c '"db2.sqlite"' scripts/verify-phase-49.ts` → **0** (memory-only, production DB never opened; isolation additionally via chdir into a throwaway temp dir before any dynamic import)
- `grep -c "verify:phase-49" package.json` → **3**
- **Forced-failure sanity performed**: temporarily flipped the `variantIndex === 2` expectation to `3` → run exited 1 with exactly `FAIL: updated: variantIndex = 2 (1-based position of node-b) — actual: 2` → reverted (file restored, re-verified green).

## Naming Distinction (exec note)

This plan's gate is `scripts/verify-phase-49.ts` + `npm run verify:phase-49`. The pre-existing `scripts/verify-phase-49-core.ts` belongs to an unrelated GPU plan in the same phase number space and was not touched.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1/3 - Bug] Fresh-DB boot crash in `migrateSnapshotsToRelational`**
- **Found during:** Task 2 (endpoint gate booted the real db.ts against an empty temp dir)
- **Issue:** `src/lib/initDB.ts` queried `o_agentWorkData` for canvasGraph snapshots BEFORE the main-tables loop created that table — on a brand-new database the boot IIFE aborted (`no such table: o_agentWorkData`), killing initDB before core tables existed. Latent production bug for any fresh install.
- **Fix:** `if (!(await knex.schema.hasTable("o_agentWorkData"))) { skip snapshot migration }` guard at the top of the function.
- **Files modified:** src/lib/initDB.ts
- **Commit:** c3ed2722

**2. [Rule 3 - Blocker] fixDB circular-import kills isolated boot**
- **Found during:** Task 2/3 harness construction
- **Issue:** rooting the dynamic-import graph at `canvasRelationalStore` leaves the `@/utils` barrel's `db` re-export undefined when `fixDB.ts` (`u.db("o_vendorConfig")`) evaluates → `[db] boot failed: u.db is not a function`.
- **Fix (harness-side, no source change):** the verify script imports the `../src/utils` barrel FIRST, mirroring the app's module-graph root. Documented inline in scripts/verify-phase-49.ts.

**3. [Rule 3 - Blocker] Endpoint dispatch moved into a spawned child process**
- **Found during:** Task 2
- **Issue:** after running the long `:memory:` store section, the app-db knex pool in the SAME process never settles inserts (verified across multiple runs; standalone probe processes boot + insert fine in ~1.3s, so the code under test is sound — tsx/isolated-boot environment artifact).
- **Fix:** live endpoint dispatch runs in a generated child script (`scripts/.verify-phase-49-endpoint.tmp.ts`, written inside the repo tree because tsx only resolves `@/` aliases there, deleted in `finally`) that does its own mkdtemp/chdir isolation, boots the real db, seeds the fixture row-per-row (batch UNION-ALL inserts also never settle on this pool), and reports tab-separated `CHILD_RESULT` lines the parent folds into the shared results table.
- **Files modified:** scripts/verify-phase-49.ts
- **Commit:** c3ed2722

**4. [Rule 1 - Bug] Vacuous regex assertion in the gate**
- **Found during:** Task 3 `tsc --noEmit`
- **Issue:** the try/catch-warn source-shape assertion passed a bare RegExp (always truthy) instead of calling `.test(routeSrc)` — it could never fail, and TS flagged it.
- **Fix:** added `.test(routeSrc)`.
- **Files modified:** scripts/verify-phase-49.ts
- **Commit:** 55810b0e (as part of the gate green state)

**5. [Rule 1 - Bug] Mock res never settled the dispatch promise**
- **Found during:** Task 2 debugging
- **Issue:** the harness's `callEndpoint` promise resolved only on express `next()` — but a handler that responds via `res.send()` never calls next, so every successful dispatch hung (this, not the pool, was the child's first stall after instrumentation).
- **Fix:** mock res settles on the first of send/json/end/writeHead.
- **Files modified:** scripts/verify-phase-49.ts
- **Commit:** c3ed2722

### Plan-shape notes (no action needed)

- Route mounted as **route167**, not the plan's speculative route28 — route28 is notion-proxy (exec note; verified against router.ts tail).
- Task 1's TDD RED commit authored the harness file that Task 3 formally registers (`verify-phase-49.ts` appears in both tasks' file lists; the RED/GREEN gates were enforced at Task 1, the npm registration at Task 3).
- The store reads member rows once BEFORE the idempotent branch (the plan sketched the idempotent check as group-row-only); this keeps variantIndex/winnerPhaseName meaningful on idempotent results — behavior superset of the plan, asserted by the gate.

## Authentication Gates

None.

## Known Stubs

- `scripts/verify-phase-49-bridge.ts` and `scripts/verify-phase-49-linkage.ts` are **intentional** plan-specified placeholders (SKIP + exit 0); 49-02 and 49-03 wholly replace them per the handoff design. The `// [49-02] review bridge hook mounts here` comment in the route is the plan-specified bridge seam, deliberately not implemented in this plan.
- No data-flow stubs: every endpoint response field is backed by real DB writes verified by the gate.

## Threat Flags

None — the implementation covers the plan's threat model (T-49-01 zod maxLength 128 asserted live; T-49-02 parameterized builders only, asserted by source-shape grep; T-49-03 atomic transaction + broadcast trail asserted; T-49-04 D-07 scoped swap with cross-project guard asserted). No security-relevant surface beyond the plan.

## Self-Check: PASSED

All 5 key created files exist on disk; all 4 task commits (aeebd0fa, 93f91ca1, c3ed2722, 55810b0e) found in git log.
