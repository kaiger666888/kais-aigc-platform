---
phase: 30-default-skill-seed-rest-api
reviewed: 2026-06-15T00:00:00Z
fixed: 2026-06-15T00:00:00Z
depth: standard
files_reviewed: 11
files_reviewed_list:
  - src/skills/defaultSkill.ts
  - src/utils/db.ts
  - src/routes/v1/pipeline/callback/phase-complete.ts
  - src/routes/v1/pipeline/resume.ts
  - src/routes/v1/skills/list.ts
  - src/routes/v1/skills/get.ts
  - src/routes/v1/skills/register.ts
  - src/routes/v1/skills/node-types.ts
  - src/routes/v1/skills/phases.ts
  - src/router.ts
  - scripts/verify-phase-30.ts
findings:
  critical: 2
  warning: 8
  info: 4
  total: 14
status: clean_with_deferrals
---

# Phase 30: Code Review Report

**Reviewed:** 2026-06-15
**Fixed:** 2026-06-15
**Depth:** standard
**Files Reviewed:** 11
**Status:** clean_with_deferrals (6 findings addressed; see Fix Log below)

## Summary

Phase 30 ships a self-seeding default skill manifest plus a 5-endpoint REST surface under `/api/v1/skills/*`. The structure is reasonable and the validator-gated POST `/register` path is correctly implemented (validate-before-DB-write). However, the implementation has **two security-relevant blockers** and a cluster of correctness issues that should be addressed before merge:

1. **POST `/api/v1/skills/register` is completely unauthenticated** — anyone who can reach the platform can insert or overwrite any skill manifest in the database. The code comments acknowledge "trusted internal network; auth in v1.7+" but the threat model is not enforced anywhere, and the UPSERT semantics mean a malicious caller can mutate the live registry cache for `movie-v1` (or any registered skill) at runtime.
2. **Boot race condition** — the boot IIFE in `src/utils/db.ts` is `async` and un-awaited, but the module exports the db client synchronously at the bottom. Any first-request code path that reaches the registry/DB before `seedDefaultIfEmpty` completes will see an empty registry and a not-yet-seeded table. The `await` ordering inside the IIFE is correct, but the IIFE itself runs concurrently with HTTP server startup.

Additional correctness concerns: the `active: 1` filter that the loader applies is **not** mirrored in `list.ts`'s side SELECT (stale registered_at for deactivated skills leaks into the summary), and the POST handler accepts `req.body` from a 100MB JSON body limit with no size cap specific to manifest registration.

The verify-phase-30.ts runner is solid as a regression guard, but it has one hermetic-test blind spot: Test 6 (valid register) does NOT exercise the real handler — it replicates the handler's flow against a transient DB. A bug introduced into the real handler's UPSERT/cache path would not be caught.

---

## Critical Issues

### CR-01: POST /api/v1/skills/register has no authentication or authorization

**File:** `src/routes/v1/skills/register.ts:45-95`
**Issue:**
The POST `/register` endpoint accepts an arbitrary manifest JSON body and writes it directly into `o_skillRegistry` via UPSERT, then mutates the live in-memory registry cache via `registry.register(manifest)`. There is no auth middleware, no API-key check, no role gate. The only barrier is `validateManifest()`.

The file header comment explicitly states this is acceptable for "v1.6 trusted internal network; auth in v1.7+" — but **nothing enforces the trusted-network assumption**. The platform's Express server (`src/app.ts:60`) mounts `express.json({ limit: "100mb" })` globally, so the only network boundary is whatever the deployment reverse-proxy provides. If the port is reachable (dev box, misconfigured proxy, SSRF from another internal service, exposed Docker port), an attacker can:

- Overwrite `movie-v1` in the live cache by POSTing a manifest with `skill_id: "movie-v1"` and a different phase_taxonomy / runtime endpoint. The next callback lookup (`registry.phaseById('movie-v1', ...)`) returns the attacker's values.
- Inject a skill whose `runtime.endpoint` points to an attacker-controlled host. Phase 31+ callback code (per the summary) will read phase taxonomy from the registry — a malicious `requires_review: false` on `quality-gate` would silently auto-approve pipelines.
- Trigger arbitrary `JSON.stringify` cost on a 100MB payload (DoS).

