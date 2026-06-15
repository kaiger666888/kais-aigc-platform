---
phase: 30-default-skill-seed-rest-api
plan: 02
subsystem: api
tags: [skill-contract, rest-api, express, verify-runner, merge-params]
requires:
  - phase: 30-01
    provides: "src/skills/defaultSkill.ts (MOVIE_V1_MANIFEST + seedDefaultIfEmpty) + boot wiring so movie-v1 is in the registry on empty-DB boot"
  - phase: 29-02
    provides: "registry singleton (register/get/list/phaseById/nodeTypeById/delete) + loader + o_skillRegistry table"
  - phase: 28-02
    provides: "validateManifest() + SkillManifest/NodeTypeDecl/PhaseDecl/ManifestValidationError types + zod v4 schema"
provides:
  - "5 REST endpoints under /api/v1/skills/* (API-01..API-05): list summaries, get full manifest, register new skill, fetch node-types, fetch phases"
  - "scripts/verify-phase-30.ts — 61-assertion regression runner proving SC #1-#5 end-to-end via in-process Express + transient :memory: SQLite"
  - "Express mergeParams pattern for /:skillId sub-routers — documents the Express 4 gotcha that mount-path params do not propagate without {mergeParams:true}"
affects:
  - "Phase 31 callback refactor: callbacks can now fetch skill metadata via GET /api/v1/skills/:skillId/phases instead of importing constants directly"
  - "Phase 32 canvas: GET /api/v1/skills/:skillId/node-types is the data source for canvas node-type registration"
  - "Phase 33 E2E: scripts/verify-phase-30.ts is the regression guard; POST /register malformed response shape (errors[0].ruleId) is the assertion target"
  - "OpenClaw client: codes against the D-04 response shapes verbatim ({ok, skills/skill/errors/node_types/phases})"
tech-stack:
  added: []
  patterns:
    - "Raw { ok, ... } response shape via res.status(N).send({...}) — deliberately NOT using legacy success()/error() helpers (their {code,data,message} wrapper doesn't match CONTEXT.md D-04)"
    - "Express.Router({ mergeParams: true }) for sub-routers whose mount path carries :params — required because Express 4 does not propagate mount-path params into sub-router req.params by default"
    - "Literal-path-first Express route ordering: /api/v1/skills/register (route238) is mounted BEFORE /api/v1/skills/:skillId (route239) so 'register' isn't captured as a skillId"
    - "Register endpoint skips validateFields middleware and calls validateManifest() directly — preserves structured ManifestValidationError[] shape for Phase 33 negative-test assertions"
    - "Indirect handler testing (Option A): valid-register test replicates the handler's three-step flow (validate → UPSERT → registry.register) against a transient :memory: DB rather than invoking the real handler, avoiding singleton db2.sqlite side effects"
key-files:
  created:
    - src/routes/v1/skills/list.ts
    - src/routes/v1/skills/get.ts
    - src/routes/v1/skills/register.ts
    - src/routes/v1/skills/node-types.ts
    - src/routes/v1/skills/phases.ts
    - scripts/verify-phase-30.ts
  modified:
    - src/router.ts
key-decisions:
  - "Used express.Router({ mergeParams: true }) on the 3 /:skillId sub-routers — Express 4 does not propagate mount-path params into sub-router req.params by default, so req.params.skillId was undefined at runtime until mergeParams was enabled"
  - "Added process.exit(0) at the end of verify-phase-30.ts main() — importing the route files transitively pulls in @/utils/db, whose Knex connection to db2.sqlite holds the Node event loop open. verify-phase-29 didn't need this because it only imports from src/skills/*"
  - "Test 6 (valid register) uses Option A (indirect) — replicates the handler's flow against a transient :memory: DB rather than invoking the real register handler, which would call the singleton db. The handler's validate-then-400 path is still exercised end-to-end via Test 5 (malformed manifest) using real fetch against the in-process Express app"
  - "Typed req.params explicitly via Request<{ skillId: string }> generic on the 3 /:skillId handlers — Express infers req.params from the handler path string, and since the handler path is the bare '/' (mount path carries :skillId), the inferred type was {}"
requirements-completed: [API-01, API-02, API-03, API-04, API-05]
metrics:
  duration: "~25min"
  completed: "2026-06-15"
  tasks: 2
  files: 7
---

# Phase 30 Plan 02: Skills REST API (5 endpoints) + verify-phase-30 runner Summary

Shipped the 5-endpoint REST surface under `/api/v1/skills*` (list summaries, get full manifest, register new skill, fetch node-types, fetch phases) with raw D-04 response shapes — closing API-01 through API-05. Plus a 61-assertion regression runner that proves all 5 Phase 30 success criteria end-to-end against an in-process Express app and a `:memory:` SQLite instance.