The UPSERT makes this worse than a simple insert — there is no append-only audit trail and no version pinning. `onConflict("skill_id").merge()` silently overwrites `registered_at`, `version`, and `manifest_json`.

**Fix:**
Add at minimum an API-key or shared-secret gate before this route ships, even in "trusted internal" mode. A minimal pattern:

```typescript
// src/middleware/requireSkillAdmin.ts
import { Request, Response, NextFunction } from "express";
export function requireSkillAdmin(req: Request, res: Response, next: NextFunction) {
  const expected = process.env.SKILL_REGISTRY_ADMIN_KEY;
  if (!expected) {
    return res.status(503).send({ ok: false, error: "skill registry admin key not configured" });
  }
  const provided = req.header("x-skill-admin-key");
  if (provided !== expected) {
    return res.status(401).send({ ok: false, error: "unauthorized" });
  }
  next();
}

// In register.ts:
import { requireSkillAdmin } from "@/middleware/requireSkillAdmin";
export default router.post("/", requireSkillAdmin, async (req, res) => { ... });
```

At minimum, fail closed (503) if no key is configured, rather than allowing open access.

---

### CR-02: Boot IIFE is fire-and-forget — race window before seedDefaultIfEmpty completes

**File:** `src/utils/db.ts:39-45`
**Issue:**
The boot IIFE is:

```typescript
(async () => {
  await initDB(db);
  await fixDB(db);
  await loadAllFromDB(db);
  await seedDefaultIfEmpty(db);
  if (process.env.NODE_ENV == "dev") initKnexType(db);
})();
```

This IIFE is **not awaited by the module's consumers**. `dbClient` is synchronously exported at line 47, and the route files import it at module load. The HTTP server (started by the entrypoint that consumes `src/router.ts`) can begin accepting requests before `seedDefaultIfEmpty(db)` resolves.

Concretely: if a request hits `GET /api/v1/skills` in the ~10-500ms window between server.listen() and the IIFE completing on a fresh-DB boot:
- `registry.list()` returns `[]` (the loader has not yet populated the cache).
- The list endpoint returns `{ ok: true, skills: [] }` — no `movie-v1` — even though the SC #1 success criterion says empty-DB boot must return movie-v1.
- `GET /api/v1/skills/movie-v1` returns 404 with `"skill 'movie-v1' not found"` — breaking SC #1 outright.

The verify-phase-30.ts runner masks this because Test 1 awaits `seedDefaultIfEmpty` explicitly before Test 2 starts, and the route imports trigger the same IIFE — but by Test 2 the IIFE has already finished. The end-to-end "fresh boot, immediate first request" case is never exercised.

**Fix:**
Export a `booted: Promise<void>` from `src/utils/db.ts` and have the HTTP entrypoint `await` it before calling `app.listen()`. Minimal pattern:

```typescript
export const booted = (async () => {
  await initDB(db);
  await fixDB(db);
  await loadAllFromDB(db);
  await seedDefaultIfEmpty(db);
  if (process.env.NODE_ENV === "dev") initKnexType(db);
})();
```

Then in the server bootstrap (wherever `app.listen` is called): `await booted; await new Promise(...app.listen...)`. This is a v1 boot-ordering bug that will manifest intermittently on cold starts.

---

## Warnings

### WR-01: list.ts side SELECT does not filter by `active = 1` — deactivated skills leak registered_at

**File:** `src/routes/v1/skills/list.ts:31`
**Issue:**
The loader correctly filters inactive rows with `.where("active", 1)` (`src/skills/loader.ts:50`), but `list.ts` queries the DB for `registered_at` without that filter:

```typescript
const rows = await u.db("o_skillRegistry").select("skill_id", "registered_at");
```

If a future admin flips `active = 0` on a skill (e.g., via a DELETE endpoint, or a SQL update), the in-memory registry correctly drops it, but the DB row remains. The merge at line 37 joins by skill_id only, so a deactivated skill's `registered_at` is never observed (because `registry.list()` no longer includes it). That part is currently safe — but the inverse is the bug: **if a skill is in the registry but its DB row was deactivated post-load**, the next list() call still works because `registered_at` is fetched unconditionally. The asymmetry between the loader's filter and the list handler's filter is a latent bug.