## What Was Built

### 5 route files (src/routes/v1/skills/)

Each file follows the existing v1 route file shape (`express.Router()` + `export default router.<method>(...)`) but deliberately does NOT use the legacy `success()`/`error()` helpers — their `{code, data, message}` wrapper does not match CONTEXT.md D-04 response shapes like `{ ok: true, skills: [...] }`. Handlers return raw JSON via `res.status(N).send({...})`.

1. **`list.ts`** (route237, mounted at `/api/v1/skills`) — `GET /` returns `200 { ok: true, skills: [...] }`. Each summary has exactly `{skill_id, version, display_name, description, registered_at}`. `registered_at` is platform metadata not in the manifest; it's fetched via a side `SELECT skill_id, registered_at FROM o_skillRegistry` and merged by skill_id (API-01 verbatim).

2. **`get.ts`** (route239, mounted at `/api/v1/skills/:skillId`) — `GET /` returns `200 { ok: true, skill: <full SkillManifest> }` for a known skill, or `404 { ok: false, error: "skill '<skillId>' not found" }` for unknown. NO fallback to movie-v1 (Phase 29 design decision).

3. **`register.ts`** (route238, mounted at `/api/v1/skills/register`) — `POST /` calls `validateManifest(req.body)` directly (skips `validateFields` middleware per D-05 so structured errors are echoed verbatim). On failure: `400 { ok: false, errors: result.errors }`. On success: UPSERT into `o_skillRegistry` via `.onConflict("skill_id").merge()`, then `registry.register(manifest)` to hydrate the cache without restart. Returns `201 { ok: true, skill: { skill_id, version, display_name } }`.

4. **`node-types.ts`** (route240, mounted at `/api/v1/skills/:skillId`) — `GET /node-types` returns `200 { ok: true, node_types: <NodeTypeDecl[]> }` for known, 404 for unknown.

5. **`phases.ts`** (route241, mounted at `/api/v1/skills/:skillId`) — `GET /phases` returns `200 { ok: true, phases: <PhaseDecl[]> }` for known, 404 for unknown.

### router.ts wiring (route237-241)