More concretely: if a future code path registers a skill in-memory only (without a DB row), `registeredAtById.get(m.skill_id)` returns `undefined`, which the `?? 0` coerces to `0`. The endpoint silently reports `registered_at: 0` for a skill the platform claims to know about. That's misleading data — it should either omit the field or report null.

**Fix:**
Mirror the loader's filter, or fetch all rows and let the join be authoritative:

```typescript
const rows = await u.db("o_skillRegistry").select("skill_id", "registered_at").where("active", 1);
```

### WR-02: list.ts handler has no try/catch — unhandled DB rejection yields 500 with no error shape

**File:** `src/routes/v1/skills/list.ts:27-46`
**Issue:**
The GET handler awaits `u.db("o_skillRegistry").select(...)` with no try/catch. If the DB is unreachable, the schema is missing, or the query errors (e.g., during a migration in flight), the promise rejects and Express's default error handler returns a 500 with HTML — not the contract's `{ ok: false, error: "..." }` shape.

The same issue exists in `get.ts`, `node-types.ts`, `phases.ts` — they read from the registry (which is sync and won't throw), so they're safer. But `list.ts` is the only one that touches the DB on the request path, and it's unprotected.

**Fix:**
Wrap the DB call:

```typescript
export default router.get("/", async (_req, res) => {
  let rows: { skill_id: string; registered_at: number | null }[];
  try {
    rows = await u.db("o_skillRegistry").select("skill_id", "registered_at");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).send({ ok: false, error: `database read failed: ${msg}` });
  }
  // ... rest
});
```

### WR-03: register.ts allows `skill_id` collision with `movie-v1` — silent overwrite of the default skill

**File:** `src/routes/v1/skills/register.ts:60-69`
**Issue:**
The UPSERT via `.onConflict("skill_id").merge()` will happily overwrite the seeded `movie-v1` row if a caller POSTs a manifest with `skill_id: "movie-v1"`. There is no check that the incoming skill_id differs from the platform default, no version-increment requirement, no audit log.

Combined with CR-01 (no auth), this means a remote attacker can replace the live `movie-v1` manifest in both DB and in-memory cache with a crafted payload that passes validation but has, e.g., `runtime.endpoint: "http://attacker.example.com"` or `phase_taxonomy` with `requires_review: false` on `quality-gate`.

Even in a trusted-network model, accidental overwrite is a risk: an operator testing a new manifest with a copy-pasted `skill_id` of `movie-v1` will silently replace the production default with no warning.

**Fix:**
At minimum, refuse to overwrite the platform-default skill_id without an explicit force flag:

```typescript
const PROTECTED_SKILL_IDS = ["movie-v1"];
if (PROTECTED_SKILL_IDS.includes(manifest.skill_id)) {
  const existing = await u.db("o_skillRegistry").where({ skill_id: manifest.skill_id }).first();
  if (existing) {
    return res.status(409).send({
      ok: false,
      error: `skill_id '${manifest.skill_id}' is protected — use a different id or DELETE first`,
    });
  }
}
```

Also consider requiring version monotonicity (`incoming.version > existing.version`).

### WR-04: register.ts accepts 100MB bodies — DoS vector via JSON.stringify + validation

**File:** `src/routes/v1/skills/register.ts:45-47`, `src/app.ts:60`
**Issue:**
The global body parser is `express.json({ limit: "100mb" })`. A POST `/register` with a 100MB JSON body will:
1. Be buffered into memory (100MB).
2. Be passed to `validateManifest(req.body)`, which runs zod `.strict()` recursively and two `.superRefine()` passes — CPU-bound work proportional to manifest size, blocking the event loop.
3. zod will likely reject (because the manifest schema doesn't allow unbounded arrays), but only after parsing the full payload.

The `node_types` and `phase_taxonomy` schemas use `z.array(...)` with no `.max()` cap, so an attacker can submit `node_types: [<10000 entries>]` and zod will validate every entry before rejecting. Combined with CR-01 (no auth), this is an unauthenticated DoS.

**Fix:**
Add a per-route body size limit and array-length caps:

```typescript
// In register.ts, before validation:
import { raw } from "body-parser";
// Or simpler — check Content-Length and req body size:
if (req.headers["content-length"] && Number(req.headers["content-length"]) > 256 * 1024) {
  return res.status(413).send({ ok: false, error: "manifest payload too large (max 256KB)" });
}
```

Also consider adding `.max(64)` to `node_types` and `.max(64)` to `phase_taxonomy` in the zod schema (a cross-cutting fix in `src/skills/validator.ts`).

### WR-05: `defaultSkill.ts` runtime endpoint hardcodes `http://localhost:8001`

**File:** `src/skills/defaultSkill.ts:169-173`
**Issue:**
The manifest declares:

```typescript
runtime: {
  type: "external-http",
  endpoint: "http://localhost:8001",
  healthcheck_path: "/health",
},
```

This is hardcoded. If the kais-movie-agent orchestrator runs on a different host/port (Docker, k8s, non-default deploy), the seeded manifest is wrong and must be overwritten via POST `/register`. There is no env-var override.

The comment says "matches existing kais-movie-agent deployment" — but the file is presented as a zero-config default. Operators who deploy in any non-default topology will silently get a manifest with a dead endpoint, and the platform has no healthcheck consumer yet but Phase 31+ may add one.

**Fix:**
Read from env with a fallback:

```typescript
endpoint: process.env.MOVIE_V1_AGENT_ENDPOINT ?? "http://localhost:8001",
healthcheck_path: process.env.MOVIE_V1_AGENT_HEALTHCHECK_PATH ?? "/health",
```

### WR-06: `seedDefaultIfEmpty` uses `Date.now()` for `registered_at` — not idempotent on re-register

**File:** `src/skills/defaultSkill.ts:254`
**Issue:**
The seed writes `registered_at: Date.now()`. This is fine on first seed, but if the function is ever called again on an empty table (e.g., after a `DELETE FROM o_skillRegistry`), the timestamp changes. More importantly, it diverges from the manifest's own `version` semantic — there is no stable "first registered at" timestamp.

Minor concern: the verify-phase-30.ts Test 2 asserts `typeof movieSummary.registered_at === "number"` — fine — but the value is nondeterministic, which makes snapshot tests brittle in Phase 33+.

**Fix:**
Consider a fixed epoch for the default seed (e.g., 0 or a build timestamp embedded at compile time), or document that `registered_at` reflects "last UPSERT time" not "first registration time" in the contract.

### WR-07: `mapIngest` casts `string[]` to `IngestOutput[]` without validating the vocabulary

**File:** `src/skills/defaultSkill.ts:56-59`
**Issue:**
```typescript
function mapIngest(arr: string[]): IngestOutput[] {
  if (arr.length === 0) return ["none"];
  return arr as IngestOutput[];
}
```

The `as IngestOutput[]` cast is unchecked. If `PHASE_INGEST_MAP` ever contains a value outside the `["images", "videos", "storyboard", "audio", "none"]` enum (e.g., someone adds `"clips"` to the map), the runtime value flows into `MOVIE_V1_MANIFEST.phase_taxonomy[].ingest_outputs`, then through the module-load-time `validateManifest()` self-check — **which will catch it** and throw. So the failure mode is safe (boot crashes loudly), but the cast itself hides the type mismatch until validation runs.

The comment at line 50-52 acknowledges this ("the zod schema will reject anything outside that set") — which is true — but the cast suppresses the compile-time signal that the source map's values are wider than the contract's vocabulary. A future maintainer adding a new ingest category to `PHASE_INGEST_MAP` will get no TypeScript warning, only a runtime boot failure.

**Fix:**
Narrow the type at the source — declare `PHASE_INGEST_MAP` as `Record<string, IngestOutput[]>` in `phase-complete.ts`. Then no cast is needed in `mapIngest`.

```typescript
// phase-complete.ts
import type { IngestOutput } from "@/skills/contract";
export const PHASE_INGEST_MAP: Record<string, IngestOutput[]> = { ... };
```

### WR-08: `db.ts` uses `==` instead of `===` for NODE_ENV check

**File:** `src/utils/db.ts:44`
**Issue:**
```typescript
if (process.env.NODE_ENV == "dev") initKnexType(db);
```

`process.env.NODE_ENV` is typed `string | undefined`. Using `==` instead of `===` is a known footgun: `undefined == "dev"` is `false` (correct here), but `null == undefined` is `true` and other coercions can bite. The rest of the codebase should be checked for consistency, but in boot-critical code the strict check is non-negotiable.

This is a code-quality issue with a tiny correctness risk, not a live bug — but it's exactly the kind of thing a strict review should flag in newly-touched code.

**Fix:**
```typescript
if (process.env.NODE_ENV === "dev") initKnexType(db);
```

---

## Info

### IN-01: `PHASE_ORDER` is typed `Record<string, number>` — not the canonical 12-phase union

**File:** `src/routes/v1/pipeline/resume.ts:14`
**Issue:**
The hoisted constant is typed loosely:

```typescript
export const PHASE_ORDER: Record<string, number> = {
  requirement: 0,
  "art-direction": 1,
  // ...
};
```

This means `PHASE_ORDER["nonexistent"]` type-checks as `number`, not `number | undefined`. The downstream `buildPhaseTaxonomy()` iterates `Object.keys(PHASE_ORDER)` which is safe, but if any future code path looks up a phase by string, it will silently get `undefined` at runtime while TypeScript insists it's a `number`.

**Fix:**
Use a mapped type or explicit union of keys:

```typescript
export type MovieV1Phase =
  | "requirement" | "art-direction" | "character" | "scenario" | "voice" | "storyboard"
  | "scene" | "camera-preview" | "camera-final" | "post-production" | "quality-gate" | "delivery";
export const PHASE_ORDER: Record<MovieV1Phase, number> = { ... };
```

### IN-02: Test 6 in verify-phase-30.ts does NOT exercise the real register handler

**File:** `scripts/verify-phase-30.ts:515-571`
**Issue:**
Per the summary, Test 6 uses "Option A (indirect)" — it replicates the handler's flow against a transient DB rather than invoking `registerRoute` via the in-process Express app. This means:
- A typo in the real handler's UPSERT column names (e.g., `skill_id` vs `skillId`) would not be caught by Test 6.
- A regression in `registry.register()`'s error path inside the handler would not be caught.
- The mergeParams fix that was needed for GET routes is not exercised for the POST route.

The header comment justifies this as "keeps the valid-register test hermetic" — but hermeticity that bypasses the code-under-test is a false signal. Test 5 (malformed) does invoke the real handler, so the validate-then-400 path is covered. The happy path is not.

**Fix:**
Either (a) make the singleton db injectable so the real handler can be tested against a transient DB, or (b) accept the trade-off and add an explicit assertion comment that Test 6 is a logic-replication test, not an end-to-end test. Option (b) is the cheaper fix.

### IN-03: Boot IIFE comment in db.ts has stale "// import fixDB" line

**File:** `src/utils/db.ts:7`
**Issue:**
```typescript
// import fixDB from "@/lib/fixDB";
import type { DB } from "@/types/database";
import crypto from "crypto";
import fixDB from "@/lib/fixDB";
```

Line 7 is a commented-out import of `fixDB`, which is then imported for real on line 10. Dead comment that should be removed.

**Fix:**
Delete line 7.

### IN-04: `process.env.NODE_ENV` boot guard for `initKnexType` runs after seedDefaultIfEmpty

**File:** `src/utils/db.ts:44`
**Issue:**
```typescript
(async () => {
  await initDB(db);
  await fixDB(db);
  await loadAllFromDB(db);
  await seedDefaultIfEmpty(db);
  if (process.env.NODE_ENV == "dev") initKnexType(db);
})();
```

`initKnexType` is a dev-only codegen step that regenerates `src/types/database.d.ts`. Running it in the same IIFE as production boot means: (a) it adds latency to every dev boot, (b) if it throws, it aborts the IIFE after seed but before any other future boot step. Minor — but worth separating concerns.

**Fix:**
Move `initKnexType` to a separate script (e.g., `scripts/gen-db-types.ts`) invoked via `npm run` rather than at boot.

---

## Phase 31 Readiness Assessment

The REST API surface is **mostly ready** for Phase 31 callback refactor, with caveats:

- `registry.phaseById('movie-v1', phaseId)` is the correct internal-consumption path — the REST endpoints are for external clients. The summary correctly identifies this.
- The derivation proof (SC #5) is solid: 48-assertion smoke test verifies the manifest's phase_taxonomy matches the three constants field-by-field.
- **However**, until CR-01 (auth) and CR-02 (boot race) are resolved, Phase 31 callbacks that read from the registry in the cold-start window may see an empty registry. Phase 31 should add a `await booted` gate or check `registry.list().length > 0` before processing callbacks.
- WR-03 (skill_id collision) is a Phase 31 concern: if a callback reads `registry.get('movie-v1')` and a malicious or accidental POST `/register` has overwritten it, the callback will use the wrong values. Phase 31 should snapshot the manifest at pipeline-start time, not look it up per-callback.

---

## Fix Log (2026-06-15)

Applied by `/gsd:code-review --fix` workflow. Scope: Critical + Warning. 6 of 10 in-scope findings addressed; 4 warnings explicitly deferred (WR-02, WR-06, WR-07, WR-08). 4 Info findings out of scope.

**Iteration:** 1
**Verifier:** `npx tsx scripts/verify-phase-30.ts` → 61/61 assertions passing (baseline preserved).
**Status:** `clean_with_deferrals`

### Fixed (6)

| ID | Severity | Approach | Commit |
|----|----------|----------|--------|
| CR-02 | Critical | FULL FIX — `bootReady` promise exported from `db.ts`, awaited in `app.ts` `server.listen` callback. Closes SC #1 race window. Also fixes WR-08 (`==` → `===`) in the same IIFE. | `dd17548` |
| CR-01 | Critical | DEFER + COMMENT — CONTEXT.md D-04 explicitly accepts unauthenticated `/register` for v1.6. Added prominent SECURITY comment block in `register.ts`. No enforcement code. | `6983b61` |
| WR-01 | Warning | FULL FIX — added `.where("active", 1)` to `list.ts` side SELECT to mirror `loader.ts` filter. **Requires human verification** — the deactivated-skill path is not exercised by verify-phase-30.ts. | `81dcbe0` |
| WR-03 | Warning | DEFER + COMMENT — UPSERT overwrite of movie-v1 is a documented v1.6 acceptance (CONTEXT.md D-04 permits re-registration). Added deferral note at the UPSERT site. No enforcement. | `428d253` |
| WR-04 | Warning | DEFER + COMMENT — global `express.json({ limit: "100mb" })` is a DoS surface for `/register`. Documented the risk + v1.7+ mitigation (per-route limit, zod `.max()` caps). No code change. | `008ff5f` |
| WR-05 | Warning | FULL FIX — runtime endpoint + healthcheck path read from `SKILL_MOVIE_V1_ENDPOINT` / `SKILL_MOVIE_V1_HEALTHCHECK_PATH` env vars with localhost defaults. Manual override verified. | `8a96843` |

### Deferred (4)

| ID | Severity | Reason |
|----|----------|--------|
| WR-02 | Warning | list.ts missing try/catch on DB read — defer to a cross-cutting error-shape refactor (would also touch get.ts/node-types.ts/phases.ts). Low impact: registry reads are sync and don't throw. |
| WR-06 | Warning | `Date.now()` for `registered_at` — minor nondeterminism. Phase 33 snapshot tests will need to assert on type, not value. Documented in REVIEW.md body; no code change needed for v1.6. |
| WR-07 | Warning | `mapIngest` `as IngestOutput[]` cast — the module-load-time `validateManifest` self-check already catches invalid values loudly (boot fails). Narrowing the source-map type is a Phase 31 cleanup. |
| WR-08 | Warning | `==` vs `===` on `NODE_ENV` — **fixed as a side-effect of CR-02** (the boot IIFE was rewritten and now uses `===`). |

### Out of scope (4)

IN-01, IN-02, IN-03, IN-04 — Info-tier, deferred per `/gsd:code-review --fix` scope.

### Phase 31 Readiness Update

The CR-02 fix removes the boot-race caveat from the original Phase 31 Readiness Assessment — `await bootReady` in `src/app.ts` now guarantees the registry is seeded before any HTTP request is accepted. The remaining Phase 31 concerns (CR-01 auth deferral, WR-03 overwrite risk) stand as documented above; Phase 31 should still snapshot the manifest at pipeline-start time rather than per-callback.

---

_Reviewed: 2026-06-15_
_Reviewer: Claude (gsd-code-reviewer)_
_Fixed: 2026-06-15_
_Fixer: Claude (gsd-code-fixer)_
_Depth: standard_