5 new `import routeNNN from "./routes/v1/skills/..."` lines (after route236) + 5 new `app.use()` registrations (after route236's app.use). CRITICAL ORDERING: `/api/v1/skills/register` (route238, literal) is registered BEFORE `/api/v1/skills/:skillId` (route239, parameterized) so the literal string "register" is not captured as a skillId parameter.

route239/240/241 share the same mount path `/api/v1/skills/:skillId` but expose different sub-paths (`/`, `/node-types`, `/phases`), so they don't conflict. Express tries them in registration order.

### scripts/verify-phase-30.ts (61 assertions, all pass)

Standalone `tsx` script following the `scripts/verify-phase-29.ts` pattern (local `assert()` helper, `results: TestResult[]`, `main()` async driver, exit codes 0/1/2). 6 test blocks:

- **Test 1** (22 assertions) — `seedDefaultIfEmpty` against fresh `:memory:` table: returns true, inserts row, registry has movie-v1. Spot-checks 3 phases (storyboard/scenario/art-direction) against `PHASE_ORDER` + `REVIEW_REQUIRED_PHASES` + `PHASE_INGEST_MAP` constants (SC #5 derivation proof). Re-seed returns false, no duplicate row (idempotency).
- **Test 2** (7 assertions) — `GET /api/v1/skills` via in-process Express: status 200, body.ok true, skills array, summary shape is EXACTLY `{skill_id, version, display_name, description, registered_at}` (no full-manifest leak), registered_at is a number.
- **Test 3** (7 assertions) — `GET /api/v1/skills/:skillId`: known returns 200 + full manifest with 12-phase taxonomy; unknown returns 404 with exact error string.
- **Test 4** (12 assertions) — `GET /:skillId/node-types` + `/:skillId/phases`: known returns declared arrays (5 node types, 12 phases); unknown returns 404.
- **Test 5** (6 assertions) — `POST /register` malformed (bare node type "script" → NODE_ID_NAMESPACING): status 400, body.ok false, errors array non-empty, errors[0].ruleId === "NODE_ID_NAMESPACING" (Phase 33 assertion target), no DB mutation, no registry mutation, GET /bad-skill returns 404.
- **Test 6** (7 assertions) — `POST /register` valid (Option A indirect): validateManifest passes, transientDb UPSERT succeeds, registry.register succeeds, registry.get returns the fixture, DB row exists, round-trip GET via in-process app returns 200 with the fixture's skill_id.

## Performance

- **Duration:** ~25 min
- **Tasks:** 2
- **Files modified:** 7 (5 new route files + router.ts + verify-phase-30.ts)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create 5 route files + wire router.ts (routes 237-241)** — `268546b` (feat)
2. **Task 2: verify-phase-30.ts runner + mergeParams fix for /:skillId routes** — `f9500e3` (feat)

## Files Created/Modified

- `src/routes/v1/skills/list.ts` (new) — GET /api/v1/skills summary list with registered_at side SELECT
- `src/routes/v1/skills/get.ts` (new) — GET /api/v1/skills/:skillId full manifest or 404
- `src/routes/v1/skills/register.ts` (new) — POST /api/v1/skills/register validateManifest + UPSERT + registry.register
- `src/routes/v1/skills/node-types.ts` (new) — GET /:skillId/node-types declared array
- `src/routes/v1/skills/phases.ts` (new) — GET /:skillId/phases declared array
- `src/router.ts` (modified) — 5 new imports + 5 new app.use() registrations (route237-241)
- `scripts/verify-phase-30.ts` (new) — 61-assertion regression runner

## Decisions Made

1. **`express.Router({ mergeParams: true })` on the 3 `/:skillId` sub-routers** — Express 4 does NOT propagate mount-path params into a sub-router's `req.params` when the handler path is the bare `/`. Without mergeParams, `req.params.skillId` was undefined at runtime, causing every known-skill lookup to return 404. This is a deviation from the plan's assumption (see Deviations below).

2. **`process.exit(0)` at the end of verify-phase-30.ts main()** — importing the route files transitively pulls in `@/utils` → `@/utils/db.ts`, whose Knex connection to db2.sqlite holds the Node event loop open. verify-phase-29 didn't need this because it only imports from `src/skills/*`. The explicit exit ensures the runner terminates cleanly after all assertions pass.

3. **Test 6 uses Option A (indirect testing)** — per the plan's explicit guidance. The valid-register test replicates the handler's three-step flow (validate → UPSERT → registry.register) against a transient `:memory:` DB, rather than invoking the real register handler which would call the singleton db. The handler's validate-then-400 path is still exercised end-to-end via Test 5 (malformed manifest) using real `fetch` against the in-process Express app — that path returns 400 BEFORE any `u.db(...)` call.

4. **Explicit `Request<{ skillId: string }>` generic** on the 3 `/:skillId` handlers — Express infers `req.params` from the handler path string, and since the handler path is the bare `/` (mount path carries `:skillId`), the inferred type was `{}`. The generic makes destructuring type-check cleanly.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Express 4 mount-path params do not propagate into sub-router req.params**
- **Found during:** Task 2 (verify-phase-30.ts first run — Test 3, 4, 6 round-trip all returned 404 with "skill 'undefined' not found")
- **Issue:** The plan assumed that mounting a sub-router at `/api/v1/skills/:skillId` and exposing `router.get("/", handler)` would populate `req.params.skillId` inside the handler. This is incorrect for Express 4 — mount-path params are stored in a parent-params object that the sub-router does NOT automatically merge into its handlers' `req.params`. The result was `req.params.skillId === undefined` at runtime, causing every known-skill lookup to hit the 404 branch.
- **Fix:** Changed `express.Router()` to `express.Router({ mergeParams: true })` in get.ts, node-types.ts, and phases.ts. The `mergeParams` option (added in Express 4.x) explicitly merges the parent (mount) params into the sub-router's `req.params`.
- **Files modified:** src/routes/v1/skills/get.ts, src/routes/v1/skills/node-types.ts, src/routes/v1/skills/phases.ts
- **Verification:** Re-ran `npx tsx scripts/verify-phase-30.ts` — all 61 assertions pass, including the 15 that previously failed (Test 3 known-skill lookup, Test 4 node-types/phases for known skill, Test 6 round-trip GET).
- **Committed in:** `f9500e3` (Task 2 commit)

**2. [Rule 3 - Blocking] verify-phase-30.ts process did not exit cleanly after all assertions passed**
- **Found during:** Task 2 (first run of verify-phase-30.ts — process hung after printing "61 passed, 0 failed")
- **Issue:** Importing the route files (required to mount them on the in-process Express app) transitively pulls in `@/utils` → `@/utils/db.ts`, whose Knex connection to db2.sqlite holds the Node event loop open. Unlike verify-phase-29 (which only imports from `src/skills/*` and exits naturally), this runner's transitive imports keep a DB connection alive.
- **Fix:** Added `process.exit(0)` at the end of `main()` after the summary log, with a comment explaining why. The failure path (`process.exit(1)`) and uncaught-exception path (`process.exit(2)`) were already in place.
- **Files modified:** scripts/verify-phase-30.ts
- **Verification:** Re-ran `npx tsx scripts/verify-phase-30.ts` — process exits with code 0 immediately after the summary.
- **Committed in:** `f9500e3` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 bug, 1 blocking)
**Impact on plan:** Both auto-fixes are necessary for the runner to prove the success criteria. The mergeParams fix is also a production correctness fix — without it, the live `/api/v1/skills/:skillId` endpoints would return 404 for every known skill. No scope creep.

## Verification Results

| Check | Expected | Actual | Status |
|-------|----------|--------|--------|
| `npx tsc --noEmit` | 0 errors | 0 errors | PASS |
| All 5 route files exist under `src/routes/v1/skills/` | yes | yes | PASS |
| Each route file contains `router.get` or `router.post` | yes | yes (×5) | PASS |
| `src/router.ts` imports route237-241 from correct paths | yes | yes (×5) | PASS |
| `src/router.ts` registers all 5 routes via `app.use()` | yes | yes (×5) | PASS |
| `/api/v1/skills/register` (literal) mounted BEFORE `/:skillId` | yes | line 488 before line 489 | PASS |
| register.ts does NOT import `validateFields` | yes | yes (only mentioned in comments) | PASS |
| register.ts branches on `result.ok` and returns 400 with errors verbatim | yes | yes | PASS |
| register.ts calls `registry.register(manifest)` AFTER DB UPSERT | yes | yes | PASS |
| get/node-types/phases return 404 for unknown skills (no movie-v1 fallback) | yes | yes | PASS |
| `express.Router({ mergeParams: true })` on the 3 /:skillId sub-routers | yes | yes (×3) | PASS |
| `tsx scripts/verify-phase-30.ts` exits 0 | yes | yes | PASS |
| `tsx scripts/verify-phase-30.ts` all assertions pass | 61/61 | 61/61 | PASS |
| Runner does NOT directly import `src/utils/db` | yes | yes (only transitively via route files) | PASS |
| POST /register malformed returns `errors[0].ruleId === "NODE_ID_NAMESPACING"` | yes | yes | PASS |

## Issues Encountered

- First run of verify-phase-30.ts had 15 failing assertions (Test 3 known-skill lookup, Test 4 node-types/phases for known skill, Test 6 round-trip GET). Root cause: Express 4 mount-path params do not propagate into sub-router `req.params` without `mergeParams: true`. Fixed inline (see Deviations #1).
- After fixing the mergeParams issue, the verify process hung after printing the summary. Root cause: the transitive `@/utils/db` import holds a Knex connection open. Fixed with explicit `process.exit(0)` (see Deviations #2).

## User Setup Required

None — no external service configuration required. The new endpoints ride on the existing Express server boot path (no new env vars, no new infrastructure).

## Next Phase Readiness

- **Phase 31 (callback refactor):** callbacks can replace direct constant imports with `GET /api/v1/skills/movie-v1/phases` lookups (or direct `registry.phaseById('movie-v1', phaseId)` calls — the REST surface is for external clients; internal platform code uses the registry directly).
- **Phase 32 (canvas):** `GET /api/v1/skills/:skillId/node-types` is the data source for canvas node-type registration.
- **Phase 33 (E2E):** `scripts/verify-phase-30.ts` is the regression guard. The POST /register malformed response shape (`errors[0].ruleId`) is the negative-test assertion target. The runner exercises the real register handler end-to-end for the malformed case (Test 5), proving the validate-then-400 path works through the full Express stack.
- **OpenClaw lockstep:** the D-04 response shapes (`{ ok, skills/skill/errors/node_types/phases }`) are now contract-stable. The OpenClaw client can be coded against them.

## Self-Check: PASSED

- [x] `src/routes/v1/skills/list.ts` exists — GET /api/v1/skills with registered_at side SELECT
- [x] `src/routes/v1/skills/get.ts` exists — GET /:skillId with mergeParams + Request generic
- [x] `src/routes/v1/skills/register.ts` exists — POST / with validateManifest → UPSERT → registry.register
- [x] `src/routes/v1/skills/node-types.ts` exists — GET /:skillId/node-types with mergeParams
- [x] `src/routes/v1/skills/phases.ts` exists — GET /:skillId/phases with mergeParams
- [x] `src/router.ts` modified — route237-241 imported and registered, literal /register before /:skillId
- [x] `scripts/verify-phase-30.ts` exists — 61 assertions, all pass, exits 0
- [x] Commit `268546b` exists in git log (Task 1)
- [x] Commit `f9500e3` exists in git log (Task 2)
- [x] `npx tsc --noEmit` exits 0
- [x] `npx tsx scripts/verify-phase-30.ts` exits 0 with "61 passed, 0 failed"
